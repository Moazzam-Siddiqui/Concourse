package com.concourse.repository;

import com.concourse.model.Venue;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.annotation.PostConstruct;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;
import java.util.stream.Stream;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Primary;
import org.springframework.context.annotation.Profile;
import org.springframework.stereotype.Repository;

/**
 * Venues that outlive a restart, stored as one JSON file per venue code.
 *
 * <p>This is what makes a venue code mean anything. Codes are printed on signage and handed to
 * attendees, so a code has to keep working tomorrow — but venues lived in a
 * {@code ConcurrentHashMap} and vanished with the process, which meant every restart silently
 * invalidated every sign in the building.
 *
 * <p><b>Why files rather than a database.</b> The whole store is a directory of readable JSON:
 * no server to run before a demo, no driver, no migration, and a venue can be inspected or
 * hand-edited with a text editor when a trace goes wrong. The trade is concurrent writes, and
 * this application has exactly one writer.
 *
 * <p><b>Deploying to the web.</b> Everything here is behind {@link VenueRepository}, and the
 * disk is only touched in {@link #persist} and {@link #load}. A Postgres or S3 implementation
 * is a new class and a bean swap — no caller changes, because no caller knows where a venue
 * lives. The in-memory map stays either way as a read cache, so lookups never hit storage.
 */
@Repository
@Primary
// Not under `cloud`: JdbcVenueRepository is @Primary there, and two primaries of the same
// type is a NoUniqueBeanDefinitionException at startup rather than a preference.
@Profile("!cloud")
public class FileVenueRepository implements VenueRepository {

    private static final Logger log = LoggerFactory.getLogger(FileVenueRepository.class);

    /** Read cache and the source of truth while running. Disk is the durable copy. */
    private final Map<String, Venue> venues = new ConcurrentHashMap<>();

    private final ObjectMapper mapper;
    private final Path directory;

    public FileVenueRepository(ObjectMapper mapper,
                               @Value("${concourse.venue-store:data/venues}") String directory) {
        this.mapper = mapper;
        this.directory = Path.of(directory);
    }

    /**
     * Loads every stored venue at startup.
     *
     * <p>Eagerly, rather than lazily per lookup: the client portal lists venues, and a lazy
     * store cannot answer "what exists" without reading the directory anyway. A venue file that
     * fails to parse is logged and skipped — one corrupt file must not stop the service from
     * serving the rest.
     */
    @PostConstruct
    void load() {
        try {
            Files.createDirectories(directory);
        } catch (IOException e) {
            log.warn("Cannot create venue store at {} — venues will not survive a restart: {}",
                    directory.toAbsolutePath(), e.getMessage());
            return;
        }

        try (Stream<Path> files = Files.list(directory)) {
            files.filter(p -> p.getFileName().toString().endsWith(".json")).forEach(this::readOne);
        } catch (IOException e) {
            log.warn("Cannot read venue store at {}: {}", directory.toAbsolutePath(), e.getMessage());
        }
        log.info("Venue store: {} venue(s) loaded from {}", venues.size(), directory.toAbsolutePath());
    }

    private void readOne(Path file) {
        try {
            Venue venue = mapper.readValue(file.toFile(), Venue.class);
            if (venue.id() != null && !venue.id().isBlank()) {
                venues.put(venue.id(), venue);
            }
        } catch (Exception e) {
            log.warn("Skipping unreadable venue file {}: {}", file.getFileName(), e.getMessage());
        }
    }

    @Override
    public Venue save(Venue venue) {
        Venue stored = venue.id() == null || venue.id().isBlank()
                ? venue.withId("venue-" + UUID.randomUUID().toString().substring(0, 8))
                : venue;
        venues.put(stored.id(), stored);
        persist(stored);
        return stored;
    }

    @Override
    public Optional<Venue> findById(String id) {
        if (id == null) {
            return Optional.empty();
        }
        Venue direct = venues.get(id);
        if (direct != null) {
            return Optional.of(direct);
        }
        // Codes are printed on signage and typed by attendees, so treat them the way the
        // frontend does: case-insensitively. Without this "wembley-01" off a phone keyboard
        // misses a venue saved as "WEMBLEY-01" and the attendee is told their venue is not live.
        String wanted = id.toUpperCase(Locale.ROOT);
        return venues.entrySet().stream()
                .filter(e -> e.getKey().toUpperCase(Locale.ROOT).equals(wanted))
                .map(Map.Entry::getValue)
                .findFirst();
    }

    /** Every stored venue, for the client portal's "your venues" list. */
    public List<Venue> findAll() {
        return List.copyOf(venues.values());
    }

    /**
     * Writes one venue to disk.
     *
     * <p>Write-then-move, so a crash mid-write leaves the previous file intact rather than a
     * truncated one. A half-written venue is worse than a stale venue: it fails to parse at
     * startup and the code stops working with no obvious cause.
     */
    private void persist(Venue venue) {
        Path target = directory.resolve(safeFileName(venue.id()));
        Path temp = target.resolveSibling(target.getFileName() + ".tmp");
        try {
            Files.createDirectories(directory);
            mapper.writerWithDefaultPrettyPrinter().writeValue(temp.toFile(), venue);
            Files.move(temp, target, StandardCopyOption.REPLACE_EXISTING);
        } catch (IOException e) {
            // Not fatal: the venue is already in the map, so this run works. Only durability
            // is lost, and saying so is more useful than failing the operator's upload.
            log.warn("Could not persist venue {} — it will not survive a restart: {}",
                    venue.id(), e.getMessage());
        }
    }

    /** Venue ids reach us from user input, so never let one escape the store directory. */
    private static String safeFileName(String id) {
        return id.replaceAll("[^A-Za-z0-9._-]", "_") + ".json";
    }
}
