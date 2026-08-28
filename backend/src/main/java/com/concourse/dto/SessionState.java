package com.concourse.dto;

import com.concourse.model.Alert;
import com.concourse.model.ReroutePath;
import java.util.List;
import java.util.Map;

/**
 * One broadcast frame — everything a connected organiser or viewer needs to draw the map.
 * Immutable, built once per broadcast by {@code StateBroadcaster} and shared by every
 * watcher on the session.
 *
 * @param people      sampled agent positions; see StateBroadcaster for why this is capped
 * @param sampledFrom total people actually in the venue, so a client can tell it is seeing
 *                    a sample and scale its own counters accordingly
 */
public record SessionState(
        String sessionId,
        String venueId,
        int tick,
        double simulationSeconds,
        String status,
        List<PersonState> people,
        int sampledFrom,
        List<NodeDensity> nodes,
        List<Alert> alerts,
        List<ReroutePath> reroutes,
        Map<String, Double> predictedRisk,
        String advisory,
        String aiStatus,
        Metrics metrics) {

    /**
     * The same frame with agent positions dropped, for clients that never draw them.
     *
     * <p>{@code sampledFrom} is left alone on purpose: it is the true crowd size, not the size of
     * the list, so a client reading it still knows how many people are in the venue.
     */
    public SessionState withoutPeople() {
        return new SessionState(sessionId, venueId, tick, simulationSeconds, status,
                List.of(), sampledFrom, nodes, alerts, reroutes, predictedRisk, advisory,
                aiStatus, metrics);
    }

    /** @param rerouted true once this person has been diverted at least once */
    public record PersonState(String id, double x, double y, String nodeId, String type, boolean rerouted) {
    }

    public record NodeDensity(
            String nodeId,
            String name,
            int occupancy,
            int capacity,
            double density,
            Alert.Severity status,
            Alert.Trend trend,
            double predictedRisk) {
    }

    /**
     * @param criticalNodeTicks running total of zone-ticks spent above the critical
     *                          threshold — the headline safety number
     */
    public record Metrics(
            int peopleInside,
            int spawned,
            int exited,
            int pendingArrivals,
            double peakDensity,
            int criticalNodeTicks,
            int activeAlerts,
            int viewers,
            int realWalkers) {
    }
}
