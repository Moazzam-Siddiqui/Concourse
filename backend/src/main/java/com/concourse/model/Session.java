package com.concourse.model;

import com.concourse.dto.SessionState;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * One live simulation session: a venue, the crowd walking through it, and everything the
 * detector, route engine and AI layer have said about it so far.
 *
 * <p>Threading contract, because it is the thing most likely to bite:
 * <ul>
 *   <li>{@link #people} and {@link #densityHistory} are touched <em>only</em> by the tick
 *       thread. They are plain collections on purpose — a CopyOnWriteArrayList of a few
 *       thousand agents mutated ten times a second would copy the backing array to death.</li>
 *   <li>Everything a controller or a WebSocket thread reads goes through
 *       {@link #latestState}, a volatile immutable snapshot the tick thread publishes.</li>
 *   <li>{@link #alerts}, {@link #advisories} and {@link #reroutes} are append-mostly feeds
 *       read by controllers, so those stay concurrent.</li>
 * </ul>
 */
public class Session {

    public enum Status { CREATED, RUNNING, PAUSED, STOPPED, COMPLETED }

    private final String id;
    private final Venue venue;
    private final int crowdSize;
    private final int arrivalRate;
    private final int maxTicks;
    private final double tickSeconds;
    private final boolean rerouteEnabled;
    /**
     * Shared by a session and its baseline twin so both draw the same crowd — same mix of
     * families and solo attendees, same walking speeds, same spawn scatter. Without it the
     * before/after comparison is measuring two different crowds and proves nothing.
     *
     * <p>Arrival <em>volume</em> still differs between the two, because holding intake at a
     * critical gate is exactly the intervention being measured.
     */
    private final long seed;

    /**
     * Real attendees reporting position from a phone, keyed by the opaque id their app generated.
     *
     * <p>Concurrent because these arrive on request threads, unlike {@link #people}, which the
     * tick thread owns exclusively. A walker is a zone and an expiry and nothing else — no
     * coordinates are kept, so there is nothing in here to leak.
     *
     * <p>Deliberately <em>not</em> {@link Person} objects. Three things would break: the social
     * force integrator rewrites x/y every tick so a reported position would survive about
     * 100 ms; {@code resolveArrivals} deletes agents that reach an EXIT; and {@link #isFinished()}
     * waits for {@code people} to empty, so an attendee who never walks out would keep the
     * session RUNNING forever, past {@code finishedAtMillis}, past eviction — a leak that would
     * only ever appear once somebody used the phone app.
     */
    private final Map<String, RealWalker> walkers = new ConcurrentHashMap<>();

    /** A live attendee: the zone they last reported, and when that stops counting. */
    public record RealWalker(String nodeId, long expiresAtMillis) {
    }

    // --- tick-thread only -------------------------------------------------
    private final List<Person> people = new ArrayList<>();
    /** Rolling density snapshots, oldest first. Bounded — see SessionManager.historyWindow. */
    private final List<Map<String, Double>> densityHistory = new ArrayList<>();
    /**
     * Read from request threads via {@code GET /sessions/{id}}, written by the tick thread —
     * hence volatile. Non-atomic increments are safe only because the tick thread is the sole
     * writer; two writers would need an adder.
     */
    private volatile int spawned;
    private volatile int exited;
    /** Running safety totals, accumulated every tick so they survive broadcast decimation. */
    private volatile double peakDensity;
    private volatile int criticalNodeTicks;
    /** Distinct zones that went critical at any point — the summary's bottleneck count. */
    private final Set<String> bottleneckNodes = ConcurrentHashMap.newKeySet();
    /** Last severity reported per node, so the alert feed only records actual changes. */
    private final Map<String, Alert.Severity> lastSeverity = new ConcurrentHashMap<>();

    // --- shared -----------------------------------------------------------
    // Bounded: a long run with density oscillating around a threshold appends forever
    // otherwise, and nothing ever reads the old entries.
    private static final int MAX_FEED = 300;
    private final List<Alert> alerts = new CopyOnWriteArrayList<>();
    private final List<String> advisories = new CopyOnWriteArrayList<>();
    private final List<ReroutePath> reroutes = new CopyOnWriteArrayList<>();

    /** Set of the paired no-intervention run, when this session has one. */
    private volatile String baselineSessionId;
    /** True for that paired run itself — it is simulated but never broadcast or analysed. */
    private volatile boolean shadow;
    /** When this session reached a terminal status, for the eviction sweep. 0 while live. */
    private volatile long finishedAtMillis;

    /** Latest per-node risk from the AI layer; empty until the first successful analyse. */
    private volatile Map<String, Double> predictedRisk = Map.of();
    private volatile String latestAdvisory;
    /** Why the AI layer last came back short, if it did. Surfaced so the demo can be honest. */
    private volatile String aiStatus = "not-yet-called";

    /** Guards against stacking analyse calls when one is already in flight. */
    private final AtomicBoolean analyseInFlight = new AtomicBoolean(false);
    /** Density snapshot the last analyse call was made on, for the change threshold. */
    private volatile Map<String, Double> lastAnalysedDensity = Map.of();
    private volatile int lastAnalysedTick = Integer.MIN_VALUE;

    private volatile Status status = Status.CREATED;
    private volatile int tick;
    private volatile SessionState latestState;

    public Session(String id, Venue venue, int crowdSize, int arrivalRate, int maxTicks,
                   double tickSeconds, boolean rerouteEnabled) {
        this(id, venue, crowdSize, arrivalRate, maxTicks, tickSeconds, rerouteEnabled,
                System.nanoTime());
    }

    public Session(String id, Venue venue, int crowdSize, int arrivalRate, int maxTicks,
                   double tickSeconds, boolean rerouteEnabled, long seed) {
        this.id = id;
        this.venue = venue;
        this.crowdSize = crowdSize;
        this.arrivalRate = arrivalRate;
        this.maxTicks = maxTicks;
        this.tickSeconds = tickSeconds;
        this.rerouteEnabled = rerouteEnabled;
        this.seed = seed;
    }

    /** A no-intervention twin of this session: same venue, same crowd, same arrivals, no rerouting. */
    public Session baselineTwin(String twinId) {
        Session twin = new Session(twinId, venue, crowdSize, arrivalRate, maxTicks, tickSeconds,
                false, seed);
        twin.shadow = true;
        return twin;
    }

    /**
     * Simulated agents currently in the venue, grouped by the node they are counted against.
     *
     * <p><b>Simulated only, deliberately.</b> Real attendees reporting position from a phone are
     * in {@link #walkers} and are added by {@link #liveOccupancy()} instead. The split exists
     * because the baseline twin has no real attendees: counting them here would put them into
     * {@code peakDensity} and {@code criticalNodeTicks} on the optimised side of the comparison
     * and nowhere on the other, and {@code SessionSummary} would report that rerouting made the
     * venue worse. This method defines the comparison; {@code liveOccupancy} defines the display.
     */
    public Map<String, Integer> occupancy() {
        Map<String, Integer> counts = new LinkedHashMap<>();
        venue.nodes().forEach(node -> counts.put(node.id(), 0));
        for (Person person : people) {
            counts.merge(person.getCurrentNodeId(), 1, Integer::sum);
        }
        return counts;
    }

    /**
     * Simulated agents plus live attendees — what the map, the alerts and the AI advisory see.
     *
     * <p>Expiry is enforced here rather than by a second scheduler: this runs once or twice a
     * tick and the map holds tens of entries, so a sweep would cost more than it saves.
     *
     * <p>ponytail: lazy TTL. Add a scheduled sweep if a venue ever holds thousands of phones.
     */
    public Map<String, Integer> liveOccupancy() {
        Map<String, Integer> counts = occupancy();
        if (walkers.isEmpty()) {
            return counts;
        }
        long now = System.currentTimeMillis();
        walkers.values().removeIf(walker -> walker.expiresAtMillis() <= now);
        for (RealWalker walker : walkers.values()) {
            // containsKey rather than merge: a node id from a venue that has since changed must
            // not invent a zone that the density loop will then divide by a capacity it has not got.
            if (counts.containsKey(walker.nodeId())) {
                counts.merge(walker.nodeId(), 1, Integer::sum);
            }
        }
        return counts;
    }

    /**
     * Records where a real attendee says they are.
     *
     * @return false when the session is already holding {@code cap} walkers, so the caller can
     *         answer 429 rather than letting an unauthenticated endpoint grow without limit
     */
    public boolean placeWalker(String walkerId, String nodeId, long ttlMillis, int cap) {
        long now = System.currentTimeMillis();
        // Sweep before counting. Without this the cap is measured against attendees who have
        // already left, so a venue that once filled would go on refusing newcomers until
        // something else happened to call liveOccupancy — which a paused session never does.
        walkers.values().removeIf(walker -> walker.expiresAtMillis() <= now);

        // An attendee already here is always allowed to move. Refusing them would freeze
        // everyone in a full venue at whichever zone they last reported, turning a capacity
        // limit into stale data on the operator's map.
        if (walkers.size() >= cap && !walkers.containsKey(walkerId)) {
            return false;
        }
        walkers.put(walkerId, new RealWalker(nodeId, now + ttlMillis));
        return true;
    }

    public void removeWalker(String walkerId) {
        walkers.remove(walkerId);
    }

    /** Live attendees, expired ones excluded. Cheap enough to call on the tick thread. */
    public int walkerCount() {
        long now = System.currentTimeMillis();
        walkers.values().removeIf(walker -> walker.expiresAtMillis() <= now);
        return walkers.size();
    }

    public boolean isFinished() {
        return tick >= maxTicks || (spawned >= crowdSize && people.isEmpty() && tick > 0);
    }

    public String getId() { return id; }
    public Venue getVenue() { return venue; }
    public int getCrowdSize() { return crowdSize; }
    public int getArrivalRate() { return arrivalRate; }
    public int getMaxTicks() { return maxTicks; }
    public double getTickSeconds() { return tickSeconds; }
    public boolean isRerouteEnabled() { return rerouteEnabled; }
    public long getSeed() { return seed; }
    public String getBaselineSessionId() { return baselineSessionId; }
    public boolean isShadow() { return shadow; }
    public long getFinishedAtMillis() { return finishedAtMillis; }
    public Set<String> getBottleneckNodes() { return bottleneckNodes; }
    public List<Person> getPeople() { return people; }
    public List<Map<String, Double>> getDensityHistory() { return densityHistory; }
    public int getSpawned() { return spawned; }
    public int getExited() { return exited; }
    public List<Alert> getAlerts() { return alerts; }
    public List<String> getAdvisories() { return advisories; }
    public List<ReroutePath> getReroutes() { return reroutes; }
    public Map<String, Double> getPredictedRisk() { return predictedRisk; }
    public String getLatestAdvisory() { return latestAdvisory; }
    public String getAiStatus() { return aiStatus; }
    public AtomicBoolean getAnalyseInFlight() { return analyseInFlight; }
    public Map<String, Double> getLastAnalysedDensity() { return lastAnalysedDensity; }
    public int getLastAnalysedTick() { return lastAnalysedTick; }
    public Status getStatus() { return status; }
    public int getTick() { return tick; }
    public SessionState getLatestState() { return latestState; }

    public void setBaselineSessionId(String id) { this.baselineSessionId = id; }

    /** Stamps the finish time the first time a terminal status is set, for the eviction sweep. */
    public void setStatus(Status status) {
        this.status = status;
        if ((status == Status.STOPPED || status == Status.COMPLETED) && finishedAtMillis == 0) {
            finishedAtMillis = System.currentTimeMillis();
        }
    }

    /** Appends to a feed, dropping the oldest entries once it is over {@link #MAX_FEED}. */
    private static <T> void append(List<T> feed, T item) {
        feed.add(item);
        while (feed.size() > MAX_FEED) {
            feed.remove(0);
        }
    }

    /**
     * Records an alert only when the node's severity actually changed.
     *
     * @return true if it was recorded — the caller uses that to decide whether to reroute
     */
    public boolean addAlertIfChanged(Alert alert) {
        if (lastSeverity.put(alert.nodeId(), alert.severity()) == alert.severity()) {
            return false;
        }
        append(alerts, alert);
        if (alert.severity() == Alert.Severity.CRITICAL) {
            bottleneckNodes.add(alert.nodeId());
        }
        return true;
    }

    /** Forgets a node's severity once it is back to OK, so a later jam alerts again. */
    public void clearSeverity(String nodeId) {
        lastSeverity.remove(nodeId);
    }

    public void addAdvisory(String advisory) { append(advisories, advisory); }

    public void addReroutes(List<ReroutePath> paths) { paths.forEach(path -> append(reroutes, path)); }
    public void setTick(int tick) { this.tick = tick; }
    public void setLatestState(SessionState state) { this.latestState = state; }
    public void setPredictedRisk(Map<String, Double> risk) { this.predictedRisk = risk; }
    public void setLatestAdvisory(String advisory) { this.latestAdvisory = advisory; }
    public void setAiStatus(String aiStatus) { this.aiStatus = aiStatus; }
    public void setLastAnalysed(Map<String, Double> density, int tick) {
        this.lastAnalysedDensity = density;
        this.lastAnalysedTick = tick;
    }

    public void recordSpawned(int count) { this.spawned += count; }
    public void recordExited(int count) { this.exited += count; }

    public double getPeakDensity() { return peakDensity; }
    public int getCriticalNodeTicks() { return criticalNodeTicks; }

    /** Folds one tick's densities into the running safety totals. */
    public void recordDensities(Map<String, Double> densities, double criticalThreshold) {
        for (double density : densities.values()) {
            if (density > peakDensity) {
                peakDensity = density;
            }
            if (density >= criticalThreshold) {
                criticalNodeTicks++;
            }
        }
    }

    /** How many more people may still enter, given the crowd size the organiser asked for. */
    public int remainingToSpawn() { return Math.max(0, crowdSize - spawned); }
}
