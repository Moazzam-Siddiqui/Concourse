package com.concourse.controller;

import com.concourse.config.CacheConfig;
import com.concourse.dto.GeorefRequest;
import com.concourse.model.ReroutePath;
import com.concourse.model.Venue;
import com.concourse.model.VenueGeoref;
import com.concourse.repository.FileVenueRepository;
import com.concourse.repository.GeorefRepository;
import com.concourse.repository.VenueRepository;
import java.util.List;
import com.concourse.service.VenueValidator;
import com.concourse.service.geo.Georef;
import com.concourse.service.routing.RerouteEngine;
import jakarta.validation.Valid;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.cache.annotation.Caching;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

@RestController
@RequestMapping("/venues")
public class VenueController {

    private final VenueRepository venues;
    private final GeorefRepository georefs;
    private final RerouteEngine routeEngine;

    public VenueController(VenueRepository venues, GeorefRepository georefs, RerouteEngine routeEngine) {
        this.venues = venues;
        this.georefs = georefs;
        this.routeEngine = routeEngine;
    }

    /**
     * Uploads a venue layout. An id is generated when the payload omits one.
     *
     * <p>Clears all three read caches rather than just this venue's entry. The list cache is
     * a single entry covering every venue, and a new or changed layout invalidates any route
     * previously computed over it, so a targeted eviction would leave stale paths pointing
     * through walls that moved.
     */
    @PostMapping
    @ResponseStatus(HttpStatus.CREATED)
    @Caching(evict = {
            @CacheEvict(cacheNames = CacheConfig.VENUES, allEntries = true),
            @CacheEvict(cacheNames = CacheConfig.VENUE_LIST, allEntries = true),
            @CacheEvict(cacheNames = CacheConfig.VENUE_ROUTES, allEntries = true)
    })
    public Venue create(@Valid @RequestBody Venue venue) {
        VenueValidator.validate(venue);
        return venues.save(venue);
    }

    @GetMapping("/{id}")
    @Cacheable(cacheNames = CacheConfig.VENUES, key = "#id")
    public Venue get(@PathVariable String id) {
        return venues.getOrThrow(id);
    }

    /**
     * {@code GET /venues} — every stored venue.
     *
     * <p>Exists so an attendee's venue code resolves even when no session is running on it.
     * Previously the walker portal could only find a venue through {@code GET /sessions}, so a
     * code printed on signage stopped working the moment the operator stopped the run — the
     * building was still there, but the app said the code was unknown. A venue outlives any
     * one session, and this endpoint is what makes the code outlive it too.
     */
    @GetMapping
    @Cacheable(cacheNames = CacheConfig.VENUE_LIST)
    public List<Venue> list() {
        return venues instanceof FileVenueRepository store ? store.findAll() : List.of();
    }

    /**
     * {@code GET /venues/{id}/route?from={nodeId}} — the walking path from a zone to the
     * nearest EXIT, by distance over the venue's own edges.
     *
     * <p>Exists for the attendee-facing map, which needs to draw a real way out rather than a
     * straight line through the walls. Runs the same Dijkstra the simulation uses to route its
     * agents, so what an attendee is shown is what the crowd is actually doing.
     *
     * <p>Static: it does not consider live congestion, because a venue can be looked at with
     * no session running. Diversions around a jam arrive on the session stream instead.
     */
    @GetMapping("/{id}/route")
    @Cacheable(cacheNames = CacheConfig.VENUE_ROUTES, key = "#id + '|' + #from")
    public ReroutePath route(@PathVariable String id, @RequestParam String from) {
        Venue venue = venues.getOrThrow(id);
        if (!venue.nodesById().containsKey(from)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND,
                    "Venue %s has no node '%s'".formatted(id, from));
        }
        return routeEngine.nearestExit(venue, from);
    }

    /**
     * {@code PUT /venues/{id}/georef} — ties the layout to the real world.
     *
     * <p>Three anchors: for each, the zone you are standing in and the latitude/longitude your
     * phone reports there. From those, {@link Georef} fits the transform that turns an attendee's
     * GPS fix into a zone. Without it a venue simply has no GPS, and the mobile app falls back to
     * the same self-declared zone tap the web walker has always used.
     *
     * <p>{@code PUT} rather than {@code POST}: this replaces one named sub-resource, and sending
     * the same three anchors twice should mean the same thing as sending them once.
     */
    @PutMapping("/{id}/georef")
    public VenueGeoref setGeoref(@PathVariable String id, @Valid @RequestBody GeorefRequest request) {
        Venue venue = venues.getOrThrow(id);
        return georefs.save(Georef.fit(venue, request.anchors()));
    }

    /** 404 when the venue has no georeference, which is the ordinary case rather than an error. */
    @GetMapping("/{id}/georef")
    public VenueGeoref getGeoref(@PathVariable String id) {
        venues.getOrThrow(id);
        return georefs.getOrThrow(id);
    }

    @DeleteMapping("/{id}/georef")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    public void clearGeoref(@PathVariable String id) {
        venues.getOrThrow(id);
        georefs.delete(id);
    }
}
