package com.concourse.dto;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import java.util.List;

/**
 * Reply from {@code POST /analyze}. Mirrors {@code ml-service/app/schemas/analyze_schema.py}.
 *
 * <p>{@code status} is the whole point of the contract: {@code partial} means one of the two
 * Hugging Face calls failed and the other still answered, so Spring can keep the half it got
 * (raw risk without prose, or prose without risk) instead of dropping the tick. Only
 * {@code failed} means there is nothing usable.
 *
 * @param status ok | partial | failed
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record AnalyzeResponse(
        String status,
        List<Prediction> predictions,
        Advisory advisory,
        List<AnalyzeError> errors,
        ModelInfo modelInfo) {

    /** @param risk predicted congestion risk in [0,1] {@code horizonTicks} ahead */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Prediction(String nodeId, double risk, int horizonTicks) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record Advisory(String headline, String message, List<String> actions) {
    }

    /** @param stage which half failed: {@code gnn} or {@code llm} */
    @JsonIgnoreProperties(ignoreUnknown = true)
    public record AnalyzeError(String stage, String detail) {
    }

    @JsonIgnoreProperties(ignoreUnknown = true)
    public record ModelInfo(String gnn, String llm) {
    }

    public boolean hasPredictions() {
        return predictions != null && !predictions.isEmpty();
    }

    public boolean hasAdvisory() {
        return advisory != null && advisory.message() != null && !advisory.message().isBlank();
    }
}
