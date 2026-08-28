package com.concourse.dto;

import com.concourse.model.Session;

/**
 * Post-run stats for a session, with the before/after comparison that is the point of the
 * whole system: the same crowd, same venue, same seed, run with and without rerouting.
 *
 * <p>When the session had rerouting off there is no twin, so {@code baseline} and
 * {@code optimised} are the same numbers and the narrative says so rather than implying a
 * comparison that was never made.
 */
public record SessionSummary(
        String sessionId,
        String venueId,
        String venueName,
        String status,
        int ticks,
        double simulationSeconds,
        boolean comparisonAvailable,
        Metrics baseline,
        Metrics optimised,
        String narrative) {

    /**
     * @param criticalNodeTicks zone-ticks spent above the critical threshold — the headline
     *                          safety number. Peak density and zone count both mislead: one
     *                          undersized kiosk pins peak at 1.0, and spreading a crowd out
     *                          (the whole point) touches more zones, not fewer.
     */
    public record Metrics(
            double peakDensity,
            int criticalNodeTicks,
            int bottleneckCount,
            int spawned,
            int exited,
            int stillInside) {

        public static Metrics of(Session session) {
            return new Metrics(
                    Math.round(session.getPeakDensity() * 100) / 100.0,
                    session.getCriticalNodeTicks(),
                    session.getBottleneckNodes().size(),
                    session.getSpawned(),
                    session.getExited(),
                    session.getPeople().size());
        }
    }

    public static SessionSummary of(Session session, Session baseline) {
        Metrics optimised = Metrics.of(session);
        Metrics before = baseline == null ? optimised : Metrics.of(baseline);
        return new SessionSummary(
                session.getId(),
                session.getVenue().id(),
                session.getVenue().name(),
                session.getStatus().name(),
                session.getTick(),
                Math.round(session.getTick() * session.getTickSeconds() * 10) / 10.0,
                baseline != null,
                before,
                optimised,
                narrate(before, optimised, baseline != null));
    }

    private static String narrate(Metrics baseline, Metrics optimised, boolean compared) {
        if (!compared) {
            return "Run spent %d zone-ticks above the critical threshold, peaking at %d%%. Enable rerouting to get a before/after comparison."
                    .formatted(optimised.criticalNodeTicks(), pct(optimised.peakDensity()));
        }
        int before = baseline.criticalNodeTicks();
        int after = optimised.criticalNodeTicks();
        if (before == 0) {
            return "Neither run went critical on this layout — nothing to compare. Try a larger crowd or a higher arrival rate.";
        }
        if (after >= before) {
            return "Rerouting did not reduce time spent in the red (%d → %d zone-ticks) on this layout."
                    .formatted(before, after);
        }
        // Deliberately no throughput comparison. The untreated run usually gets *more* people
        // through, because it never holds intake — it achieves that by packing gates several
        // times over capacity, which is the thing we are preventing. Quoting exits side by
        // side reads as rerouting being worse, with none of that context.
        return "Rerouting cut time above the critical threshold by %d%% (%d to %d zone-ticks), and held the worst zone to %d%% of capacity instead of %d%%."
                .formatted(Math.round((before - after) * 100.0 / before), before, after,
                        pct(optimised.peakDensity()), pct(baseline.peakDensity()));
    }

    private static int pct(double density) {
        return (int) Math.round(density * 100);
    }
}
