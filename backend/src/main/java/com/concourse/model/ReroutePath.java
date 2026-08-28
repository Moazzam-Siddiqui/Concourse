package com.concourse.model;

import java.util.List;

/**
 * Suggested diversion from a congested node to the nearest node with headroom.
 *
 * @param path node ids from fromNodeId to toNodeId inclusive
 * @param cost total edge length of the path
 */
public record ReroutePath(String fromNodeId, String toNodeId, List<String> path, double cost) {

    public static ReroutePath none(String fromNodeId) {
        return new ReroutePath(fromNodeId, null, List.of(), Double.POSITIVE_INFINITY);
    }
}
