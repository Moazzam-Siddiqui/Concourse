package com.concourse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.concourse.config.AdminSeeder;
import com.concourse.model.AppUser;
import com.concourse.repository.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.web.servlet.MockMvc;

/**
 * The seeded admin account: that it exists at boot, and that it can actually get in.
 *
 * This is the case the allowlist alone cannot cover. Admin is refused at the registration
 * form, so without seeding the very first administrator has no way to create themselves
 * through the UI — the console would be unreachable on a fresh database.
 *
 * Runs against its own in-memory database for the same reason {@link AdminAllowlistTest}
 * does: the address and password are fixed, so a shared file would fail the second run and
 * would leave a working admin login behind in the development database.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        "auth.admin-emails=seeded-admin@concourse.local",
        "auth.admin-password=Seeded/123",
        "spring.datasource.url=jdbc:h2:mem:admin-seeding;DB_CLOSE_DELAY=-1",
})
@AutoConfigureMockMvc
class AdminSeedingTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private UserRepository users;

    @Autowired
    private PasswordEncoder encoder;

    @Test
    void theAdminAccountExistsBeforeAnyoneSignsUp() {
        AppUser admin = users.findByEmailIgnoreCase("seeded-admin@concourse.local").orElseThrow();

        assertThat(admin.getRole()).isEqualTo(AppUser.Role.ADMIN);
        assertThat(admin.isEnabled()).isTrue();
        assertThat(admin.getProvider()).isEqualTo("LOCAL");
    }

    @Test
    void theSeededPasswordOpensTheAdminDoor() throws Exception {
        // The end of the chain that matters: seeded row, configured password, admin portal.
        String body = mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"seeded-admin@concourse.local\","
                                + "\"password\":\"Seeded/123\",\"portal\":\"admin\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(body).contains("\"role\":\"ADMIN\"");
    }

    @Test
    void thePasswordIsStoredHashedAndNotInTheClear() {
        AppUser admin = users.findByEmailIgnoreCase("seeded-admin@concourse.local").orElseThrow();

        assertThat(admin.getPasswordHash())
                .isNotEqualTo("Seeded/123")
                .startsWith("$2");
    }

    @Test
    void anAccountThatAlreadyExistsIsPromotedButKeepsItsOwnPassword() throws Exception {
        // The case that surprises people: an address that signed up through the form before
        // being allowlisted. Seeding gives it the console, and deliberately does not touch the
        // password — re-applying the configured one every boot would undo a password the
        // operator had changed and keep resurrecting a value from a config file. The cost is
        // that auth.admin-password does not apply to such an account; the reset flow does.
        String email = "already-here@concourse.local";
        mvc.perform(post("/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"Chosen/456\"}"))
                .andExpect(status().isCreated());

        new AdminSeeder(users, encoder, email, "Seeded/123").run(null);

        assertThat(users.findByEmailIgnoreCase(email).orElseThrow().getRole())
                .isEqualTo(AppUser.Role.ADMIN);

        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"Chosen/456\"}"))
                .andExpect(status().isOk());
        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"Seeded/123\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void anAdminPasswordThatBreaksThePolicyCreatesNothing() {
        // The console must not be the weakest account on the platform, and a policy the
        // console itself breaks is not a policy.
        String email = "weak-admin@concourse.local";
        new AdminSeeder(users, encoder, email, "short").run(null);

        assertThat(users.findByEmailIgnoreCase(email)).isEmpty();
    }

    @Test
    void noConfiguredPasswordCreatesNothingRatherThanGuessingOne() {
        String email = "unseeded-admin@concourse.local";
        new AdminSeeder(users, encoder, email, "").run(null);

        assertThat(users.findByEmailIgnoreCase(email)).isEmpty();
    }

    @Test
    void theSeededAddressStillCannotBeRegisteredOverTheTop() throws Exception {
        // Otherwise anyone who guessed the admin address could take it by registering it,
        // since registration is open to everyone.
        mvc.perform(post("/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"seeded-admin@concourse.local\","
                                + "\"password\":\"Attacker/123\"}"))
                .andExpect(status().isConflict());
    }
}
