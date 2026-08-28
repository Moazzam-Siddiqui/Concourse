package com.concourse.service.simulation;

import com.concourse.model.Person;
import com.concourse.model.VenueNode;
import java.util.ArrayList;
import java.util.List;
import java.util.Random;
import org.springframework.stereotype.Component;

/**
 * Builds the crowd mix for a run: a share of families that move slower and cluster, and solo
 * attendees that move at full speed.
 *
 * <p>Serves both simulation modes. {@link #cohortSpeedFactor} is the aggregate multiplier the
 * older flow-based {@link SimulationEngine#advanceTick} scales node throughput by;
 * {@link #createAgents} emits the individual {@link Person} agents the session tick loop
 * integrates under the social force model.
 */
@Component
public class AgentFactory {

    /** Share of the crowd arriving as families/groups; the rest are solo attendees. */
    public static final double FAMILY_SHARE = 0.35;

    /** Families move ~30% slower and cluster; solo attendees move at full speed. */
    private static final double FAMILY_SPEED = 0.7;
    private static final double SOLO_SPEED = 1.0;

    /** Body radius in layout units. One value for everybody — see SocialForceModel on units. */
    private static final double BODY_RADIUS = 2.0;

    /** Per-person variation, so a crowd does not move as one rigid block. */
    private static final double SPEED_JITTER = 0.15;

    /**
     * Weighted average walking-speed multiplier for a crowd of this size.
     * Used by {@link SimulationEngine} to scale how many people clear a node per tick.
     */
    public double cohortSpeedFactor(int crowdSize) {
        return FAMILY_SHARE * FAMILY_SPEED + (1 - FAMILY_SHARE) * SOLO_SPEED;
    }

    /**
     * Spawns {@code count} agents scattered inside {@code spawnNode}. Routes are left empty —
     * the caller assigns them, because only it knows where these people are trying to get to.
     *
     * @param idPrefix    unique per session so agent ids never collide across sessions
     * @param startIndex  running spawn counter, appended to {@code idPrefix}
     * @param baseSpeed   layout units per tick for a solo attendee
     * @param spawnRadius how far from the node centre people may appear
     */
    public List<Person> createAgents(int count, VenueNode spawnNode, String idPrefix, int startIndex,
                                     double baseSpeed, double spawnRadius, Random random) {
        List<Person> agents = new ArrayList<>(Math.max(0, count));
        for (int i = 0; i < count; i++) {
            boolean family = random.nextDouble() < FAMILY_SHARE;
            double speed = baseSpeed
                    * (family ? FAMILY_SPEED : SOLO_SPEED)
                    * (1 + (random.nextDouble() * 2 - 1) * SPEED_JITTER);

            // Uniform over the disc, not the radius — sqrt keeps people from bunching at the centre.
            double angle = random.nextDouble() * 2 * Math.PI;
            double distance = spawnRadius * Math.sqrt(random.nextDouble());

            agents.add(new Person(
                    idPrefix + "-" + (startIndex + i),
                    family ? Person.Type.FAMILY : Person.Type.SOLO,
                    speed,
                    BODY_RADIUS,
                    spawnNode.x() + distance * Math.cos(angle),
                    spawnNode.y() + distance * Math.sin(angle),
                    spawnNode.id()));
        }
        return agents;
    }
}
