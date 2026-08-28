package com.concourse.security;

import java.util.ArrayList;
import java.util.List;

/**
 * What counts as an acceptable password, in one place.
 *
 * Register and reset both go through here so the two cannot drift — a reset endpoint with a
 * weaker rule than registration is a way around the rule, not a second opinion about it.
 *
 * <h2>Why these rules and not more</h2>
 *
 * Length, one letter and one digit. No forced symbol, no forced mixed case, no expiry. Those
 * additions push people towards {@code Password1!} and a sticky note rather than towards
 * anything harder to guess, which is why NIST dropped composition rules from its own guidance.
 * Length is the part that actually costs an attacker something, so it is the part enforced.
 *
 * The rules apply to passwords being <em>set</em>, never to one being checked at login.
 * Validating on the way in would lock out every account whose password predates a rule change,
 * and would leak which accounts those are.
 */
public final class PasswordPolicy {

    public static final int MIN_LENGTH = 8;
    /** BCrypt silently ignores anything past 72 bytes, so a longer password is a false promise. */
    public static final int MAX_LENGTH = 72;

    private PasswordPolicy() { }

    /** Every rule the candidate breaks, in the order a person would want to read them. */
    public static List<String> violations(String password) {
        List<String> problems = new ArrayList<>();
        if (password == null || password.isEmpty()) {
            problems.add("Enter a password");
            return problems;
        }
        if (password.length() < MIN_LENGTH) {
            problems.add("Use at least " + MIN_LENGTH + " characters");
        }
        if (password.length() > MAX_LENGTH) {
            problems.add("Use at most " + MAX_LENGTH + " characters");
        }
        if (password.chars().noneMatch(Character::isLetter)) {
            problems.add("Include at least one letter");
        }
        if (password.chars().noneMatch(Character::isDigit)) {
            problems.add("Include at least one number");
        }
        // Leading or trailing spaces survive the round trip through JSON and BCrypt, so a
        // password that ends in one works until the day it is typed without it.
        if (!password.equals(password.strip())) {
            problems.add("Remove the space at the start or end");
        }
        return problems;
    }

    public static boolean isAcceptable(String password) {
        return violations(password).isEmpty();
    }
}
