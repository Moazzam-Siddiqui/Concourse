package com.concourse;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.concourse.model.AppUser;

import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.ResultActions;

/**
 * The access rules, asserted through the real security filter chain.
 *
 * These are the cases that would otherwise only ever be checked by hand: that a write is
 * refused without a token, that a valid token for the wrong role is refused as well, and that
 * public reads stay public so the marketing map keeps working for signed-out visitors.
 *
 * Driven through MockMvc rather than TestRestTemplate. The filter chain runs either way, but
 * the JDK HTTP client behind TestRestTemplate cannot retry a streamed POST body after an auth
 * failure and dies with an I/O error instead of surfacing the 401/403 being asserted.
 */
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT, properties = {
        // Rate limiting off: these cases exercise the auth rules, and they drive far more
        // logins and registrations from one loopback address than a real user ever would, so
        // the limiter would refuse them for being a test rather than for being wrong. That the
        // limiter itself works is asserted separately, in RateLimitTest.
        "security.rate-limit.enabled=false",
        // Pin the reset-code delivery path instead of inheriting whatever the machine has.
        //
        // The code is returned in the response only when it was not delivered anywhere else, so
        // on a developer who has filled in secrets.yml the mailer switches on, the field goes
        // away, and the three tests that spend a code fail for a reason that has nothing to do
        // with the change being tested. Emptying the credentials here asserts the documented
        // no-mail behaviour deliberately, rather than depending on the absence of a gitignored
        // file that CI happens not to have.
        "spring.mail.username=",
        "spring.mail.password=",
        "auth.reset.expose-code=true"
})
@AutoConfigureMockMvc
class AuthApiTest {

    @Autowired
    private MockMvc mvc;

    @Autowired
    private com.concourse.repository.UserRepository users;

    private String register(String role) throws Exception {
        return field(register(uniqueEmail("test"), "test-password-123", role), "token");
    }

    private String register(String email, String password, String role) throws Exception {
        return mvc.perform(post("/auth/register")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\","
                                + "\"role\":\"" + role + "\"}"))
                .andExpect(status().isCreated())
                .andReturn().getResponse().getContentAsString();
    }

    /** A null portal stands for a client that did not say which door it came through. */
    private ResultActions login(String email, String password, String portal) throws Exception {
        return mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"password\":\"" + password + "\""
                        + (portal == null ? "" : ",\"portal\":\"" + portal + "\"") + "}"));
    }

    private ResultActions resetPassword(String email, String code, String password) throws Exception {
        return mvc.perform(post("/auth/reset-password").contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"" + email + "\",\"code\":\"" + code + "\","
                        + "\"password\":\"" + password + "\"}"));
    }

    /** Ask for a code and read it straight back, which only the dev config permits. */
    private String requestResetCode(String email) throws Exception {
        String body = mvc.perform(post("/auth/forgot-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();
        return field(body, "code");
    }

    private static String field(String json, String name) {
        Matcher m = Pattern.compile("\"" + name + "\"\\s*:\\s*\"([^\"]*)\"").matcher(json);
        return m.find() ? m.group(1) : null;
    }

    private static String uniqueEmail(String prefix) {
        return prefix + "-" + UUID.randomUUID() + "@concourse.local";
    }

    @Test
    void registeringReturnsAUsableTokenAndMeResolvesIt() throws Exception {
        String token = register("client");
        String me = mvc.perform(get("/auth/me").header("Authorization", "Bearer " + token))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(me).contains("\"role\":\"CLIENT\"").contains("\"provider\":\"LOCAL\"");
    }

    @Test
    void theSameEmailCannotRegisterTwice() throws Exception {
        String email = "dupe-" + UUID.randomUUID() + "@concourse.local";
        String body = "{\"email\":\"" + email + "\",\"password\":\"test-password-123\"}";

        mvc.perform(post("/auth/register").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isCreated());
        mvc.perform(post("/auth/register").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isConflict());
    }

    @Test
    void aWrongPasswordIsRejected() throws Exception {
        String email = "wrong-" + UUID.randomUUID() + "@concourse.local";
        mvc.perform(post("/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"test-password-123\"}"))
                .andExpect(status().isCreated());

        mvc.perform(post("/auth/login").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + email + "\",\"password\":\"not-the-password\"}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aGarbageTokenIsRejectedRatherThanTrusted() throws Exception {
        mvc.perform(get("/auth/me").header("Authorization", "Bearer not.a.real.token"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void readingStaysPublicSoTheMarketingMapKeepsWorking() throws Exception {
        mvc.perform(get("/venues")).andExpect(status().isOk());
        mvc.perform(get("/sessions")).andExpect(status().isOk());
    }

    @Test
    void creatingASessionNeedsAToken() throws Exception {
        // 401 rather than 403: with no credentials at all the answer is "who are you", which
        // is a different problem from "I know who you are and the answer is no" — the walker
        // case below. Clients rely on that split to decide between prompting a login and
        // showing a permission error.
        mvc.perform(post("/sessions").contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isUnauthorized());
    }

    @Test
    void aWalkerCannotCreateASession() throws Exception {
        // The interesting half of the rule: a valid token is not the same as permission.
        mvc.perform(post("/sessions").header("Authorization", "Bearer " + register("walker"))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void aClientGetsPastAuthorisationAndReachesValidation() throws Exception {
        // 400, not 403: the empty body is rejected by the controller, which is only reachable
        // once authorisation has already passed.
        mvc.perform(post("/sessions").header("Authorization", "Bearer " + register("client"))
                        .contentType(MediaType.APPLICATION_JSON).content("{}"))
                .andExpect(status().isBadRequest());
    }

    // --- portals ------------------------------------------------------------

    @Test
    void oneAccountOpensBothTheWalkerAndTheClientDoor() throws Exception {
        // The point of the rule: someone who signed up as a client and later opens the walker
        // portal should get in, not be told their own password is wrong.
        String email = uniqueEmail("both-doors");
        register(email, "test-password-123", "client");

        assertThat(login(email, "test-password-123", "walker")
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString())
                .contains("\"role\":\"WALKER\"");

        assertThat(login(email, "test-password-123", "client")
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString())
                .contains("\"role\":\"CLIENT\"");
    }

    @Test
    void registeringAsAnAdminIsRefused() throws Exception {
        mvc.perform(post("/auth/register").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + uniqueEmail("self-admin") + "\","
                                + "\"password\":\"test-password-123\",\"role\":\"admin\"}"))
                .andExpect(status().isForbidden());
    }

    @Test
    void theAdminDoorRefusesAnAccountThatIsNotOnTheAllowlist() throws Exception {
        // 403 rather than a silent downgrade to client: landing somewhere other than the
        // portal you asked for is a worse answer than being told no.
        String email = uniqueEmail("not-admin");
        register(email, "test-password-123", "client");

        login(email, "test-password-123", "admin").andExpect(status().isForbidden());
    }

    @Test
    void beingRefusedTheAdminDoorLeavesTheAccountAlone() throws Exception {
        // The refusal is thrown from inside the transaction that reassigns the role, so this
        // is really asserting the rollback: a rejected attempt at the admin door must not
        // leave the account half-moved.
        String email = uniqueEmail("refusal-clean");
        register(email, "test-password-123", "client");

        login(email, "test-password-123", "admin").andExpect(status().isForbidden());
        assertThat(login(email, "test-password-123", null)
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString())
                .contains("\"role\":\"CLIENT\"");
    }

    @Test
    void anAdminIsDemotedOnceTheirAddressLeavesTheAllowlist() throws Exception {
        // Revocation, which is the reason the grant lives in configuration rather than in the
        // column. This context has an empty allowlist, so an ADMIN row here stands for an
        // account whose address was removed — and the promise is that the next sign-in takes
        // the console away without anyone having to reach the database.
        String email = uniqueEmail("ex-admin");
        register(email, "test-password-123", "client");

        AppUser row = users.findByEmailIgnoreCase(email).orElseThrow();
        row.setRole(AppUser.Role.ADMIN);
        users.save(row);

        assertThat(login(email, "test-password-123", "client")
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString())
                .contains("\"role\":\"CLIENT\"");

        // ...and the admin door closes behind them on the attempt after that.
        login(email, "test-password-123", "admin").andExpect(status().isForbidden());
    }

    // --- password reset -----------------------------------------------------

    @Test
    void aResetCodeSetsANewPasswordAndRetiresTheOldOne() throws Exception {
        String email = uniqueEmail("reset");
        register(email, "original-password-1", "client");

        String code = requestResetCode(email);
        assertThat(code).hasSize(8);

        resetPassword(email, code, "replacement-password-2").andExpect(status().isOk());

        login(email, "original-password-1", null).andExpect(status().isUnauthorized());
        login(email, "replacement-password-2", null).andExpect(status().isOk());
    }

    @Test
    void aResetCodeCannotBeSpentTwice() throws Exception {
        String email = uniqueEmail("reset-once");
        register(email, "original-password-1", "client");
        String code = requestResetCode(email);

        resetPassword(email, code, "replacement-password-2").andExpect(status().isOk());
        // Otherwise the code stays good for the rest of its window, and anyone who saw it once
        // could take the account back after the owner had already recovered it.
        resetPassword(email, code, "attacker-password-3").andExpect(status().isBadRequest());
        login(email, "replacement-password-2", null).andExpect(status().isOk());
    }

    @Test
    void aWrongResetCodeChangesNothing() throws Exception {
        String email = uniqueEmail("reset-wrong");
        register(email, "original-password-1", "client");
        requestResetCode(email);

        resetPassword(email, "AAAAAAAA", "replacement-password-2").andExpect(status().isBadRequest());
        login(email, "original-password-1", null).andExpect(status().isOk());
    }

    @Test
    void askingForASecondCodeInvalidatesTheFirst() throws Exception {
        // One slot on the row, so the newest code overwrites the last. Worth pinning down:
        // someone who requests twice because the first never arrived will use the second.
        String email = uniqueEmail("reset-twice");
        register(email, "original-password-1", "client");

        String first = requestResetCode(email);
        String second = requestResetCode(email);
        assertThat(second).isNotEqualTo(first);

        resetPassword(email, first, "replacement-password-2").andExpect(status().isBadRequest());
        resetPassword(email, second, "replacement-password-2").andExpect(status().isOk());
    }

    @Test
    void signingInSuccessfullyRetiresAnOutstandingResetCode() throws Exception {
        String email = uniqueEmail("reset-abandoned");
        register(email, "original-password-1", "client");
        String code = requestResetCode(email);

        login(email, "original-password-1", null).andExpect(status().isOk());

        resetPassword(email, code, "replacement-password-2").andExpect(status().isBadRequest());
    }

    @Test
    void anUnknownAddressCannotBeToldApartFromARegisteredOne() throws Exception {
        // The whole security property of the endpoint: it accepts any address from anyone, so
        // an answer that differed would make it a free tool for finding out who has an account.
        String body = mvc.perform(post("/auth/forgot-password").contentType(MediaType.APPLICATION_JSON)
                        .content("{\"email\":\"" + uniqueEmail("ghost") + "\"}"))
                .andExpect(status().isOk())
                .andReturn().getResponse().getContentAsString();

        assertThat(field(body, "message"))
                .isEqualTo("If that address has an account, a reset code is on its way.");
        assertThat(field(body, "code")).isNull();
    }
}
