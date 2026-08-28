package com.concourse.config;

import com.github.benmanes.caffeine.cache.Caffeine;
import org.springframework.cache.CacheManager;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.cache.caffeine.CaffeineCacheManager;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.time.Duration;

/**
 * In-process response caches for the read paths that a crowd all hits at once.
 *
 * <p>The shape of the load here is unusual and worth stating, because it is what makes caching
 * the highest-value change available: attendees at one venue all open the same map, resolve
 * the same venue code, and ask for a route out of one of a handful of zones. Tens of thousands
 * of concurrent readers are therefore asking a few hundred distinct questions. Without a cache
 * every one of those is a repository read plus, for routes, a fresh Dijkstra over the venue
 * graph. With one, the repeats collapse into a map lookup.
 *
 * <p><b>Caffeine, not Redis.</b> This is deliberate and it is a limit, not an oversight. These
 * caches are per-process, so N replicas hold N copies and each warms independently. That is
 * the right trade while the rest of the application is also per-process — sessions and the
 * broadcaster live in the heap, so a second replica is not yet something this system can run.
 * Moving to Redis is the same change as moving session state to Redis and should happen with
 * it, not before it. See docs/scaling.md.
 *
 * <p>Every cache is bounded and expiring. An unbounded cache keyed by anything a caller
 * supplies is a memory exhaustion vector wearing a performance hat.
 */
@Configuration
@EnableCaching
public class CacheConfig {

    /** {@code GET /venues/{id}} and {@code GET /venues}. */
    public static final String VENUES = "venues";
    /** {@code GET /venues} — the whole list, one entry. */
    public static final String VENUE_LIST = "venueList";
    /** {@code GET /venues/{id}/route?from=} — a Dijkstra run per distinct question. */
    public static final String VENUE_ROUTES = "venueRoutes";

    @Bean
    public CacheManager cacheManager() {
        CaffeineCacheManager manager = new CaffeineCacheManager();

        // Venues change only when an operator uploads one, and that path evicts explicitly.
        // The TTL is a backstop for a write that arrives through some other route, not the
        // primary correctness mechanism.
        manager.registerCustomCache(VENUES, Caffeine.newBuilder()
                .maximumSize(2_000)
                .expireAfterWrite(Duration.ofMinutes(10))
                .recordStats()
                .build());

        // One entry holding the whole list. Short TTL because this is the endpoint a venue
        // code resolves through, and an operator who has just uploaded a venue expects to be
        // able to hand out its code immediately.
        manager.registerCustomCache(VENUE_LIST, Caffeine.newBuilder()
                .maximumSize(1)
                .expireAfterWrite(Duration.ofSeconds(30))
                .recordStats()
                .build());

        // The expensive one. Bounded by distinct (venue, origin) pairs, which is small for a
        // real building: a venue has tens of zones, not thousands.
        manager.registerCustomCache(VENUE_ROUTES, Caffeine.newBuilder()
                .maximumSize(50_000)
                .expireAfterWrite(Duration.ofMinutes(10))
                .recordStats()
                .build());

        return manager;
    }
}
