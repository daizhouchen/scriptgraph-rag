"""Export the public demo from real Fountain sources and Python engine results.

Run from the repository: python scripts/export_demo.py
Verify without writing: python scripts/export_demo.py --check
The exporter always uses the in-memory graph and character n-gram backend.
"""
from __future__ import annotations

import argparse
import json
import sys
import uuid
from pathlib import Path
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from scriptgraph.engine import ScriptGraphEngine
from scriptgraph.graph_store import Neo4jGraphStore
from scriptgraph.models import ConsistencyRequest, QueryRequest
from scriptgraph.semantic_index import SemanticIndex
from scriptgraph.workspace import project_workspace

METHODS = ("bm25", "dense", "hybrid", "graph")


def build_demo_corpus(data_dir: Path) -> dict:
    # Never initialize external clients or model downloads from ambient configuration.
    with (
        patch.object(Neo4jGraphStore, "from_environment", return_value=None),
        patch.object(SemanticIndex, "from_environment", return_value=None),
    ):
        engine = ScriptGraphEngine(data_dir)

    questions = json.loads((data_dir / "ground_truth" / "questions.json").read_text(encoding="utf-8"))
    workspaces = [project_workspace(engine, project.id) for project in engine.projects()]
    projects = []
    for workspace in workspaces:
        if not workspace.project.demo_enabled:
            continue
        project_id = workspace.project.id
        queries = []
        for question in questions:
            if question["project_id"] != project_id:
                continue
            for method in METHODS:
                result = engine.query(
                    QueryRequest(
                        project_id=project_id, question=question["question"], method=method, top_k=5
                    )
                ).model_dump(mode="json")
                result["request_id"] = "snapshot-" + str(
                    uuid.uuid5(uuid.NAMESPACE_URL, f"scriptgraph:{project_id}:{method}:{question['id']}")
                )
                result["execution"] = "snapshot"
                # Snapshots have no current request latency; retain reproducible content only.
                result["elapsed_ms"] = 0
                for evidence in result["evidences"]:
                    evidence["reasons"] = sorted(evidence["reasons"])
                queries.append({"question": question["question"], "method": method, "result": result})
        conflicts = engine.consistency(ConsistencyRequest(project_id=project_id)).conflicts
        projects.append(
            {
                "workspace": workspace.model_dump(mode="json"),
                "conflicts": [conflict.model_dump(mode="json") for conflict in conflicts],
                "queries": queries,
            }
        )
    return {
        "schemaVersion": 1,
        "projects": projects,
        "knownProjectIds": [workspace.project.id for workspace in workspaces],
        "knownProjectTitles": [workspace.project.title for workspace in workspaces],
        "knownEntities": sorted({entity for workspace in workspaces for entity in workspace.entities}),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", type=Path, default=ROOT / "data")
    parser.add_argument("--output", type=Path, default=ROOT / "web" / "src" / "demo-corpus.json")
    parser.add_argument("--check", action="store_true", help="Verify snapshot freshness without writing")
    args = parser.parse_args()
    corpus = build_demo_corpus(args.data)
    if args.check:
        try:
            saved = json.loads(args.output.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            saved = None
        if saved != corpus:
            print(
                "Demo snapshot is stale, missing, or invalid. "
                "Re-export with python scripts/export_demo.py before running --check "
                "(reuse --data and --output for custom paths).",
                file=sys.stderr,
            )
            return 1
        print(f"Demo snapshot is current: {args.output}")
        return 0
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(corpus, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(
        f"Exported {len(corpus['projects'])} demo projects and "
        f"{sum(len(project['queries']) for project in corpus['projects'])} query snapshots "
        f"to {args.output}"
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
