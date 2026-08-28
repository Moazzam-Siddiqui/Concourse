package com.concourse.service.simulation;

/**
 * How many people show up at each moment of a run.
 *
 * <p>The engine used to admit a flat {@code arrivalRate} every tick until the crowd was spent,
 * which is not how anyone arrives at anything. A flat rate produces a gate queue that is either
 * always fine or always broken, and it never reproduces the two moments that actually hurt: the
 * push just before an event starts, and everybody leaving the instant it ends.
 *
 * <p>The shape here is the standard one for a scheduled event:
 *
 * <pre>
 *   arrivals   ▁▂▄▆█▆▃▁▁▁▁▁▁▁▁     doors open … event starts
 *   departures ▁▁▁▁▁▁▁▁▁▁▂▅█▇▃▁                    … event ends
 *              |&lt;--- event --&gt;|
 * </pre>
 *
 * <p>Arrivals ramp up, peak shortly before the start, then fall away to stragglers. Departures
 * are the mirror image and much sharper, because an event ending is a single instant applied to
 * everyone at once — which is exactly the load an evacuation plan has to survive.
 *
 * <p>Expressed as a fraction of the run rather than in absolute ticks, so the same curve is
 * meaningful whether a run is five minutes or an hour.
 */
public final class ArrivalCurve {

    /** Fraction of the run spent admitting people before the event proper begins. */
    private static final double DOORS_OPEN_UNTIL = 0.35;

    /** Where in the run the arrival rate peaks — late in the doors-open window. */
    private static final double ARRIVAL_PEAK = 0.24;

    /** Fraction of the run at which the event ends and the exit surge starts. */
    private static final double EVENT_ENDS = 0.72;

    /** Steepness of the departure surge. Higher empties the venue faster. */
    private static final double SURGE_SHARPNESS = 3.2;

    private ArrivalCurve() {
    }

    /**
     * The share of this tick's nominal arrival rate that should actually be admitted.
     *
     * <p>Returns a multiplier on {@code arrivalRate}, in roughly {@code [0, 1.6]} — above one at
     * the peak, because the nominal rate is an average and a peak that never exceeds the average
     * is not a peak.
     *
     * @param tick     current tick
     * @param maxTicks length of the run
     */
    public static double arrivalMultiplier(int tick, int maxTicks) {
        if (maxTicks <= 0) {
            return 1.0;
        }
        double t = Math.min(1.0, Math.max(0.0, (double) tick / maxTicks));

        if (t > DOORS_OPEN_UNTIL) {
            // Latecomers only. Non-zero on purpose: a venue is never quite done filling, and a
            // hard cutoff makes the gate density fall off a cliff in a way no real gate does.
            return 0.06;
        }

        // A smooth hump peaking at ARRIVAL_PEAK. Gaussian rather than triangular so the rate
        // changes gradually — a kink in the arrival rate shows up as a visible step in the
        // density trace and gets mistaken for a bug in the detector.
        double spread = DOORS_OPEN_UNTIL * 0.42;
        double z = (t - ARRIVAL_PEAK) / spread;
        return 0.12 + 1.45 * Math.exp(-0.5 * z * z);
    }

    /**
     * True once the event has ended and people should be heading for the exits.
     *
     * <p>The engine uses this to flip agents out of their dwell early: when the event ends,
     * everyone still sitting gets up, which is the surge.
     */
    public static boolean eventHasEnded(int tick, int maxTicks) {
        return maxTicks > 0 && (double) tick / maxTicks >= EVENT_ENDS;
    }

    /**
     * Share of the still-seated crowd that stands up on this tick, once the event has ended.
     *
     * <p>Not everyone at once: a venue does not empty in a single tick, and modelling it that
     * way would put every agent in the concourse simultaneously and overstate the crush. The
     * rate climbs as the surge proceeds, so the leading edge is the busiest — which is what
     * observed egress data shows.
     */
    public static double departureFraction(int tick, int maxTicks) {
        if (!eventHasEnded(tick, maxTicks)) {
            return 0.0;
        }
        double progress = ((double) tick / maxTicks - EVENT_ENDS) / (1.0 - EVENT_ENDS);
        return Math.min(1.0, 0.02 + progress * SURGE_SHARPNESS * 0.05);
    }

    /** Human-readable phase, for the UI clock. */
    public static String phase(int tick, int maxTicks) {
        if (maxTicks <= 0) {
            return "IDLE";
        }
        double t = (double) tick / maxTicks;
        if (t < DOORS_OPEN_UNTIL) {
            return "DOORS OPEN";
        }
        if (t < EVENT_ENDS) {
            return "EVENT RUNNING";
        }
        return "EGRESS";
    }
}
