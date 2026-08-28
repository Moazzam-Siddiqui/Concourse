package com.concourse.repository;

import com.concourse.model.Venue;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

// ponytail: process memory only — swap for JPA when runs need to outlive a restart.
@Repository
public class InMemoryVenueRepository implements VenueRepository {

    private final Map<String, Venue> venues = new ConcurrentHashMap<>();

    @Override
    public Venue save(Venue venue) {
        Venue stored = venue.id() == null || venue.id().isBlank()
                ? venue.withId("venue-" + UUID.randomUUID().toString().substring(0, 8))
                : venue;
        venues.put(stored.id(), stored);
        return stored;
    }

    @Override
    public Optional<Venue> findById(String id) {
        return Optional.ofNullable(venues.get(id));
    }
}
