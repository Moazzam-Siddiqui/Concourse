package com.concourse;

import static org.assertj.core.api.Assertions.assertThat;

import com.concourse.model.Session;
import com.concourse.model.Venue;
import com.concourse.model.VenueEdge;
import com.concourse.model.VenueNode;
import java.util.List;
import org.junit.jupiter.api.Test;

/**
 * The two bounds that make an unauthenticated position endpoint safe to expose: attendees expire,
 * and a session will not hold an unlimited number of them.
 *
 * <p>Plain JUnit. {@code Session.placeWalker} takes the TTL and the cap as parameters, so these
 * need neither a Spring context nor an injected {@code Clock} — the shortest honest way to test a
 * time-based rule is to make the time a parameter, which it already is.
 */
class WalkerExpiryTest {

    private static final Venue VENUE = new Venue("venue-ttl", "TTL Venue",
            List.of(
                    new VenueNode("gate", "Gate", VenueNode.Type.GATE, 100, 0, 0),
                    new VenueNode("exit", "Exit", VenueNode.Type.EXIT, 100, 100, 0)),
            List.of(new VenueEdge("gate", "exit", 100, 6, true)));

    private static Session session() {
        return new Session("sess-ttl", VENUE, 10, 1, 100, 1.0, false);
    }

    /**
     * An attendee who closes the app stops counting, without anything having to notice they left.
     *
     * <p>This is what lets the phone be foreground-only: there is no goodbye to miss. The DELETE
     * endpoint is a courtesy that makes it immediate, not the mechanism.
     */
    @Test
    void anAttendeeWhoStopsReportingStopsCounting() throws InterruptedException {
        Session session = session();
        session.placeWalker("w-1", "gate", 20, 100);

        assertThat(session.liveOccupancy().get("gate")).isEqualTo(1);

        Thread.sleep(40);

        assertThat(session.walkerCount()).isZero();
        assertThat(session.liveOccupancy().get("gate")).isZero();
        // And the simulated numbers were never touched either way.
        assertThat(session.liveOccupancy()).isEqualTo(session.occupancy());
    }

    /** Reporting again before the TTL lapses keeps an attendee in the venue. */
    @Test
    void reportingAgainExtendsTheStay() throws InterruptedException {
        Session session = session();
        session.placeWalker("w-1", "gate", 60, 100);

        Thread.sleep(30);
        session.placeWalker("w-1", "gate", 60, 100);
        Thread.sleep(30);

        assertThat(session.walkerCount()).isEqualTo(1);
    }

    /**
     * The cap bounds what an unauthenticated endpoint can cost.
     *
     * <p>Note the second assertion: an attendee already being tracked must still be able to move,
     * or a full venue would freeze everyone already in it at whatever zone they last reported —
     * turning a capacity limit into stale data on the operator's map.
     */
    @Test
    void theCapRefusesNewAttendeesButNeverBlocksOneAlreadyHere() {
        Session session = session();

        assertThat(session.placeWalker("w-1", "gate", 60_000, 2)).isTrue();
        assertThat(session.placeWalker("w-2", "gate", 60_000, 2)).isTrue();
        assertThat(session.placeWalker("w-3", "gate", 60_000, 2)).isFalse();

        assertThat(session.placeWalker("w-1", "exit", 60_000, 2)).isTrue();
        assertThat(session.liveOccupancy().get("exit")).isEqualTo(1);
        assertThat(session.liveOccupancy().get("gate")).isEqualTo(1);
    }

    /** Expiry frees space under the cap, so a venue recovers without intervention. */
    @Test
    void expiredAttendeesFreeSpaceUnderTheCap() throws InterruptedException {
        Session session = session();
        assertThat(session.placeWalker("w-1", "gate", 20, 1)).isTrue();
        assertThat(session.placeWalker("w-2", "gate", 20, 1)).isFalse();

        Thread.sleep(40);

        assertThat(session.placeWalker("w-2", "gate", 20, 1)).isTrue();
    }

    /**
     * A zone id the venue no longer has is ignored rather than invented.
     *
     * <p>Reachable when a venue is edited under a live session: the walker map is keyed by id and
     * knows nothing about the graph. Merging blindly would add a key the density loop then
     * divides by a capacity that does not exist.
     */
    @Test
    void aZoneTheVenueNoLongerHasIsIgnored() {
        Session session = session();
        session.placeWalker("w-1", "demolished-zone", 60_000, 100);

        assertThat(session.liveOccupancy()).containsOnlyKeys("gate", "exit");
        assertThat(session.liveOccupancy().values()).allMatch(count -> count == 0);
    }

    @Test
    void leavingRemovesAnAttendeeImmediately() {
        Session session = session();
        session.placeWalker("w-1", "gate", 60_000, 100);
        session.removeWalker("w-1");

        assertThat(session.walkerCount()).isZero();
        assertThat(session.liveOccupancy().get("gate")).isZero();
    }
}
