"""Concourse — AI orchestration layer (FastAPI).

    uvicorn app.main:app --reload --port 8000

Three endpoints, one model behind them:

* ``POST /analyze`` — the primary one. Spring sends the venue graph, current density, recent
  history and run context; this returns ``{predictions, advisory}``.
* ``POST /predict/risk`` — risk only, from density and trend. Used by the older
  ``/simulations`` flow-mode path in Spring.
* ``POST /generate/advisory`` — one sentence for one zone. Same caller.

Each inference step runs against the Hugging Face Inference API when ``HF_API_TOKEN`` and the
matching URL are set, and against the offline model in :mod:`app.scoring` otherwise. Nothing
is loaded at startup and nothing can fail to load, so the service is ready the moment the
process is up — see ``/health`` for which path is live.
"""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import Depends, FastAPI
from fastapi.middleware.cors import CORSMiddleware

# Load .env before anything reads os.environ. Never commit that file — see README.md.
load_dotenv()

from app import scoring  # noqa: E402  (must follow load_dotenv)
from app.advisory_local import local_advisory  # noqa: E402
from app.config import settings  # noqa: E402
from app.gnn_local import local_gnn  # noqa: E402
from app import security  # noqa: E402
from app.routers import advisory, analyze, risk  # noqa: E402
from app.tinybert_local import tinybert_risk  # noqa: E402

# The layout pipeline needs OpenCV/NumPy/scikit-image, which live in the separate
# requirements-layout.txt. Import failure here is an expected state, not an error: the
# core service must start and keep serving /analyze whether or not the CV stack is
# installed. Only /layout/* degrades, and /health reports which way it went.
try:
    from app.routers import layout as layout_router  # noqa: E402

    LAYOUT_IMPORT_ERROR: str | None = None
except Exception as exc:  # pragma: no cover - depends on what is installed
    layout_router = None
    LAYOUT_IMPORT_ERROR = f"{type(exc).__name__}: {exc}"

logging.basicConfig(
    level=settings.LOG_LEVEL,
    format="%(asctime)s %(levelname)-7s %(name)s | %(message)s",
    datefmt="%H:%M:%S",
)
log = logging.getLogger("concourse.ai")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Loads the in-process GNN if there is one, then says which path is actually live.

    The log line saves an hour of 'why is the advisory generic' during a demo. The load never
    raises: a missing checkpoint or an absent torch install is an expected state, reported at
    /health, not a reason the service will not start.
    """
    security.warn_if_open()

    tinybert_risk.load()
    local_gnn.load()
    local_advisory.load()

    config = settings.describe()
    log.info(
        "AI service ready — risk: %s | advisory: %s | local fallback: %s",
        "hugging face" if config["hostedGnn"]
        else f"tinybert ({tinybert_risk.model_id})" if tinybert_risk.ready
        else f"in-process ({local_gnn.source})" if local_gnn.ready
        else scoring.MODEL_NAME,
        "hugging face" if config["hostedLlm"]
        else f"in-process ({local_advisory.model_id})" if local_advisory.ready
        else scoring.ADVISORY_MODEL_NAME,
        "on" if config["localFallback"] else "OFF (hosted inference is mandatory)",
    )
    yield


app = FastAPI(
    title="Concourse — AI Service",
    description=(
        "Predicts per-zone congestion risk and writes the operator advisory that goes with it. "
        "Called only by the Spring Boot backend."
    ),
    version="1.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_methods=["*"],
    allow_headers=["*"],
)

# The shared-secret gate is applied per router rather than as middleware so that /health
# stays reachable without it: docker-compose and any load balancer probe it, and a probe that
# needs a credential is a probe that reports the service down when the credential is wrong.
_guard = [Depends(security.require_service_token)]

app.include_router(analyze.router, dependencies=_guard)
app.include_router(risk.router, dependencies=_guard)
app.include_router(advisory.router, dependencies=_guard)

if layout_router is not None:
    app.include_router(layout_router.router, dependencies=_guard)
else:
    log.warning(
        "Layout endpoints disabled — %s. Install with: "
        "pip install -r requirements-layout.txt",
        LAYOUT_IMPORT_ERROR,
    )


@app.get("/health", tags=["health"])
def health() -> dict:
    """
    Spring checks this before relying on the service.

    `status` is "ok" whenever at least one inference path can answer — which, with the local
    fallback on, is always. "degraded" means hosted inference is mandatory and unconfigured,
    so every /analyze will 502.
    """
    config = settings.describe()
    usable = (config["localFallback"] or local_gnn.ready or tinybert_risk.ready
              or (config["hostedGnn"] and config["hostedLlm"]))
    return {
        "status": "ok" if usable else "degraded",
        "service": "concourse-ai",
        "inference": {
            "gnn": "huggingface" if config["hostedGnn"]
                   else "tinybert" if tinybert_risk.ready
                   else "congestion-gnn" if local_gnn.ready
                   else scoring.MODEL_NAME,
            "advisory": "huggingface" if config["hostedLlm"]
                        else local_advisory.model_id if local_advisory.ready
                        else scoring.ADVISORY_MODEL_NAME,
        },
        "tinybert": tinybert_risk.describe(),
        "localGnn": local_gnn.describe(),
        "localAdvisory": local_advisory.describe(),
        # Lets the Layout Studio say "AI tracing unavailable, install the CV stack"
        # instead of letting the operator upload a plan and get a 404.
        "layout": {
            "available": layout_router is not None,
            "error": LAYOUT_IMPORT_ERROR,
        },
        "serviceToken": security.describe(),
        "config": config,
    }
