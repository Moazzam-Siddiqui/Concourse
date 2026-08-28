package com.concourse.service.detection;

import com.concourse.config.MlServiceConfig;
import com.concourse.model.Alert;
import com.concourse.model.Venue;
import com.concourse.model.VenueEdge;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Calls the self-hosted ml-service for congestion propagation: given the current density of
 * every node, predict the risk each node carries a few ticks ahead.
 *
 * <p>Falls back to a one-hop diffusion mock whenever {@code ml-service.mock-enabled} is set
 * or the call fails — service down, or up but the GNN checkpoint is missing, which
 * ml-service answers with a 503. Local dev and the demo never block on the model being up.
 */
@Component
public class GnnRiskClient {

    private static final Logger log = LoggerFactory.getLogger(GnnRiskClient.class);

    private final RestClient restClient;
    private final MlServiceConfig config;

    public GnnRiskClient(RestClient mlServiceRestClient, MlServiceConfig config) {
        this.restClient = mlServiceRestClient;
        this.config = config;
    }

    /**
     * nodeId -> predicted risk in [0,1] for the next few ticks.
     *
     * @param trends per-node trend from {@link DensityDetector}; a node missing from the map
     *               is treated as FLAT
     */
    @SuppressWarnings("unchecked")
    public Map<String, Double> predictRisk(Venue venue, Map<String, Double> densities,
                                           Map<String, Alert.Trend> trends) {
        if (config.isMockEnabled()) {
            return mockRisk(venue, densities);
        }
        try {
            Map<String, Object> response = restClient.post()
                    .uri(config.riskUrl())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(payload(venue, densities, trends))
                    .retrieve()
                    .body(Map.class);

            Object risks = response == null ? null : response.get("risk");
            if (risks instanceof Map<?, ?> map) {
                Map<String, Double> result = new LinkedHashMap<>();
                map.forEach((k, v) -> result.put(String.valueOf(k), ((Number) v).doubleValue()));
                return result;
            }
            log.warn("ml-service returned an unexpected shape for /predict/risk, using mock risk");
        } catch (RuntimeException e) {
            // Covers both "service not running" and 503 "model not loaded".
            log.warn("GNN inference failed ({}), using mock risk", e.getMessage());
        }
        return mockRisk(venue, densities);
    }

    /** The {nodes, edges} body ml-service expects. See ml-service/app/schemas/risk_schema.py. */
    private Map<String, Object> payload(Venue venue, Map<String, Double> densities,
                                        Map<String, Alert.Trend> trends) {
        List<Map<String, Object>> nodes = venue.nodes().stream()
                .map(node -> Map.<String, Object>of(
                        "id", node.id(),
                        "density", densities.getOrDefault(node.id(), 0.0),
                        "trend", trends.getOrDefault(node.id(), Alert.Trend.FLAT).name()))
                .toList();

        List<Map<String, String>> edges = new ArrayList<>();
        for (VenueEdge edge : venue.edges()) {
            edges.add(Map.of("source", edge.from(), "target", edge.to()));
            if (edge.bidirectional()) {
                edges.add(Map.of("source", edge.to(), "target", edge.from()));
            }
        }
        return Map.of("nodes", nodes, "edges", edges);
    }

    /**
     * Mock: risk is mostly a node's own density plus a share of its worst neighbour's —
     * the same intuition the GNN should learn, just without the learning.
     */
    private Map<String, Double> mockRisk(Venue venue, Map<String, Double> densities) {
        Map<String, List<VenueEdge>> adjacency = venue.adjacency();
        Map<String, Double> risk = new LinkedHashMap<>();
        venue.nodes().forEach(node -> {
            double own = densities.getOrDefault(node.id(), 0.0);
            double worstNeighbour = adjacency.getOrDefault(node.id(), List.of()).stream()
                    .mapToDouble(e -> densities.getOrDefault(e.to(), 0.0))
                    .max()
                    .orElse(0.0);
            risk.put(node.id(), Math.min(1.0, 0.65 * own + 0.35 * worstNeighbour));
        });
        return risk;
    }
}
