package com.concourse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * The one way an account can become an admin.
 *
 * A separate class from {@link AuthApiTest} because the allowlist is read once when the
 * controller is built, so exercising it needs a context configured with an address on it —
 * which is also the closest this suite gets to a real deployment, where the same value
 * arrives as {@code AUTH_ADMIN_EMAILS}.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        // Rate limiting off: these cases exercise the auth rules, and they drive far more
        // logins and registrations from one loopback address than a real user ever would, so
        // the limiter would refuse them for being a test rather than for being wrong. That the
        // limiter itself works is asserted separately, in RateLimitTest.
        "security.rate-limit.enabled=false",
        "auth.admin-emails=ops-lead@concourse.local, Second.Admin@Concourse.Local, door@concourse.local",
        // An in-memory database, unlike the rest of the suite, for two reasons. The addresses
        // here are fixed rather than generated, so against the shared H2 file the second run
        // would fail on a duplicate registration. And they are admin addresses: a test run
        // would otherwise leave a working admin account, password and all, sitting in the
        // database used for development.
        "spring.datasource.url=jdbc:h2:mem:admin-allowlist;DB_CLOSE_DELAY=-1",
        // No seeding here. These tests are about the allowlist promoting accounts as they
        // register and sign in, so AdminSeeder creating the rows up front would leave nothing
        // for them to observe — and every registration below would be a duplicate.
        "auth.admin-password=",
})
@AutoConfigureMockMvc
class AdminAllowlistTest {

    @Autowired
    private MockMvc mvc;

    private ResultActions register(String email, String role) throws Exception {
        return mvc.perform(post("/auth/register").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"test-password-123\","
                        + "\"role\":\"" + role + "\"}"));
    }

    /**
     * The address the two door tests share.
     *
     * They cannot each register it: the context — and so the in-memory database — is reused
     * across methods in a class, so whichever ran second would be refused as a duplicate. The
     * registration assertions above therefore get an address each, and anything that only
     * needs an account to exist goes through here.
     */
    private void ensureDoorAccount() throws Exception {
        register("door@concourse.local", "walker")
                .andExpect(r -> assertThat(r.getResponse().getStatus()).isIn(201, 409));
    }

    private ResultActions login(String email, String portal) throws Exception {
        return mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"test-password-123\","
                        + "\"portal\":\"" + portal + "\"}"));
    }

    @Test
    void anAllowlistedAddressBecomesAnAdminOnRegistration() throws Exception {
        assertThat(register("ops-lead@concourse.local", "walker")
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString())
                .contains("\"role\":\"ADMIN\"");
    }

    @Test
    void theAllowlistIsMatchedWithoutRegardToCase() throws Exception {
        // Addresses get typed into a config file by hand and into a login form by someone
        // else. Comparing them literally would make the grant depend on which of the two
        // happened to use a capital letter.
        assertThat(register("SECOND.ADMIN@concourse.local", "client")
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString())
                .contains("\"role\":\"ADMIN\"");
    }

    @Test
    void anAllowlistedAdminIsLetThroughTheAdminDoor() throws Exception {
        ensureDoorAccount();

        assertThat(login("door@concourse.local", "admin")
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString())
                .contains("\"role\":\"ADMIN\"");
    }

    @Test
    void anAdminKeepsAdminWhicheverDoorTheyUse() throws Exception {
        // Walker and client swap freely, but that rule must not demote the platform operator
        // for opening the wrong URL — losing the console that way would be a nasty surprise.
        ensureDoorAccount();

        assertThat(login("door@concourse.local", "walker")
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString())
                .contains("\"role\":\"ADMIN\"");
    }

    @Test
    void everyoneElseIsStillRefused() throws Exception {
        String outsider = "outsider-" + UUID.randomUUID() + "@concourse.local";
        register(outsider, "client").andExpect(status().isCreated());

        register(outsider + ".x", "admin").andExpect(status().isForbidden());
        login(outsider, "admin").andExpect(status().isForbidden());
    }
}
