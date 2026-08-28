package com.concourse.security;

import com.concourse.model.AppUser;
import com.concourse.repository.UserRepository;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.security.authentication.UsernamePasswordAuthenticationToken;
import org.springframework.security.core.authority.SimpleGrantedAuthority;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.filter.OncePerRequestFilter;

import java.io.IOException;
import java.util.List;
import java.util.Optional;

/**
 * Turns a bearer token into an authenticated caller.
 *
 * The token is offered to each enabled {@link TokenVerifier} in turn and the first that
 * recognises it wins. That is the whole mechanism behind supporting local, Supabase and
 * Firebase auth simultaneously — a request carrying any of the three is accepted, and a
 * request carrying none simply stays anonymous for the authorisation rules to reject.
 *
 * Deliberately not a {@code @Component}: Spring Boot auto-registers any filter bean with the
 * servlet container, and the security chain adds it a second time. Tomcat then initialises the
 * same instance twice and the second init fails on a half-built bean. It is constructed in
 * SecurityConfig instead, which is the only place it should be wired.
 *
 * Externally-issued accounts are provisioned on first sight: a valid Supabase or Firebase
 * token identifies a real person, but there is no row for them until they arrive here. Without
 * that, every downstream lookup by user id would fail for exactly the users who authenticated
 * correctly.
 */
public class JwtAuthFilter extends OncePerRequestFilter {

    private final List<TokenVerifier> verifiers;
    private final UserRepository users;

    public JwtAuthFilter(List<TokenVerifier> verifiers, UserRepository users) {
        this.verifiers = verifiers;
        this.users = users;
    }

    @Override
    @Transactional
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response,
                                    FilterChain chain) throws ServletException, IOException {
        String header = request.getHeader("Authorization");
        if (header != null && header.startsWith("Bearer ")
                && SecurityContextHolder.getContext().getAuthentication() == null) {

            String token = header.substring(7).trim();
            for (TokenVerifier verifier : verifiers) {
                if (!verifier.enabled()) continue;

                Optional<AuthPrincipal> maybe = verifier.verify(token);
                if (maybe.isEmpty()) continue;

                AuthPrincipal principal = maybe.get();
                AppUser user = resolveUser(principal);
                if (user == null || !user.isEnabled()) break;

                var authority = new SimpleGrantedAuthority("ROLE_" + user.getRole().name());
                var auth = new UsernamePasswordAuthenticationToken(
                        new AuthPrincipal(user.getId(), user.getEmail(), user.getRole(), principal.provider()),
                        null, List.of(authority));
                SecurityContextHolder.getContext().setAuthentication(auth);
                break;
            }
        }
        chain.doFilter(request, response);
    }

    /** Local tokens map to an existing row; external ones create it on first use. */
    private AppUser resolveUser(AuthPrincipal principal) {
        if ("LOCAL".equals(principal.provider())) {
            return users.findById(principal.userId()).orElse(null);
        }

        return users.findByProviderAndProviderSubject(principal.provider(), principal.userId())
                .or(() -> Optional.ofNullable(principal.email()).flatMap(users::findByEmailIgnoreCase))
                .map(existing -> {
                    // An account first created locally, then signed into via a provider: bind
                    // the subject so the next login is a direct hit rather than an email match.
                    if (existing.getProviderSubject() == null) {
                        existing.setProvider(principal.provider());
                        existing.setProviderSubject(principal.userId());
                        users.save(existing);
                    }
                    return existing;
                })
                .orElseGet(() -> {
                    AppUser created = new AppUser(
                            principal.email() != null ? principal.email()
                                    : principal.provider().toLowerCase() + ":" + principal.userId(),
                            null, principal.role(), principal.provider());
                    created.setProviderSubject(principal.userId());
                    return users.save(created);
                });
    }

    /**
     * The WebSocket handshake cannot send an Authorization header, so there is nothing to read.
     *
     * Actuator is deliberately NOT skipped any more. Everything below /actuator except the
     * probes now requires ROLE_ADMIN, and a filter that never parses the token would leave the
     * caller anonymous — making that rule impossible to satisfy rather than merely strict.
     */
    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return RequestPaths.of(request).startsWith("/ws");
    }
}
