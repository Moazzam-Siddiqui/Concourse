package com.concourse.repository;

import com.concourse.model.SimulationRun;
import java.util.Collection;
import java.util.Map;
import java.util.Optional;
import java.util.concurrent.ConcurrentHashMap;
import org.springframework.stereotype.Repository;

@Repository
public class InMemorySimulationRepository implements SimulationRepository {

    private final Map<String, SimulationRun> runs = new ConcurrentHashMap<>();

    @Override
    public SimulationRun save(SimulationRun run) {
        runs.put(run.getId(), run);
        return run;
    }

    @Override
    public Optional<SimulationRun> findById(String id) {
        return Optional.ofNullable(runs.get(id));
    }

    @Override
    public Collection<SimulationRun> findAll() {
        return runs.values();
    }
}
