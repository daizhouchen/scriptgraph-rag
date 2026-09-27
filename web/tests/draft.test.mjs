import test from 'node:test';
import assert from 'node:assert/strict';
import {
  addDraftScene, addVersion, cloneProject, createIssue, createProject, diffVersions,
  discardDraft, makeEvidence, moveDraftScene, previewDraft, publishDraft,
  removeDraftScene, renameDraft, resolveEvidence, startDraft, updateDraftScene,
  validateBackup, MAX_TEXT_LENGTH, DOMAIN_LIMITS, serializeBackup, updateIssue,
  reviewIssue, setEntities,
} from '../src/domain.ts';

const NOW = 1_780_000_000_000;
const text = 'Title: 过水留声\nCredit: 原创测试\n\nINT. 值班室 - 清晨\n\n@林岚\n钥匙留在抽屉里。\n\nEXT. 河岸 - 日\n\n@陈姨\n票根在我这里。\n\nINT. 茶室 - 夜\n\n周砚推开门。\n';
const fresh = () => createProject({ title: '逐场改稿', text }, NOW);
const copy = value => JSON.parse(JSON.stringify(value));
function edited() {
  let p = startDraft(fresh(), { label: '二稿' }, NOW + 1);
  return updateDraftScene(p, p.draft.scenes[1].id, p.draft.scenes[1].text.replace('票根在我这里', '我把票根交给林岚'), NOW + 2);
}

test('starting a draft preserves metadata, whitespace and source exactly without creating a version', () => {
  const p = fresh(), original = copy(p);
  const d = startDraft(p, { label: '交接修订' }, NOW + 1);
  assert.deepEqual(p, original);
  assert.equal(d.schemaVersion, 3);
  assert.equal(d.versions.length, 1);
  assert.equal(d.draft.preamble, 'Title: 过水留声\nCredit: 原创测试\n\n');
  assert.equal(previewDraft(d).text, text);
  assert.equal(previewDraft(d).changedScenes, 0);
  assert.equal(previewDraft(d).canPublish, false);
  assert.equal(startDraft(d, { label: '不得覆盖' }, NOW + 2), d);
  assert.throws(() => publishDraft(d, {}, NOW + 2), /尚无变化/);
  const renamed = renameDraft(d, '只改名称', NOW + 2);
  assert.equal(previewDraft(renamed).canPublish, false);
  assert.equal(validateBackup(renamed).ok, true);
});

test('publishing one scene edit preserves other scenes and historical evidence with exact new line ranges', () => {
  let p = fresh();
  const source = p.versions[0];
  const ref = makeEvidence(p, source.id, source.scenes[1].id);
  p = createIssue(p, { title: '补充票根交接', evidence: [ref] }, NOW + 1);
  p = startDraft(p, { label: '补交接' }, NOW + 2);
  const sceneId = p.draft.scenes[1].id;
  p = updateDraftScene(p, sceneId, p.draft.scenes[1].text.replace('票根在我这里。', '我把票根交给林岚。\n林岚把票根放入口袋。').replaceAll('\n', '\r\n'), NOW + 3);
  const preview = previewDraft(p);
  assert.equal(preview.changedScenes, 1);
  assert.equal(preview.canPublish, true);
  assert.equal(preview.text.startsWith(p.draft.preamble), true);
  const published = publishDraft(p, {}, NOW + 4);
  const revision = published.versions[1];
  assert.equal(p.draft.scenes.length, 3, 'publishing does not mutate the draft input');
  assert.equal(published.draft, undefined);
  assert.deepEqual(published.versions[0], source);
  assert.equal(revision.scenes[0].text, source.scenes[0].text);
  assert.equal(revision.scenes[2].text, source.scenes[2].text);
  assert.equal(revision.scenes[2].lineStart, source.scenes[2].lineStart + 1);
  assert.equal(resolveEvidence(published, ref).text, ref.quote);
  assert.deepEqual(published.issues[0].evidence, [ref]);
  assert.equal(revision.parentVersionId, source.id);
  revision.scenes.forEach((scene, index) => {
    assert.equal(revision.sceneOrigins[scene.id], source.scenes[index].id);
    assert.equal(revision.text.split('\n').slice(scene.lineStart - 1, scene.lineEnd).join('\n'), scene.text);
  });
  assert.equal(validateBackup(published).ok, true);
});

test('scene insert/delete/reorder uses stable draft identities and preserves exact source blocks', () => {
  let p = startDraft(fresh(), {}, NOW + 1);
  const [first, second, third] = p.draft.scenes;
  p = moveDraftScene(p, third.id, 'up', NOW + 2);
  assert.equal(previewDraft(p).changedScenes, 2);
  p = removeDraftScene(p, second.id, NOW + 3);
  p = addDraftScene(p, { afterSceneId: first.id, text: 'EXT. 侧门 - 夜\n新的交接动作。' }, NOW + 4);
  const added = p.draft.scenes[1];
  assert.equal(added.sourceSceneId, null);
  assert.deepEqual(p.draft.scenes.map(scene => scene.id), [first.id, added.id, third.id]);
  assert.equal(previewDraft(p).changedScenes, 2, 'deletion and insertion do not turn shifted retained scene numbers into moves');
  const published = publishDraft(p, {}, NOW + 5);
  const next = published.versions[1];
  assert.equal(next.sceneOrigins[next.scenes[1].id], undefined);
  assert.equal(next.scenes[2].text, third.text);
  assert.equal(validateBackup(published).ok, true);
});

test('last edited scene survives backup/restore and safely follows scene removal', () => {
  let p = startDraft(fresh(), {}, NOW + 1);
  assert.equal(p.draft.lastEditedSceneId, p.draft.scenes[0].id);
  const second = p.draft.scenes[1], third = p.draft.scenes[2];
  p = updateDraftScene(p, second.id, second.text + '\n补充说明。', NOW + 2);
  const archived = validateBackup(JSON.stringify({ format: 'scriptgraph-project', schemaVersion: 3, project: p }));
  assert.equal(archived.ok, true);
  assert.equal(archived.project.draft.lastEditedSceneId, second.id);
  p = removeDraftScene(archived.project, second.id, NOW + 3);
  assert.equal(p.draft.lastEditedSceneId, third.id);
  const invalid = copy(p); invalid.draft.lastEditedSceneId = second.id;
  assert.equal(validateBackup(invalid).ok, false);
  for (const scene of [...p.draft.scenes]) p = removeDraftScene(p, scene.id, NOW + 4);
  assert.equal(p.draft.lastEditedSceneId, undefined);
  assert.equal(validateBackup(p).ok, true);
  p = addDraftScene(p, { text: '' }, NOW + 5);
  assert.equal(p.draft.lastEditedSceneId, p.draft.scenes[0].id);
});

test('unfinished and empty drafts round-trip safely but invalid scene structures cannot publish', () => {
  let p = startDraft(fresh(), {}, NOW + 1);
  const id = p.draft.scenes[0].id;
  for (const [value, code] of [['', 'EMPTY_DRAFT_SCENE'], ['尚未写完的场头', 'DRAFT_HEADING_REQUIRED'], ['INT. EMPTY - DAY\n\n', 'DRAFT_BODY_REQUIRED'], ['INT. ROOM - DAY\n动作。\nEXT. ROAD - NIGHT\n另一场。', 'MULTIPLE_DRAFT_HEADINGS']]) {
    const d = updateDraftScene(p, id, value, NOW + 2);
    assert.equal(previewDraft(d).canPublish, false);
    assert.ok(previewDraft(d).diagnostics.some(diagnostic => diagnostic.code === code));
    const restored = validateBackup({ format: 'scriptgraph-project', schemaVersion: 3, project: d });
    assert.equal(restored.ok, true, restored.errors?.join(' '));
    assert.equal(restored.project.draft.scenes[0].text, value);
    assert.throws(() => publishDraft(d, {}, NOW + 3));
  }
  for (const scene of [...p.draft.scenes]) p = removeDraftScene(p, scene.id, NOW + 2);
  assert.equal(p.draft.scenes.length, 0);
  assert.equal(validateBackup(p).ok, true);
  assert.equal(previewDraft(p).canPublish, false);
  p = addDraftScene(p, { text: 'INT. 新开场 - 日\n重写开场。' }, NOW + 3);
  assert.equal(previewDraft(p).canPublish, true);
});

test('invalid scene writes are refused atomically and boundary moves are no-ops', () => {
  const p = startDraft(fresh(), {}, NOW + 1), before = copy(p);
  assert.equal(moveDraftScene(p, p.draft.scenes[0].id, 'up', NOW + 2), p);
  assert.equal(moveDraftScene(p, p.draft.scenes.at(-1).id, 'down', NOW + 2), p);
  for (const action of [
    () => updateDraftScene(p, 'foreign-scene', 'x', NOW + 2),
    () => removeDraftScene(p, 'foreign-scene', NOW + 2),
    () => moveDraftScene(p, p.draft.scenes[0].id, 'sideways', NOW + 2),
    () => addDraftScene(p, { afterSceneId: 'foreign-scene' }, NOW + 2),
    () => updateDraftScene(p, p.draft.scenes[0].id, '\u0000', NOW + 2),
    () => updateDraftScene(p, p.draft.scenes[0].id, 'x'.repeat(MAX_TEXT_LENGTH), NOW + 2),
  ]) assert.throws(action);
  assert.deepEqual(p, before);
});

test('drafts block external version imports and stale draft baselines cannot publish', () => {
  const p = edited();
  assert.throws(() => addVersion(p, { text }, NOW + 3), /草稿/);
  const without = discardDraft(p, NOW + 3);
  assert.equal(without.draft, undefined);
  assert.ok(p.draft);
  assert.equal(discardDraft(without, NOW + 4), without);
  const imported = addVersion(without, { text: text.replace('周砚推开门', '周砚关上门') }, NOW + 4);
  const stale = { ...imported, draft: p.draft };
  assert.equal(validateBackup(stale).ok, true, 'stale draft must not be dropped during recovery');
  assert.ok(previewDraft(stale).diagnostics.some(item => item.code === 'DRAFT_BASE_CHANGED'));
  assert.throws(() => publishDraft(stale, {}, NOW + 5));
});

test('explicit draft origins survive duplicate headings, renaming and multi-version comparisons', () => {
  let p = createProject({ title: '同名房间', text: 'INT. ROOM - DAY\n甲打开门。\n\nINT. ROOM - DAY\n乙打开窗。' }, NOW);
  const base = p.versions[0];
  p = startDraft(p, {}, NOW + 1);
  p = updateDraftScene(p, p.draft.scenes[0].id, 'EXT. RENAMED - NIGHT\n甲走出门。\n', NOW + 2);
  p = publishDraft(p, {}, NOW + 3);
  p = startDraft(p, {}, NOW + 4);
  const changed = p.draft.scenes[0];
  p = updateDraftScene(p, changed.id, changed.text.replace('甲走出门', '甲跑出门'), NOW + 5);
  p = moveDraftScene(p, changed.id, 'down', NOW + 6);
  p = publishDraft(p, {}, NOW + 7);
  for (const [from, to] of [[base.id, p.activeVersionId], [p.activeVersionId, base.id]]) {
    const result = diffVersions(p, from, to);
    assert.equal(result.counts.modified, 1);
    assert.equal(result.counts.unchanged, 1);
    assert.equal(result.counts.ambiguous, 0);
    assert.equal(result.counts.added, 0);
    assert.equal(result.counts.removed, 0);
    assert.equal(result.counts.moved, 2);
  }
  assert.equal(validateBackup(p).ok, true);
});

test('v2 naked/wrapped backups migrate to v3 without changing IDs, source, entities or task evidence', () => {
  let p = fresh();
  p = createIssue(p, { title: '来源', evidence: [makeEvidence(p, p.activeVersionId, p.versions[0].scenes[0].id)] }, NOW + 1);
  const legacy = { ...copy(p), schemaVersion: 2 };
  for (const raw of [legacy, { format: 'scriptgraph-project', schemaVersion: 2, project: legacy }]) {
    const restored = validateBackup(raw);
    assert.equal(restored.ok, true, restored.errors?.join(' '));
    assert.deepEqual(restored.project, p);
  }
  assert.equal(validateBackup({ format: 'scriptgraph-project', schemaVersion: 2, project: p }).ok, false);
  assert.equal(validateBackup({ ...startDraft(p, {}, NOW + 2), schemaVersion: 2 }).ok, false, 'schema mismatch cannot silently discard a working draft');
});

test('a deliberately deleted scene and newly inserted identical copy do not inherit each other through text similarity', () => {
  let p = startDraft(fresh(), {}, NOW + 1);
  const base = p.versions[0], deleted = p.draft.scenes[0];
  p = removeDraftScene(p, deleted.id, NOW + 2);
  p = addDraftScene(p, { text: deleted.text }, NOW + 3);
  p = publishDraft(p, {}, NOW + 4);
  const result = diffVersions(p, base.id, p.activeVersionId);
  assert.equal(result.counts.added, 1);
  assert.equal(result.counts.removed, 1);
  assert.equal(result.counts.unchanged, 2);
  assert.equal(result.counts.moved, 0);
  assert.ok(result.changes.some(change => change.kind === 'removed' && change.fromSceneId === deleted.sourceSceneId));
});

test('v3 backup and clone preserve pending edits; unsafe draft origin, IDs, dates, preamble and text are refused', () => {
  const p = edited();
  const restored = validateBackup(JSON.stringify({ format: 'scriptgraph-project', schemaVersion: 3, project: p }));
  assert.equal(restored.ok, true);
  assert.deepEqual(restored.project, p);
  const clone = cloneProject(restored.project, {}, NOW + 3);
  assert.notEqual(clone.id, p.id);
  assert.deepEqual(clone.draft, p.draft);
  assert.equal(validateBackup(clone).ok, true);
  for (const mutate of [
    p => { p.draft.baseVersionId = 'foreign'; },
    p => { p.draft.scenes[0].sourceSceneId = 'foreign'; },
    p => { p.draft.scenes[1].sourceSceneId = p.draft.scenes[0].sourceSceneId; },
    p => { p.draft.scenes[0].id = p.id; },
    p => { p.draft.scenes[0].text = '\u0000'; },
    p => { p.draft.scenes[0].text = '未经规范\r\n'; },
    p => { p.draft.preamble += '丢失原前言'; },
    p => { p.draft.createdAt = 0; },
    p => { p.draft.updatedAt = p.updatedAt + 1; },
    p => { p.draft.scenes = null; },
  ]) {
    const invalid = copy(p); mutate(invalid);
    assert.equal(validateBackup(invalid).ok, false, mutate.toString());
  }
});

test('backup rejects cyclic, cross-project, duplicate or orphaned explicit source relationships', () => {
  const p = publishDraft(edited(), {}, NOW + 3);
  for (const mutate of [
    p => { p.versions[1].parentVersionId = p.versions[1].id; },
    p => { p.versions[1].parentVersionId = 'foreign'; },
    p => { p.versions[1].sceneOrigins[p.versions[1].scenes[0].id] = 'foreign-scene'; },
    p => { p.versions[1].sceneOrigins.foreign = p.versions[0].scenes[0].id; },
    p => { p.versions[1].sceneOrigins[p.versions[1].scenes[1].id] = p.versions[0].scenes[0].id; },
    p => { delete p.versions[1].parentVersionId; },
  ]) {
    const invalid = copy(p); mutate(invalid);
    assert.equal(validateBackup(invalid).ok, false, mutate.toString());
  }
});

test('publication limits do not discard draft data and unassigned original preface can remain unchanged', () => {
  let p = fresh();
  for (let index = 1; index < 30; index += 1) p = addVersion(p, { text: text.replace('推开门', `推开第${index}扇门`) }, NOW + index);
  p = startDraft(p, {}, NOW + 31);
  p = updateDraftScene(p, p.draft.scenes[0].id, p.draft.scenes[0].text.replace('钥匙', '新钥匙'), NOW + 32);
  assert.equal(previewDraft(p).canPublish, false);
  assert.throws(() => publishDraft(p, {}, NOW + 33), /30/);
  assert.equal(validateBackup(p).ok, true);
  let unassigned = createProject({ title: '片名前言', text: '片名：渡口\n作者说明。\n\n内景 房间 - 日\n正文。' }, NOW);
  unassigned = startDraft(unassigned, {}, NOW + 1);
  unassigned = updateDraftScene(unassigned, unassigned.draft.scenes[1].id, '内景 房间 - 日\n修订正文。', NOW + 2);
  assert.equal(previewDraft(unassigned).canPublish, true);
  assert.equal(validateBackup(publishDraft(unassigned, {}, NOW + 3)).ok, true);
});

test('confirmed manual boundaries survive unrelated edits without exempting edited or newly added nonstandard headings', () => {
  const text = '第一场：值班室\n林岚把钥匙放下。\n\n第二场：河岸\n陈姨收好票根。\n';
  let p = createProject({ title: '手动分场 TXT', text, sceneStarts: [1, 4] }, NOW);
  const base = p.versions[0];
  p = startDraft(p, {}, NOW + 1);
  p = updateDraftScene(p, p.draft.scenes[1].id, '外景 河岸 - 日\n陈姨将票根交给林岚。\n', NOW + 2);
  const preview = previewDraft(p);
  assert.equal(preview.canPublish, true);
  assert.equal(preview.changedScenes, 1);
  assert.equal(preview.scenes[0].heading, base.scenes[0].heading);
  assert.ok(preview.diagnostics.some(d => d.code === 'PRESERVED_CONFIRMED_BOUNDARY'));
  const published = publishDraft(p, {}, NOW + 3);
  const next = published.versions[1];
  assert.equal(next.scenes[0].text, base.scenes[0].text);
  assert.equal(next.text, base.scenes[0].text + '\n' + p.draft.scenes[1].text);
  assert.deepEqual(next.sceneOrigins, {
    [next.scenes[0].id]: base.scenes[0].id,
    [next.scenes[1].id]: base.scenes[1].id,
  });
  assert.deepEqual(published.versions[0], base);
  assert.equal(validateBackup(serializeBackup(published)).ok, true);
  for (const invalid of [
    updateDraftScene(p, p.draft.scenes[0].id, p.draft.scenes[0].text + '补充动作。', NOW + 3),
    addDraftScene(p, { text: base.scenes[0].text }, NOW + 3),
  ]) {
    assert.equal(previewDraft(invalid).canPublish, false);
    assert.ok(previewDraft(invalid).diagnostics.some(d => d.code === 'DRAFT_HEADING_REQUIRED'));
  }
});

test('two maximum Chinese versions plus a draft export compactly and restore all text including JSON escapes', () => {
  const prefix = 'Title: 大稿备份\n\nINT. 档案室 - 日\n引号"、反斜线\\、制表\t、孤立代理\ud800。\n';
  const largeText = prefix + '稿'.repeat(MAX_TEXT_LENGTH - prefix.length);
  let p = createProject({ title: '中文容量', text: largeText }, NOW);
  p = addVersion(p, { text: largeText.slice(0, -1) + '改' }, NOW + 1);
  p = startDraft(p, {}, NOW + 2);
  const raw = serializeBackup(p);
  assert.equal(raw, JSON.stringify({ format: 'scriptgraph-project', schemaVersion: 3, project: p }));
  assert.ok(raw.length < DOMAIN_LIMITS.backupLength);
  assert.ok(Buffer.byteLength(raw, 'utf8') > 24_000_000, 'UTF-8 file bytes are not the JSON character limit');
  assert.ok(Buffer.byteLength(raw, 'utf8') <= DOMAIN_LIMITS.backupLength * 3);
  const restored = validateBackup(raw);
  assert.equal(restored.ok, true, restored.errors?.join(' '));
  assert.deepEqual(restored.project, p);
});

test('oversized citations, new versions and draft edits are refused before replacing a recoverable project', () => {
  const prefix = 'INT. ROOM - DAY\n';
  const largeText = prefix + '字'.repeat(MAX_TEXT_LENGTH - prefix.length);
  const initial = createProject({ title: '大稿引用', text: largeText }, NOW);
  const ref = makeEvidence(initial, initial.activeVersionId, initial.versions[0].scenes[0].id);
  const p = createIssue(initial, { title: '现有问题', evidence: Array(9).fill(ref) }, NOW + 1);
  const existingIssue = p.issues[0];
  const tooMany = Array(10).fill(ref);
  const capacityError = error => error.code === 'BACKUP_TOO_LARGE';
  for (const change of [
    () => createIssue(initial, { title: '超限引用', evidence: tooMany }, NOW + 2),
    () => updateIssue(p, existingIssue.id, { evidence: tooMany }, NOW + 2),
    () => reviewIssue(p, existingIssue.id, { evidence: tooMany }, NOW + 2),
    () => addVersion(p, { text: largeText }, NOW + 2),
    () => startDraft(p, {}, NOW + 2),
  ]) assert.throws(change, capacityError);
  assert.equal(p.issues[0], existingIssue);
  assert.equal(p.issues[0].evidence.length, 9);
  assert.equal(p.versions.length, 1);
  assert.equal(p.draft, undefined);
  assert.equal(validateBackup(serializeBackup(p)).ok, true);
  const oversized = { ...p, issues: [{ ...existingIssue, evidence: tooMany }] };
  assert.throws(() => serializeBackup(oversized), capacityError);
  assert.equal(validateBackup(oversized).ok, false, 'object imports cannot bypass the string-size guard');

  let draft = startDraft(initial, {}, NOW + 2);
  draft = createIssue(draft, { title: '草稿中的问题', evidence: Array(8).fill(ref) }, NOW + 3);
  const draftScene = draft.draft.scenes[0];
  assert.throws(() => updateDraftScene(draft, draftScene.id, prefix + '\u0001'.repeat(MAX_TEXT_LENGTH - prefix.length), NOW + 4), capacityError);
  assert.equal(draft.draft.scenes[0], draftScene);
  draft = updateDraftScene(draft, draftScene.id, draftScene.text.slice(0, -1) + '改', NOW + 4);
  assert.throws(() => publishDraft(draft, {}, NOW + 5), capacityError);
  assert.equal(draft.versions.length, 1);
  assert.equal(draft.draft.scenes[0].text.at(-1), '改');
  assert.equal(validateBackup(serializeBackup(draft)).ok, true);
});

test('capacity accounts for escaped characters exactly at the limit and protects metadata-only mutations', () => {
  const prefix = 'INT. ROOM - DAY\n';
  assert.throws(() => createProject({ title: '拒绝超限初稿', text: prefix + '\u0001'.repeat(MAX_TEXT_LENGTH - prefix.length) }, NOW), error => error.code === 'BACKUP_TOO_LARGE');
  let p = createProject({ title: '精确容量', text: prefix + '\u0001'.repeat(1_999_800) }, NOW);
  p = createIssue(p, { title: '容量边界' }, NOW + 1);
  const remaining = DOMAIN_LIMITS.backupLength - serializeBackup(p).length;
  assert.ok(remaining > 0 && remaining < 10_000);
  p = updateIssue(p, p.issues[0].id, { note: '字'.repeat(remaining) }, NOW + 2);
  const raw = serializeBackup(p);
  assert.equal(raw.length, DOMAIN_LIMITS.backupLength);
  assert.equal(validateBackup(raw).ok, true);
  assert.equal(validateBackup(raw + ' ').ok, false, 'raw string limit is checked before parsing');
  for (const change of [
    () => updateIssue(p, p.issues[0].id, { note: p.issues[0].note + '"' }, NOW + 3),
    () => setEntities(p, [{ name: '林岚', kind: 'character' }], NOW + 3),
    () => cloneProject(p, {}, NOW + 3),
  ]) assert.throws(change, error => error.code === 'BACKUP_TOO_LARGE');
  assert.equal(serializeBackup(p), raw, 'failed metadata edits leave the previous export unchanged');
});
