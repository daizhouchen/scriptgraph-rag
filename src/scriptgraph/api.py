from __future__ import annotations

import os
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from .engine import ScriptGraphEngine
from .models import (
    ConsistencyRequest,
    ConsistencyResponse,
    HealthResponse,
    ImpactRequest,
    ImpactResponse,
    Project,
    QueryRequest,
    QueryResponse,
)
from .workspace import Workspace, project_workspace

ROOT = Path(__file__).resolve().parents[2]


def runtime_path(name: str) -> Path:
    source_path = ROOT / name
    working_path = Path.cwd() / name
    return source_path if source_path.exists() else working_path


DATA_DIR = Path(os.getenv("SCRIPTGRAPH_DATA_DIR", runtime_path("data")))
DEMO_MODE = os.getenv("SCRIPTGRAPH_DEMO_MODE", "true").lower() == "true"

app = FastAPI(
    title="ScriptGraph API",
    version="0.1.0",
    description="Evidence-grounded screenplay GraphRAG and continuity API",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=os.getenv("SCRIPTGRAPH_CORS", "http://localhost:5173").split(","),
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)
engine = ScriptGraphEngine(DATA_DIR)


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(
        status="ok",
        mode="demo" if DEMO_MODE else "local",
        corpus_hash=engine.corpus_hash,
        details={"graph_backend": engine.graph_backend, "vector_backend": engine.vector_backend},
    )


@app.get("/api/projects", response_model=list[Project])
def projects() -> list[Project]:
    return engine.projects(demo_only=DEMO_MODE)


@app.get("/api/projects/{project_id}/workspace", response_model=Workspace)
def workspace(project_id: str) -> Workspace:
    try:
        return project_workspace(engine, project_id, demo_only=DEMO_MODE)
    except LookupError as error:
        raise HTTPException(status_code=404, detail="project_not_found") from error


@app.post("/api/query", response_model=QueryResponse)
def query(request: QueryRequest) -> QueryResponse:
    return engine.query(request)


@app.post("/api/consistency/check", response_model=ConsistencyResponse)
def consistency(request: ConsistencyRequest) -> ConsistencyResponse:
    return engine.consistency(request)


@app.post("/api/impact", response_model=ImpactResponse)
def impact(request: ImpactRequest) -> ImpactResponse:
    return engine.impact(request)


STATIC_DIR = runtime_path("static")
if STATIC_DIR.exists():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="static")
