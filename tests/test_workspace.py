import importlib.util
import json
import shutil
import subprocess
import sys
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from scriptgraph.engine import ScriptGraphEngine
from scriptgraph.graph_store import Neo4jGraphStore
from scriptgraph.models import ConsistencyRequest, QueryRequest
from scriptgraph.semantic_index import SemanticIndex
from scriptgraph.workspace import project_workspace

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
METHODS = {"bm25", "dense", "hybrid", "graph"}


@pytest.fixture(scope="module")
def engine():
    with (
        patch.object(Neo4jGraphStore, "from_environment", return_value=None),
        patch.object(SemanticIndex, "from_environment", return_value=None),
    ):
        return ScriptGraphEngine(DATA)


@pytest.fixture(scope="module")
def corpus():
    return json.loads((ROOT / "web" / "src" / "demo-corpus.json").read_text(encoding="utf-8"))


def test_workspace_preserves_source_lines_and_scene_spans(engine):
    for project in engine.projects():
        workspace = project_workspace(engine, project.id)
        assert workspace.lines == (DATA / "scripts" / f"{project.id}.fountain").read_text(
            encoding="utf-8"
        ).splitlines()
        assert len(workspace.scenes) == project.scene_count
        for scene in workspace.scenes:
            assert scene.project_id == project.id
            assert workspace.lines[scene.line_start - 1].strip() == scene.heading
            assert "\n".join(workspace.lines[scene.line_start:scene.line_end]).strip() == scene.text
        assert set(workspace.entities) == {
            entity for scene in workspace.scenes for entity in scene.characters + scene.props
        }


def test_workspace_examples_are_project_questions_from_three_types(engine):
    questions = json.loads((DATA / "ground_truth" / "questions.json").read_text(encoding="utf-8"))
    for project in engine.projects():
        project_questions = {
            question["question"]: question["type"]
            for question in questions
            if question["project_id"] == project.id
        }
        workspace = project_workspace(engine, project.id)
        assert len(workspace.examples) == 3
        assert len({project_questions[question] for question in workspace.examples}) == 3


def test_workspace_visibility_and_unknown_projects(engine):
    for project in engine.projects():
        assert project_workspace(engine, project.id).project.id == project.id
        if project.demo_enabled:
            assert project_workspace(engine, project.id, demo_only=True).project.id == project.id
        else:
            with pytest.raises(LookupError, match="project_not_found"):
                project_workspace(engine, project.id, demo_only=True)
    for unknown in ("missing-project", "../manifest", ""):
        with pytest.raises(LookupError, match="project_not_found"):
            project_workspace(engine, unknown)


def test_workspace_route_returns_404_and_respects_demo_mode(engine, monkeypatch):
    monkeypatch.setenv("SCRIPTGRAPH_DATA_DIR", str(DATA))
    with (
        patch.object(Neo4jGraphStore, "from_environment", return_value=None),
        patch.object(SemanticIndex, "from_environment", return_value=None),
    ):
        import scriptgraph.api as api_module
    monkeypatch.setattr(api_module, "engine", engine)
    monkeypatch.setattr(api_module, "DEMO_MODE", True)
    client = TestClient(api_module.app)
    assert client.get("/api/projects/missing-project/workspace").status_code == 404
    assert client.get("/api/projects/northbound/workspace").status_code == 404
    response = client.get("/api/projects/echo-station/workspace")
    assert response.status_code == 200
    assert response.json() == project_workspace(engine, "echo-station").model_dump(mode="json")
    monkeypatch.setattr(api_module, "DEMO_MODE", False)
    assert client.get("/api/projects/northbound/workspace").status_code == 200


def test_snapshot_contains_only_demo_projects_with_project_scoped_conflicts(engine, corpus):
    assert corpus["schemaVersion"] == 1
    expected_demo_ids = {project.id for project in engine.projects(demo_only=True)}
    assert len(corpus["projects"]) == 2
    assert {row["workspace"]["project"]["id"] for row in corpus["projects"]} == expected_demo_ids
    assert corpus["knownProjectIds"] == [project.id for project in engine.projects()]
    assert corpus["knownProjectTitles"] == [project.title for project in engine.projects()]
    assert set(corpus["knownEntities"]) == {
        entity
        for project in engine.projects()
        for entity in project_workspace(engine, project.id).entities
    }
    for row in corpus["projects"]:
        project_id = row["workspace"]["project"]["id"]
        workspace = project_workspace(engine, project_id)
        assert row["workspace"] == workspace.model_dump(mode="json")
        scene_ids = {scene.id for scene in workspace.scenes}
        conflicts = engine.consistency(ConsistencyRequest(project_id=project_id)).conflicts
        assert row["conflicts"] == [conflict.model_dump(mode="json") for conflict in conflicts]
        assert row["conflicts"]
        for conflict in row["conflicts"]:
            assert set(conflict["scene_ids"]) <= scene_ids


def test_all_precomputed_questions_match_real_engine_and_reference_current_project(engine, corpus):
    questions = json.loads((DATA / "ground_truth" / "questions.json").read_text(encoding="utf-8"))
    for row in corpus["projects"]:
        workspace = row["workspace"]
        project_id = workspace["project"]["id"]
        question_texts = {
            question["question"] for question in questions if question["project_id"] == project_id
        }
        assert len(row["queries"]) == 45 * 4
        assert {(item["question"], item["method"]) for item in row["queries"]} == {
            (question, method) for question in question_texts for method in METHODS
        }
        scenes = {scene["id"]: scene for scene in workspace["scenes"]}
        for item in row["queries"]:
            result = item["result"]
            assert result["execution"] == "snapshot"
            assert result["elapsed_ms"] == 0
            assert result["request_id"].startswith("snapshot-")
            actual = engine.query(
                QueryRequest(project_id=project_id, question=item["question"], method=item["method"])
            ).model_dump(mode="json")
            for field in ("answer", "confidence", "retrieval_path", "error_type"):
                assert result[field] == actual[field]
            # Existing graph reasons come from a set; their order can differ across processes.
            assert [
                {**evidence, "reasons": sorted(evidence["reasons"])}
                for evidence in result["evidences"]
            ] == [
                {**evidence, "reasons": sorted(evidence["reasons"])}
                for evidence in actual["evidences"]
            ]
            for evidence in result["evidences"]:
                assert evidence["reasons"] == sorted(evidence["reasons"])
                scene = scenes[evidence["scene_id"]]
                assert evidence["heading"] == scene["heading"]
                assert evidence["line_start"] == scene["line_start"]
                assert evidence["line_end"] == scene["line_end"]
                assert evidence["excerpt"] == " ".join(scene["text"].split())[:260]


def test_export_does_not_initialize_external_graph_or_embedding_clients():
    spec = importlib.util.spec_from_file_location("export_demo", ROOT / "scripts" / "export_demo.py")
    assert spec is not None and spec.loader is not None
    exporter = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(exporter)
    with (
        patch.object(Neo4jGraphStore, "from_environment", side_effect=AssertionError("external graph")),
        patch.object(SemanticIndex, "from_environment", side_effect=AssertionError("external model")),
    ):
        exported = exporter.build_demo_corpus(DATA)
    assert len(exported["projects"]) == 2
    assert sum(len(row["queries"]) for row in exported["projects"]) == 360


def test_repeated_exports_are_identical_and_check_rejects_changed_source_without_writing(tmp_path):
    data_dir = tmp_path / "data"
    shutil.copytree(DATA, data_dir)
    output = tmp_path / "demo-corpus.json"
    repeated = tmp_path / "repeated.json"
    command = [sys.executable, "-B", str(ROOT / "scripts" / "export_demo.py"), "--data", str(data_dir)]

    def run_export(target, *, check=False):
        return subprocess.run(
            [*command, "--output", str(target), *(["--check"] if check else [])],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,
        )

    first = run_export(output)
    second = run_export(repeated)
    assert first.returncode == 0, first.stderr
    assert second.returncode == 0, second.stderr
    original = output.read_bytes()
    assert original == repeated.read_bytes()

    current = run_export(output, check=True)
    assert current.returncode == 0, current.stderr
    assert output.read_bytes() == original
    source_path = data_dir / "scripts" / "echo-station.fountain"
    source_path.write_text(
        source_path.read_text(encoding="utf-8") + "\n原文新增一句，用于验证快照过期。\n",
        encoding="utf-8",
    )
    stale = run_export(output, check=True)
    assert stale.returncode != 0
    assert "Re-export" in stale.stderr
    assert output.read_bytes() == original


def test_workspace_api_runs_with_only_src_and_data_copied(tmp_path):
    shutil.copytree(ROOT / "src", tmp_path / "src", ignore=shutil.ignore_patterns("__pycache__"))
    shutil.copytree(DATA, tmp_path / "data")
    program = """
import os
import sys
from pathlib import Path
from unittest.mock import patch
sys.path.insert(0, str(Path.cwd() / 'src'))
os.environ['SCRIPTGRAPH_DATA_DIR'] = str(Path.cwd() / 'data')
os.environ['SCRIPTGRAPH_DEMO_MODE'] = 'true'
from scriptgraph.graph_store import Neo4jGraphStore
from scriptgraph.semantic_index import SemanticIndex
with patch.object(Neo4jGraphStore, 'from_environment', return_value=None), \\
     patch.object(SemanticIndex, 'from_environment', return_value=None):
    import scriptgraph.api as api_module
from fastapi.testclient import TestClient
assert Path(api_module.__file__).resolve().is_relative_to(Path.cwd())
response = TestClient(api_module.app).get('/api/projects/echo-station/workspace')
assert response.status_code == 200, response.text
assert response.json()['project']['id'] == 'echo-station'
assert response.json()['scenes']
assert response.json()['lines']
"""
    result = subprocess.run(
        [sys.executable, "-B", "-c", program],
        cwd=tmp_path,
        capture_output=True,
        text=True,
        timeout=60,
        check=False,
    )
    assert result.returncode == 0, result.stderr
