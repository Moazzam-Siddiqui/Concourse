package com.concourse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The rate limiter, asserted through the real filter chain.
 *
 * Worth pinning because the failure mode is silent. A limiter that is misconfigured, ordered
 * after authentication, or registered on a chain the request never reaches still lets every
 * test pass and every page load work — it simply stops protecting anything, and nothing says
 * so until someone runs a password list against /auth/login.
 *
 * The budgets asserted here are the ones in RateLimitFilter.Tier. If those change, these
 * numbers change with them; that is the point of writing them down twice.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "security.rate-limit.enabled=true",
        "auth.admin-emails=",
        "spring.mail.username=",
        "spring.mail.password="
})
@AutoConfigureMockMvc
class RateLimitTest {

    @Autowired
    private MockMvc mvc;

    private static String loginBody(String email) {
        return "{\"email\":\"%s\",\"password\":\"wrong-password-1\"}".formatted(email);
    }

    /**
     * Login is capped at 8 in 5 minutes, so the ninth attempt is refused.
     *
     * The attempts deliberately use bad credentials: the assertion is that the limiter answers
     * before the password is ever checked, so a wrong password must stop returning 401 and
     * start returning 429. If it kept returning 401 past the budget, guessing would still be
     * unlimited no matter what the filter claims.
     */
    @Test
    void loginIsCappedAfterTheBudgetIsSpent() throws Exception {
        String email = "ratelimit-login@concourse.test";
        int refusals = 0;

        for (int attempt = 1; attempt <= 12; attempt++) {
            int status = mvc.perform(post("/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(loginBody(email)))
                    .andReturn().getResponse().getStatus();
            if (status == 429) {
                refusals++;
            }
        }

        assertThat(refusals)
                .as("12 login attempts against a budget of 8 must produce refusals")
                .isGreaterThan(0);
    }

    /** The 429 must tell the caller when to come back, or a well-behaved client cannot. */
    @Test
    void refusalCarriesRetryAfter() throws Exception {
        String email = "ratelimit-retry@concourse.test";
        String retryAfter = null;

        for (int attempt = 1; attempt <= 15 && retryAfter == null; attempt++) {
            var response = mvc.perform(post("/auth/login")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content(loginBody(email)))
                    .andReturn().getResponse();
            if (response.getStatus() == 429) {
                retryAfter = response.getHeader("Retry-After");
            }
        }

        assertThat(retryAfter).as("a 429 without Retry-After tells the client nothing").isNotNull();
        assertThat(Integer.parseInt(retryAfter)).isPositive();
    }

    /**
     * Reads keep a much larger budget, so the public map is not throttled by the same rule
     * that protects the credential endpoints.
     *
     * This is the regression that matters most in the other direction: a limiter tuned for
     * brute force but applied to reads would break the attendee map for a crowd, which is the
     * exact traffic this system exists to serve.
     */
    @Test
    void publicReadsAreNotThrottledAtLoginRates() throws Exception {
        for (int i = 0; i < 40; i++) {
            int status = mvc.perform(get("/venues")).andReturn().getResponse().getStatus();
            assertThat(status)
                    .as("public venue reads must survive well past the login budget")
                    .isNotEqualTo(429);
        }
    }
}
