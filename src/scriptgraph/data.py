from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

PROJECTS = [
    {
        "id": "echo-station",
        "title": "回声站",
        "logline": "暴雨封锁的山城广播站里，一名实习记者追查二十年前失踪的最后一段录音。",
        "characters": ["林岚", "周砚", "陈姨", "许默"],
        "locations": ["旧广播站", "山城档案馆", "废弃隧道", "临时演播室"],
        "props": ["银色录音带", "黄铜钥匙", "值班日志", "红色雨伞"],
        "secret": "零点录音",
        "demo_enabled": True,
    },
    {
        "id": "paper-moon",
        "title": "纸月亮",
        "logline": "道具师在停拍的电影棚中发现一轮会记录演员记忆的纸月亮。",
        "characters": ["苏禾", "顾言", "唐梨", "阿庆"],
        "locations": ["三号摄影棚", "道具仓库", "洗片室", "露天片场"],
        "props": ["纸月亮", "场记板", "旧胶片", "蓝色戏服"],
        "secret": "第七码",
        "demo_enabled": True,
    },
    {
        "id": "northbound",
        "title": "北行列车",
        "logline": "一趟没有终点站的夜车上，检票员发现乘客名单每天都会少一个名字。",
        "characters": ["沈川", "闻溪", "罗叔", "小满"],
        "locations": ["七号车厢", "餐车", "信号室", "北岭站台"],
        "props": ["黑色车票", "银怀表", "乘客名单", "绿色行李箱"],
        "secret": "空白站名",
        "demo_enabled": False,
    },
    {
        "id": "tide-library",
        "title": "潮汐图书馆",
        "logline": "海水倒灌前夜，修复师必须从会改写内容的藏书中找回城市的真实地图。",
        "characters": ["季遥", "程屿", "叶馆长", "宁安"],
        "locations": ["潮汐图书馆", "地下修复室", "旧港口", "钟楼阅览厅"],
        "props": ["潮汐地图", "蓝墨水瓶", "借阅卡", "铜制书签"],
        "secret": "第十三书架",
        "demo_enabled": False,
    },
]

CATEGORIES = ["alias", "knowledge", "prop", "timeline"]


def _scene(project: dict, number: int, facts: list[str]) -> str:
    character = project["characters"][(number - 1) % len(project["characters"])]
    partner = project["characters"][number % len(project["characters"])]
    location = project["locations"][(number - 1) % len(project["locations"])]
    prop = project["props"][(number - 1) % len(project["props"])]
    event = f"{project['id']}-事件-{number:02d}"
    time = ["清晨", "午后", "黄昏", "深夜"][(number - 1) % 4]
    fact_lines = "\n".join(f"【事实:{fact}】" for fact in facts)
    return f"""内景 {location} - {time}

{character}
我在这里找到了线索{project['id'].upper()}-{number:02d}，它和{prop}有关。

{partner}
先记录下来，再核对{project['secret']}。

【道具:{prop}】【事件:{event}】
{character}把{prop}放在{location}的标记箱中，随后与{partner}离开。
{fact_lines}
"""


def generate(root: Path) -> None:
    scripts = root / "scripts"
    truth = root / "ground_truth"
    scripts.mkdir(parents=True, exist_ok=True)
    truth.mkdir(parents=True, exist_ok=True)
    manifest = {"license": "CC BY 4.0", "projects": []}
    all_questions = []
    all_conflicts = []

    for project in PROJECTS:
        facts_by_scene: dict[int, list[str]] = {idx: [] for idx in range(1, 31)}
        expected_conflicts = []
        for category_index, category in enumerate(CATEGORIES):
            for item_index in range(3):
                pair_index = category_index * 3 + item_index
                left_scene = 2 + pair_index * 2
                right_scene = left_scene + 1
                group = f"{project['id']}-{category}-{item_index + 1}"
                if category == "alias":
                    subject, predicate = project["characters"][item_index], "公开称谓"
                    left_value, right_value = f"代号{item_index + 1}A", f"代号{item_index + 1}B"
                elif category == "knowledge":
                    subject, predicate = project["characters"][item_index], project["secret"]
                    left_value, right_value = "已知", "未知"
                elif category == "prop":
                    subject, predicate = project["props"][item_index], "持有者"
                    left_value, right_value = project["characters"][0], project["characters"][2]
                else:
                    subject, predicate = f"关键事件{item_index + 1}", "发生顺序"
                    left_value, right_value = str(item_index + 1), str(item_index + 4)
                facts_by_scene[left_scene].append(
                    f"{category}|{subject}|{predicate}|{left_value}|{group}"
                )
                facts_by_scene[right_scene].append(
                    f"{category}|{subject}|{predicate}|{right_value}|{group}"
                )
                expected_conflicts.append(
                    {
                        "id": f"conflict-{group}",
                        "category": category,
                        "summary": f"{subject} 的{predicate}存在冲突",
                        "scene_ids": [
                            f"{project['id']}-s{left_scene:02d}",
                            f"{project['id']}-s{right_scene:02d}",
                        ],
                        "review_status": "pending_user_review",
                    }
                )

        screenplay = "\n\n".join(_scene(project, idx, facts_by_scene[idx]) for idx in range(1, 31))
        (scripts / f"{project['id']}.fountain").write_text(screenplay, encoding="utf-8")
        (truth / f"{project['id']}.conflicts.json").write_text(
            json.dumps(expected_conflicts, ensure_ascii=False, indent=2), encoding="utf-8"
        )
        all_conflicts.extend(expected_conflicts)
        manifest["projects"].append({key: value for key, value in project.items() if key not in {"characters", "locations", "props", "secret"}})

        for idx in range(1, 16):
            all_questions.append(
                {
                    "id": f"{project['id']}-single-{idx:02d}",
                    "project_id": project["id"],
                    "type": "single_hop",
                    "question": f"线索{project['id'].upper()}-{idx:02d}出现在哪个场景，与什么道具有关？",
                    "relevant_scene_ids": [f"{project['id']}-s{idx:02d}"],
                    "review_status": "pending_user_review",
                }
            )
        for idx in range(1, 16):
            left, right = idx, idx + 4
            character = project["characters"][(idx - 1) % len(project["characters"])]
            prop = project["props"][(idx - 1) % len(project["props"])]
            all_questions.append(
                {
                    "id": f"{project['id']}-multi-{idx:02d}",
                    "project_id": project["id"],
                    "type": "multi_hop",
                    "question": f"{character}在处理线索{project['id'].upper()}-{left:02d}后，下一次围绕同一件{prop}出现在哪一场？",
                    "relevant_scene_ids": [f"{project['id']}-s{left:02d}", f"{project['id']}-s{right:02d}"],
                    "review_status": "pending_user_review",
                }
            )
        for idx in range(1, 8):
            scene = 20 + idx
            all_questions.append(
                {
                    "id": f"{project['id']}-temporal-{idx:02d}",
                    "project_id": project["id"],
                    "type": "temporal_state",
                    "question": f"第{scene}场发生在什么时间，谁处理了什么道具？",
                    "relevant_scene_ids": [f"{project['id']}-s{scene:02d}"],
                    "review_status": "pending_user_review",
                }
            )
        for idx in range(1, 9):
            all_questions.append(
                {
                    "id": f"{project['id']}-noanswer-{idx:02d}",
                    "project_id": project["id"],
                    "type": "unanswerable",
                    "question": f"剧本是否说明了不存在的城市编号ZX-{idx:02d}的市长姓名？",
                    "relevant_scene_ids": [],
                    "review_status": "pending_user_review",
                }
            )

    (root / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
    (truth / "questions.json").write_text(
        json.dumps(all_questions, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    (truth / "conflicts.json").write_text(
        json.dumps(all_conflicts, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    review = {
        "status": "pending_user_review",
        "instructions": "逐条核对 question、relevant_scene_ids 与 conflict scene_ids；确认后将条目状态改为 confirmed。",
        "question_count": len(all_questions),
        "conflict_count": len(all_conflicts),
        "random_seed": 20260918,
    }
    (truth / "REVIEW_STATUS.json").write_text(
        json.dumps(review, ensure_ascii=False, indent=2), encoding="utf-8"
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=Path("data"))
    args = parser.parse_args()
    random.seed(20260918)
    generate(args.output)


if __name__ == "__main__":
    main()
