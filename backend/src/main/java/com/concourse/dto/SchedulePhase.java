package com.concourse.dto;

import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.NotBlank;

/** One interval of arrivals in an {@link EventSchedule}. */
public record SchedulePhase(
        @NotBlank String name,
        @Min(0) int startTick,
        @Min(1) int endTick,
        @Min(0) int arrivalRate,
        String note) {
}
