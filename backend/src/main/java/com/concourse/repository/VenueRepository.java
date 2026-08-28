package com.concourse.repository;

import com.concourse.model.Venue;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

public interface VenueRepository {

    /** Assigns an id if the venue has none, and stores it. Returns the stored venue. */
    Venue save(Venue venue);

    Optional<Venue> findById(String id);

    // ponytail: 404 lives here so four controllers don't each repeat the same three lines.
    default Venue getOrThrow(String id) {
        return findById(id).orElseThrow(
                () -> new ResponseStatusException(HttpStatus.NOT_FOUND, "No venue " + id));
    }
}
