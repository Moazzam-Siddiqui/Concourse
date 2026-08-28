package com.concourse.model;

import com.fasterxml.jackson.annotation.JsonIgnore;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;

/**
 * One zone in the venue graph. Matches a "nodes" entry in
 * sample-data/venue-layout-sample.json.
 *
 * @param capacity people the zone holds before it is considered full
 * @param x        layout coordinate for the map (SVG units, not metres)
 */
public record VenueNode(
        @NotBlank String id,
        @NotBlank String name,
        @NotNull Type type,
        @Min(1) int capacity,
        double x,
        double y) {

    public enum Type {
        GATE,       // people enter here
        WALKWAY,    // transit only
        CONCESSION, // people linger here
        SEATING,
        EXIT        // people leave the venue here
    }

    // @JsonIgnore: derived from type — without it Jackson adds "entry"/"exit" to the payload.
    @JsonIgnore
    public boolean isEntry() {
        return type == Type.GATE;
    }

    @JsonIgnore
    public boolean isExit() {
        return type == Type.EXIT;
    }
}
