/**
 * Every call this frontend makes to the Spring Boot backend.
 *
 * One module so the base URL, the error shape and the JSON handling are decided once. Nothing
 * else in the app calls `fetch` directly.
 *
 * The backend exposes two families and they are not interchangeable:
 *
 * - `/sessions` — agent simulation with individual people, a WebSocket stream and a baseline
 *   twin. This is what the live map and every portal use.
 * - `/simulations` — the older tick-by-tick flow model, kept for the summary comparison.
 *
 * See docs/api-contract.md.
 */

// VITE_API_BASE_URL still wins where it is set, but the fallback now depends on how the
// bundle was built rather than always being localhost.
//
// A production build that quietly defaults to localhost is the worst kind of wrong: it
// builds, deploys and loads, and then asks each visitor's own machine for the API — which
// fails identically to the backend being down. It shipped exactly that way once, because
// the host's build-time variables were never set and nothing in the build objected.
//
// Dev keeps localhost, so nothing changes when running against a local backend.
const BASE = import.meta.env.VITE_API_BASE_URL
  ?? (import.meta.env.PROD ? 'https://concourse-backend.onrender.com' : 'http://localhost:8080');

/** Thrown for any non-2xx. Carries the status so callers can tell 404 from 500. */
export class ApiError extends Error {
  constructor(status, message, body) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * Where the bearer token lives.
 *
 * localStorage rather than memory so a refresh does not sign you out, and rather than a
 * cookie because the API is stateless and CSRF-free precisely by *not* using cookies — a
 * token the browser attaches automatically is the thing CSRF attacks rely on.
 */
const TOKEN_KEY = 'cf.auth.token';

export const auth = {
  get token() {
    try { return localStorage.getItem(TOKEN_KEY); } catch { return null; }
  },
  set(token) {
    try { token ? localStorage.setItem(TOKEN_KEY, token) : localStorage.removeItem(TOKEN_KEY); } catch { /* private mode */ }
  },
  clear() { this.set(null); },
};

async function request(path, options = {}) {
  let response;
  const token = auth.token;
  try {
    response = await fetch(`${BASE}${path}`, {
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
        ...(options.headers ?? {}),
      },
      ...options,
    });
  } catch (cause) {
    // fetch only rejects for transport failures, which in practice means the backend is not
    // running. Say that, rather than surfacing a bare "Failed to fetch".
    throw new ApiError(0, `Cannot reach the backend at ${BASE}. Is it running?`, cause);
  }

  if (!response.ok) {
    // A rejected token is worse than none: it will fail every subsequent call the same way,
    // so clear it and let the app fall back to signed-out rather than looping on 401s.
    if (response.status === 401) auth.clear();

    // Spring's error bodies carry a `message`; fall back to the status line when they do not.
    const body = await response.json().catch(() => null);
    throw new ApiError(
      response.status,
      body?.message ?? body?.detail ?? `${options.method ?? 'GET'} ${path} → ${response.status}`,
      body,
    );
  }

  return response.status === 204 ? null : response.json();
}

const post = (path, body) =>
  request(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) });

const patch = (path, body) =>
  request(path, { method: 'PATCH', body: JSON.stringify(body) });

export const api = {
  baseUrl: BASE,

  // --- auth ----------------------------------------------------------------
  // register/login return { token, user }; the token is stored here so callers never have to
  // remember to do it, and every later request picks it up automatically.
  auth: {
    /** `role` is honoured for walker and client; asking for admin is refused with a 403. */
    async register({ email, password, role }) {
      const res = await post('/auth/register', { email, password, role });
      auth.set(res.token);
      return res;
    },
    /**
     * `portal` is which of the three doors was used.
     *
     * Walker and client are interchangeable — signing in at either moves the account there —
     * so one set of credentials opens both. The admin door is not: an account that is not
     * already an admin is refused with a 403 rather than being quietly let in as a client,
     * because silently landing somewhere other than where you clicked is worse than a refusal.
     */
    async login({ email, password, portal }) {
      const res = await post('/auth/login', { email, password, portal });
      auth.set(res.token);
      return res;
    },

    /**
     * Ask for a reset code. Always resolves, even for an address with no account — the
     * backend answers identically either way so this endpoint cannot be used to find out
     * which emails are registered.
     *
     * Resolves to `{ message, code, expiresInSeconds }`. `code` is present only when the
     * backend has `auth.reset.expose-code` on, which is the local default because there is no
     * mail server to send it through; in a deployment it is null and the code arrives by mail.
     */
    forgotPassword: ({ email }) => post('/auth/forgot-password', { email }),

    /** Redeem the code for a new password. Signs in on success, like register/login do. */
    async resetPassword({ email, code, password }) {
      const res = await post('/auth/reset-password', { email, code, password });
      auth.set(res.token);
      return res;
    },
    /** Resolves the stored token to an account, or null when there is not a usable one. */
    async me() {
      if (!auth.token) return null;
      try {
        return await request('/auth/me');
      } catch {
        return null;   // request() has already cleared a 401 token
      }
    },
    /**
     * Edit your own profile. Returns the saved account, so the caller can replace its copy
     * with what the server actually stored rather than with what it hoped it sent.
     *
     * PATCH, not PUT: only the keys present are written, so saving a name does not require
     * sending the avatar back alongside it. Pass an empty string to clear a field — omitting
     * it leaves the stored value alone, which is the only way to distinguish "unchanged" from
     * "remove this".
     */
    updateProfile: ({ displayName, bio, avatar }) => patch('/auth/profile', {
      ...(displayName === undefined ? {} : { displayName }),
      ...(bio === undefined ? {} : { bio }),
      ...(avatar === undefined ? {} : { avatar }),
    }),

    signOut() { auth.clear(); },
    isSignedIn: () => Boolean(auth.token),
  },

  // --- sessions: the live agent simulation --------------------------------
  /** venue JSON + crowd settings -> SessionInfo. The venue travels inline. */
  createSession: (body) => post('/sessions', body),
  listSessions: () => request('/sessions'),
  getSession: (id) => request(`/sessions/${id}`),
  startSession: (id) => post(`/sessions/${id}/start`),
  pauseSession: (id) => post(`/sessions/${id}/pause`),
  stopSession: (id) => post(`/sessions/${id}/stop`),
  /** The same frame the WebSocket pushes — for a first paint before the socket opens. */
  getSessionState: (id) => request(`/sessions/${id}/state`),

  /**
   * Tells the venue which zone an attendee is standing in.
   *
   * The same endpoint the mobile app uses. The browser sends the self-declared form
   * (`{ nodeId }`) because a laptop has no useful GPS — but it is the same walker, counted the
   * same way, so an operator sees web attendees and phone attendees in one number.
   *
   * `walkerId` is opaque and generated on this device; there is no account behind it.
   */
  placeWalker: (sessionId, walkerId, fix) =>
    request(`/sessions/${sessionId}/walkers/${encodeURIComponent(walkerId)}`,
      { method: 'PUT', body: JSON.stringify(fix) }),
  removeWalker: (sessionId, walkerId) =>
    request(`/sessions/${sessionId}/walkers/${encodeURIComponent(walkerId)}`, { method: 'DELETE' }),
  /** Post-run stats including the baseline twin comparison. */
  getSessionSummary: (id) => request(`/sessions/${id}/summary`),

  // --- venues -------------------------------------------------------------
  createVenue: (venue) => post('/venues', venue),
  getVenue: (id) => request(`/venues/${id}`),
  /**
   * Every venue the backend has stored, across restarts.
   *
   * How a venue code resolves when nothing is running on it. Sessions are transient;
   * a code printed on a wall is not, so the walker portal looks here before giving up.
   */
  listVenues: () => request('/venues'),
  /** Walking path from a zone to the nearest exit, over the venue's own edges. */
  getVenueRoute: (id, fromNodeId) =>
    request(`/venues/${id}/route?from=${encodeURIComponent(fromNodeId)}`),

  /**
   * Ties a venue's layout to real coordinates, so the mobile app can turn a GPS fix into a zone.
   *
   * Three anchors, because two cannot distinguish a rotation from its mirror image — and since
   * venue y runs downward while north runs up, the mirrored fit is the one a two-point solve
   * tends to pick. See docs/api-contract.md.
   */
  setGeoref: (id, anchors) =>
    request(`/venues/${id}/georef`, { method: 'PUT', body: JSON.stringify({ anchors }) }),
  /** 404 here means "this venue has no GPS", which is the ordinary case rather than an error. */
  getGeoref: (id) => request(`/venues/${id}/georef`),
  clearGeoref: (id) => request(`/venues/${id}/georef`, { method: 'DELETE' }),

  health: () => request('/health'),
};

export default api;
