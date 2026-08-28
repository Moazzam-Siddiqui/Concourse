package com.concourse.security;

import jakarta.servlet.http.HttpServletRequest;

/**
 * The request path a filter can actually match on.
 *
 * <p>{@code HttpServletRequest.getServletPath()} is the obvious choice and it is not reliable.
 * What it returns depends on how the servlet is mapped: with Boot's dispatcher mapped at
 * {@code /} it happens to be the full path, but under a different mapping the path is split
 * across {@code getServletPath()} and {@code getPathInfo()}, and under MockMvc it is the empty
 * string unless a test sets it explicitly.
 *
 * <p>That last case is what makes this worth a class of its own rather than a comment. A
 * security filter keyed on {@code getServletPath()} silently matches nothing in MockMvc, so
 * every test of it passes for the wrong reason: the request is allowed through because the
 * rule never applied, not because the caller was entitled. The rate limiter had exactly this
 * bug, and it was invisible until a test asserted that a refusal actually happens.
 *
 * <p>{@code getRequestURI()} is populated the same way everywhere. It includes the context
 * path, which is stripped here so the result is comparable against the paths used in mappings.
 */
final class RequestPaths {

    private RequestPaths() {
    }

    static String of(HttpServletRequest request) {
        String uri = request.getRequestURI();
        if (uri == null || uri.isEmpty()) {
            // Nothing better to go on. Returning "/" keeps callers matching on a real path
            // rather than having to null-check at every use.
            String servletPath = request.getServletPath();
            return servletPath == null || servletPath.isEmpty() ? "/" : servletPath;
        }

        String context = request.getContextPath();
        if (context != null && !context.isEmpty() && uri.startsWith(context)) {
            uri = uri.substring(context.length());
        }
        return uri.isEmpty() ? "/" : uri;
    }
}
