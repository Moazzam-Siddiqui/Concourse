package com.concourse.service.simulation;

import com.concourse.model.SimulationRun;
import com.concourse.model.ArrivalPhase;
import com.concourse.model.Person;
import com.concourse.model.ReroutePath;
import com.concourse.model.Session;
import com.concourse.model.Venue;
import com.concourse.model.VenueEdge;
import com.concourse.model.VenueNode;
import com.concourse.service.routing.RerouteEngine;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.Deque;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Random;
import java.util.Set;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * Crowd movement over the venue graph, in two modes that share this class.
 *
 * <p><b>Flow mode</b> ({@link #advanceTick}) drives the older {@code /simulations} runs:
 * per-node counts move downstream as far as capacity and edge throughput allow. Cheap, and
 * enough for the before/after summary.
 *
 * <p><b>Agent mode</b> ({@link #step}) drives {@code /sessions}: individual {@link Person}
 * agents integrated under the {@link SocialForceModel}, so the map shows people rather than
 * numbers. Node population falls out of where the agents are.
 *
 * <p>In both modes, people who cannot move stay put — that is what makes a node's density
 * climb, which is exactly the bottleneck the detector is looking for.
 */
@Service
public class SimulationEngine {

    private final AgentFactory agentFactory;
    private final SocialForceModel socialForceModel;
    private final RerouteEngine routeEngine;
    private final double criticalThreshold;
    private final double ticksPerEdge;
    private final double neighbourRadius;
    private final double corridorScale;

    /**
     * Decides where each attendee goes and how long they stay. Constructed here rather than
     * injected because it holds only the tick length and no collaborators.
     */
    private final ItineraryPlanner itineraryPlanner = new ItineraryPlanner(1.0);

    /** Walking speed in layout units per tick, per venue. See {@link #agentSpeedFor}. */
    private final Map<String, Double> speedCache = new ConcurrentHashMap<>();

    /** Hop distance to the nearest exit, per venue. Layouts are immutable once uploaded. */
    private final Map<String, Map<String, Integer>> hopCache = new ConcurrentHashMap<>();
    /** Edge half-width in layout units, keyed "venueId|from|to". Same reason: layouts are fixed. */
    private final Map<String, Double> corridorCache = new ConcurrentHashMap<>();

    @Autowired
    public SimulationEngine(AgentFactory agentFactory, SocialForceModel socialForceModel,
                            RerouteEngine routeEngine,
                            @Value("${simulation.critical-threshold:0.85}") double criticalThreshold,
                            @Value("${session.ticks-per-edge:50}") double ticksPerEdge,
                            @Value("${session.neighbour-radius:10.0}") double neighbourRadius,
                            @Value("${session.corridor-scale:1.5}") double corridorScale) {
        this.agentFactory = agentFactory;
        this.socialForceModel = socialForceModel;
        this.routeEngine = routeEngine;
        this.criticalThreshold = criticalThreshold;
        this.ticksPerEdge = Math.max(1, ticksPerEdge);
        this.neighbourRadius = neighbourRadius;
        this.corridorScale = corridorScale;
    }

    /** Flow-mode-only constructor, for tests that never touch agent mode. */
    public SimulationEngine(AgentFactory agentFactory, SocialForceModel socialForceModel,
                            double criticalThreshold) {
        this(agentFactory, socialForceModel, new RerouteEngine(0.70), criticalThreshold, 50, 10.0, 1.5);
    }

    /**
     * Walking speed for a venue, in layout units per tick.
     *
     * <p>Derived from the venue's own scale rather than fixed: node coordinates are arbitrary
     * layout units, so an absolute speed makes a venue authored at half the scale appear to
     * walk twice as fast for no stated reason. The tunable is
     * {@code session.ticks-per-edge} — roughly how many ticks it should take to walk a typical
     * corridor — which means the same thing on every layout.
     *
     * <p>Median rather than mean: one long perimeter edge should not slow the whole venue down.
     */
    public double agentSpeedFor(Venue venue) {
        return speedCache.computeIfAbsent(venue.id() == null ? venue.name() : venue.id(), key -> {
            Map<String, VenueNode> nodesById = venue.nodesById();
            double[] lengths = venue.edges().stream()
                    .mapToDouble(edge -> {
                        VenueNode from = nodesById.get(edge.from());
                        VenueNode to = nodesById.get(edge.to());
                        return from == null || to == null ? Double.NaN
                                : Math.hypot(to.x() - from.x(), to.y() - from.y());
                    })
                    .filter(length -> !Double.isNaN(length) && length > 0)
                    .sorted()
                    .toArray();
            if (lengths.length == 0) {
                return 3.0; // degenerate layout — every node on one spot
            }
            return Math.max(0.2, lengths[lengths.length / 2] / ticksPerEdge);
        });
    }

    public SimulationRun create(Venue venue, int crowdSize, int ticks, int arrivalRate, boolean rerouteEnabled) {
        return create(venue, crowdSize, ticks, arrivalRate, List.of(), rerouteEnabled);
    }

    public SimulationRun create(Venue venue, int crowdSize, int ticks, int arrivalRate,
                                List<ArrivalPhase> arrivalSchedule, boolean rerouteEnabled) {
        SimulationRun run = new SimulationRun("sim-" + UUID.randomUUID().toString().substring(0, 8),
                venue.id(), crowdSize, ticks, arrivalRate, arrivalSchedule, rerouteEnabled);
        venue.nodes().forEach(n -> run.getOccupancy().put(n.id(), 0));
        run.getHistory().add(Map.copyOf(run.getOccupancy())); // tick 0 = empty venue
        return run;
    }

    /**
     * Advances the run by exactly one tick and returns the resulting density
     * (occupancy / capacity) per node.
     */
    public Map<String, Double> advanceTick(Venue venue, SimulationRun run) {
        Map<String, VenueNode> nodesById = venue.nodesById();
        Map<String, List<VenueEdge>> adjacency = venue.adjacency();
        Map<String, Integer> hops = hopCache.computeIfAbsent(venue.id(), k -> hopsToExit(venue));

        Map<String, Integer> current = new HashMap<>(run.getOccupancy());
        Map<String, Integer> next = new HashMap<>(current);

        // 1. Exits drain fully — those people have left the venue.
        for (VenueNode node : venue.nodes()) {
            if (!node.isExit()) {
                continue;
            }
            int leaving = current.getOrDefault(node.id(), 0);
            if (leaving > 0) {
                next.merge(node.id(), -leaving, Integer::sum);
                run.recordExits(leaving);
            }
        }

        // 2. Move people exit-ward, closest-to-exit first so freed space is reusable this tick.
        double speed = agentFactory.cohortSpeedFactor(run.getCrowdSize());
        List<VenueNode> order = new ArrayList<>(venue.nodes().stream().filter(n -> !n.isExit()).toList());
        order.sort(Comparator.comparingInt(n -> hops.getOrDefault(n.id(), Integer.MAX_VALUE)));

        for (VenueNode node : order) {
            int here = current.getOrDefault(node.id(), 0);
            if (here == 0) {
                continue;
            }
            int movers = (int) Math.round(here * mobility(node) * speed);

            for (VenueEdge edge : downstream(adjacency, hops, nodesById, next, node.id(), run.isRerouteEnabled())) {
                if (movers <= 0) {
                    break;
                }
                VenueNode target = nodesById.get(edge.to());
                if (target == null) {
                    continue;
                }
                int spare = target.capacity() - next.getOrDefault(target.id(), 0);
                // Congestion slows you down entering a crowded space — it does not paralyse the
                // one you are leaving. A packed gate still empties at the corridor's rate.
                double targetDensity = (double) next.getOrDefault(target.id(), 0) / target.capacity();
                int throughput = (int) Math.round(
                        edge.throughputPerTick() * socialForceModel.congestionSlowdown(targetDensity));
                int moved = Math.min(movers, Math.min(spare, throughput));
                if (moved <= 0) {
                    continue;
                }
                next.merge(node.id(), -moved, Integer::sum);
                next.merge(target.id(), moved, Integer::sum);
                movers -= moved;
            }
        }

        // 3. New arrivals queue in at the gates, split evenly, capped by gate headroom.
        List<VenueNode> gates = venue.nodes().stream().filter(VenueNode::isEntry).toList();
        if (!gates.isEmpty()) {
            int scheduledRate = run.arrivalRateAt(run.getCurrentTick());
            int perGate = scheduledRate / gates.size();
            int remainder = scheduledRate % gates.size();
            for (int gateIndex = 0; gateIndex < gates.size(); gateIndex++) {
                VenueNode gate = gates.get(gateIndex);
                int inGate = next.getOrDefault(gate.id(), 0);
                // With rerouting on we act on our own advice: intake is held so the gate
                // never crosses critical — people wait outside instead of crushing inside.
                // -1 keeps the gate strictly below critical rather than landing exactly on it.
                int ceiling = run.isRerouteEnabled()
                        ? (int) Math.ceil(gate.capacity() * criticalThreshold) - 1
                        : gate.capacity();
                int gateShare = perGate + (gateIndex < remainder ? 1 : 0);
                int arriving = run.takeArrivals(Math.max(0, Math.min(gateShare, ceiling - inGate)));
                if (arriving > 0) {
                    next.merge(gate.id(), arriving, Integer::sum);
                }
            }
        }

        run.getOccupancy().putAll(next);
        run.setCurrentTick(run.getCurrentTick() + 1);
        run.getHistory().add(Map.copyOf(next)); // history index == tick
        if (run.isFinished()) {
            run.setStatus(SimulationRun.Status.COMPLETED);
        }
        return densities(venue, next);
    }

    public static Map<String, Double> densities(Venue venue, Map<String, Integer> occupancy) {
        Map<String, Double> result = new LinkedHashMap<>();
        for (VenueNode node : venue.nodes()) {
            result.put(node.id(), (double) occupancy.getOrDefault(node.id(), 0) / node.capacity());
        }
        return result;
    }

    /** Share of a node's occupants that try to move on each tick, before congestion effects. */
    private double mobility(VenueNode node) {
        return switch (node.type()) {
            case WALKWAY -> 0.80;
            case GATE -> 0.70;
            case CONCESSION -> 0.25; // people linger to buy
            case SEATING -> 0.10;
            case EXIT -> 1.0;
        };
    }

    /**
     * Where a node's occupants may move, best first.
     *
     * <p>Without rerouting, only edges leading strictly closer to an exit — people head for
     * the exit and queue when it is full. With rerouting, lateral moves (same hop count) are
     * allowed too, so a crowd can spill around a blocked node. Backward moves are never
     * allowed either way: sending people back toward the gate is not a reroute, it is a crush.
     */
    private List<VenueEdge> downstream(Map<String, List<VenueEdge>> adjacency, Map<String, Integer> hops,
                                       Map<String, VenueNode> nodesById, Map<String, Integer> occupancy,
                                       String nodeId, boolean rerouteEnabled) {
        int here = hops.getOrDefault(nodeId, Integer.MAX_VALUE);
        List<VenueEdge> candidates = new ArrayList<>();
        for (VenueEdge edge : adjacency.getOrDefault(nodeId, List.of())) {
            int there = hops.getOrDefault(edge.to(), Integer.MAX_VALUE);
            if (there < here || (rerouteEnabled && there == here)) {
                candidates.add(edge);
            }
        }
        // Closest to an exit first; among equals, whichever has the most room left — otherwise
        // a 90-person kiosk soaks up crowd the 900-person stand next door could have absorbed.
        candidates.sort(Comparator
                .comparingInt((VenueEdge e) -> hops.getOrDefault(e.to(), Integer.MAX_VALUE))
                .thenComparing(Comparator.comparingInt(
                        (VenueEdge e) -> spare(nodesById, occupancy, e.to())).reversed()));
        return candidates;
    }

    private int spare(Map<String, VenueNode> nodesById, Map<String, Integer> occupancy, String nodeId) {
        VenueNode node = nodesById.get(nodeId);
        return node == null ? 0 : node.capacity() - occupancy.getOrDefault(nodeId, 0);
    }

    /** BFS backwards from every exit. Unreachable nodes get Integer.MAX_VALUE. */
    private Map<String, Integer> hopsToExit(Venue venue) {
        Map<String, List<String>> incoming = new HashMap<>();
        for (VenueEdge edge : venue.edges()) {
            incoming.computeIfAbsent(edge.to(), k -> new ArrayList<>()).add(edge.from());
            if (edge.bidirectional()) {
                incoming.computeIfAbsent(edge.from(), k -> new ArrayList<>()).add(edge.to());
            }
        }

        Map<String, Integer> hops = new HashMap<>();
        Deque<String> queue = new ArrayDeque<>();
        for (VenueNode node : venue.nodes()) {
            if (node.isExit()) {
                hops.put(node.id(), 0);
                queue.add(node.id());
            }
        }
        while (!queue.isEmpty()) {
            String node = queue.poll();
            for (String previous : incoming.getOrDefault(node, List.of())) {
                if (hops.putIfAbsent(previous, hops.get(node) + 1) == null) {
                    queue.add(previous);
                }
            }
        }
        venue.nodes().forEach(n -> hops.putIfAbsent(n.id(), Integer.MAX_VALUE));
        return hops;
    }

    // ================================================================================
    // Agent mode — individual people under the social force model, used by /sessions.
    // ================================================================================

    /**
     * How big a node is on the map. Derived from capacity so a 900-seat stand is visibly a
     * bigger space than a 90-person kiosk, which is also what makes agents spread out inside
     * it instead of stacking on one point.
     */
    public static double nodeRadius(VenueNode node) {
        return Math.max(10.0, Math.min(44.0, 8.0 + Math.sqrt(node.capacity()) * 0.6));
    }

    /**
     * Advances a session by exactly one tick: new arrivals enter at the gates, every agent
     * integrates one step under the social force model, and anyone who has reached an exit
     * leaves the venue.
     *
     * <p>Called only from the session tick thread — see {@link Session} on why nothing here
     * synchronises.
     */
    public void step(Session session) {
        Venue venue = session.getVenue();
        spawnArrivals(session, venue);
        // Before integrating: anyone the event has just released should start walking on this
        // tick, not the next one, or the surge lags the phase change by a frame.
        releaseForEgress(session, venue);
        integrate(session, venue);
        resolveArrivals(session, venue);
        session.setTick(session.getTick() + 1);
    }

    /**
     * Gates admit up to {@code arrivalRate} people per tick, split across them. With
     * rerouting on we act on our own advice and hold intake at a gate that has gone critical
     * — people wait outside rather than being crushed inside, which is the whole point.
     */
    private void spawnArrivals(Session session, Venue venue) {
        // Shaped by the arrival curve rather than flat. See ArrivalCurve: a constant rate
        // never produces the pre-event push or the post-event surge, which are the only two
        // moments a crowd plan is really written for.
        double multiplier = ArrivalCurve.arrivalMultiplier(session.getTick(), session.getMaxTicks());
        int shaped = (int) Math.round(session.getArrivalRate() * multiplier);
        int wanted = Math.min(shaped, session.remainingToSpawn());
        if (wanted <= 0) {
            return;
        }
        List<VenueNode> gates = venue.nodes().stream().filter(VenueNode::isEntry).toList();
        if (gates.isEmpty()) {
            return;
        }

        Map<String, Integer> occupancy = session.occupancy();
        // Seeded from the session, not its id, so a baseline twin draws the same crowd mix and
        // spawn scatter. Any difference between the two runs is then the intervention, not luck.
        Random random = new Random(session.getSeed() * 31L + session.getTick());
        int spawnedThisTick = 0;

        for (int i = 0; i < gates.size(); i++) {
            VenueNode gate = gates.get(i);
            int share = wanted / gates.size() + (i < wanted % gates.size() ? 1 : 0);
            if (share <= 0) {
                continue;
            }
            if (session.isRerouteEnabled()
                    && (double) occupancy.getOrDefault(gate.id(), 0) / gate.capacity() >= criticalThreshold) {
                continue;
            }

            List<Person> arrivals = agentFactory.createAgents(share, gate, session.getId(),
                    session.getSpawned() + spawnedThisTick, agentSpeedFor(venue),
                    nodeRadius(gate) * 0.8, random);
            for (Person person : arrivals) {
                // Each arrival gets somewhere to be, not just a way out. The engine walks the
                // itinerary one stop at a time in advanceItineraries() — routing per leg, so a
                // stop that turns out to be unreachable is skipped instead of stranding them.
                person.setItinerary(itineraryPlanner.plan(venue, random));
                routeToNextStop(session, venue, person);
            }
            session.getPeople().addAll(arrivals);
            spawnedThisTick += arrivals.size();
        }
        session.recordSpawned(spawnedThisTick);
    }

    /**
     * One integration step for every agent.
     *
     * <p>Two passes on purpose: accelerations are computed from the positions everyone had at
     * the start of the tick, then applied. Mutating in place as we walk the list would make an
     * agent's neighbours depend on its index in the list, which shows up as the crowd
     * mysteriously drifting in list order.
     */
    private void integrate(Session session, Venue venue) {
        List<Person> people = session.getPeople();
        int count = people.size();
        if (count == 0) {
            return;
        }
        Map<String, VenueNode> nodesById = venue.nodesById();
        Map<Long, List<Person>> grid = spatialHash(people);

        double[] ax = new double[count];
        double[] ay = new double[count];

        for (int i = 0; i < count; i++) {
            Person person = people.get(i);
            double[] position = {person.getX(), person.getY()};
            double[] velocity = {person.getVx(), person.getVy()};
            double[] target = waypointPosition(person, nodesById);

            double[] force = socialForceModel.drivingForce(position, velocity, target, person.getDesiredSpeed());

            for (Person other : neighbours(grid, person)) {
                if (other == person) {
                    continue;
                }
                double[] repulsion = socialForceModel.agentRepulsion(
                        position, new double[] {other.getX(), other.getY()},
                        person.getRadius() + other.getRadius());
                force[0] += repulsion[0];
                force[1] += repulsion[1];
            }

            double[] corridor = corridorForce(session, person, position, nodesById);
            force[0] += corridor[0];
            force[1] += corridor[1];

            ax[i] = force[0];
            ay[i] = force[1];
        }

        for (int i = 0; i < count; i++) {
            Person person = people.get(i);
            double vx = person.getVx() + ax[i];
            double vy = person.getVy() + ay[i];

            // Nobody sprints, however hard the crowd shoves. Without this cap a dense pile-up
            // fires agents across the map and the density readings go with them.
            double maxSpeed = person.getDesiredSpeed() * 1.4;
            double speed = Math.hypot(vx, vy);
            if (speed > maxSpeed) {
                vx = vx / speed * maxSpeed;
                vy = vy / speed * maxSpeed;
            }
            person.setVelocity(vx, vy);
            person.setPosition(person.getX() + vx, person.getY() + vy);
        }
    }

    /**
     * Moves each agent's node membership on when it reaches its next waypoint, and removes
     * anyone who has reached an exit.
     */
    private void resolveArrivals(Session session, Venue venue) {
        Map<String, VenueNode> nodesById = venue.nodesById();
        List<Person> people = session.getPeople();
        int exited = 0;

        for (int i = people.size() - 1; i >= 0; i--) {
            Person person = people.get(i);

            // A short hop can clear more than one waypoint in a tick, so loop rather than if.
            String next;
            while ((next = person.nextWaypoint()) != null) {
                VenueNode node = nodesById.get(next);
                if (node == null) {
                    person.advanceWaypoint(); // waypoint vanished with the layout; skip it
                    continue;
                }
                if (Math.hypot(person.getX() - node.x(), person.getY() - node.y()) > nodeRadius(node)) {
                    break;
                }
                person.advanceWaypoint();
            }

            VenueNode here = nodesById.get(person.getCurrentNodeId());
            if (here != null && here.isExit()) {
                person.setArrived(true);
                people.remove(i);
                exited++;
                continue;
            }

            // Still walking — nothing to decide until they get where they were going.
            if (person.nextWaypoint() != null) {
                continue;
            }

            // Arrived at a stop. Linger, then move on to the next one.
            if (person.isDwelling()) {
                boolean finished = person.tickDwell();
                if (!finished) {
                    continue;
                }
            } else if (here != null && !person.getItinerary().isEmpty()) {
                // Just got here and has somewhere else to be later: stay a while first.
                Random dwellRandom = new Random(person.getId().hashCode() * 31L + session.getTick());
                person.startDwell(itineraryPlanner.dwellTicks(here, dwellRandom));
                if (person.isDwelling()) {
                    continue;
                }
            }

            routeToNextStop(session, venue, person);
        }
        session.recordExited(exited);
    }

    /**
     * Sends a person to the next place on their itinerary, or to an exit when it is spent.
     *
     * <p>Routing happens per leg rather than once up front. A single path through every stop
     * would be planned against the venue as it was at spawn time, and by the time somebody has
     * sat through an event the congestion it was planned around is an hour stale. Re-routing at
     * each stop also means the reroute engine gets a say every time, which is what lets a
     * diversion actually apply to someone mid-visit.
     */
    private void routeToNextStop(Session session, Venue venue, Person person) {
        String from = person.getCurrentNodeId();

        String stop;
        while ((stop = person.popNextStop()) != null) {
            if (stop.equals(from)) {
                continue; // already here
            }
            ReroutePath leg = routeEngine.pathAvoiding(venue, from, stop, Set.of());
            if (leg != null && leg.toNodeId() != null && leg.path().size() > 1) {
                person.setRoute(leg.path().subList(1, leg.path().size()));
                return;
            }
            // Unreachable from here — drop it and try the next stop rather than stranding
            // them. A plan is a preference, not a guarantee the graph can honour it.
        }

        // Itinerary exhausted: head for the way out.
        person.setLeaving(true);
        ReroutePath toExit = routeEngine.nearestExit(venue, from);
        if (toExit.toNodeId() != null && toExit.path().size() > 1) {
            person.setRoute(toExit.path().subList(1, toExit.path().size()));
        }
    }

    /**
     * When the event ends, people get up and leave.
     *
     * <p>Without this the venue drains at whatever pace the dwell times happen to expire, and
     * the end-of-event surge — the single most dangerous moment at any venue, and the thing
     * this tool exists to predict — never happens. A fraction of the seated crowd stands up
     * each tick once the event is over, rising as the surge proceeds.
     */
    private void releaseForEgress(Session session, Venue venue) {
        double fraction = ArrivalCurve.departureFraction(session.getTick(), session.getMaxTicks());
        if (fraction <= 0) {
            return;
        }
        Random random = new Random(session.getSeed() * 7919L + session.getTick());
        for (Person person : session.getPeople()) {
            if (person.isLeaving() || !person.isDwelling()) {
                continue;
            }
            if (random.nextDouble() < fraction) {
                person.startDwell(0);
                person.getItinerary().clear();
                routeToNextStop(session, venue, person);
            }
        }
    }

    /** Where an agent is walking to: its next waypoint, or its own node once the route is spent. */
    private double[] waypointPosition(Person person, Map<String, VenueNode> nodesById) {
        String next = person.nextWaypoint();
        VenueNode node = nodesById.get(next == null ? person.getCurrentNodeId() : next);
        return node == null ? new double[] {person.getX(), person.getY()} : new double[] {node.x(), node.y()};
    }

    /**
     * Keeps an agent in the corridor it is walking down. Half-width comes from the edge's real
     * width, so a 3 m service passage squeezes people together and a 9 m concourse does not.
     *
     * <p>Inside the corridor this is the social force wall term applied to both offset walls,
     * which is what stops the crowd hugging one edge. Outside it is a straight pull back to
     * the centreline — because the wall term repels, and repelling an agent that has already
     * strayed past a wall shoves it further out. That asymmetry is easy to miss and its
     * symptom is agents orbiting a node forever without ever entering it.
     */
    private double[] corridorForce(Session session, Person person, double[] position,
                                   Map<String, VenueNode> nodesById) {
        String next = person.nextWaypoint();
        if (next == null) {
            return new double[] {0, 0};
        }
        VenueNode from = nodesById.get(person.getCurrentNodeId());
        VenueNode to = nodesById.get(next);
        if (from == null || to == null) {
            return new double[] {0, 0};
        }
        double dx = to.x() - from.x();
        double dy = to.y() - from.y();
        double length = Math.hypot(dx, dy);
        if (length < 1e-6) {
            return new double[] {0, 0};
        }

        double halfWidth = halfWidthOf(session.getVenue(), from.id(), to.id());
        double nx = -dy / length;   // unit normal to the centreline
        double ny = dx / length;
        double offset = (position[0] - from.x()) * nx + (position[1] - from.y()) * ny;

        if (Math.abs(offset) >= halfWidth) {
            // Strayed out of the corridor — steer back in, proportional to how far out.
            double pull = Math.min(2.0, (Math.abs(offset) - halfWidth) * 0.25 + 0.5);
            double sign = offset > 0 ? -1 : 1;
            return new double[] {nx * pull * sign, ny * pull * sign};
        }

        double[] left = socialForceModel.wallRepulsion(position,
                new double[] {from.x() + nx * halfWidth, from.y() + ny * halfWidth},
                new double[] {to.x() + nx * halfWidth, to.y() + ny * halfWidth});
        double[] right = socialForceModel.wallRepulsion(position,
                new double[] {from.x() - nx * halfWidth, from.y() - ny * halfWidth},
                new double[] {to.x() - nx * halfWidth, to.y() - ny * halfWidth});
        return new double[] {left[0] + right[0], left[1] + right[1]};
    }

    private double halfWidthOf(Venue venue, String from, String to) {
        return corridorCache.computeIfAbsent(venue.id() + "|" + from + "|" + to, key -> {
            double width = venue.edges().stream()
                    .filter(e -> (e.from().equals(from) && e.to().equals(to))
                            || (e.bidirectional() && e.from().equals(to) && e.to().equals(from)))
                    .mapToDouble(VenueEdge::width)
                    .findFirst()
                    .orElse(6.0);
            // Floor of 12: narrower than that and the corridor is thinner than the discs
            // agents spawn into, so people start life outside the walls they belong between.
            return Math.max(12.0, width * corridorScale);
        });
    }

    /**
     * Buckets agents into cells the width of the interaction radius, so each agent only tests
     * the nine cells around it instead of the whole crowd.
     *
     * <p>ponytail: uniform grid, rebuilt every tick. It is O(n) to build and keeps the tick
     * near-linear up to a few thousand agents, which is all a demo venue holds. If crowd sizes
     * grow past that, reuse the grid across ticks and update cells on the move instead.
     */
    private Map<Long, List<Person>> spatialHash(List<Person> people) {
        Map<Long, List<Person>> grid = new HashMap<>();
        for (Person person : people) {
            grid.computeIfAbsent(cellKey(person.getX(), person.getY()), k -> new ArrayList<>()).add(person);
        }
        return grid;
    }

    private List<Person> neighbours(Map<Long, List<Person>> grid, Person person) {
        long cellX = (long) Math.floor(person.getX() / neighbourRadius);
        long cellY = (long) Math.floor(person.getY() / neighbourRadius);
        List<Person> found = new ArrayList<>();
        for (long dx = -1; dx <= 1; dx++) {
            for (long dy = -1; dy <= 1; dy++) {
                List<Person> cell = grid.get(key(cellX + dx, cellY + dy));
                if (cell != null) {
                    found.addAll(cell);
                }
            }
        }
        return found;
    }

    private long cellKey(double x, double y) {
        return key((long) Math.floor(x / neighbourRadius), (long) Math.floor(y / neighbourRadius));
    }

    private long key(long cellX, long cellY) {
        return (cellX << 32) ^ (cellY & 0xffff_ffffL);
    }
}
