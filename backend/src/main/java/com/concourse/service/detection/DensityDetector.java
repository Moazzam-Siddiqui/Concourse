package com.concourse.service.detection;

import com.concourse.dto.NodeState;
import com.concourse.dto.SimulationState;
import com.concourse.model.Alert;
import com.concourse.model.Session;
import com.concourse.model.SimulationRun;
import com.concourse.model.Venue;
import com.concourse.model.VenueNode;
import com.concourse.service.simulation.SimulationEngine;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Flags nodes that are over threshold, and says whether they are getting worse.
 * Trend is the slope of density across the last {@code simulation.trend-window} ticks —
 * a node sitting at 0.8 and falling is far less interesting than one at 0.72 and climbing.
 *
 * <p>Also decides <em>when the AI layer is worth calling</em>. At 10 ticks a second, asking
 * FastAPI (and through it two Hugging Face endpoints) every tick would be both useless and
 * rude: the graph barely changes between frames. {@link #shouldAnalyse} gates the call on a
 * meaningful change instead — see that method for what counts as meaningful.
 */
@Component
public class DensityDetector {

    private final double warningThreshold;
    private final double criticalThreshold;
    private final int trendWindow;
    private final double analyseDelta;
    private final int analyseMinTicks;

    @Autowired
    public DensityDetector(@Value("${simulation.warning-threshold:0.70}") double warningThreshold,
                           @Value("${simulation.critical-threshold:0.85}") double criticalThreshold,
                           @Value("${simulation.trend-window:5}") int trendWindow,
                           @Value("${session.analyse-density-delta:0.10}") double analyseDelta,
                           @Value("${session.analyse-min-ticks:20}") int analyseMinTicks) {
        this.warningThreshold = warningThreshold;
        this.criticalThreshold = criticalThreshold;
        this.trendWindow = trendWindow;
        this.analyseDelta = analyseDelta;
        this.analyseMinTicks = analyseMinTicks;
    }

    /** Defaults for the AI gate, for tests and callers that only care about detection. */
    public DensityDetector(double warningThreshold, double criticalThreshold, int trendWindow) {
        this(warningThreshold, criticalThreshold, trendWindow, 0.10, 20);
    }

    /** Alerts for the run's current tick. One per node that is at or above the warning threshold. */
    public List<Alert> detect(Venue venue, SimulationRun run) {
        int tick = run.getCurrentTick();
        Map<String, Double> now = SimulationEngine.densities(venue, run.occupancyAt(tick));

        List<Alert> alerts = new ArrayList<>();
        for (VenueNode node : venue.nodes()) {
            double density = now.getOrDefault(node.id(), 0.0);
            Alert.Severity severity = severityOf(density);
            if (severity == Alert.Severity.OK) {
                continue;
            }
            Alert.Trend trend = trendOf(venue, run, node.id());
            alerts.add(new Alert(
                    "alert-" + UUID.randomUUID().toString().substring(0, 8),
                    tick,
                    node.id(),
                    severity,
                    round(density),
                    trend,
                    "%s at %d%% capacity and %s".formatted(node.name(), Math.round(density * 100), verb(trend))));
        }
        return alerts;
    }

    /** The frame served by GET /state and pushed over the WebSocket. */
    public SimulationState stateOf(Venue venue, SimulationRun run, int tick) {
        Map<String, Integer> occupancy = run.occupancyAt(tick);
        List<NodeState> nodes = venue.nodes().stream()
                .map(node -> {
                    int people = occupancy.getOrDefault(node.id(), 0);
                    double density = (double) people / node.capacity();
                    return new NodeState(node.id(), people, node.capacity(), round(density), severityOf(density));
                })
                .toList();
        return new SimulationState(run.getId(), run.getVenueId(), tick, run.getTotalTicks(),
                run.getStatus().name(), nodes);
    }

    public Alert.Severity severityOf(double density) {
        if (density >= criticalThreshold) {
            return Alert.Severity.CRITICAL;
        }
        return density >= warningThreshold ? Alert.Severity.WARNING : Alert.Severity.OK;
    }

    /** Compares current density against the density {@code trendWindow} ticks ago. */
    public Alert.Trend trendOf(Venue venue, SimulationRun run, String nodeId) {
        int tick = run.getCurrentTick();
        int past = Math.max(0, tick - trendWindow);
        if (past == tick) {
            return Alert.Trend.FLAT;
        }
        double delta = densityAt(venue, run, nodeId, tick) - densityAt(venue, run, nodeId, past);
        if (delta > 0.03) {
            return Alert.Trend.RISING;
        }
        return delta < -0.03 ? Alert.Trend.FALLING : Alert.Trend.FLAT;
    }

    private double densityAt(Venue venue, SimulationRun run, String nodeId, int tick) {
        int capacity = venue.nodesById().get(nodeId).capacity();
        return (double) run.occupancyAt(tick).getOrDefault(nodeId, 0) / capacity;
    }

    private String verb(Alert.Trend trend) {
        return switch (trend) {
            case RISING -> "still filling";
            case FALLING -> "clearing";
            case FLAT -> "holding steady";
        };
    }

    private double round(double value) {
        return Math.round(value * 100) / 100.0;
    }

    // ================================================================================
    // Session-facing half — same thresholds, driven off Session's density history.
    // ================================================================================

    /**
     * Density per node from the simulated agents alone.
     *
     * <p>This is the one the before/after comparison is defined on — see
     * {@code Session.occupancy()}. Everything an operator looks at uses {@link #liveDensitiesOf}.
     */
    public Map<String, Double> densitiesOf(Session session) {
        return densitiesFrom(session, session.occupancy());
    }

    /** Density per node including real attendees reporting position from a phone. */
    public Map<String, Double> liveDensitiesOf(Session session) {
        return densitiesFrom(session, session.liveOccupancy());
    }

    private Map<String, Double> densitiesFrom(Session session, Map<String, Integer> occupancy) {
        Map<String, Double> densities = new LinkedHashMap<>();
        for (VenueNode node : session.getVenue().nodes()) {
            densities.put(node.id(), round((double) occupancy.getOrDefault(node.id(), 0) / node.capacity()));
        }
        return densities;
    }

    /**
     * Per-node trend over the session's recent history. A node missing from the window (too
     * early in the run) reads FLAT rather than guessing.
     */
    public Map<String, Alert.Trend> trendsOf(Session session, Map<String, Double> now) {
        List<Map<String, Double>> history = session.getDensityHistory();
        Map<String, Alert.Trend> trends = new LinkedHashMap<>();
        if (history.size() <= 1) {
            now.keySet().forEach(nodeId -> trends.put(nodeId, Alert.Trend.FLAT));
            return trends;
        }
        Map<String, Double> then = history.get(Math.max(0, history.size() - 1 - trendWindow));
        now.forEach((nodeId, density) -> {
            double delta = density - then.getOrDefault(nodeId, 0.0);
            trends.put(nodeId, delta > 0.03 ? Alert.Trend.RISING
                    : delta < -0.03 ? Alert.Trend.FALLING : Alert.Trend.FLAT);
        });
        return trends;
    }

    /** One alert per node at or above the warning threshold, for the session's current tick. */
    public List<Alert> detectSession(Session session, Map<String, Double> densities,
                                     Map<String, Alert.Trend> trends) {
        List<Alert> alerts = new ArrayList<>();
        for (VenueNode node : session.getVenue().nodes()) {
            double density = densities.getOrDefault(node.id(), 0.0);
            Alert.Severity severity = severityOf(density);
            if (severity == Alert.Severity.OK) {
                continue;
            }
            Alert.Trend trend = trends.getOrDefault(node.id(), Alert.Trend.FLAT);
            alerts.add(new Alert(
                    "alert-" + UUID.randomUUID().toString().substring(0, 8),
                    session.getTick(),
                    node.id(),
                    severity,
                    round(density),
                    trend,
                    "%s at %d%% capacity and %s".formatted(
                            node.name(), Math.round(density * 100), verb(trend))));
        }
        return alerts;
    }

    /**
     * Whether this tick is worth sending to the AI layer.
     *
     * <p>Three ways to qualify, all cheap to evaluate:
     * <ol>
     *   <li>nothing has been analysed yet and there is actually a crowd to analyse;</li>
     *   <li>some node has moved by {@code session.analyse-density-delta} since the last call;</li>
     *   <li>some node has crossed a severity band (OK → WARNING → CRITICAL, or back) since the
     *       last call — a 0.69 → 0.71 move is small but it is the one that matters.</li>
     * </ol>
     *
     * <p>All three are floored by {@code session.analyse-min-ticks}, so a violently churning
     * venue still cannot fire more often than that. Without the floor, a crowd oscillating
     * around the warning line would call two Hugging Face endpoints ten times a second.
     */
    public boolean shouldAnalyse(Session session, Map<String, Double> densities) {
        Map<String, Double> previous = session.getLastAnalysedDensity();
        // "Never analysed" is checked before the interval arithmetic, not after: the sentinel
        // tick is Integer.MIN_VALUE and (tick - MIN_VALUE) overflows to a negative number,
        // which silently reads as "too soon" and means the AI layer is never called at all.
        if (previous.isEmpty()) {
            return densities.values().stream().anyMatch(density -> density > 0);
        }
        if (session.getTick() - session.getLastAnalysedTick() < analyseMinTicks) {
            return false;
        }
        for (Map.Entry<String, Double> entry : densities.entrySet()) {
            double before = previous.getOrDefault(entry.getKey(), 0.0);
            double after = entry.getValue();
            if (Math.abs(after - before) >= analyseDelta || severityOf(after) != severityOf(before)) {
                return true;
            }
        }
        return false;
    }

    /**
     * The zones an operator should be looking at: anything already over threshold, plus
     * anything the AI layer predicts will be. Worst first, capped so the advisory prompt
     * stays about the venue rather than listing it.
     */
    public List<String> highRiskNodes(Map<String, Double> densities, Map<String, Double> predictedRisk) {
        return densities.entrySet().stream()
                .map(entry -> Map.entry(entry.getKey(),
                        Math.max(entry.getValue(), predictedRisk.getOrDefault(entry.getKey(), 0.0))))
                .filter(entry -> entry.getValue() >= warningThreshold)
                .sorted(Map.Entry.<String, Double>comparingByValue(Comparator.reverseOrder()))
                .limit(5)
                .map(Map.Entry::getKey)
                .toList();
    }
}
