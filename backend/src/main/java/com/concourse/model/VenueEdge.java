package com.concourse.model;

import com.fasterxml.jackson.annotation.JsonProperty;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Positive;

/**
 * A walkable connection between two nodes.
 *
 * @param length metres — used as the Dijkstra edge weight
 * @param width  metres — caps how many people can traverse per tick
 */
public record VenueEdge(
        @JsonProperty("from") @NotBlank String from,
        @JsonProperty("to") @NotBlank String to,
        @Positive double length,
        @Positive double width,
        boolean bidirectional) {

    /** Rough throughput ceiling: ~1.3 people per metre of width per second. */
    public int throughputPerTick() {
        return (int) Math.max(1, width * 1.3 * 10);
    }
}
