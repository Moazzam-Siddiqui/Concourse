package com.concourse.service.simulation;

import com.concourse.model.Venue;
import com.concourse.model.VenueNode;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.Random;

/**
 * Decides what each attendee actually does inside the venue.
 *
 * <p>The simulation used to route everyone gate → nearest exit the instant they spawned. That
 * produces a tidy stream of people crossing the building and almost nothing else: seating never
 * fills because nobody stops in it, concessions see traffic only when they happen to lie on a
 * shortest path, and the density map degenerates into a picture of the shortest route out. None
 * of the congestion a venue operator actually worries about is reproduced, because all of it
 * comes from people *staying* somewhere and then leaving together.
 *
 * <p>So each person gets an itinerary instead: a handful of stops with a dwell time at each,
 * ending at an exit. The shape is deliberately simple and legible —
 *
 * <pre>
 *   gate → [concession?] → main draw (seating) → [facility?] → exit
 * </pre>
 *
 * <p>and the interesting behaviour falls out of the dwell times rather than from clever routing.
 * Somebody sitting in a stand for eight minutes is what makes the stand full; everyone's dwell
 * ending within the same minute is what makes the concourse dangerous.
 */
public class ItineraryPlanner {

    /**
     * How long people linger, in seconds, per zone type: {min, max}.
     *
     * <p>Seconds rather than ticks so these read as what they are, and so they stay correct if
     * the tick rate changes. Ranges rather than constants because a crowd that all moves on at
     * the same instant is its own artefact — the spread is what makes a zone drain gradually.
     */
    private static final Map<VenueNode.Type, int[]> DWELL_SECONDS = new EnumMap<>(Map.of(
            // The main event. Long, and the dominant reason anyone is in the building.
            VenueNode.Type.SEATING, new int[]{240, 900},
            // Buying something and eating it.
            VenueNode.Type.CONCESSION, new int[]{60, 240},
            // Passing through, with a pause to read a sign or wait for someone.
            VenueNode.Type.WALKWAY, new int[]{0, 20},
            // Nobody lingers at a door.
            VenueNode.Type.GATE, new int[]{0, 10},
            VenueNode.Type.EXIT, new int[]{0, 0}
    ));

    /** Chance an attendee stops at a concession on the way in. */
    private static final double CONCESSION_BEFORE = 0.45;

    /** Chance they stop at one again on the way out — lower; most people just leave. */
    private static final double CONCESSION_AFTER = 0.15;

    /** Chance of a mid-visit trip away from the main draw and back (bar, toilet, a walk). */
    private static final double MID_VISIT_TRIP = 0.35;

    private final double tickSeconds;

    public ItineraryPlanner(double tickSeconds) {
        this.tickSeconds = tickSeconds > 0 ? tickSeconds : 1.0;
    }

    /**
     * Builds one person's plan through the venue.
     *
     * <p>Returns the ordered stops <em>after</em> the gate. The engine walks these one at a
     * time, routing over the graph between each pair, so a stop the router cannot reach is
     * skipped rather than stranding the agent.
     *
     * @param venue  the venue being simulated
     * @param random seeded per session, so a baseline twin plans identical itineraries
     */
    public List<String> plan(Venue venue, Random random) {
        List<VenueNode> seating = nodesOfType(venue, VenueNode.Type.SEATING);
        List<VenueNode> concessions = nodesOfType(venue, VenueNode.Type.CONCESSION);
        List<VenueNode> exits = nodesOfType(venue, VenueNode.Type.EXIT);

        List<String> stops = new ArrayList<>();

        if (!concessions.isEmpty() && random.nextDouble() < CONCESSION_BEFORE) {
            stops.add(pick(concessions, random).id());
        }

        // The main draw. A venue with no seating — a concourse, a transit hall — has no such
        // anchor, and those attendees legitimately just pass through.
        if (!seating.isEmpty()) {
            VenueNode main = pick(seating, random);
            stops.add(main.id());

            if (random.nextDouble() < MID_VISIT_TRIP) {
                List<VenueNode> away = !concessions.isEmpty() ? concessions : seating;
                String detour = pick(away, random).id();
                if (!detour.equals(main.id())) {
                    stops.add(detour);
                    stops.add(main.id()); // and back to their seat
                }
            }
        }

        if (!concessions.isEmpty() && random.nextDouble() < CONCESSION_AFTER) {
            stops.add(pick(concessions, random).id());
        }

        // Everyone leaves. Which exit is decided at the time by the router, not now — by then
        // the nearest one may be the worst one, and that decision belongs to the reroute engine.
        if (!exits.isEmpty()) {
            stops.add(pick(exits, random).id());
        }

        return stops;
    }

    /**
     * How many ticks this person stays at a node, drawn from the band for its type.
     *
     * <p>An unknown type gets a short pause rather than zero: an agent that never dwells
     * anywhere is the behaviour this class exists to remove.
     */
    public int dwellTicks(VenueNode node, Random random) {
        if (node == null) {
            return 0;
        }
        int[] band = DWELL_SECONDS.getOrDefault(node.type(), new int[]{10, 45});
        int seconds = band[0] + (band[1] > band[0] ? random.nextInt(band[1] - band[0]) : 0);
        return (int) Math.round(seconds / tickSeconds);
    }

    private static List<VenueNode> nodesOfType(Venue venue, VenueNode.Type type) {
        return venue.nodes().stream().filter(n -> n.type() == type).toList();
    }

    private static VenueNode pick(List<VenueNode> from, Random random) {
        return from.get(random.nextInt(from.size()));
    }
}
