package com.concourse.service.advisory;

import com.concourse.config.MlServiceConfig;
import com.concourse.dto.Advisory;
import com.concourse.model.Alert;
import com.concourse.model.ReroutePath;
import com.concourse.model.Venue;
import com.concourse.model.VenueNode;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.web.client.RestClient;

/**
 * Turns an alert plus its suggested reroute into one plain-language line an operator can act
 * on, via the self-hosted ml-service.
 *
 * <p>The prompt itself lives in ml-service (app/models/advisory_gen.py) alongside the model —
 * this side sends structured fields, not prose. Falls back to a template when
 * {@code ml-service.mock-enabled} is set or the call fails (service down, or up but the
 * model is not loaded, which ml-service answers with a 503).
 */
@Service
public class AdvisoryService {

    private static final Logger log = LoggerFactory.getLogger(AdvisoryService.class);

    private final RestClient restClient;
    private final MlServiceConfig config;

    public AdvisoryService(RestClient mlServiceRestClient, MlServiceConfig config) {
        this.restClient = mlServiceRestClient;
        this.config = config;
    }

    public Advisory generate(Venue venue, Alert alert, ReroutePath reroute) {
        VenueNode node = venue.nodesById().get(alert.nodeId());
        String name = node == null ? alert.nodeId() : node.name();
        String diversion = describeDiversion(venue, reroute);

        if (config.isMockEnabled()) {
            return new Advisory(alert.tick(), alert.nodeId(), template(name, alert, diversion));
        }

        try {
            Map<?, ?> response = restClient.post()
                    .uri(config.advisoryUrl())
                    .contentType(MediaType.APPLICATION_JSON)
                    .body(Map.of(
                            "node", name,
                            "density", alert.density(),
                            "trend", alert.trend().name(),
                            "reroutePath", reroute == null ? List.of() : reroute.path()))
                    .retrieve()
                    .body(Map.class);

            if (response != null && response.get("message") instanceof String message
                    && !message.isBlank()) {
                return new Advisory(alert.tick(), alert.nodeId(), message.trim());
            }
            log.warn("ml-service returned an unexpected shape for /generate/advisory, using template");
        } catch (RuntimeException e) {
            log.warn("Advisory generation failed ({}), using template", e.getMessage());
        }
        return new Advisory(alert.tick(), alert.nodeId(), template(name, alert, diversion));
    }

    private String template(String name, Alert alert, String diversion) {
        String urgency = alert.severity() == Alert.Severity.CRITICAL ? "Act now:" : "Heads up:";
        String movement = switch (alert.trend()) {
            case RISING -> "and still filling";
            case FALLING -> "but clearing";
            case FLAT -> "and holding";
        };
        return "%s %s is at %d%% capacity %s. %s".formatted(
                urgency, name, Math.round(alert.density() * 100), movement, diversion);
    }

    private String describeDiversion(Venue venue, ReroutePath reroute) {
        if (reroute == null || reroute.toNodeId() == null) {
            return "No clear alternative — hold intake at the gates.";
        }
        VenueNode target = venue.nodesById().get(reroute.toNodeId());
        return "Divert to %s.".formatted(target == null ? reroute.toNodeId() : target.name());
    }
}
