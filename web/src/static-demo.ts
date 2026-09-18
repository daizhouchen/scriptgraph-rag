import type { Conflict, Impact, Project, QueryResult } from "./api";

const projects: Project[] = [
  { id: "echo-station", title: "回声站", logline: "一段来自废弃广播站的零点录音，把记者林岚带回十年前失踪案的现场。", versions: ["v1"], scene_count: 30, character_count: 6, demo_enabled: true },
  { id: "glass-island", title: "玻璃岛", logline: "海岛气象员在停航前夜发现一组不该存在的观测记录。", versions: ["v1"], scene_count: 30, character_count: 6, demo_enabled: true },
  { id: "night-bus", title: "夜班车", logline: "末班公交反复经过同一座桥，乘客却逐个忘记上车的原因。", versions: ["v1"], scene_count: 30, character_count: 6, demo_enabled: true },
  { id: "paper-city", title: "纸城", logline: "档案修复师发现城市地图会随被删除的记忆改变。", versions: ["v1"], scene_count: 30, character_count: 6, demo_enabled: true },
];

const evidence = [
  { scene_id: "echo-station-v1-s05", scene_number: 5, heading: "内景 废弃广播站控制室 - 夜", excerpt: "林岚在旧控制台下找到银色录音带，标签写着 ECHO-STATION-01。", score: 0.982, reasons: ["BM25", "entity:银色录音带", "graph:线索"], line_start: 73, line_end: 81 },
  { scene_id: "echo-station-v1-s18", scene_number: 18, heading: "内景 临时剪辑室 - 深夜", excerpt: "周砚播放 ECHO-STATION-01，零点报时后出现短促的金属碰撞声。", score: 0.914, reasons: ["vector", "graph:录音带→播放"], line_start: 266, line_end: 275 },
  { scene_id: "echo-station-v1-s25", scene_number: 25, heading: "外景 广播站天台 - 黎明前", excerpt: "林岚把银色录音带交给周砚保管，并记下天台门锁的编号。", score: 0.861, reasons: ["graph:道具持有", "temporal"], line_start: 371, line_end: 379 },
];

const conflicts: Conflict[] = [
  { id: "echo-station-alias-01", category: "alias", summary: "同一联系人在第 4 场与第 12 场使用了不一致称谓", scene_ids: ["s04", "s12"], evidence: ["第4场：老陈", "第12场：陈主任"], review_status: "pending" },
  { id: "echo-station-knowledge-01", category: "knowledge", summary: "周砚在获知录音内容前已准确复述其中细节", scene_ids: ["s09", "s18"], evidence: ["第9场：提到零点报时", "第18场：首次播放录音"], review_status: "pending" },
  { id: "echo-station-prop-01", category: "prop", summary: "银色录音带在没有交接场景时更换了持有人", scene_ids: ["s18", "s22"], evidence: ["第18场：林岚持有", "第22场：周砚从口袋取出"], review_status: "pending" },
];

const impacts: Impact[] = [
  { scene_id: "echo-station-v1-s18", scene_number: 18, heading: "内景 临时剪辑室 - 深夜", path: ["银色录音带", "PROP_APPEARS", "S18"], reason: "该场播放录音并建立关键声音线索。" },
  { scene_id: "echo-station-v1-s22", scene_number: 22, heading: "外景 江堤 - 夜", path: ["银色录音带", "HELD_BY", "周砚", "APPEARS_IN", "S22"], reason: "修改持有人会改变本场道具来源与人物行动。" },
  { scene_id: "echo-station-v1-s25", scene_number: 25, heading: "外景 广播站天台 - 黎明前", path: ["银色录音带", "TRANSFERRED_AT", "S25"], reason: "本场包含原有交接事件，需要同步改写。" },
];

const delay = <T,>(value: T) => new Promise<T>((resolve) => window.setTimeout(() => resolve(value), 220));

export const staticApi = {
  projects: () => delay(projects),
  query: (_projectId: string, question: string, method: string) => delay<QueryResult>({
    request_id: "static-demo-request",
    elapsed_ms: 7.8,
    answer: question.includes("25")
      ? "第25场发生在黎明前的广播站天台。林岚将银色录音带交给周砚保管，并记录门锁编号。"
      : "线索 ECHO-STATION-01 首次出现在第5场的废弃广播站控制室，对应道具是银色录音带；第18场播放后补充了零点报时与金属碰撞声。",
    confidence: "high",
    evidences: question.includes("25") ? [evidence[2], evidence[1]] : evidence,
    retrieval_path: method === "graph" ? ["BM25", "char-ngram", "rerank", "graph-expand"] : [method],
  }),
  conflicts: (_projectId: string) => delay({ conflicts }),
  impact: (_projectId: string, _entity: string, _change: string) => delay({ impacts }),
};
