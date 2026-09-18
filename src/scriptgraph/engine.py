from __future__ import annotations

import hashlib
import json
import time
import uuid
from pathlib import Path

from .consistency import detect_conflicts
from .graph_store import Neo4jGraphStore
from .models import (
    Conflict,
    ConsistencyRequest,
    ConsistencyResponse,
    ImpactItem,
    ImpactRequest,
    ImpactResponse,
    Project,
    QueryRequest,
    QueryResponse,
)
from .parser import parse_fountain
from .retrieval import Retriever
from .semantic_index import SemanticIndex


class ScriptGraphEngine:
    def __init__(self, data_dir: Path):
        self.data_dir = data_dir
        self._projects: dict[str, Project] = {}
        self._scenes = {}
        self._retrievers = {}
        self._conflicts: dict[str, list[Conflict]] = {}
        self._semantic_indexes: dict[str, SemanticIndex] = {}
        self.graph_store = Neo4jGraphStore.from_environment()
        self._load()

    def _load(self) -> None:
        manifest_path = self.data_dir / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        for row in manifest["projects"]:
            path = self.data_dir / "scripts" / f"{row['id']}.fountain"
            scenes = parse_fountain(path, row["id"])
            project = Project(
                id=row["id"],
                title=row["title"],
                logline=row["logline"],
                versions=["v1"],
                scene_count=len(scenes),
                character_count=len({c for scene in scenes for c in scene.characters}),
                demo_enabled=row.get("demo_enabled", True),
            )
            self._projects[project.id] = project
            self._scenes[project.id] = scenes
            if self.graph_store:
                self.graph_store.sync_project(project.id, project.title, scenes)
            semantic_index = SemanticIndex.from_environment(scenes)
            if semantic_index:
                self._semantic_indexes[project.id] = semantic_index
            neighbor_provider = (
                lambda seeds, project_id=project.id: self.graph_store.related_scene_ids(
                    project_id, seeds
                )
                if self.graph_store
                else []
            )
            self._retrievers[project.id] = Retriever(
                scenes,
                graph_neighbor_ids=neighbor_provider if self.graph_store else None,
                dense_score_provider=semantic_index.scores if semantic_index else None,
            )
            self._conflicts[project.id] = detect_conflicts(scenes)

    @property
    def corpus_hash(self) -> str:
        payload = "|".join(f"{p.id}:{p.scene_count}" for p in self._projects.values())
        return hashlib.sha256(payload.encode()).hexdigest()[:12]

    def projects(self, demo_only: bool = False) -> list[Project]:
        values = list(self._projects.values())
        return [p for p in values if p.demo_enabled] if demo_only else values

    @property
    def graph_backend(self) -> str:
        return "neo4j" if self.graph_store else "in_memory_snapshot"

    @property
    def vector_backend(self) -> str:
        return "faiss_sentence_transformers" if self._semantic_indexes else "char_ngram"

    def query(self, request: QueryRequest) -> QueryResponse:
        started = time.perf_counter()
        if request.project_id not in self._projects:
            return QueryResponse(
                request_id=str(uuid.uuid4()), elapsed_ms=0, error_type="project_not_found",
                answer="未找到该项目。", confidence="insufficient", evidences=[], retrieval_path=[]
            )
        retriever = self._retrievers[request.project_id]
        ranked = retriever.rank(
            request.question, request.method, request.top_k
        )
        evidences = [Retriever.to_evidence(item) for item in ranked if item.score > 0.06]
        if retriever.has_unknown_identifier(request.question) or not evidences or evidences[0].score < 0.12:
            answer = "现有剧本证据不足，无法可靠回答。"
            confidence = "insufficient"
            evidences = []
        else:
            refs = "、".join(f"第{item.scene_number}场" for item in evidences[:2])
            answer = f"根据{refs}，最相关的原文证据如下；请结合引用场次复核：{evidences[0].excerpt}"
            confidence = "high" if evidences[0].score >= 0.55 else "medium"
        elapsed = (time.perf_counter() - started) * 1000
        return QueryResponse(
            request_id=str(uuid.uuid4()),
            elapsed_ms=round(elapsed, 2),
            answer=answer,
            confidence=confidence,
            evidences=evidences,
            retrieval_path=[request.method, "evidence_gate", "extractive_answer"],
        )

    def consistency(self, request: ConsistencyRequest) -> ConsistencyResponse:
        started = time.perf_counter()
        conflicts = self._conflicts.get(request.project_id, [])
        if request.categories:
            conflicts = [item for item in conflicts if item.category in request.categories]
        return ConsistencyResponse(
            request_id=str(uuid.uuid4()),
            elapsed_ms=round((time.perf_counter() - started) * 1000, 2),
            error_type=None if request.project_id in self._projects else "project_not_found",
            conflicts=conflicts,
        )

    def impact(self, request: ImpactRequest) -> ImpactResponse:
        started = time.perf_counter()
        impacts = []
        if self.graph_store and request.project_id in self._projects:
            impacts = [
                ImpactItem(
                    scene_id=item.scene_id,
                    scene_number=item.scene_number,
                    heading=item.heading,
                    path=item.path,
                    reason=f"图谱路径包含“{request.entity}”，需复核变更“{request.change}”。",
                )
                for item in self.graph_store.impact(request.project_id, request.entity)
            ]
        entity = request.entity.lower()
        for scene in self._scenes.get(request.project_id, []) if not impacts else []:
            document = " ".join([scene.heading, scene.text, *scene.characters, *scene.props, *scene.events])
            if entity in document.lower():
                impacts.append(
                    ImpactItem(
                        scene_id=scene.id,
                        scene_number=scene.number,
                        heading=scene.heading,
                        path=[request.entity, "被提及或参与", scene.id],
                        reason=f"该场包含“{request.entity}”，需要复核变更“{request.change}”的影响。",
                    )
                )
        return ImpactResponse(
            request_id=str(uuid.uuid4()),
            elapsed_ms=round((time.perf_counter() - started) * 1000, 2),
            entity=request.entity,
            impacts=impacts,
            error_type=None if request.project_id in self._projects else "project_not_found",
        )
