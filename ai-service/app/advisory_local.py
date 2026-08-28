"""Runs a small instruct model in-process to write the operator advisory.

The advisory half of the AI layer, and the mirror image of `gnn_local.py`. Where the GNN was
trained here because nothing on the Hub could do the job, this side is the opposite case: turning
four facts into one clear English sentence is exactly what a small instruct model already does
well, so the right move is to adopt one rather than build anything.

Default is ``Qwen/Qwen2.5-0.5B-Instruct`` — ~0.5B parameters, roughly 1 GB, runs on CPU in a
second or two. It is downloaded from the Hub once and cached, so like the GNN there is no
network call at request time.

Optional, exactly like the GNN path: transformers is not in requirements.txt, and if it is
absent `load()` records why and the service falls back to the templates in `app.scoring`. A
clean checkout must still run.
"""

from __future__ import annotations

import logging
import os
import re

log = logging.getLogger(__name__)

DEFAULT_MODEL = "Qwen/Qwen2.5-0.5B-Instruct"

#: Kept short on purpose. An advisory that runs past two sentences is not read in an incident.
DEFAULT_MAX_NEW_TOKENS = 64

SYSTEM_PROMPT = (
    "You are a venue safety operator writing a live advisory for event staff.\n"
    "Reply with ONE sentence, at most 25 words.\n"
    "RULES:\n"
    "1. Only name zones that appear in the message. Never invent a zone name.\n"
    "2. Never suggest sending people to a zone listed as a concern — those are the full ones.\n"
    "3. If no zone is above the threshold, say things are flowing normally and advise no action.\n"
    "No preamble, no bullet points, no restating the numbers you were given."
)


class HallucinatedZone(ValueError):
    """Raised when the model names a zone that was not in the prompt. See `_check_zones`."""


def _check_zones(message: str, known_zones: list[str]) -> None:
    """
    Rejects prose that invents a place.

    This is not defensive padding — every failure it catches was observed from
    Qwen2.5-0.5B-Instruct on real prompts within minutes of wiring it up. Asked about Gate A it
    replied "reroute from Gate A to Gate B" when Gate B was never mentioned, and given two
    congested zones it advised routing people from one into the other. Fluent, confident, and
    unsafe. A venue advisory that names the wrong exit is worse than a plain one, so anything
    mentioning an unknown zone is discarded and the caller falls back to the templates.
    """
    if not known_zones:
        return

    # Zone names look like "Gate A", "North Concourse" — capitalised multi-word phrases. Pull
    # the candidates out of the message and check each against what the prompt actually said.
    known = {zone.lower() for zone in known_zones}
    for candidate in re.findall(r"\b[A-Z][a-z]+(?:\s+[A-Z][a-z]*)*(?:\s+[A-Z])?\b", message):
        phrase = candidate.strip().lower()
        if len(phrase) < 4 or phrase in _SENTENCE_STARTERS:
            continue
        # Accept exact matches and fragments of a real zone ("Gate A" inside "Gate A North").
        if any(phrase in zone or zone in phrase for zone in known):
            continue
        raise HallucinatedZone(f"named {candidate!r}, which is not one of {known_zones}")


#: Common sentence-opening words that the capitalisation heuristic would otherwise treat as
#: zone names. Not exhaustive — a false positive here only costs one fallback to the template.
_SENTENCE_STARTERS = {
    "hold", "divert", "reroute", "move", "open", "close", "stage", "monitor", "watch",
    "crowd", "flow", "advise", "advisory", "staff", "attendees", "people", "immediately",
    "no", "all", "the", "there", "this", "keep", "maintain", "continue", "consider",
    "send", "redirect", "direct", "route", "clear", "deploy", "increase", "reduce",
    "ensure", "avoid", "limit", "restrict", "guide", "escort", "begin", "start", "stop",
}


class LocalAdvisory:
    """Holds the loaded pipeline. ``ready`` stays False until ``load()`` succeeds."""

    def __init__(self) -> None:
        self.pipe = None
        self.ready = False
        self.error: str | None = None
        self.model_id = os.environ.get("CONCOURSE_ADVISORY_MODEL", DEFAULT_MODEL)

    def load(self) -> None:
        """Called once at startup. Never raises — /health reports whatever went wrong."""
        if os.environ.get("CONCOURSE_ADVISORY_LOCAL", "true").strip().lower() in ("0", "false", "no"):
            self.error = "disabled by CONCOURSE_ADVISORY_LOCAL"
            return
        try:
            from transformers import pipeline

            # dtype float32 and device -1: this shares a laptop with a Spring backend and a
            # simulation loop during the demo. Predictable CPU beats a GPU that may not exist.
            self.pipe = pipeline(
                "text-generation",
                model=self.model_id,
                device=-1,
                token=os.environ.get("HF_API_TOKEN") or None,
            )
            self.ready = True
            log.info("local advisory model ready: %s", self.model_id)
        except ImportError as exc:
            self.error = f"transformers not installed ({exc})"
            log.info("local advisory unavailable — %s; using templates", self.error)
        except Exception as exc:  # noqa: BLE001 — startup must survive any model problem
            self.error = f"{type(exc).__name__}: {exc}"
            log.warning("local advisory model failed to load: %s", self.error)

    def generate(self, prompt: str, known_zones: list[str] | None = None) -> str:
        """
        Returns one cleaned sentence.

        Raises `HallucinatedZone` when the model names a place that was not in the prompt, so
        the caller can fall back to the templates rather than read out invented guidance.
        """
        if not self.ready:
            raise RuntimeError(f"local advisory model not loaded: {self.error}")

        messages = [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ]
        out = self.pipe(
            messages,
            max_new_tokens=int(os.environ.get("CONCOURSE_ADVISORY_MAX_TOKENS", DEFAULT_MAX_NEW_TOKENS)),
            do_sample=False,          # deterministic: the same crowd state gives the same advice
            return_full_text=False,
        )
        message = _first_sentence(_extract(out))
        _check_zones(message, known_zones or [])
        return message

    def describe(self) -> dict:
        return {"loaded": self.ready, "model": self.model_id if self.ready else None,
                "error": self.error}


def _extract(output) -> str:
    """Unwraps the several shapes a transformers text-generation pipeline answers in."""
    if isinstance(output, list) and output:
        output = output[0]
    if isinstance(output, dict):
        text = output.get("generated_text")
        # Chat-formatted input comes back as a message list rather than a string.
        if isinstance(text, list) and text:
            last = text[-1]
            return last.get("content", "") if isinstance(last, dict) else str(last)
        if isinstance(text, str):
            return text
    return str(output)


def _first_sentence(text: str) -> str:
    """
    Small instruct models like to keep going after the point, and to open with a throat-clear
    like "Advisory:" or "Sure!". Both get removed, and the result is cut at one sentence — an
    operator reads the first line during an incident and nothing after it.
    """
    cleaned = re.sub(r"^\s*(advisory|answer|response|sure|certainly)\s*[:!,-]*\s*", "",
                     text.strip(), flags=re.IGNORECASE)
    cleaned = cleaned.strip().strip('"').strip()
    sentences = [s.strip() for s in re.split(r"(?<=[.!?])\s+", cleaned) if s.strip()]
    return sentences[0] if sentences else cleaned[:200]


#: Module-level singleton, populated by the lifespan handler in main.py.
local_advisory = LocalAdvisory()
