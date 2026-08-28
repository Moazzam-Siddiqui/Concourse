"""Schemas for the layout → graph pipeline.

Two distinct shapes live here and it matters which is which:

* ``SemanticLayout`` — what the VLM returns. Approximate, hint-quality, never trusted
  for geometry. Coordinates here are suggestions the CV stage validates or discards.
* ``VenueGraph`` — the canonical output. Field names deliberately match
  ``com.concourse.model.VenueNode`` / ``VenueEdge`` so Spring's existing Jackson
  binding and ``VenueValidator`` accept it with no adapter in between.

If you change a field name in ``GraphNode``/``GraphEdge``, you have broken the Spring
contract. Check ``backend/src/main/java/com/concourse/model/`` before editing.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field


# --------------------------------------------------------------------------- #
#  Semantic layer — the VLM's output. Hints only.                             #
# --------------------------------------------------------------------------- #

class ZoneKind(str, Enum):
    """Semantic categories the VLM may assign.

    Broader than ``VenueNode.Type`` on purpose: the VLM is better at naming what it
    sees ("food court", "stage") than at forcing it into the simulation's five slots.
    ``ZONE_KIND_TO_NODE_TYPE`` does that mapping in one auditable place.
    """

    ENTRANCE = "entrance"
    EXIT = "exit"
    CORRIDOR = "corridor"
    HALL = "hall"
    ROOM = "room"
    FOOD_COURT = "food_court"
    RETAIL = "retail"
    SEATING = "seating"
    STAGE = "stage"
    RESTRICTED = "restricted"
    OBSTACLE = "obstacle"
    OPEN_AREA = "open_area"
    UNKNOWN = "unknown"


#: Semantic kind → the simulation's node type. Anything not listed is transit.
ZONE_KIND_TO_NODE_TYPE: dict[ZoneKind, str] = {
    ZoneKind.ENTRANCE: "GATE",
    ZoneKind.EXIT: "EXIT",
    ZoneKind.FOOD_COURT: "CONCESSION",
    ZoneKind.RETAIL: "CONCESSION",
    ZoneKind.SEATING: "SEATING",
    ZoneKind.HALL: "SEATING",
    ZoneKind.ROOM: "SEATING",
    ZoneKind.CORRIDOR: "WALKWAY",
    ZoneKind.OPEN_AREA: "WALKWAY",
    ZoneKind.STAGE: "SEATING",
    ZoneKind.UNKNOWN: "WALKWAY",
}

#: Kinds that carve holes in the walkable mask instead of becoming nodes.
NON_WALKABLE_KINDS: frozenset[ZoneKind] = frozenset(
    {ZoneKind.OBSTACLE, ZoneKind.RESTRICTED, ZoneKind.STAGE}
)

#: Default people-per-zone when the layout gives us nothing to size from.
#: Deliberately conservative — an over-large capacity hides congestion in the sim.
DEFAULT_CAPACITY: dict[str, int] = {
    "GATE": 300,
    "EXIT": 350,
    "WALKWAY": 450,
    "CONCESSION": 150,
    "SEATING": 800,
}


class Canvas(BaseModel):
    """Pixel dimensions of the normalised image the VLM was shown."""

    width: int = Field(..., gt=0)
    height: int = Field(..., gt=0)


class SemanticPoint(BaseModel):
    id: str
    location: tuple[float, float]
    label: str | None = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)


class SemanticZone(BaseModel):
    """A rectangular region the VLM believes it recognised.

    ``bbox`` is ``[x_min, y_min, x_max, y_max]`` in canvas pixels. Treated as a search
    hint: the CV stage looks for real structure inside it and will move, shrink or drop
    it. A zone the geometry cannot corroborate does not reach the graph.
    """

    id: str
    type: ZoneKind = ZoneKind.UNKNOWN
    bbox: tuple[float, float, float, float]
    label: str | None = None
    confidence: float = Field(default=0.5, ge=0.0, le=1.0)

    def centre(self) -> tuple[float, float]:
        x0, y0, x1, y1 = self.bbox
        return ((x0 + x1) / 2.0, (y0 + y1) / 2.0)

    def area(self) -> float:
        x0, y0, x1, y1 = self.bbox
        return max(0.0, x1 - x0) * max(0.0, y1 - y0)


class SemanticLayout(BaseModel):
    """Everything the VLM understood, before any geometry is trusted."""

    venue_type: str = "unknown"
    canvas: Canvas
    entrances: list[SemanticPoint] = Field(default_factory=list)
    exits: list[SemanticPoint] = Field(default_factory=list)
    zones: list[SemanticZone] = Field(default_factory=list)
    obstacles: list[SemanticZone] = Field(default_factory=list)
    notes: str | None = None

    #: True when this came from the deterministic fallback, not a model. Surfaced to
    #: the UI so an operator knows to check the map rather than trust it.
    degraded: bool = False


# --------------------------------------------------------------------------- #
#  Graph layer — canonical. Must stay Spring-compatible.                      #
# --------------------------------------------------------------------------- #

NodeType = Literal["GATE", "WALKWAY", "CONCESSION", "SEATING", "EXIT"]


class GraphNode(BaseModel):
    """Mirrors ``com.concourse.model.VenueNode``."""

    id: str
    name: str
    type: NodeType
    capacity: int = Field(..., ge=1)
    x: float
    y: float


class GraphEdge(BaseModel):
    """Mirrors ``com.concourse.model.VenueEdge``.

    ``length`` is the Dijkstra weight and ``width`` caps throughput per tick, so both
    must be positive — a zero-length edge makes every route through it free.
    """

    from_: str = Field(..., alias="from")
    to: str
    length: float = Field(..., gt=0)
    width: float = Field(..., gt=0)
    bidirectional: bool = True

    model_config = {"populate_by_name": True}


class ValidationIssue(BaseModel):
    severity: Literal["error", "warning"]
    code: str
    message: str
    node_ids: list[str] = Field(default_factory=list)


class LayoutMetadata(BaseModel):
    confidence: float = Field(..., ge=0.0, le=1.0)
    vlm_used: bool
    vlm_model: str | None = None
    segmentation_used: bool = False
    degraded: bool = False
    canvas: Canvas
    timings_ms: dict[str, float] = Field(default_factory=dict)
    issues: list[ValidationIssue] = Field(default_factory=list)
    repairs: list[str] = Field(default_factory=list)
    #: Room/circulation counts when the plan was parsed room-aware; ``None`` when it
    #: was read as an open venue. Lets the UI say which reading produced this graph,
    #: which is the first thing to check when the roads look wrong.
    rooms: dict | None = None


class VenueGraph(BaseModel):
    """The source of truth. Everything downstream reads this, not the image."""

    id: str
    name: str
    nodes: list[GraphNode]
    edges: list[GraphEdge]

    def to_spring_payload(self) -> dict:
        """Serialise exactly as Spring's ``Venue`` record expects (``from``, not ``from_``)."""
        return self.model_dump(by_alias=True)


class ParseResponse(BaseModel):
    layout_id: str
    venue: VenueGraph
    semantic: SemanticLayout
    metadata: LayoutMetadata
