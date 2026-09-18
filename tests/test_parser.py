from pathlib import Path

from scriptgraph.parser import parse_fountain


def test_parser_extracts_scenes_and_traceability(tmp_path: Path):
    path = tmp_path / "sample.fountain"
    path.write_text(
        "内景 仓库 - 深夜\n\n林岚\n找到钥匙。\n【道具:钥匙】【事件:开门】\n【事实:prop|钥匙|持有者|林岚|g1】\n\n"
        "外景 站台 - 清晨\n\n周砚\n列车到了。\n",
        encoding="utf-8",
    )
    scenes = parse_fountain(path, "sample")
    assert len(scenes) == 2
    assert scenes[0].characters == ["林岚"]
    assert scenes[0].props == ["钥匙"]
    assert scenes[0].line_start == 1
    assert scenes[1].number == 2

