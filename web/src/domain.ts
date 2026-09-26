/** Local screenplay domain. User text never leaves this module through a network call. */
export type EntityKind = "character" | "prop";
export type Diagnostic = { code: string; level: "warning" | "error"; message: string; line?: number };
export type Scene = { id: string; number: number; heading: string; lineStart: number; lineEnd: number; text: string };
export type EntityCandidate = { name: string; kind: EntityKind; reason?: string; source: "forced" | "dialogue" | "tag" | "candidate"; lineNumbers: number[] };
export type ParsedScript = { text: string; lines: string[]; scenes: Scene[]; entityCandidates: EntityCandidate[]; diagnostics: Diagnostic[]; canImport: boolean };
export type ScriptVersion = { id: string; label: string; createdAt: number; text: string; scenes: Scene[]; diagnostics: Diagnostic[] };
export type EvidenceRef = { versionId: string; sceneId: string; lineStart: number; lineEnd: number; quote: string };
export type Entity = { id: string; kind: EntityKind; name: string; aliases: string[]; confirmed: boolean };
export type EntityInput = { id?: string; kind: EntityKind; name: string; aliases?: string[]; confirmed?: boolean };
export type IssueStatus = "open" | "working" | "resolved" | "dismissed";
export type ReviewIssue = { id: string; title: string; note: string; status: IssueStatus; evidence: EvidenceRef[]; createdVersionId: string; reviewedVersionId: string | null; createdAt: number; updatedAt: number };
export type Project = { schemaVersion: 2; id: string; title: string; origin: "import" | "paste" | "sample"; activeVersionId: string; versions: ScriptVersion[]; entities: Entity[]; issues: ReviewIssue[]; createdAt: number; updatedAt: number };
export type GraphMention = { entityId: string; sceneId: string; alias: string; ref: EvidenceRef };
export type ProjectGraph = { versionId: string; entities: Entity[]; mentions: GraphMention[]; edges: { entityId: string; sceneId: string; refs: EvidenceRef[] }[] };
export type QueryMatch = { sceneId: string; sceneNumber: number; heading: string; kind: "direct" | "related"; excerpt: string; ref: EvidenceRef; matchedTerms: string[]; path?: { entityId: string; entityName: string; fromSceneId: string; toSceneId: string } };
export type LocalQueryResult = { query: string; versionId: string; method: "text" | "graph"; results: QueryMatch[]; message: string };
export type SceneChange = { id: string; kind: "unchanged" | "modified" | "added" | "removed" | "ambiguous"; fromSceneId?: string; toSceneId?: string; fromSceneIds: string[]; toSceneIds: string[]; moved: boolean; summary: string };
export type VersionDiff = { fromVersionId: string; toVersionId: string; changes: SceneChange[]; counts: Record<"unchanged" | "modified" | "added" | "removed" | "ambiguous" | "moved", number> };
export type IssueInput = { title: string; note?: string; status?: IssueStatus; evidence?: EvidenceRef[] };
export type IssuePatch = Partial<IssueInput>;
export type BackupResult = { ok: true; project: Project; errors: [] } | { ok: false; errors: string[]; project?: undefined };
export const MAX_TEXT_LENGTH = 2_000_000;
export const MAX_SCENES = 2000;
export const DOMAIN_LIMITS = { versions: 30, entities: 500, issues: 1000, totalTextLength: 8_000_000, backupLength: 24_000_000 } as const;

export class DomainError extends Error {
  code: string;
  constructor(code: string, message: string) { super(message); this.name = "DomainError"; this.code = code; }
}

const NUMBERED_PREFIX = /^(?:第\s*)?(?:[0-9０-９]+(?:[-－.．][0-9０-９]+)*|[一二三四五六七八九十百千万零〇两]+)\s*(?:场(?:景)?|幕)?\s*[.．、:：)）-]?\s*/u;
const CHINESE_HEADING = /^(?:内外景|内景|外景)(?=$|[\s:：.．、·/\-—])/u;
const FOUNTAIN_HEADING = /^(?:(?:INT|EXT)\.?\s*\/\s*(?:INT|EXT)\.?|I\/E\.?|INT\.?|EXT\.?|EST\.?)(?=$|[\s:：\-—])/iu;
const SHORT_CHINESE_NAME = /^[\p{Script=Han}][\p{Script=Han}· ]{0,15}$/u;
const UPPERCASE_NAME = /^[A-Z][A-Z0-9 .’'\-]{0,39}$/u;
const TITLE_PAGE_KEY = /^(?:title|credit|authors?|source|draft[ \t]+date|contact|copyright|notes)[ \t]*:/iu;

/** Recognize only standard Fountain metadata, indented continuations and blank lines. */
export function isTitlePage(lines: string[]): boolean {
  let hasMetadata = false;
  for (const line of lines) {
    if (!line.trim()) continue;
    if (isSceneHeading(line)) return false;
    if (TITLE_PAGE_KEY.test(line.trim())) {
      hasMetadata = true;
    } else if (!hasMetadata || !/^[ \t]+/u.test(line)) {
      return false;
    }
  }
  return true;
}

function isSceneHeading(line: string): boolean {
  const value = line.trim();
  if (/^\.(?!\.)(?=.*\S)/u.test(value)) return true;
  const unnumbered = value.replace(NUMBERED_PREFIX, "");
  return CHINESE_HEADING.test(unnumbered) || FOUNTAIN_HEADING.test(unnumbered);
}

function cueName(value: string): string {
  return value.trim().replace(/\s*\^\s*$/u, "")
    .replace(/(?:\s*[（(][^（）()]*[）)])+\s*$/u, "").trim();
}

function collectCandidates(lines: string[], firstSceneLine = 1): EntityCandidate[] {
  const candidates = new Map<string, EntityCandidate>();
  const priority = { candidate: 0, dialogue: 1, tag: 2, forced: 3 };
  function add(
    name: string, kind: EntityCandidate["kind"], source: EntityCandidate["source"],
    line: number, reason: string,
  ): void {
    if (!name) return;
    const key = `${kind}\u0000${name}`;
    const previous = candidates.get(key);
    if (!previous) {
      candidates.set(key, { name, kind, source, reason, lineNumbers: [line] });
      return;
    }
    if (previous.lineNumbers.at(-1) !== line) previous.lineNumbers.push(line);
    if (priority[source] > priority[previous.source]) {
      previous.source = source;
      previous.reason = reason;
    }
  }
  lines.forEach((line, index) => {
    if (index + 1 < firstSceneLine) return;
    const value = line.trim();
    for (const match of line.matchAll(/【道具[：:]([^】]+)】/gu)) {
      add(match[1].trim(), "prop", "tag", index + 1, "原文显式道具标记，仍需人工确认。");
    }
    if (!value || isSceneHeading(value)) return;
    if (value.startsWith("@")) {
      add(cueName(value.slice(1)), "character", "forced", index + 1,
        "原文使用 @ 角色标记，已移除末尾括号说明，仍需人工确认。");
      return;
    }
    const dialogue = value.match(/^([^:：]{1,40})[:：]\s*\S/u);
    if (dialogue) {
      const name = cueName(dialogue[1]);
      if (SHORT_CHINESE_NAME.test(name)) {
        add(name, "character", "dialogue", index + 1, "匹配姓名加冒号的对白格式，仍需人工确认。");
        return;
      }
    }
    if (SHORT_CHINESE_NAME.test(value)) {
      add(value, "character", "candidate", index + 1,
        "独行短中文可能是角色、动作或对白，必须人工确认。");
      return;
    }
    const name = cueName(value);
    const followsBlankOrHeading = index === 0 || !lines[index - 1].trim()
      || isSceneHeading(lines[index - 1]);
    const next = lines[index + 1]?.trim();
    if (UPPERCASE_NAME.test(name) && followsBlankOrHeading && next && !isSceneHeading(next)) {
      add(name, "character", "dialogue", index + 1,
        "匹配大写角色名后接对白的格式，仍需人工确认。");
    }
  });
  return [...candidates.values()];
}

export function parseScript(text: string, options?: { sceneStarts?: number[] }): ParsedScript {
  const normalized = text.replace(/^\uFEFF/u, "").replace(/\r\n?/gu, "\n");
  const diagnostics: Diagnostic[] = [];
  const parsed: ParsedScript = {
    text: normalized, lines: [], scenes: [], entityCandidates: [], diagnostics, canImport: false,
  };
  if (text.length > MAX_TEXT_LENGTH) {
    diagnostics.push({ code: "TEXT_TOO_LARGE", level: "error", message: `文本超过 ${MAX_TEXT_LENGTH} 字符上限。` });
    return parsed;
  }
  parsed.lines = normalized.split("\n");
  if (!normalized.trim()) {
    diagnostics.push({ code: "EMPTY_TEXT", level: "error", message: "请输入非空剧本文本。" });
    return parsed;
  }
  const nullIndex = normalized.indexOf("\u0000");
  if (nullIndex >= 0) {
    diagnostics.push({
      code: "NULL_CHARACTER", level: "error", message: "文本含 NUL 字符，无法作为剧本文本导入。",
      line: normalized.slice(0, nullIndex).split("\n").length,
    });
    return parsed;
  }
  const lines = parsed.lines;
  let boundaries: { lineStart: number; heading: string }[];
  if (options?.sceneStarts !== undefined) {
    const starts = options.sceneStarts;
    if (!Array.isArray(starts) || starts.length === 0 || starts[0] !== 1
      || starts.some((line, index) => !Number.isInteger(line) || line < 1 || line > lines.length
        || (index > 0 && line <= starts[index - 1]))) {
      diagnostics.push({
        code: "INVALID_SCENE_STARTS", level: "error",
        message: "手动场次起始行须从第 1 行开始，使用范围内的整数，且严格递增、不重复。",
      });
      return parsed;
    }
    boundaries = starts.map(line => ({ lineStart: line, heading: lines[line - 1].trim() || "未分场内容" }));
  } else {
    boundaries = lines.flatMap((line, index) => isSceneHeading(line)
      ? [{ lineStart: index + 1, heading: line.trim() }] : []);
    if (boundaries.length === 0) {
      boundaries = [{ lineStart: 1, heading: "未分场内容" }];
      diagnostics.push({
        code: "NO_SCENE_HEADINGS", level: "warning", line: 1,
        message: "未识别到场头；已完整保留文本为待确认场次，请手动分场。",
      });
    } else if (boundaries[0].lineStart > 1) {
      const first = boundaries[0].lineStart;
      const prefix = lines.slice(0, first - 1);
      if (!isTitlePage(prefix)) {
        boundaries.unshift({ lineStart: 1, heading: "未分场内容" });
        diagnostics.push({
          code: "UNASSIGNED_CONTENT", level: "warning", line: 1,
          message: "首个场头之前有文本，已保留为未分场内容，请人工校正。",
        });
      } else if (prefix.some(line => line.trim())) {
        diagnostics.push({
          code: "TITLE_PAGE_METADATA", level: "warning",
          line: prefix.findIndex(line => line.trim()) + 1,
          message: "已识别 Fountain 标题页；元数据完整保留在原文中，不计入场次。",
        });
      }
    }
  }
  if (boundaries.length > MAX_SCENES) {
    diagnostics.push({ code: "TOO_MANY_SCENES", level: "error", message: `场次数超过 ${MAX_SCENES} 场上限。` });
    return parsed;
  }
  parsed.scenes = boundaries.map((boundary, index) => {
    const lineEnd = index + 1 < boundaries.length ? boundaries[index + 1].lineStart - 1 : lines.length;
    return {
      id: `draft-scene-${boundary.lineStart}`, number: index + 1, heading: boundary.heading,
      lineStart: boundary.lineStart, lineEnd,
      text: lines.slice(boundary.lineStart - 1, lineEnd).join("\n"),
    };
  });
  parsed.entityCandidates = collectCandidates(lines, parsed.scenes[0].lineStart);
  const ambiguous = parsed.entityCandidates.filter(candidate => candidate.source === "candidate");
  if (ambiguous.length > 0) {
    diagnostics.push({
      code: "CHARACTER_REVIEW_REQUIRED", level: "warning", line: ambiguous[0].lineNumbers[0],
      message: `发现 ${ambiguous.length} 个独行短中文候选，可能包含动作或对白，请人工确认。`,
    });
  }
  parsed.canImport = true;
  return parsed;
}

export function createProject(input: { title: string; text: string; origin?: Project["origin"]; versionLabel?: string; sceneStarts?: number[] }, now = Date.now()): Project {
  assertTime(now);
  const title = requiredText(input.title, 120, "项目名称");
  const origin = input.origin ?? "paste";
  if (!["import", "paste", "sample"].includes(origin)) fail("INVALID_ORIGIN", "项目来源无效。");
  const version = newVersion(input.text, input.versionLabel ?? "初稿", input.sceneStarts, now);
  return { schemaVersion: 2, id: newId(), title, origin, activeVersionId: version.id,
    versions: [version], entities: [], issues: [], createdAt: now, updatedAt: now };
}
export function addVersion(project: Project, input: { text: string; label?: string; sceneStarts?: number[] }, now = Date.now()): Project {
  assertTime(now, project.updatedAt);
  if (project.versions.length >= DOMAIN_LIMITS.versions) fail("VERSION_LIMIT", "项目最多保存 30 个版本，请先导出备份。");
  const version = newVersion(input.text, input.label ?? `第 ${project.versions.length + 1} 版`, input.sceneStarts, now);
  if (project.versions.reduce((total, item) => total + item.text.length, version.text.length) > DOMAIN_LIMITS.totalTextLength)
    fail("PROJECT_TOO_LARGE", "项目各版本的文本总量超过上限，请分项目管理。");
  return { ...project, versions: [...project.versions, version], activeVersionId: version.id, updatedAt: now };
}
export function setEntities(project: Project, inputs: EntityInput[], now = Date.now()): Project {
  assertTime(now, project.updatedAt);
  if (!Array.isArray(inputs) || inputs.length > DOMAIN_LIMITS.entities) fail("ENTITY_LIMIT", "最多保存 500 个角色或道具。");
  const used = new Set<string>();
  const reserved = new Set([project.id, ...project.versions.flatMap(version => [version.id, ...version.scenes.map(scene => scene.id)]), ...project.issues.map(issue => issue.id)]);
  const names = new Set<string>();
  const entities = inputs.map(input => {
    if (input.kind !== "character" && input.kind !== "prop") fail("INVALID_ENTITY", "角色或道具类型无效。");
    const name = requiredText(input.name, 80, "角色或道具名称");
    const key = `${input.kind}:${name.toLocaleLowerCase()}`;
    if (names.has(key)) fail("DUPLICATE_ENTITY", "同类角色或道具名称重复，请合并别名。");
    names.add(key);
    const id = input.id ?? newId();
    if (!validId(id) || used.has(id) || reserved.has(id)) fail("INVALID_ENTITY_ID", "角色或道具编号无效或与其他记录重复。");
    used.add(id);
    if (input.confirmed !== undefined && typeof input.confirmed !== "boolean") fail("INVALID_ENTITY", "确认状态无效。");
    if (input.aliases !== undefined && (!Array.isArray(input.aliases) || input.aliases.length > 30)) fail("INVALID_ALIAS", "每个角色或道具最多设置 30 个别名。");
    const aliases: string[] = [];
    const aliasKeys = new Set([name.toLocaleLowerCase()]);
    for (const inputAlias of input.aliases ?? []) {
      const alias = requiredText(inputAlias, 80, "别名");
      if (!aliasKeys.has(alias.toLocaleLowerCase())) aliases.push(alias);
      aliasKeys.add(alias.toLocaleLowerCase());
    }
    return { id, name, kind: input.kind, aliases, confirmed: input.confirmed ?? true };
  });
  assertEntityNames(entities);
  return { ...project, entities, updatedAt: now };
}
export function buildGraph(project: Project, versionId = project.activeVersionId): ProjectGraph {
  const version = getVersion(project, versionId);
  const entities = project.entities.filter(entity => entity.confirmed);
  const mentions: GraphMention[] = [];
  const edges: ProjectGraph["edges"] = [];
  const lines = version.text.split("\n");
  for (const scene of version.scenes) {
    for (const entity of entities) {
      const refs: EvidenceRef[] = [];
      for (let line = scene.lineStart; line <= scene.lineEnd; line += 1) {
        const alias = [entity.name, ...entity.aliases].find(value => literalIncludes(lines[line - 1], value));
        if (!alias) continue;
        const ref: EvidenceRef = { versionId, sceneId: scene.id, lineStart: line, lineEnd: line, quote: lines[line - 1] };
        mentions.push({ entityId: entity.id, sceneId: scene.id, alias, ref });
        refs.push(ref);
      }
      if (refs.length) edges.push({ entityId: entity.id, sceneId: scene.id, refs });
    }
  }
  return { versionId, entities, mentions, edges };
}
export function queryProject(project: Project, query: string, options: { versionId?: string; limit?: number; method?: "text" | "graph" } = {}): LocalQueryResult {
  const version = getVersion(project, options.versionId ?? project.activeVersionId);
  const method = options.method ?? "text";
  if (method !== "text" && method !== "graph") fail("INVALID_METHOD", "请选择原文检索或实体关联检索。");
  const normalized = typeof query === "string" ? query.trim() : "";
  const response: LocalQueryResult = { query: normalized, versionId: version.id, method, results: [], message: "" };
  if (!normalized || normalized.length > 200) return { ...response, message: "请输入 1–200 字的原文关键词，多个词用空格分隔。" };
  const terms = [...new Set(normalized.split(/\s+/u).map(term => term.toLocaleLowerCase()))];
  const sceneRequest = normalized.match(/^(?:第\s*)?(\d+)\s*场(?:景)?$/u);
  const requestedNumber = sceneRequest ? Number(sceneRequest[1]) : null;
  const limit = Number.isInteger(options.limit) ? Math.max(1, Math.min(options.limit!, 100)) : 30;
  const lines = version.text.split("\n");
  const direct: QueryMatch[] = [];
  for (const scene of version.scenes) {
    if (requestedNumber !== null ? scene.number !== requestedNumber : !terms.every(term => literalIncludes(scene.text, term))) continue;
    const relativeLine = requestedNumber !== null ? 0 : lines.slice(scene.lineStart - 1, scene.lineEnd).findIndex(line => terms.some(term => literalIncludes(line, term)));
    const matchedLine = scene.lineStart + Math.max(0, relativeLine);
    const ref: EvidenceRef = { versionId: version.id, sceneId: scene.id, lineStart: matchedLine, lineEnd: matchedLine, quote: lines[matchedLine - 1] };
    direct.push({ sceneId: scene.id, sceneNumber: scene.number, heading: scene.heading,
      kind: "direct", excerpt: ref.quote, ref, matchedTerms: terms });
  }
  if (!direct.length) return { ...response, message: requestedNumber !== null ? `当前版本没有第 ${requestedNumber} 场；未扩展关联场次。` : "当前版本没有直接命中；未扩展关联场次。请使用原文词语或已确认的名称检索。" };
  const related: QueryMatch[] = [];
  if (method === "graph") {
    const graph = buildGraph(project, version.id);
    const directIds = new Set(direct.map(match => match.sceneId));
    const seen = new Set(directIds);
    for (const seed of direct) {
      for (const edge of graph.edges.filter(item => item.sceneId === seed.sceneId)) {
        const entity = graph.entities.find(item => item.id === edge.entityId)!;
        for (const neighbor of graph.edges.filter(item => item.entityId === entity.id)) {
          if (seen.has(neighbor.sceneId)) continue;
          const scene = version.scenes.find(item => item.id === neighbor.sceneId)!;
          const ref = neighbor.refs[0];
          related.push({ sceneId: scene.id, sceneNumber: scene.number, heading: scene.heading,
            kind: "related", excerpt: ref.quote, ref, matchedTerms: [],
            path: { entityId: entity.id, entityName: entity.name, fromSceneId: seed.sceneId, toSceneId: scene.id } });
          seen.add(scene.id);
        }
      }
    }
  }
  const results = [...direct, ...related].slice(0, limit);
  const summary = `${requestedNumber !== null ? "按当前稿本场次编号定位：" : ""}${direct.length} 个场次直接命中${method === "graph" ? `，${related.length} 个场次经已确认实体的原文提及关联` : ""}。`;
  return { ...response, results, message: summary + (direct.length + related.length > limit ? `当前展示前 ${limit} 个。` : "") + "这些是复核线索，不是剧情事实推断。" };
}
export function diffVersions(project: Project, fromVersionId: string, toVersionId: string): VersionDiff {
  const from = getVersion(project, fromVersionId);
  const to = getVersion(project, toVersionId);
  const changes: SceneChange[] = [];
  const oldRemaining = new Set(from.scenes.map(scene => scene.id));
  const newRemaining = new Set(to.scenes.map(scene => scene.id));
  const pairs: { before: Scene; after: Scene; change: SceneChange }[] = [];
  function addPair(before: Scene, after: Scene, kind: "unchanged" | "modified") {
    const change: SceneChange = { id: `${before.id}:${after.id}`, kind, fromSceneId: before.id, toSceneId: after.id,
      fromSceneIds: [before.id], toSceneIds: [after.id], moved: false,
      summary: kind === "unchanged" ? "原文内容一致（忽略场序标记、场头格式与首尾空白）。" : "唯一同名场头的内容有变化，请核对两版原文。" };
    changes.push(change); pairs.push({ before, after, change });
    oldRemaining.delete(before.id); newRemaining.delete(after.id);
  }
  const oldText = groupBy(from.scenes, sceneContentKey);
  const newText = groupBy(to.scenes, sceneContentKey);
  for (const [key, before] of oldText) {
    const after = newText.get(key) ?? [];
    if (before.length === 1 && after.length === 1) addPair(before[0], after[0], "unchanged");
  }
  const oldHeadings = groupBy(from.scenes, scene => canonicalHeading(scene.heading));
  const newHeadings = groupBy(to.scenes, scene => canonicalHeading(scene.heading));
  for (const [heading, allBefore] of oldHeadings) {
    const allAfter = newHeadings.get(heading) ?? [];
    const before = allBefore.filter(scene => oldRemaining.has(scene.id));
    const after = allAfter.filter(scene => newRemaining.has(scene.id));
    if (!before.length || !after.length) continue;
    if (allBefore.length === 1 && allAfter.length === 1) addPair(before[0], after[0], "modified");
    else {
      changes.push({ id: `ambiguous:${before.map(s => s.id).join(":")}`, kind: "ambiguous",
        fromSceneIds: before.map(scene => scene.id), toSceneIds: after.map(scene => scene.id), moved: false,
        summary: "场头重复且原文无法唯一对应；未按场次编号自动匹配，请人工核对。" });
      before.forEach(scene => oldRemaining.delete(scene.id)); after.forEach(scene => newRemaining.delete(scene.id));
    }
  }
  // A numeric shift after insertion is not a move. Only reversed order among matched scenes is.
  for (const pair of pairs) {
    pair.change.moved = pairs.some(other => (pair.before.number - other.before.number) * (pair.after.number - other.after.number) < 0);
    if (pair.change.moved) pair.change.summary += " 与其他已匹配场次的先后顺序发生变化。";
  }
  for (const scene of from.scenes.filter(scene => oldRemaining.has(scene.id))) changes.push({ id: `removed:${scene.id}`, kind: "removed", fromSceneId: scene.id, fromSceneIds: [scene.id], toSceneIds: [], moved: false, summary: "新版没有唯一对应的场次；可能删除或更名，需人工确认。" });
  for (const scene of to.scenes.filter(scene => newRemaining.has(scene.id))) changes.push({ id: `added:${scene.id}`, kind: "added", toSceneId: scene.id, fromSceneIds: [], toSceneIds: [scene.id], moved: false, summary: "旧版没有唯一对应的场次；可能新增或更名，需人工确认。" });
  const counts: VersionDiff["counts"] = { unchanged: 0, modified: 0, added: 0, removed: 0, ambiguous: 0, moved: 0 };
  changes.forEach(change => { counts[change.kind] += 1; if (change.moved) counts.moved += 1; });
  return { fromVersionId, toVersionId, changes, counts };
}
export function makeEvidence(project: Project, versionId: string, sceneId: string, lineStart?: number, lineEnd?: number): EvidenceRef {
  const version = getVersion(project, versionId);
  const scene = version.scenes.find(item => item.id === sceneId);
  if (!scene) fail("UNKNOWN_SCENE", "该版本不存在此场次。");
  const start = lineStart ?? scene.lineStart;
  const end = lineEnd ?? scene.lineEnd;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < scene.lineStart || end > scene.lineEnd || end < start)
    fail("INVALID_EVIDENCE_RANGE", "引用行号必须处于同一场次内。");
  return { versionId, sceneId, lineStart: start, lineEnd: end, quote: version.text.split("\n").slice(start - 1, end).join("\n") };
}
export function resolveEvidence(project: Project, ref: EvidenceRef): { version: ScriptVersion; scene: Scene; text: string } | null {
  if (!ref || typeof ref !== "object" || !validId(ref.versionId) || !validId(ref.sceneId) || !Number.isInteger(ref.lineStart) || !Number.isInteger(ref.lineEnd) || typeof ref.quote !== "string") return null;
  try {
    const actual = makeEvidence(project, ref.versionId, ref.sceneId, ref.lineStart, ref.lineEnd);
    if (actual.quote !== ref.quote) return null;
    const version = getVersion(project, ref.versionId);
    return { version, scene: version.scenes.find(item => item.id === ref.sceneId)!, text: actual.quote };
  } catch { return null; }
}
export function createIssue(project: Project, input: IssueInput, now = Date.now()): Project {
  assertTime(now, project.updatedAt);
  if (project.issues.length >= DOMAIN_LIMITS.issues) fail("ISSUE_LIMIT", "最多保存 1000 条审阅问题。");
  const fields = issueFields(project, { title: input.title, note: input.note ?? "", status: input.status ?? "open", evidence: input.evidence ?? [] });
  const issue: ReviewIssue = { ...fields, id: newId(), createdVersionId: project.activeVersionId,
    reviewedVersionId: fields.evidence.some(ref => ref.versionId === project.activeVersionId && ref.quote.trim()) ? project.activeVersionId : null, createdAt: now, updatedAt: now };
  return { ...project, issues: [...project.issues, issue], updatedAt: now };
}
export function updateIssue(project: Project, issueId: string, patch: IssuePatch, now = Date.now()): Project {
  assertTime(now, project.updatedAt);
  const issue = getIssue(project, issueId);
  const fields = issueFields(project, { title: patch.title ?? issue.title, note: patch.note ?? issue.note,
    status: patch.status ?? issue.status, evidence: patch.evidence ?? issue.evidence });
  const reviewedVersionId = fields.evidence.some(ref => ref.versionId === issue.reviewedVersionId && ref.quote.trim()) ? issue.reviewedVersionId : null;
  return replaceIssue(project, { ...issue, ...fields, reviewedVersionId, updatedAt: now }, now);
}
export function reviewIssue(project: Project, issueId: string, input: { versionId?: string; status?: IssueStatus; note?: string; evidence?: EvidenceRef[] } = {}, now = Date.now()): Project {
  assertTime(now, project.updatedAt);
  const issue = getIssue(project, issueId);
  const versionId = input.versionId ?? project.activeVersionId;
  getVersion(project, versionId);
  const fields = issueFields(project, { title: issue.title, note: input.note ?? issue.note, status: input.status ?? issue.status,
    evidence: input.evidence ?? issue.evidence });
  if (!fields.evidence.some(ref => ref.versionId === versionId && ref.quote.trim())) fail("CURRENT_EVIDENCE_REQUIRED", "复核该稿本前，请附上至少一处该版本的原文依据。删除场次的问题也可引用相邻场说明处理结果。");
  return replaceIssue(project, { ...issue, ...fields, reviewedVersionId: versionId, updatedAt: now }, now);
}
export function isIssueStale(project: Project, issue: ReviewIssue, versionId = project.activeVersionId): boolean {
  return issue.reviewedVersionId !== versionId;
}
export function validateBackup(raw: unknown): BackupResult {
  try {
    if (typeof raw === "string") {
      if (raw.length > DOMAIN_LIMITS.backupLength) fail("BACKUP_TOO_LARGE", "备份文件超过大小上限。");
      try { raw = JSON.parse(raw); } catch { fail("INVALID_JSON", "备份不是有效的 JSON 文件。"); }
    }
    let value = record(raw, "项目");
    if (value.format !== undefined) {
      if (value.format !== "scriptgraph-project" || value.schemaVersion !== 2) fail("INVALID_FORMAT", "备份格式或版本不受支持。");
      value = record(value.project, "项目");
    }
    if (value.schemaVersion !== 2) fail("INVALID_VERSION", "只支持本机工作台 v2 项目备份。");
    const id = readId(value.id);
    const title = requiredText(value.title, 120, "项目名称");
    if (value.origin !== "import" && value.origin !== "paste" && value.origin !== "sample") fail("INVALID_ORIGIN", "项目来源无效。");
    const createdAt = readTime(value.createdAt);
    const updatedAt = readTime(value.updatedAt, createdAt);
    const versionsData = list(value.versions, DOMAIN_LIMITS.versions, "版本");
    if (!versionsData.length) fail("NO_VERSIONS", "项目至少需要一个版本。");
    const ids = new Set<string>([id]);
    let totalLength = 0;
    const versions: ScriptVersion[] = versionsData.map(item => {
      const data = record(item, "版本");
      const versionId = uniqueId(data.id, ids);
      const label = requiredText(data.label, 120, "版本名称");
      const time = readTime(data.createdAt, createdAt, updatedAt);
      if (typeof data.text !== "string" || !data.text.trim() || data.text.length > MAX_TEXT_LENGTH || data.text.includes("\u0000") || data.text.includes("\r") || data.text.startsWith("\uFEFF")) fail("INVALID_SOURCE", "剧本原文为空、过大或未经标准化。");
      const text = data.text;
      totalLength += text.length;
      if (totalLength > DOMAIN_LIMITS.totalTextLength) fail("PROJECT_TOO_LARGE", "项目文本总量超过上限。");
      const lines = text.split("\n");
      const scenesData = list(data.scenes, MAX_SCENES, "场次");
      if (!scenesData.length) fail("NO_SCENES", "版本至少需要一个场次片段。");
      const firstSceneData = record(scenesData[0], "场次");
      const firstLine = firstSceneData.lineStart;
      if (!Number.isInteger(firstLine) || (firstLine as number) < 1 || (firstLine as number) > lines.length || !isTitlePage(lines.slice(0, (firstLine as number) - 1))) fail("SOURCE_GAP", "场次前只能保留已识别标题页或空白，不能遗漏剧本文字。");
      let nextLine = firstLine as number;
      const scenes: Scene[] = scenesData.map((entry, index) => {
        const scene = record(entry, "场次");
        const sceneId = uniqueId(scene.id, ids);
        const heading = requiredText(scene.heading, MAX_TEXT_LENGTH, "场头");
        if (scene.number !== index + 1 || scene.lineStart !== nextLine || !Number.isInteger(scene.lineEnd) || (scene.lineEnd as number) < nextLine || (scene.lineEnd as number) > lines.length) fail("INVALID_SCENE_RANGE", "场次行号须连续、完整覆盖所属版本原文，序号不得重复。");
        const lineEnd = scene.lineEnd as number;
        const source = lines.slice(nextLine - 1, lineEnd).join("\n");
        if (scene.text !== source) fail("SOURCE_MISMATCH", "场次文字与所属版本原文不一致。");
        if (heading !== "未分场内容" && !lines.slice(nextLine - 1, lineEnd).some(line => line.trim() === heading)) fail("HEADING_MISMATCH", "场头不存在于场次原文中。");
        const result = { id: sceneId, number: index + 1, heading, lineStart: nextLine, lineEnd, text: source };
        nextLine = lineEnd + 1;
        return result;
      });
      if (nextLine !== lines.length + 1) fail("SOURCE_GAP", "场次未完整覆盖版本原文。");
      const diagnostics = list(data.diagnostics, 5000, "解析提示").map(entry => {
        const diagnostic = record(entry, "解析提示");
        if (diagnostic.level !== "warning") fail("INVALID_DIAGNOSTIC", "已导入版本不能包含解析失败状态。");
        const result: Diagnostic = { code: requiredText(diagnostic.code, 100, "提示编号"), level: "warning", message: requiredText(diagnostic.message, 1000, "提示内容") };
        if (diagnostic.line !== undefined) {
          if (!Number.isInteger(diagnostic.line) || (diagnostic.line as number) < 1 || (diagnostic.line as number) > lines.length) fail("INVALID_DIAGNOSTIC", "解析提示行号超出原文。");
          result.line = diagnostic.line as number;
        }
        return result;
      });
      return { id: versionId, label, createdAt: time, text, scenes, diagnostics };
    });
    const activeVersionId = readId(value.activeVersionId);
    if (!versions.some(version => version.id === activeVersionId)) fail("UNKNOWN_VERSION", "当前版本不存在。");
    const entities = list(value.entities, DOMAIN_LIMITS.entities, "实体").map(item => {
      const entity = record(item, "实体");
      if (entity.kind !== "character" && entity.kind !== "prop") fail("INVALID_ENTITY", "实体类型无效。");
      if (typeof entity.confirmed !== "boolean") fail("INVALID_ENTITY", "实体确认状态无效。");
      return { id: uniqueId(entity.id, ids), kind: entity.kind, name: requiredText(entity.name, 80, "实体名称"),
        aliases: list(entity.aliases, 30, "别名").map(alias => requiredText(alias, 80, "别名")), confirmed: entity.confirmed } as Entity;
    });
    const entityNames = entities.map(entity => `${entity.kind}:${entity.name.toLocaleLowerCase()}`);
    if (new Set(entityNames).size !== entityNames.length || entities.some(entity => new Set(entity.aliases).size !== entity.aliases.length)) fail("DUPLICATE_ENTITY", "实体或别名重复。");
    assertEntityNames(entities);
    const project: Project = { schemaVersion: 2, id, title, origin: value.origin, activeVersionId, versions, entities, issues: [], createdAt, updatedAt };
    project.issues = list(value.issues, DOMAIN_LIMITS.issues, "审阅问题").map(item => {
      const data = record(item, "审阅问题");
      const issueId = uniqueId(data.id, ids);
      const createdVersionId = readId(data.createdVersionId);
      getVersion(project, createdVersionId);
      const reviewedVersionId = data.reviewedVersionId === null ? null : readId(data.reviewedVersionId);
      if (reviewedVersionId !== null) getVersion(project, reviewedVersionId);
      const time = readTime(data.createdAt, getVersion(project, createdVersionId).createdAt, updatedAt);
      const updated = readTime(data.updatedAt, time, updatedAt);
      if (reviewedVersionId && getVersion(project, reviewedVersionId).createdAt > updated) fail("INVALID_REVIEW_TIME", "重核记录早于被核对的版本。");
      const evidence = list(data.evidence, 100, "引用").map(entry => readEvidence(entry));
      const fields = issueFields(project, { title: data.title as string, note: data.note as string, status: data.status as IssueStatus, evidence });
      if (evidence.some(ref => getVersion(project, ref.versionId).createdAt > updated)) fail("INVALID_EVIDENCE_TIME", "引用记录早于引用的版本。");
      if (reviewedVersionId && !evidence.some(ref => ref.versionId === reviewedVersionId && ref.quote.trim())) fail("INVALID_REVIEW", "已核对的版本必须保留该版本的原文依据。");
      return { id: issueId, ...fields, createdVersionId, reviewedVersionId, createdAt: time, updatedAt: updated };
    });
    return { ok: true, project, errors: [] };
  } catch (error) { return { ok: false, errors: [error instanceof DomainError ? error.message : "备份格式异常，未导入任何内容。"] }; }
}
export function cloneProject(project: Project, options: { title?: string } = {}, now = Date.now()): Project {
  assertTime(now, project.updatedAt);
  const validated = validateBackup(project);
  if (!validated.ok) fail("INVALID_PROJECT", validated.errors.join(" "));
  // Preserve source timestamps and all internal IDs; only the library identity changes.
  return { ...validated.project, id: newId(), title: requiredText(options.title ?? `${project.title.slice(0, 110)}（副本）`, 120, "项目名称"), updatedAt: now };
}

function fail(code: string, message: string): never { throw new DomainError(code, message); }
function newId(): string { return crypto.randomUUID(); }
function validId(value: unknown): value is string { return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/u.test(value) && !["__proto__", "constructor", "prototype"].includes(value); }
function readId(value: unknown): string { if (!validId(value)) fail("INVALID_ID", "记录编号无效。"); return value; }
function uniqueId(value: unknown, ids: Set<string>): string { const id = readId(value); if (ids.has(id)) fail("DUPLICATE_ID", "记录编号重复。"); ids.add(id); return id; }
function requiredText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || !value.trim() || value.trim().length > max || value.includes("\u0000")) fail("INVALID_TEXT", `${label}不能为空或超过 ${max} 字符。`);
  return value.trim();
}
function optionalText(value: unknown, max: number, label: string): string {
  if (typeof value !== "string" || value.length > max || value.includes("\u0000")) fail("INVALID_TEXT", `${label}格式无效或超过 ${max} 字符。`);
  return value;
}
function assertTime(value: number, min = 0): void {
  if (!Number.isSafeInteger(value) || value < min || value > Date.now() + 300_000) fail("INVALID_TIME", "记录时间无效，请检查设备时间。");
}
function readTime(value: unknown, min = 0, max = Date.now() + 300_000): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < min || value > max) fail("INVALID_TIME", "备份时间无效。");
  return value;
}
function record(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail("INVALID_RECORD", `${label}格式无效。`);
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) fail("INVALID_RECORD", `${label}不是普通数据对象。`);
  return value as Record<string, unknown>;
}
function list(value: unknown, max: number, label: string): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail("INVALID_LIST", `${label}不是列表或数量超过上限。`);
  return value;
}
function getVersion(project: Project, id: string): ScriptVersion {
  const version = project.versions.find(item => item.id === id);
  if (!version) fail("UNKNOWN_VERSION", "找不到所选剧本版本。");
  return version;
}
function getIssue(project: Project, id: string): ReviewIssue {
  const issue = project.issues.find(item => item.id === id);
  if (!issue) fail("UNKNOWN_ISSUE", "找不到此审阅问题。");
  return issue;
}
function newVersion(text: string, label: string, sceneStarts: number[] | undefined, now: number): ScriptVersion {
  const parsed = parseScript(text, { sceneStarts });
  if (!parsed.canImport) fail("INVALID_SCRIPT", parsed.diagnostics.filter(item => item.level === "error").map(item => item.message).join(" "));
  return { id: newId(), label: requiredText(label, 120, "版本名称"), createdAt: now, text: parsed.text,
    scenes: parsed.scenes.map(scene => ({ ...scene, id: newId() })), diagnostics: parsed.diagnostics };
}
function literalIncludes(text: string, term: string): boolean {
  const source = text.toLocaleLowerCase(); const needle = term.toLocaleLowerCase();
  let start = source.indexOf(needle);
  // Latin identifiers require word boundaries; Chinese remains explicit substring matching.
  while (start !== -1) {
    const before = source[start - 1] ?? ""; const after = source[start + needle.length] ?? "";
    if ((!/^[a-z0-9_]/u.test(needle) || !/[a-z0-9_]/u.test(before)) && (!/[a-z0-9_]$/u.test(needle) || !/[a-z0-9_]/u.test(after))) return true;
    start = source.indexOf(needle, start + 1);
  }
  return false;
}
function canonicalHeading(heading: string): string {
  let value = heading.replace(/^\.(?!\.)/u, "");
  const unnumbered = value.replace(NUMBERED_PREFIX, "");
  if (CHINESE_HEADING.test(unnumbered) || FOUNTAIN_HEADING.test(unnumbered)) value = unnumbered;
  return value.replace(/\s*#[^#]+#\s*$/u, "").replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}
function sceneContentKey(scene: Scene): string {
  const lines = scene.text.split("\n");
  const headingLine = lines.findIndex(line => line.trim() === scene.heading);
  if (headingLine !== -1) lines[headingLine] = canonicalHeading(scene.heading);
  return lines.join("\n").trim();
}
function groupBy(items: Scene[], key: (scene: Scene) => string): Map<string, Scene[]> {
  const result = new Map<string, Scene[]>();
  for (const item of items) { const value = key(item); result.set(value, [...(result.get(value) ?? []), item]); }
  return result;
}
function readEvidence(raw: unknown): EvidenceRef {
  const data = record(raw, "引用");
  if (!Number.isInteger(data.lineStart) || !Number.isInteger(data.lineEnd) || typeof data.quote !== "string" || data.quote.length > MAX_TEXT_LENGTH) fail("INVALID_EVIDENCE", "引用格式无效。");
  return { versionId: readId(data.versionId), sceneId: readId(data.sceneId), lineStart: data.lineStart as number, lineEnd: data.lineEnd as number, quote: data.quote };
}
function issueFields(project: Project, input: Required<IssueInput>): Required<IssueInput> {
  const title = requiredText(input.title, 180, "问题标题");
  const note = optionalText(input.note, 10_000, "审阅备注");
  if (!["open", "working", "resolved", "dismissed"].includes(input.status)) fail("INVALID_STATUS", "问题状态无效。");
  if (!Array.isArray(input.evidence) || input.evidence.length > 100) fail("INVALID_EVIDENCE", "每条问题最多保存 100 条引用。");
  const evidence = input.evidence.map(ref => {
    const clean = readEvidence(ref);
    if (!resolveEvidence(project, clean)) fail("INVALID_EVIDENCE", "引用不能在所属版本中验证，请重新选取原文。");
    return clean;
  });
  if (input.status === "resolved" && !evidence.some(ref => ref.quote.trim())) fail("EVIDENCE_REQUIRED", "解决问题前，请至少附一条非空且可核对的原文引用。");
  return { title, note, status: input.status, evidence };
}
function replaceIssue(project: Project, issue: ReviewIssue, now: number): Project {
  return { ...project, issues: project.issues.map(item => item.id === issue.id ? issue : item), updatedAt: now };
}

function assertEntityNames(entities: Entity[]): void {
  const owner = new Map<string, string>();
  for (const entity of entities.filter(item => item.confirmed)) {
    for (const name of [entity.name, ...entity.aliases]) {
      const key = name.toLocaleLowerCase();
      const previous = owner.get(key);
      if (previous && previous !== entity.id) fail("AMBIGUOUS_ALIAS", `「${name}」同时指向多个已确认对象。请调整别名或先暂停其中一项，避免误合并关联。`);
      owner.set(key, entity.id);
    }
  }
}
