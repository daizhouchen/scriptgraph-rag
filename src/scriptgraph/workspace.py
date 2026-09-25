"""Source-backed screenplay workspaces for the local API and static demo export."""
from __future__ import annotations

import hashlib
import json

from pydantic import BaseModel

from .engine import ScriptGraphEngine
from .models import Project, Scene


class Workspace(BaseModel):
    project: Project
    scenes: list[Scene]
    lines: list[str]
    examples: list[str]
    entities: list[str]
    corpus_hash: str


def project_workspace(
    engine: ScriptGraphEngine, project_id: str, *, demo_only: bool = False
) -> Workspace:
    """Resolve only loaded, visible projects before reading their source file."""
    project = next(
        (item for item in engine.projects(demo_only=demo_only) if item.id == project_id), None
    )
    if project is None:
        raise LookupError("project_not_found")

    source = (engine.data_dir / "scripts" / f"{project.id}.fountain").read_text(encoding="utf-8")
    scenes = engine._scenes[project.id]
    questions_path = engine.data_dir / "ground_truth" / "questions.json"
    questions = json.loads(questions_path.read_text(encoding="utf-8")) if questions_path.exists() else []
    representatives: dict[str, str] = {}
    for question in questions:
        if question["project_id"] == project.id:
            representatives.setdefault(question["type"], question["question"])

    return Workspace(
        project=project,
        scenes=scenes,
        lines=source.splitlines(),
        examples=list(representatives.values())[:3],
        entities=sorted({entity for scene in scenes for entity in scene.characters + scene.props}),
        corpus_hash=hashlib.sha256(source.encode("utf-8")).hexdigest()[:16],
    )
