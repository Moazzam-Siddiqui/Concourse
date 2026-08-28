package com.concourse.controller;

import com.concourse.dto.ApiError;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.http.converter.HttpMessageNotReadableException;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.server.ResponseStatusException;

/**
 * Turns the three ways a request can go wrong into a consistent {@link ApiError} body:
 * a malformed venue upload, a payload that fails validation, and anything unexpected.
 */
@RestControllerAdvice
public class ApiExceptionHandler {

    private static final Logger log = LoggerFactory.getLogger(ApiExceptionHandler.class);

    /** Bean validation on @Valid bodies — every failed field is listed, not just the first. */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiError> onValidationFailure(MethodArgumentNotValidException e) {
        List<String> details = e.getBindingResult().getFieldErrors().stream()
                .map(error -> error.getField() + " " + error.getDefaultMessage())
                .toList();
        return ResponseEntity.badRequest().body(ApiError.of(400, "Bad Request",
                "Request body failed validation", details));
    }

    /** Venue JSON that is not JSON, or does not fit the schema at all. */
    @ExceptionHandler(HttpMessageNotReadableException.class)
    public ResponseEntity<ApiError> onUnreadableBody(HttpMessageNotReadableException e) {
        return ResponseEntity.badRequest().body(ApiError.of(400, "Bad Request",
                "Could not read request body — check the JSON is well formed and matches the schema",
                List.of(rootMessage(e))));
    }

    /** 404s and the deliberate 400/409s the services raise. Passed through as-is. */
    @ExceptionHandler(ResponseStatusException.class)
    public ResponseEntity<ApiError> onResponseStatus(ResponseStatusException e) {
        HttpStatus status = HttpStatus.resolve(e.getStatusCode().value());
        return ResponseEntity.status(e.getStatusCode()).body(ApiError.of(
                e.getStatusCode().value(),
                status == null ? "Error" : status.getReasonPhrase(),
                e.getReason() == null ? e.getMessage() : e.getReason(),
                List.of()));
    }

    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiError> onUnexpected(Exception e) {
        log.error("Unhandled error", e);
        return ResponseEntity.internalServerError().body(ApiError.of(500, "Internal Server Error",
                e.getClass().getSimpleName() + ": " + e.getMessage(), List.of()));
    }

    private String rootMessage(Throwable e) {
        Throwable cause = e;
        while (cause.getCause() != null) {
            cause = cause.getCause();
        }
        return cause.getMessage() == null ? e.getClass().getSimpleName() : cause.getMessage();
    }
}
