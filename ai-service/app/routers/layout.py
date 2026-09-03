"""``/layout`` — venue layout ingestion.

Three endpoints:

* ``POST /layout/parse`` — image in, venue graph out. The slow one (VLM load dominates).
* ``GET  /layout/{layout_id}`` — re-fetch a parse without re-running it. The editor
  uses this so a page refresh doesn't cost another inference.
* ``PUT  /layout/{layout_id}/confirm`` — operator-edited graph in, validated graph out,
  ready to POST to Spring's ``/venues``. This is the gate between "AI guessed" and
  "we are simulating on it".

The confirm step re-runs validation on the *edited* graph rather than trusting the
client. An operator dragging nodes around can disconnect a gate just as easily as the
pipeline can, and the simulation should never receive a graph nobody checked.
"""

from __future__ import annotations

import logging

import base64

import cv2
import numpy as np
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from pydantic import BaseModel

from app.layout import geometry, pipeline, rooms as rooms_mod, validate
from app.layout.rooms import RoomTuning
from app.layout.schemas import ParseResponse, ValidationIssue, VenueGraph

log = logging.getLogger(__name__)

router = APIRouter(prefix="/layout", tags=["layout"])

#: Uploads above this are rejected before decoding. A floor plan that large is either
#: a mistake or a scan that should be downsampled client-side first.
MAX_UPLOAD_BYTES = 12 * 1024 * 1024
ALLOWED_TYPES = {"image/png", "image/jpeg", "image/jpg", "image/webp"}

#: Chunk size for the bounded read below. Large enough that an honest 12MB plan costs a
#: handful of iterations, small enough that the overshoot before we bail is negligible.
_READ_CHUNK = 256 * 1024


async def _read_bounded(upload: UploadFile, limit: int) -> bytes:
    """
    Read an upload without letting the caller decide how much memory we allocate.

    ``await upload.read()`` with no argument materialises the entire body and only then can
    the result be measured, so a limit checked afterwards is enforced too late: a request
    that sends 2GB has already been given 2GB of process memory by the time the 12MB check
    runs, and a handful of concurrent ones take the service down. Reading in chunks and
    stopping one chunk past the limit costs the same for legitimate uploads and caps the
    damage from the rest.
    """
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = await upload.read(_READ_CHUNK)
        if not chunk:
            break
        total += len(chunk)
        if total > limit:
            raise HTTPException(
                status_code=413,
                detail=f"Upload exceeds the {limit // 1024 // 1024}MB limit.",
            )
        chunks.append(chunk)
    return b"".join(chunks)


class ConfirmRequest(BaseModel):
    """The operator's edited graph, straight from the map editor."""

    venue: VenueGraph


class ConfirmResponse(BaseModel):
    venue: VenueGraph
    issues: list[ValidationIssue]
    repairs: list[str]
    ready: bool  # false when errors remain — the UI keeps "Start simulation" disabled


@router.post("/parse", response_model=ParseResponse)
async def parse_layout(
    layout: UploadFile = File(..., description="2D venue floor plan (PNG/JPG/WEBP)"),
    venue_name: str = Form("Uploaded Venue"),
    metres_per_px: float | None = Form(None),
    use_vlm: bool = Form(True),
    room_aware: bool = Form(
        False,
        description=(
            "Separate enclosed rooms from circulation before tracing. Leave off for "
            "arenas and exhibition floors; turn on for any plan with rooms, or the "
            "corridors will be traced straight through them."
        ),
    ),
    wall_run_px: int = Form(RoomTuning.wall_run_px),
    corridor_min_px: int = Form(RoomTuning.corridor_min_px),
    large_room_multiple: float = Form(RoomTuning.large_room_multiple),
    treat_rooms_as_open: bool = Form(False),
) -> ParseResponse:
    if layout.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported type {layout.content_type!r}. Use PNG, JPG or WEBP.",
        )

    data = await _read_bounded(layout, MAX_UPLOAD_BYTES)
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload.")

    tuning = (
        RoomTuning(
            wall_run_px=wall_run_px,
            corridor_min_px=corridor_min_px,
            large_room_multiple=large_room_multiple,
            treat_rooms_as_open=treat_rooms_as_open,
        )
        if room_aware
        else None
    )

    try:
        return pipeline.parse_layout(
            data,
            venue_name=venue_name,
            metres_per_px=metres_per_px,
            use_vlm=use_vlm,
            tuning=tuning,
        )
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    except RuntimeError as exc:
        # Missing scikit-image, etc. Actionable, so surface the message verbatim.
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    except Exception:
        log.exception("Layout parse failed")
        raise HTTPException(
            status_code=500, detail="Layout parsing failed. Check the service logs."
        ) from None


class PreviewResponse(BaseModel):
    """What the mask stage decided, as a picture plus the counts behind it."""

    #: PNG data URI, ready for an <img src>. Returned inline rather than as a file
    #: because the client re-requests this on every slider change and a second
    #: round-trip to fetch the image would double the latency of a live control.
    image: str
    rooms: int
    traversable: int
    destinations: int
    circulation_ratio: float
    #: The tuning actually used, after clamping — so the UI can snap its sliders to
    #: the values the server really applied rather than the ones it asked for.
    tuning: dict


@router.post("/preview", response_model=PreviewResponse)
async def preview_mask(
    layout: UploadFile = File(..., description="2D venue floor plan (PNG/JPG/WEBP)"),
    wall_run_px: int = Form(RoomTuning.wall_run_px),
    corridor_min_px: int = Form(RoomTuning.corridor_min_px),
    large_room_multiple: float = Form(RoomTuning.large_room_multiple),
    treat_rooms_as_open: bool = Form(False),
) -> PreviewResponse:
    """Show which pixels would become road, without building a graph.

    Tuning the mask by re-running ``/layout/parse`` would work, but skeletonisation
    dominates that call — around 1.5s on a typical plan — and a control an operator
    drags needs to answer faster than they can drag it. This stops before the skeleton,
    which is the expensive part, and returns in roughly a quarter of the time.
    """
    if layout.content_type not in ALLOWED_TYPES:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported type {layout.content_type!r}. Use PNG, JPG or WEBP.",
        )
    data = await _read_bounded(layout, MAX_UPLOAD_BYTES)
    if not data:
        raise HTTPException(status_code=400, detail="Empty upload.")

    # Through decode_image, not cv2 directly: this path had its own decode and so skipped
    # the size cap, meaning a large upload could exhaust the container here even though
    # the parse path was protected.
    try:
        image = pipeline.decode_image(data)
    except ValueError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc

    tuning = RoomTuning(
        wall_run_px=wall_run_px,
        corridor_min_px=corridor_min_px,
        large_room_multiple=large_room_multiple,
        treat_rooms_as_open=treat_rooms_as_open,
    ).clamped()

    try:
        normalised, _canvas, _scale = geometry.normalise(image)
        found, walls = rooms_mod.detect_rooms(normalised, tuning)
        circulation, _rooms_mask = rooms_mod.build_circulation_mask(
            normalised, found, walls, tuning
        )
        circulation = rooms_mod.keep_main_network(circulation, found)
        view = rooms_mod.render_preview(normalised, found, walls, circulation)
    except Exception:
        log.exception("Layout preview failed")
        raise HTTPException(
            status_code=500, detail="Preview failed. Check the service logs."
        ) from None

    ok, buffer = cv2.imencode(".png", view)
    if not ok:
        raise HTTPException(status_code=500, detail="Could not encode the preview.")

    summary = rooms_mod.describe(found)
    return PreviewResponse(
        image="data:image/png;base64," + base64.b64encode(buffer.tobytes()).decode(),
        rooms=summary["rooms"],
        traversable=summary["traversable"],
        destinations=summary["destinations"],
        circulation_ratio=float(np.count_nonzero(circulation)) / float(circulation.size),
        tuning={
            "wall_run_px": tuning.wall_run_px,
            "corridor_min_px": tuning.corridor_min_px,
            "large_room_multiple": tuning.large_room_multiple,
            "treat_rooms_as_open": tuning.treat_rooms_as_open,
        },
    )


@router.get("/{layout_id}", response_model=ParseResponse)
async def get_layout(layout_id: str) -> ParseResponse:
    cached = pipeline.CACHE.get(layout_id)
    if cached is None:
        raise HTTPException(
            status_code=404,
            detail="Unknown or expired layout_id. Layouts are held in memory and "
            "cleared on restart — re-upload the plan.",
        )
    return cached


@router.post("/validate", response_model=ConfirmResponse)
async def validate_layout(body: ConfirmRequest) -> ConfirmResponse:
    """Validate a graph that was never parsed — one drawn by hand in Layout Studio.

    Same checks as ``/confirm``, minus the cache write, because there is no cached
    parse to update. A hand-drawn graph is not exempt from validation: an operator can
    leave a gate with no route to an exit just as easily as the tracer can, and that is
    the one failure that must never reach the simulation.
    """
    venue, issues, repairs = validate.validate_and_repair(body.venue)
    ready = not any(i.severity == "error" for i in issues)
    log.info("Validated hand-drawn layout: ready=%s, %d issues", ready, len(issues))
    return ConfirmResponse(venue=venue, issues=issues, repairs=repairs, ready=ready)


@router.put("/{layout_id}/confirm", response_model=ConfirmResponse)
async def confirm_layout(layout_id: str, body: ConfirmRequest) -> ConfirmResponse:
    """Validate the operator's edits and mark the graph ready for simulation."""
    venue, issues, repairs = validate.validate_and_repair(body.venue)
    ready = not any(i.severity == "error" for i in issues)

    cached = pipeline.CACHE.get(layout_id)
    if cached is not None:
        cached.venue = venue
        cached.metadata.issues = issues
        cached.metadata.repairs = [*cached.metadata.repairs, *repairs]

    log.info("Confirmed layout %s: ready=%s, %d issues", layout_id, ready, len(issues))
    return ConfirmResponse(venue=venue, issues=issues, repairs=repairs, ready=ready)
