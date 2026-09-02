package com.concourse;

import static org.assertj.core.api.Assertions.assertThat;

import com.concourse.model.Venue;
import com.concourse.model.VenueEdge;
import com.concourse.model.VenueNode;
import com.concourse.repository.JdbcVenueRepository;
import com.fasterxml.jackson.databind.ObjectMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseBuilder;
import org.springframework.jdbc.datasource.embedded.EmbeddedDatabaseType;

/**
 * The database-backed venue store, which the rest of the suite never touches.
 *
 * Every other test runs under the default profile, where {@link com.concourse.repository
 * .FileVenueRepository} is the primary bean — so without this, the class that will actually
 * hold venues in production would ship having never executed once.
 *
 * The schema comes from the real V4 migration file rather than a copy, so a change to the
 * migration that this code cannot cope with fails here instead of on first deploy.
 */
class JdbcVenueStoreTest {

    private JdbcTemplate jdbc;
    private JdbcVenueRepository repo;

    @BeforeEach
    void setUp() throws Exception {
        jdbc = new JdbcTemplate(new EmbeddedDatabaseBuilder()
                .setType(EmbeddedDatabaseType.H2)
                .generateUniqueName(true)
                .build());
        jdbc.execute(Files.readString(
                Path.of("src/main/resources/db/migration/V4__venue_store.sql")));
        repo = new JdbcVenueRepository(jdbc, new ObjectMapper());
    }

    private static Venue venue(String id) {
        return new Venue(id, "Test Arena",
                List.of(
                        new VenueNode("gate-a", "Gate A", VenueNode.Type.GATE, 320, 0, 0),
                        new VenueNode("mid", "Middle", VenueNode.Type.WALKWAY, 500, 500, 200),
                        new VenueNode("exit-e", "Exit East", VenueNode.Type.EXIT, 400, 1000, 0)),
                List.of(
                        new VenueEdge("gate-a", "mid", 538.5, 6, true),
                        new VenueEdge("mid", "exit-e", 538.5, 6, true)));
    }

    @Test
    void savesAndReadsBackTheWholeGraph() {
        repo.save(venue("venue-alpha"));

        Optional<Venue> found = repo.findById("venue-alpha");
        assertThat(found).isPresent();
        assertThat(found.get().name()).isEqualTo("Test Arena");
        // The nested graph is the part a naive column mapping would lose.
        assertThat(found.get().nodes()).hasSize(3);
        assertThat(found.get().edges()).hasSize(2);
        assertThat(found.get().nodes().get(0).type()).isEqualTo(VenueNode.Type.GATE);
    }

    @Test
    void assignsAnIdWhenTheVenueHasNone() {
        Venue stored = repo.save(new Venue(null, "Unnamed",
                venue("x").nodes(), venue("x").edges()));

        assertThat(stored.id()).startsWith("venue-");
        assertThat(repo.findById(stored.id())).isPresent();
    }

    /**
     * The upsert. Saving the same id twice must replace the row rather than fail on the
     * primary key — a client re-uploading a floor plan does exactly this.
     */
    @Test
    void savingTwiceUpdatesRatherThanDuplicating() {
        repo.save(venue("venue-beta"));
        repo.save(new Venue("venue-beta", "Renamed Arena",
                venue("venue-beta").nodes(), venue("venue-beta").edges()));

        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM venue", Integer.class)).isEqualTo(1);
        assertThat(repo.findById("venue-beta").orElseThrow().name()).isEqualTo("Renamed Arena");
    }

    /** A miss must be an empty Optional, not an exception. */
    @Test
    void unknownIdIsEmpty() {
        assertThat(repo.findById("nope")).isEmpty();
        assertThat(repo.findById(null)).isEmpty();
        assertThat(repo.findById("  ")).isEmpty();
    }

    /**
     * The case this exists for: a restart with a blank filesystem. A second repository over
     * the same database must see everything the first one wrote, because on a container host
     * that is what every wake-from-idle looks like.
     */
    @Test
    void survivesARestart() {
        repo.save(venue("venue-gamma"));

        JdbcVenueRepository afterRestart = new JdbcVenueRepository(jdbc, new ObjectMapper());

        assertThat(afterRestart.findById("venue-gamma")).isPresent();
        assertThat(afterRestart.findById("venue-gamma").orElseThrow().nodes()).hasSize(3);
    }
}
