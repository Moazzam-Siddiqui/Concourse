package com.concourse;

import static org.assertj.core.api.Assertions.assertThat;

import com.concourse.security.PasswordPolicy;
import org.junit.jupiter.api.Test;

/**
 * The rules themselves, without a server in the way.
 *
 * The endpoints that apply them are covered in {@link AuthApiTest}; this pins the rules down
 * so a change to them is a deliberate edit here rather than a surprise in an HTTP assertion.
 */
class PasswordPolicyTest {

    @Test
    void aPasswordWithLengthLettersAndDigitsIsAccepted() {
        assertThat(PasswordPolicy.isAcceptable("Riptose/123")).isTrue();
        assertThat(PasswordPolicy.isAcceptable("correct7horse")).isTrue();
    }

    @Test
    void everyBrokenRuleIsReportedAtOnce() {
        // One at a time turns choosing a password into a guessing game where each attempt
        // reveals one more requirement.
        assertThat(PasswordPolicy.violations("abc"))
                .hasSize(2)
                .anyMatch(v -> v.contains("at least 8"))
                .anyMatch(v -> v.contains("one number"));
    }

    @Test
    void lettersAndDigitsAreBothRequired() {
        assertThat(PasswordPolicy.violations("passwordonly")).containsExactly("Include at least one number");
        assertThat(PasswordPolicy.violations("1234567890")).containsExactly("Include at least one letter");
    }

    @Test
    void anEdgeSpaceIsRefused() {
        // It survives JSON and BCrypt intact, so such a password works right up until the day
        // someone types it without the space, or pastes it from somewhere that trimmed it.
        assertThat(PasswordPolicy.violations("password1 "))
                .containsExactly("Remove the space at the start or end");
        assertThat(PasswordPolicy.isAcceptable("pass word1")).isTrue();
    }

    @Test
    void aPasswordPastTheBcryptLimitIsRefusedRatherThanSilentlyTruncated() {
        // BCrypt ignores everything after 72 bytes. Accepting a 200-character password would
        // be promising strength that is thrown away before it is ever hashed.
        assertThat(PasswordPolicy.violations("a1" + "x".repeat(100)))
                .containsExactly("Use at most 72 characters");
    }

    @Test
    void nothingAtAllIsOneClearMessage() {
        assertThat(PasswordPolicy.violations(null)).containsExactly("Enter a password");
        assertThat(PasswordPolicy.violations("")).containsExactly("Enter a password");
    }
}
