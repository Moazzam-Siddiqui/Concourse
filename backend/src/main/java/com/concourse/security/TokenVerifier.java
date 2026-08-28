package com.concourse.security;

import java.util.Optional;

/**
 * One way to prove a bearer token is genuine.
 *
 * All three supported providers reduce to the same question — "is this JWT validly signed by
 * someone I trust, and who does it say the caller is?" — so they differ only in the key used
 * to check the signature. Keeping that behind an interface is what lets the app accept local,
 * Supabase and Firebase tokens at the same time: the filter asks each verifier in turn and
 * takes the first that recognises the token.
 *
 * A verifier that is not configured must return {@link #enabled()} false rather than throwing,
 * so an install that only uses local auth never pays for the other two.
 */
public interface TokenVerifier {

    /** LOCAL, SUPABASE or FIREBASE. Stored on the user row so re-logins map to one account. */
    String name();

    /** False when the required config is absent; the filter then skips this verifier. */
    boolean enabled();

    /**
     * @return the caller when this verifier recognises and trusts the token, otherwise empty.
     *         Empty means "not mine / not valid" — never an exception, because a token from
     *         one provider being unreadable by another is the normal case, not an error.
     */
    Optional<AuthPrincipal> verify(String token);
}
