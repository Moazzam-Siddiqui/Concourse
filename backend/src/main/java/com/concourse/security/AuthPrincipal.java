package com.concourse.security;

import com.concourse.model.AppUser;

/** Who a verified token belongs to, independent of which system minted it. */
public record AuthPrincipal(String userId, String email, AppUser.Role role, String provider) { }
