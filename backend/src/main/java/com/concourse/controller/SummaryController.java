package com.concourse.controller;

import com.concourse.dto.SummaryResponse;
import com.concourse.model.Alert;
import com.concourse.model.SimulationRun;
import com.concourse.model.Venue;
import com.concourse.model.VenueNode;
import com.concourse.repository.SimulationRepository;
import com.concourse.repository.VenueRepository;
import com.concourse.service.detection.DensityDetector;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RestController;

@RestController
public class SummaryController {

    private final SimulationRepository simulations;
    private final VenueRepository venues;
    private final DensityDetector detector;

    public SummaryController(SimulationRepository simulations, VenueRepository venues, DensityDetector detector) {
        this.simulations = simulations;
        this.venues = venues;
        this.detector = detector;
    }

    /**
     * Post-run stats. When the run had rerouting on, its no-intervention twin supplies the
     * baseline column; otherwise baseline and optimised are the same run.
     */
    @GetMapping("/simulations/{id}/summary")
    public SummaryResponse summary(@PathVariable String id) {
        SimulationRun run = simulations.getOrThrow(id);
        Venue venue = venues.getOrThrow(run.getVenueId());

        SummaryResponse.Metrics optimised = metricsOf(venue, run);
        SummaryResponse.Metrics baseline = run.getBaselineRunId() == null
                ? optimised
                : metricsOf(venue, simulations.getOrThrow(run.getBaselineRunId()));

        return new SummaryResponse(run.getId(), run.getCurrentTick(), optimised.peakDensity(),
                optimised.bottleneckCount(), baseline, optimised, narrate(baseline, optimised));
    }

    private SummaryResponse.Metrics metricsOf(Venue venue, SimulationRun run) {
        List<Map<String, Integer>> history = run.getHistory();
        Set<String> bottlenecks = new HashSet<>();
        double peak = 0;
        int criticalNodeTicks = 0;
        int clearTick = run.getCurrentTick();
        boolean anyoneArrived = false;

        for (int tick = 0; tick < history.size(); tick++) {
            Map<String, Integer> snapshot = history.get(tick);
            int total = 0;
            for (VenueNode node : venue.nodes()) {
                int people = snapshot.getOrDefault(node.id(), 0);
                total += people;
                double density = (double) people / node.capacity();
                peak = Math.max(peak, density);
                if (detector.severityOf(density) == Alert.Severity.CRITICAL) {
                    bottlenecks.add(node.id());
                    criticalNodeTicks++;
                }
            }
            anyoneArrived |= total > 0;
            if (anyoneArrived && total == 0 && clearTick == run.getCurrentTick()) {
                clearTick = tick;
            }
        }
        return new SummaryResponse.Metrics(round(peak), bottlenecks.size(), criticalNodeTicks, clearTick);
    }

    private String narrate(SummaryResponse.Metrics baseline, SummaryResponse.Metrics optimised) {
        if (baseline == optimised) {
            return "Run finished with %d zone-ticks above the critical threshold, peaking at %d%%. Enable rerouting to compare."
                    .formatted(optimised.criticalNodeTicks(), pct(optimised.peakDensity()));
        }
        int before = baseline.criticalNodeTicks();
        int after = optimised.criticalNodeTicks();
        if (after >= before) {
            return "Rerouting did not reduce time spent in the red (%d → %d zone-ticks) on this layout."
                    .formatted(before, after);
        }
        return "Rerouting cut time spent above the critical threshold by %d%% (%d → %d zone-ticks), peaking at %d%% instead of %d%%."
                .formatted(Math.round((before - after) * 100.0 / before), before, after,
                        pct(optimised.peakDensity()), pct(baseline.peakDensity()));
    }

    private int pct(double density) {
        return (int) Math.round(density * 100);
    }

    private double round(double value) {
        return Math.round(value * 100) / 100.0;
    }
}
