package com.concourse.controller;

import com.concourse.config.MlServiceConfig;
import java.util.Map;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.client.RestClient;

/**
 * {@code GET /health} — is Spring up, and can it see the AI layer?
 *
 * <p>Reports {@code degraded} rather than failing when ml-service is unreachable: the
 * simulation runs perfectly well without it, just without predictions and prose.
 */
@RestController
public class HealthController {

    private final RestClient restClient;
    private final MlServiceConfig config;

    public HealthController(RestClient mlServiceRestClient, MlServiceConfig config) {
        this.restClient = mlServiceRestClient;
        this.config = config;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        return Map.of(
                "status", "ok",
                "mlService", Map.of(
                        "baseUrl", config.getBaseUrl(),
                        "mockEnabled", config.isMockEnabled(),
                        "reachable", mlServiceReachable()));
    }

    private boolean mlServiceReachable() {
        if (config.isMockEnabled()) {
            return false;
        }
        try {
            restClient.get().uri(config.healthUrl()).retrieve().body(String.class);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }
}
