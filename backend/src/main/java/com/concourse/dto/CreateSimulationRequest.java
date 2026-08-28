package com.concourse.dto;

import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.Valid;

public record CreateSimulationRequest(
        @NotBlank String venueId,
        @Min(1) @Max(500_000) int crowdSize,
        @Min(1) @Max(2_000) Integer ticks,
        @Min(1) Integer arrivalRate,
        @Valid EventSchedule eventSchedule,
        boolean rerouteEnabled) {
}
