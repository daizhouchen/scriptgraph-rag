import type { Conflict, Impact, Project, QueryResult } from "./api";

const projects: Project[] = [
  { id: "echo-station", title: "回声站", logline: "暴雨封锁的山城广播站里，一名实习记者追查二十年前失踪的最后一段录音。", versions: ["v1"], scene_count: 30, character_count: 6, demo_enabled: true },
  { id: "paper-moon", title: "纸月亮", logline: "道具师在停拍的电影棚中发现一轮会记录演员记忆的纸月亮。", versions: ["v1"], scene_count: 30, character_count: 6, demo_enabled: true },
];

const evidence = [
  { scene_id: "echo-station-v1-s05", scene_number: 5, heading: "内景 废弃广播站控制室 - 夜", excerpt: "林岚在旧控制台下找到银色录音带，标签写着 ECHO-STATION-01。", score: 0.982, reasons: ["BM25", "entity:银色录音带", "graph:线索"], line_start: 73, line_end: 81 },
  { scene_id: "echo-station-v1-s18", scene_number: 18, heading: "内景 临时剪辑室 - 深夜", excerpt: "周砚播放 ECHO-STATION-01，零点报时后出现短促的金属碰撞声。", score: 0.914, reasons: ["vector", "graph:录音带→播放"], line_start: 266, line_end: 275 },
  { scene_id: "echo-station-v1-s25", scene_number: 25, heading: "外景 广播站天台 - 黎明前", excerpt: "林岚把银色录音带交给周砚保管，并记下天台门锁的编号。", score: 0.861, reasons: ["graph:道具持有", "temporal"], line_start: 371, line_end: 379 },
];

const paperEvidence = [
  { scene_id: "paper-moon-v1-s01", scene_number: 1, heading: "内景 三号摄影棚 - 清晨", excerpt: "苏禾找到线索 PAPER-MOON-01，它与纸月亮有关，并把纸月亮放进摄影棚的标记箱。", score: 0.976, reasons: ["BM25", "entity:纸月亮", "graph:线索"], line_start: 1, line_end: 13 },
  { scene_id: "paper-moon-v1-s05", scene_number: 5, heading: "内景 三号摄影棚 - 清晨", excerpt: "苏禾再次核对纸月亮与第七码，并记录道具所在的标记箱。", score: 0.889, reasons: ["vector", "graph:纸月亮→场景"], line_start: 53, line_end: 65 },
];

const conflicts: Conflict[] = [
  { id: "echo-station-alias-01", category: "alias", summary: "同一联系人在第 4 场与第 12 场使用了不一致称谓", scene_ids: ["s04", "s12"], evidence: ["第4场：老陈", "第12场：陈主任"], review_status: "pending" },
  { id: "echo-station-knowledge-01", category: "knowledge", summary: "周砚在获知录音内容前已准确复述其中细节", scene_ids: ["s09", "s18"], evidence: ["第9场：提到零点报时", "第18场：首次播放录音"], review_status: "pending" },
  { id: "echo-station-prop-01", category: "prop", summary: "银色录音带在没有交接场景时更换了持有人", scene_ids: ["s18", "s22"], evidence: ["第18场：林岚持有", "第22场：周砚从口袋取出"], review_status: "pending" },
];

const paperConflicts: Conflict[] = [
  { id: "paper-moon-alias-01", category: "alias", summary: "苏禾在相邻场次使用了不一致的公开称谓", scene_ids: ["s02", "s03"], evidence: ["第2场：代号1A", "第3场：代号1B"], review_status: "pending" },
  { id: "paper-moon-knowledge-01", category: "knowledge", summary: "人物在获得第七码之前已引用该信息", scene_ids: ["s07", "s08"], evidence: ["第7场：尚未确认", "第8场：直接引用"], review_status: "pending" },
];

const impacts: Impact[] = [
  { scene_id: "echo-station-v1-s18", scene_number: 18, heading: "内景 临时剪辑室 - 深夜", path: ["银色录音带", "PROP_APPEARS", "S18"], reason: "该场播放录音并建立关键声音线索。" },
  { scene_id: "echo-station-v1-s22", scene_number: 22, heading: "外景 江堤 - 夜", path: ["银色录音带", "HELD_BY", "周砚", "APPEARS_IN", "S22"], reason: "修改持有人会改变本场道具来源与人物行动。" },
  { scene_id: "echo-station-v1-s25", scene_number: 25, heading: "外景 广播站天台 - 黎明前", path: ["银色录音带", "TRANSFERRED_AT", "S25"], reason: "本场包含原有交接事件，需要同步改写。" },
];

const delay = <T,>(value: T) => new Promise<T>((resolve) => window.setTimeout(() => resolve(value), 220));

export const staticApi = {
  projects: () => delay(projects),
  query: (projectId: string, question: string, method: string) => delay<QueryResult>({
    request_id: "static-demo-request",
    elapsed_ms: 7.8,
    answer: projectId === "paper-moon"
      ? "线索 PAPER-MOON-01 出现在第1场的三号摄影棚，与道具纸月亮有关；苏禾将它放入摄影棚的标记箱。"
      : question.includes("25")
      ? "第25场发生在黎明前的广播站天台。林岚将银色录音带交给周砚保管，并记录门锁编号。"
      : "线索 ECHO-STATION-01 首次出现在第5场的废弃广播站控制室，对应道具是银色录音带；第18场播放后补充了零点报时与金属碰撞声。",
    confidence: "high",
    evidences: projectId === "paper-moon" ? paperEvidence : question.includes("25") ? [evidence[2], evidence[1]] : evidence,
    retrieval_path: method === "graph" ? ["BM25", "char-ngram", "rerank", "graph-expand"] : [method],
  }),
  conflicts: (projectId: string) => delay({ conflicts: projectId === "paper-moon" ? paperConflicts : conflicts }),
  impact: (_projectId: string, _entity: string, _change: string) => delay({ impacts }),
};
