"""Semantic reading of a floor plan by a hosted vision model.

`vlm.py` loads Qwen2.5-VL into this process, which needs several gigabytes and a GPU to be
worth using. That is fine on a workstation and impossible on a small container: the free
instance this service runs on has 512MB, which is not enough for the OCR models, let alone
a VLM. That is why plans currently trace with no semantics at all.

Sending the image to a hosted model instead costs no local memory. The request is one
HTTPS call, the reply is the same JSON contract `vlm.py` already defines, and
`parse_semantic_json` turns it into the same `SemanticLayout`. Everything downstream is
unchanged — including `geometry.build_walkable_mask`, which takes the semantic layout as an
input, so better zone understanding moves the traced corridors and does not only rename
them.

Two providers, because they fail differently and it is useful to be able to switch:

  groq    (default) OpenAI-compatible chat completions. Fast, free tier, and the vision
          models are Qwen — the same family the local path uses, so the prompt behaves
          the way it was written to.
  gemini  Google's endpoint. Different shape, same contract.

Off unless `LAYOUT_VLM_API_KEY` is set. With no key the pipeline behaves exactly as it
does today: OCR labels if available, geometry alone if not.
"""

from __future__ import annotations

import base64
import logging
import os

import httpx

from app.layout.schemas import Canvas, SemanticLayout
from app.layout.vlm import _PROMPT, _extract_json, parse_semantic_json

log = logging.getLogger(__name__)

PROVIDER = os.getenv("LAYOUT_VLM_PROVIDER", "groq").strip().lower()

#: Defaults per provider. Both are vision-capable and both support a JSON response mode,
#: which matters: the prompt asks for a bare object and these models otherwise wrap it in
#: markdown fences that then have to be stripped back off.
_DEFAULT_MODEL = {
    # 3.8, not 3.6. Both read the plan correctly, but 3.6 emits a <think> block before the
    # object: under strict JSON mode Groq rejects its own generation and returns
    # json_validate_failed with an empty body, and without strict mode the reply is prose
    # wrapped around JSON. 3.8's instruct behaviour answers with the object.
    "groq": "qwen/qwen3.8-27b",
    "gemini": "gemini-2.0-flash",
}

MODEL = os.getenv("LAYOUT_VLM_MODEL_HOSTED", "").strip() or _DEFAULT_MODEL.get(PROVIDER, "")

#: Generous, because the caller is already waiting on a trace that takes seconds and a slow
#: answer is still far better than none.
TIMEOUT_S = float(os.getenv("LAYOUT_VLM_TIMEOUT_S", "45"))


def _key() -> str:
    return os.environ.get("LAYOUT_VLM_API_KEY", "").strip()


def configured() -> bool:
    """True when a key is present. Everything here is inert without one."""
    return bool(_key()) and PROVIDER in _DEFAULT_MODEL


def status() -> dict:
    """One line for /health, so it is obvious from outside which path is running."""
    if PROVIDER not in _DEFAULT_MODEL:
        return {"enabled": False, "provider": PROVIDER, "model": None,
                "error": f"unknown provider {PROVIDER!r}; use groq or gemini"}
    if not _key():
        return {"enabled": False, "provider": PROVIDER, "model": None,
                "error": "LAYOUT_VLM_API_KEY not set"}
    return {"enabled": True, "provider": PROVIDER, "model": MODEL, "error": None}


def _call_groq(image_png: bytes, key: str) -> str:
    """OpenAI-compatible chat completions with the image inline as a data URL."""
    b64 = base64.b64encode(image_png).decode("ascii")
    body = {
        "model": MODEL,
        "messages": [{
            "role": "user",
            "content": [
                {"type": "text", "text": _PROMPT},
                {"type": "image_url",
                 "image_url": {"url": f"data:image/png;base64,{b64}"}},
            ],
        }],
        "temperature": 0.1,
        # No response_format here. Strict JSON mode makes the reasoning models fail the
        # whole request rather than answer imperfectly, and _extract_json already pulls an
        # object out of a reply that carries prose or fences around it. Being tolerant of a
        # messy reply beats being rejected by a strict one.
    }
    with httpx.Client(timeout=TIMEOUT_S) as client:
        reply = client.post(
            "https://api.groq.com/openai/v1/chat/completions",
            headers={"Authorization": f"Bearer {key}"},
            json=body,
        )
    reply.raise_for_status()
    return reply.json()["choices"][0]["message"]["content"]


def _call_gemini(image_png: bytes, key: str) -> str:
    body = {
        "contents": [{
            "parts": [
                {"text": _PROMPT},
                {"inline_data": {
                    "mime_type": "image/png",
                    "data": base64.b64encode(image_png).decode("ascii"),
                }},
            ],
        }],
        "generationConfig": {"temperature": 0.1, "response_mime_type": "application/json"},
    }
    with httpx.Client(timeout=TIMEOUT_S) as client:
        reply = client.post(
            f"https://generativelanguage.googleapis.com/v1beta/models/{MODEL}:generateContent",
            params={"key": key},
            json=body,
        )
    reply.raise_for_status()
    return reply.json()["candidates"][0]["content"]["parts"][0]["text"]


def describe(image_png: bytes, canvas: Canvas) -> SemanticLayout:
    """Ask the hosted model to read the plan.

    Returns a degraded layout on any failure rather than raising: a semantic stage that
    cannot answer must leave the trace running on geometry alone, exactly as it does when
    no model is configured. A plan that traces without names is useful; an exception that
    kills the upload is not.
    """
    key = _key()
    if not key or PROVIDER not in _DEFAULT_MODEL:
        return SemanticLayout(canvas=canvas, degraded=True)

    try:
        text = (_call_groq if PROVIDER == "groq" else _call_gemini)(image_png, key)
        payload = _extract_json(text)
        if payload is None:
            log.warning("Hosted VLM (%s) returned no JSON object; tracing without semantics",
                        PROVIDER)
            return SemanticLayout(canvas=canvas, degraded=True)
        return parse_semantic_json(payload, canvas)
    except httpx.HTTPStatusError as exc:
        # Truncated on purpose: an error from either API can echo the request back, and
        # that includes the base64 of the entire floor plan.
        log.warning("Hosted VLM (%s) returned %s: %s",
                    PROVIDER, exc.response.status_code, exc.response.text[:200])
    except Exception as exc:  # noqa: BLE001 - any failure degrades, none propagates
        log.warning("Hosted VLM (%s) failed (%s); tracing without semantics", PROVIDER, exc)
    return SemanticLayout(canvas=canvas, degraded=True)
