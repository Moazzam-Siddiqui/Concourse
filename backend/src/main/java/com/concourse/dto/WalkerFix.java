package com.concourse.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;

/**
 * Body of {@code PUT /sessions/{id}/walkers/{walkerId}} — where an attendee says they are.
 *
 * <p>Exactly one of two forms, and the endpoint rejects anything else:
 *
 * <pre>
 *   { "lat": 12.9716, "lng": 77.5946, "accuracyMetres": 8.4 }   a GPS fix
 *   { "nodeId": "gate-a" }                                       a tapped zone
 * </pre>
 *
 * <p>Both arrive on the same path on purpose. The self-declared form is what the web walker has
 * always done and what the phone falls back to when permission is denied or the venue has no
 * georeference — so the fallback is the same feature with a different sensor, not a lesser one
 * bolted on beside it.
 *
 * <p>{@code lat}/{@code lng} are used to work out a zone and then discarded. Nothing here is
 * stored.
 */
public record WalkerFix(
        @Min(-90) @Max(90) Double lat,
        @Min(-180) @Max(180) Double lng,
        @Min(0) Double accuracyMetres,
        String nodeId) {

    public boolean isGps() {
        return lat != null && lng != null && accuracyMetres != null;
    }

    public boolean isManual() {
        return nodeId != null && !nodeId.isBlank();
    }
}
