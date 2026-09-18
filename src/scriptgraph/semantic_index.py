"""Optional sentence-transformers + FAISS index for the full local profile."""
from __future__ import annotations

import os
from typing import Any

from .models import Scene

_MODEL_CACHE: dict[str, Any] = {}


class SemanticIndex:
    def __init__(self, scenes: list[Scene], model_name: str):
        import faiss
        from sentence_transformers import SentenceTransformer

        model = _MODEL_CACHE.get(model_name)
        if model is None:
            model = SentenceTransformer(model_name)
            _MODEL_CACHE[model_name] = model
        self.model = model
        documents = [
            " ".join(
                [
                    scene.heading,
                    scene.text,
                    *scene.characters,
                    *scene.props,
                    *scene.events,
                    *scene.facts,
                ]
            )
            for scene in scenes
        ]
        embeddings = model.encode(documents, normalize_embeddings=True, convert_to_numpy=True)
        self.index = faiss.IndexFlatIP(embeddings.shape[1])
        self.index.add(embeddings.astype("float32"))
        self.size = len(scenes)

    @classmethod
    def from_environment(cls, scenes: list[Scene]) -> SemanticIndex | None:
        model_name = os.getenv("SCRIPTGRAPH_EMBEDDING_MODEL")
        if not model_name:
            return None
        try:
            return cls(scenes, model_name)
        except (ModuleNotFoundError, OSError, RuntimeError, ValueError):
            return None

    def scores(self, query: str) -> list[float]:
        vector = self.model.encode([query], normalize_embeddings=True, convert_to_numpy=True)
        scores, indices = self.index.search(vector.astype("float32"), self.size)
        output = [0.0] * self.size
        for score, index in zip(scores[0], indices[0], strict=True):
            if index >= 0:
                output[int(index)] = max(0.0, float(score))
        return output
