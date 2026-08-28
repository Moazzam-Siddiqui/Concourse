package com.concourse.model;

/** Immutable, end-exclusive interval used by the simulation clock. */
public record ArrivalPhase(int startTick, int endTick, int arrivalRate) {

    public boolean contains(int tick) {
        return tick >= startTick && tick < endTick;
    }
}
