import { useMemo, useState } from 'react';
import { ArrowRight, BookOpen, Check, Download, FileText, GitBranch, Plus, Search, Trash2 } from 'lucide-react';
import { buildGraph, queryProject, diffVersions, makeEvidence, isIssueStale, setEntities, type Project, type EvidenceRef, type ReviewIssue, type LocalQueryResult, type EntityInput, type SceneChange } from './domain';
import { Lines, EvidenceButton, getVersion, STATUS_NAMES, shortDate, saveFile } from './components';

export type ViewProps = { project: Project; update: (project: Project) => void; openSource: (ref: EvidenceRef) => void; newIssue: (refs?: EvidenceRef[]) => void; editIssue: (issue: ReviewIssue, review?: boolean) => void; importVersion: () => void };

export function ScriptView({ project, update, openSource, newIssue }: ViewProps) {
  const version = getVersion(project);
  const [tab, setTab] = useState<'script' | 'entities'>('script');
  const [selectedScene, setSelectedScene] = useState(version.scenes[0]?.id || '');
  const [filter, setFilter] = useState('');
  const [selectedEntity, setSelectedEntity] = useState(project.entities[0]?.id || '');
  const [name, setName] = useState('');
  const [aliases, setAliases] = useState('');
  const [kind, setKind] = useState<'character' | 'prop'>('prop');
  const [editingEntityId, setEditingEntityId] = useState<string | null>(null);
  const [error, setError] = useState('');
  const graph = useMemo(() => buildGraph(project), [project]);
  const scene = version.scenes.find(s => s.id === selectedScene) || version.scenes[0];
  const entity = project.entities.find(e => e.id === selectedEntity) || project.entities[0];
  const edges = graph.edges.filter(e => e.entityId === entity?.id);
  function mutate(inputs: EntityInput[]) { try { update(setEntities(project, inputs)); setError(''); return true; } catch (e) { setError(e instanceof Error ? e.message : '索引未更新'); return false; } }
  function addEntity() {
    if (!name.trim()) { setError('请填写原文中使用的人物或道具名称。'); return; }
    if (mutate([...project.entities, { name: name.trim(), kind, aliases: aliases.split(/[,，、]/).map(x => x.trim()).filter(Boolean), confirmed: true }])) { setName(''); setAliases(''); }
  }
  return <>
    <div className="sg-view-head"><div><p className="sg-overline">01 / SCRIPT & RELATIONS</p><h2>先看原文，再建立关联。</h2><p>场次保留原始行号。人物与道具的关系来自你确认的名称和实际提及。</p></div><button className="sg-secondary" onClick={() => saveFile(`${project.title}-${version.label}.fountain`, version.text)}><Download size={16}/>导出原稿</button></div>
    <div className="sg-tabs" role="group" aria-label="剧本视图"><button className={tab === 'script' ? 'active' : ''} onClick={() => setTab('script')} aria-pressed={tab === 'script'}><BookOpen size={16}/>逐场阅读</button><button className={tab === 'entities' ? 'active' : ''} onClick={() => setTab('entities')} aria-pressed={tab === 'entities'}><GitBranch size={16}/>人物与道具 · {project.entities.length}</button></div>
    {tab === 'script' && scene && <div className="sg-scene-layout"><aside className="sg-scene-nav"><label>查找场次<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="地点或场次编号"/></label><div>{version.scenes.filter(s => `${s.number} ${s.heading}`.includes(filter.trim())).map(s => <button key={s.id} className={s.id === scene.id ? 'active' : ''} onClick={() => setSelectedScene(s.id)} aria-pressed={s.id === scene.id}><strong>{String(s.number).padStart(2, '0')}</strong><span>{s.heading}<small>{s.lineStart}–{s.lineEnd} 行</small></span></button>)}</div></aside><article className="sg-reader"><header className="sg-reader-head"><div><span className="sg-overline">{version.label} / 第 {scene.number} 场</span><h3>{scene.heading}</h3></div><button className="sg-primary" onClick={() => newIssue([makeEvidence(project, version.id, scene.id)])}><Plus size={16}/>记改稿任务</button></header><Lines version={version} scene={scene}/><div className="sg-reader-foot"><span>原文第 {scene.lineStart}–{scene.lineEnd} 行</span><div className="sg-actions"><button className="sg-quiet" disabled={scene.number === 1} onClick={() => setSelectedScene(version.scenes[scene.number - 2].id)}>上一场</button><button className="sg-quiet" disabled={scene.number === version.scenes.length} onClick={() => setSelectedScene(version.scenes[scene.number].id)}>下一场</button></div></div></article></div>}
    {tab === 'entities' && <>
      <p className="sg-notice">确认索引后，检索可沿「人物／道具 → 提及场次」补充跨场材料。共同出现不等于人物有关系，提及道具不等于持有。</p>
      <div className="sg-entity-layout"><aside className="sg-entity-list">{!project.entities.length && <p className="sg-muted">还没有索引对象，可在下方添加。</p>}{project.entities.map(e => <button key={e.id} className={e.id === entity?.id ? 'active' : ''} onClick={() => setSelectedEntity(e.id)}><span>{e.name}<small>{e.kind === 'character' ? '人物' : '道具'} · {e.confirmed ? '已确认' : '待确认'}</small></span><strong>{graph.edges.filter(edge => edge.entityId === e.id).length}</strong></button>)}</aside>
        <div className="sg-entity-detail">{entity ? <><div className="sg-toolbar"><div><h3>{entity.name}</h3><p className="sg-muted">{entity.aliases.length ? `别名：${entity.aliases.join('、')}` : '未设置别名'} · {edges.length} 个关联场次</p></div><div className="sg-actions"><button className="sg-secondary" onClick={() => mutate(project.entities.map(e => e.id === entity.id ? { ...e, confirmed: !e.confirmed } : e))}>{entity.confirmed ? '暂停此项索引' : '确认并建立索引'}</button><button className="sg-quiet" onClick={() => { setEditingEntityId(entity.id); setName(entity.name); setAliases(entity.aliases.join('，')); setKind(entity.kind); }}>编辑名称与别名</button></div></div>
          {!entity.confirmed ? <div className="sg-empty"><GitBranch size={26}/><h3>这项还未参与关系检索</h3><p>核对名称后点击确认，再查看提及场次。</p></div> : <><svg className="sg-graph-svg" viewBox={`0 0 720 ${Math.max(180, Math.min(edges.length, 6) * 62 + 28)}`} role="img" aria-label={`${entity.name}实际提及场次关系图`}>
            {edges.slice(0, 6).map((edge, i) => { const s = version.scenes.find(s => s.id === edge.sceneId)!; return <g key={edge.sceneId}><path d={`M220 ${Math.max(180, Math.min(edges.length, 6) * 62 + 28) / 2} C320 ${Math.max(180, Math.min(edges.length, 6) * 62 + 28) / 2},320 ${i * 62 + 46},405 ${i * 62 + 46}`} fill="none" stroke="currentColor"/><rect x="405" y={i * 62 + 23} width="292" height="46" rx="3"/><text x="420" y={i * 62 + 51}>第 {s.number} 场 · {s.heading.length > 17 ? `${s.heading.slice(0, 17)}…` : s.heading}</text></g>; })}
            <rect x="18" y={Math.max(180, Math.min(edges.length, 6) * 62 + 28) / 2 - 32} width="202" height="64" rx="4" className="sg-graph-root"/><text x="119" y={Math.max(180, Math.min(edges.length, 6) * 62 + 28) / 2 + 6} textAnchor="middle" className="sg-graph-root-text">{entity.name}</text>
          </svg>{edges.length > 6 && <p className="sg-muted">图中展示前 6 场，下方列出全部关联。</p>}
          <div className="sg-mentions">{edges.map(edge => { const s = version.scenes.find(s => s.id === edge.sceneId)!; const ref = edge.refs[0]; return <article key={s.id}><div><h4>第 {s.number} 场 · {s.heading}</h4><p>{ref.quote}</p></div><EvidenceButton project={project} evidence={ref} open={openSource}/></article>; })}{!edges.length && <p className="sg-empty">当前稿本未找到该名称或别名。可在下方修改索引。</p>}</div></>}
        </> : <div className="sg-empty">添加人物或道具后，这里会列出真实提及与来源。</div>}</div>
      </div>
      <details className="sg-entity-editor" open={!project.entities.length || !!name}><summary>添加或修正人物、道具索引</summary><div className="sg-toolbar"><label className="sg-field">类型<select value={kind} onChange={e => setKind(e.target.value as typeof kind)}><option value="character">人物</option><option value="prop">道具</option></select></label><label className="sg-field">标准名称<input value={name} maxLength={80} onChange={e => setName(e.target.value)} placeholder="原文中的名称"/></label><label className="sg-field">别名（逗号分隔）<input value={aliases} maxLength={400} onChange={e => setAliases(e.target.value)} placeholder="如：黄铜钥匙，备用钥匙"/></label><button className="sg-primary" onClick={() => {
        const existing = project.entities.find(e => editingEntityId ? e.id === editingEntityId : e.name === name.trim() && e.kind === kind);
        if (existing) { if (mutate(project.entities.map(e => e.id === existing.id ? { ...e, name: name.trim(), kind, aliases: aliases.split(/[,，、]/).map(x => x.trim()).filter(Boolean) } : e))) { setName(''); setAliases(''); setEditingEntityId(null); } } else addEntity();
      }}>{editingEntityId ? '保存修改' : '保存索引'}</button>{editingEntityId && <button className="sg-secondary" onClick={() => { setEditingEntityId(null); setName(''); setAliases(''); }}>取消编辑</button>}</div>{error && <p className="sg-error" role="alert">{error}</p>}</details>
    </>}
  </>;
}

export function SearchView({ project, openSource, newIssue }: ViewProps) {
  const version = getVersion(project);
  const [query, setQuery] = useState('');
  const [method, setMethod] = useState<'text' | 'graph'>('graph');
  const [result, setResult] = useState<LocalQueryResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [error, setError] = useState('');
  const examples = [project.entities.find(e => e.kind === 'prop')?.name, project.entities.find(e => e.kind === 'character')?.name, '第 1 场'].filter(Boolean) as string[];
  function search() { try { setResult(queryProject(project, query, { method, limit: 16 })); setSelected([]); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '查找失败'); } }
  const matches = result?.results || [];
  return <>
    <div className="sg-view-head"><div><p className="sg-overline">02 / EVIDENCE SEARCH</p><h2>找到一句话，也找到它牵连的场次。</h2><p>先查原文字词，再沿已确认的实体索引扩展。结果提供材料，判断由你完成。</p></div></div>
    <form className="sg-search-form" onSubmit={e => { e.preventDefault(); search(); }}><label className="sg-field">查证词语、人物、道具或场次<input value={query} onChange={e => { setQuery(e.target.value); setResult(null); setSelected([]); }} maxLength={200} placeholder="例如：钥匙、林夏，或第 5 场"/></label><button className="sg-primary" disabled={!query.trim().length}><Search size={17}/>查找证据</button></form>
    <div className="sg-toolbar"><div className="sg-tabs" role="group" aria-label="检索方式"><button className={method === 'text' ? 'active' : ''} aria-pressed={method === 'text'} onClick={() => { setMethod('text'); setResult(null); }}>只查原文</button><button className={method === 'graph' ? 'active' : ''} aria-pressed={method === 'graph'} onClick={() => { setMethod('graph'); setResult(null); }}><GitBranch size={16}/>原文 + 关系扩展</button></div><div className="sg-actions">{examples.map(value => <button className="sg-quiet" key={value} onClick={() => { setQuery(value); setResult(null); }}>{value}</button>)}</div></div>
    {error && <p className="sg-error" role="alert">{error}</p>}
    {!result ? <div className="sg-empty"><Search size={28}/><h3>每条结果都带着当前稿本的出处</h3><p>找到相关材料后，勾选一处或多处原文，就能带着证据创建改稿任务。</p></div> : <><div className="sg-result-summary"><div><h3>{matches.length ? `${matches.filter(m => m.kind === 'direct').length} 处直接命中 · ${matches.filter(m => m.kind === 'related').length} 处关系补充` : '没有足够的原文命中'}</h3><p>{result.message}</p></div><button className="sg-primary" disabled={!selected.length} onClick={() => newIssue(matches.filter(m => selected.includes(m.sceneId)).map(m => m.ref))}><Plus size={16}/>用 {selected.length} 处依据建任务</button></div>
      <div className="sg-query-results">{matches.map(item => <article className="sg-result" key={`${item.kind}-${item.sceneId}`}><header><label className="sg-check-row"><input type="checkbox" checked={selected.includes(item.sceneId)} onChange={e => setSelected(ids => e.target.checked ? [...ids, item.sceneId] : ids.filter(id => id !== item.sceneId))}/><span>选作任务依据</span></label><span className={`sg-result-kind ${item.kind}`}>{item.kind === 'direct' ? '原文命中' : '关系补充'}</span></header><h3>第 {item.sceneNumber} 场 · {item.heading}</h3><p className="sg-result-excerpt">{item.excerpt}</p>{item.path && <p className="sg-path">第 {version.scenes.find(s => s.id === item.path!.fromSceneId)?.number} 场 → {item.path.entityName} → 第 {item.sceneNumber} 场 · 仅表示共同提及</p>}<div className="sg-toolbar"><span className="sg-muted">{version.label} · {item.ref.lineStart}–{item.ref.lineEnd} 行</span><EvidenceButton project={project} evidence={item.ref} open={openSource}/></div></article>)}</div>
    </>}
  </>;
}

export function IssuesView({ project, openSource, newIssue, editIssue }: ViewProps) {
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const issues = project.issues.filter(i => (filter === 'all' || (filter === 'stale' ? isIssueStale(project, i) : i.status === filter)) && `${i.title} ${i.note}`.includes(query.trim()));
  function exportTasks() {
    const output = [`# ${project.title} · 改稿任务`, `当前稿本：${getVersion(project).label}`, '以下为项目内人工审阅记录，不是自动生成的剧本结论。', '', ...project.issues.flatMap(i => [`## ${i.title}`, `状态：${STATUS_NAMES[i.status]}${isIssueStale(project, i) ? ' / 当前稿本待复核' : ' / 已核对当前稿本'}`, i.note || '无备注', ...i.evidence.flatMap(ref => { const v = getVersion(project, ref.versionId); const s = v.scenes.find(s => s.id === ref.sceneId)!; return [`出处：${v.label} 第${s.number}场 ${ref.lineStart}–${ref.lineEnd}行`, ref.quote, '']; }), ''])].join('\n');
    saveFile(`${project.title}-改稿任务.md`, output, 'text/markdown;charset=utf-8');
  }
  return <>
    <div className="sg-view-head"><div><p className="sg-overline">03 / REVISION TASKS</p><h2>把疑点变成可以完成的修改。</h2><p>每项任务保留出处、处理方式和复核状态。导入新版后，旧任务会等待你再次确认。</p></div><div className="sg-actions"><button className="sg-secondary" onClick={exportTasks} disabled={!project.issues.length}><Download size={16}/>导出全部任务</button><button className="sg-primary" onClick={() => newIssue()}><Plus size={16}/>新建任务</button></div></div>
    <div className="sg-task-tools"><label className="sg-field">搜索任务<input value={query} onChange={e => setQuery(e.target.value)} placeholder="标题或修改方案"/></label><label className="sg-field">任务状态<select value={filter} onChange={e => setFilter(e.target.value)}><option value="all">全部任务 ({project.issues.length})</option><option value="stale">当前稿本待复核</option>{Object.entries(STATUS_NAMES).map(([key, value]) => <option key={key} value={key}>{value}</option>)}</select></label></div>
    {!issues.length && <div className="sg-empty"><Check size={28}/><h3>{project.issues.length ? '当前筛选下没有任务' : '从一个真实疑点开始'}</h3><p>{project.issues.length ? '可以切回全部状态，继续查看已记录的修改。' : '读到不确定的设定时，在原文中创建任务；也可以先记待办，再补充依据。'}</p><button className="sg-secondary" onClick={() => project.issues.length ? (setFilter('all'), setQuery('')) : newIssue()}>{project.issues.length ? '查看全部任务' : '记第一项任务'}</button></div>}
    <div className="sg-issue-list">{issues.map(issue => <article className={`sg-issue ${isIssueStale(project, issue) ? 'sg-stale' : ''}`} key={issue.id}><div className="sg-issue-heading"><div className="sg-actions"><span className={`sg-status ${issue.status}`}>{STATUS_NAMES[issue.status]}</span>{isIssueStale(project, issue) && <span className="sg-badge">当前稿本待复核</span>}</div><small>{shortDate(issue.updatedAt)}</small></div><h3>{issue.title}</h3><p className="sg-issue-note">{issue.note || '尚未填写修改方案。'}</p><div className="sg-evidence-row">{issue.evidence.map((ref, index) => <EvidenceButton key={index} project={project} evidence={ref} open={openSource}/>)}{!issue.evidence.length && <span className="sg-muted">还没有原文依据，解决前请补充。</span>}</div><div className="sg-issue-actions"><button className="sg-secondary" onClick={() => editIssue(issue)}>编辑任务</button><button className="sg-primary" onClick={() => editIssue(issue, true)}>{isIssueStale(project, issue) ? '核对当前稿本' : '更新复核结论'}<ArrowRight size={15}/></button></div></article>)}</div>
  </>;
}

export function VersionsView({ project, openSource, editIssue, importVersion }: ViewProps) {
  const [fromId, setFromId] = useState(project.versions.at(-2)?.id || project.versions[0].id);
  const [toId, setToId] = useState(project.activeVersionId);
  const [selected, setSelected] = useState<string | null>(null);
  const [showUnchanged, setShowUnchanged] = useState(false);
  const diff = useMemo(() => fromId !== toId ? diffVersions(project, fromId, toId) : null, [project, fromId, toId]);
  const change = diff?.changes.find(c => c.id === selected);
  const from = getVersion(project, fromId), to = getVersion(project, toId);
  const stale = project.issues.filter(i => isIssueStale(project, i));
  const changeLabel = (c: SceneChange) => c.kind === 'modified' ? '内容修改' : c.kind === 'added' ? '新增' : c.kind === 'removed' ? '删除' : c.kind === 'ambiguous' ? '对应待确认' : c.moved ? '顺序变化' : '内容未变';
  return <>
    <div className="sg-view-head"><div><p className="sg-overline">04 / VERSION REVIEW</p><h2>看清改了哪里，再确认任务是否解决。</h2><p>原稿始终保留。场次按正文与唯一场头对照；相似或重复场次会留给你确认。</p></div><button className="sg-primary" onClick={importVersion}><FileText size={17}/>导入／编辑新版</button></div>
    <div className="sg-version-list">{project.versions.map((version, i) => <button key={version.id} className={version.id === toId ? 'active' : ''} onClick={() => { setToId(version.id); setSelected(null); }}><span>V{i + 1}</span><strong>{version.label}</strong><small>{version.scenes.length} 场 · {shortDate(version.createdAt)}{version.id === project.activeVersionId ? ' · 当前稿本' : ''}</small></button>)}</div>
    {project.versions.length < 2 ? <div className="sg-empty"><GitBranch size={28}/><h3>下一稿，不覆盖这一稿</h3><p>导入修订文本或直接编辑一份新稿，预览变化后再确认。旧任务会保留最初的原文依据。</p><button className="sg-primary" onClick={importVersion}>开始一轮改稿 <ArrowRight size={16}/></button></div> : <>
      <div className="sg-task-tools"><label className="sg-field">对照原稿<select value={fromId} onChange={e => { setFromId(e.target.value); setSelected(null); }}>{project.versions.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label><ArrowRight size={18}/><label className="sg-field">比较稿本<select value={toId} onChange={e => { setToId(e.target.value); setSelected(null); }}>{project.versions.map(v => <option key={v.id} value={v.id}>{v.label}</option>)}</select></label></div>
      {!diff && <p className="sg-notice">请选择两个不同的稿本进行比较。</p>}
      {diff && <><div className="sg-diff-summary"><span><strong>{diff.counts.modified}</strong> 修改</span><span><strong>{diff.counts.added}</strong> 新增</span><span><strong>{diff.counts.removed}</strong> 删除</span><span><strong>{diff.counts.moved}</strong> 调序</span><span><strong>{diff.counts.ambiguous}</strong> 对应待确认</span></div><label className="sg-check-row"><input type="checkbox" checked={showUnchanged} onChange={e => setShowUnchanged(e.target.checked)}/>同时显示内容未变的场次</label>
        <div className="sg-change-list">{diff.changes.filter(c => showUnchanged || c.kind !== 'unchanged' || c.moved).map(c => <button className={`sg-change ${c.id === selected ? 'active' : ''}`} key={c.id} onClick={() => setSelected(c.id)}><span className={`sg-status ${c.kind}`}>{changeLabel(c)}</span><span>{c.summary}</span><ArrowRight size={15}/></button>)}</div>
        {change && <div className="sg-compare-pair">{([{ version: from, ids: change.fromSceneIds, label: '原稿' }, { version: to, ids: change.toSceneIds, label: '比较稿' }]).map(side => <article className="sg-compare-column" key={side.label}><h3>{side.label} · {side.version.label}</h3>{side.ids.length ? side.ids.map(id => { const s = side.version.scenes.find(s => s.id === id)!; return <div key={id}><h4>第 {s.number} 场 · {s.heading}</h4><p className="sg-muted">{s.lineStart}–{s.lineEnd} 行</p><pre>{s.text}</pre><button className="sg-secondary" onClick={() => openSource(makeEvidence(project, side.version.id, id))}>打开此版原文</button></div>; }) : <p className="sg-empty">此稿没有对应场次</p>}</article>)}</div>}
      </>}
    </>}
    {stale.length > 0 && <section className="sg-recheck"><h3>{stale.length} 项任务等待当前稿本复核</h3><p>导入新版不会自动判定旧问题已解决。核对新材料后再记录结论。</p>{stale.map(issue => <article key={issue.id}><div><strong>{issue.title}</strong><span className="sg-muted">原处理状态：{STATUS_NAMES[issue.status]}</span></div><button className="sg-primary" onClick={() => editIssue(issue, true)}>开始复核</button></article>)}</section>}
  </>;
}

