package com.concourse.security;

import com.concourse.model.AppUser;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Service;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.Optional;

/**
 * Mints and checks the tokens this backend issues itself.
 *
 * HS256 with a shared secret, because both the minting and the verifying happen in this one
 * service — an asymmetric key would add key distribution for no benefit here. Supabase and
 * Firebase tokens are *not* handled by this class; they have their own verifiers.
 *
 * The secret must be supplied in any deployed environment. The development default is a fixed
 * string that is deliberately obvious, and {@link #assertProductionSecret} refuses to start
 * with it under the cloud profile — a JWT secret that ships in source is the same as no auth.
 */
@Service
public class JwtService implements TokenVerifier {

    private static final Logger log = LoggerFactory.getLogger(JwtService.class);

    static final String DEV_SECRET = "dev-only-insecure-secret-change-me-in-any-real-deployment";

    private final SecretKey key;
    private final Duration ttl;
    private final String issuer;

    public JwtService(
            @Value("${auth.jwt.secret:" + DEV_SECRET + "}") String secret,
            @Value("${auth.jwt.ttl-minutes:720}") long ttlMinutes,
            @Value("${auth.jwt.issuer:concourse}") String issuer,
            Environment environment) {

        // This call is the whole point of assertProductionSecret. It used to exist only as a
        // method nobody invoked, so the promise made in application.yml and docker-compose.yml
        // ("the cloud profile refuses to start on the default") was not true: a deployment
        // that forgot AUTH_JWT_SECRET booted happily on a secret published in this repo, and
        // anyone reading it could mint themselves an ADMIN token.
        String profiles = String.join(",", environment.getActiveProfiles());
        assertProductionSecret(secret, profiles);

        byte[] raw = secret.getBytes(StandardCharsets.UTF_8);
        if (raw.length < 32) {
            // HS256 needs >= 256 bits of key material. Padding a short secret keeps local dev
            // working, but it does not create entropy: a 6-character secret padded to 32 bytes
            // is still a 6-character secret. assertProductionSecret refuses to let a padded
            // key reach a deployed environment, so this path is dev-only by construction.
            log.warn("auth.jwt.secret is {} bytes; padding to 32 for HS256. This is acceptable "
                     + "for local development only.", raw.length);
            byte[] padded = new byte[32];
            System.arraycopy(raw, 0, padded, 0, raw.length);
            for (int i = raw.length; i < 32; i++) padded[i] = (byte) ('x' + (i % 7));
            raw = padded;
        }
        this.key = Keys.hmacShaKeyFor(raw);
        this.ttl = Duration.ofMinutes(ttlMinutes);
        this.issuer = issuer;
    }

    public String mint(AppUser user) {
        Instant now = Instant.now();
        return Jwts.builder()
                .issuer(issuer)
                .subject(user.getId())
                .claim("email", user.getEmail())
                .claim("role", user.getRole().name())
                .issuedAt(Date.from(now))
                .expiration(Date.from(now.plus(ttl)))
                .signWith(key)
                .compact();
    }

    public long ttlSeconds() { return ttl.toSeconds(); }

    @Override public String name() { return "LOCAL"; }
    @Override public boolean enabled() { return true; }

    @Override
    public Optional<AuthPrincipal> verify(String token) {
        try {
            Claims c = Jwts.parser().verifyWith(key).requireIssuer(issuer).build()
                    .parseSignedClaims(token).getPayload();
            return Optional.of(new AuthPrincipal(
                    c.getSubject(),
                    c.get("email", String.class),
                    AppUser.Role.valueOf(c.get("role", String.class)),
                    "LOCAL"));
        } catch (Exception ignored) {
            // Wrong signature, expired, or simply a token minted by Supabase/Firebase. All of
            // those mean "not mine", which the filter handles by trying the next verifier.
            return Optional.empty();
        }
    }

    /**
     * Refuses to hand back a usable signing key for a deployed environment that never set one.
     *
     * Called from the constructor, so a violation fails the application context and the process
     * exits instead of serving traffic with forgeable tokens.
     *
     * Outside the cloud profile this warns rather than throws: local development and the test
     * suite both run on the default, and turning that into a hard failure would mean nobody can
     * clone the repo and press run.
     */
    public static void assertProductionSecret(String secret, String activeProfiles) {
        boolean deployed = activeProfiles.contains("cloud");
        boolean isDefault = DEV_SECRET.equals(secret);
        boolean tooShort = secret.getBytes(StandardCharsets.UTF_8).length < 32;

        if (deployed && isDefault) {
            throw new IllegalStateException(
                    "auth.jwt.secret is still the development default, which is published in "
                    + "this repository. Anyone could mint an ADMIN token. Set AUTH_JWT_SECRET "
                    + "to at least 32 bytes of random material before running the cloud profile.");
        }
        if (deployed && tooShort) {
            throw new IllegalStateException(
                    "auth.jwt.secret is shorter than the 32 bytes HS256 requires. Padding it "
                    + "would fake the length without adding entropy. Set AUTH_JWT_SECRET to at "
                    + "least 32 bytes of random material.");
        }
        if (!deployed && isDefault) {
            log.warn("Running on the built-in development JWT secret. Every token this process "
                     + "issues is forgeable by anyone with the source. Never expose this to a "
                     + "network you do not control.");
        }
    }
}
