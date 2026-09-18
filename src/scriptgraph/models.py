from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class ReviewStatus(str, Enum):
    PENDING = "pending"
    CONFIRMED = "confirmed"
    REJECTED = "rejected"


class Scene(BaseModel):
    id: str
    project_id: str
    version: str = "v1"
    number: int
    heading: str
    location: str
    time_of_day: str
    text: str
    characters: list[str] = Field(default_factory=list)
    props: list[str] = Field(default_factory=list)
    events: list[str] = Field(default_factory=list)
    facts: list[str] = Field(default_factory=list)
    line_start: int
    line_end: int
    review_status: ReviewStatus = ReviewStatus.CONFIRMED


class Project(BaseModel):
    id: str
    title: str
    logline: str
    versions: list[str]
    scene_count: int
    character_count: int
    demo_enabled: bool = True


class Evidence(BaseModel):
    scene_id: str
    scene_number: int
    heading: str
    excerpt: str
    score: float
    reasons: list[str]
    line_start: int
    line_end: int


class QueryRequest(BaseModel):
    project_id: str
    version: str = "v1"
    question: str = Field(min_length=2, max_length=300)
    method: Literal["bm25", "dense", "hybrid", "graph"] = "graph"
    top_k: int = Field(default=5, ge=1, le=10)


class QueryResponse(BaseModel):
    request_id: str
    elapsed_ms: float
    error_type: str | None = None
    answer: str
    confidence: Literal["high", "medium", "insufficient"]
    evidences: list[Evidence]
    retrieval_path: list[str]


class ConsistencyRequest(BaseModel):
    project_id: str
    version: str = "v1"
    categories: list[str] = Field(default_factory=list)


class Conflict(BaseModel):
    id: str
    category: Literal["alias", "knowledge", "prop", "timeline"]
    summary: str
    scene_ids: list[str]
    evidence: list[str]
    review_status: ReviewStatus = ReviewStatus.PENDING


class ConsistencyResponse(BaseModel):
    request_id: str
    elapsed_ms: float
    error_type: str | None = None
    conflicts: list[Conflict]


class ImpactRequest(BaseModel):
    project_id: str
    version: str = "v1"
    entity: str = Field(min_length=1, max_length=80)
    change: str = Field(min_length=2, max_length=300)


class ImpactItem(BaseModel):
    scene_id: str
    scene_number: int
    heading: str
    path: list[str]
    reason: str


class ImpactResponse(BaseModel):
    request_id: str
    elapsed_ms: float
    error_type: str | None = None
    entity: str
    impacts: list[ImpactItem]


class HealthResponse(BaseModel):
    status: str
    mode: str
    corpus_hash: str
    details: dict[str, Any] = Field(default_factory=dict)

