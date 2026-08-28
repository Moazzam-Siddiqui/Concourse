"""Every environment variable this service reads, in one place.

Read once at import. Nothing here has a default that requires a network or a token, so
`uvicorn app.main:app` works on a clean checkout with nothing configured — that is the
property that makes the demo survive bad wifi.
"""

from __future__ import annotations

import os


def _flag(name: str, default: bool) -> bool:
    return os.environ.get(name, str(default)).strip().lower() in ("1", "true", "yes", "on")


class Settings:
    # --- server ---------------------------------------------------------
    HOST: str = os.environ.get("HOST", "127.0.0.1")
    PORT: int = int(os.environ.get("PORT", "8000"))

    #: Origins allowed to call this service directly. The Spring backend is server-to-server
    #: and so is not subject to CORS; these are here for poking at /docs from the frontend.
    CORS_ORIGINS: list[str] = [
        origin.strip()
        for origin in os.environ.get(
            "CORS_ORIGINS", "http://localhost:5173,http://localhost:8080"
        ).split(",")
        if origin.strip()
    ]

    LOG_LEVEL: str = os.environ.get("LOG_LEVEL", "INFO").upper()

    # --- hosted inference, and the offline fallback ----------------------
    # These are properties, not class attributes, because they are consulted on every request
    # rather than once at boot. Snapshotting them at import would mean a token exported after
    # the module loaded is silently ignored — which is exactly what a test that sets HF_* around
    # a call does, and exactly how you end up debugging a "dead" endpoint that is merely unread.

    @property
    def HF_API_TOKEN(self) -> str:
        return os.environ.get("HF_API_TOKEN", "").strip()

    @property
    def HF_GNN_URL(self) -> str:
        return os.environ.get("HF_GNN_URL", "").strip()

    @property
    def HF_LLM_URL(self) -> str:
        return os.environ.get("HF_LLM_URL", "").strip()

    @property
    def LOCAL_FALLBACK(self) -> bool:
        """
        When true (the default) a missing or failing hosted call falls through to app.scoring.
        Set CONCOURSE_LOCAL_FALLBACK=false to make hosted inference mandatory, so a broken
        token surfaces as a 502 instead of being quietly papered over.
        """
        return _flag("CONCOURSE_LOCAL_FALLBACK", True)

    @property
    def hf_gnn_configured(self) -> bool:
        return bool(self.HF_GNN_URL and self.HF_API_TOKEN)

    @property
    def hf_llm_configured(self) -> bool:
        return bool(self.HF_LLM_URL and self.HF_API_TOKEN)

    def describe(self) -> dict:
        """For /health. Reports whether secrets are *present*, never what they are."""
        return {
            "hostedGnn": self.hf_gnn_configured,
            "hostedLlm": self.hf_llm_configured,
            "tokenSet": bool(self.HF_API_TOKEN),
            "localFallback": self.LOCAL_FALLBACK,
        }


settings = Settings()
