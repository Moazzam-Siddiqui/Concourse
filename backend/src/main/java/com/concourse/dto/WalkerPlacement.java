package com.concourse.dto;

/**
 * Where a walker's reported position put them, and whether it counted.
 *
 * <p>Returned to the phone that sent the fix and to nobody else. {@code x} and {@code y} are
 * echoed so the app can draw its own dot without needing a copy of the transform — the server
 * is the only place the affine lives, so there is no second implementation to drift from it.
 *
 * @param nodeId              the zone they were placed in, or null unless {@code state} is
 *                            IN_ZONE or MANUAL
 * @param accuracyVenueUnits  the fix's reported accuracy converted to layout units, so a client
 *                            can draw a halo at its true size rather than a flattering one
 * @param expiresInSeconds    how long this placement counts for without another fix
 */
public record WalkerPlacement(
        String walkerId,
        String nodeId,
        State state,
        double x,
        double y,
        double accuracyVenueUnits,
        long expiresInSeconds) {

    /**
     * Why a fix did or did not place someone.
     *
     * <p>The three rejections are kept apart because they mean different things to the person
     * holding the phone: move, wait, or you are not here.
     */
    public enum State {
        /** Inside a zone's radius, with an accuracy good enough to believe it. */
        IN_ZONE,
        /** Between zones — walking a corridor. Counted nowhere, which is correct. */
        IN_TRANSIT,
        /** Beyond the venue's own bounding box. Probably not at this venue at all. */
        OUTSIDE_VENUE,
        /** The uncertainty circle is larger than the zone it claims, so the claim is unsupported. */
        TOO_INACCURATE,
        /** Self-declared by tapping a zone, exactly as the web walker has always worked. */
        MANUAL
    }

    public boolean counts() {
        return state == State.IN_ZONE || state == State.MANUAL;
    }
}
