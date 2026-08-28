package com.concourse.security;

import com.concourse.model.AppUser;
import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Map;
import java.util.Optional;

/**
 * Accepts tokens issued by Supabase Auth.
 *
 * Supabase signs its access tokens HS256 with the project JWT secret, so verification has the
 * same shape as our own — only the key and the claim layout differ. Role is read from
 * {@code app_metadata.role} when the project sets one; otherwise an unknown account lands as
 * WALKER, which is the least-privileged role and the right default for someone we cannot place.
 *
 * Disabled, and skipped by the filter, when {@code auth.supabase.jwt-secret} is unset.
 */
@Component
public class SupabaseTokenVerifier implements TokenVerifier {

    private final SecretKey key;

    public SupabaseTokenVerifier(@Value("${auth.supabase.jwt-secret:}") String secret) {
        this.key = (secret == null || secret.isBlank())
                ? null
                : Keys.hmacShaKeyFor(secret.getBytes(StandardCharsets.UTF_8));
    }

    @Override public String name() { return "SUPABASE"; }

    @Override public boolean enabled() { return key != null; }

    @Override
    public Optional<AuthPrincipal> verify(String token) {
        if (key == null) return Optional.empty();
        try {
            Claims c = Jwts.parser().verifyWith(key).build().parseSignedClaims(token).getPayload();

            AppUser.Role role = AppUser.Role.WALKER;
            Object meta = c.get("app_metadata");
            if (meta instanceof Map<?, ?> m && m.get("role") instanceof String r) {
                try {
                    role = AppUser.Role.valueOf(r.toUpperCase());
                } catch (IllegalArgumentException ignored) {
                    // Unrecognised role string: fall through to WALKER rather than reject the
                    // token, since the signature already proved who the caller is.
                }
            }
            return Optional.of(new AuthPrincipal(
                    c.getSubject(), c.get("email", String.class), role, "SUPABASE"));
        } catch (Exception ignored) {
            return Optional.empty();
        }
    }
}
