from __future__ import annotations

import math
import re
from collections import Counter, defaultdict
from collections.abc import Callable
from dataclasses import dataclass

from .models import Evidence, Scene

TOKEN_RE = re.compile(r"[\u4e00-\u9fff]|[A-Za-z0-9_]+")


def tokenize(text: str) -> list[str]:
    return [token.lower() for token in TOKEN_RE.findall(text)]


def char_ngrams(text: str, n: int = 2) -> Counter[str]:
    compact = "".join(tokenize(text))
    return Counter(compact[i : i + n] for i in range(max(0, len(compact) - n + 1)))


def cosine(left: Counter[str], right: Counter[str]) -> float:
    common = set(left) & set(right)
    dot = sum(left[key] * right[key] for key in common)
    norm_l = math.sqrt(sum(value * value for value in left.values()))
    norm_r = math.sqrt(sum(value * value for value in right.values()))
    return dot / (norm_l * norm_r) if norm_l and norm_r else 0.0


@dataclass
class RankedScene:
    scene: Scene
    score: float
    reasons: list[str]


class Retriever:
    def __init__(
        self,
        scenes: list[Scene],
        graph_neighbor_ids: Callable[[list[str]], list[str]] | None = None,
        dense_score_provider: Callable[[str], list[float]] | None = None,
    ):
        self.scenes = scenes
        self.docs = [tokenize(self._document(scene)) for scene in scenes]
        self.df: Counter[str] = Counter()
        for doc in self.docs:
            self.df.update(set(doc))
        self.avg_len = sum(map(len, self.docs)) / max(1, len(self.docs))
        self.grams = [char_ngrams(self._document(scene)) for scene in scenes]
        self.entity_to_scenes: dict[str, set[int]] = defaultdict(set)
        self.graph_neighbor_ids = graph_neighbor_ids
        self.dense_score_provider = dense_score_provider
        self.scene_index = {scene.id: index for index, scene in enumerate(scenes)}
        for idx, scene in enumerate(scenes):
            for entity in scene.characters + scene.props + scene.events + [scene.location]:
                self.entity_to_scenes[entity.lower()].add(idx)

    @staticmethod
    def _document(scene: Scene) -> str:
        return " ".join(
            [scene.heading, scene.text, *scene.characters, *scene.props, *scene.events, *scene.facts]
        )

    def _bm25(self, query: str) -> list[float]:
        terms = tokenize(query)
        scores: list[float] = []
        k1, b = 1.5, 0.75
        total = len(self.docs)
        for doc in self.docs:
            counts = Counter(doc)
            score = 0.0
            for term in terms:
                freq = counts[term]
                if not freq:
                    continue
                idf = math.log(1 + (total - self.df[term] + 0.5) / (self.df[term] + 0.5))
                denom = freq + k1 * (1 - b + b * len(doc) / max(1, self.avg_len))
                score += idf * freq * (k1 + 1) / denom
            scores.append(score)
        return scores

    def _dense(self, query: str) -> list[float]:
        if self.dense_score_provider:
            return self.dense_score_provider(query)
        query_grams = char_ngrams(query)
        return [cosine(query_grams, grams) for grams in self.grams]

    def rank(self, query: str, method: str = "graph", top_k: int = 5) -> list[RankedScene]:
        bm25 = self._bm25(query)
        dense = self._dense(query)
        max_bm25 = max(bm25) if bm25 else 1.0
        base = []
        for idx in range(len(self.scenes)):
            if method == "bm25":
                score = bm25[idx] / max(1e-9, max_bm25)
            elif method == "dense":
                score = dense[idx]
            else:
                score = 0.58 * (bm25[idx] / max(1e-9, max_bm25)) + 0.42 * dense[idx]
            base.append(score)

        reasons: dict[int, list[str]] = defaultdict(list)
        if method == "graph":
            seed_indices = sorted(range(len(base)), key=base.__getitem__, reverse=True)[:1]
            if self.graph_neighbor_ids:
                seed_ids = [self.scenes[index].id for index in seed_indices]
                for scene_id in self.graph_neighbor_ids(seed_ids):
                    idx = self.scene_index.get(scene_id)
                    if idx is not None:
                        base[idx] += 0.18
                        reasons[idx].append("Neo4j 一跳图扩展")
            entities: set[str] = set()
            for idx in seed_indices:
                scene = self.scenes[idx]
                entities.update(entity.lower() for entity in scene.characters + scene.props + scene.events)
            for entity in entities:
                for idx in self.entity_to_scenes[entity]:
                    if idx not in seed_indices:
                        distance = min(abs(idx - seed) for seed in seed_indices)
                        bonus = 0.24 / (1 + distance)
                        base[idx] += bonus
                        reasons[idx].append(f"图扩展：{entity} / 距离{distance}")

        ranked = sorted(range(len(base)), key=base.__getitem__, reverse=True)[:top_k]
        return [
            RankedScene(
                scene=self.scenes[idx],
                score=round(base[idx], 6),
                reasons=[method, *reasons[idx]],
            )
            for idx in ranked
        ]

    def has_unknown_identifier(self, query: str) -> bool:
        identifiers = re.findall(r"[A-Za-z][A-Za-z0-9-]*-\d+", query)
        if not identifiers:
            return False
        corpus = " ".join(self._document(scene) for scene in self.scenes).lower()
        return any(identifier.lower() not in corpus for identifier in identifiers)

    @staticmethod
    def to_evidence(item: RankedScene) -> Evidence:
        scene = item.scene
        excerpt = " ".join(scene.text.split())[:260]
        return Evidence(
            scene_id=scene.id,
            scene_number=scene.number,
            heading=scene.heading,
            excerpt=excerpt,
            score=item.score,
            reasons=item.reasons,
            line_start=scene.line_start,
            line_end=scene.line_end,
        )
