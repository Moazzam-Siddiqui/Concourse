# AI Service

The Python half of the Concourse. Predicts per-zone congestion risk and writes the
operator advisory that goes with it.

Called only by the Spring Boot backend — never by the browser.

```bash
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt   # macOS/Linux: .venv/bin/python
.venv/Scripts/python -m uvicorn app.main:app --reload --port 8000
```

No API token, no model download, no configuration. Swagger UI at
<http://127.0.0.1:8000/docs>.

---

## Endpoints

| Endpoint | Used by | Returns |
|---|---|---|
| `POST /analyze` | Spring's `FastApiClient`, on the `/sessions` path | `{predictions, advisory, status, errors, modelInfo}` |
| `POST /predict/risk` | Spring's `GnnRiskClient`, on the older `/simulations` path | `{risk: {nodeId: 0..1}, model}` |
| `POST /generate/advisory` | Spring's `AdvisoryService`, same path | `{message, model}` |
| `GET /health` | Spring's health check | which inference path is live |

`/analyze` is the main one. It receives the venue graph, current density per zone, a window of
recent history and the run context, and returns risk plus prose in a single round trip.

Request and response shapes mirror the Java records in
`backend/src/main/java/com/concourse/dto/AnalyzeRequest.java` and `AnalyzeResponse.java`.

---

## Inference paths

Tried best-first, and the choice is made **per step** — a working GNN endpoint with a missing
LLM one gives hosted risk with locally written prose. Whichever answered is named in
`modelInfo` on every response, so nobody has to guess.

1. **Hugging Face Inference API** — when `HF_API_TOKEN` and the matching `HF_*_URL` are set.
2. **TinyBERT** ([`app/tinybert_local.py`](app/tinybert_local.py)) — risk only, and only when
   `CONCOURSE_TINYBERT=true`. See below.
3. **In-process models** — pulled from the Hub once at startup, run locally thereafter. This is
   the path the project plan calls for: Hugging Face as the model registry, not a per-request
   network dependency.
   - risk: [`app/gnn_local.py`](app/gnn_local.py) → `abhi1005/congestion-gnn` (needs torch +
     torch-geometric)
   - advisory: [`app/advisory_local.py`](app/advisory_local.py) → `Qwen/Qwen2.5-0.5B-Instruct`
     (needs transformers)

   Neither library is in `requirements.txt` on purpose; without them the service says so at
   `/health` and uses the fallback.
4. **Offline fallback** ([`app/scoring.py`](app/scoring.py)) — always available, no setup.

### The beta setup: TinyBERT only

`ai-service/.env` currently pins the beta configuration — one model, nothing else:

```ini
CONCOURSE_TINYBERT=true       # huawei-noah/TinyBERT_General_4L_312D, ~55 MB, CPU
CONCOURSE_ADVISORY_LOCAL=false  # advisory comes from the templates
# CONCOURSE_GNN_REPO=abhi1005/congestion-gnn   # the trained GNN, parked
```

TinyBERT is ported from the `Python Backend/` service that was deleted when the repo was
flattened (commits `5fe7d5a` → `a3f8b10`). It brings that service's model back without bringing
back a second FastAPI process: `/analyze` already carries the graph and the density, Spring
already calls it, the frontend already renders the result. Only the scorer changed.

It renders each zone's six features as a sentence, mean-pools TinyBERT's last hidden state into
a 312-dim vector, and blends the vector's norm (30%) with the weighted raw features (70%) — the
original's design, with two changes:

- The raw half uses this service's tuned `scoring.WEIGHTS` over `FEATURE_COLUMNS`, not the
  original's eight separate fields, so every risk path here scores the same inputs the same way.
- The embedding norm is divided by a fixed scale (`CONCOURSE_TINYBERT_SCALE`), not by the batch
  maximum. Dividing by the batch max made a zone's risk depend on which *other* zones were in
  the request — a one-node graph always maxed that term, and adding a calm zone moved every
  other zone's number. `tests/test_tinybert.py` pins that down.

**It is 30% of the score, and it is the weaker 30%.** The norm of a sentence embedding is not a
congestion signal; the ordering in the output comes from the feature half. Worth knowing before
anyone points at it as the reason a prediction was good.

When it is on it takes priority over the trained GNN, on the grounds that setting the flag is
an explicit request for it. Unset — the default — it never loads and nothing downloads.

### The advisory model is guarded

`Qwen2.5-0.5B-Instruct` is fluent but small. Within minutes of being wired up it invented a
destination gate that did not exist, raised an alarm about a venue with nothing wrong with it,
and advised routing a crowd from one congested zone straight into another. All three read
perfectly well.

So `_check_zones` discards any sentence naming a zone that was not in the prompt, `/analyze`
does not call the model when nothing is above the warning line, and generation is deterministic
(`do_sample=False`) so the same crowd state always yields the same advice. Anything rejected
falls back to the templates — **fluent and wrong is worse than plain and right** for guidance
someone is about to act on.

### The feature contract

All three paths feed the model the same six columns, in this order:

```
density, trend, capacity_norm, degree_norm, neighbour_max_density, density_delta
```

That order is defined by `FEATURE_COLUMNS` in
[`app/services/preprocessing.py`](app/services/preprocessing.py) and duplicated in
`ml/gnn/model.py` and `ml/data/generate_synthetic_runs.py`. Nothing at runtime checks the
copies agree, and a mismatch does not raise — it silently reads the wrong number in every
slot. [`tests/test_feature_contract.py`](tests/test_feature_contract.py) is what catches it.

This is not hypothetical: the GNN was previously trained on four different columns, two of
which (`arrival_rate`, `reroute`) the serving path cannot even produce per node, so the trained
model could never have been deployed at all.

### The offline model

Deliberately not a neural network, and it does not claim to be — it reports itself as
`local-linear`, never as a GNN. It is a one-hop linear propagation model over the same feature
columns the GNN trains on:

```
risk = 0.62·density + 0.28·neighbour_max_density + 0.35·density_delta
     + 0.08·trend   − 0.06·degree_norm
```

The `neighbour_max_density` term is the point. A per-zone threshold cannot see a packed
neighbour about to push crowd into you; this can, and that is the one thing the GNN exists to
learn. `degree_norm` is negative because a well-connected zone has more ways to shed crowd, so
the same density there is less dangerous than in a dead end.

The weights are hand-tuned against `sample-data/venue-layout-sample.json`, not learned. They
are the calibration knob — a venue whose coordinates or capacities are on a very different
scale may want them adjusted.

### Using Hugging Face instead

```bash
cp .env.example .env    # then fill in HF_API_TOKEN and the HF_*_URL you want
```

To make hosted inference mandatory — so a bad token returns 502 rather than quietly falling
back — set `CONCOURSE_LOCAL_FALLBACK=false`.

---

## The `status` field

`/analyze` always answers with a full body. `status` is what lets Spring degrade instead of break:

- **`ok`** — both halves answered.
- **`partial`** — one did. The other key is empty and `errors` names which. Spring keeps the
  half it got: risk without prose, or prose without risk.
- **`failed`** — neither, returned with HTTP 502 so Spring falls back to its own mock and the
  session carries on showing measured density.

With the offline model enabled (the default) `failed` is unreachable. The state still exists
because a deployment pinned to hosted inference can absolutely reach it.

`422` is returned only for input the caller can fix — a duplicate node id, an edge pointing at
a node that does not exist, a negative density.

---

## Tests

```bash
.venv/Scripts/python -m pip install pytest   # not in requirements.txt — the service does not need it
.venv/Scripts/python -m pytest tests -q      # 47 checks, no token needed
.venv/Scripts/python -m app.scoring          # model self-check
```

The tests point the Hugging Face clients at a stub HTTP server started in-process, which covers
the parts that actually break: the request shapes sent, the response shapes accepted, cold-start
retries, and — the important one — that a dead model endpoint degrades instead of taking the
session down.
