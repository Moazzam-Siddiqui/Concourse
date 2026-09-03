"""Orchestrator — runs the seven stages in the one order the hardware allows.

    Upload → normalise → [load VLM → infer → UNLOAD] → OpenCV → skeleton → graph
           → validate/repair → response

The bracketed section is the only part that touches VRAM, and it is closed before
OpenCV starts. That is enforced structurally by the ``with VlmSession()`` block rather
than by remembering to call ``unload()``, because forgetting it OOMs the second upload
rather than the first, which is the worst possible failure mode to debug live.

Concurrency: a module-level lock serialises parses. Two simultaneous uploads on a 4 GB
card would both try to load a 2.2 GB model. Queuing is slower; OOM is broken.
"""

from __future__ import annotations

import logging
import threading
import time
import uuid
from dataclasses import dataclass, field

import cv2
import numpy as np

from app.layout import geometry, graph as graph_mod, ocr, rooms as rooms_mod, validate, vlm_hosted
from app.layout.rooms import RoomTuning
from app.layout.schemas import (
    Canvas,
    LayoutMetadata,
    ParseResponse,
    SemanticLayout,
    VenueGraph,
)
from app.layout.vlm import VlmSession

log = logging.getLogger(__name__)

#: One parse at a time. See module docstring.
_PARSE_LOCK = threading.Lock()

#: Parsed layouts, keyed by layout_id. Matches the rest of this service: in-memory,
#: cleared on restart, no database. Bounded so a long demo session cannot grow forever.
_CACHE_LIMIT = 32


@dataclass
class _Cache:
    items: dict[str, ParseResponse] = field(default_factory=dict)
    order: list[str] = field(default_factory=list)

    def put(self, key: str, value: ParseResponse) -> None:
        self.items[key] = value
        self.order.append(key)
        while len(self.order) > _CACHE_LIMIT:
            self.items.pop(self.order.pop(0), None)

    def get(self, key: str) -> ParseResponse | None:
        return self.items.get(key)


CACHE = _Cache()


#: Longest edge the pipeline will work at.
#:
#: Memory here is quadratic in the long edge and the pipeline holds several full-size
#: intermediates at once - grey, ink mask, room labels, distance transform, skeleton. A
#: 4000px plan is roughly four times the working set of a 2000px one, which is the
#: difference between fitting a small container and being killed by it.
#:
#: 2000px is well above what the tracing needs: wall runs and corridor widths are measured
#: in tens of pixels, so anything past this is detail the geometry stage throws away. The
#: cap also makes the tuning parameters mean the same thing across plans of different
#: resolutions, which they did not before.
MAX_LONG_EDGE = 2000


def decode_image(data: bytes) -> np.ndarray:
    """Decode uploaded bytes to BGR, downscaled if very large.

    Raises ValueError on anything unreadable.
    """
    array = np.frombuffer(data, dtype=np.uint8)
    image = cv2.imdecode(array, cv2.IMREAD_COLOR)
    if image is None:
        raise ValueError("Could not decode image. Supported formats: PNG, JPG, JPEG.")
    if image.shape[0] < 64 or image.shape[1] < 64:
        raise ValueError("Image is too small to contain a readable floor plan.")

    long_edge = max(image.shape[0], image.shape[1])
    if long_edge > MAX_LONG_EDGE:
        scale = MAX_LONG_EDGE / long_edge
        # INTER_AREA is the right filter for shrinking: it averages the pixels being
        # merged rather than sampling one of them, so thin walls survive as thin walls
        # instead of dropping out between samples.
        image = cv2.resize(image, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
    return image


def parse_layout(
    data: bytes,
    *,
    venue_name: str = "Uploaded Venue",
    metres_per_px: float | None = None,
    use_vlm: bool = True,
    tuning: "RoomTuning | None" = None,
) -> ParseResponse:
    """Run the full pipeline on one uploaded image.

    ``tuning`` selects how the walkable mask is built:

    * ``None`` — the open-venue reading. Every light region is floor. Right for an
      arena or an exhibition hall, where the halls *are* the circulation.
    * a ``RoomTuning`` — the room-aware reading. Enclosed rooms are separated from
      circulation and small ones are carved out, so the skeleton follows corridors
      instead of cutting diagonals through bedrooms. Right for any building plan with
      rooms in it.

    The distinction is not cosmetic: on an apartment floor the open reading treats the
    whole slab as one blob and produces corridors through the bedrooms.
    """
    timings: dict[str, float] = {}
    layout_id = uuid.uuid4().hex[:12]

    with _PARSE_LOCK:
        # --- decode + normalise ------------------------------------------------
        t0 = time.perf_counter()
        image_bgr = decode_image(data)
        image_bgr, canvas, _scale = geometry.normalise(image_bgr)
        timings["normalise_ms"] = round((time.perf_counter() - t0) * 1000, 1)

        # --- read what is printed on the plan ----------------------------------
        #
        # Runs before the VLM, and usually instead of it. A floor plan states what its
        # rooms are in plain text; reading that is both cheaper and more reliable than
        # asking a vision model to infer it. The VLM stays for plans whose meaning is
        # genuinely pictorial, or where OCR finds nothing.
        t0 = time.perf_counter()
        ocr_labels = ocr.read_labels(image_bgr)
        ocr_rooms: list = []
        if ocr_labels:
            ocr_rooms, _ocr_walls = rooms_mod.detect_rooms(image_bgr, tuning)
        ocr_semantic = ocr.semantic_from_labels(ocr_labels, ocr_rooms, canvas)
        timings["ocr_ms"] = round((time.perf_counter() - t0) * 1000, 1)

        # --- semantic understanding (VRAM window opens and closes here) --------
        #
        # Skipped entirely when OCR already named the plan. Loading a 2.2GB vision model
        # to re-guess words that were printed in the image, and read correctly a moment
        # ago, is pure cost — and its guesses are less reliable than the text itself.
        t0 = time.perf_counter()
        if vlm_hosted.configured() and not ocr_semantic.zones:
            # A hosted model first, when one is configured. It costs this process no
            # memory, which is the only reason semantics are possible at all on a small
            # container - the local VLM needs gigabytes and OCR alone does not fit either.
            #
            # This matters beyond naming: build_walkable_mask takes the semantic layout as
            # an input, so knowing which regions are halls and which are rooms changes
            # where corridors are traced, not just what they are called.
            ok, buf = cv2.imencode(".png", image_bgr)
            semantic = (vlm_hosted.describe(buf.tobytes(), canvas) if ok
                        else SemanticLayout(canvas=canvas, degraded=True))
            vlm_used = not semantic.degraded
            vlm_model = vlm_hosted.MODEL if vlm_used else None
        elif use_vlm and not ocr_semantic.zones:
            rgb = cv2.cvtColor(image_bgr, cv2.COLOR_BGR2RGB)
            with VlmSession() as vlm:
                semantic = vlm.describe(rgb, canvas)
                vlm_used = vlm.loaded
                vlm_model = vlm.model_id if vlm.loaded else None
            del rgb
        elif ocr_semantic.zones:
            semantic = ocr_semantic
            vlm_used, vlm_model = False, None
        else:
            semantic = SemanticLayout(canvas=canvas, degraded=True)
            vlm_used, vlm_model = False, None
        timings["vlm_ms"] = round((time.perf_counter() - t0) * 1000, 1)

        # --- geometry (CPU only, VLM is gone) ----------------------------------
        t0 = time.perf_counter()
        if tuning is None:
            mask = geometry.build_walkable_mask(image_bgr, semantic)
            room_summary = None
        else:
            found, walls = rooms_mod.detect_rooms(image_bgr, tuning)
            mask, _rooms_mask = rooms_mod.build_circulation_mask(
                image_bgr, found, walls, tuning
            )
            mask = rooms_mod.keep_main_network(mask, found)
            room_summary = rooms_mod.describe(found)
        walk_fraction = geometry.walkable_ratio(mask)
        dist = geometry.distance_field(mask)
        timings["geometry_ms"] = round((time.perf_counter() - t0) * 1000, 1)

        # --- skeleton ----------------------------------------------------------
        t0 = time.perf_counter()
        skel = graph_mod.skeletonize_mask(mask)
        timings["skeleton_ms"] = round((time.perf_counter() - t0) * 1000, 1)

        # --- graph -------------------------------------------------------------
        t0 = time.perf_counter()
        mpp = metres_per_px or graph_mod.DEFAULT_METRES_PER_PX
        venue, notes = graph_mod.build_graph(
            skel,
            dist,
            semantic,
            venue_id=f"venue-{layout_id}",
            venue_name=venue_name,
            metres_per_px=mpp,
        )
        venue, removed = graph_mod.largest_connected_subgraph(venue)
        if removed:
            notes.append(f"Removed {removed} node(s) not connected to the main floor.")
        timings["graph_ms"] = round((time.perf_counter() - t0) * 1000, 1)

        # --- validate + repair -------------------------------------------------
        t0 = time.perf_counter()
        venue, issues, repairs = validate.validate_and_repair(venue, metres_per_px=mpp)
        timings["validate_ms"] = round((time.perf_counter() - t0) * 1000, 1)

    errors = sum(1 for i in issues if i.severity == "error")
    confidence = validate.confidence_score(
        vlm_used=vlm_used,
        walkable_fraction=walk_fraction,
        node_count=len(venue.nodes),
        error_count=errors,
        repair_count=len(repairs),
    )

    response = ParseResponse(
        layout_id=layout_id,
        venue=venue,
        semantic=semantic,
        metadata=LayoutMetadata(
            confidence=confidence,
            vlm_used=vlm_used,
            vlm_model=vlm_model,
            segmentation_used=False,
            degraded=semantic.degraded,
            canvas=canvas,
            rooms=room_summary,
            timings_ms=timings,
            issues=issues,
            repairs=[*notes, *repairs],
        ),
    )

    CACHE.put(layout_id, response)
    log.info(
        "Parsed layout %s: %d nodes, %d edges, confidence %.2f, vlm=%s, %sms total",
        layout_id,
        len(venue.nodes),
        len(venue.edges),
        confidence,
        vlm_used,
        round(sum(timings.values())),
    )
    return response
