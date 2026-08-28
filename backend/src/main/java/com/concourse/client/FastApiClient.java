package com.concourse.client;

import com.concourse.config.MlServiceConfig;
import com.concourse.dto.AnalyzeRequest;
import com.concourse.dto.AnalyzeResponse;
import com.concourse.model.Alert;
import com.concourse.model.Session;
import com.concourse.model.Venue;
import com.concourse.model.VenueEdge;
import jakarta.annotation.PreDestroy;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.ArrayBlockingQueue;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

/**
 * Calls the FastAPI AI layer's {@code POST /analyze} with the venue graph, current density,
 * recent history and run context, and gets predicted risk plus a human-readable advisory back.
 *
 * <p><b>Always off the tick thread.</b> A session ticks every 100 ms; this call fans out to
 * two Hugging Face endpoints and can take seconds. Running it inline would stall the
 * simulation for every viewer, so {@link #analyseAsync} hands it to a small executor and the
 * result lands on the {@link Session} for the next broadcast to pick up. One call per session
 * at a time — if a tick asks while one is in flight, the ask is dropped, not queued.
 */
@Component
public class FastApiClient {

    private static final Logger log = LoggerFactory.getLogger(FastApiClient.class);

    /** How many density snapshots of context the AI layer gets. Enough for a trajectory. */
    private static final int HISTORY_FRAMES = 12;

    private final RestClient restClient;
    private final MlServiceConfig config;

    /**
     * Bounded pool with a bounded queue, and a rejection policy that drops rather than blocks.
     *
     * <p>This used to be {@code Executors.newFixedThreadPool(2)}, which sounds bounded and is
     * not: that factory pairs the two threads with an <em>unbounded</em> LinkedBlockingQueue.
     * Two threads cap concurrency against the AI service, but nothing capped the backlog, so a
     * burst of sessions ticking faster than the service answers grew the queue without limit.
     * The visible failure is not an error — it is the advisory arriving minutes late, computed
     * from densities that stopped being true, while the heap fills with queued snapshots.
     *
     * <p>A bounded queue converts that into an honest, immediate signal. {@code DiscardOldest}
     * is the right policy for this data specifically: every task carries a snapshot of current
     * density, so when the service cannot keep up, the freshest snapshot is the one worth
     * keeping and the stale one at the head of the queue is the one worth losing. Blocking the
     * caller would stall the simulation tick, and blocking the tick to talk to an optional
     * subsystem is exactly what the fallback contract exists to prevent.
     */
    private final ExecutorService executor = new ThreadPoolExecutor(
            2, 2,
            0L, TimeUnit.MILLISECONDS,
            new ArrayBlockingQueue<>(64),
            runnable -> {
                Thread thread = new Thread(runnable, "fastapi-analyse");
                thread.setDaemon(true);
                return thread;
            },
            new ThreadPoolExecutor.DiscardOldestPolicy());

    public FastApiClient(RestClient analyzeRestClient, MlServiceConfig config) {
        this.restClient = analyzeRestClient;
        this.config = config;
    }

    /**
     * Fires an analyse for this session unless one is already running.
     *
     * <p>Never throws and never leaves the in-flight flag set: a session whose AI layer is
     * down keeps simulating and keeps broadcasting raw density, which is the whole point of
     * the fallback contract.
     */
    public void analyseAsync(Session session, Map<String, Double> densities,
                             Map<String, Alert.Trend> trends, List<String> highRiskNodeIds) {
        if (config.isMockEnabled()) {
            session.setAiStatus("disabled (ml-service.mock-enabled)");
            // Still record the snapshot, so the detector's gate behaves identically whether or
            // not the AI layer is switched on. Otherwise "never analysed" stays true forever
            // and the gate fires on every single tick.
            session.setLastAnalysed(Map.copyOf(densities), session.getTick());
            return;
        }
        if (!session.getAnalyseInFlight().compareAndSet(false, true)) {
            return; // previous call still out; skip this one rather than pile up
        }

        AnalyzeRequest request = buildRequest(session, densities, trends, highRiskNodeIds);
        int tick = session.getTick();
        session.setLastAnalysed(Map.copyOf(densities), tick);
        // A dead endpoint takes several seconds to exhaust its retries. Say so, rather than
        // leaving "not-yet-called" on screen as if nothing had been attempted.
        session.setAiStatus("calling (tick " + tick + ")");

        executor.execute(() -> {
            try {
                AnalyzeResponse response = restClient.post()
                        .uri(config.analyzeUrl())
                        .contentType(MediaType.APPLICATION_JSON)
                        .body(request)
                        .retrieve()
                        .body(AnalyzeResponse.class);
                apply(session, response, tick);
            } catch (RuntimeException e) {
                // ml-service down, unreachable, or answering 5xx. The session carries on with
                // measured density and no prediction — degraded, not broken.
                log.warn("analyse failed for session {} at tick {}: {}",
                        session.getId(), tick, e.toString());
                session.setAiStatus("unavailable: " + e.getClass().getSimpleName());
            } finally {
                session.getAnalyseInFlight().set(false);
            }
        });
    }

    /**
     * Takes whatever came back. A {@code partial} response means one Hugging Face call failed
     * and the other did not, so each half is applied independently — losing the advisory must
     * not cost us the risk numbers, and vice versa.
     */
    private void apply(Session session, AnalyzeResponse response, int tick) {
        if (response == null) {
            session.setAiStatus("empty response");
            return;
        }
        if (response.hasPredictions()) {
            Map<String, Double> risk = new LinkedHashMap<>();
            response.predictions().forEach(p -> risk.put(p.nodeId(), clamp(p.risk())));
            session.setPredictedRisk(risk);
        }
        if (response.hasAdvisory()) {
            session.setLatestAdvisory(response.advisory().message().trim());
            session.addAdvisory("t%d · %s".formatted(tick, response.advisory().message().trim()));
        }

        String status = response.status() == null ? "unknown" : response.status();
        // Name the model that answered, not just that something did. The AI layer has three
        // paths — hosted, in-process GNN, linear fallback — and "ok" looks identical for all
        // three, so without this the one thing an operator most wants to know is invisible.
        String model = modelName(response);
        if (response.errors() != null && !response.errors().isEmpty()) {
            String stages = response.errors().stream()
                    .map(AnalyzeResponse.AnalyzeError::stage).distinct().reduce((a, b) -> a + "," + b).orElse("");
            session.setAiStatus(status + " · " + model + " (" + stages + " unavailable)");
            log.info("analyse {} for session {}: {}", status, session.getId(), response.errors());
        } else {
            session.setAiStatus(status + " · " + model);
        }
    }

    /** Shortens what /analyze reported into something that fits a status line. */
    private String modelName(AnalyzeResponse response) {
        if (response.modelInfo() == null || response.modelInfo().gnn() == null) {
            return "unknown model";
        }
        String gnn = response.modelInfo().gnn();
        // The in-process path reports "congestion-gnn (huggingface hub: owner/repo)"; the URL
        // is not useful on a status badge, the fact that it is the real model is.
        int detail = gnn.indexOf(" (");
        return detail > 0 ? gnn.substring(0, detail) : gnn;
    }

    /** Builds the {graph, density, history, context} body. See {@link AnalyzeRequest}. */
    private AnalyzeRequest buildRequest(Session session, Map<String, Double> densities,
                                        Map<String, Alert.Trend> trends, List<String> highRiskNodeIds) {
        Venue venue = session.getVenue();

        List<AnalyzeRequest.Node> nodes = venue.nodes().stream()
                .map(n -> new AnalyzeRequest.Node(n.id(), n.name(), n.type().name(), n.capacity(), n.x(), n.y()))
                .toList();

        List<AnalyzeRequest.Edge> edges = new ArrayList<>();
        for (VenueEdge edge : venue.edges()) {
            edges.add(new AnalyzeRequest.Edge(edge.from(), edge.to(), edge.length(), edge.width()));
            if (edge.bidirectional()) {
                edges.add(new AnalyzeRequest.Edge(edge.to(), edge.from(), edge.length(), edge.width()));
            }
        }

        List<Map<String, Double>> history = session.getDensityHistory();
        List<AnalyzeRequest.HistoryFrame> frames = new ArrayList<>();
        int firstFrame = Math.max(0, history.size() - HISTORY_FRAMES);
        int firstTick = session.getTick() - (history.size() - 1 - firstFrame);
        for (int i = firstFrame; i < history.size(); i++) {
            frames.add(new AnalyzeRequest.HistoryFrame(firstTick + (i - firstFrame), history.get(i)));
        }

        Map<String, String> trendNames = new LinkedHashMap<>();
        trends.forEach((nodeId, trend) -> trendNames.put(nodeId, trend.name()));

        AnalyzeRequest.Context context = new AnalyzeRequest.Context(
                venue.name(),
                session.getTickSeconds(),
                session.getCrowdSize(),
                session.getPeople().size(),
                session.remainingToSpawn(),
                session.getStatus().name(),
                session.isRerouteEnabled(),
                trendNames,
                highRiskNodeIds);

        return new AnalyzeRequest(session.getId(), session.getTick(),
                new AnalyzeRequest.Graph(nodes, edges), Map.copyOf(densities), frames, context);
    }

    private double clamp(double value) {
        return Math.max(0.0, Math.min(1.0, value));
    }

    @PreDestroy
    void shutdown() {
        executor.shutdown();
        try {
            if (!executor.awaitTermination(2, TimeUnit.SECONDS)) {
                executor.shutdownNow();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            executor.shutdownNow();
        }
    }
}
