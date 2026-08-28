"""Checks for the in-process advisory model (Qwen2.5-0.5B-Instruct by default).

Kept out of test_analyze.py because these actually generate text, which costs a second or two
per call on CPU. Skipped entirely when transformers is not installed — that is a supported
state, not a failure, and a clean checkout must still get a green suite.

    .venv/Scripts/python -m pytest tests/test_advisory_model.py -q
"""

from __future__ import annotations

import pytest

from app.advisory_local import HallucinatedZone, _check_zones, _first_sentence

ZONES = ["Gate A", "Gate B", "North Concourse", "Food Court", "Exit East"]

PROMPT = (
    "Venue: Northgate Arena\n"
    "Time into event: 12 min\n"
    "People inside: 1800, still to arrive: 400\n"
    "Automatic rerouting: on\n"
    "Zones of concern:\n"
    "- Gate A: 91% full now, rising, predicted risk 88%\n"
    "\nAdvisory:"
)


# ------------------------------------------------------------------ pure text shaping

def test_strips_the_throat_clear_small_models_open_with():
    assert _first_sentence("Advisory: Hold intake at Gate A.") == "Hold intake at Gate A."
    assert _first_sentence("Sure! Divert to Exit East.") == "Divert to Exit East."
    assert _first_sentence('"Hold intake at Gate A."') == "Hold intake at Gate A."


def test_cuts_at_one_sentence():
    """An operator reads the first line during an incident and nothing after it."""
    text = "Hold intake at Gate A. Then reopen once density falls. Also consider staffing."
    assert _first_sentence(text) == "Hold intake at Gate A."


def test_survives_a_model_that_returns_nothing_useful():
    assert _first_sentence("") == ""
    assert _first_sentence("   ") == ""


# ------------------------------------------------------------------ hallucination guard

def test_accepts_advice_that_only_names_real_zones():
    for message in (
        "Hold intake at Gate A and stage arrivals outside.",
        "Divert people from North Concourse to Exit East.",
        "Crowd is flowing normally; no action needed.",
        "Move staff to Food Court before it crosses the line.",
    ):
        _check_zones(message, ZONES)  # must not raise


def test_rejects_a_zone_the_model_invented():
    """
    Every case here was produced by Qwen2.5-0.5B-Instruct on a real prompt, not imagined.

    A venue advisory naming an exit that does not exist is worse than a plain one, so these
    must be discarded in favour of the templates rather than read out to staff.
    """
    with pytest.raises(HallucinatedZone):
        _check_zones("Reroute attendees from Gate A to the South Annexe.", ZONES)
    with pytest.raises(HallucinatedZone):
        _check_zones("Send everyone towards Riverside Hall immediately.", ZONES)


def test_no_known_zones_means_no_check():
    """Callers that cannot supply the zone list must not have every message rejected."""
    _check_zones("Anything at all, Mystery Place included.", [])


# ------------------------------------------------------------------ the real model

@pytest.fixture(scope="module")
def advisory_model():
    from app.advisory_local import local_advisory

    if not local_advisory.ready:
        local_advisory.load()
    if not local_advisory.ready:
        pytest.skip(f"advisory model unavailable ({local_advisory.error})")
    return local_advisory


def test_the_local_advisory_model_writes_a_sentence(advisory_model):
    message = advisory_model.generate(PROMPT)

    assert message, "model returned nothing"
    assert len(message) < 300, f"not one sentence: {message!r}"
    # The system prompt forbids these; a model ignoring it means the prompt has drifted.
    assert not message.lower().startswith(("advisory:", "sure", "certainly")), message


def test_generation_is_deterministic(advisory_model):
    """do_sample=False, so the same crowd state must give the same advice every time.

    Matters for a demo: a judge asking "run that again" should see the same sentence, and an
    incident log that says something different each tick for identical input is untrustworthy.
    """
    assert advisory_model.generate(PROMPT) == advisory_model.generate(PROMPT)
