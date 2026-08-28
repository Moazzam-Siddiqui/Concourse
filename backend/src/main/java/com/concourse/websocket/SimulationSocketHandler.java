package com.concourse.websocket;

import com.concourse.dto.SimulationState;
import com.concourse.model.Alert;
import com.concourse.model.ReroutePath;
import com.concourse.model.SimulationRun;
import com.concourse.model.Venue;
import com.concourse.repository.SimulationRepository;
import com.concourse.repository.VenueRepository;
import com.concourse.service.advisory.AdvisoryService;
import com.concourse.service.detection.DensityDetector;
import com.concourse.service.detection.GnnRiskClient;
import com.concourse.service.routing.RerouteEngine;
import com.concourse.service.simulation.SimulationEngine;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;
import org.springframework.web.socket.CloseStatus;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.config.annotation.EnableWebSocket;
import org.springframework.web.socket.config.annotation.WebSocketConfigurer;
import org.springframework.web.socket.config.annotation.WebSocketHandlerRegistry;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * Live channel at {@code /simulations/{id}/stream}, and the clock that drives every
 * running simulation: one scheduled tick advances each run, re-runs detection, and pushes
 * the new state to whoever is watching that run.
 *
 * <p>Registers itself as its own {@link WebSocketConfigurer} — the stream is the only
 * socket in the app, so a separate config class would be one file of pure ceremony.
 */
@Component
@EnableWebSocket
public class SimulationSocketHandler extends TextWebSocketHandler implements WebSocketConfigurer {

    private static final Logger log = LoggerFactory.getLogger(SimulationSocketHandler.class);

    private final Map<String, Set<WebSocketSession>> watchers = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final SimulationRepository simulations;
    private final VenueRepository venues;
    private final SimulationEngine engine;
    private final DensityDetector detector;
    private final GnnRiskClient gnnRiskClient;
    private final RerouteEngine rerouteEngine;
    private final AdvisoryService advisoryService;

    public SimulationSocketHandler(SimulationRepository simulations, VenueRepository venues,
                                   SimulationEngine engine, DensityDetector detector,
                                   GnnRiskClient gnnRiskClient, RerouteEngine rerouteEngine,
                                   AdvisoryService advisoryService) {
        this.simulations = simulations;
        this.venues = venues;
        this.engine = engine;
        this.detector = detector;
        this.gnnRiskClient = gnnRiskClient;
        this.rerouteEngine = rerouteEngine;
        this.advisoryService = advisoryService;
    }

    @Override
    public void registerWebSocketHandlers(WebSocketHandlerRegistry registry) {
        registry.addHandler(this, "/simulations/*/stream").setAllowedOriginPatterns("*");
    }

    @Override
    public void afterConnectionEstablished(WebSocketSession session) {
        String id = simulationIdOf(session);
        watchers.computeIfAbsent(id, k -> ConcurrentHashMap.newKeySet()).add(session);
        // Send the current frame straight away so the map is never blank.
        simulations.findById(id)
                .flatMap(run -> venues.findById(run.getVenueId())
                        .map(venue -> detector.stateOf(venue, run, run.getCurrentTick())))
                .ifPresent(state -> send(session, state));
    }

    @Override
    public void afterConnectionClosed(WebSocketSession session, CloseStatus status) {
        watchers.getOrDefault(simulationIdOf(session), Set.of()).remove(session);
    }

    /** One tick for every running simulation. Interval comes from {@code simulation.tick-interval-ms}. */
    @Scheduled(fixedDelayString = "${simulation.tick-interval-ms:500}")
    public void tick() {
        for (SimulationRun run : simulations.findAll()) {
            if (run.getStatus() != SimulationRun.Status.RUNNING) {
                continue;
            }
            venues.findById(run.getVenueId()).ifPresent(venue -> advance(venue, run));
        }
    }

    private void advance(Venue venue, SimulationRun run) {
        Map<String, Double> densities = engine.advanceTick(venue, run);

        if (!run.isShadow()) {
            // Predicted risk is not shown yet — it will drive the "next 3 minutes" overlay.
            Map<String, Alert.Trend> trends = new HashMap<>();
            venue.nodes().forEach(node -> trends.put(node.id(), detector.trendOf(venue, run, node.id())));
            Map<String, Double> risk = gnnRiskClient.predictRisk(venue, densities, trends);
            log.debug("run {} tick {} peak risk {}", run.getId(), run.getCurrentTick(),
                    risk.values().stream().mapToDouble(Double::doubleValue).max().orElse(0));

            recordNewAlerts(venue, run);
            broadcast(run.getId(), detector.stateOf(venue, run, run.getCurrentTick()));
        }
    }

    /** Only records an alert when a node's severity actually changes — otherwise the feed floods. */
    private void recordNewAlerts(Venue venue, SimulationRun run) {
        List<Alert> current = detector.detect(venue, run);
        Set<String> alerting = ConcurrentHashMap.newKeySet();

        for (Alert alert : current) {
            alerting.add(alert.nodeId());
            if (run.getLastSeverity().put(alert.nodeId(), alert.severity()) == alert.severity()) {
                continue;
            }
            run.getAlerts().add(alert);
            ReroutePath reroute = rerouteEngine.findReroute(venue, alert.nodeId(), run.getOccupancy());
            run.getAdvisories().add(advisoryService.generate(venue, alert, reroute));
        }
        run.getLastSeverity().keySet().removeIf(nodeId -> !alerting.contains(nodeId));
    }

    private void broadcast(String simulationId, SimulationState state) {
        for (WebSocketSession session : watchers.getOrDefault(simulationId, Set.of())) {
            send(session, state);
        }
    }

    private void send(WebSocketSession session, SimulationState state) {
        if (!session.isOpen()) {
            return;
        }
        try {
            session.sendMessage(new TextMessage(objectMapper.writeValueAsString(state)));
        } catch (IOException e) {
            log.debug("Dropping watcher {}: {}", session.getId(), e.getMessage());
        }
    }

    /** /simulations/{id}/stream -> {id} */
    private String simulationIdOf(WebSocketSession session) {
        String[] parts = session.getUri().getPath().split("/");
        return parts.length >= 3 ? parts[2] : "";
    }
}
