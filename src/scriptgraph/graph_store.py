"""Optional Neo4j persistence used by the full local Docker profile."""
from __future__ import annotations

import os
from collections.abc import Iterable
from dataclasses import dataclass
from typing import Any

from .models import Scene


@dataclass
class GraphImpact:
    scene_id: str
    scene_number: int
    heading: str
    path: list[str]


class Neo4jGraphStore:
    def __init__(self, uri: str, user: str, password: str):
        from neo4j import GraphDatabase

        self.driver = GraphDatabase.driver(uri, auth=(user, password))
        self.driver.verify_connectivity()

    @classmethod
    def from_environment(cls) -> Neo4jGraphStore | None:
        uri = os.getenv("NEO4J_URI")
        if not uri:
            return None
        try:
            from neo4j.exceptions import Neo4jError, ServiceUnavailable
        except ModuleNotFoundError:
            return None
        try:
            return cls(
                uri,
                os.getenv("NEO4J_USER", "neo4j"),
                os.getenv("NEO4J_PASSWORD", "scriptgraph-local"),
            )
        except (Neo4jError, ServiceUnavailable, OSError):
            return None

    def close(self) -> None:
        self.driver.close()

    def sync_project(self, project_id: str, title: str, scenes: Iterable[Scene]) -> None:
        payload = [scene.model_dump(mode="json") for scene in scenes]
        with self.driver.session() as session:
            session.execute_write(self._sync_project, project_id, title, payload)

    @staticmethod
    def _sync_project(tx: Any, project_id: str, title: str, scenes: list[dict]) -> None:
        tx.run(
            """
            MERGE (p:Project {id: $project_id}) SET p.title = $title
            MERGE (v:Version {id: $version_id}) SET v.name = 'v1'
            MERGE (p)-[:HAS_VERSION]->(v)
            """,
            project_id=project_id,
            title=title,
            version_id=f"{project_id}:v1",
        )
        previous_id: str | None = None
        for scene in scenes:
            tx.run(
                """
                MATCH (v:Version {id: $version_id})
                MERGE (s:Scene {id: $id})
                SET s.project_id = $project_id, s.number = $number, s.heading = $heading,
                    s.text = $text, s.line_start = $line_start, s.line_end = $line_end,
                    s.review_status = $review_status, s.facts = $facts
                MERGE (v)-[:CONTAINS]->(s)
                WITH s
                UNWIND $characters AS character
                MERGE (c:Character {key: $project_id + ':' + character}) SET c.name = character
                MERGE (c)-[:APPEARS_IN]->(s)
                """,
                version_id=f"{project_id}:v1",
                project_id=project_id,
                **scene,
            )
            tx.run(
                """
                MATCH (s:Scene {id: $id})
                MERGE (l:Location {key: $project_id + ':' + $location}) SET l.name = $location
                MERGE (s)-[:TAKES_PLACE_AT]->(l)
                WITH s
                UNWIND $props AS prop
                MERGE (p:Prop {key: $project_id + ':' + prop}) SET p.name = prop
                MERGE (p)-[:APPEARS_IN]->(s)
                """,
                id=scene["id"],
                project_id=project_id,
                location=scene["location"],
                props=scene["props"],
            )
            tx.run(
                """
                MATCH (s:Scene {id: $id})
                UNWIND $events AS event
                MERGE (e:Event {key: $project_id + ':' + event}) SET e.name = event
                MERGE (e)-[:OCCURS_IN]->(s)
                """,
                id=scene["id"],
                project_id=project_id,
                events=scene["events"],
            )
            if previous_id:
                tx.run(
                    """
                    MATCH (left:Scene {id: $left}), (right:Scene {id: $right})
                    MERGE (left)-[:NEXT]->(right)
                    """,
                    left=previous_id,
                    right=scene["id"],
                )
            previous_id = scene["id"]

    def related_scene_ids(self, project_id: str, seeds: list[str]) -> list[str]:
        with self.driver.session() as session:
            records = session.run(
                """
                MATCH (seed:Scene) WHERE seed.id IN $seeds
                MATCH (seed)--(entity)--(neighbor:Scene {project_id: $project_id})
                WHERE NOT neighbor.id IN $seeds
                RETURN DISTINCT neighbor.id AS id
                LIMIT 30
                """,
                seeds=seeds,
                project_id=project_id,
            )
            return [record["id"] for record in records]

    def impact(self, project_id: str, entity: str) -> list[GraphImpact]:
        with self.driver.session() as session:
            records = session.run(
                """
                MATCH (entity) WHERE toLower(coalesce(entity.name, '')) CONTAINS toLower($entity)
                MATCH path=(entity)-[*1..3]-(scene:Scene {project_id: $project_id})
                RETURN DISTINCT scene.id AS scene_id, scene.number AS scene_number,
                    scene.heading AS heading,
                    [node IN nodes(path) | coalesce(node.name, node.heading, node.id)] AS path
                ORDER BY scene.number
                LIMIT 50
                """,
                entity=entity,
                project_id=project_id,
            )
            return [GraphImpact(**record.data()) for record in records]
