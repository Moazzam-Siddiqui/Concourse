package com.concourse.model;

import java.util.ArrayList;
import java.util.List;

/**
 * One simulated attendee moving through the venue graph under the social force model.
 *
 * <p>Mutated in place by the session tick loop and read back as an immutable snapshot by
 * {@code StateBroadcaster}. Only the tick thread ever writes a Person, so there is
 * deliberately no synchronisation here — adding it would cost real time at 10 Hz across
 * thousands of agents and buy nothing.
 */
public class Person {

    /** Families move slower and cluster; solo attendees move at full speed. */
    public enum Type { SOLO, FAMILY }

    private final String id;
    private final Type type;
    private final double desiredSpeed;
    private final double radius;

    private double x;
    private double y;
    private double vx;
    private double vy;

    /** The node this person is counted against for density. Set on arrival, not in transit. */
    private String currentNodeId;

    /** Remaining waypoints after {@link #currentNodeId}; the last entry is {@link #goalNodeId}. */
    private List<String> route = new ArrayList<>();

    /** How many times this person has been diverted — the UI tints rerouted agents. */
    private int rerouteCount;

    private boolean arrived;

    /**
     * The places this person still intends to visit, in order, after the current goal.
     *
     * <p>This is what makes a crowd a crowd rather than a queue. Previously every agent was
     * routed gate → nearest exit on spawn, so the venue only ever showed people traversing it:
     * seating filled and emptied at walking pace, concessions saw traffic only if they happened
     * to sit on someone's shortest path, and the density map was really a map of the shortest
     * path out. Real attendees arrive, go somewhere, *stay there*, and leave later — and the
     * congestion that matters is produced by that staying, and by everyone leaving at once.
     */
    private final List<String> itinerary = new ArrayList<>();

    /**
     * Ticks left to linger at the current stop before moving on. Zero means "keep walking".
     *
     * <p>Held as a countdown rather than an absolute tick so a paused session does not have
     * everyone's dwell expire the moment it resumes.
     */
    private int dwellTicksRemaining;

    /** True once this person has started for an exit and will not stop anywhere else. */
    private boolean leaving;

    public Person(String id, Type type, double desiredSpeed, double radius,
                  double x, double y, String currentNodeId) {
        this.id = id;
        this.type = type;
        this.desiredSpeed = desiredSpeed;
        this.radius = radius;
        this.x = x;
        this.y = y;
        this.currentNodeId = currentNodeId;
    }

    /** Where this person is ultimately heading — the end of the route, or here if unrouted. */
    public String goalNodeId() {
        return route.isEmpty() ? currentNodeId : route.get(route.size() - 1);
    }

    /** The node this person is walking toward right now, or null when the route is spent. */
    public String nextWaypoint() {
        return route.isEmpty() ? null : route.get(0);
    }

    /** Called when the person enters the next waypoint's radius. */
    public void advanceWaypoint() {
        if (!route.isEmpty()) {
            currentNodeId = route.remove(0);
        }
    }

    public String getId() { return id; }
    public Type getType() { return type; }
    public double getDesiredSpeed() { return desiredSpeed; }
    public double getRadius() { return radius; }
    public double getX() { return x; }
    public double getY() { return y; }
    public double getVx() { return vx; }
    public double getVy() { return vy; }
    public String getCurrentNodeId() { return currentNodeId; }
    public List<String> getRoute() { return route; }
    public int getRerouteCount() { return rerouteCount; }
    public boolean isArrived() { return arrived; }

    public void setPosition(double x, double y) { this.x = x; this.y = y; }
    public void setVelocity(double vx, double vy) { this.vx = vx; this.vy = vy; }
    public void setArrived(boolean arrived) { this.arrived = arrived; }

    /** Replaces the remaining path; used by the route engine when a node ahead congests. */
    public void reroute(List<String> newRoute) {
        this.route = new ArrayList<>(newRoute);
        this.rerouteCount++;
    }

    /** Initial route assignment — does not count as a reroute. */
    public void setRoute(List<String> newRoute) {
        this.route = new ArrayList<>(newRoute);
    }

    /* ---- itinerary ------------------------------------------------------- */

    public List<String> getItinerary() { return itinerary; }
    public boolean isLeaving() { return leaving; }
    public void setLeaving(boolean leaving) { this.leaving = leaving; }

    /** Queues the stops this person means to visit, in order. Replaces any existing plan. */
    public void setItinerary(List<String> stops) {
        itinerary.clear();
        itinerary.addAll(stops);
    }

    /** The next place to head for once the current dwell finishes, or null when done. */
    public String popNextStop() {
        return itinerary.isEmpty() ? null : itinerary.remove(0);
    }

    public boolean isDwelling() { return dwellTicksRemaining > 0; }
    public int getDwellTicksRemaining() { return dwellTicksRemaining; }
    public void startDwell(int ticks) { this.dwellTicksRemaining = Math.max(0, ticks); }

    /** Counts one tick off the dwell. Returns true on the tick it finishes. */
    public boolean tickDwell() {
        if (dwellTicksRemaining <= 0) {
            return false;
        }
        dwellTicksRemaining--;
        return dwellTicksRemaining == 0;
    }

    /** True when the route is spent and there is nowhere left to go. */
    public boolean isIdle() {
        return route.isEmpty() && itinerary.isEmpty() && dwellTicksRemaining <= 0;
    }
}
