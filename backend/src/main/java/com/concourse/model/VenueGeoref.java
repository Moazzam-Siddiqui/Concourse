package com.concourse.model;

import java.util.List;

/**
 * The fitted transform from latitude/longitude to a venue's own layout coordinates.
 *
 * <p>Two stages. First an equirectangular projection about the anchor centroid turns degrees
 * into metres east/north; then an affine map turns metres into the layout units
 * {@link VenueNode} uses:
 *
 * <pre>
 *   x = a·east + b·north + c
 *   y = d·east + e·north + f
 * </pre>
 *
 * <p><b>Why equirectangular is enough.</b> Over a 500 m venue, holding {@code cos(lat)} constant
 * costs about 4 cm, and treating the earth as a sphere rather than an ellipsoid costs up to
 * ~1.6 m — but that second one is a uniform scale bias, and the anchors are expressed in this
 * same projection, so the fitted scale absorbs it. Consumer GNSS is 5–15 m in the open and
 * 20–50 m under a roof. The projection error sits about three orders of magnitude below the
 * sensor noise; anything more elaborate would be measuring the paint on a ruler we are reading
 * with our eyes shut.
 *
 * <p>{@code shearDegrees} and {@code scaleRatio} are diagnostics, deliberately reported rather
 * than enforced — the same instinct that makes {@code aiStatus} visible on a session. A stylised
 * layout genuinely has shear; a large one more likely means the fit is absorbing anchor error,
 * and the organiser is better placed to judge which.
 */
public record VenueGeoref(
        String venueId,
        double originLat,
        double originLng,
        double a, double b, double c,
        double d, double e, double f,
        List<GeoAnchor> anchors,
        double shearDegrees,
        double scaleRatio,
        long setAtMillis) {

    /** IUGG mean earth radius. */
    public static final double EARTH_RADIUS_M = 6_371_008.8;

    /** Metres east and north of the georeference origin. */
    public double[] toLocalMetres(double lat, double lng) {
        double east = EARTH_RADIUS_M * Math.toRadians(lng - originLng)
                * Math.cos(Math.toRadians(originLat));
        double north = EARTH_RADIUS_M * Math.toRadians(lat - originLat);
        return new double[] {east, north};
    }

    /** A GPS fix as venue layout coordinates. */
    public double[] toVenue(double lat, double lng) {
        double[] local = toLocalMetres(lat, lng);
        return new double[] {
                a * local[0] + b * local[1] + c,
                d * local[0] + e * local[1] + f,
        };
    }

    /**
     * Layout units per metre, from the square root of the linear part's determinant.
     *
     * <p>This is what turns a fix's reported accuracy in metres into the same units as a zone's
     * radius, so the two can be compared without either side knowing the venue's scale.
     */
    public double venueUnitsPerMetre() {
        return Math.sqrt(Math.abs(a * e - b * d));
    }
}
