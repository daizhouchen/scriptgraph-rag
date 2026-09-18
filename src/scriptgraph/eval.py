from __future__ import annotations

import argparse
import json
from collections import defaultdict
from pathlib import Path

from .consistency import detect_conflicts
from .engine import ScriptGraphEngine
from .models import QueryRequest


def evaluate(data_dir: Path) -> dict:
    engine = ScriptGraphEngine(data_dir)
    questions = json.loads((data_dir / "ground_truth" / "questions.json").read_text(encoding="utf-8"))
    methods = ["bm25", "dense", "hybrid", "graph"]
    results = {}
    for method in methods:
        buckets = defaultdict(lambda: {"recall": [], "rr": [], "count": 0})
        refusals = []
        citation_hits = []
        for item in questions:
            response = engine.query(
                QueryRequest(
                    project_id=item["project_id"], question=item["question"], method=method, top_k=5
                )
            )
            relevant = item["relevant_scene_ids"]
            retrieved = [e.scene_id for e in response.evidences]
            if not relevant:
                refusals.append(response.confidence == "insufficient")
                continue
            hits = [scene_id for scene_id in retrieved if scene_id in relevant]
            recall = len(set(hits)) / len(set(relevant))
            positions = [retrieved.index(scene_id) + 1 for scene_id in relevant if scene_id in retrieved]
            reciprocal_rank = 1 / min(positions) if positions else 0.0
            citation_hits.append(bool(retrieved and retrieved[0] in relevant))
            bucket = buckets[item["type"]]
            bucket["recall"].append(recall)
            bucket["rr"].append(reciprocal_rank)
            bucket["count"] += 1
        results[method] = {
            kind: {
                "count": values["count"],
                "recall_at_5": round(sum(values["recall"]) / max(1, len(values["recall"])), 4),
                "mrr": round(sum(values["rr"]) / max(1, len(values["rr"])), 4),
            }
            for kind, values in buckets.items()
        }
        results[method]["unanswerable"] = {
            "count": len(refusals),
            "refusal_rate": round(sum(refusals) / max(1, len(refusals)), 4),
        }
        results[method]["citation_precision_at_1"] = round(
            sum(citation_hits) / max(1, len(citation_hits)), 4
        )

    predicted = []
    for project in engine.projects():
        predicted.extend(detect_conflicts(engine._scenes[project.id]))
    truth = json.loads((data_dir / "ground_truth" / "conflicts.json").read_text(encoding="utf-8"))
    predicted_ids = {item.id for item in predicted}
    truth_ids = {item["id"] for item in truth}
    tp = len(predicted_ids & truth_ids)
    precision = tp / max(1, len(predicted_ids))
    recall = tp / max(1, len(truth_ids))
    results["consistency"] = {
        "predicted": len(predicted_ids),
        "ground_truth": len(truth_ids),
        "precision": round(precision, 4),
        "recall": round(recall, 4),
        "f1": round(2 * precision * recall / max(1e-9, precision + recall), 4),
    }
    results["review_status"] = "pending_user_review"
    return results


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--data", type=Path, default=Path("data"))
    parser.add_argument("--output", type=Path, default=Path("reports/baseline.json"))
    args = parser.parse_args()
    result = evaluate(args.data)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
