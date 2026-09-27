import test from 'node:test';
import assert from 'node:assert/strict';
import { addVersion, createIssue, createProject, makeEvidence, publishDraft, resolveEvidence, reviewIssue, startDraft, updateDraftScene, updateIssue } from '../src/domain.ts';
import { diffLines, exportRevisionReport, issueImpact, mapEvidence } from '../src/revision-analysis.ts';

const NOW = 1_780_000_000_000;
const room = 'INT. ROOM - DAY\n铜钥匙留在桌上。\n窗外没有人。';
const road = 'EXT. ROAD - NIGHT\n陈姨沿路离开。';
const project = (text = `${room}\n${road}`) => createProject({ title: '引用试验', text }, NOW);
const next = (p, text, label) => addVersion(p, { text, label }, p.updatedAt + 1);
function ref(p, sceneIndex = 0, offset = 1, endOffset = offset, versionIndex = 0) {
  const version = p.versions[versionIndex], scene = version.scenes[sceneIndex];
  return makeEvidence(p, version.id, scene.id, scene.lineStart + offset, scene.lineStart + endOffset);
}
function assertCandidate(p, result, original) {
  assert.ok(result.candidate);
  assert.ok(resolveEvidence(p, result.candidate), 'every proposed reference must resolve against real original text');
  assert.deepEqual(result.original, original, 'historical quotation remains untouched');
}
function reconstruct(result, side) { return result.rows.filter(row => row.kind !== (side === 'before' ? 'added' : 'removed')).map(row => row.text).join('\n'); }
function assertRows(result, before, after, beforeStart = 1, afterStart = 1) {
  assert.equal(reconstruct(result, 'before'), before);
  assert.equal(reconstruct(result, 'after'), after);
  let a = beforeStart, b = afterStart;
  for (const row of result.rows) {
    if (row.kind !== 'added') assert.equal(row.beforeLine, a++); else assert.equal(row.beforeLine, undefined);
    if (row.kind !== 'removed') assert.equal(row.afterLine, b++); else assert.equal(row.afterLine, undefined);
  }
}

test('line diff preserves offsets, spaces, trailing blank lines and exact input reconstruction', () => {
  const before = '  保留空格\n旧行\n\n尾部\n', after = '  保留空格\n新行\n多一行\n\n尾部\n';
  const result = diffLines(before, after, 21, 31);
  assert.equal(result.truncated, false);
  assertRows(result, before, after, 21, 31);
  assert.equal(result.rows.filter(row => row.kind === 'removed').length, 1);
  assert.equal(result.rows.filter(row => row.kind === 'added').length, 2);
});

test('line diff handles empty sides, duplicate lines, disjoint text and deterministic ties', () => {
  for (const [a, b] of [['', ''], ['', '新行\n'], ['旧行\n', ''], ['A\nB\nA', 'A\nA\nB'], ['A\nB', 'X\nY'], ['\n', '\n\n']]) {
    const result = diffLines(a, b);
    assertRows(result, a, b);
    assert.deepEqual(result, diffLines(a, b));
  }
  assert.deepEqual(diffLines('', '').rows, []);
  assert.throws(() => diffLines('a', 'b', 0), RangeError);
  assert.throws(() => diffLines('a', 'b', 1, 1.2), RangeError);
});

test('long diff downgrades fine matching without discarding any original line', () => {
  const before = 'prefix\n' + Array.from({ length: 6000 }, (_, i) => `old-${i}`).join('\n') + '\nsuffix\n';
  const after = 'prefix\n' + Array.from({ length: 6000 }, (_, i) => `new-${i}`).join('\n') + '\nsuffix\n';
  const result = diffLines(before, after, 10, 100);
  assert.equal(result.truncated, true);
  assertRows(result, before, after, 10, 100);
  assert.equal(result.rows[0].kind, 'same');
  assert.equal(result.rows.at(-1).text, '');
  assert.equal(diffLines(before, before).truncated, false, 'unchanged long documents need no quadratic matching');
});

test('source references from the target version retain their exact range even for repeated text', () => {
  const p = project('INT. ROOM - DAY\n重复对白。\n动作。\n重复对白。');
  const source = ref(p, 0, 3), result = mapEvidence(p, source);
  assert.equal(result.kind, 'unchanged');
  assert.equal(result.candidate.lineStart, 4);
  assertCandidate(p, result, source);
});

test('unchanged unique scene preserves second repeated quotation after unrelated inserted lines', () => {
  const intro = 'EXT. GATE - DAY\n门口有人。';
  const repeated = 'INT. ROOM - DAY\n重复对白。\n中间动作。\n重复对白。';
  const original = project(`${intro}\n${repeated}`), source = ref(original, 1, 3);
  const p = next(original, `${intro}\n新增一行。\n再增一行。\n${repeated}`);
  const result = mapEvidence(p, source);
  assert.equal(result.kind, 'unchanged');
  assert.equal(result.candidate.lineStart, source.lineStart + 2);
  assert.notEqual(result.candidate.lineStart, p.versions[1].scenes[1].lineStart + 1);
  assertCandidate(p, result, source);
});

test('literal quotation surviving other edits in the same scene is context, not a changed quote', () => {
  const original = project(), source = ref(original);
  const p = next(original, `${room.replace('窗外没有人。', '窗外有人等候。')}\n${road}`);
  const result = mapEvidence(p, source);
  assert.equal(result.kind, 'context');
  assert.equal(result.candidate.quote, source.quote);
  assertCandidate(p, result, source);
});

test('editing another scene never marks an unchanged cited scene as affected', () => {
  const original = project(), source = ref(original);
  const p = next(original, `${room}\n${road.replace('离开', '回家')}`);
  assert.equal(mapEvidence(p, source).kind, 'unchanged');
});

test('scene insertion shifts numbering without a move; actual reordered scenes are moved', () => {
  const original = project(), source = ref(original);
  const inserted = next(original, `EXT. DOCK - DAY\n船驶离码头。\n${room}\n${road}`);
  assert.equal(mapEvidence(inserted, source).kind, 'unchanged');
  const reordered = next(original, `${road}\n${room}`), result = mapEvidence(reordered, source);
  assert.equal(result.kind, 'moved');
  assert.equal(result.toScene.number, 2);
  assertCandidate(reordered, result, source);
});

test('changed quotation proposes a real whole-scene candidate without modifying original evidence', () => {
  const original = project(), source = ref(original), frozen = structuredClone(source);
  const p = next(original, `${room.replace('铜钥匙留在桌上。', '铜钥匙交给陈姨。')}\n${road}`);
  const result = mapEvidence(p, source);
  assert.equal(result.kind, 'changed');
  assert.equal(result.candidate.quote, p.versions[1].scenes[0].text);
  assert.notEqual(result.candidate.quote, source.quote);
  assert.deepEqual(source, frozen);
  assertCandidate(p, result, source);
});

test('deleted scene has no invented candidate and unresolved heading pairs are ambiguous', () => {
  const original = project(), source = ref(original), p = next(original, road);
  const result = mapEvidence(p, source);
  assert.equal(result.kind, 'missing');
  assert.equal(result.candidate, undefined);
  const duplicate = project('INT. ROOM - DAY\n第一处原文。\nINT. ROOM - DAY\n第二处原文。');
  const revised = next(duplicate, 'INT. ROOM - DAY\n第一处重写。\nINT. ROOM - DAY\n第二处重写。');
  assert.equal(mapEvidence(revised, ref(duplicate)).kind, 'ambiguous');
});

test('unique exact fragment can locate a renamed scene without inferring semantic continuity', () => {
  const original = project(), source = ref(original);
  const p = next(original, `${room.replace('ROOM', 'HALL')}\n${road}`), result = mapEvidence(p, source);
  assert.equal(result.kind, 'moved');
  assert.equal(result.toScene.heading, 'INT. HALL - DAY');
  assertCandidate(p, result, source);
});

test('lineage tracks edited and renamed draft scenes rather than treating them as deleted', () => {
  let p = project();
  const source = ref(p);
  p = startDraft(p, {}, p.updatedAt + 1);
  p = updateDraftScene(p, p.draft.scenes[0].id, room.replace('ROOM', 'HALL').replace('桌上', '抽屉里'), p.updatedAt + 1);
  p = publishDraft(p, {}, p.updatedAt + 1);
  const result = mapEvidence(p, source);
  assert.equal(result.kind, 'changed');
  assert.equal(result.toScene.heading, 'INT. HALL - DAY');
  assertCandidate(p, result, source);
});

test('repeated source lines in a changed scene never guess which occurrence survived', () => {
  const original = project('INT. ROOM - DAY\n重复对白。\n旧动作。\n重复对白。');
  const p = next(original, 'INT. ROOM - DAY\n重复对白。\n新动作。\n重复对白。');
  const result = mapEvidence(p, ref(original, 0, 3));
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.candidate, undefined);
});

test('repeated target lines and repeated global matches never produce first-match candidates', () => {
  const original = project(), source = ref(original);
  const sameScene = next(original, `${room}\n铜钥匙留在桌上。\n${road}`);
  assert.equal(mapEvidence(sameScene, source).kind, 'ambiguous');
  const elsewhere = next(original, 'INT. HALL - DAY\n铜钥匙留在桌上。\nEXT. GATE - NIGHT\n铜钥匙留在桌上。');
  const result = mapEvidence(elsewhere, source);
  assert.equal(result.kind, 'ambiguous');
  assert.equal(result.candidate, undefined);
});

test('only complete exact lines match; partial substrings and cross-scene stitching cannot form a candidate', () => {
  const original = project(), source = ref(original, 0, 1, 2);
  const p = next(original, 'INT. HALL - DAY\n铜钥匙留在桌上。\nEXT. GATE - NIGHT\n窗外没有人。');
  assert.equal(mapEvidence(p, source).kind, 'missing');
  const edited = next(original, `${room.replace('铜钥匙留在桌上。', '注意：铜钥匙留在桌上。')}\n${road}`);
  assert.equal(mapEvidence(edited, ref(original)).kind, 'changed');
});

test('an already-existing identical quote elsewhere cannot masquerade as moved deleted evidence', () => {
  const original = project('INT. ROOM - DAY\n重复对白。\nEXT. ROAD - NIGHT\n重复对白。');
  const source = ref(original);
  const removed = next(original, 'EXT. ROAD - NIGHT\n重复对白。');
  const unclear = mapEvidence(removed, source);
  assert.equal(unclear.kind, 'ambiguous');
  assert.equal(unclear.candidate, undefined);
  const changed = next(original, 'INT. ROOM - DAY\n新对白。\nEXT. ROAD - NIGHT\n重复对白。');
  const mapped = mapEvidence(changed, source);
  assert.equal(mapped.kind, 'changed');
  assert.equal(mapped.toScene.heading, 'INT. ROOM - DAY');
  assertCandidate(changed, mapped, source);
});

test('invalid, foreign, empty and unknown-target references are unanchored', () => {
  const p = project(), source = ref(p);
  for (const invalid of [{ ...source, quote: '伪造' }, { ...source, lineStart: -1 }, { ...source, versionId: 'missing' }, ref(project())])
    assert.equal(mapEvidence(p, invalid).kind, 'unanchored');
  assert.equal(mapEvidence(p, source, 'missing').kind, 'unanchored');
  const empty = project('INT. ROOM - DAY\n\n动作。');
  assert.equal(mapEvidence(empty, ref(empty)).kind, 'unanchored');
});

test('current-version review is distinct from resolution and accumulated old quotations are ignored', () => {
  let p = project();
  const oldRef = ref(p);
  p = createIssue(p, { title: '核对钥匙', evidence: [oldRef], status: 'working' }, p.updatedAt + 1);
  p = next(p, `${room.replace('桌上', '抽屉里')}\n${road}`);
  const currentRef = ref(p, 0, 1, 1, 1);
  p = reviewIssue(p, p.issues[0].id, { evidence: [oldRef, currentRef], status: 'working' }, p.updatedAt + 1);
  const impact = issueImpact(p, p.issues[0]);
  assert.equal(impact.kind, 'reviewed');
  assert.equal(impact.priority, 0);
  assert.equal(impact.mappings.length, 1);
  assert.equal(impact.mappings[0].original.versionId, p.activeVersionId);
  assert.equal(p.issues[0].status, 'working');
  p = next(p, `${room.replace('桌上', '抽屉里')}\n${road.replace('离开', '回家')}`);
  const later = issueImpact(p, p.issues[0]);
  assert.equal(later.kind, 'unchanged', 'unrelated new draft does not create a high-priority impact');
  assert.notEqual(later.kind, 'reviewed', 'the newest version was not manually reviewed');
  assert.equal(later.mappings.length, 1);
  assert.equal(later.mappings[0].original.versionId, currentRef.versionId);
});

test('without a valid review group, newest evidence group is used even if historical refs appear last', () => {
  let p = project();
  const oldRef = ref(p);
  p = next(p, `${room.replace('桌上', '抽屉里')}\n${road}`);
  const newestRef = ref(p, 0, 1, 1, 1);
  p = createIssue(p, { title: '新的待办', evidence: [newestRef, oldRef] }, p.updatedAt + 1);
  const issue = { ...p.issues[0], reviewedVersionId: null };
  const impact = issueImpact(p, issue);
  assert.equal(impact.kind, 'unchanged');
  assert.equal(impact.mappings.length, 1);
  assert.equal(impact.mappings[0].original.versionId, newestRef.versionId);
  assert.equal(issueImpact(p, { ...issue, evidence: [] }).kind, 'unanchored');
});

test('valid reviewed evidence takes precedence over unreviewed current additions and worst impact sorts first', () => {
  let p = project();
  const oldRef = ref(p), oldRoadRef = ref(p, 1);
  p = createIssue(p, { title: '两处核对', evidence: [oldRef, oldRoadRef] }, p.updatedAt + 1);
  p = next(p, room.replace('桌上', '抽屉里'));
  const currentRef = ref(p, 0, 1, 1, 1);
  p = updateIssue(p, p.issues[0].id, { evidence: [oldRef, oldRoadRef, currentRef] }, p.updatedAt + 1);
  const impact = issueImpact(p, p.issues[0]);
  assert.equal(impact.kind, 'missing');
  assert.equal(impact.mappings.length, 2);
  assert.ok(impact.mappings.every(item => item.original.versionId === oldRef.versionId));
  assert.ok(impact.priority > issueImpact(p, { ...p.issues[0], evidence: [oldRef] }).priority);
});

test('report names chosen versions, current task state, source lines and unanchored todos without inventing history', () => {
  let p = project();
  const originalId = p.activeVersionId;
  p = createIssue(p, { title: '交接是否完整', note: '请核对。', evidence: [ref(p)], status: 'resolved' }, p.updatedAt + 1);
  p = createIssue(p, { title: '尚待查证的设想', note: '需要补上出处。' }, p.updatedAt + 1);
  p = next(p, `${room.replace('桌上', '抽屉里')}\n${road}`, '二稿');
  const report = exportRevisionReport(p, originalId, p.activeVersionId);
  assert.match(report, /初稿 → 二稿/);
  assert.match(report, /当前处理状态：已解决/);
  assert.match(report, /尚未复核目标稿/);
  assert.match(report, /尚未附原文依据的待办/);
  assert.match(report, /尚待查证的设想/);
  assert.match(report, /铜钥匙留在桌上。/);
  assert.match(report, /铜钥匙留在抽屉里。/);
  assert.match(report, /新增 1 行，移除 1 行/);
  assert.match(report, /系统没有操作事件日志/);
  assert.doesNotMatch(report, /本轮完成了|本轮已解决|草稿任务/);
  assert.throws(() => exportRevisionReport(p, 'missing', p.activeVersionId));
});

test('report excludes unsubmitted edit text and safely fences screenplay markdown/backticks', () => {
  let p = project('INT. ROOM - DAY\n文本含 ``` 和 <script>。');
  const firstId = p.activeVersionId;
  p = next(p, 'INT. ROOM - DAY\n文本含 ```` 和 <script>。', '二稿');
  p = startDraft(p, {}, p.updatedAt + 1);
  p = updateDraftScene(p, p.draft.scenes[0].id, 'INT. ROOM - DAY\n未提交的隐藏修改ABC', p.updatedAt + 1);
  const snapshot = structuredClone(p);
  const report = exportRevisionReport(p, firstId, p.activeVersionId);
  assert.doesNotMatch(report, /未提交的隐藏修改ABC/);
  assert.match(report, /`````diff/);
  assert.deepEqual(p, snapshot, 'analysis and export never mutate projects or draft state');
});

test('large report explains that fallback line counts are not minimal edits', () => {
  const old = 'INT. ROOM - DAY\n' + Array.from({ length: 1000 }, (_, i) => `旧原文${i}`).join('\n');
  const newer = 'INT. ROOM - DAY\n' + Array.from({ length: 1000 }, (_, i) => `新原文${i}`).join('\n');
  const first = project(old), p = next(first, newer);
  const report = exportRevisionReport(p, first.activeVersionId, p.activeVersionId);
  assert.match(report, /精细匹配已降级/);
  assert.match(report, /不代表最小编辑量/);
  assert.match(report, /旧原文999/);
  assert.match(report, /新原文999/);
});
