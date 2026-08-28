package com.concourse.security;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.mail.SimpleMailMessage;
import org.springframework.mail.javamail.JavaMailSender;
import org.springframework.stereotype.Component;

import java.time.Duration;

/**
 * Sends password-reset codes by email.
 *
 * <h2>Disabled is a supported state, not a failure</h2>
 *
 * A fresh checkout has no mail account, and a build that refused to start without one would
 * make the whole project depend on a credential nobody has yet. So the mailer reports
 * {@link #enabled()} false when no SMTP username is configured, and the caller falls back to
 * returning the code in the response — the behaviour that made the flow demonstrable before
 * mail existed. Configure the account and delivery switches over with no code change.
 *
 * <h2>Sending is best-effort, and deliberately quiet</h2>
 *
 * {@link #send} never throws. The endpoint that calls it answers identically for every
 * address on purpose, so that it cannot be used to discover which emails have accounts — and
 * a 500 escaping from here for a real address, while an unknown one got a cheerful 200, would
 * hand back exactly the distinction the endpoint is careful not to give. A failure is logged
 * for the operator, who is the one who can act on it, and the caller sees nothing.
 *
 * <h2>Gmail</h2>
 *
 * Google stopped accepting account passwords over SMTP in May 2022. The password here must be
 * a 16-character App Password generated at myaccount.google.com/apppasswords, which needs
 * 2-Step Verification switched on first. The ordinary account password will fail to
 * authenticate no matter how correct it is.
 */
@Component
public class ResetCodeMailer {

    private static final Logger log = LoggerFactory.getLogger(ResetCodeMailer.class);

    private final ObjectProvider<JavaMailSender> sender;
    private final String from;
    private final String username;
    private final String password;
    private final String productName;

    public ResetCodeMailer(ObjectProvider<JavaMailSender> sender,
                           @Value("${spring.mail.username:}") String username,
                           @Value("${spring.mail.password:}") String password,
                           @Value("${auth.reset.mail-from:}") String from,
                           @Value("${auth.reset.product-name:Concourse}") String productName) {
        this.sender = sender;
        this.username = username.trim();
        this.password = password.trim();
        // Most providers reject a From that is not the authenticated mailbox, so the account
        // itself is the sensible default and the override exists only for the setups that
        // permit an alias.
        this.from = from.isBlank() ? this.username : from.trim();
        this.productName = productName;
    }

    /**
     * Both halves of the credential are required, not just the address. A username with no
     * app password would report itself ready and then fail on every send, which reads at
     * startup as "mail is configured" and in practice means no code reaches anyone.
     */
    public boolean enabled() {
        return !username.isEmpty() && !password.isEmpty() && sender.getIfAvailable() != null;
    }

    /** The address codes are sent from, for logs and diagnostics. */
    public String from() {
        return from;
    }

    /**
     * One line for the startup log describing what will actually happen to a reset code.
     *
     * Names which half of the credential is missing rather than saying only "not configured".
     * The two failures need different fixes — a missing username means the config file is not
     * being read at all, a missing password means it is, and only the app password is left —
     * and telling them apart from the outside otherwise means guessing.
     */
    public String status() {
        if (enabled()) return "emailed from " + from;
        if (username.isEmpty() && password.isEmpty()) return "no mail account configured";
        if (username.isEmpty()) return "spring.mail.username is not set";
        return "no app password for " + username + " (spring.mail.password is empty)";
    }

    /**
     * @return true if the message was handed to the SMTP server, false if it was not sent at
     *         all — which the caller uses to decide whether the code still needs to be shown
     *         on screen, because a code nobody can read is worse than one shown in the clear.
     */
    public boolean send(String to, String code, Duration validFor) {
        if (!enabled()) return false;

        JavaMailSender mail = sender.getIfAvailable();
        if (mail == null) return false;

        try {
            SimpleMailMessage message = new SimpleMailMessage();
            message.setFrom(from);
            message.setTo(to);
            message.setSubject(productName + " — your password reset code");
            message.setText(body(code, validFor));
            mail.send(message);
            log.info("Reset code emailed to {} from {}", to, from);
            return true;
        } catch (Exception e) {
            // Wrong app password, blocked port, offline — all the same to the caller.
            log.error("Could not email a reset code to {} (from {}): {}", to, from, e.getMessage());
            return false;
        }
    }

    private String body(String code, Duration validFor) {
        return """
                Someone asked to reset the password for this %s account.

                Your reset code is:

                    %s

                It is valid for %d minutes and can be used once.

                If this was not you, you can ignore this email — nothing has changed, and the
                code is useless without access to this inbox.
                """.formatted(productName, code, validFor.toMinutes());
    }
}
