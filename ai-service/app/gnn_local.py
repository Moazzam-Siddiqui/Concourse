"""Runs the trained congestion GNN in this process, with the checkpoint pulled from the Hub.

This is the path the project plan actually calls for: Hugging Face is where the model is
trained, versioned and pulled *from*, not something the service phones during a request. The
checkpoint is fetched once at startup and every inference after that is local — so a cold
Inference Endpoint or bad venue wifi cannot take the demo down mid-run.

Three ways to get a model, tried in order by `load()`:

1. ``CONCOURSE_GNN_REPO`` — a Hub repo id. Downloaded and cached by huggingface_hub.
2. ``CONCOURSE_GNN_CHECKPOINT`` — a path to a local ``.pt``, for offline work.
3. the default ``ml/out/congestion_gnn.pt`` a local training run leaves behind.

Everything here is optional. torch and torch-geometric are heavy and are *not* in this
service's requirements.txt; if they are not installed, `load()` records why and the service
carries on with the linear model in `app.scoring`. That is deliberate — a clean checkout must
still run, and `pip install torch` is not a thing to make someone do before `/health` works.
"""

from __future__ import annotations

import logging
import os
import sys
from pathlib import Path

log = logging.getLogger(__name__)

#: ml/gnn holds the architecture. It is a sibling directory, not an installed package, and it
#: is imported rather than redefined so the served network is definitionally the trained one.
ML_GNN_DIR = Path(__file__).resolve().parents[2] / "ml" / "gnn"

DEFAULT_CHECKPOINT = Path(__file__).resolve().parents[2] / "ml" / "out" / "congestion_gnn.pt"

CHECKPOINT_FILENAME = "congestion_gnn.pt"


class LocalGnn:
    """Holds the loaded model. ``ready`` stays False until ``load()`` succeeds."""

    def __init__(self) -> None:
        self.model = None
        self.ready = False
        self.error: str | None = None
        self.source: str | None = None

    def load(self) -> None:
        """Called once at startup. Never raises — /health reports whatever went wrong."""
        try:
            import torch  # noqa: F401

            if str(ML_GNN_DIR) not in sys.path:
                sys.path.insert(0, str(ML_GNN_DIR))
            from model import FEATURE_COLUMNS, load_checkpoint  # from ml/gnn/model.py

            checkpoint, source = self._resolve()
            self.model = load_checkpoint(str(checkpoint))
            self.feature_columns = list(FEATURE_COLUMNS)
            self.source = source
            self.ready = True
            log.info("local GNN ready from %s", source)
        except ImportError as exc:
            # By far the most common case, and not an error: torch simply is not installed.
            self.error = f"torch/torch-geometric not installed ({exc})"
            log.info("local GNN unavailable — %s; using the linear model", self.error)
        except Exception as exc:  # noqa: BLE001 — startup must survive any model problem
            self.error = f"{type(exc).__name__}: {exc}"
            log.warning("local GNN failed to load: %s", self.error)

    def _resolve(self) -> tuple[Path, str]:
        repo = os.environ.get("CONCOURSE_GNN_REPO", "").strip()
        if repo:
            from huggingface_hub import hf_hub_download

            path = hf_hub_download(
                repo_id=repo,
                filename=os.environ.get("CONCOURSE_GNN_FILE", CHECKPOINT_FILENAME),
                token=os.environ.get("HF_API_TOKEN") or None,
            )
            return Path(path), f"huggingface hub: {repo}"

        explicit = os.environ.get("CONCOURSE_GNN_CHECKPOINT", "").strip()
        candidate = Path(explicit) if explicit else DEFAULT_CHECKPOINT
        if not candidate.exists():
            raise FileNotFoundError(
                f"no checkpoint at {candidate} — train one with ml/gnn/train_gnn.py, "
                "or set CONCOURSE_GNN_REPO to pull it from the Hub"
            )
        return candidate, f"local file: {candidate}"

    def predict(self, node_ids: list[str], features: list[list[float]],
                edge_index: list[list[int]]) -> dict[str, float]:
        """``{node_id: risk}``. Same shape the Hugging Face client returns on success."""
        if not self.ready:
            raise RuntimeError(f"local GNN not loaded: {self.error}")

        import torch

        width = len(self.feature_columns)
        bad = [i for i, row in enumerate(features) if len(row) != width]
        if bad:
            raise ValueError(
                f"feature rows {bad[:5]} have the wrong width; expected {width} columns "
                f"in order {self.feature_columns}"
            )

        x = torch.tensor(features, dtype=torch.float)
        edges = torch.tensor(edge_index, dtype=torch.long)
        if edges.numel() == 0:
            # A venue with no edges is legal; message passing simply has nothing to pass.
            edges = torch.zeros((2, 0), dtype=torch.long)

        with torch.no_grad():
            scores = self.model(x, edges)
        return {node_id: float(score) for node_id, score in zip(node_ids, scores)}

    def describe(self) -> dict:
        return {"loaded": self.ready, "source": self.source, "error": self.error}


#: Module-level singleton, populated by the lifespan handler in main.py.
local_gnn = LocalGnn()
