package com.concourse.service.broadcast;

import com.concourse.dto.SessionState;
import com.concourse.model.Alert;
import com.concourse.model.Person;
import com.concourse.model.Session;
import com.concourse.model.VenueNode;
import com.concourse.service.detection.DensityDetector;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.socket.TextMessage;
import org.springframework.web.socket.WebSocketSession;

/**
 * Turns a session's live state into one broadcast frame and pushes it to everyone watching —
 * organiser and viewers alike, over the same socket, because they see the same venue.
 *
 * <p>Also holds the per-session viewer registry. That lives here rather than in
 * {@code SessionManager} for a boring reason: the manager already depends on this class to
 * broadcast, so putting the sockets on the manager would make the two mutually dependent.
 * {@code SessionManager.viewerCount} delegates here instead.
 */
@Service
public class StateBroadcaster {

    private static final Logger log = LoggerFactory.getLogger(StateBroadcaster.class);

    private final Map<String, Set<WebSocketSession>> viewers = new ConcurrentHashMap<>();
    private final ObjectMapper objectMapper = new ObjectMapper();

    private final int maxPeopleInFrame;
    private final DensityDetector detector;

    public StateBroadcaster(@Value("${session.max-people-in-frame:600}") int maxPeopleInFrame,
                            DensityDetector detector) {
        this.maxPeopleInFrame = maxPeopleInFrame;
        this.detector = detector;
    }

    public void register(String sessionId, WebSocketSession socket) {
        viewers.computeIfAbsent(sessionId, k -> ConcurrentHashMap.newKeySet()).add(socket);
    }

    public void unregister(String sessionId, WebSocketSession socket) {
        Set<WebSocketSession> sockets = viewers.get(sessionId);
        if (sockets != null) {
            sockets.remove(socket);
        }
    }

    public int viewerCount(String sessionId) {
        return viewers.getOrDefault(sessionId, Set.of()).size();
    }

    /** Pushes whatever frame was last published — used the moment a viewer connects. */
    public void sendLatest(Session session, WebSocketSession socket) {
        SessionState state = session.getLatestState();
        if (state != null) {
            send(socket, state);
        }
    }

    /**
     * Builds this tick's frame, publishes it on the session (so REST reads and late joiners
     * see the same thing) and sends it to every open socket.
     */
    public void broadcast(Session session, Map<String, Double> densities,
                          Map<String, Alert.Trend> trends) {
        SessionState state = prepare(session, densities, trends);
        session.setLatestState(state);

        Set<WebSocketSession> sockets = viewers.getOrDefault(session.getId(), Set.of());
        if (sockets.isEmpty()) {
            return;
        }
        String payload;
        try {
            payload = objectMapper.writeValueAsString(state);
        } catch (IOException e) {
            log.warn("Could not serialise frame for session {}: {}", session.getId(), e.getMessage());
            return;
        }
        TextMessage message = new TextMessage(payload);
        for (WebSocketSession socket : sockets) {
            send(socket, message);
        }
    }

    /** The frame itself: people, densities, alerts, reroutes, risk, advisory, metrics, clock. */
    public SessionState prepare(Session session, Map<String, Double> densities,
                                Map<String, Alert.Trend> trends) {
        // liveOccupancy, not occupancy: the frame's per-node count has to agree with the
        // density beside it, and both include real attendees. The comparison numbers are taken
        // separately in SessionManager.advance from the simulated agents alone.
        Map<String, Integer> occupancy = session.liveOccupancy();
        Map<String, Double> risk = session.getPredictedRisk();

        List<SessionState.NodeDensity> nodes = new ArrayList<>();
        int activeAlerts = 0;
        for (VenueNode node : session.getVenue().nodes()) {
            double density = densities.getOrDefault(node.id(), 0.0);
            Alert.Severity severity = detector.severityOf(density);
            if (severity != Alert.Severity.OK) {
                activeAlerts++;
            }
            nodes.add(new SessionState.NodeDensity(
                    node.id(), node.name(), occupancy.getOrDefault(node.id(), 0), node.capacity(),
                    density, severity, trends.getOrDefault(node.id(), Alert.Trend.FLAT),
                    risk.getOrDefault(node.id(), 0.0)));
        }

        SessionState.Metrics metrics = new SessionState.Metrics(
                session.getPeople().size(),
                session.getSpawned(),
                session.getExited(),
                session.remainingToSpawn(),
                Math.round(session.getPeakDensity() * 100) / 100.0,
                session.getCriticalNodeTicks(),
                activeAlerts,
                viewerCount(session.getId()),
                session.walkerCount());

        return new SessionState(
                session.getId(),
                session.getVenue().id(),
                session.getTick(),
                Math.round(session.getTick() * session.getTickSeconds() * 10) / 10.0,
                session.getStatus().name(),
                samplePeople(session),
                session.getPeople().size(),
                nodes,
                lastOf(session.getAlerts(), 20),
                lastOf(session.getReroutes(), 10),
                risk,
                session.getLatestAdvisory(),
                session.getAiStatus(),
                metrics);
    }

    /**
     * Agent positions for the map, capped.
     *
     * <p>ponytail: every nth agent, not the first n — a prefix would show one corner of the
     * venue filling and the rest empty, while a stride keeps the shape of the crowd. The cap
     * exists because 5,000 agents at 5 frames a second is about 1 MB/s down every socket, and
     * a map cannot draw that many dots usefully anyway. Raise
     * {@code session.max-people-in-frame} if the venue really needs it; switch to a binary
     * frame before raising it far.
     */
    private List<SessionState.PersonState> samplePeople(Session session) {
        List<Person> people = session.getPeople();
        int total = people.size();

        // Which agents are in the sample is decided by a hash of each agent's own id, never by
        // its position in the list.
        //
        // Taking every nth index looked equivalent and was not. `people` is an ArrayList that
        // agents are *removed* from as they leave, so a single exit shifts every later index
        // and the next frame carries a different set of ids. Two things broke because of it:
        // figures on the map jumped to unrelated positions, worst during egress when exits are
        // frequent; and the browser, seeing an entirely new set of keys every frame, destroyed
        // and rebuilt the whole crowd layer instead of moving the nodes it already had.
        //
        // Hashing the id fixes both. An agent's membership depends on nothing but itself, so a
        // sampled agent stays sampled for its whole visit and the client can animate it.
        long cutoff = total <= maxPeopleInFrame
                ? 0xFFFFFFFFL
                : (long) ((double) maxPeopleInFrame / total * 0xFFFFFFFFL);

        List<SessionState.PersonState> sampled = new ArrayList<>(Math.min(total, maxPeopleInFrame));
        for (Person person : people) {
            if (spread(person.getId()) > cutoff) {
                continue;
            }
            sampled.add(new SessionState.PersonState(
                    person.getId(),
                    Math.round(person.getX() * 10) / 10.0,
                    Math.round(person.getY() * 10) / 10.0,
                    person.getCurrentNodeId(),
                    person.getType().name(),
                    person.getRerouteCount() > 0));
        }
        return sampled;
    }

    /**
     * Agent id to an evenly spread 32-bit value.
     *
     * {@code String.hashCode} is not usable here: ids are sequential ("p-1", "p-2", …) and its
     * output for those is nearly sequential too, so a threshold on it would select one
     * contiguous block of arrivals and leave the rest of the venue empty. The extra mixing is
     * what makes the sample look like the crowd.
     */
    private static long spread(String id) {
        int hash = id.hashCode();
        hash ^= (hash >>> 16);
        hash *= 0x7feb352d;
        hash ^= (hash >>> 15);
        hash *= 0x846ca68b;
        hash ^= (hash >>> 16);
        return hash & 0xFFFFFFFFL;
    }

    private <T> List<T> lastOf(List<T> items, int count) {
        return items.size() <= count ? List.copyOf(items)
                : List.copyOf(items.subList(items.size() - count, items.size()));
    }

    private void send(WebSocketSession socket, SessionState state) {
        try {
            send(socket, new TextMessage(objectMapper.writeValueAsString(state)));
        } catch (IOException e) {
            log.debug("Could not serialise frame for {}: {}", socket.getId(), e.getMessage());
        }
    }

    private void send(WebSocketSession socket, TextMessage message) {
        if (!socket.isOpen()) {
            return;
        }
        try {
            // Spring's WebSocketSession is not safe for concurrent sends; only the tick thread
            // and the connect handler ever write, and both go through here.
            synchronized (socket) {
                socket.sendMessage(message);
            }
        } catch (IOException | IllegalStateException e) {
            log.debug("Dropping viewer {}: {}", socket.getId(), e.getMessage());
        }
    }

    /** Drops the registry for a finished session so closed sockets are not held forever. */
    public void forget(String sessionId) {
        viewers.remove(sessionId);
    }
}
