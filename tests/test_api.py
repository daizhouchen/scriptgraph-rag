from fastapi.testclient import TestClient

from scriptgraph.api import app

client = TestClient(app)


def test_health_and_projects():
    health = client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["status"] == "ok"
    projects = client.get("/api/projects")
    assert projects.status_code == 200
    assert len(projects.json()) == 2


def test_query_returns_traceable_evidence():
    response = client.post(
        "/api/query",
        json={"project_id": "echo-station", "question": "线索ECHO-STATION-01在哪里？", "method": "graph"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["request_id"]
    assert body["evidences"]
    assert body["evidences"][0]["line_start"] > 0


def test_unknown_question_refuses_without_evidence():
    response = client.post(
        "/api/query",
        json={"project_id": "echo-station", "question": "ZX-99市长是谁？", "method": "hybrid"},
    )
    assert response.status_code == 200
    assert response.json()["confidence"] == "insufficient"
