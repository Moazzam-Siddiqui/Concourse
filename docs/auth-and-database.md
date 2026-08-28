# Auth and database

How accounts and persistence work, and what to set when deploying.

## What runs where

| | Local | Cloud |
|---|---|---|
| Database | H2 file at `backend/data/concourse.mv.db` | Postgres |
| Schema | Flyway, `src/main/resources/db/migration` | same migrations |
| Auth | Self-hosted JWT | Self-hosted JWT, and/or Supabase, and/or Firebase |

No Docker or database install is needed to run this locally. The H2 file is created on first
boot and survives restarts, so accounts you register stay registered.

## Three auth providers, one code path

Every provider reduces to the same question — *is this JWT validly signed by someone I trust,
and who does it say the caller is?* — so they differ only in the key used to check the
signature. `TokenVerifier` captures that, and `JwtAuthFilter` offers each incoming token to
every enabled verifier in turn, taking the first that recognises it.

The practical effect: **all three can be active at once.** A request carrying a locally-minted
token, a Supabase token, or a Firebase token is accepted by the same endpoints, and a verifier
whose config is absent reports `enabled() == false` and is skipped entirely.

| Provider | Signing | Enabled by | Sign-up handled by |
|---|---|---|---|
| `LOCAL` | HS256, our secret | always on | `POST /auth/register` |
| `SUPABASE` | HS256, project JWT secret | `SUPABASE_JWT_SECRET` | Supabase |
| `FIREBASE` | RS256, Google rotating keys | `FIREBASE_PROJECT_ID` | Firebase |

Only `LOCAL` has register/login endpoints here. Supabase and Firebase users authenticate
against their own provider and arrive holding a token; the filter verifies it and creates the
`app_user` row on first sight. Proxying someone else's login form would mean handling their
passwords, which is the one thing delegating auth is meant to avoid.

## Endpoints

```
POST /auth/register         { email, password, role? }       -> 201 { token, user }
POST /auth/login            { email, password, portal? }     -> 200 { token, user }
POST /auth/forgot-password  { email }                        -> 200 { message, code?, expiresInSeconds? }
POST /auth/reset-password   { email, code, password }        -> 200 { token, user }
GET  /auth/me               Authorization: Bearer ...        -> 200 { id, email, role, provider }
```

## Portals, and why admin is different

`portal` is which of the three doors the sign-in screen was opened at.

**Walker and client are one account.** Signing in at either door works and moves the account
to that role. Both are self-service — anyone can register as either — so forcing a second
email address to switch between them would protect nothing and only produce two half-used
accounts per person.

**Admin is not self-service.** It cannot be requested at registration and cannot be reached by
signing in at the admin door; both answer `403`. The console sees every venue on the platform,
so the grant belongs with whoever runs it, and is made through an allowlist:

```bash
AUTH_ADMIN_EMAILS=you@example.com,ops@example.com
```

Applied on every registration and login, which makes it work in both directions without
touching the database: add an address and that account is an admin at its next sign-in, remove
one and it drops back to client. An address on the list can register through the normal form
and comes out as an admin, so nobody has to hand-write a row.

`AdminSeeder` closes the remaining gap. The allowlist can only promote an account that exists,
but admin is refused at the registration form — so on a fresh database the first administrator
would have no way to create themselves. At boot, any allowlisted address without a row is
created with `auth.admin-password`, and any address that already has one is promoted.

An **existing account is never overwritten**: only its role and enabled flag are corrected, and
the password is left alone. Re-applying the configured password every boot would silently undo
a password the operator had changed, and keep resurrecting a value from a config file long
after they thought they had moved off it. With `auth.admin-password` unset, nothing is created
— better than inventing a default, which would put a known-password admin on every deployment
that forgot to configure one.

## Password rules

One policy, `PasswordPolicy.java`, applied by both `register` and `reset-password` so the two
cannot drift — a reset endpoint with a weaker rule than registration is a way around the rule,
not a second opinion about it. `frontend/src/credentials.js` mirrors it so the form can explain
the rules while they are being typed; the server stays the authority.

| Rule | Why |
|---|---|
| 8–72 characters | BCrypt ignores anything past 72 bytes, so a longer password promises strength that is discarded before hashing |
| At least one letter and one number | Cheap to satisfy, rules out the all-digit PIN and the dictionary word |
| No leading or trailing space | It survives JSON and BCrypt intact, so the password works until the day it is typed without it |

No forced symbol, no mixed case, no expiry: those push people towards `Password1!` and a sticky
note rather than towards anything harder to guess, which is why NIST dropped composition rules
from its own guidance. Every broken rule is reported at once — one at a time turns choosing a
password into a guessing game where each attempt reveals one more requirement.

**The rules apply only to passwords being set, never to one being checked at login.** Validating
on the way in would lock out every account whose password predates a rule change, and would leak
which accounts those are.

An existing admin keeps ADMIN whichever door they use — it outranks both, and demoting the
platform operator for opening the wrong URL would be a surprising way to lose the console.

## Password reset

`forgot-password` answers `200` for every address, whether or not it has an account, whether
the account is disabled, and whether it is a Supabase/Firebase account with no local password
to reset. That uniformity is the endpoint's entire security property: anyone may call it with
any address, so a response that differed would be a free tool for testing which emails are
registered. The sign-in screen advances to the code panel regardless, for the same reason.

The code is 8 characters from a 32-letter alphabet with `I`, `O`, `0` and `1` removed — those
are the pairs people mistype when reading a code off one screen and into another. It lives for
30 minutes, is stored BCrypt-hashed on the user row exactly as a password is, and is retired
on first use, on a successful sign-in, and whenever a newer code is requested.

### Delivery

`ResetCodeMailer` sends the code over SMTP. It reports itself disabled unless **both** a
username and a password are configured — a username alone would announce "mail is configured"
at startup and then fail on every send.

The code is returned in the HTTP response **only when it was not delivered anywhere else**.
Once mail works, continuing to return it would undo the point of sending it: the endpoint
accepts any address from anyone, so a code in the response is a code handed to whoever typed
the address rather than to whoever owns the inbox. With no mail account the code falls back to
the log and the response, which is what makes the flow demonstrable on a fresh checkout.

Sending is best-effort and never throws. A failure is logged for the operator, who is the one
who can act on it, and the caller sees the same `200` as everyone else — an exception escaping
for a real address while an unknown one got a cheerful `200` would hand back exactly the
distinction the endpoint is careful not to give.

### Gmail

Google stopped accepting account passwords over SMTP in May 2022. `spring.mail.password` must
be a **16-character App Password** from
[myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords), which requires
2-Step Verification on the account first. The ordinary account password will fail to
authenticate no matter how correct it is.

## Where secrets live

`backend/secrets.yml` is gitignored and imported by `application.yml` at startup
(`spring.config.import: optional:file:./secrets.yml`). It holds the admin allowlist, the admin
password and the SMTP app password. `optional:` means a checkout without one still boots — no
admin is seeded and codes are not emailed. Copy `secrets.example.yml` to start one.

**`auth.admin-emails` belongs here, not in `application.yml`.** The committed default is empty
on purpose: this is a public repository, and a real address in it would publish both who holds
admin and that person's inbox. Empty means nobody has an admin portal, which is the safe way to
be wrong.

Anything in it can equally be an environment variable, which is what a deployment should use:

```bash
AUTH_ADMIN_EMAILS=you@example.com
AUTH_ADMIN_PASSWORD=...
MAIL_USERNAME=...
MAIL_PASSWORD=...      # Gmail App Password, not the account password
```

## Access rules

Reads are public so the marketing pages and live map work signed-out. Writes need a role.

| Request | Result |
|---|---|
| `GET /venues`, `GET /sessions` | public |
| `POST /sessions` with no token | 401 — *who are you* |
| `POST /sessions` as `WALKER` | 403 — *known, but not allowed* |
| `POST /sessions` as `CLIENT`/`ADMIN` | allowed |

The 401/403 split is deliberate: clients use it to decide between prompting a login and showing
a permission error.

## Environment variables

Local development needs none. For deployment:

```bash
SPRING_PROFILES_ACTIVE=cloud

# Database (required)
DB_URL=jdbc:postgresql://host:5432/concourse
DB_USERNAME=...
DB_PASSWORD=...

# Auth (required — see warning below)
AUTH_JWT_SECRET=<32+ random bytes>
AUTH_JWT_TTL_MINUTES=720

# Who gets the operations console. Comma-separated; everyone else is refused the admin
# portal. Empty means nobody has one.
AUTH_ADMIN_EMAILS=you@example.com

# Password-reset codes. expose-code is forced false by the cloud profile regardless.
AUTH_RESET_TTL_MINUTES=30

# Seeds a missing admin account at boot. Never overwrites one that already exists.
AUTH_ADMIN_PASSWORD=<8+ chars, a letter and a number>

# Where reset codes are sent from. Both are required before any mail is sent.
MAIL_USERNAME=you@gmail.com
MAIL_PASSWORD=<16-character Gmail App Password>

# Where the frontend is served from, comma-separated
CORS_ALLOWED_ORIGINS=https://your-frontend.example.com

# Optional: turn on either or both external providers
SUPABASE_JWT_SECRET=...
FIREBASE_PROJECT_ID=...
```

> **`AUTH_JWT_SECRET` must be set in any deployed environment.** The development default is a
> fixed string committed to this repo — anyone holding it can mint a valid admin token for your
> deployment. `JwtService.assertProductionSecret` refuses to start under the cloud profile if it
> is still the default.

Frontend: set `VITE_API_BASE_URL` to the backend URL.

## Notes for a real deployment

Three things suit a demo but not production:

- **Reset mail is unauthenticated in both directions.** Nothing verifies that the address
  belongs to whoever typed it beyond the code itself, and the mail is plain text over STARTTLS.
  Fine for a code that expires in 30 minutes; not a channel for anything else.
- **Nothing rate-limits `/auth/**`.** Passwords and reset codes can both be attempted as fast
  as the network allows. A per-address attempt counter, or a proxy-level limit, is the fix.
- **Tokens do not refresh.** They last 12 hours and then require a fresh login. Adding refresh
  tokens means a second table and a rotation endpoint.

Also worth knowing: simulation sessions still live in memory and die with the process. Only
*accounts* are persisted. Making runs durable is a larger change to `SessionManager`, not a
config switch.

## Migrations

One file serves H2 and Postgres, which is why `V1__create_app_user.sql` uses the SQL subset both
accept — notably a plain unique index on `email` rather than `LOWER(email)`, since H2 has no
functional indexes. Email case is normalised in the application before insert instead.

Hibernate runs with `ddl-auto: validate`: Flyway owns the schema, and a drift between the
entities and the migrations fails at boot rather than at runtime.
