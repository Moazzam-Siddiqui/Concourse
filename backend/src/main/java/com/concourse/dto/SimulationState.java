package com.concourse.dto;

import java.util.List;

/** One frame: what GET /simulations/{id}/state returns and what the WebSocket pushes. */
public record SimulationState(
        String simulationId,
        String venueId,
        int tick,
        int totalTicks,
        String status,
        List<NodeState> nodes) {
}
