package com.concourse.service.routing;

import com.concourse.model.Person;
import com.concourse.model.ReroutePath;
import com.concourse.model.Session;
import com.concourse.model.Venue;
import com.concourse.model.VenueEdge;
import com.concourse.model.VenueNode;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.Set;
import java.util.function.Predicate;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The route engine: one Dijkstra over edge length, asked three different questions.
 *
 * <ul>
 *   <li>{@link #findReroute} — nearest node that still has headroom, for the operator advice
 *       shown on the map.</li>
 *   <li>{@link #nearestExit} — the path a newly spawned attendee walks.</li>
 *   <li>{@link #pathAvoiding} — the same, with a congested node struck out of the graph.</li>
 * </ul>
 *
 * <p>Named {@code RerouteEngine} rather than {@code RouteEngine} because that is what the
 * rest of the codebase, the tests and {@code docs/system-design.md} already call it.
 */
@Component
public class RerouteEngine {

    private final double targetThreshold;

    public RerouteEngine(@Value("${simulation.warning-threshold:0.70}") double targetThreshold) {
        this.targetThreshold = targetThreshold;
    }

    /**
     * @param occupancy live people-per-node; a node qualifies as a target when its density
     *                  is below the warning threshold
     */
    public ReroutePath findReroute(Venue venue, String fromNodeId, Map<String, Integer> occupancy) {
        Map<String, VenueNode> nodesById = venue.nodesById();
        return dijkstra(venue, fromNodeId,
                node -> hasHeadroom(nodesById.get(node), occupancy), Set.of());
    }

    /** Shortest path from {@code fromNodeId} to whichever EXIT is closest by walking distance. */
    public ReroutePath nearestExit(Venue venue, String fromNodeId) {
        return nearestExitAvoiding(venue, fromNodeId, Set.of());
    }

    /** As {@link #nearestExit}, but the listed nodes are treated as if they were not there. */
    public ReroutePath nearestExitAvoiding(Venue venue, String fromNodeId, Set<String> avoid) {
        Map<String, VenueNode> nodesById = venue.nodesById();
        return dijkstra(venue, fromNodeId,
                node -> nodesById.get(node) != null && nodesById.get(node).isExit(), avoid);
    }

    /** Shortest path to one specific node, skipping {@code avoid}. */
    public ReroutePath pathAvoiding(Venue venue, String fromNodeId, String toNodeId, Set<String> avoid) {
        return dijkstra(venue, fromNodeId, toNodeId::equals, avoid);
    }

    /**
     * Diverts everyone whose remaining route runs through {@code congestedNodeId} onto a path
     * that does not. People already standing in the congested node are left alone — they are
     * in it, and the only way out is through.
     *
     * @return the diversions actually applied, one per distinct origin, for the map overlay
     */
    public List<ReroutePath> rerouteAffected(Session session, String congestedNodeId) {
        Venue venue = session.getVenue();
        Set<String> avoid = Set.of(congestedNodeId);
        Map<String, ReroutePath> appliedByOrigin = new HashMap<>();

        for (Person person : session.getPeople()) {
            if (person.getCurrentNodeId().equals(congestedNodeId)
                    || !person.getRoute().contains(congestedNodeId)) {
                continue;
            }
            String origin = person.getCurrentNodeId();
            ReroutePath alternative = appliedByOrigin.computeIfAbsent(origin,
                    from -> nearestExitAvoiding(venue, from, avoid));
            if (alternative.toNodeId() == null) {
                continue; // nowhere else to go — keep the existing route rather than stranding them
            }
            person.reroute(alternative.path().subList(1, alternative.path().size()));
        }
        appliedByOrigin.values().removeIf(path -> path.toNodeId() == null);
        return List.copyOf(appliedByOrigin.values());
    }

    /**
     * Dijkstra from {@code fromNodeId} until the first node satisfying {@code accept} is
     * settled. Returns the whole path so the UI can animate it, not just the destination.
     */
    private ReroutePath dijkstra(Venue venue, String fromNodeId,
                                 Predicate<String> accept, Set<String> avoid) {
        if (!venue.nodesById().containsKey(fromNodeId)) {
            return ReroutePath.none(fromNodeId);
        }

        Map<String, List<VenueEdge>> adjacency = venue.adjacency();
        Map<String, Double> distance = new HashMap<>();
        Map<String, String> previous = new HashMap<>();
        Set<String> settled = new HashSet<>();
        PriorityQueue<String> queue = new PriorityQueue<>(
                Comparator.comparingDouble(id -> distance.getOrDefault(id, Double.POSITIVE_INFINITY)));

        distance.put(fromNodeId, 0.0);
        queue.add(fromNodeId);

        while (!queue.isEmpty()) {
            String node = queue.poll();
            if (!settled.add(node)) {
                continue; // stale queue entry, already settled at a shorter distance
            }
            double here = distance.getOrDefault(node, Double.POSITIVE_INFINITY);

            if (!node.equals(fromNodeId) && accept.test(node)) {
                return new ReroutePath(fromNodeId, node, pathTo(previous, fromNodeId, node), round(here));
            }

            for (VenueEdge edge : adjacency.getOrDefault(node, List.of())) {
                if (avoid.contains(edge.to())) {
                    continue;
                }
                double candidate = here + edge.length();
                if (candidate < distance.getOrDefault(edge.to(), Double.POSITIVE_INFINITY)) {
                    distance.put(edge.to(), candidate);
                    previous.put(edge.to(), node);
                    queue.add(edge.to());
                }
            }
        }
        return ReroutePath.none(fromNodeId);
    }

    private boolean hasHeadroom(VenueNode node, Map<String, Integer> occupancy) {
        if (node == null) {
            return false;
        }
        return (double) occupancy.getOrDefault(node.id(), 0) / node.capacity() < targetThreshold;
    }

    private List<String> pathTo(Map<String, String> previous, String from, String to) {
        List<String> path = new ArrayList<>();
        for (String at = to; at != null; at = previous.get(at)) {
            path.add(at);
            if (at.equals(from)) {
                break;
            }
        }
        Collections.reverse(path);
        return path;
    }

    private double round(double value) {
        return Math.round(value * 10) / 10.0;
    }
}
