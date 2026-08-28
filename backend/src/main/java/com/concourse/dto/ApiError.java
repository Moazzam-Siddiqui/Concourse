package com.concourse.dto;

import java.time.Instant;
import java.util.List;

/**
 * Error body for every 4xx/5xx this API returns, so a client never has to parse Spring's
 * default whitelabel page to find out what it got wrong.
 *
 * @param details field-level messages from bean validation; empty for everything else
 */
public record ApiError(Instant timestamp, int status, String error, String message, List<String> details) {

    public static ApiError of(int status, String error, String message, List<String> details) {
        return new ApiError(Instant.now(), status, error, message, details == null ? List.of() : details);
    }
}
