package com.concourse.service.geo;

import com.concourse.dto.WalkerPlacement;
import com.concourse.model.GeoAnchor;
import com.concourse.model.Venue;
import com.concourse.model.VenueEdge;
import com.concourse.model.VenueGeoref;
import com.concourse.model.VenueNode;
import com.concourse.service.simulation.SimulationEngine;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Fits a venue's georeference from anchor points, and resolves a GPS fix to a zone.
 *
 * <p>Shaped like {@link com.concourse.service.VenueValidator} on purpose — a final class of
 * static methods that throws 400 for input a caller can fix. The rules live in one place because
 * the fit and the lookup have to agree about what a valid transform is.
 *
 * <h2>Why three anchors and not two</h2>
 *
 * <p>Two points look sufficient: a similarity transform has four degrees of freedom (scale,
 * rotation, and two of translation) and two points give four equations. But writing the venue
 * plane as a complex number, <em>both</em> {@code q = a·p + b} and {@code q = a·p̄ + b} fit two
 * anchors exactly. They differ by a reflection, and two points cannot tell them apart.
 *
 * <p>That would be academic if venue coordinates were a normal right-handed plane. They are not:
 * {@code VenueNode.y} runs <em>downward</em>, in the SVG convention, while north runs up. So the
 * correct fit is usually the reflected one, and a naive implementation picks the other — giving
 * a <b>mirrored venue that fits both anchors perfectly and is silently wrong</b>. An attendee at
 * Gate A is told they are at the gate diagonally opposite. A third anchor resolves handedness
 * from the data instead of from an assumption about how the layout was drawn.
 */
public final class Georef {

    /**
     * Minimum triangle altitude, in metres, for an anchor set to be usable.
     *
     * <p>A thin triangle makes the fit hypersensitive to anchor error: a 10 m GPS error
     * perpendicular to a long side rotates the whole venue by roughly {@code 10/h} radians. At
     * h = 15 m that is already about 38 degrees.
     */
    public static final double MIN_ALTITUDE_M = 15.0;

    /** Two anchors closer than this carry one anchor's worth of information between them. */
    public static final double MIN_SEPARATION_M = 20.0;

    /**
     * How far the fitted scale may disagree with the venue's own, as a ratio either way.
     *
     * <p>The venue already states its scale twice over: {@code VenueEdge.length} is documented in
     * metres while node coordinates are layout units, so their ratio is a second, independent
     * estimate of units-per-metre. Disagreement means an anchor is on the wrong zone.
     */
    public static final double MAX_SCALE_DISAGREEMENT = 3.0;

    private Georef() {
    }

    // ------------------------------------------------------------------ fitting

    /** Fits the transform, or throws 400 naming the measurement that failed. */
    public static VenueGeoref fit(Venue venue, List<GeoAnchor> anchors) {
        if (anchors == null || anchors.size() != 3) {
            throw badRequest("Exactly three anchors are required; got "
                    + (anchors == null ? 0 : anchors.size()));
        }

        Map<String, VenueNode> byId = venue.nodesById();
        for (GeoAnchor anchor : anchors) {
            if (!byId.containsKey(anchor.nodeId())) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                        "Venue %s has no node '%s'".formatted(venue.id(), anchor.nodeId()));
            }
        }
        if (anchors.stream().map(GeoAnchor::nodeId).distinct().count() != 3) {
            throw badRequest("The three anchors must be on three different zones");
        }

        double originLat = anchors.stream().mapToDouble(GeoAnchor::lat).average().orElseThrow();
        double originLng = anchors.stream().mapToDouble(GeoAnchor::lng).average().orElseThrow();
        if (Math.abs(originLat) > 85.0) {
            throw badRequest("Latitude %.4f is too close to the pole for this projection"
                    .formatted(originLat));
        }

        // Anchors in metres east/north. A bare projection object carries the geometry; the
        // affine coefficients are filled in below once they are known.
        VenueGeoref projection = new VenueGeoref(venue.id(), originLat, originLng,
                1, 0, 0, 0, 1, 0, anchors, 0, 0, 0);
        double[][] local = new double[3][];
        for (int i = 0; i < 3; i++) {
            local[i] = projection.toLocalMetres(anchors.get(i).lat(), anchors.get(i).lng());
        }

        checkSpread(local);

        // x = a·E + b·N + c and y = d·E + e·N + f are two 3x3 systems over the same matrix, so
        // one determinant serves both. Cramer's rule keeps this closed-form and dependency-free.
        double e1 = local[0][0], n1 = local[0][1];
        double e2 = local[1][0], n2 = local[1][1];
        double e3 = local[2][0], n3 = local[2][1];

        double det = e1 * (n2 - n3) + e2 * (n3 - n1) + e3 * (n1 - n2);

        VenueNode p1 = byId.get(anchors.get(0).nodeId());
        VenueNode p2 = byId.get(anchors.get(1).nodeId());
        VenueNode p3 = byId.get(anchors.get(2).nodeId());

        double[] xs = solve(det, e1, n1, e2, n2, e3, n3, p1.x(), p2.x(), p3.x());
        double[] ys = solve(det, e1, n1, e2, n2, e3, n3, p1.y(), p2.y(), p3.y());

        double a = xs[0], b = xs[1], c = xs[2];
        double d = ys[0], e = ys[1], f = ys[2];

        double linearDet = a * e - b * d;
        if (Math.abs(linearDet) < 1e-9) {
            throw badRequest("The three anchored zones are in a straight line on the map, "
                    + "which collapses the venue onto a line — pick zones that form a triangle");
        }

        double fittedUnitsPerMetre = Math.sqrt(Math.abs(linearDet));
        checkScaleAgainstEdges(venue, fittedUnitsPerMetre);

        return new VenueGeoref(venue.id(), originLat, originLng, a, b, c, d, e, f, anchors,
                shearDegrees(a, b, d, e), fittedUnitsPerMetre, System.currentTimeMillis());
    }

    /** One row of Cramer's rule: the coefficients mapping (east, north, 1) onto one venue axis. */
    private static double[] solve(double det,
                                  double e1, double n1, double e2, double n2, double e3, double n3,
                                  double v1, double v2, double v3) {
        double da = v1 * (n2 - n3) + v2 * (n3 - n1) + v3 * (n1 - n2);
        double db = e1 * (v2 - v3) + e2 * (v3 - v1) + e3 * (v1 - v2);
        double dc = e1 * (n2 * v3 - n3 * v2) + e2 * (n3 * v1 - n1 * v3) + e3 * (n1 * v2 - n2 * v1);
        return new double[] {da / det, db / det, dc / det};
    }

    /** Rejects anchor sets too small or too flat to fit anything trustworthy. */
    private static void checkSpread(double[][] local) {
        double[] sides = new double[3];
        for (int i = 0; i < 3; i++) {
            double[] p = local[i];
            double[] q = local[(i + 1) % 3];
            sides[i] = Math.hypot(p[0] - q[0], p[1] - q[1]);
            if (sides[i] < MIN_SEPARATION_M) {
                throw badRequest(("Anchors are %.0f m apart; they need at least %.0f m. Two "
                        + "readings inside each other's error circle carry one reading's worth "
                        + "of information.").formatted(sides[i], MIN_SEPARATION_M));
            }
        }

        double area = Math.abs(
                (local[1][0] - local[0][0]) * (local[2][1] - local[0][1])
                        - (local[2][0] - local[0][0]) * (local[1][1] - local[0][1])) / 2.0;
        double longest = Math.max(sides[0], Math.max(sides[1], sides[2]));
        double altitude = 2.0 * area / longest;

        if (altitude < MIN_ALTITUDE_M) {
            throw badRequest(("Anchors are nearly in a straight line (altitude %.1f m, need "
                    + "%.0f m). Pick three zones forming a wide triangle — gates and exits are "
                    + "the best choices, being small and easy to stand in the middle of.")
                    .formatted(altitude, MIN_ALTITUDE_M));
        }
    }

    /**
     * Cross-checks the fitted scale against the one the venue file already implies.
     *
     * <p>Edge lengths are documented in metres and node coordinates are not, so their ratio is an
     * independent estimate of layout units per metre. When the two disagree wildly, the usual
     * cause is an anchor recorded while standing in a different zone from the one named.
     */
    private static void checkScaleAgainstEdges(Venue venue, double fittedUnitsPerMetre) {
        Map<String, VenueNode> byId = venue.nodesById();
        List<Double> ratios = new ArrayList<>();
        for (VenueEdge edge : venue.edges()) {
            VenueNode from = byId.get(edge.from());
            VenueNode to = byId.get(edge.to());
            if (from == null || to == null || edge.length() <= 0) {
                continue;
            }
            double layout = Math.hypot(to.x() - from.x(), to.y() - from.y());
            if (layout > 0) {
                ratios.add(layout / edge.length());
            }
        }
        if (ratios.isEmpty()) {
            return; // nothing to check against; the fit stands on its own
        }

        ratios.sort(Double::compareTo);
        double implied = ratios.get(ratios.size() / 2);
        double disagreement = Math.max(implied / fittedUnitsPerMetre, fittedUnitsPerMetre / implied);

        if (disagreement > MAX_SCALE_DISAGREEMENT) {
            throw badRequest(("Fitted scale is %.3f layout units per metre, but the venue's own "
                    + "edge lengths imply %.3f — a %.0fx disagreement. Check each anchor is on "
                    + "the zone you were actually standing in.")
                    .formatted(fittedUnitsPerMetre, implied, disagreement));
        }
    }

    /** Angle between the images of east and north. 90 degrees means no shear. */
    private static double shearDegrees(double a, double b, double d, double e) {
        double dot = a * b + d * e;
        double magnitudes = Math.hypot(a, d) * Math.hypot(b, e);
        if (magnitudes == 0) {
            return 0;
        }
        double between = Math.toDegrees(Math.acos(Math.max(-1, Math.min(1, dot / magnitudes))));
        return Math.abs(90.0 - between);
    }

    // ------------------------------------------------------------------ resolving

    /**
     * Places a GPS fix in a zone, or explains why it could not be.
     *
     * <p>Nearest node within its own radius, using {@link SimulationEngine#nodeRadius} directly
     * rather than a copy — the frontend already carries one copy of that curve with a comment
     * warning what happens when the two drift, and a third would be worse.
     *
     * <p>The accuracy test is relative, not a fixed number of metres: a fix whose uncertainty
     * circle is larger than the zone it claims does not support the claim, whatever the absolute
     * figure. That also means it works unchanged on a venue drawn at any scale.
     */
    public static WalkerPlacement locate(String walkerId, Venue venue, VenueGeoref georef,
                                         double lat, double lng, double accuracyMetres,
                                         long ttlSeconds) {
        double[] xy = georef.toVenue(lat, lng);
        double accuracyUnits = accuracyMetres * georef.venueUnitsPerMetre();

        VenueNode nearest = null;
        double best = Double.MAX_VALUE;
        for (VenueNode node : venue.nodes()) {
            double distance = Math.hypot(xy[0] - node.x(), xy[1] - node.y());
            if (distance < best) {
                best = distance;
                nearest = node;
            }
        }
        if (nearest == null) {
            throw badRequest("Venue " + venue.id() + " has no nodes");
        }

        WalkerPlacement.State state;
        if (outsideBounds(venue, xy)) {
            state = WalkerPlacement.State.OUTSIDE_VENUE;
        } else if (best > SimulationEngine.nodeRadius(nearest)) {
            state = WalkerPlacement.State.IN_TRANSIT;
        } else if (accuracyUnits > SimulationEngine.nodeRadius(nearest)) {
            state = WalkerPlacement.State.TOO_INACCURATE;
        } else {
            state = WalkerPlacement.State.IN_ZONE;
        }

        return new WalkerPlacement(walkerId,
                state == WalkerPlacement.State.IN_ZONE ? nearest.id() : null,
                state, round(xy[0]), round(xy[1]), round(accuracyUnits),
                state == WalkerPlacement.State.IN_ZONE ? ttlSeconds : 0);
    }

    /**
     * True when a point is outside the venue's own bounding box, grown by the largest zone radius.
     *
     * <p>Distinguished from "between zones" because the two mean different things to a person:
     * one says keep walking, the other says you are not at this venue.
     */
    private static boolean outsideBounds(Venue venue, double[] xy) {
        double minX = Double.MAX_VALUE, maxX = -Double.MAX_VALUE;
        double minY = Double.MAX_VALUE, maxY = -Double.MAX_VALUE;
        double margin = 0;
        for (VenueNode node : venue.nodes()) {
            minX = Math.min(minX, node.x());
            maxX = Math.max(maxX, node.x());
            minY = Math.min(minY, node.y());
            maxY = Math.max(maxY, node.y());
            margin = Math.max(margin, SimulationEngine.nodeRadius(node));
        }
        return xy[0] < minX - margin || xy[0] > maxX + margin
                || xy[1] < minY - margin || xy[1] > maxY + margin;
    }

    private static double round(double value) {
        return Math.round(value * 10) / 10.0;
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
