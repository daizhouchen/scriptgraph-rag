from __future__ import annotations

from collections import defaultdict

from .models import Conflict, ReviewStatus, Scene


def detect_conflicts(scenes: list[Scene]) -> list[Conflict]:
    """Detect contradictory structured facts while keeping every result traceable."""
    groups: dict[tuple[str, str, str, str], list[tuple[str, str]]] = defaultdict(list)
    for scene in scenes:
        for fact in scene.facts:
            parts = [part.strip() for part in fact.split("|")]
            if len(parts) != 5:
                continue
            category, subject, predicate, value, group = parts
            groups[(category, subject, predicate, group)].append((scene.id, value))

    conflicts: list[Conflict] = []
    supported = {"alias", "knowledge", "prop", "timeline"}
    for (category, subject, predicate, group), entries in sorted(groups.items()):
        values = {value for _, value in entries}
        if category not in supported or len(values) < 2:
            continue
        conflicts.append(
            Conflict(
                id=f"conflict-{group}",
                category=category,
                summary=f"{subject} 的“{predicate}”出现不一致：{' / '.join(sorted(values))}",
                scene_ids=[scene_id for scene_id, _ in entries],
                evidence=[f"{scene_id}: {value}" for scene_id, value in entries],
                review_status=ReviewStatus.PENDING,
            )
        )
    return conflicts

