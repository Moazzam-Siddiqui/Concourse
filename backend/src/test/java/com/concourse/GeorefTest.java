package com.concourse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.within;

import com.concourse.dto.WalkerPlacement;
import com.concourse.model.GeoAnchor;
import com.concourse.model.Venue;
import com.concourse.model.VenueEdge;
import com.concourse.model.VenueGeoref;
import com.concourse.model.VenueNode;
import com.concourse.service.geo.Georef;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

/**
 * The georeference fit and the GPS-to-zone lookup.
 *
 * <p>Plain JUnit, no Spring context — this is arithmetic, and starting a container to check
 * arithmetic makes the suite slower without making it stricter.
 */
class GeorefTest {

    /**
     * A venue laid out on a 1000x400 grid at one layout unit per metre — a 1 km by 400 m site.
     *
     * <p>The scale matters to what this file can test. Zone radius comes from capacity, so a
     * 320-capacity gate is about 18.7 layout units across whatever the venue's scale. Author the
     * same graph at 10 units per metre and that gate is a 1.9 m circle, which no consumer GPS fix
     * can ever resolve — every fix would land as TOO_INACCURATE, correctly. GPS is only useful
     * at zone granularity when zones are tens of metres, and this venue is scaled accordingly.
     *
     * <p>Edge lengths agree with the coordinates at that scale, so the fit's scale cross-check
     * has an honest second opinion to compare against.
     */
    private static Venue venue() {
        return new Venue("venue-test", "Test Arena",
                List.of(
                        new VenueNode("gate-a", "Gate A", VenueNode.Type.GATE, 320, 0, 0),
                        new VenueNode("gate-b", "Gate B", VenueNode.Type.GATE, 320, 0, 400),
                        new VenueNode("mid", "Middle", VenueNode.Type.WALKWAY, 500, 500, 200),
                        new VenueNode("exit-e", "Exit East", VenueNode.Type.EXIT, 400, 1000, 0)),
                List.of(
                        new VenueEdge("gate-a", "mid", 538.5, 6, true),
                        new VenueEdge("gate-b", "mid", 538.5, 6, true),
                        new VenueEdge("mid", "exit-e", 538.5, 6, true)));
    }

    /** Roughly Bengaluru — a mid-latitude origin, so cos(lat) is neither 1 nor tiny. */
    private static final double LAT0 = 12.9716;
    private static final double LNG0 = 77.5946;

    /** Offsets a lat/lng by metres east and north, for building synthetic anchors. */
    private static double[] offset(double east, double north) {
        double lat = LAT0 + Math.toDegrees(north / VenueGeoref.EARTH_RADIUS_M);
        double lng = LNG0 + Math.toDegrees(east / (VenueGeoref.EARTH_RADIUS_M
                * Math.cos(Math.toRadians(LAT0))));
        return new double[] {lat, lng};
    }

    /**
     * Anchors placed so that one layout unit is one metre, with venue y running *south* — the SVG
     * convention the whole three-anchor argument exists to cope with.
     */
    private static List<GeoAnchor> goodAnchors() {
        double[] a = offset(0, 0);        // gate-a  at (0, 0)
        double[] b = offset(0, -400);     // gate-b  at (0, 400): 400 m south
        double[] c = offset(1000, 0);     // exit-e  at (1000, 0): 1000 m east
        return List.of(
                new GeoAnchor("gate-a", a[0], a[1]),
                new GeoAnchor("gate-b", b[0], b[1]),
                new GeoAnchor("exit-e", c[0], c[1]));
    }

    // ------------------------------------------------------------------ the fit

    @Test
    void recoversTheTransformThatGeneratedItsAnchors() {
        VenueGeoref georef = Georef.fit(venue(), goodAnchors());

        // Every anchor must map back onto the node it names.
        double[] gateA = georef.toVenue(goodAnchors().get(0).lat(), goodAnchors().get(0).lng());
        assertThat(gateA[0]).isCloseTo(0, within(0.01));
        assertThat(gateA[1]).isCloseTo(0, within(0.01));

        double[] exit = georef.toVenue(goodAnchors().get(2).lat(), goodAnchors().get(2).lng());
        assertThat(exit[0]).isCloseTo(1000, within(0.01));
        assertThat(exit[1]).isCloseTo(0, within(0.01));

        assertThat(georef.venueUnitsPerMetre()).isCloseTo(1.0, within(0.001));
    }

    /**
     * The handedness case the third anchor exists for.
     *
     * <p>Venue y increases southward while north increases upward, so the correct fit is a
     * reflection. A two-anchor similarity would have fitted the unreflected transform equally
     * well and put Gate B on the wrong side of the venue.
     */
    @Test
    void handlesVenueYRunningSouthWithoutMirroringTheVenue() {
        VenueGeoref georef = Georef.fit(venue(), goodAnchors());

        // 400 m north of the origin is *outside* the venue, at negative y — not at y = +400.
        double[] north = offset(0, 400);
        double[] mapped = georef.toVenue(north[0], north[1]);
        assertThat(mapped[1]).isCloseTo(-400, within(0.01));
    }

    /**
     * Justifies the equirectangular approximation with a measurement rather than a comment.
     *
     * <p>Compared against haversine over a 500 m baseline, which is longer than most venues.
     */
    @Test
    void theProjectionAgreesWithHaversineAtVenueScale() {
        VenueGeoref georef = new VenueGeoref("v", LAT0, LNG0, 1, 0, 0, 0, 1, 0, List.of(), 0, 0, 0);

        double[] far = offset(350, 350); // ~495 m diagonal
        double[] local = georef.toLocalMetres(far[0], far[1]);
        double projected = Math.hypot(local[0], local[1]);

        double haversine = haversineMetres(LAT0, LNG0, far[0], far[1]);
        assertThat(projected).isCloseTo(haversine, within(0.5));
    }

    private static double haversineMetres(double lat1, double lng1, double lat2, double lng2) {
        double dLat = Math.toRadians(lat2 - lat1);
        double dLng = Math.toRadians(lng2 - lng1);
        double h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
                + Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2))
                * Math.sin(dLng / 2) * Math.sin(dLng / 2);
        return 2 * VenueGeoref.EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
    }

    @Test
    void rejectsNearlyCollinearAnchorsRatherThanFittingThemBadly() {
        double[] a = offset(0, 0);
        double[] b = offset(500, 5);    // 500 m along, 5 m off the line
        double[] c = offset(1000, 0);
        List<GeoAnchor> collinear = List.of(
                new GeoAnchor("gate-a", a[0], a[1]),
                new GeoAnchor("gate-b", b[0], b[1]),
                new GeoAnchor("exit-e", c[0], c[1]));

        assertThatThrownBy(() -> Georef.fit(venue(), collinear))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("straight line")
                .hasMessageContaining("altitude");
    }

    @Test
    void rejectsAnchorsTooCloseTogetherToCarrySeparateInformation() {
        double[] a = offset(0, 0);
        double[] b = offset(5, 0);      // 5 m apart, inside each other's GPS error
        double[] c = offset(0, -400);
        List<GeoAnchor> cramped = List.of(
                new GeoAnchor("gate-a", a[0], a[1]),
                new GeoAnchor("exit-e", b[0], b[1]),
                new GeoAnchor("gate-b", c[0], c[1]));

        assertThatThrownBy(() -> Georef.fit(venue(), cramped))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("m apart");
    }

    /**
     * The venue states its own scale twice — layout units and metre edge lengths — so an anchor
     * recorded in the wrong zone is catchable without any external reference.
     */
    @Test
    void catchesAnAnchorOnTheWrongZoneUsingTheVenuesOwnEdgeLengths() {
        // Same triangle shape, but spread over 10 km instead of 1 km.
        double[] a = offset(0, 0);
        double[] b = offset(0, -4000);
        double[] c = offset(10000, 0);
        List<GeoAnchor> wrongScale = List.of(
                new GeoAnchor("gate-a", a[0], a[1]),
                new GeoAnchor("gate-b", b[0], b[1]),
                new GeoAnchor("exit-e", c[0], c[1]));

        assertThatThrownBy(() -> Georef.fit(venue(), wrongScale))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("layout units per metre");
    }

    @Test
    void rejectsAnythingOtherThanThreeAnchors() {
        assertThatThrownBy(() -> Georef.fit(venue(), goodAnchors().subList(0, 2)))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("three anchors");
    }

    @Test
    void rejectsAnAnchorNamingANodeTheVenueDoesNotHave() {
        double[] a = offset(0, 0);
        List<GeoAnchor> unknown = List.of(
                new GeoAnchor("no-such-zone", a[0], a[1]),
                goodAnchors().get(1),
                goodAnchors().get(2));

        assertThatThrownBy(() -> Georef.fit(venue(), unknown))
                .isInstanceOf(ResponseStatusException.class)
                .hasMessageContaining("no node");
    }

    // ------------------------------------------------------------------ the lookup

    private WalkerPlacement locate(double east, double north, double accuracyMetres) {
        VenueGeoref georef = Georef.fit(venue(), goodAnchors());
        double[] fix = offset(east, north);
        return Georef.locate("w-1", venue(), georef, fix[0], fix[1], accuracyMetres, 30);
    }

    @Test
    void aFixAtAZoneCentreResolvesToThatZone() {
        WalkerPlacement placement = locate(0, 0, 5);

        assertThat(placement.state()).isEqualTo(WalkerPlacement.State.IN_ZONE);
        assertThat(placement.nodeId()).isEqualTo("gate-a");
        assertThat(placement.counts()).isTrue();
    }

    /**
     * Between zones is its own answer, not a snap to the nearest.
     *
     * <p>Snapping would put someone walking a corridor into whichever zone happened to be closer
     * and count them against its capacity, inventing density that is not there.
     */
    @Test
    void aFixBetweenZonesIsInTransitAndCountsNowhere() {
        // Halfway between gate-a (0,0) and mid (500,200): 250 m east, 100 m south. That is well
        // outside gate-a's 18.7 m radius and mid's 21.4 m one.
        WalkerPlacement placement = locate(250, -100, 5);

        assertThat(placement.state()).isEqualTo(WalkerPlacement.State.IN_TRANSIT);
        assertThat(placement.nodeId()).isNull();
        assertThat(placement.counts()).isFalse();
    }

    @Test
    void aFixFarOutsideTheVenueIsReportedAsSuchRatherThanClampedOrNaN() {
        WalkerPlacement placement = locate(50_000, 50_000, 5);

        assertThat(placement.state()).isEqualTo(WalkerPlacement.State.OUTSIDE_VENUE);
        assertThat(placement.nodeId()).isNull();
        assertThat(placement.x()).isNotNaN();
        assertThat(placement.y()).isNotNaN();
    }

    /**
     * The accuracy gate is relative to the zone, not a fixed number of metres.
     *
     * <p>gate-a has capacity 320, so its radius is about 18.7 m at this venue's scale. A 200 m
     * fix cannot support a claim about a zone that size, even though it is centred exactly on it.
     */
    @Test
    void anInaccurateFixIsRejectedRatherThanPlacedInTheWrongZone() {
        WalkerPlacement placement = locate(0, 0, 200);

        assertThat(placement.state()).isEqualTo(WalkerPlacement.State.TOO_INACCURATE);
        assertThat(placement.nodeId()).isNull();
        assertThat(placement.counts()).isFalse();
    }

    @Test
    void reportsAccuracyInLayoutUnitsSoAClientCanDrawItHonestly() {
        WalkerPlacement placement = locate(0, 0, 1.5);

        // One layout unit per metre here, so the reported figure passes through unchanged.
        assertThat(placement.accuracyVenueUnits()).isCloseTo(1.5, within(0.1));
    }
}
