package com.concourse.repository;

import com.concourse.model.VenueGeoref;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

// ponytail: process memory only, same as every other repository here — swap for JPA when a
// venue's georeference needs to outlive a restart.
@Repository
public class InMemoryGeorefRepository implements GeorefRepository {

    private final Map<String, VenueGeoref> georefs = new ConcurrentHashMap<>();

    @Override
    public VenueGeoref save(VenueGeoref georef) {
        georefs.put(georef.venueId(), georef);
        return georef;
    }

    @Override
    public Optional<VenueGeoref> findByVenueId(String venueId) {
        return Optional.ofNullable(georefs.get(venueId));
    }

    @Override
    public void delete(String venueId) {
        georefs.remove(venueId);
    }
}
