from scriptgraph.consistency import detect_conflicts
from scriptgraph.models import Scene


def _scene(scene_id: str, fact: str) -> Scene:
    return Scene(
        id=scene_id, project_id="p", number=1, heading="内景 仓库 - 夜",
        location="仓库", time_of_day="夜", text="", facts=[fact], line_start=1, line_end=2
    )


def test_detects_conflicting_structured_facts():
    scenes = [
        _scene("p-s01", "prop|钥匙|持有者|林岚|key-owner"),
        _scene("p-s02", "prop|钥匙|持有者|周砚|key-owner"),
    ]
    conflicts = detect_conflicts(scenes)
    assert len(conflicts) == 1
    assert conflicts[0].category == "prop"
    assert conflicts[0].scene_ids == ["p-s01", "p-s02"]

