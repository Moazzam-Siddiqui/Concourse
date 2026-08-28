package com.concourse.model;

import jakarta.validation.Valid;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotEmpty;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/** The venue graph as uploaded via POST /venues. */
public record Venue(
        String id,
        @NotBlank String name,
        @NotEmpty @Valid List<VenueNode> nodes,
        @NotEmpty @Valid List<VenueEdge> edges) {

    public Venue withId(String newId) {
        return new Venue(newId, name, nodes, edges);
    }

    public Map<String, VenueNode> nodesById() {
        Map<String, VenueNode> map = new HashMap<>();
        nodes.forEach(n -> map.put(n.id(), n));
        return map;
    }

    /** Adjacency list; bidirectional edges appear in both directions. */
    public Map<String, List<VenueEdge>> adjacency() {
        Map<String, List<VenueEdge>> adj = new HashMap<>();
        nodes.forEach(n -> adj.put(n.id(), new ArrayList<>()));
        for (VenueEdge e : edges) {
            adj.computeIfAbsent(e.from(), k -> new ArrayList<>()).add(e);
            if (e.bidirectional()) {
                adj.computeIfAbsent(e.to(), k -> new ArrayList<>())
                        .add(new VenueEdge(e.to(), e.from(), e.length(), e.width(), true));
            }
        }
        return adj;
    }
}
