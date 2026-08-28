# Concourse — attendee app

Flutter. Live zone congestion, the way out, and optional GPS.

The web Walker portal does the same job; this exists because a phone can know where it is, and a
browser at a venue generally cannot.

---

## Running it

Needs the Flutter SDK (3.27+) and a running backend. Verified against Flutter 3.44.9 / Dart 3.12.2.

```bash
cd mobile
flutter pub get
flutter test
flutter run --dart-define=CONCOURSE_API=http://<your-machine-ip>:8080
```

**The `--dart-define` is not optional on a real device.** A phone cannot reach the host's
`localhost`; the default `10.0.2.2` only works from the Android emulator. Nothing else needs
configuring — the app talks to the backend and nothing else, and does not need the AI service or
the web frontend running.

Join with a session id (`sess-1a2b3c4d`) from the client portal or the signage.

---

## What it collects, exactly

The consent screen makes four claims. Each is true of the implementation, and if one stops being
true, that screen has to change in the same commit.

| Claim | Why it holds |
|---|---|
| Coordinates are never stored | `PUT /sessions/{id}/walkers/{walkerId}` resolves a fix to a zone and discards the lat/lng. `Session.RealWalker` is a zone id and an expiry; there is no field to put a coordinate in. |
| Only while the app is open | The position stream starts on `AppLifecycleState.resumed` and is cancelled on `paused`. No background permission is requested. An attendee ages out 30 s after the last report. |
| Nobody can see you | Attendees are never added to `people[]` in a frame. Operators see `metrics.realWalkers`, a count. |
| No account | The walker id is a UUID the app generates on first launch and keeps in `shared_preferences`. |

One more, which matters to the demo rather than to the attendee: **real attendees never touch
the before/after numbers.** They raise the density an operator sees, and are excluded from
`peakDensity` and `criticalNodeTicks`, because the baseline twin has no attendees and a
comparison between a run with spectators and one without would prove nothing.

---

## The two modes

```
join ──► GET /venues/{id}/georef
              │
        404 ──┴── 200 + permission granted
         │              │
      MANUAL          GPS
```

**Manual is not a fallback stub.** It is what the web Walker has always done — tap the zone you
are standing in — and it goes to the same endpoint with `{ "nodeId": ... }`. GPS is an accuracy
upgrade to a flow that already works, never a prerequisite for it. The app is fully usable with
location denied, and most venues will never be georeferenced at all.

### When GPS refuses to place you

The server answers with a state, not a guess, and the app renders each one differently:

| state | chip | map |
|---|---|---|
| `IN_ZONE` / `MANUAL` | `LIVE` | dot, with a halo at the **reported** accuracy |
| `TOO_INACCURATE` | `WEAK GPS` | **no dot** — "tap your zone instead" |
| `IN_TRANSIT` | `IN TRANSIT` | **no dot** — you are between zones |
| `OUTSIDE_VENUE` | `NOT AT THIS VENUE` | **no dot** — manual picker offered |

Two rules run through all of it: **never draw a halo smaller than the reported accuracy**, and
**never invent a position when a fix is rejected.** `test/degraded_state_test.dart` holds the
second one down — the server echoes coordinates even for rejected fixes, so a client *could*
draw them, and must not.

Note the accuracy test is **relative, not a metre threshold**: the server compares a fix's
accuracy against the radius of the zone it landed in. A venue whose zones are a couple of metres
across can never be resolved by consumer GNSS, and every fix will correctly come back
`TOO_INACCURATE`. That is a property of the venue, not a bug.

---

## Battery

`LocationAccuracy.high` keeps GNSS powered — order 100–200 mW, roughly 5–10% of a phone battery
per hour.

**`distanceFilter` cuts callbacks, not GNSS duty cycle.** The receiver stays on either way; the
filter saves CPU wakeups and radio sends. Worth having, but it is not why the battery lasts.
Foreground-only is.

Sending is gated by `location_gate.dart`: a 3 s floor, an 8 m movement threshold, and a **20 s
heartbeat**. The heartbeat is not optional — with a distance filter alone, a walker who stops
moving stops emitting, and the server's 30 s TTL ages them out of the venue while they are
standing in it.

---

## Why a CustomPainter and not a map library

`flutter_map` and the Google Maps SDK exist to composite tiles under geographic overlays. There
is no basemap here: the venue is an abstract 0–100 coordinate space derived from a traced floor
plan. Using one would mean **inverting the affine** to hand a library a projection it only wants
because it expects tiles — the one transform direction nothing else in the system needs.

And a real basemap would be actively dishonest. Satellite imagery under a stylised layout
misaligns wherever the anchor fit is imperfect, advertising metre-level precision the system
does not have.

Everything drawn is polygons, polylines and dots.

---

## Layout

```
lib/
  main.dart              app shell, three screens, the walker id
  walker_session.dart    ChangeNotifier: polling, reporting, lifecycle, degradation
  api.dart               five endpoints, one shared http.Client
  location_gate.dart     pure: shouldSend() — the throttle, heartbeat and hard reject
  venue_map.dart         CustomPainter, the congestion ramp, StatusPill, ErrorNote
  map_projection.dart    port of frontend/src/venueAdapter.js
  screens/               consent · join · live
test/
  map_projection_test    the drift guard on nodeRadius, shared with two other languages
  location_gate_test     table-driven, including the stationary-heartbeat case
  manual_fallback_test   permission denied stays usable, and sends no coordinates
  degraded_state_test    a rejected fix paints no dot
```

`map_projection.dart` is the third copy of `nodeRadius`, after `venueAdapter.js` and
`SimulationEngine.nodeRadius` — and only the last one decides where agents actually are.
`map_projection_test.dart` asserts this copy still matches the published values, so drift fails a
test instead of quietly misplacing the crowd.
