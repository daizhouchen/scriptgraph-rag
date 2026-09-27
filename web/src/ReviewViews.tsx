import { useMemo, useState } from 'react';
import { ArrowRight, Check, Download, FileText, GitBranch, Pencil, Plus } from 'lucide-react';
import { diffVersions, isIssueStale, makeEvidence, type SceneChange } from './domain';
import { exportRevisionReport, issueImpact } from './revision-analysis';
import { EvidenceButton, getVersion, STATUS_NAMES, shortDate, saveFile } from './components';
import { LineDiff } from './RevisionTools';
import type { ViewProps } from './ProjectViews';

export function IssuesView({ project, openSource, newIssue, editIssue, editScene }: ViewProps) {
  const [filter, setFilter] = useState('all');
  const [group, setGroup] = useState('all');
  const [query, setQuery] = useState('');
  const rows = useMemo(() => project.issues.map(issue => ({ issue, impact: issueImpact(project, issue) })).sort((a, b) => b.impact.priority - a.impact.priority || b.issue.updatedAt - a.issue.updatedAt), [project.issues, project.versions, project.activeVersionId]);
  const priority = rows.filter(row => row.impact.priority >= 40);
  const unchanged = rows.filter(row => row.impact.kind === 'unchanged');
  const visible = rows.filter(({ issue, impact }) => (filter === 'all' || (filter === 'stale' ? isIssueStale(project, issue) : issue.status === filter)) && (group === 'all' || (group === 'priority' ? impact.priority >= 40 : impact.kind === 'unchanged')) && `${issue.title} ${issue.note}`.includes(query.trim()));
  function exportTasks() {
    const output = [`# ${project.title} · 改稿任务`, `当前稿本：${getVersion(project).label}`, '以下为项目内人工审阅记录，不是自动生成的剧本结论。', '', ...rows.flatMap(({ issue, impact }) => [`## ${issue.title}`, `当前处理状态：${STATUS_NAMES[issue.status]} / ${impact.label}`, impact.reason, issue.note || '无备注', ...issue.evidence.flatMap(ref => { const v = getVersion(project, ref.versionId); const s = v.scenes.find(s => s.id === ref.sceneId)!; return [`出处：${v.label} 第${s.number}场 ${ref.lineStart}–${ref.lineEnd}行`, ref.quote, '']; }), ''])].join('\n');
    saveFile(`${project.title}-改稿任务.md`, output, 'text/markdown;charset=utf-8');
  }
  return <>
    <div className="sg-view-head"><div><p className="sg-overline">REVISION TASKS</p><h2>先处理变化，再确认判断。</h2><p>按最近一次核对所用的依据安排复核。原文未变会单独列出，方便沿用；是否解决仍由你决定。</p></div><div className="sg-actions"><button className="sg-secondary" onClick={exportTasks} disabled={!rows.length}><Download/>导出全部任务</button><button className="sg-primary" onClick={() => newIssue()}><Plus/>新建任务</button></div></div>
    <div className="sg-impact-summary" aria-label="复核分组">{[{ id: 'priority', title: '优先复核', count: priority.length, note: '依据变化、调序或待确认' }, { id: 'unchanged', title: '依据未变', count: unchanged.length, note: '核对原句后，可确认沿用' }, { id: 'all', title: '全部任务', count: rows.length, note: '包含已核对与未附依据' }].map(item => <button key={item.id} aria-pressed={group === item.id} onClick={() => setGroup(item.id)}><strong>{item.count}</strong><span>{item.title}<small>{item.note}</small></span></button>)}</div>
    <div className="sg-task-tools"><label className="sg-field">搜索任务<input value={query} onChange={e => setQuery(e.target.value)} placeholder="标题或修改方案"/></label><label className="sg-field">任务状态<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部任务 ({rows.length})</option><option value="stale">当前稿本待复核</option>{Object.entries(STATUS_NAMES).map(([id, label]) => <option value={id} key={id}>{label}</option>)}</select></label></div>
    {!visible.length && <div className="sg-empty"><Check/><div><h3>{rows.length ? '当前筛选下没有任务' : '从一个真实疑点开始'}</h3><p>{rows.length ? '可以切回全部任务，继续查看修改记录。' : '在原文中选择支撑判断的几行，再带着依据记任务。'}</p><button className="sg-secondary" onClick={() => rows.length ? (setFilter('all'), setGroup('all'), setQuery('')) : newIssue()}>{rows.length ? '查看全部任务' : '记第一项任务'}</button></div></div>}
    <div className="sg-issue-list">{visible.map(({ issue, impact }) => <article className={`sg-issue ${impact.priority >= 40 ? 'sg-stale' : ''}`} key={issue.id}><div className="sg-issue-heading"><div className="sg-actions"><span className={`sg-status ${issue.status}`}>{STATUS_NAMES[issue.status]}</span><span className={`sg-badge sg-impact-${impact.kind}`}>{impact.label}</span></div><small>{shortDate(issue.updatedAt)}</small></div><h3>{issue.title}</h3><p className="sg-issue-note">{issue.note || '尚未填写修改方案。'}</p><p className="sg-muted">{impact.reason}</p><div className="sg-evidence-row">{issue.evidence.map((ref, i) => <EvidenceButton key={i} project={project} evidence={ref} open={openSource}/>)}{!issue.evidence.length && <span className="sg-muted">还没有原文依据，解决前请补充。</span>}</div><div className="sg-issue-actions sg-issue-actions-v3"><button className="sg-secondary" onClick={() => editScene(undefined, issue)}><Pencil/>去修改相关场次</button><button className="sg-quiet" onClick={() => editIssue(issue)}>编辑任务</button><button className="sg-primary" onClick={() => editIssue(issue, true)}>{impact.kind === 'unchanged' ? '核对并确认沿用' : isIssueStale(project, issue) ? '核对当前稿本' : '更新复核结论'}<ArrowRight/></button></div></article>)}</div>
  </>;
}

export function VersionsView({ project, openSource, editIssue, importVersion }: ViewProps) {
  const [fromId, setFromId] = useState(project.versions.at(-2)?.id || project.versions[0].id);
  const [toId, setToId] = useState(project.activeVersionId);
  const [selected, setSelected] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const diff = useMemo(() => fromId !== toId ? diffVersions(project, fromId, toId) : null, [project.versions, fromId, toId]);
  const from = getVersion(project, fromId), to = getVersion(project, toId);
  const changes = diff?.changes.filter(c => showUnchanged || c.kind !== 'unchanged' || c.moved) || [];
  const change = diff?.changes.find(c => c.id === selected) || changes[0];
  const stale = project.issues.filter(i => isIssueStale(project, i)).map(issue => ({ issue, impact: issueImpact(project, issue) })).sort((a, b) => b.impact.priority - a.impact.priority);
  const title = (c: SceneChange) => { const before = from.scenes.find(s => s.id === c.fromSceneIds[0]); const after = to.scenes.find(s => s.id === c.toSceneIds[0]); return `${before ? `原第 ${before.number} 场` : '新增'} → ${after ? `第 ${after.number} 场` : '未对应'} · ${(after || before)?.heading || '待人工对应的场次'}`; };
  const label = (c: SceneChange) => c.kind === 'modified' ? '内容修改' : c.kind === 'added' ? '新增' : c.kind === 'removed' ? '删除／未对应' : c.kind === 'ambiguous' ? '对应待确认' : c.moved ? '顺序变化' : '内容未变';
  const beforeScene = from.scenes.find(s => s.id === change?.fromSceneIds[0]);
  const afterScene = to.scenes.find(s => s.id === change?.toSceneIds[0]);
  return <>
    <div className="sg-view-head"><div><p className="sg-overline">VERSION REVIEW</p><h2>看见具体改动，完成这一轮核对。</h2><p>直接查看增删的文字和原始行号。重复场次未能唯一对应时，保留候选供人工确认。</p></div><div className="sg-actions"><button className="sg-secondary" disabled={!diff} onClick={() => saveFile(`${project.title}-${from.label}对比${to.label}-改稿记录.md`, exportRevisionReport(project, fromId, toId), 'text/markdown;charset=utf-8')}><Download/>导出本轮改稿记录</button><button className="sg-secondary" onClick={importVersion}><FileText/>导入外部新版</button></div></div>
    <div className="sg-version-list">{project.versions.map((v, i) => <button key={v.id} className={v.id === toId ? 'active' : ''} onClick={() => { setToId(v.id); setSelected(null); }}><span>V{i + 1}</span><strong>{v.label}</strong><small>{v.scenes.length} 场 · {shortDate(v.createdAt)}{v.id === project.activeVersionId ? ' · 当前稿本' : ''}</small></button>)}</div>
    {project.versions.length < 2 ? <div className="sg-empty"><GitBranch/><div><h3>还没有可比较的下一稿</h3><p>在「逐场改稿」中修改并生成修订稿，或导入外部新稿。原稿始终保留。</p><button className="sg-secondary" onClick={importVersion}>导入外部新版<ArrowRight/></button></div></div> : <>
      <div className="sg-task-tools"><label className="sg-field">对照原稿<select value={fromId} onChange={e => { setFromId(e.target.value); setSelected(null); }}>{project.versions.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label><ArrowRight/><label className="sg-field">比较稿本<select value={toId} onChange={e => { setToId(e.target.value); setSelected(null); }}>{project.versions.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label></div>
      {!diff && <p className="sg-notice">请选择两个不同的稿本进行比较。</p>}
      {diff && <><div className="sg-diff-summary"><span><strong>{diff.counts.modified}</strong> 修改</span><span><strong>{diff.counts.added}</strong> 新增</span><span><strong>{diff.counts.removed}</strong> 删除／未对应</span><span><strong>{diff.counts.moved}</strong> 调序</span><span><strong>{diff.counts.ambiguous}</strong> 对应待确认</span></div><label className="sg-check-row"><input type="checkbox" checked={showUnchanged} onChange={e => setShowUnchanged(e.target.checked)}/>同时显示内容未变的场次</label>
      <div className="sg-change-list">{changes.map(c => <button className={`sg-change ${c.id === change?.id ? 'active' : ''}`} key={c.id} onClick={() => setSelected(c.id)}><span className={`sg-status ${c.kind}`}>{label(c)}</span><span><strong>{title(c)}</strong><small>{c.summary}</small></span><ArrowRight/></button>)}</div>{!changes.length && <p className="sg-notice">这两稿未检测到场次文字或顺序变化。可勾选上方选项查看未变内容。</p>}
      {change && <section className="sg-change-detail"><h3>{title(change)}</h3>{change.kind !== 'ambiguous' ? <><div className="sg-toolbar"><span className="sg-muted">{from.label} → {to.label}</span><div className="sg-actions">{beforeScene && <button className="sg-secondary" onClick={() => openSource(makeEvidence(project, from.id, beforeScene.id))}>打开原稿全文</button>}{afterScene && <button className="sg-secondary" onClick={() => openSource(makeEvidence(project, to.id, afterScene.id))}>打开比较稿全文</button>}</div></div><LineDiff key={`${from.id}-${to.id}-${change.id}`} before={beforeScene?.text || ''} after={afterScene?.text || ''} beforeStart={beforeScene?.lineStart || 1} afterStart={afterScene?.lineStart || 1}/></> : <><p className="sg-notice">这些场次存在多个可能对应，不自动配对或推断文字变化。请分别打开确认。</p><div className="sg-compare-pair">{[{ v: from, ids: change.fromSceneIds }, { v: to, ids: change.toSceneIds }].map(side => <article key={side.v.id}><h4>{side.v.label}</h4>{side.ids.map(id => <EvidenceButton key={id} project={project} evidence={makeEvidence(project, side.v.id, id)} open={openSource}/>)}</article>)}</div></>}</section>}
      </>}
    </>}
    {!!stale.length && <section className="sg-recheck"><h3>当前稿本还有 {stale.length} 项人工复核</h3><p>优先检查依据变化；引用未变的任务可直接核对对应原句后确认沿用。</p>{stale.map(({ issue, impact }) => <article key={issue.id}><div><span className="sg-badge">{impact.label}</span><strong>{issue.title}</strong><p className="sg-muted">{impact.reason}</p></div><button className="sg-primary" onClick={() => editIssue(issue, true)}>{impact.kind === 'unchanged' ? '核对并沿用' : '开始复核'}</button></article>)}</section>}
  </>;
}
