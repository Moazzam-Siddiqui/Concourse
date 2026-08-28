package com.concourse.service.simulation;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Helbing–Molnár social force model.
 *
 * <p>Three terms, all returning an acceleration in layout-units per tick²:
 * a driving term pulling an agent toward its next waypoint, an exponential repulsion between
 * agents (this is what "handling collisions" actually is — people slow and swerve rather
 * than overlap), and the same exponential against corridor walls.
 *
 * <p>{@link #congestionSlowdown} stays because the older flow-based
 * {@link SimulationEngine#advanceTick} still uses it; the per-agent path below does not.
 *
 * <p><b>Units and tuning.</b> Everything here works in venue layout units (the same x/y a
 * {@code VenueNode} carries), not metres, and one integration step is one tick. The
 * constants are therefore calibration knobs, not physical constants — the published
 * Helbing values assume metres and seconds. They are bound from {@code social-force.*} in
 * application.yml so the crowd can be re-tuned against a layout without a rebuild.
 */
@Component
public class SocialForceModel {

    /** Density at which movement effectively stops (people per unit of capacity). */
    private static final double JAM_DENSITY = 1.0;

    /** Ceiling on a single repulsion term, so two coincident agents cannot launch each other. */
    private static final double MAX_REPULSION = 40.0;

    private final double relaxationTicks;
    private final double agentStrength;
    private final double agentRange;
    private final double wallStrength;
    private final double wallRange;

    @Autowired
    public SocialForceModel(
            @Value("${social-force.relaxation-ticks:3.0}") double relaxationTicks,
            @Value("${social-force.agent-strength:2.2}") double agentStrength,
            @Value("${social-force.agent-range:2.6}") double agentRange,
            @Value("${social-force.wall-strength:4.0}") double wallStrength,
            @Value("${social-force.wall-range:2.0}") double wallRange) {
        this.relaxationTicks = relaxationTicks;
        this.agentStrength = agentStrength;
        this.agentRange = agentRange;
        this.wallStrength = wallStrength;
        this.wallRange = wallRange;
    }

    /** Defaults, for tests and any caller that does not want the Spring context. */
    public SocialForceModel() {
        this(3.0, 2.2, 2.6, 4.0, 2.0);
    }

    /**
     * Speed multiplier in [0.05, 1.0] for walking <em>into</em> a space at the given density —
     * the denser the destination, the slower you get through. Linear falloff, a reasonable
     * stand-in for the real fundamental diagram.
     */
    public double congestionSlowdown(double density) {
        double clamped = Math.max(0.0, Math.min(JAM_DENSITY, density));
        return Math.max(0.05, 1.0 - clamped * 0.9);
    }

    /**
     * Driving term: {@code (v_desired * e_goal - v) / tau}. Accelerates an agent toward its
     * goal at its own preferred speed and bleeds off any velocity pointing elsewhere.
     */
    public double[] drivingForce(double[] position, double[] velocity, double[] goal, double desiredSpeed) {
        double dx = goal[0] - position[0];
        double dy = goal[1] - position[1];
        double distance = Math.hypot(dx, dy);
        if (distance < 1e-9) {
            // Standing on the goal: shed velocity rather than accelerate in a random direction.
            return new double[] {-velocity[0] / relaxationTicks, -velocity[1] / relaxationTicks};
        }
        double wantedX = desiredSpeed * dx / distance;
        double wantedY = desiredSpeed * dy / distance;
        return new double[] {
                (wantedX - velocity[0]) / relaxationTicks,
                (wantedY - velocity[1]) / relaxationTicks};
    }

    /**
     * Repulsion felt by the agent at {@code positionA} from the one at {@code positionB}:
     * {@code A * exp((r_ij - d_ij) / B) * n_ij}, pointing away from B.
     *
     * @param radiusSum combined body radius of the pair — repulsion is at full strength when
     *                  they are exactly touching and grows sharply if they overlap
     */
    public double[] agentRepulsion(double[] positionA, double[] positionB, double radiusSum) {
        double dx = positionA[0] - positionB[0];
        double dy = positionA[1] - positionB[1];
        double distance = Math.hypot(dx, dy);
        if (distance < 1e-6) {
            // Exactly coincident: no defined direction, so push along +x deterministically
            // rather than dividing by zero. Tests depend on this being reproducible.
            return new double[] {Math.min(MAX_REPULSION, agentStrength * Math.exp(radiusSum / agentRange)), 0.0};
        }
        double magnitude = Math.min(MAX_REPULSION,
                agentStrength * Math.exp((radiusSum - distance) / agentRange));
        return new double[] {magnitude * dx / distance, magnitude * dy / distance};
    }

    /**
     * Repulsion from a wall segment, same exponential form as {@link #agentRepulsion} but
     * measured on the perpendicular distance to the segment. The agent's body radius is
     * folded into {@code social-force.wall-range} rather than passed in, because the wall
     * terms only ever act on the corridor edges and every agent has the same footprint there.
     */
    public double[] wallRepulsion(double[] position, double[] wallStart, double[] wallEnd) {
        double wx = wallEnd[0] - wallStart[0];
        double wy = wallEnd[1] - wallStart[1];
        double lengthSquared = wx * wx + wy * wy;

        // Project the agent onto the segment, clamped to its endpoints.
        double t = lengthSquared < 1e-12
                ? 0.0
                : Math.max(0.0, Math.min(1.0,
                        ((position[0] - wallStart[0]) * wx + (position[1] - wallStart[1]) * wy) / lengthSquared));
        double nearestX = wallStart[0] + t * wx;
        double nearestY = wallStart[1] + t * wy;

        double dx = position[0] - nearestX;
        double dy = position[1] - nearestY;
        double distance = Math.hypot(dx, dy);
        if (distance < 1e-6) {
            return new double[] {0.0, 0.0}; // on the wall line: no defined normal, let driving win
        }
        double magnitude = Math.min(MAX_REPULSION, wallStrength * Math.exp(-distance / wallRange));
        return new double[] {magnitude * dx / distance, magnitude * dy / distance};
    }
}
