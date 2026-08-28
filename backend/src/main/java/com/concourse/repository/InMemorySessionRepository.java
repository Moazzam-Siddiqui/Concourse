package com.concourse.repository;

import com.concourse.model.Session;
import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

// ponytail: process memory only, and sessions are never evicted — fine for a demo where the
// process lives for an afternoon. Add a TTL sweep, or swap this class for a real store, when
// sessions start outliving the run that made them.
@Repository
public class InMemorySessionRepository implements SessionRepository {

    private final Map<String, Session> sessions = new ConcurrentHashMap<>();

    @Override
    public Session save(Session session) {
        sessions.put(session.getId(), session);
        return session;
    }

    @Override
    public Optional<Session> findById(String id) {
        return Optional.ofNullable(sessions.get(id));
    }

    @Override
    public Collection<Session> findAll() {
        return sessions.values();
    }

    @Override
    public void delete(String id) {
        sessions.remove(id);
    }
}
