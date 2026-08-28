package com.concourse.dto;

import com.concourse.model.GeoAnchor;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Size;
import java.util.List;

/**
 * Body of {@code PUT /venues/{id}/georef}: exactly three surveyed points.
 *
 * <p>Three, not two, because two cannot distinguish a rotation from its mirror image — see
 * {@link com.concourse.service.geo.Georef}. Not more than three either: a larger set wants a
 * least-squares fit rather than an exact one, and nobody has four survey points yet.
 */
public record GeorefRequest(
        @NotNull @Size(min = 3, max = 3, message = "Exactly three anchors are required")
        @Valid List<GeoAnchor> anchors) {
}
