package com.concourse.controller;

import com.concourse.model.AppUser;
import com.concourse.repository.UserRepository;
import com.concourse.security.AuthPrincipal;
import com.concourse.security.JwtService;
import com.concourse.security.PasswordPolicy;
import com.concourse.security.ResetCodeMailer;
import jakarta.validation.Valid;
import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.server.ResponseStatusException;

import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Registration, login and password recovery for locally-held accounts.
 *
 * Only the LOCAL provider has endpoints here. Supabase and Firebase users never sign in
 * through this backend at all — they authenticate against their own provider and arrive with
 * a token, which {@code JwtAuthFilter} verifies and provisions on first use. That asymmetry is
 * intentional: proxying someone else login form would mean handling their passwords, which is
 * the one thing delegating auth is supposed to avoid.
 *
 * <h2>Portals and roles</h2>
 *
 * The frontend has three doors — walker, client, admin — and sends which one was used as
 * {@code portal}. Walker and client are two views of the same account: signing in at either
 * door works and moves the account to that role, because both are self-service anyway and
 * making someone keep a second email to switch would protect nothing.
 *
 * ADMIN is the exception and is deliberately not reachable from outside: it cannot be
 * requested at registration and cannot be reached by signing in at the admin door. The
 * operations console sees every venue on the platform, so the grant belongs with whoever runs
 * the platform, and it is made through {@code auth.admin-emails} — an allowlist read from
 * configuration and applied on every registration and login.
 *
 * Deciding it by configuration rather than by a column has one property worth the trade: it is
 * reversible from outside the database. Removing an address demotes that account on its next
 * login without anyone having to reach the production Postgres, and adding one lets the
 * intended person register through the normal form instead of needing a row written for them.
 */
@RestController
@RequestMapping("/auth")
public class AuthController {

    private static final Logger log = LoggerFactory.getLogger(AuthController.class);

    // Password shape is checked by PasswordPolicy rather than by @Size, so that registration
    // and reset cannot drift apart and so the message names every rule broken at once instead
    // of the first one.
    public record RegisterRequest(
            @Email(message = "Enter a valid email address") @NotBlank String email,
            @NotBlank String password,
            String role) { }

    /** {@code portal} is which door was used; absent means "wherever the account already is". */
    public record LoginRequest(@NotBlank String email, @NotBlank String password, String portal) { }

    public record ForgotPasswordRequest(
            @Email(message = "Enter a valid email address") @NotBlank String email) { }

    public record ResetPasswordRequest(
            @Email(message = "Enter a valid email address") @NotBlank String email,
            @NotBlank String code,
            @NotBlank String password) { }

    /** {@code code} is populated only where {@code auth.reset.expose-code} is on — see below. */
    public record ForgotPasswordResponse(String message, String code, Long expiresInSeconds) { }

    public record TokenResponse(String token, String tokenType, long expiresIn, UserResponse user) { }

    public record UserResponse(String id, String email, String role, String provider,
                               String displayName, String bio, String avatar) {
        static UserResponse of(AppUser u) {
            return new UserResponse(u.getId(), u.getEmail(), u.getRole().name(), u.getProvider(),
                    u.getDisplayName(), u.getBio(), u.getAvatar());
        }
    }

    /**
     * A profile edit. Every field is optional and only the ones present are written, so the
     * client can save a name without having to send the avatar back with it.
     *
     * Clearing is explicit rather than implied by omission: an empty string blanks the field,
     * a missing field leaves it alone. Without that distinction there is no way to remove an
     * avatar you have already set.
     */
    public record ProfileRequest(
            @Size(max = 120, message = "Display name cannot be longer than 120 characters")
            String displayName,
            @Size(max = 280, message = "Bio cannot be longer than 280 characters")
            String bio,
            String avatar) { }

    /**
     * No I, O, 0 or 1 — a recovery code gets read off one screen and typed into another, and
     * those four are the pairs people transcribe wrongly. 32^8 combinations remain, which is
     * far more than a 30-minute window and a single-use code can be guessed through.
     */
    private static final char[] CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789".toCharArray();
    private static final int CODE_LENGTH = 8;
    private static final SecureRandom RANDOM = new SecureRandom();

    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final JwtService jwt;
    private final ResetCodeMailer mailer;
    private final boolean exposeResetCode;
    private final Duration resetTtl;
    private final Set<String> adminEmails;

    public AuthController(UserRepository users, PasswordEncoder encoder, JwtService jwt,
                          ResetCodeMailer mailer,
                          @Value("${auth.reset.expose-code:true}") boolean exposeResetCode,
                          @Value("${auth.reset.ttl-minutes:30}") long resetTtlMinutes,
                          @Value("${auth.admin-emails:}") String adminEmails,
                          org.springframework.core.env.Environment environment) {
        this.users = users;
        this.encoder = encoder;
        this.jwt = jwt;
        this.mailer = mailer;
        this.exposeResetCode = exposeResetCode;
        this.resetTtl = Duration.ofMinutes(resetTtlMinutes);
        this.adminEmails = Arrays.stream(adminEmails.split(","))
                .map(AuthController::normalise)
                .filter(s -> !s.isEmpty())
                .collect(Collectors.toUnmodifiableSet());

        if (!this.adminEmails.isEmpty()) {
            log.info("Admin allowlist active for {} address(es)", this.adminEmails.size());
        }
        log.info("Password reset delivery: {}{}", mailer.status(), mailer.enabled() ? ""
                : " — codes are logged" + (exposeResetCode ? " and returned to the caller" : " only"));

        // Returning the reset code in the response is account takeover as a feature: the
        // endpoint accepts any address from anyone without proving ownership, so whoever types
        // an address gets the code for it. application-cloud.yml turns it off, but that is one
        // file away from being edited, and this is too severe to leave to a single override.
        //
        // Refused outright under the cloud profile; noisy everywhere else, because a local
        // demo genuinely needs it and losing that would mean nobody can try the reset flow
        // without standing up a mail server.
        if (exposeResetCode) {
            boolean deployed = String.join(",", environment.getActiveProfiles()).contains("cloud");
            if (deployed) {
                throw new IllegalStateException(
                        "auth.reset.expose-code is true under the cloud profile. The reset "
                        + "endpoint takes any address without proof of ownership, so returning "
                        + "the code hands over any account to anyone who asks. Set "
                        + "AUTH_EXPOSE_RESET_CODE=false.");
            }
            log.warn("auth.reset.expose-code is ON: password reset codes are returned in the "
                     + "HTTP response. Anyone who can reach this API can take over any account. "
                     + "Local development only.");
        }
    }

    @PostMapping("/register")
    @Transactional
    public ResponseEntity<TokenResponse> register(@Valid @RequestBody RegisterRequest body) {
        String email = normalise(body.email());
        enforcePasswordPolicy(body.password());
        if (users.existsByEmailIgnoreCase(email)) {
            throw new ResponseStatusException(HttpStatus.CONFLICT, "That email is already registered");
        }

        AppUser.Role role = parseRole(body.role());
        if (isPlatformAdmin(email)) {
            role = AppUser.Role.ADMIN;
        } else if (role == AppUser.Role.ADMIN) {
            throw adminIsNotSelfService();
        }

        AppUser user = new AppUser(email, encoder.encode(body.password()), role, "LOCAL");
        user.setLastLoginAt(Instant.now());
        users.save(user);

        return ResponseEntity.status(HttpStatus.CREATED).body(issue(user));
    }

    @PostMapping("/login")
    @Transactional
    public TokenResponse login(@Valid @RequestBody LoginRequest body) {
        AppUser user = users.findByEmailIgnoreCase(normalise(body.email()))
                .orElseThrow(AuthController::invalidCredentials);

        // A local password is required here. An account created via Supabase or Firebase has
        // none, and must keep signing in through that provider.
        if (user.getPasswordHash() == null || !encoder.matches(body.password(), user.getPasswordHash())) {
            throw invalidCredentials();
        }
        if (!user.isEnabled()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "This account is disabled");
        }

        applyPortal(user, body.portal());
        user.setLastLoginAt(Instant.now());
        // Signing in successfully retires any outstanding reset code: whoever asked for it
        // clearly did not need it, and leaving it live would keep a second way in open.
        user.setResetCode(null, null);
        users.save(user);
        return issue(user);
    }

    /**
     * Start a password reset. Answers 200 whether or not the address exists.
     *
     * The uniform answer is the entire security property of this endpoint: anyone may call it
     * with any address, so a response that differed would turn it into a free tool for testing
     * which emails hold accounts.
     *
     * There is no mail server in this project, so where the code is delivered depends on
     * configuration. Locally {@code auth.reset.expose-code} is on and the code comes back in
     * the response, which is what makes the flow demonstrable without one. Under the cloud
     * profile it is off and the code only ever reaches the log — at which point sending it
     * somewhere the user can actually read is the one piece left to wire up.
     */
    @PostMapping("/forgot-password")
    @Transactional
    public ForgotPasswordResponse forgotPassword(@Valid @RequestBody ForgotPasswordRequest body) {
        String email = normalise(body.email());
        String generic = "If that address has an account, a reset code is on its way.";

        Optional<AppUser> found = users.findByEmailIgnoreCase(email);
        if (found.isEmpty() || !found.get().isEnabled() || found.get().getPasswordHash() == null) {
            // Unknown, disabled, or an external-provider account with no local password to
            // reset. All three answer identically; only the last is worth a log line.
            found.ifPresent(u -> log.info("Password reset ignored for {} — account is managed by {}",
                    email, u.getProvider()));
            return new ForgotPasswordResponse(generic, null, null);
        }

        AppUser user = found.get();
        String code = generateCode();
        user.setResetCode(encoder.encode(code), Instant.now().plus(resetTtl));
        users.save(user);

        boolean emailed = mailer.send(email, code, resetTtl);
        if (emailed) {
            log.info("Password reset code issued for {} and emailed", email);
        } else {
            log.info("Password reset code for {} is {} (valid {} minutes)", email, code, resetTtl.toMinutes());
        }

        // Show the code on screen only when it was not delivered anywhere else. Once mail is
        // working, continuing to return it would undo the point of sending it: the endpoint
        // takes any address from anyone, so a code in the response is a code handed to whoever
        // typed the address rather than to whoever owns the inbox.
        String visibleCode = (!emailed && exposeResetCode) ? code : null;
        return new ForgotPasswordResponse(generic, visibleCode, resetTtl.toSeconds());
    }

    /** Redeem a reset code for a new password, and sign in with it in the same step. */
    @PostMapping("/reset-password")
    @Transactional
    public TokenResponse resetPassword(@Valid @RequestBody ResetPasswordRequest body) {
        AppUser user = users.findByEmailIgnoreCase(normalise(body.email()))
                .orElseThrow(AuthController::invalidResetCode);

        if (!user.hasLiveResetCode()
                || !encoder.matches(body.code().trim().toUpperCase(Locale.ROOT), user.getResetCodeHash())) {
            throw invalidResetCode();
        }

        // Checked after the code, so that a bad password on a valid code does not also burn
        // the code, and so an attacker without one learns nothing about the policy.
        enforcePasswordPolicy(body.password());

        user.setPasswordHash(encoder.encode(body.password()));
        // Single use. Without this the code stays valid for the rest of its window and would
        // let anyone who saw it once take the account back after the owner had recovered it.
        user.setResetCode(null, null);
        user.setLastLoginAt(Instant.now());
        users.save(user);

        log.info("Password reset completed for {}", user.getEmail());
        return issue(user);
    }

    /** Who the caller is according to whichever provider signed their token. */
    @GetMapping("/me")
    public UserResponse me(@AuthenticationPrincipal AuthPrincipal principal) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not signed in");
        }
        return users.findById(principal.userId())
                .map(UserResponse::of)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unknown account"));
    }

    /**
     * Edit your own profile. Never anyone else's — the row is chosen by the token's subject,
     * so there is no id in the path to tamper with.
     */
    @PatchMapping("/profile")
    public UserResponse updateProfile(@AuthenticationPrincipal AuthPrincipal principal,
                                      @Valid @RequestBody ProfileRequest body) {
        if (principal == null) {
            throw new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Not signed in");
        }
        AppUser user = users.findById(principal.userId())
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Unknown account"));

        if (body.displayName() != null) {
            String name = body.displayName().trim();
            user.setDisplayName(name.isEmpty() ? null : name);
        }
        if (body.bio() != null) {
            String bio = body.bio().trim();
            user.setBio(bio.isEmpty() ? null : bio);
        }
        if (body.avatar() != null) {
            String avatar = body.avatar().trim();
            user.setAvatar(avatar.isEmpty() ? null : validatedAvatar(avatar));
        }
        user.setProfileUpdatedAt(Instant.now());
        return UserResponse.of(users.save(user));
    }

    /** Largest avatar accepted, measured on the encoded string rather than the decoded image. */
    private static final int AVATAR_MAX_CHARS = 180_000;

    /**
     * Accept only an inline image, and only a small one.
     *
     * The column will hold any string, so this is what stops it becoming a general-purpose
     * blob store. A remote URL is refused too: rendering one would let a profile decide which
     * third-party host every viewer's browser calls, which is a tracking pixel with extra
     * steps. Inline data has no such reach.
     */
    private static String validatedAvatar(String avatar) {
        if (!AVATAR_PATTERN.matcher(avatar).find()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Avatar must be an inline PNG, JPEG, WEBP, GIF or SVG image");
        }
        if (avatar.length() > AVATAR_MAX_CHARS) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                    "Avatar is too large — crop or shrink it to roughly 120KB");
        }
        return avatar;
    }

    private static final Pattern AVATAR_PATTERN =
            Pattern.compile("^data:image/(png|jpeg|jpg|webp|gif|svg\\+xml);base64,[A-Za-z0-9+/=\\s]+$");

    /**
     * Reconcile the account's role with the door it just signed in at.
     *
     * Walker and client swap freely, so one set of credentials works at both. An existing
     * admin keeps ADMIN whichever door they use — it outranks both, and demoting the platform
     * operator because they opened the wrong URL would be a surprising way to lose access.
     */
    private void applyPortal(AppUser user, String portal) {
        // The allowlist is re-read on every login, so both directions of a change take effect
        // at the next sign-in without touching the database.
        if (isPlatformAdmin(user.getEmail())) {
            user.setRole(AppUser.Role.ADMIN);
        } else if (user.getRole() == AppUser.Role.ADMIN) {
            user.setRole(AppUser.Role.CLIENT);
        }

        if (portal == null || portal.isBlank()) return;
        AppUser.Role requested = parseRole(portal);

        if (requested == AppUser.Role.ADMIN && user.getRole() != AppUser.Role.ADMIN) {
            throw adminIsNotSelfService();
        }
        if (user.getRole() == AppUser.Role.ADMIN) return;
        if (requested != AppUser.Role.ADMIN) {
            user.setRole(requested);
        }
    }

    private TokenResponse issue(AppUser user) {
        return new TokenResponse(jwt.mint(user), "Bearer", jwt.ttlSeconds(), UserResponse.of(user));
    }

    /**
     * One gate for every place a password is set.
     *
     * Reports all the broken rules at once. Returning them one at a time turns choosing a
     * password into a guessing game where each attempt reveals one more requirement.
     */
    private static void enforcePasswordPolicy(String password) {
        List<String> problems = PasswordPolicy.violations(password);
        if (!problems.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, String.join(". ", problems));
        }
    }

    private boolean isPlatformAdmin(String email) {
        return email != null && adminEmails.contains(normalise(email));
    }

    private static String normalise(String email) {
        return email.trim().toLowerCase(Locale.ROOT);
    }

    private static String generateCode() {
        StringBuilder sb = new StringBuilder(CODE_LENGTH);
        for (int i = 0; i < CODE_LENGTH; i++) {
            sb.append(CODE_ALPHABET[RANDOM.nextInt(CODE_ALPHABET.length)]);
        }
        return sb.toString();
    }

    private static AppUser.Role parseRole(String raw) {
        if (raw == null || raw.isBlank()) return AppUser.Role.WALKER;
        try {
            return AppUser.Role.valueOf(raw.trim().toUpperCase(Locale.ROOT));
        } catch (IllegalArgumentException e) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "Unknown role: " + raw);
        }
    }

    /**
     * 403 and not 404: the admin portal is real and the caller may well hold a valid account.
     * What is being refused is the elevation, and saying so is more useful than pretending the
     * door is not there.
     */
    private static ResponseStatusException adminIsNotSelfService() {
        return new ResponseStatusException(HttpStatus.FORBIDDEN,
                "Admin access is granted by the platform team and cannot be self-assigned.");
    }

    /** Demoting an ex-admin lands them in the client portal, the more capable of the two. */

    /**
     * One message for both "no such user" and "wrong password" — telling them apart lets an
     * attacker enumerate which emails hold accounts.
     */
    private static ResponseStatusException invalidCredentials() {
        return new ResponseStatusException(HttpStatus.UNAUTHORIZED, "Email or password is incorrect");
    }

    /** Likewise uniform across unknown address, wrong code and expired code. */
    private static ResponseStatusException invalidResetCode() {
        return new ResponseStatusException(HttpStatus.BAD_REQUEST,
                "That reset code is not valid or has expired. Request a new one.");
    }
}
