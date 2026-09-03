"""Semantic reading of a floor plan by a hosted vision model.

`vlm.py` loads Qwen2.5-VL into this process, which needs several gigabytes and a GPU to be
worth using. That is fine on a workstation and impossible on a small container: the free
instance this service runs on has 512MB, which is not enough for the OCR models, let alone
a VLM.

Sending the image to a hosted model instead costs no local memory at all. The request is
one HTTPS call, the reply is the same JSON contract `vlm.py` already defines, and
`parse_semantic_json` turns it into the same `SemanticLayout`. Everything downstream is
unchanged — including `geometry.build_walkable_mask`, which takes the semantic layout as an
input, so better zone understanding improves the traced corridors and not only their names.

Off unless `LAYOUT_VLM_API_KEY` is set. With no key the pipeline behaves exactly as it does
today: OCR labels if they are available, geometry alone if they are not.

Gemini is the default provider because its free tier is genuinely usable for this — a
floor plan is one image and a few hundred tokens of reply — and because it reads text in
images well, which is the half of the job OCR is otherwise doing.
"""

from __future__ import annotations

import base64
import json
import logging
import os

import httpx

from app.layout.schemas import Canvas, SemanticLayout
from app.layout.vlm import _PROMPT, parse_semantic_json

log = logging.getLogger(__name__)

#: Model to call. Any vision-capable Gemini model works; flash is the cheap, fast one and
#: is what the free tier is generous with.
MODEL = os.getenv("LAYOUT_VLM_MODEL_HOSTED", "gemini-2.0-flash")

#: A floor plan is a single image and a short structured reply, so this is a small request.
#: The timeout is generous because the caller is already waiting on a trace that takes
#: seconds, and a slow answer is still far better than no semantics.
TIMEOUT_S = float(os.getenv("LAYOUT_VLM_TIMEOUT_S", "45"))


def configured() -> bool:
    """True when a key is present. Everything here is inert without one."""
    return bool(os.environ.get("LAYOUT_VLM_API_KEY", "").strip())


def status() -> dict:
    """One line for /health, so it is obvious from outside which path is running."""
    if not configured():
        return {"enabled": False, "model": None, "error": "LAYOUT_VLM_API_KEY not set"}
    return {"enabled": True, "model": MODEL, "error": None}


def describe(image_png: bytes, canvas: Canvas) -> SemanticLayout:
    """Ask the hosted model to read the plan.

    Returns a degraded layout on any failure rather than raising: a semantic stage that
    cannot answer must leave the trace running on geometry alone, exactly as it does when
    no model is configured at all. A floor plan that traces without names is useful; an
    exception that kills the upload is not.
    """
    key = os.environ.get("LAYOUT_VLM_API_KEY", "").strip()
    if not key:
        return SemanticLayout(canvas=canvas, degraded=True)

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent"
    payload = {
        "contents": [{
            "parts": [
                {"text": _PROMPT},
                {"inline_data": {
                    "mime_type": "image/png",
                    "data": base64.b64encode(image_png).decode("ascii"),
                }},
            ],
        }],
        # The prompt asks for JSON and nothing else; asking the API to enforce that removes
        # the markdown fences these models otherwise wrap it in.
        "generationConfig": {"temperature": 0.1, "response_mime_type": "application/json"},
    }

    try:
        with httpx.Client(timeout=TIMEOUT_S) as client:
            reply = client.post(url, params={"key": key}, json=payload)
        if reply.status_code != 200:
            # Body is truncated on purpose: an error from this API can carry the request
            # back verbatim, and that includes the base64 of the whole floor plan.
            log.warning("Hosted VLM returned %s: %s", reply.status_code, reply.text[:200])
            return SemanticLayout(canvas=canvas, degraded=True)

        body = reply.json()
        text = body["candidates"][0]["content"]["parts"][0]["text"]
        return parse_semantic_json(json.loads(text), canvas)
    except Exception as exc:  # noqa: BLE001 - any failure degrades, none propagates
        log.warning("Hosted VLM call failed (%s); tracing without semantics", exc)
        return SemanticLayout(canvas=canvas, degraded=True)
