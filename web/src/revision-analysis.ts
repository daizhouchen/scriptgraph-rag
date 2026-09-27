/** Evidence-based revision assistance. Results never replace a saved citation or a human review. */
import { diffVersions, makeEvidence, resolveEvidence, type EvidenceRef, type Project, type ReviewIssue, type Scene, type ScriptVersion, type VersionDiff } from './domain.ts';

export type DiffRow = { kind: 'same' | 'added' | 'removed'; text: string; beforeLine?: number; afterLine?: number };
export type DiffResult = { rows: DiffRow[]; truncated: boolean };
export type EvidenceKind = 'unchanged' | 'context' | 'moved' | 'changed' | 'missing' | 'ambiguous' | 'unanchored';
export type EvidenceMapping = { kind: EvidenceKind; original: EvidenceRef; candidate?: EvidenceRef; reason: string; fromScene?: Scene; toScene?: Scene };
export type ImpactKind = EvidenceKind | 'reviewed';
export type IssueImpact = { kind: ImpactKind; label: string; reason: string; mappings: EvidenceMapping[]; priority: number };

const LCS_CELL_BUDGET = 500_000;
const labels: Record<ImpactKind, string> = {
  reviewed: '已复核目标稿', unchanged: '引用未变', context: '同场上下文有变化', moved: '引用位置有变化',
  changed: '引用原文有变化', missing: '未找到原引用', ambiguous: '引用对应待确认', unanchored: '缺少有效依据',
};
const priorities: Record<ImpactKind, number> = { reviewed: 0, unchanged: 10, context: 40, moved: 50, unanchored: 70, changed: 80, missing: 90, ambiguous: 100 };
const linesOf = (text: string): string[] => text === '' ? [] : text.split('\n');

/**
 * A deterministic line diff. `truncated` means fine matching was downgraded,
 * never that source lines were discarded. Even fallback rows reconstruct both inputs.
 */
export function diffLines(before: string, after: string, beforeStart = 1, afterStart = 1): DiffResult {
  if (![beforeStart, afterStart].every(value => Number.isSafeInteger(value) && value >= 1)) throw new RangeError('起始行必须是正整数。');
  const a = linesOf(before), b = linesOf(after), rows: DiffRow[] = [];
  const same = (i: number, j: number) => rows.push({ kind: 'same', text: a[i], beforeLine: beforeStart + i, afterLine: afterStart + j });
  const remove = (i: number) => rows.push({ kind: 'removed', text: a[i], beforeLine: beforeStart + i });
  const add = (j: number) => rows.push({ kind: 'added', text: b[j], afterLine: afterStart + j });
  let prefix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) { same(prefix, prefix); prefix++; }
  let aEnd = a.length, bEnd = b.length;
  while (aEnd > prefix && bEnd > prefix && a[aEnd - 1] === b[bEnd - 1]) { aEnd--; bEnd--; }
  const n = aEnd - prefix, m = bEnd - prefix;
  const truncated = n > 0 && m > 0 && (n + 1) * (m + 1) > LCS_CELL_BUDGET;
  if (!n || !m || truncated) {
    for (let i = prefix; i < aEnd; i++) remove(i);
    for (let j = prefix; j < bEnd; j++) add(j);
  } else {
    // Intern lines so a large shared textual prefix cannot amplify every DP comparison.
    const ids = new Map<string, number>();
    const intern = (line: string) => { let id = ids.get(line); if (id === undefined) { id = ids.size; ids.set(line, id); } return id; };
    const left = a.slice(prefix, aEnd).map(intern), right = b.slice(prefix, bEnd).map(intern);
    const width = m + 1, lcs = new Uint32Array((n + 1) * width);
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--)
      lcs[i * width + j] = left[i] === right[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (left[i] === right[j]) { same(prefix + i, prefix + j); i++; j++; }
      else if (lcs[(i + 1) * width + j] >= lcs[i * width + j + 1]) { remove(prefix + i); i++; }
      else { add(prefix + j); j++; }
    }
    while (i < n) remove(prefix + i++);
    while (j < m) add(prefix + j++);
  }
  for (let i = aEnd, j = bEnd; i < a.length; i++, j++) same(i, j);
  return { rows, truncated };
}

// Versions are immutable domain values; cache pairs, not the mutable UI selection/project wrapper.
const diffCache = new WeakMap<ScriptVersion, WeakMap<ScriptVersion, VersionDiff>>();
function comparison(project: Project, from: ScriptVersion, to: ScriptVersion): VersionDiff {
  let targets = diffCache.get(from);
  if (!targets) { targets = new WeakMap(); diffCache.set(from, targets); }
  let result = targets.get(to);
  if (!result) { result = diffVersions(project, from.id, to.id); targets.set(to, result); }
  return result;
}

/** Complete-line exact occurrences, including overlapping repeats; stop once ambiguous. */
function occurrences(scene: Scene, quote: string): number[] {
  const haystack = scene.text.split('\n'), needle = quote.split('\n');
  if (needle.length > haystack.length) return [];
  const failure = new Uint32Array(needle.length);
  for (let i = 1, j = 0; i < needle.length; i++) {
    while (j && needle[i] !== needle[j]) j = failure[j - 1];
    if (needle[i] === needle[j]) j++;
    failure[i] = j;
  }
  const found: number[] = [];
  for (let i = 0, j = 0; i < haystack.length; i++) {
    while (j && haystack[i] !== needle[j]) j = failure[j - 1];
    if (haystack[i] === needle[j]) j++;
    if (j === needle.length) {
      found.push(scene.lineStart + i - needle.length + 1);
      if (found.length === 2) break;
      j = failure[j - 1];
    }
  }
  return found;
}

export function mapEvidence(project: Project, ref: EvidenceRef, targetVersionId = project.activeVersionId): EvidenceMapping {
  const source = resolveEvidence(project, ref);
  const target = project.versions.find(version => version.id === targetVersionId);
  const base = { original: ref, ...(source ? { fromScene: source.scene } : {}) };
  if (!source || !ref.quote.trim()) return { ...base, kind: 'unanchored', reason: '原引用未通过版本、行号与摘录校验，或只有空白；未生成替代引用。' };
  if (!target) return { ...base, kind: 'unanchored', reason: '目标稿本不存在，无法进行引用对照。' };
  if (ref.versionId === target.id) return { ...base, kind: 'unchanged', candidate: { ...ref }, toScene: source.scene, reason: '引用已经属于目标稿本，行号与摘录均通过原文校验。' };
  const changes = comparison(project, source.version, target).changes;
  const change = changes.find(item => item.fromSceneIds.includes(source.scene.id));
  const paired = change?.toSceneId ? target.scenes.find(scene => scene.id === change.toSceneId) : undefined;
  const candidateAt = (scene: Scene, line: number) => makeEvidence(project, target.id, scene.id, line, line + ref.quote.split('\n').length - 1);
  if (paired && source.scene.text === paired.text) {
    // A unique whole-scene identity preserves the exact relative range even if its dialogue repeats.
    const candidate = candidateAt(paired, paired.lineStart + ref.lineStart - source.scene.lineStart);
    return { ...base, kind: change?.moved ? 'moved' : 'unchanged', candidate, toScene: paired,
      reason: change?.moved ? '唯一对应的整场原文未变，引用保留原相对行段；场次与其他已匹配场次的相对顺序改变。' : '唯一对应的整场原文未变，引用保留原相对行段；其他场次变化或行号顺移不算引用变化。' };
  }
  if (occurrences(source.scene, ref.quote).length !== 1) return { ...base, kind: 'ambiguous', reason: '原场次内存在重复引文，整场又有变化或无法唯一对应，不能仅凭相同文字推定新版位置。' };
  if (paired) {
    const found = occurrences(paired, ref.quote);
    if (found.length > 1) return { ...base, kind: 'ambiguous', toScene: paired, reason: '唯一对应场次里存在多处相同引文，未按旧行号猜测。' };
    if (found.length === 1) {
      const candidate = candidateAt(paired, found[0]);
      return { ...base, kind: 'context', candidate, toScene: paired, reason: `引文逐字保留，但同一对应场次的其他原文发生变化${change?.moved ? '，且场次相对顺序改变' : ''}；请核对上下文。` };
    }
  }
  // No exact quote in the paired scene: allow a whole-version unique fragment as a candidate,
  // but never select the first occurrence, stitch across scenes, or rewrite the old quotation.
  let oldOccurrences = 0;
  for (const scene of source.version.scenes) { oldOccurrences += occurrences(scene, ref.quote).length; if (oldOccurrences > 1) break; }
  if (oldOccurrences > 1) {
    if (paired) return { ...base, kind: 'changed', candidate: makeEvidence(project, target.id, paired.id), toScene: paired, reason: '唯一对应场次的原引文已变化。旧稿其他场次也有相同文字，不能将那里的留存误认为本引用移动；候选为对应整场真实原文。' };
    return { ...base, kind: 'ambiguous', reason: '旧稿多个场次含有相同引文，且来源场次没有唯一对应；即使目标只剩一处，也不能猜测是本引用迁移。' };
  }
  const found: { scene: Scene; line: number }[] = [];
  for (const scene of target.scenes) {
    for (const line of occurrences(scene, ref.quote)) found.push({ scene, line });
    if (found.length > 1) break;
  }
  if (found.length > 1) return { ...base, kind: 'ambiguous', ...(paired ? { toScene: paired } : {}), reason: '目标稿本存在多处完整相同引文，无法唯一确定来源去向；未生成候选引用。' };
  if (found.length === 1) {
    const hit = found[0];
    return { ...base, kind: 'moved', candidate: candidateAt(hit.scene, hit.line), toScene: hit.scene, reason: '原引文在目标稿本另一处唯一完整出现；这是文字位置候选，不代表已经确认场次身份或剧情含义。' };
  }
  if (paired) return { ...base, kind: 'changed', candidate: makeEvidence(project, target.id, paired.id), toScene: paired, reason: '唯一对应场次中未保留完整原引文。候选引用是目标稿本整场真实原文，须人工选择新依据。' };
  if (change?.kind === 'ambiguous') return { ...base, kind: 'ambiguous', reason: '场次无法唯一对应，且没有唯一完整引文可定位；不能判定为已删除。' };
  return { ...base, kind: 'missing', reason: '目标稿本没有唯一对应场次，也未找到完整相同引文；可能删除、改名或重写，需人工查证。' };
}

function latestEvidence(project: Project, issue: ReviewIssue): EvidenceRef[] {
  const valid = issue.evidence.filter(ref => ref.quote.trim() && resolveEvidence(project, ref));
  const reviewed = valid.filter(ref => ref.versionId === issue.reviewedVersionId);
  if (reviewed.length) return reviewed;
  for (let index = project.versions.length - 1; index >= 0; index--) {
    const refs = valid.filter(ref => ref.versionId === project.versions[index].id);
    if (refs.length) return refs;
  }
  return [];
}

/** Priority is larger for more urgent/manual work. This never changes task status. */
export function issueImpact(project: Project, issue: ReviewIssue, targetVersionId = project.activeVersionId): IssueImpact {
  const selected = latestEvidence(project, issue);
  const mappings = selected.map(ref => mapEvidence(project, ref, targetVersionId));
  if (!mappings.length) return { kind: 'unanchored', label: labels.unanchored, priority: priorities.unanchored, mappings, reason: '任务没有有效非空原文依据，尚不能做引用复核。' };
  if (issue.reviewedVersionId === targetVersionId && selected.every(ref => ref.versionId === targetVersionId) && mappings.every(item => item.kind === 'unchanged'))
    return { kind: 'reviewed', label: labels.reviewed, priority: priorities.reviewed, mappings, reason: '任务已有目标稿本的有效依据与明确复核记录；这是当前记录，不是本轮操作历史。' };
  const strongest = mappings.reduce((previous, item) => priorities[item.kind] > priorities[previous.kind] ? item : previous);
  return { kind: strongest.kind, label: labels[strongest.kind], priority: priorities[strongest.kind], mappings,
    reason: `${strongest.reason} 仅比较最近有效复核稿本的依据；没有该组时取最新有依据稿本。此分级不替代人工复核。` };
}

const statusLabels: Record<ReviewIssue['status'], string> = { open: '待处理', working: '修改中', resolved: '已解决', dismissed: '保留设定' };
const md = (value: string) => value.replace(/[\\`*_{}\[\]<>#|!]/gu, '\\$&').replace(/\r?\n/gu, ' ');
function fenced(text: string, language = ''): string {
  let longest = 2;
  for (const match of text.matchAll(/`+/gu)) longest = Math.max(longest, match[0].length);
  const fence = '`'.repeat(longest + 1);
  return `${fence}${language}\n${text}\n${fence}`;
}
function cite(project: Project, ref: EvidenceRef): string {
  const version = project.versions.find(item => item.id === ref.versionId);
  const scene = version?.scenes.find(item => item.id === ref.sceneId);
  return `${md(version?.label || ref.versionId)} · 第 ${scene?.number ?? '?'} 场 ${md(scene?.heading || '')} · 第 ${ref.lineStart}–${ref.lineEnd} 行\n\n${fenced(ref.quote)}`;
}

/** A comparison/current-state snapshot, never an event log or a claim about who finished work. */
export function exportRevisionReport(project: Project, fromId: string, toId: string): string {
  const from = project.versions.find(version => version.id === fromId), to = project.versions.find(version => version.id === toId);
  if (!from || !to) throw new Error('只能导出两个已保存稿本的比较；未提交草稿不在报告内。');
  const diff = comparison(project, from, to);
  const out = [`# ${md(project.title)} · 改稿对照报告`,
    `比较版本：${md(from.label)} → ${md(to.label)}`, `版本 ID：${from.id} → ${to.id}`,
    '本报告比较两个已保存稿本，不包含未提交编辑草稿。任务处理状态是导出时的当前快照；系统没有操作事件日志，不能据此判断本轮完成、解决或新增了哪些任务。',
    `场次对照：内容修改 ${diff.counts.modified}；新增 ${diff.counts.added}；移除 ${diff.counts.removed}；对应待确认 ${diff.counts.ambiguous}；相对调序 ${diff.counts.moved}。`, '## 场次与行变化'];
  let changedScenes = 0;
  for (const change of diff.changes) {
    const before = change.fromSceneId ? from.scenes.find(scene => scene.id === change.fromSceneId) : undefined;
    const after = change.toSceneId ? to.scenes.find(scene => scene.id === change.toSceneId) : undefined;
    if (before && after && before.text === after.text && !change.moved) continue;
    changedScenes++;
    const title = before && after ? `${before.heading} → ${after.heading}` : before?.heading || after?.heading || '场次对应待确认';
    out.push(`### ${md(title)}`, md(change.summary));
    if (change.kind === 'ambiguous') {
      out.push('场次无法唯一配对，以下原文分侧保留；不将它们伪装为确定的删除与新增。');
      for (const [version, ids, side] of [[from, change.fromSceneIds, '比较前'], [to, change.toSceneIds, '比较后']] as const)
        for (const id of ids) { const scene = version.scenes.find(item => item.id === id)!; out.push(`${side}：${cite(project, makeEvidence(project, version.id, scene.id))}`); }
      continue;
    }
    const rows = diffLines(before?.text || '', after?.text || '', before?.lineStart ?? 1, after?.lineStart ?? 1);
    out.push(`行对照：新增 ${rows.rows.filter(row => row.kind === 'added').length} 行，移除 ${rows.rows.filter(row => row.kind === 'removed').length} 行。`);
    if (rows.truncated) out.push('精细匹配已降级：超出确定性计算预算，中间区块按整块前后稿展示。全部原始行仍保留，增删数不代表最小编辑量。');
    out.push(fenced(rows.rows.map(row => `${row.kind === 'added' ? '+' : row.kind === 'removed' ? '-' : ' '} ${row.beforeLine ?? '—'} | ${row.afterLine ?? '—'} | ${row.text}`).join('\n'), 'diff'));
  }
  if (!changedScenes) out.push('所比较稿本的已配对场次原文及相对顺序未变。');
  const anchored = project.issues.filter(issue => latestEvidence(project, issue).length > 0);
  const items = anchored.map(issue => ({ issue, impact: issueImpact(project, issue, to.id) }));
  out.push('## 任务当前状态与目标稿复核', '以下仅报告当前保存的任务快照；没有有效原文依据的待办单列，不视为已核验。');
  for (const reviewed of [false, true]) {
    const group = items.filter(item => (item.impact.kind === 'reviewed') === reviewed).sort((a, b) => b.impact.priority - a.impact.priority);
    out.push(reviewed ? '### 已有目标稿复核记录' : '### 尚未复核目标稿', `共 ${group.length} 项。`);
    for (const { issue, impact } of group) {
      out.push(`#### ${md(issue.title)}`, `当前处理状态：${statusLabels[issue.status]}；依据分级：${impact.label}。`, md(impact.reason));
      if (issue.note) out.push(`当前备注：${md(issue.note)}`);
      for (const mapping of impact.mappings) {
        out.push(`原依据：${cite(project, mapping.original)}`, `对照说明：${md(mapping.reason)}`);
        if (mapping.candidate && mapping.candidate.versionId !== mapping.original.versionId) out.push(`目标稿候选依据（尚未自动采纳）：${cite(project, mapping.candidate)}`);
      }
    }
  }
  const unanchored = project.issues.filter(issue => !latestEvidence(project, issue).length);
  out.push('### 尚未附原文依据的待办', `共 ${unanchored.length} 项。尚不能判断引用变化，也未视为已核验。`);
  for (const issue of unanchored) {
    out.push(`#### ${md(issue.title)}`, `当前处理状态：${statusLabels[issue.status]}。`);
    if (issue.note) out.push(`当前备注：${md(issue.note)}`);
    if (issue.evidence.length) out.push('已保存的引用未通过有效非空原文校验，请重新补充依据。');
  }
  return out.join('\n\n') + '\n';
}
