package com.concourse.service;

import com.concourse.model.Venue;
import com.concourse.model.VenueEdge;
import com.concourse.model.VenueNode;
import java.util.HashSet;
import java.util.Set;
import org.springframework.http.HttpStatus;
import org.springframework.web.server.ResponseStatusException;

/**
 * The structural rules a venue graph must satisfy, in one place.
 *
 * <p>Bean Validation on {@link Venue} covers the per-field rules — name not blank, capacity
 * positive, lists not empty. It cannot express rules <em>between</em> fields, which is
 * everything here: ids being unique across the node list, edges pointing at nodes that exist.
 *
 * <p>This lives in one class because both entry points need it and they must not disagree.
 * {@code POST /venues} uploads a layout on its own; {@code POST /sessions} uploads one inline
 * and starts simulating it. When these rules were duplicated in both controllers they promptly
 * drifted — one demanded an EXIT and the other deliberately allowed a venue without one, so the
 * same file was accepted or rejected depending on which door you came through.
 */
public final class VenueValidator {

    private VenueValidator() {
    }

    /**
     * Throws {@link ResponseStatusException} with 400 for anything the simulation cannot run.
     *
     * <p>Note what is <b>not</b> rejected: a venue with no EXIT. That is a legal, and
     * interesting, scenario — the crowd has nowhere to go, every zone saturates, and the
     * detector lights the whole map up, which is the correct answer rather than an error. A
     * venue with no GATE is different: nobody can ever enter, so the run is empty and there is
     * nothing to look at.
     */
    public static void validate(Venue venue) {
        Set<String> ids = new HashSet<>();
        for (VenueNode node : venue.nodes()) {
            if (!ids.add(node.id())) {
                throw badRequest("Duplicate node id: " + node.id());
            }
        }

        if (venue.nodes().stream().noneMatch(VenueNode::isEntry)) {
            throw badRequest("Venue has no GATE node — nobody can enter");
        }

        for (VenueEdge edge : venue.edges()) {
            if (edge.from().equals(edge.to())) {
                throw badRequest("Edge %s -> %s connects a node to itself".formatted(edge.from(), edge.to()));
            }
            if (!ids.contains(edge.from()) || !ids.contains(edge.to())) {
                throw badRequest("Edge %s -> %s references a node that does not exist"
                        .formatted(edge.from(), edge.to()));
            }
        }
    }

    private static ResponseStatusException badRequest(String message) {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST, message);
    }
}
