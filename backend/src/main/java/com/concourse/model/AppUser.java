package com.concourse.model;

import jakarta.persistence.*;
import java.time.Instant;

/**
 * A person who can sign in.
 *
 * The role here is the same three-way split the frontend portals use, and it is the only
 * thing that decides what a token is allowed to reach. It is stored on the row rather than
 * derived, so revoking someone's access is an UPDATE and not a redeploy.
 *
 * {@code passwordHash} is nullable on purpose: accounts that arrive from Supabase or Firebase
 * never have a local password, and storing an empty string for them would make "has no local
 * password" indistinguishable from "password is blank".
 *
 * The reset fields hold at most one live password-reset challenge. Keeping them on the row
 * rather than in a table of their own is what makes requesting a second code invalidate the
 * first for free: there is only one slot, so the newest code overwrites the last.
 */
@Entity
@Table(name = "app_user", indexes = @Index(name = "ix_app_user_email", columnList = "email", unique = true))
public class AppUser {

    public enum Role { WALKER, CLIENT, ADMIN }

    @Id
    @GeneratedValue(strategy = GenerationType.UUID)
    private String id;

    @Column(nullable = false, unique = true, length = 320)
    private String email;

    @Column(name = "password_hash", length = 100)
    private String passwordHash;

    @Enumerated(EnumType.STRING)
    @Column(nullable = false, length = 16)
    private Role role = Role.WALKER;

    /** Which system vouched for this account: LOCAL, SUPABASE or FIREBASE. */
    @Column(nullable = false, length = 16)
    private String provider = "LOCAL";

    /** The subject claim from an external provider, so a re-login maps to the same row. */
    @Column(name = "provider_subject", length = 128)
    private String providerSubject;

    @Column(name = "display_name", length = 120)
    private String displayName;

    @Column(nullable = false)
    private boolean enabled = true;

    @Column(name = "created_at", nullable = false)
    private Instant createdAt = Instant.now();

    @Column(name = "last_login_at")
    private Instant lastLoginAt;

    /** BCrypt of the outstanding reset code, never the code itself. */
    @Column(name = "reset_code_hash", length = 100)
    private String resetCodeHash;

    @Column(name = "reset_code_expires_at")
    private Instant resetCodeExpiresAt;

    /** One short line the person writes about themselves. Never required. */
    @Column(length = 280)
    private String bio;

    /**
     * The avatar as a {@code data:image/...;base64,...} URI.
     *
     * Travels with the account rather than behind a second endpoint, so a header can draw it
     * without another round trip. Size is bounded twice: by the application before it is
     * accepted, and by the column width behind that.
     */
    @Column(length = 200_000)
    private String avatar;

    @Column(name = "profile_updated_at")
    private Instant profileUpdatedAt;

    protected AppUser() { }

    public AppUser(String email, String passwordHash, Role role, String provider) {
        this.email = email;
        this.passwordHash = passwordHash;
        this.role = role;
        this.provider = provider;
    }

    public String getId() { return id; }
    public String getEmail() { return email; }
    public String getPasswordHash() { return passwordHash; }
    public void setPasswordHash(String v) { this.passwordHash = v; }
    public Role getRole() { return role; }
    public void setRole(Role v) { this.role = v; }
    public String getProvider() { return provider; }
    public void setProvider(String v) { this.provider = v; }
    public String getProviderSubject() { return providerSubject; }
    public void setProviderSubject(String v) { this.providerSubject = v; }
    public String getDisplayName() { return displayName; }
    public void setDisplayName(String v) { this.displayName = v; }
    public boolean isEnabled() { return enabled; }
    public void setEnabled(boolean v) { this.enabled = v; }
    public Instant getCreatedAt() { return createdAt; }
    public Instant getLastLoginAt() { return lastLoginAt; }
    public void setLastLoginAt(Instant v) { this.lastLoginAt = v; }
    public String getBio() { return bio; }
    public void setBio(String v) { this.bio = v; }
    public String getAvatar() { return avatar; }
    public void setAvatar(String v) { this.avatar = v; }
    public Instant getProfileUpdatedAt() { return profileUpdatedAt; }
    public void setProfileUpdatedAt(Instant v) { this.profileUpdatedAt = v; }
    public String getResetCodeHash() { return resetCodeHash; }
    public Instant getResetCodeExpiresAt() { return resetCodeExpiresAt; }

    /** Arm a reset challenge, or clear it by passing nulls. */
    public void setResetCode(String hash, Instant expiresAt) {
        this.resetCodeHash = hash;
        this.resetCodeExpiresAt = expiresAt;
    }

    public boolean hasLiveResetCode() {
        return resetCodeHash != null && resetCodeExpiresAt != null
                && resetCodeExpiresAt.isAfter(Instant.now());
    }
}
