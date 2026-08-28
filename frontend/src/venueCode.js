/**
 * Venue codes — the short, human-readable id a client puts on their signage and an
 * attendee types to check in.
 *
 * The backend has no "join by code" endpoint, and does not need one. A venue's `id` is
 * already client-supplied on `POST /venues` and is carried on every `SessionInfo` as
 * `venueId`, so a code *is* a venue id — this module only constrains its shape and
 * resolves it back to whichever session is currently running on it.
 *
 * Why not have attendees type the session id, as before: a session id is generated per
 * run (`sess-1a2b3c4d`). It changes every time the operator restarts, so it cannot be
 * printed on a sign, and it is not something anyone can read off a board and retype.
 * A venue code is stable for the life of the venue, which is what signage needs.
 */

/**
 * Codes are uppercase A–Z, 0–9 and dashes, 3–24 chars.
 *
 * Deliberately narrow: this is read off a sign and typed on a phone, so anything
 * case-sensitive or punctuated turns into a support problem. `normaliseCode` upcases
 * and strips the rest rather than rejecting it, because "wembley 01" is unambiguous
 * about what was meant.
 */
export const CODE_PATTERN = /^[A-Z0-9][A-Z0-9-]{1,22}[A-Z0-9]$/;

/** What a user typed -> the canonical form. Spaces and underscores become dashes. */
export function normaliseCode(input) {
  return String(input ?? '')
    .toUpperCase()
    .replace(/[\s_]+/g, '-')
    .replace(/[^A-Z0-9-]/g, '')
    .replace(/-{2,}/g, '-')
    .replace(/^-|-$/g, '');
}

/**
 * Validates a code, returning the reason it is unusable rather than a bare boolean —
 * the setup form prints this straight back at the operator.
 */
export function codeError(code) {
  const value = normaliseCode(code);
  if (!value) return 'Enter a venue code.';
  if (value.length < 3) return 'A venue code needs at least 3 characters.';
  if (value.length > 24) return 'A venue code can be at most 24 characters.';
  if (!CODE_PATTERN.test(value)) return 'Use letters, numbers and dashes only.';
  return null;
}

/**
 * A suggested code from a venue's name: "Northgate Arena — North Wing" -> "NORTHGATE-ARENA".
 *
 * Two words, not the whole name, because the point is something short enough to print
 * large and read from a distance.
 */
export function suggestCode(name) {
  const words = String(name ?? '')
    .toUpperCase()
    .replace(/[^A-Z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);
  return normaliseCode(words.join('-')) || 'VENUE-01';
}

/**
 * Finds the session an attendee should be attached to for a given venue code.
 *
 * Prefers a RUNNING session, then a PAUSED one, then the most recent of anything else.
 * A venue can legitimately have several sessions in its history — an operator who
 * stopped a run and started another leaves both behind — and an attendee standing in
 * the building means the live one, never yesterday's.
 *
 * @param sessions the array from `GET /sessions`
 * @param code     what the attendee typed, in any casing
 * @returns the matching SessionInfo, or null
 */
export function resolveSessionForCode(sessions, code) {
  const wanted = normaliseCode(code);
  if (!wanted) return null;

  // Match on the venue id, and also on the session id, so a code printed before this
  // existed — or an operator reading an id out of the admin console — still works.
  const matches = (sessions ?? []).filter(
    (s) => normaliseCode(s.venueId) === wanted || normaliseCode(s.sessionId) === wanted,
  );
  if (!matches.length) return null;

  const rank = { RUNNING: 0, PAUSED: 1, CREATED: 2, COMPLETED: 3, STOPPED: 4 };
  return [...matches].sort(
    (a, b) => (rank[a.status] ?? 9) - (rank[b.status] ?? 9),
  )[0];
}
