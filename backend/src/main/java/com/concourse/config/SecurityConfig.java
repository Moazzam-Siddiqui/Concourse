package com.concourse.config;

import com.concourse.repository.UserRepository;
import com.concourse.security.JwtAuthFilter;
import com.concourse.security.RateLimitFilter;
import com.concourse.security.TokenVerifier;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.config.annotation.method.configuration.EnableMethodSecurity;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.UsernamePasswordAuthenticationFilter;

/**
 * Who may call what.
 *
 * The API is stateless: there is no HTTP session and no CSRF token, because every call is
 * authorised by a bearer token that a browser will not attach automatically. CSRF protection
 * exists to defend cookie-based auth, so leaving it on here would break clients without
 * adding protection.
 *
 * The rules are deliberately coarse — reads are open, writes need a role — because the venue
 * map and the marketing pages are meant to be viewable without an account, while anything
 * that starts a simulation or changes a venue is not.
 */
@Configuration
@EnableMethodSecurity
public class SecurityConfig {

    private final JwtAuthFilter jwtAuthFilter;
    private final RateLimitFilter rateLimitFilter;

    public SecurityConfig(java.util.List<TokenVerifier> verifiers, UserRepository users,
                          RateLimitFilter rateLimitFilter) {
        this.jwtAuthFilter = new JwtAuthFilter(verifiers, users);
        this.rateLimitFilter = rateLimitFilter;
    }

    /**
     * Stops Boot from also auto-registering the rate limiter in the plain servlet chain.
     *
     * Any {@code Filter} bean is picked up and added to the servlet chain by default. The
     * limiter is placed explicitly in the security chain below so its position relative to
     * authentication is defined rather than incidental, and registering it twice would make
     * that ordering ambiguous.
     */
    @Bean
    public FilterRegistrationBean<RateLimitFilter> rateLimitFilterRegistration(RateLimitFilter filter) {
        FilterRegistrationBean<RateLimitFilter> registration = new FilterRegistrationBean<>(filter);
        registration.setEnabled(false);
        return registration;
    }

    @Bean
    public PasswordEncoder passwordEncoder() {
        // Cost 10 is the Spring default: ~50ms per hash, which is slow enough to make offline
        // cracking expensive and fast enough not to be a login bottleneck.
        return new BCryptPasswordEncoder();
    }

    @Bean
    public SecurityFilterChain filterChain(HttpSecurity http) throws Exception {
        http
            .csrf(AbstractHttpConfigurer::disable)
            .cors(cors -> { })  // honours the existing CorsConfig WebMvcConfigurer
            .sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
            .authorizeHttpRequests(auth -> auth
                // --- open ---------------------------------------------------------------
                .requestMatchers("/auth/**", "/health").permitAll()
                // Actuator is split rather than blanket-permitted. A load balancer needs the
                // liveness probes anonymously, but the rest of the tree is not harmless:
                // /env and /configprops print resolved configuration including secrets,
                // /heapdump hands over process memory, and /loggers takes POSTs that change
                // log levels at runtime. Exposure is also restricted in application.yml, so
                // enabling an endpoint there still does not make it public here.
                .requestMatchers("/actuator/health", "/actuator/health/**", "/actuator/info").permitAll()
                .requestMatchers("/actuator/**").hasRole("ADMIN")
                // The WebSocket carries its own session id in the URL and is authorised by
                // the handler; the handshake itself cannot send an Authorization header.
                .requestMatchers("/ws/**").permitAll()
                // Reading a venue or watching a running session is public: the live map on the
                // marketing pages has no signed-in user behind it.
                .requestMatchers(HttpMethod.GET, "/venues/**", "/sessions/**", "/simulations/**", "/alerts/**").permitAll()
                .requestMatchers(HttpMethod.OPTIONS, "/**").permitAll()

                // An attendee saying which zone they are standing in. Open, and it has to be:
                // the mobile app has no account by design and the web attendee signs in as
                // WALKER, so either would be refused by the /sessions/** write rule below.
                // Requiring an organiser login to report your own position would also destroy
                // the privacy claim the feature rests on — the whole point is that nothing here
                // is linked to a person.
                //
                // What bounds it instead of authentication: session.max-walkers caps how many a
                // session will hold, session.walker-ttl-ms ages anything injected out within
                // half a minute, and a walker can only ever move a zone *count* — never the
                // simulation, never another client's view, and never the before/after numbers.
                // Stated in docs/api-contract.md rather than left implied.
                .requestMatchers(HttpMethod.PUT, "/sessions/*/walkers/*").permitAll()
                .requestMatchers(HttpMethod.DELETE, "/sessions/*/walkers/*").permitAll()

                // --- writes -------------------------------------------------------------
                // Creating and driving a run is an organiser action; admins can do it too.
                .requestMatchers("/sessions/**", "/simulations/**").hasAnyRole("CLIENT", "ADMIN")
                .requestMatchers("/venues/**").hasAnyRole("CLIENT", "ADMIN")

                .anyRequest().authenticated())
            .addFilterBefore(jwtAuthFilter, UsernamePasswordAuthenticationFilter.class)
            .addFilterBefore(rateLimitFilter, JwtAuthFilter.class)
            // Fail as a JSON API, not as a browser login prompt.
            //
            // The default entry point answers 401 with a WWW-Authenticate challenge, which is
            // meant for HTTP Basic. On a fetch client it makes the browser pop its own
            // credential dialog, and on JDK HTTP clients it triggers a re-authentication retry
            // that fails outright on a streamed body. Neither is useful when the caller is
            // supposed to send a bearer token, so the challenge is dropped.
            .exceptionHandling(ex -> ex
                .authenticationEntryPoint((request, response, authException) -> {
                    response.setStatus(HttpStatus.UNAUTHORIZED.value());
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    response.getWriter().write("{\"message\":\"Authentication required\"}");
                })
                .accessDeniedHandler((request, response, denied) -> {
                    response.setStatus(HttpStatus.FORBIDDEN.value());
                    response.setContentType(MediaType.APPLICATION_JSON_VALUE);
                    response.getWriter().write("{\"message\":\"You do not have access to this resource\"}");
                }));

        return http.build();
    }
}
