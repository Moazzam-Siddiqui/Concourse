package com.concourse.model;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

/**
 * One surveyed point: "this zone is at this latitude and longitude".
 *
 * <p>Three of these fit the transform that turns a phone's GPS fix into venue coordinates. The
 * venue-side point is the node's own {@code (x, y)} — its <em>centre</em> — so the accuracy of
 * the whole feature is bounded by how close to a zone's centre the organiser stood when they
 * recorded the reading.
 *
 * <p>That is why the endpoint's hint text says to anchor on gates and exits: they carry the
 * smallest capacities, and {@code SimulationEngine.nodeRadius} makes zone radius a function of
 * capacity, so a gate's centre is knowable to a few metres where a 900-seat stand's is not.
 */
public record GeoAnchor(
        @NotBlank String nodeId,
        @Min(-90) @Max(90) double lat,
        @Min(-180) @Max(180) double lng) {
}
