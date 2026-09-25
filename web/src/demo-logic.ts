import type { Conflict, Evidence, Impact, QueryResult, Workspace } from "./api";

export type DemoCorpus = {
  schemaVersion: 1;
  projects: { workspace: Workspace; conflicts: Conflict[]; queries: { question: string; method: string; result: QueryResult }[] }[];
  knownProjectIds: string[];
  knownProjectTitles: string[];
  knownEntities: string[];
};

const METHODS = new Set(["bm25", "dense", "hybrid", "graph"]);
const normalize = (value: string) => value.normalize("NFKC").toLowerCase().replace(/[\s，。！？、：；,.!?;:'"“”‘’（）()]+/gu, "");
const copy = <T,>(value: T): T => structuredClone(value);
const identifiers = (value: string): string[] => value.match(/\b[a-z][a-z0-9]*(?:[-_][a-z0-9]+)+\b/giu) || [];
const STOPWORDS = new Set(["什么", "怎么", "如何", "哪里", "在哪", "是否", "为何", "为什么", "哪些", "哪个", "怎样", "请问", "剧本", "出现", "发生", "相关", "场景", "线索", "人物", "道具", "时间", "内容", "告诉", "找到", "有没有", "可以", "请把", "以及", "有关", "一个", "时候", "现在", "原文"]);

function refused(projectId: string, answer: string, error: string): QueryResult {
  return { request_id: `keyword:${projectId}`, elapsed_ms: 0, answer, confidence: "insufficient", evidences: [], retrieval_path: ["browser_keyword", "evidence_gate"], execution: "keyword", error_type: error };
}

function searchTerms(question: string, workspace: Workspace): string[] {
  const terms = new Set<string>();
  const lower = question.toLowerCase();
  for (const entity of workspace.entities) if (lower.includes(entity.toLowerCase())) terms.add(entity.toLowerCase());
  for (const id of identifiers(question)) terms.add(id.toLowerCase());
  for (const word of lower.match(/[a-z0-9]+|[\u3400-\u9fff]{2,}/gu) || []) {
    if (!STOPWORDS.has(word) && word.length > 1 && !/^\d+$/u.test(word)) terms.add(word);
    if (/^[\u3400-\u9fff]+$/u.test(word)) {
      for (let i = 0; i < word.length - 1; i++) {
        const pair = word.slice(i, i + 2);
        if (!STOPWORDS.has(pair)) terms.add(pair);
      }
    }
  }
  return [...terms];
}

export function createDemoApi(corpus: DemoCorpus) {
  const rowFor = (projectId: string) => corpus.projects.find((row) => row.workspace.project.id === projectId);

  function query(projectId: string, question: string, method: string): QueryResult {
    const started = Date.now();
    const row = rowFor(projectId);
    if (!row) return refused(projectId, "未找到可公开体验的剧本，请重新选择项目。", "project_not_found");
    if (typeof question !== "string" || question.trim().length < 2) return refused(projectId, "请填写至少两个字的查证问题或关键词。", "empty_question");
    if (question.length > 300) return refused(projectId, "问题请控制在 300 字以内。", "question_too_long");
    if (!METHODS.has(method)) return refused(projectId, "请选择可用的检索方法。", "unsupported_method");
    const workspace = row.workspace;
    const normalized = normalize(question);
    const cached = row.queries.find((item) => item.method === method && normalize(item.question) === normalized);
    if (cached) return { ...copy(cached.result), execution: "snapshot" };

    const lower = question.toLowerCase();
    const otherProject = corpus.knownProjectIds.some(id => id !== projectId && lower.includes(id.toLowerCase())) || corpus.knownProjectTitles.some(title => title !== workspace.project.title && question.includes(title));
    const otherEntity = corpus.knownEntities.some(entity => !workspace.entities.includes(entity) && question.includes(entity));
    if (otherProject || otherEntity) return refused(projectId, "问题包含其他剧本的人物、道具或项目。本次只查当前剧本，请切换项目或调整问题。", "outside_project");
    const fullText = workspace.lines.join("\n").toLowerCase();
    const knownIdentifiers = new Set(identifiers(fullText).map(id => id.toLowerCase()));
    if (identifiers(question).some(id => !knownIdentifiers.has(id.toLowerCase()))) return refused(projectId, "当前剧本没有这个标识，现有原文不足以回答。请核对编号，或查看本剧本的示例。", "unknown_identifier");

    const numbered = question.match(/第\s*(\d{1,3})\s*场/u);
    const sceneNumber = numbered ? Number(numbered[1]) : null;
    if (sceneNumber !== null && !workspace.scenes.some(scene => scene.number === sceneNumber)) return refused(projectId, "当前剧本不存在这个场次，请核对场次编号。", "scene_not_found");
    const terms = searchTerms(question, workspace);
    const ranked = workspace.scenes.filter(scene => sceneNumber === null || scene.number === sceneNumber).map(scene => {
      const document = `${scene.heading}\n${scene.text}`.toLowerCase();
      const matched = terms.filter(term => document.includes(term));
      const exactEntities = workspace.entities.filter(entity => lower.includes(entity.toLowerCase()) && document.includes(entity.toLowerCase()));
      const exactIdentifiers = identifiers(question).filter(id => document.includes(id.toLowerCase()));
      return { scene, matched, relevance: matched.length + exactEntities.length * 5 + exactIdentifiers.length * 12 + (sceneNumber !== null ? 20 : 0) };
    }).filter(item => item.relevance > 0).sort((left, right) => right.relevance - left.relevance || left.scene.number - right.scene.number).slice(0, 5);
    if (!ranked.length) return refused(projectId, "当前原文未找到可用的关键词候选，无法据此回答。可以换用人物、道具、线索编号或场次。", "no_evidence");
    const evidences: Evidence[] = ranked.map(({ scene, matched, relevance }) => {
      const source = workspace.lines.slice(scene.line_start - 1, scene.line_end);
      const lineOffset = source.findIndex(line => matched.some(term => line.toLowerCase().includes(term)));
      const begin = Math.max(0, (lineOffset < 0 ? 0 : lineOffset) - 1);
      const end = Math.min(source.length, begin + 7);
      return { scene_id: scene.id, scene_number: scene.number, heading: scene.heading, excerpt: source.slice(begin, end).join("\n"), score: relevance, reasons: [...(sceneNumber !== null ? [`场次：${scene.number}`] : []), ...matched.slice(0, 5).map(term => `关键词：${term}`)], line_start: scene.line_start + begin, line_end: scene.line_start + end - 1 };
    });
    return { request_id: `keyword:${projectId}`, elapsed_ms: Date.now() - started, answer: `找到 ${evidences.length} 处关键词候选。以下仅列原文片段，尚未形成语义答案；请打开完整场次核对。`, confidence: "medium", evidences, retrieval_path: ["browser_keyword", "source_excerpt_only"], execution: "keyword" };
  }

  function impact(projectId: string, entity: string, change: string): { impacts: Impact[]; error_type?: string; review_plan?: string } {
    const row = rowFor(projectId);
    if (!row) return { impacts: [], error_type: "project_not_found" };
    if (typeof entity !== "string" || !row.workspace.entities.includes(entity.trim())) return { impacts: [], error_type: "entity_not_found" };
    if (typeof change !== "string" || change.trim().length < 2 || change.length > 300) return { impacts: [], error_type: "invalid_change" };
    const target = entity.trim(), plan = change.trim();
    const impacts = row.workspace.scenes.filter(scene => `${scene.heading}\n${scene.text}`.includes(target) || scene.characters.includes(target) || scene.props.includes(target)).map(scene => ({
      scene_id: scene.id, scene_number: scene.number, heading: scene.heading,
      path: [target, "原文提及或参与", scene.id],
      reason: `该场直接提及或包含“${target}”。复核计划：“${plan}”。是否需要修改须人工核对，未进行改稿语义推演。`,
    }));
    return { impacts, review_plan: plan };
  }

  return {
    projects: () => copy(corpus.projects.map(row => row.workspace.project)),
    workspace: (projectId: string): Workspace => {
      const row = rowFor(projectId);
      if (!row) throw new Error("未找到可公开体验的剧本。");
      return copy(row.workspace);
    },
    query,
    conflicts: (projectId: string) => {
      const row = rowFor(projectId);
      return row ? { conflicts: copy(row.conflicts) } : { conflicts: [], error_type: "project_not_found" };
    },
    impact,
  };
}
