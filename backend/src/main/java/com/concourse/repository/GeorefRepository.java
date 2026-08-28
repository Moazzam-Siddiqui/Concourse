package com.concourse.repository;

import com.concourse.model.VenueGeoref;
import java.util.Optional;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * Georeferences, kept apart from the venues they describe.
 *
 * <p>A venue is a value object: it travels inline inside {@code POST /sessions} and a running
 * {@code Session} captures it by reference for its whole life. A georeference is operational
 * state — set later, by a different person, from inside the building, and changed when a pin is
 * moved. Putting it on the record would mean replacing a venue that live sessions are still
 * holding, which is an aliasing bug waiting for its first organiser.
 *
 * <p>Keeping it separate also makes the common case structural rather than conditional: a venue
 * with no georeference is an empty Optional, not a null-or-empty-or-degenerate list.
 */
public interface GeorefRepository {

    VenueGeoref save(VenueGeoref georef);

    Optional<VenueGeoref> findByVenueId(String venueId);

    void delete(String venueId);

    default VenueGeoref getOrThrow(String venueId) {
        return findByVenueId(venueId).orElseThrow(() -> new ResponseStatusException(
                HttpStatus.NOT_FOUND, "Venue %s is not georeferenced".formatted(venueId)));
    }
}
