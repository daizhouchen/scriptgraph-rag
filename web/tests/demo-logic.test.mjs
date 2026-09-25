import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createDemoApi } from '../src/demo-logic.ts';

const corpus = JSON.parse(fs.readFileSync(new URL('../src/demo-corpus.json', import.meta.url), 'utf8'));
const api = createDemoApi(corpus);
const methods = ['bm25', 'dense', 'hybrid', 'graph'];

test('public projects and workspaces expose only the two selected source corpora', () => {
  assert.deepEqual(api.projects().map(project => project.id), ['echo-station', 'paper-moon']);
  for (const id of ['northbound', 'tide-library', 'missing', '../echo-station']) {
    assert.throws(() => api.workspace(id), /未找到/);
    assert.equal(api.query(id, '银色录音带', 'graph').error_type, 'project_not_found');
    assert.deepEqual(api.conflicts(id).conflicts, []);
    assert.deepEqual(api.impact(id, '银色录音带', '调整颜色').impacts, []);
  }
  assert.equal(api.workspace('echo-station').project.character_count, 4);
});

test('every scene and full line range matches the original Fountain file exactly', () => {
  for (const project of api.projects()) {
    const workspace = api.workspace(project.id);
    const raw = fs.readFileSync(new URL(`../../data/scripts/${project.id}.fountain`, import.meta.url), 'utf8');
    const lines = raw.replace(/\r\n/g, '\n').split('\n');
    if (lines.at(-1) === '') lines.pop();
    assert.deepEqual(workspace.lines, lines);
    assert.equal(workspace.scenes.length, 30);
    assert.equal(workspace.project.scene_count, 30);
    for (const scene of workspace.scenes) {
      assert.equal(scene.project_id, project.id);
      assert.equal(scene.id, `${project.id}-s${String(scene.number).padStart(2, '0')}`);
      assert.equal(lines[scene.line_start - 1], scene.heading);
      assert.equal(lines.slice(scene.line_start, scene.line_end).join('\n').trim(), scene.text);
    }
  }
});

test('all 360 method/question snapshots preserve real, in-project source excerpts', () => {
  let count = 0;
  for (const row of corpus.projects) for (const item of row.queries) {
    const result = api.query(row.workspace.project.id, item.question, item.method);
    assert.equal(result.execution, 'snapshot');
    assert.deepEqual(result, item.result);
    for (const evidence of result.evidences) {
      const scene = row.workspace.scenes.find(scene => scene.id === evidence.scene_id);
      assert.ok(scene, evidence.scene_id);
      assert.equal(evidence.heading, scene.heading);
      assert.equal(evidence.scene_number, scene.number);
      assert.equal(evidence.line_start, scene.line_start);
      assert.equal(evidence.line_end, scene.line_end);
      assert.equal(evidence.excerpt, scene.text.split(/\s+/u).join(' ').slice(0, 260));
    }
    count++;
  }
  assert.equal(count, 360);
});

test('snapshot lookup tolerates harmless spacing and punctuation, without replacing the real first scene', () => {
  const workspace = api.workspace('echo-station');
  for (const method of methods) {
    const result = api.query('echo-station', `  ${workspace.examples[0].replace('ECHO', 'echo').replace('？', '?')}  `, method);
    assert.equal(result.execution, 'snapshot');
    assert.deepEqual(result, api.query('echo-station', workspace.examples[0], method));
    if (method === 'graph') assert.ok(result.evidences.some(item => item.scene_id === 'echo-station-s01'));
    assert.ok(result.evidences.every(item => !item.heading.includes('控制室')));
  }
});

test('unanswerable library entries retain the genuine backend refusal under every method', () => {
  for (const row of corpus.projects) {
    const entries = row.queries.filter(item => item.question.includes('ZX-'));
    assert.equal(entries.length, 32);
    for (const item of entries) {
      const result = api.query(row.workspace.project.id, item.question, item.method);
      assert.equal(result.execution, 'snapshot');
      assert.equal(result.confidence, 'insufficient');
      assert.deepEqual(result.evidences, []);
    }
  }
});

test('free questions provide only actual keyword excerpts and do not fake semantic answers or method execution', () => {
  const workspace = api.workspace('echo-station');
  const result = api.query('echo-station', '请核对银色录音带的出现片段', 'graph');
  assert.equal(result.execution, 'keyword');
  assert.match(result.answer, /尚未形成语义答案/);
  assert.deepEqual(result.retrieval_path, ['browser_keyword', 'source_excerpt_only']);
  assert.ok(result.evidences.length > 0);
  for (const evidence of result.evidences) {
    assert.equal(workspace.lines.slice(evidence.line_start - 1, evidence.line_end).join('\n'), evidence.excerpt);
    assert.ok(evidence.reasons.every(reason => reason.startsWith('关键词：')));
    assert.ok(evidence.scene_id.startsWith('echo-station-s'));
  }
  assert.deepEqual(api.query('echo-station', '请核对银色录音带的出现片段', 'bm25').evidences, result.evidences);
});

test('empty, excessive, unsupported and irrelevant input is refused without unrelated citations', () => {
  for (const question of ['', ' \n\t ', '银', null, '银'.repeat(301), '今天天气预报', 'xyzzypureunknown']) {
    const result = api.query('echo-station', question, 'graph');
    assert.equal(result.confidence, 'insufficient', String(question));
    assert.deepEqual(result.evidences, []);
  }
  assert.equal(api.query('echo-station', '银色录音带', 'llm').error_type, 'unsupported_method');
});

test('foreign projects, foreign entities and unknown identifiers never fall through to another script', () => {
  const cases = [
    ['echo-station', 'PAPER-MOON-01在哪里', 'outside_project'],
    ['paper-moon', '林岚和纸月亮有什么关系', 'outside_project'],
    ['echo-station', '北行列车的线索在哪里', 'outside_project'],
    ['paper-moon', '潮汐图书馆和第七码有关吗', 'outside_project'],
    ['echo-station', 'ECHO-STATION-999在哪里', 'unknown_identifier'],
    ['echo-station', 'ECHO-STATION-0在哪里', 'unknown_identifier'],
    ['paper-moon', 'ZX-999 的负责人', 'unknown_identifier'],
  ];
  for (const [project, question, error] of cases) {
    const result = api.query(project, question, 'graph');
    assert.equal(result.error_type, error);
    assert.equal(result.confidence, 'insufficient');
    assert.deepEqual(result.evidences, []);
  }
});

test('explicit scene search stays within that real scene and rejects non-existent scene numbers', () => {
  const result = api.query('echo-station', '请给我第25场的原文片段', 'dense');
  assert.equal(result.execution, 'keyword');
  assert.deepEqual(result.evidences.map(item => item.scene_number), [25]);
  assert.equal(result.evidences[0].heading, '内景 旧广播站 - 清晨');
  for (const number of [0, 31, 99]) assert.equal(api.query('echo-station', `第${number}场原文`, 'graph').error_type, 'scene_not_found');
});

test('continuity candidates reference the two true source scenes and keep pending review status', () => {
  for (const project of api.projects()) {
    const workspace = api.workspace(project.id), conflicts = api.conflicts(project.id).conflicts;
    assert.equal(conflicts.length, 12);
    assert.deepEqual(new Set(conflicts.map(item => item.category)), new Set(['alias', 'knowledge', 'prop', 'timeline']));
    for (const conflict of conflicts) {
      assert.equal(conflict.review_status, 'pending');
      assert.equal(conflict.scene_ids.length, 2);
      for (const id of conflict.scene_ids) assert.ok(workspace.scenes.find(scene => scene.id === id)?.facts.length > 0);
    }
  }
  assert.deepEqual(api.conflicts('echo-station').conflicts.find(item => item.id === 'conflict-echo-station-alias-1').scene_ids, ['echo-station-s02', 'echo-station-s03']);
});

test('impact changes with the real selected entity and contains no cross-project or invented graph path', () => {
  const recording = api.impact('echo-station', '银色录音带', '改由另一人物保管').impacts;
  const key = api.impact('echo-station', '黄铜钥匙', '在前半段调整颜色').impacts;
  const moon = api.impact('paper-moon', '纸月亮', '修改道具材质').impacts;
  assert.ok(recording.length > 0 && key.length > 0 && moon.length > 0);
  assert.notDeepEqual(recording.map(item => item.scene_id), key.map(item => item.scene_id));
  for (const [items, project, entity] of [[recording, 'echo-station', '银色录音带'], [key, 'echo-station', '黄铜钥匙'], [moon, 'paper-moon', '纸月亮']]) {
    const workspace = api.workspace(project);
    for (const item of items) {
      assert.ok(workspace.scenes.find(scene => scene.id === item.scene_id).text.includes(entity));
      assert.deepEqual(item.path, [entity, '原文提及或参与', item.scene_id]);
      assert.match(item.reason, /未进行改稿语义推演/);
    }
  }
});

test('change text is a review plan, not a counterfactual engine; invalid plans and foreign entities yield no impact', () => {
  const first = api.impact('echo-station', '银色录音带', '改成红色');
  const second = api.impact('echo-station', '银色录音带', '删除道具');
  assert.deepEqual(first.impacts.map(item => item.scene_id), second.impacts.map(item => item.scene_id));
  assert.notEqual(first.review_plan, second.review_plan);
  assert.match(first.impacts[0].reason, /改成红色/);
  for (const [entity, change] of [['纸月亮', '修改颜色'], ['', '修改颜色'], ['银色录音带', ' '], ['银色录音带', '改'], ['银色录音带', '改'.repeat(301)]]) assert.deepEqual(api.impact('echo-station', entity, change).impacts, []);
});

test('callers cannot mutate the source corpus through returned projects, scenes, conflicts or snapshots', () => {
  const projects = api.projects(); projects[0].title = 'tampered';
  const workspace = api.workspace('echo-station'); workspace.lines[0] = 'fake'; workspace.scenes[0].text = 'fake';
  const conflicts = api.conflicts('echo-station').conflicts; conflicts[0].scene_ids.push('paper-moon-s01');
  const question = api.workspace('echo-station').examples[0];
  const result = api.query('echo-station', question, 'graph'); result.evidences[0].excerpt = 'fake';
  assert.equal(api.projects()[0].title, '回声站');
  assert.equal(api.workspace('echo-station').lines[0], '内景 旧广播站 - 清晨');
  assert.equal(api.conflicts('echo-station').conflicts[0].scene_ids.length, 2);
  assert.notEqual(api.query('echo-station', question, 'graph').evidences[0].excerpt, 'fake');
});
