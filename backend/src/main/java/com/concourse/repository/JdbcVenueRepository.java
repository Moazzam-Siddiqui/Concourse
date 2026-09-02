package com.concourse.repository;

import com.concourse.model.Venue;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.dao.EmptyResultDataAccessException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * Venue storage for deployed environments, where the filesystem does not survive a restart.
 *
 * {@link FileVenueRepository} is the right thing locally — one readable JSON file per venue,
 * and the disk is still there tomorrow. On a container host it is not: free tiers stop a
 * service after minutes of inactivity and bring it back with a blank filesystem, so a venue a
 * client uploaded and handed a code out for would be gone by the time anyone used the code.
 * That is the product's main flow failing quietly rather than loudly, which is worse.
 *
 * This is the bean swap the file store's own comment anticipated. It is {@code @Primary} and
 * scoped to the {@code cloud} profile, so it outranks the file store exactly where a database
 * exists and is absent everywhere else. No caller changes, because no caller knows where a
 * venue lives.
 *
 * The venue is stored as its own JSON, not decomposed into tables. It is a nested graph that
 * only ever moves as a whole — nothing queries inside it — so normalising it would add a
 * migration for every new field and buy joins nobody makes. Jackson is already the format of
 * record for these objects; this writes the same bytes to a different place.
 */
@Repository
@Primary
@Profile("cloud")
public class JdbcVenueRepository implements VenueRepository {

    private static final Logger log = LoggerFactory.getLogger(JdbcVenueRepository.class);

    /**
     * Read cache, mirroring the file store's behaviour so a lookup never waits on the
     * database. Venues change rarely and are read on every map tick, and on a free tier the
     * database is a network hop away.
     */
    private final Map<String, Venue> cache = new ConcurrentHashMap<>();

    private final JdbcTemplate jdbc;
    private final ObjectMapper mapper;

    public JdbcVenueRepository(JdbcTemplate jdbc, ObjectMapper mapper) {
        this.jdbc = jdbc;
        this.mapper = mapper;
        long count = warm();
        log.info("Venue store: {} venue(s) loaded from the database", count);
    }

    /** Pulls every venue into the cache at startup, the same way the file store does. */
    private long warm() {
        try {
            jdbc.query("SELECT id, payload FROM venue", rs -> {
                String id = rs.getString("id");
                try {
                    cache.put(id, mapper.readValue(rs.getString("payload"), Venue.class));
                } catch (Exception e) {
                    // One unreadable row must not stop the service booting. It is almost
                    // always a venue written by an older model version; the rest are fine.
                    log.warn("Skipping venue {}: stored payload could not be read ({})",
                            id, e.getMessage());
                }
            });
        } catch (Exception e) {
            log.warn("Venue store: could not read venues at startup ({})", e.getMessage());
        }
        return cache.size();
    }

    @Override
    public Venue save(Venue venue) {
        Venue stored = venue.id() == null || venue.id().isBlank()
                ? venue.withId("venue-" + UUID.randomUUID().toString().substring(0, 8))
                : venue;

        String payload;
        try {
            payload = mapper.writeValueAsString(stored);
        } catch (Exception e) {
            throw new IllegalStateException("Venue " + stored.id() + " could not be serialised", e);
        }

        // Update first, insert if it changed nothing. Not the prettiest upsert, but the only
        // one that is plain SQL on both engines: H2's MERGE ... KEY syntax is not Postgres's,
        // and Postgres's ON CONFLICT is not H2's outside compatibility mode. Venues are
        // written by hand a few times a day, so the extra round trip costs nothing.
        int updated = jdbc.update(
                "UPDATE venue SET payload = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                payload, stored.id());
        if (updated == 0) {
            jdbc.update("INSERT INTO venue (id, payload) VALUES (?, ?)", stored.id(), payload);
        }
        cache.put(stored.id(), stored);
        return stored;
    }

    @Override
    public Optional<Venue> findById(String id) {
        if (id == null || id.isBlank()) return Optional.empty();
        Venue hit = cache.get(id);
        if (hit != null) return Optional.of(hit);

        // A miss is normal with more than one instance running: the other one wrote it and
        // this cache has never seen it.
        try {
            String payload = jdbc.queryForObject(
                    "SELECT payload FROM venue WHERE id = ?", String.class, id);
            Venue venue = mapper.readValue(payload, Venue.class);
            cache.put(id, venue);
            return Optional.of(venue);
        } catch (EmptyResultDataAccessException notFound) {
            return Optional.empty();
        } catch (Exception e) {
            log.warn("Venue {} could not be read from the database ({})", id, e.getMessage());
            return Optional.empty();
        }
    }
}
