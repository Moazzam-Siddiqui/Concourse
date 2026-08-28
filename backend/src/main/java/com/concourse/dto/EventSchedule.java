package com.concourse.dto;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotEmpty;
import java.util.List;

/** Arrival plan for an event. Phase ranges use zero-based, end-exclusive ticks. */
public record EventSchedule(
        String eventId,
        String name,
        Integer tickSeconds,
        @NotEmpty @Valid List<SchedulePhase> phases) {

    public int totalTicks() {
        return phases.stream().mapToInt(SchedulePhase::endTick).max().orElse(0);
    }
}
