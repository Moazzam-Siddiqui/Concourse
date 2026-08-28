"""Request/response models for POST /analyze.

Mirrors the Java records in backend/src/main/java/com/concourse/dto/AnalyzeRequest.java and
AnalyzeResponse.java. If you change a field name here, change it there — nothing checks.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, field_validator

Trend = Literal["RISING", "FLAT", "FALLING"]
Status = Literal["ok", "partial", "failed"]

# Numeric encoding fed to the GNN. Must match ml/data/generate_synthetic_runs.py.
TREND_ENCODING: dict[str, float] = {"FALLING": -1.0, "FLAT": 0.0, "RISING": 1.0}


# --------------------------------------------------------------------------- request


class GraphNode(BaseModel):
    id: str
    name: str = ""
    type: str = "WALKWAY"
    capacity: int = Field(gt=0)
    x: float = 0.0
    y: float = 0.0


class GraphEdge(BaseModel):
    source: str
    target: str
    length: float = Field(default=1.0, gt=0)
    width: float = Field(default=1.0, gt=0)


class Graph(BaseModel):
    nodes: list[GraphNode] = Field(min_length=1)
    edges: list[GraphEdge] = Field(default_factory=list)


class HistoryFrame(BaseModel):
    tick: int
    density: dict[str, float] = Field(default_factory=dict)


class AnalyzeContext(BaseModel):
    """Everything true of the run but not of the graph — what the LLM needs to write advice."""

    venueName: str = ""
    tickSeconds: float = 1.0
    crowdSize: int = 0
    peopleInside: int = 0
    pendingArrivals: int = 0
    status: str = "RUNNING"
    rerouteEnabled: bool = True
    trends: dict[str, Trend] = Field(default_factory=dict)
    highRiskNodeIds: list[str] = Field(default_factory=list)


class AnalyzeRequest(BaseModel):
    sessionId: str
    tick: int = Field(ge=0)
    graph: Graph
    density: dict[str, float] = Field(default_factory=dict)
    history: list[HistoryFrame] = Field(default_factory=list)
    context: AnalyzeContext = Field(default_factory=AnalyzeContext)

    @field_validator("density")
    @classmethod
    def densities_are_not_negative(cls, value: dict[str, float]) -> dict[str, float]:
        # Density may exceed 1.0 — a node past capacity is the interesting case, not an error.
        # Below zero is nonsense and means the caller has a bug worth surfacing.
        negative = sorted(k for k, v in value.items() if v < 0)
        if negative:
            raise ValueError(f"negative density for: {', '.join(negative)}")
        return value


# --------------------------------------------------------------------------- response


class Prediction(BaseModel):
    nodeId: str
    risk: float = Field(ge=0.0, le=1.0, description="predicted congestion risk, horizonTicks ahead")
    horizonTicks: int


class Advisory(BaseModel):
    headline: str
    message: str
    actions: list[str] = Field(default_factory=list)


class AnalyzeError(BaseModel):
    stage: Literal["gnn", "llm", "preprocessing"]
    detail: str


class ModelInfo(BaseModel):
    gnn: str | None = None
    llm: str | None = None


class AnalyzeResponse(BaseModel):
    """
    `status` is the contract that lets Spring degrade instead of breaking:

    - `ok`      — both Hugging Face calls answered.
    - `partial` — one did. The other key is empty and `errors` says which. Spring keeps the
                  half it got: raw risk with no prose, or prose with no risk.
    - `failed`  — neither. Returned with HTTP 502 so Spring's own fallback kicks in and the
                  session carries on showing measured density.
    """

    status: Status
    predictions: list[Prediction] = Field(default_factory=list)
    advisory: Advisory | None = None
    errors: list[AnalyzeError] = Field(default_factory=list)
    modelInfo: ModelInfo = Field(default_factory=ModelInfo)
