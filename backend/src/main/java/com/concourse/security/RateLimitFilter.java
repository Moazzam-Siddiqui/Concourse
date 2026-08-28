package com.concourse.security;

import com.github.benmanes.caffeine.cache.Cache;
import com.github.benmanes.caffeine.cache.Caffeine;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.time.Duration;
import java.util.concurrent.atomic.LongAdder;

/**
 * Caps how fast any one caller can hit the API.
 *
 * This closes two holes at once, which is why it is one filter and not two.
 *
 * <p><b>Brute force.</b> {@code /auth/login} verifies a password with BCrypt, and BCrypt is
 * deliberately slow. Without a cap, an attacker gets unlimited guesses against a user-chosen
 * password, and each guess costs the server ~50ms of CPU it cannot refuse — so the same
 * request is both the credential attack and the denial of service. {@code /auth/forgot-password}
 * is worse per call: it sends mail, so an unbounded caller spends someone else's SMTP
 * reputation.
 *
 * <p><b>Load.</b> At the traffic this project is meant to take, the cap is what stops one
 * misbehaving client from consuming the capacity the other 49,999 need. It runs before
 * authentication so that rejecting a flood costs a map lookup rather than a database round
 * trip and a hash.
 *
 * <p>The buckets live in a size-bounded Caffeine cache. An unbounded map keyed by client
 * address is itself a memory exhaustion vector: the attacker picks the keys.
 */
@Component
public class RateLimitFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RateLimitFilter.class);

    /**
     * Tiers, most specific first. The first match wins, so ordering here is the policy.
     *
     * Reads are generous because they are cheap and cached; anything that costs CPU, a row,
     * or an email is not.
     */
    private enum Tier {
        /** Password verification. Slow by design, so guessing must be expensive too. */
        LOGIN(8, Duration.ofMinutes(5)),
        /** Sends mail or creates rows. The tightest budget on the API. */
        ACCOUNT(5, Duration.ofHours(1)),
        /** Everything else that changes state. */
        WRITE(60, Duration.ofMinutes(1)),
        /** Cached, cheap, and public. */
        READ(600, Duration.ofMinutes(1));

        final int capacity;
        final double refillPerSecond;

        Tier(int capacity, Duration window) {
            this.capacity = capacity;
            this.refillPerSecond = capacity / (double) window.toSeconds();
        }
    }

    /**
     * Continuous-refill token bucket.
     *
     * Chosen over a fixed window because a fixed window lets a caller spend the whole budget
     * in the last second of one window and the whole budget again in the first second of the
     * next, giving a double burst across the boundary. Tokens here accrue smoothly, so the long-run rate
     * and the instantaneous burst are both bounded.
     */
    private static final class Bucket {
        private double tokens;
        private long lastRefillNanos;

        Bucket(double initial) {
            this.tokens = initial;
            this.lastRefillNanos = System.nanoTime();
        }

        synchronized boolean tryConsume(Tier tier) {
            long now = System.nanoTime();
            double elapsedSeconds = (now - lastRefillNanos) / 1_000_000_000.0;
            lastRefillNanos = now;

            tokens = Math.min(tier.capacity, tokens + elapsedSeconds * tier.refillPerSecond);
            if (tokens >= 1.0) {
                tokens -= 1.0;
                return true;
            }
            return false;
        }

        synchronized long retryAfterSeconds(Tier tier) {
            double deficit = 1.0 - tokens;
            return Math.max(1, (long) Math.ceil(deficit / tier.refillPerSecond));
        }
    }

    private final Cache<String, Bucket> buckets;
    private final boolean enabled;
    private final boolean trustForwardedFor;
    private final LongAdder rejected = new LongAdder();

    public RateLimitFilter(
            @Value("${security.rate-limit.enabled:true}") boolean enabled,
            @Value("${security.rate-limit.max-tracked-clients:200000}") long maxTrackedClients,
            @Value("${security.rate-limit.trust-forwarded-for:false}") boolean trustForwardedFor) {

        this.enabled = enabled;
        this.trustForwardedFor = trustForwardedFor;
        this.buckets = Caffeine.newBuilder()
                .maximumSize(maxTrackedClients)
                // A caller who has gone quiet for an hour has, by definition, refilled.
                .expireAfterAccess(Duration.ofHours(1))
                .build();

        if (!enabled) {
            log.warn("Rate limiting is DISABLED. /auth/login accepts unlimited password "
                     + "guesses. Intended for load testing only.");
        }
    }

    /** Exposed for /actuator/metrics and for tests. */
    public long rejectedCount() {
        return rejected.sum();
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        if (!enabled) {
            chain.doFilter(request, response);
            return;
        }

        Tier tier = tierFor(request);
        String key = tier.name() + '|' + clientAddress(request);

        Bucket bucket = buckets.get(key, k -> new Bucket(tier.capacity));
        if (bucket.tryConsume(tier)) {
            chain.doFilter(request, response);
            return;
        }

        rejected.increment();
        long retryAfter = bucket.retryAfterSeconds(tier);

        // Logged at debug on purpose: at the volume this fires under an actual flood, info
        // would turn the rate limiter into a disk-filling amplifier of the attack.
        log.debug("Rate limit hit: tier={} key={} retryAfter={}s", tier, key, retryAfter);

        response.setStatus(HttpStatus.TOO_MANY_REQUESTS.value());
        response.setContentType(MediaType.APPLICATION_JSON_VALUE);
        response.setHeader("Retry-After", Long.toString(retryAfter));
        response.getWriter().write(
                "{\"message\":\"Too many requests. Try again in " + retryAfter + "s.\"}");
    }

    private Tier tierFor(HttpServletRequest request) {
        String path = RequestPaths.of(request);
        String method = request.getMethod();

        if (path.startsWith("/auth/login") || path.startsWith("/auth/reset-password")) {
            return Tier.LOGIN;
        }
        if (path.startsWith("/auth/register") || path.startsWith("/auth/forgot-password")) {
            return Tier.ACCOUNT;
        }
        if ("GET".equals(method) || "HEAD".equals(method) || "OPTIONS".equals(method)) {
            return Tier.READ;
        }
        return Tier.WRITE;
    }

    /**
     * The caller's address, honouring X-Forwarded-For only when explicitly configured to.
     *
     * Trusting that header by default would hand every client a rate-limit bypass: it is
     * attacker-controlled, so a caller who sets a fresh value per request gets a fresh bucket
     * per request. Enable {@code security.rate-limit.trust-forwarded-for} only when this
     * service sits behind a proxy that overwrites the header rather than appending to it.
     */
    private String clientAddress(HttpServletRequest request) {
        if (trustForwardedFor) {
            String forwarded = request.getHeader("X-Forwarded-For");
            if (forwarded != null && !forwarded.isBlank()) {
                int comma = forwarded.indexOf(',');
                return (comma > 0 ? forwarded.substring(0, comma) : forwarded).trim();
            }
        }
        String remote = request.getRemoteAddr();
        return remote != null ? remote : "unknown";
    }

    /** The socket handshake is authorised elsewhere and is not a per-request cost. */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        String path = RequestPaths.of(request);
        return path.startsWith("/ws")
                || path.equals("/health")
                || path.startsWith("/actuator/health");
    }
}
