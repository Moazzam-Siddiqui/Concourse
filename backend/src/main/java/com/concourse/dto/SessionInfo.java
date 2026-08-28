package com.concourse.dto;

import com.concourse.model.Session;

/** What {@code GET /sessions/{id}} returns: the session's shape and where it has got to. */
public record SessionInfo(
        String sessionId,
        String venueId,
        String venueName,
        String status,
        int tick,
        int maxTicks,
        int crowdSize,
        int arrivalRate,
        double tickSeconds,
        boolean rerouteEnabled,
        int peopleInside,
        int spawned,
        int exited,
        int viewers,
        int alertCount,
        String aiStatus,
        String latestAdvisory) {

    public static SessionInfo of(Session session, int viewers) {
        return new SessionInfo(
                session.getId(),
                session.getVenue().id(),
                session.getVenue().name(),
                session.getStatus().name(),
                session.getTick(),
                session.getMaxTicks(),
                session.getCrowdSize(),
                session.getArrivalRate(),
                session.getTickSeconds(),
                session.isRerouteEnabled(),
                // Reads the published snapshot, not the live agent list — that list belongs
                // to the tick thread and this runs on a request thread.
                session.getLatestState() == null ? 0 : session.getLatestState().metrics().peopleInside(),
                session.getSpawned(),
                session.getExited(),
                viewers,
                session.getAlerts().size(),
                session.getAiStatus(),
                session.getLatestAdvisory());
    }
}
