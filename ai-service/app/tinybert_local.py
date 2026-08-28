"""TinyBERT congestion risk, ported from the `Python Backend/` service (commit 5fe7d5a).

That service was deleted when the repo was flattened in a3f8b10 and replaced by this one. Its
model is brought back here rather than as a second FastAPI process: `/analyze` already carries
the graph, the density and the history, Spring already calls it, and the frontend already
renders what comes back. Only the thing doing the scoring needed to change.

What it does, unchanged from the original:

1. renders each node's features as an English sentence
2. runs ``huawei-noah/TinyBERT_General_4L_312D`` over the batch and mean-pools the last hidden
   state into one 312-dim vector per node
3. blends an embedding-derived signal (30%) with a weighted sum of the raw features (70%)

Two deliberate differences from the original, both because this service's contract is not the
old one's:

* The raw-feature half uses :data:`app.scoring.WEIGHTS` over the six columns in
  ``preprocessing.FEATURE_COLUMNS``, not the original's eight hand-weighted fields. Those six
  are what `/analyze` is given and what the trained GNN shares, so reusing them keeps every
  risk path in this service scoring the same numbers from the same inputs.
* The embedding norm is divided by a fixed scale, not by the batch maximum. Dividing by the
  batch max made a node's risk depend on which other nodes happened to be in the request — a
  single-node graph always scored 1.0 on that term, and adding a calm zone to the venue moved
  the risk of every other zone. Per-node scoring has to be per-node.

Optional, exactly like the GNN and advisory paths: torch and transformers are not in
requirements.txt, and ``load()`` records why rather than raising if they are missing. It also
stays off entirely unless ``CONCOURSE_TINYBERT`` is set, so the trained GNN remains the default
and nobody downloads 55 MB by surprise.
"""

from __future__ import annotations

import logging
import os

from app import scoring
from app.services.preprocessing import FEATURE_COLUMNS

log = logging.getLogger(__name__)

DEFAULT_MODEL = "huawei-noah/TinyBERT_General_4L_312D"

#: How much of the score comes from the sentence embedding rather than the raw features.
#: 0.30 is the original's number. The features are what actually predict congestion; this term
#: is the model's read of "how unusual does this zone's state sound".
EMBEDDING_WEIGHT = 0.30

#: Divisor turning a mean-pooled embedding's L2 norm into a [0,1] signal.
#:
#: ponytail: one constant, calibrated by eye against the norms logged on the first batch.
#: Mean-pooled TinyBERT norms cluster tightly, so a fixed scale is enough and — unlike the
#: batch maximum it replaces — is stable across requests. Retune via CONCOURSE_TINYBERT_SCALE
#: if the first-batch log line shows norms far from this.
DEFAULT_EMBEDDING_SCALE = 10.0


def _flag(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


class TinyBertRisk:
    """
    Same surface as :class:`app.gnn_local.LocalGnn`, so the router treats them interchangeably:
    ``ready``, ``load()``, ``predict()``, ``describe()``.
    """

    def __init__(self) -> None:
        self.tokenizer = None
        self.model = None
        self.ready = False
        self.error: str | None = None
        self.model_id = os.environ.get("CONCOURSE_TINYBERT_MODEL", DEFAULT_MODEL)
        self.scale = float(os.environ.get("CONCOURSE_TINYBERT_SCALE", DEFAULT_EMBEDDING_SCALE))
        self._logged_norms = False

    def load(self) -> None:
        """Called once at startup. Never raises — /health reports whatever went wrong."""
        if not _flag("CONCOURSE_TINYBERT", False):
            self.error = "disabled (set CONCOURSE_TINYBERT=true to enable)"
            return
        try:
            import torch  # noqa: F401
            from transformers import AutoModel, AutoTokenizer

            self.tokenizer = AutoTokenizer.from_pretrained(self.model_id)
            self.model = AutoModel.from_pretrained(self.model_id)
            self.model.eval()  # inference mode — disables dropout, so a replay is identical
            self.ready = True
            log.info("TinyBERT risk model ready: %s", self.model_id)
        except ImportError as exc:
            self.error = f"torch/transformers not installed ({exc})"
            log.info("TinyBERT unavailable — %s; using the linear model", self.error)
        except Exception as exc:  # noqa: BLE001 — startup must survive any model problem
            self.error = f"{type(exc).__name__}: {exc}"
            log.warning("TinyBERT failed to load: %s", self.error)

    def predict(self, node_ids: list[str], features: list[list[float]],
                edge_index: list[list[int]] | None = None) -> dict[str, float]:
        """
        ``{node_id: risk}`` — the shape every risk path in this service returns.

        ``edge_index`` is accepted and ignored: TinyBERT is a text encoder, not a graph net, so
        it does no message passing. The graph is not lost, though — ``neighbour_max_density``
        and ``degree_norm`` are already folded into each row by ``preprocessing.build_features``,
        which is how a neighbour filling up still moves this node's score.
        """
        if not self.ready:
            raise RuntimeError(f"TinyBERT not loaded: {self.error}")
        if not node_ids:
            return {}

        import torch

        width = len(FEATURE_COLUMNS)
        bad = [i for i, row in enumerate(features) if len(row) != width]
        if bad:
            raise ValueError(
                f"feature rows {bad[:5]} have the wrong width; expected {width} columns "
                f"in order {FEATURE_COLUMNS}"
            )

        texts = [_describe_node(row) for row in features]
        encoded = self.tokenizer(
            texts, padding=True, truncation=True, max_length=128, return_tensors="pt"
        )
        with torch.no_grad():
            hidden = self.model(**encoded).last_hidden_state       # (N, T, 312)

        # Mean-pool over real tokens only; padding must not drag the average toward zero.
        mask = encoded["attention_mask"].unsqueeze(-1).float()     # (N, T, 1)
        pooled = (hidden * mask).sum(dim=1) / mask.sum(dim=1).clamp(min=1e-9)
        norms = pooled.norm(dim=-1)                                # (N,)

        if not self._logged_norms:
            # One line, once: the only thing needed to retune CONCOURSE_TINYBERT_SCALE.
            log.info(
                "TinyBERT embedding norms %.2f–%.2f (scale=%.1f) — retune "
                "CONCOURSE_TINYBERT_SCALE if these sit far from it",
                float(norms.min()), float(norms.max()), self.scale,
            )
            self._logged_norms = True

        raw = scoring.score_features(features)
        blended = [
            min(1.0, max(0.0,
                EMBEDDING_WEIGHT * min(1.0, float(norm) / self.scale)
                + (1.0 - EMBEDDING_WEIGHT) * raw_score))
            for norm, raw_score in zip(norms, raw)
        ]
        return dict(zip(node_ids, blended))

    def describe(self) -> dict:
        return {"loaded": self.ready, "model": self.model_id if self.ready else None,
                "error": self.error}


def _describe_node(row: list[float]) -> str:
    """
    Renders one feature row as the sentence TinyBERT encodes.

    Wording is fixed and the numbers are rounded: the same crowd state must produce the same
    string, or the same simulation would replay with different risk.
    """
    density, trend, capacity_norm, degree_norm, neighbour_max, delta = row
    return (
        f"Zone at {density:.2f} density, {_TREND_WORDS.get(round(trend), 'steady')}, "
        f"capacity share {capacity_norm:.2f}, {degree_norm:.2f} connectedness, "
        f"busiest neighbour at {neighbour_max:.2f}, change since arrival {delta:+.2f}."
    )


_TREND_WORDS = {1: "filling", 0: "steady", -1: "emptying"}


#: Module-level singleton, populated by the lifespan handler in main.py.
tinybert_risk = TinyBertRisk()
