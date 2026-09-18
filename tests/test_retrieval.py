from scriptgraph.models import Scene
from scriptgraph.retrieval import Retriever


def scene(idx: int, text: str, characters=None):
    return Scene(
        id=f"p-s{idx:02d}", project_id="p", number=idx, heading=f"内景 地点{idx} - 夜",
        location=f"地点{idx}", time_of_day="夜", text=text, characters=characters or [],
        line_start=idx, line_end=idx + 1
    )


def test_bm25_finds_exact_scene():
    retriever = Retriever([scene(1, "发现银色录音带"), scene(2, "窗外下雨")])
    ranked = retriever.rank("银色录音带", "bm25", 1)
    assert ranked[0].scene.id == "p-s01"

