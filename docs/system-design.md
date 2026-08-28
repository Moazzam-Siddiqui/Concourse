# System Design

## The problem in one line

Crowds bunch up at gates, food counters and exits without warning. We simulate the venue,
spot the pile-up before it forms, and say where to send people instead.

## Three tiers, and a fourth client

```
┌──────────────────────────────────────────────────────────────────┐
│  React (Vite) · port 5173                                        │
│  ConcourseApp.jsx — landing, access, and three role portals      │
│  LayoutStudio.jsx — floor plan → walkable graph                  │
│  api.js  REST + bearer token   ·  useLiveSession.js  WebSocket   │
│  crowdRouting.js — the attendee route, planned around the crowd  │
└───────────────┬───────────────────────────────┬──────────────────┘
                │ HTTP                          │ WebSocket
┌───────────────┴──────────────────┐            │
│  Flutter · mobile/               │            │  attendees only: polls
│  consent → join → live           │            │  state, PUTs its zone.
│  optional GPS, else tap a zone   │            │  Never holds the socket.
└───────────────┬──────────────────┘            │
                │ HTTP                          │
┌───────────────▼───────────────────────────────▼──────────────────┐
│  Spring Boot · port 8080                                         │
│  JwtAuthFilter → LOCAL / Supabase / Firebase token verifiers     │
│  Controllers → SessionManager   (one live run per session)       │
│              → SimulationEngine (tick loop, social force model)  │
│              → DensityDetector  (threshold + trend)              │
│              → RerouteEngine    (Dijkstra)                       │
│              → GnnRiskClient / AdvisoryService ──── HTTP ──────┐ │
│                                                                │ │
│  Accounts  → JPA + Flyway → H2 file (local) / Postgres (cloud) │ │
│  Sessions  → in memory (ConcurrentHashMap), die with the process│ │
└────────────────────────────────────────────────────────────────┼─┘
                                                                 │
┌────────────────────────────────────────────────────────────────▼─┐
│  FastAPI · port 8000                                             │
│  /analyze    per-zone risk + operator advisory                   │
│  /layout/*   floor-plan tracing (OpenCV, optional Qwen2.5-VL)    │
│  scoring.py  offline fallback — always available, no download    │
└────────────────────────────┬─────────────────────────────────────┘
                             │ model registry, at startup only
┌────────────────────────────▼─────────────────────────────────────┐
│  Hugging Face                                                    │
│  abhi1005/congestion-gnn      — where congestion spreads next    │
│  Qwen/Qwen2.5-0.5B-Instruct   — density numbers → a sentence     │
└──────────────────────────────────────────────────────────────────┘
```

Each tier degrades instead of failing. The frontend renders signed-out, the backend keeps
ticking and broadcasting measured density with the AI service down, and the AI service answers
from `scoring.py` with no model downloaded and no token set.

## What is a classic algorithm, and what is AI

Deliberate split — forcing ML into the deterministic parts would cost time and buy nothing:

| Piece | Approach | Why |
|---|---|---|
| Crowd movement per tick | Social force model over a capacitated graph | Deterministic, fast, debuggable |
| Reroute suggestion | Dijkstra | Provably shortest, nothing to train |
| Where congestion spreads next | **GNN** (`congestion-gnn`) | Needs the graph structure — a per-node threshold cannot see a neighbour pushing crowd into you |
| Turning numbers into an instruction | **Small instruct model** (Qwen2.5-0.5B) | Operators read sentences, not density vectors |
| Floor plan → walkable graph | OpenCV skeletonisation, optional VLM pass | Geometry, not perception; the VLM only labels what the CV pass already found |

## Data flow, one tick

1. The scheduler in `SimulationSocketHandler` fires every `simulation.tick-interval-ms`.
2. `SimulationEngine.advanceTick` — exits drain, everyone else advances toward the nearest exit
   as far as downstream capacity and edge throughput allow, then arrivals enter at the gates.
   People who cannot move stay put; that is what makes density climb.
3. `GnnRiskClient.predictRisk` — current densities + graph → risk a few ticks ahead.
4. `DensityDetector.detect` — nodes over threshold, tagged RISING / FLAT / FALLING from the last
   `simulation.trend-window` ticks.
5. For each *newly* alerting node: `RerouteEngine.findReroute` then `AdvisoryService.generate`.
   Alerts are only recorded when a node's severity changes, otherwise the feed floods.
6. The new state is pushed to every WebSocket watching that run.

**The call to the AI service is always off the tick thread.** A session must never stall waiting
on a model, so a slow or dead `/analyze` costs a stale risk number, not a frozen simulation.

## Agent movement

`SocialForceModel` is the Helbing–Molnár model: a driving term pulling each agent toward its next
waypoint, an exponential repulsion between agents, and the same exponential against walls. Agents
slow and swerve rather than overlap, which is what "handling collisions" actually means here.

Everything works in **venue layout units, one integration step per tick** — not metres and
seconds. The constants are therefore calibration knobs rather than physical ones, since the
published Helbing values assume SI units. They bind from `social-force.*` in `application.yml`, so
a crowd can be re-tuned against a layout without a rebuild.

The older flow-based path in `advanceTick` still uses `congestionSlowdown`; the per-agent path
does not.

## Before/after comparison

Starting a run with `rerouteEnabled: true` also starts a hidden twin with rerouting off, on the
same venue and crowd and the same seed, ticked in lockstep. `GET /summary` compares the two. The
difference is real simulation output, not an estimate — that pairing is the demo's proof.

Two levers, both matching what the advisories actually tell staff to do:

1. **Spill sideways.** People may move *laterally* (to a node the same hop-distance from the exit)
   when the direct route is full, instead of queueing. Never backwards — sending people back
   toward the gate is not a reroute, it is a crush.
2. **Hold intake.** A gate stops accepting arrivals just below the critical threshold, so people
   wait outside rather than pack into the gate.

On the sample venue that is 51 → 0 zone-ticks above critical, peaking at 85% instead of 100%.

### Real attendees are excluded from it, deliberately

Attendees on the mobile app raise the density an operator sees. They are kept out of
`peakDensity` and `criticalNodeTicks`, which are the two numbers `GET /summary` compares.

The twin has no real attendees and cannot have any — it is a second simulation of the same
seed, not a second venue people can walk into. So counting a phone standing in a gate would
add it to the optimised side and nowhere else, and the narrative would report that rerouting
had made the venue worse. The split is one line in `SessionManager.advance`:
`Session.occupancy()` defines the comparison, `Session.liveOccupancy()` defines the display.

`WalkerIngestTest.realAttendeesRaiseLiveDensityButNeverTheBaselineNumbers` is the executable
form of that sentence.

### Reading the numbers

`criticalNodeTicks` — total zone-ticks spent above critical — is the headline. The other two
mislead on their own: peak density gets pinned at 100% by any single undersized kiosk regardless
of routing, and `bottleneckCount` *rises* when a crowd is successfully spread out, because more
zones briefly touch the threshold. Time-in-the-red is what routing actually moves.

The summary deliberately does not compare throughput. The untreated run usually gets more people
through, because it never holds intake — it achieves that by packing gates several times over
capacity, which is precisely the thing being prevented.

### Why flow is limited at the destination

Congestion slows people *entering* a crowded space; it does not paralyse the one they are leaving.
A packed gate still empties at the corridor's rate. Modelling it the other way round (scaling
emission by the source's own density) makes jams self-locking — they never clear, and no routing
change can help, which is exactly the dead end this model avoids.

## Venue model

A directed graph. Nodes are zones (`GATE`, `WALKWAY`, `CONCESSION`, `SEATING`, `EXIT`) with a
capacity and map coordinates; edges are walkable connections with length (the Dijkstra weight) and
width (the per-tick throughput cap). See `sample-data/venue-layout-sample.json`.

A venue's `id` doubles as its **venue code** (`WEMBLEY-01`) — client-supplied on `POST /venues`,
carried on every `SessionInfo` as `venueId`, and what an attendee types to find the running
session. Codes are stable for the life of the venue, which is what makes them printable; a session
id is regenerated per run and cannot go on a sign.

## Accounts and access

`JwtAuthFilter` offers each incoming token to every enabled verifier in turn and takes the first
that recognises it, so locally-minted, Supabase and Firebase tokens are accepted by the same
endpoints, and a provider with no config reports itself disabled and is skipped entirely.

Reads are public so the marketing pages and live map work signed-out; writes need a role.
`POST /sessions` answers `401` with no token and `403` for a `WALKER` — the split is deliberate,
so a client can tell "log in" apart from "you are not allowed".

Accounts persist; **simulation runs do not**. Only `app_user` has a table. Making runs durable is
a change to `SessionManager`, not a config switch. Full detail in
[`auth-and-database.md`](auth-and-database.md).

## Failure modes we handle

- **AI service down, or not started yet** — every caller has a deterministic fallback, forced by
  `ml-service.mock-enabled`. The session keeps ticking and keeps broadcasting measured density.
  Degraded, not broken.
- **Model missing, or its library not installed** — the choice is made *per step*, so a working
  GNN with no advisory model gives real risk scores with templated prose. `GET /health` names
  whichever path answered.
- **Advisory model inventing a zone** — a sentence naming a zone that was not in the prompt is
  rejected and the template used instead. Fluent and wrong is worse than plain and right when a
  marshal is about to act on it.
- **Venue with no exit** — unreachable nodes get infinite hop distance; people accumulate and the
  detector flags it rather than the engine crashing.
- **Nowhere to reroute to** — `ReroutePath.none`, and the advisory says to hold intake.
- **Layout pipeline dependencies absent** — `GET /health` reports `layout.available: false`, so the
  UI can say AI tracing is unavailable rather than letting an operator upload a plan and get a 404.
- **No mail account configured** — reset codes fall back to the log and the HTTP response, which is
  what makes the flow demonstrable on a fresh checkout.

## Known limits

- **Sessions are in memory** and die with the process. Accounts are the only persisted state.
- **Nothing rate-limits `/auth/`.** Passwords and reset codes can both be attempted as fast as the
  network allows. A per-address attempt counter, or a proxy-level limit, is the fix.
- **Tokens do not refresh** — 12 hours, then a fresh login.
- **Attendee position is zone-level and self-declared.** The system simulates a crowd; it does not
  track anyone's phone, and the UI says so instead of drawing a false accuracy circle.
