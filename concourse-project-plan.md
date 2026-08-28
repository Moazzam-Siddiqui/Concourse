# Concourse — Project Plan

## 1. The Problem

Large venues and events — stadiums, railway stations, festivals — see people bunch up at entry gates, food counters, or exits without warning. There's no easy way to spot these pile-ups before they become dangerous.

**What we're building:** a system that simulates how crowds move through a venue, predicts where and when bottlenecks will form, and suggests real-time rerouting before things get risky.

---

## 2. Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React website, plus a Flutter attendee app in  |
| Frontend animation | 21st.dev-style motion components |
| Frontend visuals | Pixel-art tileset + crowd sprites, generated via the PixelLab MCP server |
| UI/design | Claude Design |
| Backend | Spring Boot |
| ML serving | **Python FastAPI (`ml-service/`) — self-hosted, models loaded in-process** |
| AI layer | Hugging Face (mandatory — every team member needs an individual account and genuine use in the build) |
| ML/model work | Python (training + exporting to HF Hub) |

### Why a separate ML service

Models are loaded once at FastAPI startup and inference runs locally. Nothing calls the
Hugging Face Inference API at request time — HF is where models are trained, versioned and
pulled *from*, not a network dependency during the demo. That removes the two things most
likely to break on stage: a cold inference endpoint and the venue wifi.

---

## 3. Where AI Earns Its Place, and Where It Does Not

Not everything here should be a model. The split below is deliberate — forcing AI into a solved algorithmic problem costs accuracy and speed for nothing, while a threshold check cannot answer the questions that actually matter:

- **Classic algorithms** (not AI, and shouldn't be): the crowd simulation engine and shortest-path rerouting. These are deterministic and fast — trying to force AI into them would waste time for no payoff.
- **Genuine AI, via Hugging Face** (this is where depth lives):
  1. **GNN-based congestion propagation model** — predicts how a bottleneck at one zone will affect neighboring zones over the next few minutes, not just flags a single node crossing a threshold.
  2. **NLP advisory generator** — turns raw density/trend data into a plain-language alert a human can act on instantly.

---

## 4. Depth Additions (going beyond a basic simulation)

1. **Social force model** for crowd movement — people avoid each other, cluster, and slow at turns, instead of being treated as flowing liquid. Physics-based, not ML, but a big step up in realism.
2. **Heterogeneous crowd types** — families move slower and stay clustered, solo attendees move faster.
3. **GNN risk propagation** — congestion at one node influences predicted risk at connected nodes, trained on simulated data.
4. **Before/after comparison** — show bottleneck outcomes with no intervention vs. with our reroute suggestions applied, side by side, as the core proof that the system works.

5. **Pixel-art venue rendering** — a top-down tileset per zone type plus animated crowd sprites, generated with the PixelLab MCP server. Sprite count and tint per zone are driven by live occupancy and `DensityDetector` status, so the art *is* the data rather than decoration over it.

*(Stretch, only if time allows after the above: RL-based reroute policy, multi-scenario stress testing, historical pattern memory across runs.)*

### The visual layer is additive, always

`PixelVenueMap` renders the plain marker map whenever the generated assets are missing, and
nothing in the density / GNN / reroute path reads from the art. The rule: the system has to
be demonstrably correct with plain circles first. If asset generation is unfinished at
judging time, we lose polish and nothing else.

---

## 5. System Architecture

**Client (React):**
- Setup screen — upload venue layout, set crowd size/schedule
- Live venue map — animated density overlay, timeline scrub/play
- Alerts panel — live advisory feed with slide-in animations
- Reroute overlay — animated dashed path showing suggested reroutes
- Summary screen — before/after comparison, auto-generated recap

**Backend (Spring Boot):**
- `SimulationEngine` — tick-based crowd flow using the social force model
- `DensityDetector` — threshold + trend logic, feeds the GNN
- `GnnRiskClient` — calls `ml-service` `POST /predict/risk` for propagation prediction
- `RerouteEngine` — Dijkstra shortest-path to nearest under-capacity node
- `AdvisoryService` — calls `ml-service` `POST /generate/advisory` for plain-language alerts
- `MlServiceConfig` — base URL from `application.yml`, never hardcoded
- WebSocket stream for live map updates

**ML serving (FastAPI, `ml-service/`):**
- Both models loaded once at startup via the app lifespan, not per request
- `POST /predict/risk` — `{nodes:[{id,density,trend}], edges:[{source,target}]}` → per-node risk
- `POST /generate/advisory` — `{node,density,trend,reroutePath}` → one plain-language line
- `GET /health` — reports per-model load status; Spring checks this before relying on it
- GNN architecture imported from `ml/gnn/model.py`, so training and serving cannot drift

**ML training (Hugging Face):**
- Synthetic data generation from simulation runs
- GNN training script + export to HF Hub
- Prompt templates for the advisory generator

### Where the fallbacks live

One fallback path, in one place. `ml-service` never fakes an answer: a model that failed to
load gives a 503. Spring catches that — and a service that is simply not running — and uses
its own deterministic mock. Two fallback layers that could disagree about what the crowd is
doing would be worse than none.

---

## 6. API Surface

### Spring Boot (`localhost:8080`)

| Endpoint | Purpose |
|---|---|
| `POST /venues` | Upload venue layout JSON |
| `GET /venues/{id}` | Fetch layout for rendering |
| `POST /simulations` | Start a simulation run |
| `GET /simulations/{id}/state?t=` | Node densities at time t |
| `WS /simulations/{id}/stream` | Live density push |
| `GET /simulations/{id}/alerts` | Bottleneck alerts feed |
| `GET /simulations/{id}/reroutes/{nodeId}` | Suggested reroute path |
| `GET /simulations/{id}/advisories` | Plain-language advisory feed |
| `GET /simulations/{id}/summary` | Post-run stats + before/after |

### ml-service (`localhost:8000`)

| Endpoint | Purpose |
|---|---|
| `POST /predict/risk` | GNN congestion propagation, per-node risk |
| `POST /generate/advisory` | NLP plain-language advisory |
| `GET /health` | Per-model load status, checked by Spring |

---

## 7. 4-Day Build Plan (Aug 6 → Aug 10)

**Day 1 — Foundation** ✅ *done*
- HF accounts for every team member
- Venue graph data model + JSON schema
- Simulation engine — tick-based flow respecting node capacity and edge throughput
- React scaffold + routing, all three pages rendering on mock data
- Reroute engine (Dijkstra), density detector, WebSocket stream, full REST surface
- `ml-service/` FastAPI skeleton, Spring repointed at it
- `PixelVenueMap` + asset manifest, falling back to plain markers

**Day 2 — Core intelligence**
- Generate synthetic training data (`ml/data/generate_synthetic_runs.py --runs 300`)
- Train the congestion-propagation GNN, produce `ml/out/congestion_gnn.pt`
- Implement `GnnRiskModel.predict` in ml-service (feature matrix + edge index)
- **Generate the pixel-art tileset and crowd sprites via PixelLab MCP**
- Verify `/health` reports `gnn_risk.loaded: true`

**Day 3 — AI integration + UI buildout**
- Implement `AdvisoryModel.generate`, pick and pin the text-gen model
- End-to-end with mocks off: Spring → ml-service → real model output
- Surface predicted risk on the map (the "next 3 minutes" overlay)
- Alerts panel animations, reroute path animation
- Decide the venue layout the demo actually runs on

**Day 4 — Buffer, polish, demo prep**
- Fill the real before/after numbers into `docs/demo-script.md`
- Edge cases: venue with no exit, extreme crowd sizes, malformed layout upload
- UI polish with Claude Design + 21st.dev animations
- Record the fallback screen capture
- Rehearse: challenge → what we built → why it matters → how it works

### Known risks

| Risk | Mitigation |
|---|---|
| GNN never trains well enough to beat the heuristic | Mock is a one-hop diffusion that already looks sensible; swap back and say so honestly |
| Text-gen model too slow on a laptop | Pin a small instruct model; Spring's template fallback is already the safety net |
| Pixel assets unfinished | `PixelVenueMap` falls back to plain markers with zero code changes |
| Nothing runs on the day | Every tier degrades independently — frontend on mocks, Spring on mocks, ml-service optional |

---

## 8. Project Structure

```
concourse/
├── frontend/        # React website (+ src/assets/pixel-art/ tileset and sprites)
├── backend/         # Spring Boot
├── ai-service/      # FastAPI self-hosted model serving (port 8000)
├── mobile/          # Flutter attendee app (optional; needs only the backend)
├── ml/              # training, synthetic data, HF Hub export
├── sample-data/     # test venue layouts and schedules
└── docs/            # system design, API contract, demo script
```

Three services run together locally:

```bash
cd ml-service && uvicorn app.main:app --reload --port 8000
cd backend    && ./mvnw spring-boot:run
cd frontend   && npm run dev
```

Start order does not matter — Spring falls back to mocks whenever `ml-service` is absent,
and the frontend renders on mock data whenever Spring is absent.

---

## 9. Demo Flow (target: under 2 minutes)

1. Setup screen — upload venue, set crowd size
2. Hit "Run" — live map fills up in real time
3. Alert fires — advisory panel shows plain-language warning
4. Tap alert — reroute path animates on the map
5. End on summary screen — before/after comparison proving the system reduced bottlenecks

---

## 10. Open Items (owner: teammate handling backend/HF specifics)

- Final choice of GNN base architecture (currently a placeholder GraphSAGE in `ml/gnn/model.py`)
- Final choice of text-generation model for the advisory layer (default `Qwen/Qwen2.5-0.5B-Instruct`)
- ~~Hosting/inference endpoint setup for both HF models~~ — replaced by self-hosted `ml-service/`;
  HF Hub is now for training artefacts and versioning, not runtime
- Implement `GnnRiskModel.predict` and `AdvisoryModel.generate` (both raise `NotImplementedError`)
- Generate the pixel-art assets via PixelLab MCP — see `frontend/src/assets/pixel-art/README.md`
  for the exact filenames, tile size and sprite sheet layout the manifest expects
