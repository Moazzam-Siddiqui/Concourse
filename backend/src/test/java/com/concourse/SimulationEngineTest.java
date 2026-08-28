package com.concourse;

import static org.assertj.core.api.Assertions.assertThat;

import com.concourse.model.Alert;
import com.concourse.model.ArrivalPhase;
import com.concourse.model.ReroutePath;
import com.concourse.model.SimulationRun;
import com.concourse.model.Venue;
import com.concourse.model.VenueEdge;
import com.concourse.model.VenueNode;
import com.concourse.service.detection.DensityDetector;
import com.concourse.service.routing.RerouteEngine;
import com.concourse.service.simulation.AgentFactory;
import com.concourse.service.simulation.SimulationEngine;
import com.concourse.service.simulation.SocialForceModel;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;

/**
 * One check per piece of non-trivial logic: the tick loop conserves people and respects
 * capacity, the detector spots a filling node, and Dijkstra finds the way out.
 */
class SimulationEngineTest {

    /** gate -> walkway -> exit, plus a small dead-end concession off the walkway. */
    private static final Venue VENUE = new Venue("venue-test", "Test Venue",
            List.of(
                    new VenueNode("gate", "Gate", VenueNode.Type.GATE, 100, 0, 0),
                    new VenueNode("walk", "Walkway", VenueNode.Type.WALKWAY, 200, 10, 0),
                    new VenueNode("food", "Concession", VenueNode.Type.CONCESSION, 20, 10, 10),
                    new VenueNode("exit", "Exit", VenueNode.Type.EXIT, 300, 20, 0)),
            List.of(
                    new VenueEdge("gate", "walk", 10, 5, true),
                    new VenueEdge("walk", "food", 5, 2, true),
                    new VenueEdge("walk", "exit", 10, 5, true)));

    private final SimulationEngine engine =
            new SimulationEngine(new AgentFactory(), new SocialForceModel(), 0.85);

    @Test
    void everyPersonIsAccountedForAndNoNodeOverflows() {
        SimulationRun run = engine.create(VENUE, 500, 30, 50, false);

        for (int tick = 0; tick < 30; tick++) {
            engine.advanceTick(VENUE, run);

            int inside = run.getOccupancy().values().stream().mapToInt(Integer::intValue).sum();
            assertThat(inside + run.getExited() + run.getPendingArrivals())
                    .as("nobody created or lost at tick %d", tick)
                    .isEqualTo(500);

            for (VenueNode node : VENUE.nodes()) {
                assertThat(run.getOccupancy().get(node.id()))
                        .as("%s within capacity at tick %d", node.id(), tick)
                        .isBetween(0, node.capacity());
            }
        }
        assertThat(run.getExited()).as("people reach the exit").isPositive();
        assertThat(run.getHistory()).hasSize(31); // tick 0 snapshot + 30 ticks
    }

    @Test
    void detectorFlagsAFillingNode() {
        DensityDetector detector = new DensityDetector(0.70, 0.85, 5);
        // Arrivals far outrun what the walkway can drain, so the gate backs up.
        SimulationRun run = engine.create(VENUE, 5_000, 20, 400, false);
        for (int tick = 0; tick < 10; tick++) {
            engine.advanceTick(VENUE, run);
        }

        List<Alert> alerts = detector.detect(VENUE, run);
        assertThat(alerts).isNotEmpty();
        assertThat(alerts).anySatisfy(alert -> {
            assertThat(alert.severity()).isIn(Alert.Severity.WARNING, Alert.Severity.CRITICAL);
            assertThat(alert.density()).isGreaterThanOrEqualTo(0.70);
        });
    }

    /**
     * The summary's before/after is only worth showing if rerouting actually does something.
     * Measured at the gate, which is what holding intake controls — venue-wide peak density
     * can stay pinned at 1.0 by any small dead-end zone regardless of routing.
     */
    @Test
    void reroutingKeepsTheGateOutOfTheRedVersusTheSameRunWithoutIt() {
        double withReroute = peakDensity(engine.create(VENUE, 5_000, 40, 300, true), "gate");
        double withoutReroute = peakDensity(engine.create(VENUE, 5_000, 40, 300, false), "gate");

        assertThat(withReroute)
                .as("rerouting should relieve the jam, not just relabel it")
                .isLessThan(withoutReroute);
        assertThat(withoutReroute).as("the untreated run should genuinely jam").isGreaterThan(0.9);
    }

    private double peakDensity(SimulationRun run, String nodeId) {
        int capacity = VENUE.nodesById().get(nodeId).capacity();
        double peak = 0;
        for (int tick = 0; tick < run.getTotalTicks(); tick++) {
            engine.advanceTick(VENUE, run);
            peak = Math.max(peak, (double) run.getOccupancy().get(nodeId) / capacity);
        }
        return peak;
    }

    @Test
    void rerouteFindsTheNearestNodeWithHeadroom() {
        RerouteEngine rerouteEngine = new RerouteEngine(0.70);
        Map<String, Integer> occupancy = Map.of("gate", 95, "walk", 190, "food", 2, "exit", 0);

        ReroutePath path = rerouteEngine.findReroute(VENUE, "gate", occupancy);

        assertThat(path.toNodeId()).isEqualTo("food"); // walkway is full, concession is closer than the exit
        assertThat(path.path()).containsExactly("gate", "walk", "food");
        assertThat(path.cost()).isEqualTo(15.0);
    }

    @Test
    void rerouteReturnsNothingWhenEverywhereIsFull() {
        RerouteEngine rerouteEngine = new RerouteEngine(0.70);
        Map<String, Integer> occupancy = Map.of("gate", 100, "walk", 200, "food", 20, "exit", 300);

        assertThat(rerouteEngine.findReroute(VENUE, "gate", occupancy).toNodeId()).isNull();
    }

    @Test
    void scheduleControlsArrivalsAndAllowsZeroArrivalPhases() {
        SimulationRun run = engine.create(VENUE, 100, 5, 0,
                List.of(new ArrivalPhase(0, 2, 10), new ArrivalPhase(2, 4, 0)), false);

        engine.advanceTick(VENUE, run);
        assertThat(run.getPendingArrivals()).isEqualTo(90);
        engine.advanceTick(VENUE, run);
        assertThat(run.getPendingArrivals()).isEqualTo(80);
        engine.advanceTick(VENUE, run);
        assertThat(run.getPendingArrivals()).isEqualTo(80);
    }
}
