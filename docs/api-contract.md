# API Contract

Base URL: `http://localhost:8080` (override with `VITE_API_BASE_URL`).
All request and response bodies are JSON. Validation failures return **400**; unknown ids
return **404**. Error bodies are `ApiError`:
`{ timestamp, status, error, message, details[] }`.

There are **two simulation surfaces**, and they are not alternatives to each other:

| Surface | Model | Use it for |
|---|---|---|
| **`/sessions`** | Individual agents under a social force model, ~10 ticks/second, live WebSocket | The live map: people moving, heatmap, alerts, reroutes, AI advisories |
| `/venues` + `/simulations` | Aggregate flow, per-node counts, 2 ticks/second | The before/after summary, and anything that only needs numbers |

`/sessions` is the one the architecture describes. `/venues` + `/simulations` predates it,
still works, and is what the current React app calls.

---

# Auth

Reads are public so the marketing pages and the live map work signed-out. **Writes need a
role.** Send the token as `Authorization: Bearer <token>`.

| Request | Result |
|---|---|
| `/auth/**`, `/health`, `/actuator/**` | public |
| **Any `GET`** under `/venues`, `/sessions`, `/simulations`, `/alerts` | public |
| `WS /sessions/{id}/stream`, `WS /simulations/{id}/stream` | public — the upgrade is a `GET` |
| Any **write** to those paths, no token | **401** — *who are you* |
| Any **write** to those paths as `WALKER` | **403** — *known, but not allowed* |
| Any **write** to those paths as `CLIENT` / `ADMIN` | allowed |

So `POST /sessions`, `POST /venues`, `POST /simulations` and the `start`/`pause`/`stop` controls
all need a `CLIENT` or `ADMIN` token; everything the live map reads does not.

The 401/403 split is deliberate: a client uses it to decide between prompting a login and
showing a permission error.

## Endpoints

```
POST /auth/register         { email, password, role? }       -> 201 { token, tokenType, expiresIn, user }
POST /auth/login            { email, password, portal? }     -> 200 { token, tokenType, expiresIn, user }
POST /auth/forgot-password  { email }                        -> 200 { message, code?, expiresInSeconds? }
POST /auth/reset-password   { email, code, password }        -> 200 { token, tokenType, expiresIn, user }
GET  /auth/me               Authorization: Bearer ...        -> 200 { id, email, role, provider }
```

`user` is `{ id, email, role, provider }`. `role` is `WALKER`, `CLIENT` or `ADMIN`; `provider`
is `LOCAL`, `SUPABASE` or `FIREBASE`.

`role` on register accepts `walker` or `client` only — **`admin` is refused with 403**, as is
signing in with `portal: "admin"` without being on the allowlist. `portal` on login is which of
the three doors the form was opened at; walker and client are the same account and signing in at
either moves the account to that role.

**Three providers, one code path.** `JwtAuthFilter` offers each incoming token to every enabled
verifier in turn and takes the first that recognises it, so a locally-minted, Supabase or
Firebase token is accepted by the same endpoints. Only `LOCAL` has register/login here; the other
two authenticate against their own provider and arrive holding a token, and the row is created on
first sight.

## Password reset

`forgot-password` answers **200 for every address**, registered or not, disabled or not. That
uniformity is the endpoint's entire security property: anyone may call it with any address, so a
response that differed would be a free tool for testing which emails are registered.

`code` is present in the response **only when it was not delivered anywhere else** — that is, when
no mail account is configured. Once mail works the field disappears, because the endpoint accepts
any address from anyone and a code in the response is a code handed to whoever typed the address
rather than to whoever owns the inbox. The cloud profile forces it off regardless.

Codes are 8 characters from a 32-letter alphabet with `I`, `O`, `0` and `1` removed, live for 30
minutes, and are retired on first use, on a successful sign-in, and whenever a newer one is
requested. A wrong or spent code is **400**.

Passwords are 8–72 characters with at least one letter and one number, and no leading or trailing
space. Every broken rule is reported at once in `details[]`. Full reasoning in
[`auth-and-database.md`](auth-and-database.md).

---

# Sessions (live agent simulation)

## `POST /sessions`

Uploads a venue layout **and** creates a session in one call. The venue is also stored, so
`GET /venues/{id}` works on it afterwards.

**Request**
```json
{
  "venue": { "id": "venue-sample", "name": "...", "nodes": [...], "edges": [...] },
  "crowdSize": 2500,
  "arrivalRate": 45,
  "maxTicks": 3000,
  "tickSeconds": 2.0,
  "rerouteEnabled": true
}
```

`venue` is the same shape as `POST /venues` below. `crowdSize` 1–10000, `arrivalRate` 1–2000
(people admitted per tick, split across gates). `maxTicks` defaults to 1200, `tickSeconds` to
1.0, `rerouteEnabled` to true.

The `crowdSize` ceiling is measured, not guessed: one tick costs ~13 ms at 2,500 agents,
~58 ms at 10,000 and ~112 ms at 20,000 — past the 100 ms tick budget, where the simulated
clock quietly starts running slower than the wall clock. Raise it only alongside a
re-measurement, and note a baseline twin doubles the real agent count.

**400** if the venue has no `GATE` node, has duplicate node ids, or has an edge referencing a
node that does not exist. A venue with **no `EXIT`** is accepted on purpose — it is a scenario
worth simulating, and the detector will light the whole venue up, which is the right answer.

**201** — `SessionInfo` (see `GET /sessions/{id}`). Status is `CREATED`; nothing ticks yet.

### The baseline twin

When `rerouteEnabled` is true, a second session is created at `{id}-baseline`: same venue,
same crowd, **same seed**, rerouting off. It ticks in lockstep, is never broadcast and never
sent to the AI layer, and is hidden from `GET /sessions`. It exists so
`GET /sessions/{id}/summary` can compare two runs that differ only by the intervention.

Sharing the seed means both runs draw the same crowd — same mix of families and solo
attendees, same walking speeds, same spawn scatter. Arrival *volume* still differs, because
holding intake at a critical gate is precisely the intervention being measured.

`start`, `pause` and `stop` on a session always move its twin too. You can read the twin
directly at `GET /sessions/{id}-baseline` if you want its raw numbers.

---

## `POST /sessions/{id}/start` · `/pause` · `/stop`

**200** — `SessionInfo` with the new status.

- `start` — begins or resumes ticking. **409** if the session is already `STOPPED` or `COMPLETED`.
- `pause` — holds the clock, keeps all state. `start` resumes from the same tick.
- `stop` — terminal. Viewers keep the last frame; the numbers are final.

Status is one of `CREATED`, `RUNNING`, `PAUSED`, `STOPPED`, `COMPLETED`. `COMPLETED` is
reached on its own when `maxTicks` is hit or the whole crowd has left.

A session that reaches `STOPPED` or `COMPLETED` is evicted, with its twin, after
`session.retain-after-finish-ms` (default 10 minutes) and then 404s. Nothing here survives a
restart anyway; the sweep stops a long demo accumulating dead runs in memory.

---

## `GET /sessions/{id}`

**200**
```json
{
  "sessionId": "sess-ab49d7f1", "venueId": "venue-sample", "venueName": "...",
  "status": "RUNNING", "tick": 152, "maxTicks": 3000,
  "crowdSize": 2500, "arrivalRate": 45, "tickSeconds": 2.0, "rerouteEnabled": true,
  "peopleInside": 1504, "spawned": 1507, "exited": 3,
  "viewers": 1, "alertCount": 9,
  "aiStatus": "ok", "latestAdvisory": "Hold intake and stage arrivals away from Gate B..."
}
```

`aiStatus` is deliberately visible: `not-yet-called`, `calling (tick N)`, `ok`, `partial (llm
unavailable)`, `unavailable: ...`, or `disabled (ml-service.mock-enabled)`. When the AI layer
is down the session keeps running on measured density and this says so.

---

## `GET /sessions`

**200** — an array of `SessionInfo`, every live and recently finished session. Baseline twins
are hidden.

---

## `GET /sessions/{id}/state`

**200** — the same frame the WebSocket pushes, for clients that would rather poll. `null`
before the first frame is published.

`?people=false` returns the frame with `people` as `[]`. Agent positions are the bulk of a
frame — up to `session.max-people-in-frame` entries at ~80 bytes each — and an attendee-facing
client is never shown other people anyway, so for the mobile app they are tens of kilobytes of
pure cost per poll. `sampledFrom` still reports the true crowd size.

---

## `GET /sessions/{id}/summary`

Post-run stats and the before/after comparison. Readable while the run is still going — the
numbers are running totals, not final ones.

**200**
```json
{
  "sessionId": "sess-1b1f94d8", "venueId": "venue-sample", "venueName": "...",
  "status": "STOPPED", "ticks": 296, "simulationSeconds": 592.0,
  "comparisonAvailable": true,
  "baseline":  { "peakDensity": 4.48, "criticalNodeTicks": 676, "bottleneckCount": 3,
                 "spawned": 3000, "exited": 510, "stillInside": 2490 },
  "optimised": { "peakDensity": 0.95, "criticalNodeTicks": 489, "bottleneckCount": 5,
                 "spawned": 2485, "exited": 425, "stillInside": 2060 },
  "narrative": "Rerouting cut time above the critical threshold by 28% (676 to 489 zone-ticks), and held the worst zone to 95% of capacity instead of 448%."
}
```

`comparisonAvailable` is false when the session ran with `rerouteEnabled: false` — there is no
twin, so `baseline` and `optimised` are the same numbers and the narrative says so rather than
implying a comparison that never happened.

Read `criticalNodeTicks` as the headline safety number. The other two mislead if quoted alone:

- `peakDensity` is pinned at 1.0 by any single undersized zone, so it barely moves between runs
  that are wildly different everywhere else. It is worth quoting here only because the
  untreated run blows past it — 4.48 means a gate packed to 448% of capacity.
- `bottleneckCount` usually goes **up** when rerouting works, because spreading a crowd out
  touches more zones. Above, 3 → 5 zones is the system working, not failing.
- Exits are deliberately absent from the narrative. The untreated run typically gets *more*
  people through, by packing gates several times over capacity — the exact thing being
  prevented. Quoted side by side without that context it reads as rerouting being worse.

---

## `WS /sessions/{id}/stream`

Organiser and viewers connect to the same path and receive identical frames. The current
frame is pushed on connect, so a late joiner never sees a blank map. Read-only: inbound
messages are ignored and cannot perturb the simulation.

That stays true now attendees can report position. They do it over
`PUT /sessions/{id}/walkers/{walkerId}` precisely so this socket remains a pure fan-out — a
viewer's browser cannot alter what any other viewer sees, and the phone does not have to hold a
socket carrying 600 agent positions it is forbidden to draw.

Handshakes are restricted to the same `cors.allowed-origins` list as the REST API. A
WebSocket handshake is not covered by CORS, so leaving it open while the REST API is pinned
would let any page on the internet stream from a locally running backend.

Frames are pushed every `session.broadcast-every-ticks` ticks (default 2, so ~5/second at the
default 100 ms tick).

```json
{
  "sessionId": "sess-ab49d7f1",
  "venueId": "venue-sample",
  "tick": 152,
  "simulationSeconds": 304.0,
  "status": "RUNNING",

  "people": [{ "id": "sess-ab49d7f1-0", "x": 135.9, "y": 141.2, "nodeId": "gate-a", "type": "SOLO", "rerouted": true }],
  "sampledFrom": 1504,

  "nodes": [{
    "nodeId": "gate-a", "name": "Gate A", "occupancy": 274, "capacity": 320,
    "density": 0.85, "status": "CRITICAL", "trend": "RISING", "predictedRisk": 0.771
  }],

  "alerts": [{ "id": "alert-1a2b", "tick": 148, "nodeId": "gate-a", "severity": "CRITICAL",
               "density": 0.9, "trend": "RISING", "message": "Gate A at 90% capacity and still filling" }],
  "reroutes": [{ "fromNodeId": "gate-a", "toNodeId": "exit-east",
                 "path": ["gate-a", "walk-north", "stand-lower", "concourse", "exit-east"], "cost": 95.0 }],

  "predictedRisk": { "gate-a": 0.771 },
  "advisory": "Hold intake and stage arrivals away from Gate B...",
  "aiStatus": "ok",

  "metrics": {
    "peopleInside": 1504, "spawned": 1507, "exited": 3, "pendingArrivals": 993,
    "peakDensity": 0.91, "criticalNodeTicks": 250, "activeAlerts": 3, "viewers": 1,
    "realWalkers": 12
  }
}
```

Notes a client needs:

- **`people` is a sample.** It is capped at `session.max-people-in-frame` (default 600) by
  taking every *n*th agent, so the shape of the crowd survives. `sampledFrom` is the true
  count — scale your own counters off that and `metrics`, never off `people.length`.
- **`density` can exceed 1.0.** A zone past capacity is the interesting case. `status` uses
  the same thresholds throughout: `WARNING` ≥ 0.70, `CRITICAL` ≥ 0.85.
- `alerts` and `reroutes` are the most recent 20 and 10; the full feeds are on the session.
- `predictedRisk` is empty `{}` until the AI layer answers, and stays at its last good value
  if a later call fails. `predictedRisk` on a node is 0.0 when unknown — check `aiStatus`
  before drawing it as a real prediction.
- **Set your client's max message size.** A busy frame is tens of kilobytes and the usual 8 KB
  default *closes the connection* rather than truncating. The server side is raised via
  `session.socket-buffer-bytes` (default 512 KB).
- **`metrics.realWalkers` is people, `metrics.peopleInside` is agents.** The first counts real
  attendees reporting position from a phone; the second counts simulated ones. A node's
  `occupancy` and `density` include both. `peakDensity` and `criticalNodeTicks` include only the
  simulated ones — see `PUT /sessions/{id}/walkers/{walkerId}` for why.

---

## `PUT /sessions/{id}/walkers/{walkerId}`

Where a real attendee is. Sent by the mobile app; see [`mobile/`](../mobile/).

`walkerId` is chosen by the client — a UUID the app generates once and keeps. There is no
account behind it and nothing to join it to. `PUT` because re-reporting is an update to one
attendee, not a second one, so a retried request is harmless.

**Request** — exactly one of two forms:

```json
{ "lat": 12.9716, "lng": 77.5946, "accuracyMetres": 8.4 }
```
```json
{ "nodeId": "gate-a" }
```

The first needs the venue to be georeferenced (`PUT /venues/{id}/georef`). The second is the
self-declared zone the web Walker has always used, and is what the app falls back to when
permission is denied or the venue has no anchors.

**200**

```json
{
  "walkerId": "w-3f2a9c11", "nodeId": "gate-a", "state": "IN_ZONE",
  "x": 137.2, "y": 88.4, "accuracyVenueUnits": 12.6, "expiresInSeconds": 30
}
```

`state` is one of:

| state | meaning | counted |
|---|---|---|
| `IN_ZONE` | inside a zone's radius, with an accuracy good enough to believe it | yes |
| `MANUAL` | self-declared by tapping a zone | yes |
| `IN_TRANSIT` | between zones — walking a corridor | no |
| `OUTSIDE_VENUE` | beyond the venue's bounding box | no |
| `TOO_INACCURATE` | the uncertainty circle is bigger than the zone it lands in | no |

- **404** unknown session, or a baseline twin — `{id}-baseline` refuses attendees for the same
  reason it is hidden from `GET /sessions`.
- **409** the venue has no georeference and the body was a GPS fix. The message names both fixes.
- **400** a body that is neither form, or a `nodeId` the venue does not have.
- **429** the session already holds `session.max-walkers` attendees (default 2000).

Notes a client needs:

- **Coordinates are not stored.** A fix is resolved to a zone at this boundary and the latitude
  and longitude are discarded. The session holds a zone id and an expiry per attendee, and has
  nowhere to put a coordinate. `x`/`y` come back to the sender so it can draw its own dot, and
  go to nobody else.
- **The three rejections mean different things** and are worth surfacing differently: move,
  wait, or you are not at this venue. A rejected fix also *removes* the attendee — somebody the
  system cannot locate is not counted anywhere.
- **The accuracy gate is relative, not a metre threshold.** A fix whose uncertainty circle is
  larger than the zone it claims does not support the claim, whatever the absolute figure. That
  also means it works unchanged on a venue drawn at any scale. Note the consequence: a venue
  whose zones are a couple of metres across can never be resolved by consumer GNSS, and every
  fix will correctly come back `TOO_INACCURATE`.
- **Attendees never reach the before/after numbers.** They raise `occupancy` and `density`, and
  so drive alerts, reroutes and the AI advisory. They are excluded from `peakDensity` and
  `criticalNodeTicks`, because the baseline twin has no attendees and cannot have — counting
  them would put people on the optimised side of the comparison and nowhere on the other, and
  the summary would report that rerouting had made the venue worse.
- **Attendees are never in `people[]`.** Others see the count in `metrics.realWalkers`, never
  the individual.
- **`expiresInSeconds`** is `session.walker-ttl-ms` (default 30s). Send again before it lapses
  or the attendee leaves the venue. The mobile app heartbeats every 20s even when stationary.
- The endpoint is unauthenticated, like the rest of this API. `max-walkers` and the TTL bound
  what that costs rather than pretending it cannot be abused.

---

## `DELETE /sessions/{id}/walkers/{walkerId}`

**204** — leaves now rather than waiting for the TTL. Unknown walker ids are not an error.

---

# Venues and flow simulations

## `POST /venues`

Uploads a venue layout. `id` is optional — one is generated when omitted.

**Request**
```json
{
  "id": "venue-sample",
  "name": "Northgate Arena — North Wing",
  "nodes": [
    { "id": "gate-a", "name": "Gate A", "type": "GATE", "capacity": 320, "x": 60, "y": 120 }
  ],
  "edges": [
    { "from": "gate-a", "to": "walk-north", "length": 25, "width": 6, "bidirectional": true }
  ]
}
```

`type` is one of `GATE`, `WALKWAY`, `CONCESSION`, `SEATING`, `EXIT`.
`capacity` ≥ 1, `length` and `width` > 0, `nodes` and `edges` non-empty.

**201** — the stored venue, same shape, `id` populated.

---

## `GET /venues/{id}`

**200** — the venue as above. **404** if unknown.

---

## `POST /simulations`

Starts a run. It begins ticking immediately at `simulation.tick-interval-ms`.
With `rerouteEnabled: true` a hidden no-intervention twin starts too, so the summary has a
real before/after.

**Request — constant arrival rate (current frontend-compatible form)**
```json
{ "venueId": "venue-sample", "crowdSize": 4000, "ticks": 60, "arrivalRate": 120, "rerouteEnabled": true }
```

**Request — scheduled arrivals**
```json
{
  "venueId": "venue-sample",
  "crowdSize": 4200,
  "eventSchedule": {
    "eventId": "gp-race-day-1",
    "name": "Race Day — Qualifying",
    "tickSeconds": 10,
    "phases": [
      { "name": "Doors open", "startTick": 0, "endTick": 40, "arrivalRate": 140 },
      { "name": "Pre-race rush", "startTick": 40, "endTick": 70, "arrivalRate": 320 },
      { "name": "Session", "startTick": 70, "endTick": 140, "arrivalRate": 0 }
    ]
  },
  "rerouteEnabled": true
}
```

Provide either `ticks` plus `arrivalRate`, or `eventSchedule`. Schedule phase ranges are
zero-based and end-exclusive; they must be ordered, non-overlapping, and end after they
start. The final phase end tick determines the run duration (maximum 2000 ticks).
`crowdSize` is 1–500000. A scheduled `arrivalRate` may be zero.

**201**
```json
{ "id": "sim-3f9a2b41", "venueId": "venue-sample", "crowdSize": 4000, "totalTicks": 60, "status": "RUNNING" }
```

`status` is `RUNNING` or `COMPLETED`.

---

## `GET /simulations/{id}/state?t=`

Node densities at tick `t`. Omit `t` for the live tick; out-of-range values return the live
snapshot.

**200**
```json
{
  "simulationId": "sim-3f9a2b41",
  "venueId": "venue-sample",
  "tick": 12,
  "totalTicks": 60,
  "status": "RUNNING",
  "nodes": [
    { "nodeId": "gate-a", "occupancy": 290, "capacity": 320, "density": 0.91, "status": "CRITICAL" }
  ]
}
```

`status` per node is `OK`, `WARNING` (≥ 0.70) or `CRITICAL` (≥ 0.85), thresholds from
`application.yml`.

---

## `WS /simulations/{id}/stream`

Pushes exactly the `GET /state` payload above, once per tick. The current frame is sent
immediately on connect, so the map is never blank. No client → server messages.

---

## `GET /simulations/{id}/alerts`

Bottleneck alerts raised so far, newest first. A node only produces a new alert when its
severity *changes* — otherwise the feed would repeat every tick.

**200**
```json
[
  {
    "id": "alert-8c1d2e7a",
    "tick": 12,
    "nodeId": "gate-a",
    "severity": "CRITICAL",
    "density": 0.91,
    "trend": "RISING",
    "message": "Gate A at 91% capacity and still filling"
  }
]
```

`severity`: `WARNING` | `CRITICAL`. `trend`: `RISING` | `FLAT` | `FALLING`, measured across
the last `simulation.trend-window` ticks.

---

## `GET /simulations/{id}/reroutes/{nodeId}`

Dijkstra from `nodeId` to the nearest node still under the warning threshold.

**200**
```json
{ "fromNodeId": "gate-a", "toNodeId": "walk-south", "path": ["gate-a", "walk-north", "walk-south"], "cost": 55.0 }
```

When nowhere has headroom: `toNodeId` is `null`, `path` is `[]`, `cost` is infinity.

---

## `GET /simulations/{id}/advisories`

Plain-language guidance generated per alert, newest first. Comes from the Hugging Face
text-generation endpoint, or a template when `hf.mock-enabled` is set.

**200**
```json
[
  { "tick": 12, "nodeId": "gate-a", "text": "Act now: Gate A is at 91% capacity and still filling. Divert to South Walkway." }
]
```

---

## `GET /simulations/{id}/summary`

**200**
```json
{
  "simulationId": "sim-3f9a2b41",
  "ticks": 50,
  "peakDensity": 0.85,
  "bottleneckCount": 0,
  "baseline":  { "peakDensity": 1.0,  "bottleneckCount": 2, "criticalNodeTicks": 51, "avgClearTicks": 50 },
  "optimised": { "peakDensity": 0.85, "bottleneckCount": 0, "criticalNodeTicks": 0,  "avgClearTicks": 50 },
  "narrative": "Rerouting cut time spent above the critical threshold by 100% (51 → 0 zone-ticks), peaking at 85% instead of 100%."
}
```

| Metric | Meaning |
|---|---|
| `peakDensity` | Highest density any zone reached |
| `bottleneckCount` | Distinct zones that went critical at any point |
| `criticalNodeTicks` | **Headline number** — total zone-ticks spent above critical |
| `avgClearTicks` | Tick at which the venue emptied, or the run length if it never did |

Read `criticalNodeTicks` first. Peak density is pinned to 100% by any single undersized
kiosk, and zone count *rises* when a crowd is successfully spread out — neither one measures
how long people spent in a crush.

When the run had `rerouteEnabled: false`, `baseline` and `optimised` are identical — there
is no twin to compare against.

---

## `PUT /venues/{id}/georef`

Ties a venue's layout coordinates to real-world latitude and longitude, so a GPS fix can be
resolved to a zone. Without it a venue simply has no GPS and attendees self-declare, which is
the ordinary case.

**Request** — exactly three anchors. For each: the zone you are standing in, and the coordinates
your phone reports there.

```json
{
  "anchors": [
    { "nodeId": "gate-a",    "lat": 12.97160, "lng": 77.59460 },
    { "nodeId": "gate-b",    "lat": 12.97124, "lng": 77.59460 },
    { "nodeId": "exit-east", "lat": 12.97160, "lng": 77.59535 }
  ]
}
```

**Three, not two.** Two anchors fit a rotation and its mirror image equally well and cannot
distinguish them — and since venue `y` runs *downward* while north runs up, the correct answer
is usually the reflected one. A two-anchor fit therefore produces a mirrored venue that matches
both anchors perfectly and sends attendees to the gate diagonally opposite. The third anchor
resolves handedness from the data.

**200**

```json
{
  "venueId": "venue-sample", "originLat": 12.97148, "originLng": 77.59485,
  "a": 10.81, "b": 0.0, "c": 0.0, "d": 0.0, "e": -10.81, "f": 0.0,
  "anchors": [ ... ], "shearDegrees": 0.4, "scaleRatio": 10.81, "setAtMillis": 1786000000000
}
```

`x = a·east + b·north + c` and `y = d·east + e·north + f`, with east/north in metres from the
origin. `shearDegrees` and `scaleRatio` are reported rather than enforced — a stylised layout
genuinely has some shear, and the organiser is better placed than the server to judge how much
is too much.

**400**, each naming the measurement that failed:

- anchors nearer than 20 m — two readings inside each other's error circle carry one reading's
  worth of information
- a triangle altitude under 15 m — a 10 m GPS error perpendicular to a long side rotates the fit
  by roughly `10/h` radians, which at h = 15 m is already about 38°
- three anchored zones collinear *on the map*, which collapses the venue onto a line
- a fitted scale disagreeing with the venue's own by more than 3×. Edge `length` is documented in
  metres while node `x`/`y` are not, so their ratio is an independent estimate of layout units
  per metre. Disagreement almost always means an anchor was recorded in a different zone from
  the one named.

**404** unknown venue, or an anchor naming a node the venue does not have.

**Anchor on gates and exits.** The venue-side point is the node's *centre*, so the accuracy of
the whole feature is bounded by how close to a zone's centre you stood. Zone radius is derived
from capacity, so a gate is a few metres across and a 900-seat stand is tens.

---

## `GET /venues/{id}/georef`

**200** the georeference · **404** the venue has no anchors set. A client should treat the 404
as "this venue has no GPS" and fall back to self-declared zones, not as an error.

---

## `DELETE /venues/{id}/georef`

**204**. Unsetting is not an error even if none was set.

