package com.concourse.repository;

import com.concourse.model.Session;
import java.util.Collection;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Storage seam for live sessions. Everything above this interface is persistence-agnostic,
 * so swapping the in-memory map for a real store never reaches the services.
 */
public interface SessionRepository {

    Session save(Session session);

    Optional<Session> findById(String id);

    Collection<Session> findAll();

    void delete(String id);

    default Session getOrThrow(String id) {
        return findById(id).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No session " + id));
    }
}
