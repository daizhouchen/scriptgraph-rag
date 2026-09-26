import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseScript, isTitlePage, MAX_SCENES, MAX_TEXT_LENGTH, addVersion, buildGraph, cloneProject, createIssue, createProject, diffVersions,
  isIssueStale, makeEvidence, queryProject, resolveEvidence, reviewIssue, setEntities,
  updateIssue, validateBackup,
} from '../src/domain.ts';

const NOW = 1_780_000_000_000;
const scenes = {
  room: 'INT. 值班室 - 早晨 #1#\n\n@林岚\n铜钥匙在陈姨手里。\n',
  road: 'EXT. 河岸 - 白天 #2#\n\n@陈姨\n旧票根上盖着昨天的章。\n',
  booth: 'INT. 电话亭 - 傍晚 #3#\n\n周砚摘下帽子。蓝色磁带留在桌上。\n',
};
const source = Object.values(scenes).join('\n');
const project = () => createProject({ title: '过河', text: source }, NOW);
const jsonCopy = value => JSON.parse(JSON.stringify(value));

test('projects and versions preserve normalized source, own independent scene IDs, and never mutate previous data', () => {
  const p = createProject({ title: '  过河  ', text: source.replaceAll('\n', '\r\n'), origin: 'import' }, NOW);
  const old = jsonCopy(p);
  const next = addVersion(p, { text: source.replace('铜钥匙在陈姨手里', '铜钥匙在林岚手里'), label: '二稿' }, NOW + 1);
  assert.deepEqual(p, old);
  assert.equal(next.versions.length, 2);
  assert.equal(next.title, '过河');
  assert.equal(next.entities.length, 0, 'parser candidates are not silently confirmed');
  assert.equal(next.versions[0].text, source);
  assert.notEqual(next.activeVersionId, p.activeVersionId);
  assert.ok(next.versions[1].scenes.every(scene => !p.versions[0].scenes.some(oldScene => oldScene.id === scene.id)));
  assert.equal(validateBackup(next).ok, true);
  assert.throws(() => createProject({ title: '', text: source }, NOW));
  assert.throws(() => addVersion(p, { text: '   ' }, NOW + 1));
});

test('evidence resolves its exact historical version after changed, removed and reordered scenes', () => {
  const p = project();
  const original = p.versions[0];
  const ref = makeEvidence(p, original.id, original.scenes[0].id, 4, 4);
  const next = addVersion(p, { text: scenes.booth + '\n' + scenes.room.replace('陈姨', '林岚') }, NOW + 1);
  assert.equal(resolveEvidence(next, ref).text, '铜钥匙在陈姨手里。');
  assert.equal(resolveEvidence(next, ref).version.id, original.id);
  assert.equal(resolveEvidence(next, { ...ref, versionId: next.activeVersionId }), null);
  assert.equal(resolveEvidence(next, { ...ref, quote: '未经原文支持的结论' }), null);
  assert.equal(resolveEvidence(next, { ...ref, lineEnd: 999 }), null);
  assert.equal(resolveEvidence(next, { ...ref, lineStart: undefined }), null);
  assert.throws(() => makeEvidence(p, original.id, original.scenes[0].id, 4, 7));
});

test('graph contains only confirmed literal mentions, with alias and exact line provenance', () => {
  let p = project();
  p = setEntities(p, [
    { name: '陈姨', kind: 'character', aliases: ['陈阿姨'] },
    { name: '蓝色磁带', kind: 'prop', confirmed: false },
    { name: '未出现的钥匙', kind: 'prop' },
  ], NOW + 1);
  const graph = buildGraph(p);
  assert.equal(graph.entities.length, 2);
  assert.equal(graph.edges.length, 2);
  assert.ok(graph.mentions.every(mention => resolveEvidence(p, mention.ref)));
  assert.ok(graph.mentions.every(mention => mention.entityId === p.entities[0].id));
  assert.equal(graph.mentions[0].alias, '陈姨');
  assert.throws(() => setEntities(p, [{ name: '陈姨', kind: 'character' }, { name: '陈姨', kind: 'character' }], NOW + 2));
  assert.throws(() => setEntities(p, [{ id: p.id, name: '人物', kind: 'character' }], NOW + 2));
  assert.throws(() => setEntities(p, [{ name: '陈姨', kind: 'character', aliases: ['小陈'] }, { name: '店员', kind: 'character', aliases: ['小陈'] }], NOW + 2));
  assert.throws(() => setEntities(p, [{ name: '陈姨', kind: 'character' }, { name: '小陈', kind: 'character', aliases: ['陈姨'] }], NOW + 2));
  const unique = setEntities(p, [{ name: '陈姨', kind: 'character', aliases: ['AUNT', 'aunt', '陈姨'] }], NOW + 2);
  assert.deepEqual(unique.entities[0].aliases, ['AUNT']);
  assert.equal(validateBackup(unique).ok, true);
});

test('text search keeps direct matches; graph search expands only through actual confirmed entity paths', () => {
  const p = setEntities(project(), [{ name: '陈姨', kind: 'character' }], NOW + 1);
  const plain = queryProject(p, '铜钥匙', { method: 'text' });
  const graph = queryProject(p, '铜钥匙', { method: 'graph' });
  assert.equal(plain.results.length, 1);
  assert.equal(plain.results[0].kind, 'direct');
  assert.deepEqual(graph.results.map(item => item.kind), ['direct', 'related']);
  const related = graph.results[1];
  assert.equal(related.path.entityName, '陈姨');
  assert.equal(related.path.fromSceneId, graph.results[0].sceneId);
  assert.equal(related.path.toSceneId, related.sceneId);
  assert.match(related.ref.quote, /陈姨/);
  assert.equal(queryProject(project(), '铜钥匙', { method: 'graph' }).results.length, 1);
  assert.equal(queryProject(p, '完全不存在的案件', { method: 'graph' }).results.length, 0);
  assert.equal(queryProject(p, '  ').results.length, 0);
  assert.equal(queryProject(p, '铜钥匙 陈姨').results.length, 1);
  assert.equal(queryProject(p, '铜钥匙 电话亭').results.length, 0, 'all terms must occur in the same scene');
  assert.equal(queryProject(p, '第 3 场', { method: 'text' }).results[0].sceneId, p.versions[0].scenes[2].id);
  assert.equal(queryProject(p, '第99场').results.length, 0);
  assert.throws(() => queryProject(p, '铜钥匙', { versionId: 'another-project-version' }));
});

test('Latin entity names do not match inside a different word', () => {
  let p = createProject({ title: 'Words', text: 'INT. ROOM - DAY\nANN meets JOANNA.\nEXT. PARK - NIGHT\nJOANNA walks.' }, NOW);
  p = setEntities(p, [{ name: 'ANN', kind: 'character' }], NOW + 1);
  assert.equal(buildGraph(p).edges.length, 1);
  assert.equal(queryProject(p, 'ANN', { method: 'graph' }).results.length, 1);
});

test('diff matches actual content after renumbering/reordering, identifies edits/additions/deletions, and keeps IDs independent', () => {
  const p = project();
  const next = addVersion(p, { text: [
    scenes.booth.replace('#3#', '#1#'),
    scenes.room.replace('#1#', '#2#').replace('陈姨手里', '林岚手里'),
    'EXT. 码头侧门 - 夜 #3#\n新增镜头：有人放下一把伞。\n',
  ].join('\n') }, NOW + 1);
  const diff = diffVersions(next, p.activeVersionId, next.activeVersionId);
  assert.equal(diff.counts.unchanged, 1);
  assert.equal(diff.counts.modified, 1);
  assert.equal(diff.counts.added, 1);
  assert.equal(diff.counts.removed, 1);
  assert.equal(diff.counts.moved, 2);
  const match = diff.changes.find(change => change.kind === 'unchanged');
  assert.equal(match.fromSceneId, p.versions[0].scenes[2].id);
  assert.equal(match.toSceneId, next.versions[1].scenes[0].id);
});

test('insertion shifts scene numbers but is not a move; an ambiguous duplicate heading never guesses by scene ordinal', () => {
  const p = project();
  const next = addVersion(p, { text: 'EXT. 船坞 - 清晨\n新一场。\n\n' + source }, NOW + 1);
  assert.equal(diffVersions(next, p.activeVersionId, next.activeVersionId).counts.moved, 0);
  const duplicate = createProject({ title: '重复场头', text: 'INT. ROOM - DAY\nA opens the door.\n\nINT. ROOM - DAY\nB shuts a window.' }, NOW);
  const revised = addVersion(duplicate, { text: 'INT. ROOM - DAY\nA locks the door.\n\nINT. ROOM - DAY\nB opens a window.' }, NOW + 1);
  const diff = diffVersions(revised, duplicate.activeVersionId, revised.activeVersionId);
  assert.equal(diff.counts.ambiguous, 1);
  assert.equal(diff.counts.modified, 0);
  assert.equal(diff.changes[0].fromSceneIds.length, 2);
  assert.equal(diff.changes[0].toSceneIds.length, 2);
  const compound = createProject({ title: '复合场序', text: '3-2 内景 仓库 - 夜\n内容不变。' }, NOW);
  const renumbered = addVersion(compound, { text: '4-2 内景 仓库 - 夜\n内容不变。' }, NOW + 1);
  assert.equal(diffVersions(renumbered, compound.activeVersionId, renumbered.activeVersionId).counts.unchanged, 1);
});

test('identical repeated scenes are ambiguous while a unique unchanged duplicate can be matched conservatively', () => {
  const p = createProject({ title: '同一房间', text: 'INT. ROOM - DAY\n相同内容。\n\nINT. ROOM - DAY\n相同内容。' }, NOW);
  const next = addVersion(p, { text: p.versions[0].text }, NOW + 1);
  assert.equal(diffVersions(next, p.activeVersionId, next.activeVersionId).counts.ambiguous, 1);
});

test('issues retain historical evidence and become stale after new versions; editing is distinct from explicit review', () => {
  let p = project();
  const ref = makeEvidence(p, p.activeVersionId, p.versions[0].scenes[0].id, 4, 4);
  p = createIssue(p, { title: '钥匙交接是否遗漏？', evidence: [ref] }, NOW + 1);
  const issueId = p.issues[0].id;
  assert.equal(isIssueStale(p, p.issues[0]), false);
  p = addVersion(p, { text: scenes.booth + '\n' + scenes.room }, NOW + 2);
  assert.equal(isIssueStale(p, p.issues[0]), true);
  p = updateIssue(p, issueId, { note: '新版待检查', status: 'working' }, NOW + 3);
  assert.equal(isIssueStale(p, p.issues[0]), true);
  assert.deepEqual(p.issues[0].evidence, [ref]);
  assert.throws(() => reviewIssue(p, issueId, { status: 'resolved' }, NOW + 4));
  const newRef = makeEvidence(p, p.activeVersionId, p.versions[1].scenes[1].id);
  p = reviewIssue(p, issueId, { status: 'resolved', note: '已对照新版，此交接仍由上一场说明。', evidence: [ref, newRef] }, NOW + 4);
  assert.equal(isIssueStale(p, p.issues[0]), false);
  assert.equal(p.issues[0].reviewedVersionId, p.activeVersionId);
  assert.deepEqual(p.issues[0].evidence, [ref, newRef], 'manual review keeps the original quote and explicitly added current source');
  assert.equal(validateBackup(p).ok, true);
  p = updateIssue(p, issueId, { evidence: [], status: 'open' }, NOW + 5);
  assert.equal(p.issues[0].reviewedVersionId, null, 'removing reviewed source also clears the review claim');
  assert.equal(validateBackup(p).ok, true);
});

test('issue guards reject invented/cross-project evidence and resolved items without source; draft issues remain possible', () => {
  let p = project();
  p = createIssue(p, { title: '待补原文的问题' }, NOW + 1);
  assert.equal(p.issues[0].evidence.length, 0);
  assert.equal(p.issues[0].reviewedVersionId, null, 'a draft with no source cannot claim completed version review');
  assert.throws(() => updateIssue(p, p.issues[0].id, { status: 'resolved' }, NOW + 2));
  const other = project();
  const otherRef = makeEvidence(other, other.activeVersionId, other.versions[0].scenes[0].id);
  assert.throws(() => createIssue(p, { title: '错引', evidence: [otherRef] }, NOW + 2));
  assert.throws(() => reviewIssue(p, p.issues[0].id, { versionId: other.activeVersionId }, NOW + 2));
  assert.throws(() => updateIssue(p, 'missing', { status: 'open' }, NOW + 2));
});

test('backup round-trip sanitizes unknown fields and restored copy preserves all internal evidence', () => {
  let p = project();
  p = setEntities(p, [{ name: '陈姨', kind: 'character' }], NOW + 1);
  p = createIssue(p, { title: '复核钥匙', evidence: [makeEvidence(p, p.activeVersionId, p.versions[0].scenes[0].id)] }, NOW + 2);
  const raw = jsonCopy(p);
  raw.injected = 'drop me'; raw.versions[0].injected = true; raw.issues[0].evidence[0].url = 'https://example.invalid';
  const wrapped = JSON.stringify({ format: 'scriptgraph-project', schemaVersion: 2, project: raw });
  const loaded = validateBackup(wrapped);
  assert.equal(loaded.ok, true, loaded.errors?.join(' '));
  assert.deepEqual(loaded.project, p);
  const clone = cloneProject(loaded.project, {}, NOW + 3);
  assert.notEqual(clone.id, p.id);
  assert.equal(clone.versions[0].id, p.versions[0].id);
  assert.equal(clone.issues[0].id, p.issues[0].id);
  assert.equal(resolveEvidence(clone, clone.issues[0].evidence[0]).text, p.issues[0].evidence[0].quote);
  assert.equal(validateBackup(clone).ok, true);
});

test('backup rejects shape, identifier, timestamp, source, range and graph-integrity tampering atomically', () => {
  let p = project();
  p = createIssue(p, { title: '核对', evidence: [makeEvidence(p, p.activeVersionId, p.versions[0].scenes[0].id)] }, NOW + 1);
  const mutations = [
    draft => { draft.schemaVersion = 1; },
    draft => { draft.activeVersionId = 'unknown'; },
    draft => { draft.versions[0].scenes[1].id = draft.versions[0].scenes[0].id; },
    draft => { draft.versions[0].text = '替换正文'; },
    draft => { draft.versions[0].scenes[0].lineEnd += 1; },
    draft => { draft.versions[0].scenes[0].heading = '不存在的场头'; },
    draft => { draft.versions[0].scenes[0].text = '伪造场次内容'; },
    draft => { draft.issues[0].evidence[0].quote = '伪造引文'; },
    draft => { draft.issues[0].reviewedVersionId = 'unknown'; },
    draft => { draft.issues[0].evidence = []; },
    draft => { draft.issues[0].status = 'approved-by-ai'; },
    draft => { draft.updatedAt = Date.now() + 10_000_000; },
    draft => { draft.versions[0].createdAt = Number.NaN; },
    draft => { draft.versions[0].scenes.pop(); },
    draft => { draft.versions = Array(31).fill(draft.versions[0]); },
  ];
  for (const mutate of mutations) {
    const raw = jsonCopy(p); mutate(raw);
    const result = validateBackup(raw);
    assert.equal(result.ok, false, mutate.toString());
    assert.equal(result.project, undefined);
    assert.ok(result.errors[0]);
  }
  for (const raw of [null, [], 'no JSON', {}, { format: 'other', project: p }, new Date(), { ...p, versions: null }]) assert.equal(validateBackup(raw).ok, false);
  assert.equal(validateBackup(JSON.parse('{"__proto__":{"polluted":true}}')).ok, false);
  assert.equal({}.polluted, undefined);
  const indented = createProject({ title: '标题页之后', text: 'Title: 测试\n\n  INT. ROOM - DAY\n  第一场不能丢失。\n\nEXT. ROAD - NIGHT\n第二场。' }, NOW);
  const incomplete = jsonCopy(indented);
  incomplete.versions[0].scenes.shift(); incomplete.versions[0].scenes[0].number = 1;
  assert.equal(validateBackup(incomplete).ok, false, 'indented scene cannot hide inside title-page metadata');
  const conflicting = jsonCopy(project());
  conflicting.entities = [{ id: 'one', kind: 'character', name: '陈姨', aliases: ['小陈'], confirmed: true }, { id: 'two', kind: 'character', name: '店员', aliases: ['小陈'], confirmed: true }];
  assert.equal(validateBackup(conflicting).ok, false, 'backup cannot bypass alias disambiguation');
});

function assertFullCoverage(parsed) {
  assert.equal(parsed.canImport, true);
  const prefix = parsed.lines.slice(0, parsed.scenes[0].lineStart - 1);
  assert.equal(isTitlePage(prefix), true);
  assert.equal(parsed.scenes.at(-1).lineEnd, parsed.lines.length);
  assert.equal([...prefix, ...parsed.scenes.flatMap(scene => scene.text.split('\n'))].join('\n'), parsed.text);
  parsed.scenes.forEach((scene, index) => {
    assert.equal(scene.number, index + 1);
    assert.equal(scene.id, `draft-scene-${scene.lineStart}`);
    assert.equal(scene.text, parsed.lines.slice(scene.lineStart - 1, scene.lineEnd).join('\n'));
    if (index > 0) assert.equal(scene.lineStart, parsed.scenes[index - 1].lineEnd + 1);
  });
}

test('normalizes only a leading BOM and line endings while preserving spaces and trailing lines', () => {
  const parsed = parseScript('\uFEFF  内景 仓库 - 夜\r\n  原文有缩进。  \r\n\r末尾\n');
  assert.equal(parsed.text, '  内景 仓库 - 夜\n  原文有缩进。  \n\n末尾\n');
  assert.equal(parsed.lines.at(-1), '');
  assertFullCoverage(parsed);
});

test('text without headings becomes one complete scene requiring manual confirmation', () => {
  const parsed = parseScript('林岚：快开门。\n\n周砚：钥匙不见了。\n');
  assert.equal(parsed.scenes.length, 1);
  assert.equal(parsed.scenes[0].heading, '未分场内容');
  assert.ok(parsed.diagnostics.some(item => item.code === 'NO_SCENE_HEADINGS' && item.level === 'warning'));
  assertFullCoverage(parsed);
});

test('recognizes numbered Chinese scene headings without losing original heading spelling', () => {
  const headings = ['第一场 内景 仓库 - 夜', '2. 外景 街道 - 日', '3-2 内外景 汽车 - 夜', '４、内景 客厅 - 日'];
  const parsed = parseScript(headings.map(heading => `${heading}\n动作。`).join('\n'));
  assert.deepEqual(parsed.scenes.map(scene => scene.heading), headings);
  assertFullCoverage(parsed);
});

test('recognizes Fountain prefixes and forced headings while keeping double dots as body text', () => {
  const headings = ['INT. ROOM - DAY', 'EXT. ROAD - NIGHT', 'EST. CITY - DAY', 'I/E. CAR - NIGHT',
    'INT/EXT. TRAIN - DAY', 'INT./EXT. TAXI - NIGHT', 'EXT./INT. BUS - DAY', '.仓库回忆'];
  const parsed = parseScript(headings.map(heading => `${heading}\n..省略号并非场头\n动作。`).join('\n'));
  assert.deepEqual(parsed.scenes.map(scene => scene.heading), headings);
  assertFullCoverage(parsed);
});

test('keeps narrative preamble as a scene while preserving title pages and blank prefixes outside scene counts', () => {
  const parsed = parseScript('片名：归途\n作者说明。\n\n内景 仓库 - 夜\n动作。\n\n');
  assert.equal(parsed.scenes.length, 2);
  assert.equal(parsed.scenes[0].heading, '未分场内容');
  assert.ok(parsed.diagnostics.some(item => item.code === 'UNASSIGNED_CONTENT'));
  assertFullCoverage(parsed);
  const blankPrefix = parseScript('\n  \n内景 仓库 - 夜\n动作。\n');
  assert.equal(blankPrefix.scenes.length, 1);
  assert.equal(blankPrefix.scenes[0].heading, '内景 仓库 - 夜');
  assert.equal(blankPrefix.scenes[0].lineStart, 3);
  assertFullCoverage(blankPrefix);
  const metadata = ['Title: Homebound', 'Credit: Written by', 'Author:', '    林岚',
    'Draft date: 2026-09-26', '', ''];
  const headings = Array.from({ length: 7 }, (_, index) => `INT. ROOM ${index + 1} - DAY`);
  const titlePage = parseScript([...metadata, ...headings].join('\n'));
  assert.equal(titlePage.scenes.length, 7);
  assert.equal(titlePage.scenes[0].lineStart, metadata.length + 1);
  assert.equal(titlePage.entityCandidates.some(item => item.name === '林岚'), false);
  assert.ok(titlePage.diagnostics.some(item => item.code === 'TITLE_PAGE_METADATA' && item.level === 'warning'));
  assertFullCoverage(titlePage);
  assert.equal(isTitlePage(metadata), true);
  assert.equal(isTitlePage(['Title: Homebound', 'An unindented narrative preamble.']), false);
  assert.equal(isTitlePage(['    An indented narrative with no metadata key.']), false);
  assert.equal(isTitlePage(['', '  ']), true);
});

test('forced multilingual cues and Chinese dialogue merge into reviewable candidates with source lines', () => {
  const parsed = parseScript('内景 仓库 - 夜\n@阿依古丽（画外音）\n对白。\n阿依古丽：快开门。\n@ИВАН (V.O.)\nДа.\n\nJOHN (O.S.)\nHello.');
  const character = parsed.entityCandidates.find(item => item.name === '阿依古丽');
  assert.equal(character.source, 'forced');
  assert.deepEqual(character.lineNumbers, [2, 4]);
  assert.equal(parsed.entityCandidates.find(item => item.name === 'ИВАН').source, 'forced');
  assert.equal(parsed.entityCandidates.find(item => item.name === 'JOHN').source, 'dialogue');
  for (const item of parsed.entityCandidates) {
    assert.ok(item.reason.length > 0);
    assert.equal(Object.hasOwn(item, 'confirmed'), false);
    assert.equal(Object.hasOwn(item, 'review_status'), false);
  }
});

test('short Chinese actions remain ambiguous candidates and props require explicit tags', () => {
  const parsed = parseScript('内景 仓库 - 夜\n窗外下雨\n快开门\n林岚\n银色录音带放在桌上。\n【道具:黄铜钥匙】\n【道具：黄铜钥匙】');
  for (const name of ['窗外下雨', '快开门', '林岚']) {
    assert.equal(parsed.entityCandidates.find(item => item.name === name).source, 'candidate');
  }
  assert.ok(parsed.diagnostics.some(item => item.code === 'CHARACTER_REVIEW_REQUIRED'));
  assert.deepEqual(parsed.entityCandidates.filter(item => item.kind === 'prop').map(item => [item.name, item.source, item.lineNumbers]),
    [['黄铜钥匙', 'tag', [6, 7]]]);
});

test('manual boundaries override detected headings and partition every original line unchanged', () => {
  const starts = [1, 3];
  const parsed = parseScript('片名\n内景 仓库 - 夜\n动作段一\n动作段二\n', { sceneStarts: starts });
  assert.deepEqual(starts, [1, 3]);
  assert.deepEqual(parsed.scenes.map(scene => [scene.lineStart, scene.lineEnd]), [[1, 2], [3, 5]]);
  assertFullCoverage(parsed);
});

test('manual boundaries reject missing first line, duplicates, disorder, fractions and out-of-range values', () => {
  for (const sceneStarts of [[], [2], [1, 2, 2], [1, 3, 2], [1, 1.5], [1, 4], [0, 1], [1, NaN], null]) {
    const parsed = parseScript('第一行\n第二行\n第三行', { sceneStarts });
    assert.equal(parsed.canImport, false, JSON.stringify(sceneStarts));
    assert.deepEqual(parsed.scenes, []);
    assert.ok(parsed.diagnostics.some(item => item.code === 'INVALID_SCENE_STARTS' && item.level === 'error'));
  }
});

test('rejects empty, NUL, oversized and over-scene-limit inputs while accepting exact limits', () => {
  for (const [text, code] of [[' \n\t', 'EMPTY_TEXT'], ['正文\n\u0000', 'NULL_CHARACTER'],
    ['x'.repeat(MAX_TEXT_LENGTH + 1), 'TEXT_TOO_LARGE']]) {
    const parsed = parseScript(text);
    assert.equal(parsed.canImport, false);
    assert.ok(parsed.diagnostics.some(item => item.code === code && item.level === 'error'));
  }
  assert.equal(parseScript('x'.repeat(MAX_TEXT_LENGTH)).canImport, true);
  const exactScenes = Array.from({ length: MAX_SCENES }, (_, index) => `内景 房间${index} - 日`).join('\n');
  assert.equal(parseScript(exactScenes).scenes.length, MAX_SCENES);
  const tooManyScenes = parseScript(`${exactScenes}\n外景 门外 - 夜`);
  assert.equal(tooManyScenes.canImport, false);
  assert.ok(tooManyScenes.diagnostics.some(item => item.code === 'TOO_MANY_SCENES'));
  const manual = parseScript('行\n'.repeat(MAX_SCENES), {
    sceneStarts: Array.from({ length: MAX_SCENES + 1 }, (_, index) => index + 1),
  });
  assert.equal(manual.canImport, false);
  assert.ok(manual.diagnostics.some(item => item.code === 'TOO_MANY_SCENES'));
});
