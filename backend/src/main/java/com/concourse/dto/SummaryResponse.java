package com.concourse.dto;

public record SummaryResponse(
        String simulationId,
        int ticks,
        double peakDensity,
        int bottleneckCount,
        Metrics baseline,
        Metrics optimised,
        String narrative) {

    /**
     * @param bottleneckCount   distinct zones that went critical at any point
     * @param criticalNodeTicks total zone-ticks spent above the critical threshold — the
     *                          headline safety number. Peak density and zone count both
     *                          mislead here: one undersized kiosk pins peak at 100%, and
     *                          spreading a crowd out (the whole point) touches more zones.
     */
    public record Metrics(double peakDensity, int bottleneckCount, int criticalNodeTicks, int avgClearTicks) {
    }
}
