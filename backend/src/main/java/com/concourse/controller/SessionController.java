package com.concourse.controller;

import com.concourse.dto.CreateSessionRequest;
import com.concourse.dto.SessionInfo;
import com.concourse.dto.SessionState;
import com.concourse.dto.SessionSummary;
import com.concourse.dto.WalkerFix;
import com.concourse.dto.WalkerPlacement;
import com.concourse.model.Session;
import com.concourse.service.session.SessionManager;
import jakarta.validation.Valid;
import java.util.List;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * The session API: upload a venue and get a running crowd simulation.
 *
 * <pre>
 *   POST /sessions              venue JSON + crowd settings -> session
 *   POST /sessions/{id}/start   begin (or resume) ticking
 *   POST /sessions/{id}/pause   hold the clock, keep the state
 *   POST /sessions/{id}/stop    terminal; numbers are final
 *   GET  /sessions/{id}         session info
 *   GET  /sessions/{id}/state   the latest broadcast frame, for clients without a socket
 *   WS   /sessions/{id}/stream  live frames (see SessionSocketHandler)
 * </pre>
 */
@RestController
@RequestMapping("/sessions")
public class SessionController {

    private final SessionManager sessions;

    public SessionController(SessionManager sessions) {
        this.sessions = sessions;
    }

    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    public SessionInfo create(@Valid @RequestBody CreateSessionRequest request) {
        Session session = sessions.create(request);
        return SessionInfo.of(session, sessions.viewerCount(session.getId()));
    }

    @PostMapping("/{id}/start")
    public SessionInfo start(@PathVariable String id) {
        return info(sessions.start(id));
    }

    @PostMapping("/{id}/pause")
    public SessionInfo pause(@PathVariable String id) {
        return info(sessions.pause(id));
    }

    @PostMapping("/{id}/stop")
    public SessionInfo stop(@PathVariable String id) {
        return info(sessions.stop(id));
    }

    @GetMapping("/{id}")
    public SessionInfo get(@PathVariable String id) {
        return info(sessions.get(id));
    }

    /** Every live and recently finished session. Baseline twins are hidden. */
    @GetMapping
    public List<SessionInfo> list() {
        return sessions.list().stream().map(this::info).toList();
    }

    /** Post-run stats and the before/after comparison. Readable while the run is still going. */
    @GetMapping("/{id}/summary")
    public SessionSummary summary(@PathVariable String id) {
        return sessions.summary(id);
    }

    /**
     * The same frame the WebSocket pushes. Here so a client can poll, screenshot or assert on
     * the state without holding a socket open — which is exactly what the end-to-end check does.
     *
     * <p>{@code ?people=false} drops the agent positions, which are the bulk of a frame: a busy
     * one carries up to {@code session.max-people-in-frame} of them at ~80 bytes each. The
     * attendee-facing clients want zone density and exit status and are never shown other
     * people anyway, so for them the positions are pure cost — tens of kilobytes, five times a
     * second, over cellular. {@code sampledFrom} still reports the true crowd size.
     */
    @GetMapping("/{id}/state")
    public SessionState state(@PathVariable String id,
                              @RequestParam(defaultValue = "true") boolean people) {
        SessionState state = sessions.get(id).getLatestState();
        return state == null || people ? state : state.withoutPeople();
    }

    /**
     * {@code PUT /sessions/{id}/walkers/{walkerId}} — where a real attendee is.
     *
     * <p>Accepts either a GPS fix or a self-declared zone; see {@link WalkerFix}. The reply says
     * which zone they landed in, or why they could not be placed.
     *
     * <p>{@code PUT} with a client-chosen id: the phone generates a UUID once and keeps it, so a
     * retried fix is idempotent and the server allocates nothing. The id is opaque and carries no
     * account, so there is nothing to link it back to a person.
     *
     * <p>Unauthenticated by design, like the rest of this API, so the damage is bounded rather
     * than denied: {@code session.max-walkers} caps how many a session will hold, and
     * {@code session.walker-ttl-ms} means anything injected ages out within half a minute.
     */
    @PutMapping("/{id}/walkers/{walkerId}")
    public WalkerPlacement placeWalker(@PathVariable String id, @PathVariable String walkerId,
                                       @Valid @RequestBody WalkerFix fix) {
        return sessions.placeWalker(id, walkerId, fix);
    }

    /** Leaves the venue now rather than waiting for the TTL to lapse. */
    @DeleteMapping("/{id}/walkers/{walkerId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void removeWalker(@PathVariable String id, @PathVariable String walkerId) {
        sessions.removeWalker(id, walkerId);
    }

    private SessionInfo info(Session session) {
        return SessionInfo.of(session, sessions.viewerCount(session.getId()));
    }
}
