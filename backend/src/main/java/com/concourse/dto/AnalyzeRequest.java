package com.concourse.dto;

import java.util.List;
import java.util.Map;

/**
 * Body of {@code POST /analyze} on the FastAPI AI layer. Mirrors
 * {@code ml-service/app/schemas/analyze_schema.py} — if you change one, change the other.
 *
 * @param density nodeId -> occupancy/capacity right now
 * @param history oldest-first density snapshots, so the GNN sees a trajectory rather than
 *                a single frame
 */
public record AnalyzeRequest(
        String sessionId,
        int tick,
        Graph graph,
        Map<String, Double> density,
        List<HistoryFrame> history,
        Context context) {

    public record Graph(List<Node> nodes, List<Edge> edges) {
    }

    public record Node(String id, String name, String type, int capacity, double x, double y) {
    }

    public record Edge(String source, String target, double length, double width) {
    }

    public record HistoryFrame(int tick, Map<String, Double> density) {
    }

    /**
     * Everything that is true of the run but not of the graph — what the LLM needs to write
     * an advisory a human can act on.
     *
     * @param trends nodeId -> RISING / FLAT / FALLING
     */
    public record Context(
            String venueName,
            double tickSeconds,
            int crowdSize,
            int peopleInside,
            int pendingArrivals,
            String status,
            boolean rerouteEnabled,
            Map<String, String> trends,
            List<String> highRiskNodeIds) {
    }
}
