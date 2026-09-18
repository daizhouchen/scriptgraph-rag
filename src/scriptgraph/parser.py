from __future__ import annotations

import re
from pathlib import Path

from .models import Scene

SCENE_RE = re.compile(r"^(?:INT\.|EXT\.|内景|外景|内外景)[^\n]*$", re.IGNORECASE)
CHAR_RE = re.compile(r"^[\u4e00-\u9fffA-Z][\u4e00-\u9fffA-Z0-9· ]{0,15}$")
PROP_RE = re.compile(r"【道具[：:]([^】]+)】")
EVENT_RE = re.compile(r"【事件[：:]([^】]+)】")
FACT_RE = re.compile(r"【事实[：:]([^】]+)】")


def _heading_parts(heading: str) -> tuple[str, str]:
    body = re.sub(
        r"^(?:INT\.|EXT\.|内景|外景|内外景)\s*", "", heading, flags=re.IGNORECASE
    )
    parts = [p.strip() for p in re.split(r"\s*[-—]\s*", body) if p.strip()]
    return (parts[0] if parts else body.strip(), parts[-1] if len(parts) > 1 else "未知")


def parse_fountain(path: Path, project_id: str, version: str = "v1") -> list[Scene]:
    lines = path.read_text(encoding="utf-8").splitlines()
    starts = [idx for idx, line in enumerate(lines) if SCENE_RE.match(line.strip())]
    scenes: list[Scene] = []
    for pos, start in enumerate(starts):
        end = starts[pos + 1] if pos + 1 < len(starts) else len(lines)
        heading = lines[start].strip()
        body_lines = lines[start + 1 : end]
        text = "\n".join(body_lines).strip()
        location, time_of_day = _heading_parts(heading)
        characters = []
        for line in body_lines:
            value = line.strip()
            if value and CHAR_RE.match(value) and not value.startswith("【"):
                characters.append(value)
        scene_number = pos + 1
        scenes.append(
            Scene(
                id=f"{project_id}-s{scene_number:02d}",
                project_id=project_id,
                version=version,
                number=scene_number,
                heading=heading,
                location=location,
                time_of_day=time_of_day,
                text=text,
                characters=sorted(set(characters)),
                props=PROP_RE.findall(text),
                events=EVENT_RE.findall(text),
                facts=FACT_RE.findall(text),
                line_start=start + 1,
                line_end=end,
            )
        )
    return scenes
