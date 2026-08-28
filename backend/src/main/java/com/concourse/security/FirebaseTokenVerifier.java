package com.concourse.security;

import com.concourse.model.AppUser;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import java.io.ByteArrayInputStream;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.security.PublicKey;
import java.security.Signature;
import java.security.cert.CertificateFactory;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;

/**
 * Accepts Firebase ID tokens.
 *
 * Unlike the other two providers, Firebase signs RS256 with rotating Google keys, so this
 * verifier has to fetch public certificates and re-fetch them as they roll. Certificates are
 * cached for an hour: fetching per request would put a network round trip on the hot path of
 * every API call.
 *
 * The signature is checked directly against the X.509 certificate using the JDK crypto
 * classes rather than through a JWT library. That keeps the RSA path off our dependency list
 * when only this one provider needs it.
 *
 * Disabled, and skipped by the filter, when {@code auth.firebase.project-id} is unset.
 */
@Component
public class FirebaseTokenVerifier implements TokenVerifier {

    private static final String CERT_URL =
            "https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com";

    private final String projectId;
    private final HttpClient http = HttpClient.newBuilder().connectTimeout(Duration.ofSeconds(5)).build();
    private final ObjectMapper mapper = new ObjectMapper();
    private final Base64.Decoder urlDecoder = Base64.getUrlDecoder();

    private volatile Map<String, PublicKey> certs = Map.of();
    private volatile Instant certsFetchedAt = Instant.EPOCH;

    public FirebaseTokenVerifier(@Value("${auth.firebase.project-id:}") String projectId) {
        this.projectId = projectId == null ? "" : projectId.trim();
    }

    @Override public String name() { return "FIREBASE"; }

    @Override public boolean enabled() { return !projectId.isBlank(); }

    @Override
    public Optional<AuthPrincipal> verify(String token) {
        if (!enabled()) return Optional.empty();
        try {
            String[] parts = token.split("\\.");
            if (parts.length != 3) return Optional.empty();

            JsonNode header = mapper.readTree(urlDecoder.decode(parts[0]));
            JsonNode claims = mapper.readTree(urlDecoder.decode(parts[1]));

            if (!"RS256".equals(header.path("alg").asText())) return Optional.empty();

            // aud and iss must name this project. Without both checks, a token minted by
            // anyone else Firebase project would authenticate here.
            if (!projectId.equals(claims.path("aud").asText())) return Optional.empty();
            if (!("https://securetoken.google.com/" + projectId).equals(claims.path("iss").asText())) {
                return Optional.empty();
            }
            if (claims.path("exp").asLong() <= Instant.now().getEpochSecond()) return Optional.empty();

            PublicKey pk = keyFor(header.path("kid").asText());
            if (pk == null) return Optional.empty();

            Signature sig = Signature.getInstance("SHA256withRSA");
            sig.initVerify(pk);
            sig.update((parts[0] + "." + parts[1]).getBytes(StandardCharsets.US_ASCII));
            if (!sig.verify(urlDecoder.decode(parts[2]))) return Optional.empty();

            AppUser.Role role = AppUser.Role.WALKER;
            String claimed = claims.path("role").asText(null);
            if (claimed != null) {
                try {
                    role = AppUser.Role.valueOf(claimed.toUpperCase());
                } catch (IllegalArgumentException ignored) {
                    // Unknown role claim: stay on the least-privileged default.
                }
            }
            return Optional.of(new AuthPrincipal(
                    claims.path("sub").asText(), claims.path("email").asText(null), role, "FIREBASE"));
        } catch (Exception ignored) {
            return Optional.empty();
        }
    }

    private PublicKey keyFor(String kid) throws Exception {
        if (Instant.now().isAfter(certsFetchedAt.plus(Duration.ofHours(1)))) refreshCerts();
        PublicKey pk = certs.get(kid);
        if (pk == null) {
            // Unseen key id: Google may have rotated ahead of our cache expiry.
            refreshCerts();
            pk = certs.get(kid);
        }
        return pk;
    }

    private synchronized void refreshCerts() throws Exception {
        HttpResponse<String> res = http.send(
                HttpRequest.newBuilder(URI.create(CERT_URL)).timeout(Duration.ofSeconds(5)).GET().build(),
                HttpResponse.BodyHandlers.ofString());
        if (res.statusCode() != 200) return;

        JsonNode body = mapper.readTree(res.body());
        Map<String, PublicKey> next = new HashMap<>();
        CertificateFactory factory = CertificateFactory.getInstance("X.509");
        body.fields().forEachRemaining(entry -> {
            try {
                var cert = factory.generateCertificate(
                        new ByteArrayInputStream(entry.getValue().asText().getBytes(StandardCharsets.UTF_8)));
                next.put(entry.getKey(), cert.getPublicKey());
            } catch (Exception ignored) {
                // One bad certificate should not discard the rest of the set.
            }
        });
        if (!next.isEmpty()) {
            certs = Map.copyOf(next);
            certsFetchedAt = Instant.now();
        }
    }
}
