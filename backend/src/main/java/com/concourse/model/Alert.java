package com.concourse.model;

/** A bottleneck warning raised by the DensityDetector for one node at one tick. */
public record Alert(
        String id,
        int tick,
        String nodeId,
        Severity severity,
        double density,
        Trend trend,
        String message) {

    public enum Severity { OK, WARNING, CRITICAL }

    public enum Trend { RISING, FLAT, FALLING }
}
