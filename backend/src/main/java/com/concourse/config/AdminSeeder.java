package com.concourse.config;

import com.concourse.model.AppUser;
import com.concourse.repository.UserRepository;
import com.concourse.security.PasswordPolicy;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;
import java.util.List;
import java.util.Locale;

/**
 * Makes sure the allowlisted admin accounts exist before anyone tries to sign in.
 *
 * Without this the allowlist has a hole in the middle: it promotes an address at
 * registration or login, but admin is refused at the registration form, so the very first
 * admin could never create themselves through the UI. Seeding closes that — the account is
 * there on first boot with a known password, and the console is reachable immediately.
 *
 * <h2>An existing account is promoted, never overwritten</h2>
 *
 * If the row already exists this only ensures it is an enabled ADMIN. The password is left
 * exactly as it is, because re-applying the configured one on every boot would silently undo
 * a password the operator had deliberately changed — and would keep resurrecting whatever
 * value is sitting in a config file long after they thought they had moved off it.
 *
 * <h2>No password, no account</h2>
 *
 * With {@code auth.admin-password} unset nothing is created, and that is the right outcome
 * rather than an error: inventing a default would put a known-password admin account on every
 * deployment that forgot to configure one. The allowlist still works — the address simply has
 * to register or sign in once to bring its row into existence.
 */
@Component
public class AdminSeeder implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AdminSeeder.class);

    private final UserRepository users;
    private final PasswordEncoder encoder;
    private final List<String> adminEmails;
    private final String adminPassword;

    public AdminSeeder(UserRepository users, PasswordEncoder encoder,
                       @Value("${auth.admin-emails:}") String adminEmails,
                       @Value("${auth.admin-password:}") String adminPassword) {
        this.users = users;
        this.encoder = encoder;
        this.adminEmails = Arrays.stream(adminEmails.split(","))
                .map(e -> e.trim().toLowerCase(Locale.ROOT))
                .filter(e -> !e.isEmpty())
                .toList();
        this.adminPassword = adminPassword;
    }

    @Override
    @Transactional
    public void run(ApplicationArguments args) {
        if (adminEmails.isEmpty()) {
            log.info("No admin allowlist configured — the operations console has no accounts");
            return;
        }

        for (String email : adminEmails) {
            users.findByEmailIgnoreCase(email).ifPresentOrElse(
                    existing -> promote(existing, email),
                    () -> create(email));
        }
    }

    private void promote(AppUser existing, String email) {
        boolean changed = false;
        if (existing.getRole() != AppUser.Role.ADMIN) {
            existing.setRole(AppUser.Role.ADMIN);
            changed = true;
        }
        if (!existing.isEnabled()) {
            existing.setEnabled(true);
            changed = true;
        }
        if (changed) {
            users.save(existing);
            log.info("Promoted existing account {} to ADMIN", email);
        }
    }

    private void create(String email) {
        if (adminPassword.isBlank()) {
            log.warn("Admin {} is allowlisted but auth.admin-password is not set — no account "
                    + "was created. Set it, or have that address register once.", email);
            return;
        }
        if (!PasswordPolicy.isAcceptable(adminPassword)) {
            // Refusing here rather than seeding anyway: an admin account is the one that must
            // not be the weakest on the platform, and a policy the console itself breaks is
            // not a policy.
            log.error("Admin {} was not created — auth.admin-password fails the password "
                    + "policy: {}", email, PasswordPolicy.violations(adminPassword));
            return;
        }

        AppUser admin = new AppUser(email, encoder.encode(adminPassword), AppUser.Role.ADMIN, "LOCAL");
        users.save(admin);
        log.info("Created ADMIN account {} from auth.admin-password", email);
    }
}
