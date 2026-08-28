package com.concourse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import com.concourse.dto.SessionInfo;
import com.concourse.dto.SessionState;
import com.concourse.dto.SessionSummary;
import com.concourse.service.session.SessionManager;
import com.concourse.service.simulation.SimulationEngine;
import com.concourse.model.Alert;
import com.concourse.model.Person;
import com.concourse.model.Session;
import com.concourse.model.Venue;
import com.concourse.model.VenueEdge;
import com.concourse.model.VenueNode;
import com.concourse.service.detection.DensityDetector;
import com.concourse.service.simulation.SocialForceModel;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.websocket.ContainerProvider;
import jakarta.websocket.WebSocketContainer;
import java.net.URI;
import java.time.Duration;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CopyOnWriteArrayList;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketHttpHeaders;
import org.springframework.web.socket.WebSocketSession;
import org.springframework.web.socket.client.standard.StandardWebSocketClient;
import org.springframework.web.socket.handler.TextWebSocketHandler;

/**
 * The end-to-end flow, as one test: upload a venue, start a session, let the tick loop run,
 * and check that a WebSocket client actually receives people, densities, alerts and metrics.
 *
 * <p>{@code ml-service.mock-enabled=true} keeps the AI layer out of it deliberately — this is
 * the check that the simulation and broadcast work <em>without</em> Hugging Face, which is
 * the fallback the whole design leans on. The AI path has its own checks in
 * ml-service/tests/test_analyze.py.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@TestPropertySource(properties = {
        "ml-service.mock-enabled=true",
        "session.tick-interval-ms=20",   // run the clock fast so the test is not slow
        "session.broadcast-every-ticks=1",
        "session.retain-after-finish-ms=0",      // evict as soon as the sweep is asked to
        "session.evict-interval-ms=3600000",     // ...but only when a test asks; never on its own
        "logging.level.com.concourse=INFO"
})
class SessionFlowTest {

    @LocalServerPort
    private int port;

    @Autowired
    private TestRestTemplate rest;

    /**
     * Signs the whole class in as a CLIENT before any test runs.
     *
     * These cases drive the API over real HTTP, so {@code @WithMockUser} does not apply — that
     * populates the SecurityContext in-process and never reaches a socket. Registering a real
     * account and attaching its bearer token keeps the security filter chain genuinely in the
     * path, so an authorisation regression still surfaces here as a 403 rather than being
     * configured away.
     */
    @BeforeEach
    void authenticate() {
        if (bearer == null) {
            var body = Map.of(
                    "email", "session-flow-test@concourse.local",
                    "password", "test-password-123",
                    "role", "client");
            ResponseEntity<Map> res = rest.postForEntity("/auth/register", body, Map.class);
            if (res.getStatusCode() != HttpStatus.CREATED) {   // already registered by an earlier run
                res = rest.postForEntity("/auth/login",
                        Map.of("email", body.get("email"), "password", body.get("password")), Map.class);
            }
            bearer = (String) res.getBody().get("token");
        }
        rest.getRestTemplate().setInterceptors(List.of((request, bytes, execution) -> {
            request.getHeaders().setBearerAuth(bearer);
            return execution.execute(request, bytes);
        }));
    }

    private static String bearer;

    @Autowired
    private SessionManager sessionManager;

    @Autowired
    private SimulationEngine engine;

    private final ObjectMapper objectMapper = new ObjectMapper();

    /** gate -> walkway -> exit, with a deliberately undersized walkway so it jams. */
    private static final Venue VENUE = new Venue("venue-session-test", "Session Test Venue",
            List.of(
                    new VenueNode("gate", "Gate", VenueNode.Type.GATE, 120, 40, 100),
                    new VenueNode("walk", "Walkway", VenueNode.Type.WALKWAY, 60, 200, 100),
                    new VenueNode("exit", "Exit", VenueNode.Type.EXIT, 300, 360, 100)),
            List.of(
                    new VenueEdge("gate", "walk", 20, 4, true),
                    new VenueEdge("walk", "exit", 20, 4, true)));

    @Test
    void fullFlowFromUploadToLiveBroadcast() throws Exception {
        // 1-2. Upload the venue and create the session.
        ResponseEntity<SessionInfo> created = rest.postForEntity("/sessions",
                Map.of("venue", VENUE, "crowdSize", 600, "arrivalRate", 12,
                        "maxTicks", 4000, "tickSeconds", 1.0, "rerouteEnabled", true),
                SessionInfo.class);

        assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
        SessionInfo info = created.getBody();
        assertThat(info).isNotNull();
        assertThat(info.status()).isEqualTo("CREATED");
        String id = info.sessionId();

        // 3. Connect a viewer before starting, so we see the run from tick 0.
        List<SessionState> frames = new CopyOnWriteArrayList<>();
        WebSocketSession socket = connect(id, frames);

        // 4. Start.
        assertThat(rest.postForEntity("/sessions/{id}/start", null, SessionInfo.class, id)
                .getStatusCode()).isEqualTo(HttpStatus.OK);

        // 5-6. The tick loop runs, people spawn and walk, the undersized walkway backs up.
        awaitUntil(Duration.ofSeconds(25), () -> {
            assertThat(frames).isNotEmpty();
            SessionState latest = frames.get(frames.size() - 1);
            assertThat(latest.people()).as("agents are on the map").isNotEmpty();
            assertThat(latest.metrics().spawned()).as("gates admitted people").isPositive();
            assertThat(latest.nodes()).anyMatch(node -> node.density() > 0);
        });

        // 7. The jam is detected and reported.
        awaitUntil(Duration.ofSeconds(30), () ->
                assertThat(frames.get(frames.size() - 1).nodes())
                        .as("the undersized walkway should go over threshold")
                        .anyMatch(node -> node.status() != Alert.Severity.OK));

        // 8. People reach the exit and leave — the simulation drains, it does not just fill.
        awaitUntil(Duration.ofSeconds(30), () ->
                assertThat(frames.get(frames.size() - 1).metrics().exited()).isPositive());

        SessionState frame = frames.get(frames.size() - 1);
        assertThat(frame.sessionId()).isEqualTo(id);
        assertThat(frame.tick()).isPositive();
        assertThat(frame.simulationSeconds()).isPositive();
        assertThat(frame.metrics().viewers()).isEqualTo(1);
        assertThat(frame.aiStatus()).contains("mock-enabled"); // AI deliberately off here
        // Every agent in the frame carries a position and the node it is counted against.
        assertThat(frame.people()).allSatisfy(person -> {
            assertThat(person.nodeId()).isNotBlank();
            assertThat(person.type()).isIn("SOLO", "FAMILY");
        });

        // 9. Pause holds the clock; stop is terminal.
        rest.postForEntity("/sessions/{id}/pause", null, SessionInfo.class, id);
        int tickAtPause = rest.getForObject("/sessions/{id}", SessionInfo.class, id).tick();
        Thread.sleep(400); // several tick intervals at 20ms
        assertThat(rest.getForObject("/sessions/{id}", SessionInfo.class, id).tick())
                .as("a paused session does not advance").isEqualTo(tickAtPause);

        rest.postForEntity("/sessions/{id}/start", null, SessionInfo.class, id);
        rest.postForEntity("/sessions/{id}/stop", null, SessionInfo.class, id);
        assertThat(rest.getForObject("/sessions/{id}", SessionInfo.class, id).status()).isEqualTo("STOPPED");

        socket.close();
    }

    @Test
    void rejectsAVenueWithNoGate() {
        Venue gateless = new Venue("no-gate", "No Gate",
                List.of(new VenueNode("exit", "Exit", VenueNode.Type.EXIT, 100, 0, 0)),
                List.of(new VenueEdge("exit", "exit", 1, 1, false)));

        ResponseEntity<String> response = rest.postForEntity("/sessions",
                Map.of("venue", gateless, "crowdSize", 10, "arrivalRate", 1), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).contains("GATE");
    }

    @Test
    void unknownSessionIs404() {
        assertThat(rest.getForEntity("/sessions/nope", String.class).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
    }

    private WebSocketSession connect(String sessionId, List<SessionState> sink) throws Exception {
        // Client-side buffer has to match the server's for the same reason: a busy venue's
        // frame is tens of kilobytes and the 8 KB default closes the connection rather than
        // truncating. A viewer that silently disconnects once the crowd arrives is the exact
        // failure this test exists to catch.
        WebSocketContainer container = ContainerProvider.getWebSocketContainer();
        container.setDefaultMaxTextMessageBufferSize(512 * 1024);

        return new StandardWebSocketClient(container)
                .execute(new TextWebSocketHandler() {
                    @Override
                    protected void handleTextMessage(WebSocketSession session, TextMessage message) throws Exception {
                        sink.add(objectMapper.readValue(message.getPayload(), SessionState.class));
                    }
                }, new WebSocketHttpHeaders(),
                        URI.create("ws://localhost:" + port + "/sessions/" + sessionId + "/stream"))
                .get();
    }

    /**
     * The before/after comparison the whole system exists to produce. The twin has to actually
     * run — a baseline stuck at tick 0 would still "compare", just meaninglessly.
     */
    @Test
    void baselineTwinRunsInLockstepAndFeedsTheSummary() throws Exception {
        String id = rest.postForEntity("/sessions",
                Map.of("venue", VENUE, "crowdSize", 400, "arrivalRate", 10,
                        "maxTicks", 4000, "tickSeconds", 1.0, "rerouteEnabled", true),
                SessionInfo.class).getBody().sessionId();
        rest.postForEntity("/sessions/{id}/start", null, SessionInfo.class, id);

        awaitUntil(Duration.ofSeconds(20), () -> {
            SessionSummary summary = rest.getForObject("/sessions/{id}/summary", SessionSummary.class, id);
            assertThat(summary.comparisonAvailable()).as("a twin was created").isTrue();
            assertThat(summary.baseline().spawned()).as("the twin is actually ticking").isPositive();
            assertThat(summary.optimised().spawned()).isPositive();
        });

        // The twin ticks with its session, not behind it.
        SessionInfo twin = rest.getForObject("/sessions/{id}", SessionInfo.class, id + "-baseline");
        int lead = rest.getForObject("/sessions/{id}", SessionInfo.class, id).tick();
        assertThat(twin.tick()).isCloseTo(lead, within(3));
        assertThat(twin.rerouteEnabled()).as("the baseline is the no-intervention run").isFalse();

        // ...and it stays out of the session list, which is an organiser-facing view.
        assertThat(rest.getForObject("/sessions", SessionInfo[].class))
                .extracting(SessionInfo::sessionId)
                .contains(id)
                .doesNotContain(id + "-baseline");

        // Lifecycle moves both, otherwise the comparison drifts apart.
        rest.postForEntity("/sessions/{id}/pause", null, SessionInfo.class, id);
        assertThat(rest.getForObject("/sessions/{id}", SessionInfo.class, id + "-baseline").status())
                .isEqualTo("PAUSED");
        rest.postForEntity("/sessions/{id}/stop", null, SessionInfo.class, id);
        assertThat(rest.getForObject("/sessions/{id}", SessionInfo.class, id + "-baseline").status())
                .isEqualTo("STOPPED");

        assertThat(rest.getForObject("/sessions/{id}/summary", SessionSummary.class, id).narrative())
                .isNotBlank();
    }

    @Test
    void finishedSessionsAreEvictedWithTheirTwin() {
        String id = rest.postForEntity("/sessions",
                Map.of("venue", VENUE, "crowdSize", 50, "arrivalRate", 5, "rerouteEnabled", true),
                SessionInfo.class).getBody().sessionId();
        rest.postForEntity("/sessions/{id}/stop", null, SessionInfo.class, id);

        sessionManager.evictFinishedSessions();

        assertThat(rest.getForEntity("/sessions/{id}", String.class, id).getStatusCode())
                .isEqualTo(HttpStatus.NOT_FOUND);
        assertThat(rest.getForEntity("/sessions/{id}", String.class, id + "-baseline").getStatusCode())
                .as("the twin goes with it").isEqualTo(HttpStatus.NOT_FOUND);
    }

    @Test
    void aSessionStillRunningIsNeverEvicted() {
        String id = rest.postForEntity("/sessions",
                Map.of("venue", VENUE, "crowdSize", 50, "arrivalRate", 5, "rerouteEnabled", false),
                SessionInfo.class).getBody().sessionId();

        sessionManager.evictFinishedSessions();

        assertThat(rest.getForEntity("/sessions/{id}", String.class, id).getStatusCode())
                .isEqualTo(HttpStatus.OK);
    }

    @Test
    void rejectsACrowdBeyondTheMeasuredCeiling() {
        ResponseEntity<String> response = rest.postForEntity("/sessions",
                Map.of("venue", VENUE, "crowdSize", 50_000, "arrivalRate", 10), String.class);

        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
        assertThat(response.getBody()).contains("crowdSize");
    }

    // ---------------------------------------------------------------- unit-level checks

    /**
     * Walking speed has to come from the venue's own scale. A layout drawn at twice the
     * coordinates is the same venue and must not walk at half the apparent pace.
     */
    @Test
    void agentSpeedScalesWithTheVenueRatherThanBeingAbsolute() {
        Venue big = new Venue("venue-big", "Big",
                VENUE.nodes().stream()
                        .map(n -> new VenueNode(n.id(), n.name(), n.type(), n.capacity(), n.x() * 2, n.y() * 2))
                        .toList(),
                VENUE.edges());

        double small = engine.agentSpeedFor(VENUE);
        double large = engine.agentSpeedFor(big);

        assertThat(large / small).isCloseTo(2.0, within(0.01));
        assertThat(small).isPositive();
    }

    /** The alert feed must not grow without bound over a long run. */
    @Test
    void alertFeedIsBoundedAndOnlyRecordsSeverityChanges() {
        Session session = new Session("sess-feed", VENUE, 100, 10, 500, 1.0, true);

        assertThat(session.addAlertIfChanged(alertFor("walk", Alert.Severity.WARNING))).isTrue();
        assertThat(session.addAlertIfChanged(alertFor("walk", Alert.Severity.WARNING)))
                .as("same severity again is not news").isFalse();
        assertThat(session.addAlertIfChanged(alertFor("walk", Alert.Severity.CRITICAL))).isTrue();
        assertThat(session.getBottleneckNodes()).containsExactly("walk");

        // A node that recovers is forgotten, so its next jam alerts again rather than staying
        // silent for the rest of the run.
        session.clearSeverity("walk");
        assertThat(session.addAlertIfChanged(alertFor("walk", Alert.Severity.CRITICAL))).isTrue();

        for (int i = 0; i < 800; i++) {
            session.clearSeverity("walk");
            session.addAlertIfChanged(alertFor("walk", Alert.Severity.CRITICAL));
        }
        assertThat(session.getAlerts()).hasSizeLessThanOrEqualTo(300);
    }

    private Alert alertFor(String nodeId, Alert.Severity severity) {
        return new Alert("alert-x", 1, nodeId, severity, 0.9, Alert.Trend.RISING, "msg");
    }


    @Test
    void socialForceDrivesTowardTheGoalAndPushesAgentsApart() {
        SocialForceModel forces = new SocialForceModel();

        // Standing still at the origin, goal due east: acceleration is due east.
        double[] driving = forces.drivingForce(new double[] {0, 0}, new double[] {0, 0},
                new double[] {10, 0}, 3.0);
        assertThat(driving[0]).isPositive();
        assertThat(driving[1]).isZero();

        // Two agents on top of each other repel harder than two a body-width apart.
        double near = magnitude(forces.agentRepulsion(new double[] {0, 0}, new double[] {1, 0}, 4));
        double far = magnitude(forces.agentRepulsion(new double[] {0, 0}, new double[] {12, 0}, 4));
        assertThat(near).isGreaterThan(far);

        // Repulsion points away from the other agent, never toward it.
        double[] push = forces.agentRepulsion(new double[] {0, 0}, new double[] {2, 0}, 4);
        assertThat(push[0]).isNegative();

        // A wall pushes perpendicular, and harder the closer you are.
        double[] wallStart = {0, 0};
        double[] wallEnd = {10, 0};
        assertThat(magnitude(forces.wallRepulsion(new double[] {5, 1}, wallStart, wallEnd)))
                .isGreaterThan(magnitude(forces.wallRepulsion(new double[] {5, 9}, wallStart, wallEnd)));
    }

    /**
     * The gate that stops the AI layer being called ten times a second. Getting this wrong is
     * invisible locally and very visible in a Hugging Face bill.
     */
    @Test
    void analyseIsGatedOnRealChangeAndAMinimumInterval() {
        DensityDetector detector = new DensityDetector(0.70, 0.85, 5, 0.10, 20);
        Session session = new Session("sess-gate", VENUE, 100, 10, 500, 1.0, true);

        Map<String, Double> quiet = Map.of("gate", 0.10, "walk", 0.10, "exit", 0.0);
        session.setTick(30);
        assertThat(detector.shouldAnalyse(session, quiet)).as("first look, crowd present").isTrue();

        session.setLastAnalysed(quiet, 30);
        session.setTick(35);
        assertThat(detector.shouldAnalyse(session, Map.of("gate", 0.90, "walk", 0.10, "exit", 0.0)))
                .as("under the minimum interval, however dramatic the change").isFalse();

        session.setTick(60);
        assertThat(detector.shouldAnalyse(session, Map.of("gate", 0.12, "walk", 0.11, "exit", 0.0)))
                .as("interval elapsed but nothing moved").isFalse();

        assertThat(detector.shouldAnalyse(session, Map.of("gate", 0.25, "walk", 0.10, "exit", 0.0)))
                .as("a 0.15 jump is worth a call").isTrue();

        session.setLastAnalysed(Map.of("gate", 0.68, "walk", 0.10, "exit", 0.0), 60);
        session.setTick(90);
        assertThat(detector.shouldAnalyse(session, Map.of("gate", 0.72, "walk", 0.10, "exit", 0.0)))
                .as("0.68 -> 0.72 is small but crosses into WARNING").isTrue();
    }

    @Test
    void occupancyCountsEveryAgentAgainstExactlyOneNode() {
        Session session = new Session("sess-count", VENUE, 100, 10, 500, 1.0, true);
        session.getPeople().add(new Person("p1", Person.Type.SOLO, 3, 2, 40, 100, "gate"));
        session.getPeople().add(new Person("p2", Person.Type.FAMILY, 2, 2, 42, 101, "gate"));
        session.getPeople().add(new Person("p3", Person.Type.SOLO, 3, 2, 200, 100, "walk"));

        Map<String, Integer> occupancy = session.occupancy();

        assertThat(occupancy).containsEntry("gate", 2).containsEntry("walk", 1).containsEntry("exit", 0);
        assertThat(occupancy.values().stream().mapToInt(Integer::intValue).sum())
                .isEqualTo(session.getPeople().size());
    }

    private double magnitude(double[] vector) {
        return Math.hypot(vector[0], vector[1]);
    }

    /**
     * Retries an assertion until it passes or the deadline expires, then rethrows the last
     * failure. ponytail: this is the whole of what Awaitility would give us here, so it is
     * not worth a dependency. Reach for Awaitility if the waiting gets more interesting than
     * "poll until true".
     */
    private static void awaitUntil(Duration timeout, Runnable assertion) throws InterruptedException {
        long deadline = System.nanoTime() + timeout.toNanos();
        AssertionError last = null;
        while (System.nanoTime() < deadline) {
            try {
                assertion.run();
                return;
            } catch (AssertionError e) {
                last = e;
                Thread.sleep(100);
            }
        }
        if (last != null) {
            throw last;
        }
        assertion.run();
    }
}
