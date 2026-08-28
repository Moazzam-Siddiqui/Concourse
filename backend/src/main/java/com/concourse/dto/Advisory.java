package com.concourse.dto;

/** Plain-language guidance produced by the AdvisoryService for one alert. */
public record Advisory(int tick, String nodeId, String text) {
}
