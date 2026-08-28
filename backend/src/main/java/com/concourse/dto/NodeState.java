package com.concourse.dto;

import com.concourse.model.Alert;

public record NodeState(String nodeId, int occupancy, int capacity, double density, Alert.Severity status) {
}
