import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, BookOpen, Check, CloudOff, Download, FileUp, FlaskConical, GitBranch, ListChecks, LoaderCircle, Pencil, Plus, RotateCcw, Search, Trash2 } from 'lucide-react';
import { cloneProject, createIssue, isIssueStale, reviewIssue, updateIssue, validateBackup, type EvidenceRef, type IssueInput, type Project, type ReviewIssue } from './domain';
import { emptyLibrary, loadLibrary, saveLibrary, type Library } from './project-store';
import { sampleProject } from './sample-project';
import { BackupButton, backupProject, getVersion, Modal, shortDate } from './components';
import { ImportDialog, IssueDialog, SourceModal } from './dialogs';
import { ScriptView, SearchView, IssuesView, VersionsView, type ViewProps } from './ProjectViews';

type Tab = 'script' | 'search' | 'issues' | 'versions';
type Popup = { kind: 'import'; project?: Project } | { kind: 'source'; project: Project; ref: EvidenceRef } | { kind: 'issue'; project: Project; issue?: ReviewIssue; refs?: EvidenceRef[]; review?: boolean } | { kind: 'rename' | 'delete'; project: Project } | { kind: 'restore' | 'reload' };

export function Workbench() {
  const [library, setLibrary] = useState<Library>(emptyLibrary);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [loadAttempt, setLoadAttempt] = useState(0);
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'error'>('saved');
  const [saveError, setSaveError] = useState('');
  const [notice, setNotice] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('script');
  const [popup, setPopup] = useState<Popup | null>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const generation = useRef(0);
  const latest = useRef(library);
  const dirty = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingCount = useRef(0);
  const project = library.projects.find(p => p.id === activeId);

  useEffect(() => {
    let cancelled = false;
    setLoadError('');
    loadLibrary().then(value => {
      if (cancelled) return;
      latest.current = value; setLibrary(value); setReady(true);
      setActiveId(value.selectedProjectId);
    }).catch(e => { if (!cancelled) setLoadError(e instanceof Error ? e.message : '读取本机项目失败。'); });
    return () => { cancelled = true; };
  }, [loadAttempt]);

  async function persist(snapshot = latest.current, token = generation.current) {
    savingCount.current++;
    setSaveState('pending');
    try {
      await saveLibrary(snapshot);
      if (token === generation.current) { dirty.current = false; setSaveState('saved'); setSaveError(''); }
    } catch (e) {
      if (token === generation.current) { dirty.current = true; setSaveState('error'); setSaveError(e instanceof Error ? e.message : '保存失败，请备份后重试。'); }
    } finally { savingCount.current--; }
  }
  function change(next: Library) {
    latest.current = next; setLibrary(next); generation.current++; dirty.current = true;
    setSaveState('pending'); setSaveError('');
    if (timer.current) clearTimeout(timer.current);
    const token = generation.current;
    timer.current = setTimeout(() => { timer.current = null; void persist(next, token); }, 300);
  }
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => { if (dirty.current) { event.preventDefault(); event.returnValue = ''; } };
    window.addEventListener('beforeunload', warn);
    return () => {
      window.removeEventListener('beforeunload', warn);
      if (timer.current) { clearTimeout(timer.current); timer.current = null; void saveLibrary(latest.current).catch(() => undefined); }
    };
  }, []);
  function open(value: Popup) { trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setPopup(value); }
  function close() { setPopup(null); requestAnimationFrame(() => { if (trigger.current?.isConnected) trigger.current.focus(); }); }
  function select(p: Project | null) {
    setActiveId(p?.id || null); setTab('script'); setNotice('');
    change({ ...latest.current, selectedProjectId: p?.id || null });
  }
  function replace(p: Project) {
    change({ ...latest.current, projects: latest.current.projects.map(item => item.id === p.id ? p : item) });
  }
  function add(p: Project) {
    if (latest.current.projects.length >= 30) throw new Error('本机已保存 30 个项目。请先备份并删除不再需要的项目，再创建。');
    change({ ...latest.current, projects: [p, ...latest.current.projects], selectedProjectId: p.id });
    setActiveId(p.id); setTab('script'); setNotice('');
  }
  function makeSample() {
    try { add(sampleProject()); } catch (e) { setNotice(e instanceof Error ? e.message : '示例创建失败。'); }
  }
  function saveTask(data: IssueInput) {
    if (popup?.kind !== 'issue') return;
    const original = latest.current.projects.find(p => p.id === popup.project.id)!;
    let next = popup.issue ? updateIssue(original, popup.issue.id, data) : createIssue(original, data);
    if (popup.issue && popup.review) next = reviewIssue(next, popup.issue.id, { versionId: next.activeVersionId, status: data.status, note: data.note, evidence: data.evidence });
    replace(next); close(); setTab('issues');
  }
  const stale = project?.issues.filter(i => isIssueStale(project, i)).length || 0;
  const viewProps: ViewProps | null = project ? {
    project, update: replace, openSource: ref => open({ kind: 'source', project, ref }),
    newIssue: refs => open({ kind: 'issue', project, refs }),
    editIssue: (issue, review = false) => open({ kind: 'issue', project, issue, review }),
    importVersion: () => open({ kind: 'import', project }),
  } : null;
  const viewComponents = { script: ScriptView, search: SearchView, issues: IssuesView, versions: VersionsView };
  const View = viewComponents[tab];
  const nav = [
    { id: 'script' as const, title: '剧本与关系', sub: '核对分场 · 维护索引', icon: BookOpen },
    { id: 'search' as const, title: '查证原文', sub: '字词命中 · 跨场追溯', icon: Search },
    { id: 'issues' as const, title: '改稿任务', sub: '记录疑点 · 明确处理', icon: ListChecks },
    { id: 'versions' as const, title: '版本与复查', sub: '比较变更 · 核对结果', icon: GitBranch },
  ];

  return <div className="sg-app"><header className="sg-topbar"><a className="sg-brand" href="#" onClick={e => { e.preventDefault(); if (ready) select(null); }}><GitBranch/>ScriptGraph<small>剧本改稿工作台</small></a><span className="sg-save-state" data-state={saveState} role="status">{!ready ? <><LoaderCircle/>读取本机项目</> : saveState === 'saved' ? <><Check/>已保存到此浏览器</> : saveState === 'pending' ? <><LoaderCircle/>正在保存…</> : <><CloudOff/>修改尚未保存</>}</span><div className="sg-top-actions"><a href="#lab" onClick={e => { if (dirty.current) { e.preventDefault(); setNotice('修改尚未保存，请等待保存成功或先备份项目，再进入技术实验室。'); } }}><FlaskConical/>技术实验室</a><a href="https://daizhouchen.github.io/">作品集 ↗</a></div></header>
    <main className="sg-main">
      {loadError && <div className="sg-error" role="alert"><div><h2>暂时无法打开本机项目</h2><p>{loadError}。未创建空记录覆盖原数据。</p><button className="sg-secondary" onClick={() => setLoadAttempt(v => v + 1)}><RotateCcw/>重新读取</button></div></div>}
      {!ready && !loadError && <div className="sg-empty">正在读取你的项目…</div>}
      {saveError && <div className="sg-error" role="alert"><div><p>{saveError}</p><div className="sg-actions"><button className="sg-secondary" onClick={() => void persist()}><RotateCcw/>重试保存</button>{saveError.includes('另一个标签页') && <button className="sg-secondary" onClick={() => open({ kind: 'reload' })}>重新载入最新记录</button>}{project && <BackupButton project={project}/>}</div></div></div>}
      {notice && <div className="sg-notice" role="status">{notice}<button className="sg-quiet" onClick={() => setNotice('')}>收起</button></div>}
      {ready && !project && <>
        <section className="sg-library-hero"><div className="sg-hero-copy"><span className="sg-overline">READ THE CONNECTIONS. REWRITE WITH EVIDENCE.</span><h1>把跨场的疑点，<br/>改成有依据的下一稿。</h1><p>给编剧与剧本统筹的改稿工作台。导入剧本，沿人物和道具查回原文；把疑点留下来，在下一稿逐项核对。</p><div className="sg-actions"><button className="sg-primary" onClick={() => open({ kind: 'import' })}><Plus/>导入我的剧本</button><button className="sg-secondary" onClick={makeSample}>用完整示例走一遍<ArrowRight/></button></div><p className="sg-muted">支持 Fountain / TXT · 本机保存 · 无需注册</p></div>
        <aside className="sg-start-sheet"><span className="sg-overline">从疑点到复核</span><h2>每次改稿，都有迹可循。</h2><ul><li>先确认分场和人物，建立可核对的关系索引。</li><li>引用一处或多处原文，写清修改方案与验收条件。</li><li>导入下一稿，看清增删、改动与调序，再复核任务。</li></ul><p className="sg-muted">示例《末班放映》含 8 场原稿、2 项人工审阅任务和可导入的修订稿。</p></aside></section>
        <div className="sg-view-head"><div><span className="sg-overline">YOUR WORKSPACE</span><h2>我的剧本 <small>{library.projects.length ? `· ${library.projects.length}` : ''}</small></h2><p>保留每一稿、每一处引用和每一次复核。</p></div><button className="sg-secondary" onClick={() => open({ kind: 'restore' })}><FileUp/>恢复项目备份</button></div>
        <div className="sg-project-list">{!library.projects.length && <div className="sg-empty"><BookOpen/><div><h3>从第一份剧本开始</h3><p>没有剧本也可以打开完整示例，先体验一次带着证据改稿的流程。</p></div></div>}{library.projects.map((p, index) => <article className="sg-project-row" key={p.id}><div className="sg-project-mark">{String(index + 1).padStart(2, '0')}</div><div className="sg-project-description"><h3>{p.title}</h3><p>{getVersion(p).label} · {getVersion(p).scenes.length} 场 · {p.versions.length} 稿 · {p.issues.filter(i => i.status === 'open' || i.status === 'working').length} 项待处理</p><p>更新于 {shortDate(p.updatedAt)}{p.origin === 'sample' ? ' · 可编辑示例' : ''}</p></div><div className="sg-row-actions"><button className="sg-primary" onClick={() => select(p)}>继续改稿<ArrowRight/></button><button className="sg-icon" aria-label={`重命名 ${p.title}`} onClick={() => open({ kind: 'rename', project: p })}><Pencil/></button><button className="sg-icon" aria-label={`备份 ${p.title}`} onClick={() => backupProject(p)}><Download/></button><button className="sg-icon" aria-label={`删除 ${p.title}`} onClick={() => open({ kind: 'delete', project: p })}><Trash2/></button></div></article>)}</div>
      </>}
      {ready && project && viewProps && <>
        <header className="sg-project-header"><div className="sg-breadcrumb"><button className="sg-quiet" onClick={() => select(null)}><ArrowLeft/>我的剧本</button><span>/ 当前项目</span></div><div className="sg-project-title"><h1>{project.title}</h1><span className="sg-badge">{getVersion(project).label}</span><p>最近更新 {shortDate(project.updatedAt)} · {project.origin === 'sample' ? '可编辑示例，任务来自预设人工审阅' : '你的原文，保存在本机'}</p></div><div className="sg-project-actions"><button className="sg-icon" aria-label="重命名项目" onClick={() => open({ kind: 'rename', project })}><Pencil/></button><BackupButton project={project}/><button className="sg-primary" onClick={() => open({ kind: 'import', project })}><FileUp/>导入／编辑新版</button></div></header>
        <div className="sg-stats"><div><strong>{getVersion(project).scenes.length}</strong><span>当前场次</span></div><div><strong>{project.entities.filter(e => e.confirmed).length}</strong><span>已确认索引</span></div><div><strong>{project.issues.filter(i => i.status === 'open' || i.status === 'working').length}</strong><span>待处理任务</span></div><div><strong>{stale}</strong><span>需在本稿复核</span></div></div>
        {stale > 0 && tab !== 'versions' && <div className="sg-notice"><p>{stale} 项任务尚未核对当前稿本。请查看原文依据，补充本稿的复核结论。</p><button className="sg-quiet" onClick={() => setTab('versions')}>前往复核<ArrowRight/></button></div>}
        {project.origin === 'sample' && project.versions.length === 1 && tab === 'script' && <div className="sg-notice"><p>首次体验：先核对 2 项交接疑点，再从「导入／编辑新版」载入示例修订稿，看修改如何影响任务。</p><button className="sg-quiet" onClick={() => setTab('issues')}>查看示例任务<ArrowRight/></button></div>}<div className="sg-desk"><nav className="sg-nav" aria-label="改稿工作步骤">{nav.map(item => <button key={item.id} aria-current={tab === item.id ? 'page' : undefined} onClick={() => setTab(item.id)}><item.icon/><span><strong>{item.title}</strong><small>{item.sub}</small></span></button>)}<p>原文是依据，关系是线索。<br/>最终判断由你完成。</p></nav><section className="sg-content" key={`${project.id}-${project.activeVersionId}-${tab}`}><View {...viewProps}/></section></div>
      </>}
      <footer className="sg-library-footer"><p>项目只保存在当前浏览器。清理网站数据会丢失记录，请定期导出备份。</p><a href="https://github.com/daizhouchen/scriptgraph-rag" target="_blank" rel="noreferrer">源码与 GraphRAG 评测 ↗</a></footer>
    </main>
    {popup?.kind === 'import' && <ImportDialog project={popup.project} close={close} commit={p => { if (popup.project) { replace(p); setTab('versions'); } else add(p); close(); }}/>} 
    {popup?.kind === 'source' && <SourceModal project={popup.project} evidence={popup.ref} close={close}/>}
    {popup?.kind === 'issue' && <IssueDialog project={popup.project} issue={popup.issue} initialEvidence={popup.refs} review={popup.review} close={close} save={saveTask}/>}
    {popup?.kind === 'rename' && <RenameDialog project={popup.project} close={close} commit={title => { replace({ ...popup.project, title, updatedAt: Date.now() }); close(); }}/>} 
    {popup?.kind === 'delete' && <Modal title={`删除「${popup.project.title}」？`} close={close}><p>将从此浏览器移除 {popup.project.versions.length} 稿原文和 {popup.project.issues.length} 项任务。可以先导出完整备份。</p><BackupButton project={popup.project}/><div className="sg-modal-actions"><button className="sg-secondary" onClick={close}>保留项目</button><button className="sg-danger" onClick={() => { const id = popup.project.id; change({ ...latest.current, projects: latest.current.projects.filter(p => p.id !== id), selectedProjectId: latest.current.selectedProjectId === id ? null : latest.current.selectedProjectId }); if (activeId === id) setActiveId(null); close(); }}>确认删除项目</button></div></Modal>}
    {popup?.kind === 'reload' && <Modal title="重新载入其他页面已保存的记录？" close={close}><p>这会放弃本页尚未保存的修改。请先备份本页项目；重新载入后，可将备份恢复为独立副本继续处理。</p>{project && <BackupButton project={project}/>}<div className="sg-modal-actions"><button className="sg-secondary" onClick={close}>留在此页</button><button className="sg-danger" onClick={() => { dirty.current = false; location.reload(); }}>放弃未保存修改并载入</button></div></Modal>}
    {popup?.kind === 'restore'  && <RestoreDialog close={close} commit={p => { add(cloneProject(p, { title: `${p.title} · 恢复副本`.slice(0, 100) })); close(); }}/>} 
  </div>;
}

function RenameDialog({ project, close, commit }: { project: Project; close: () => void; commit: (title: string) => void }) {
  const [title, setTitle] = useState(project.title);
  return <Modal title="重命名项目" close={close}><label className="sg-field">项目名称<input value={title} maxLength={100} onChange={e => setTitle(e.target.value)}/></label><div className="sg-modal-actions"><button className="sg-secondary" onClick={close}>取消</button><button className="sg-primary" disabled={!title.trim()} onClick={() => commit(title.trim())}>保存名称</button></div></Modal>;
}

function RestoreDialog({ close, commit }: { close: () => void; commit: (project: Project) => void }) {
  const [candidate, setCandidate] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  async function read(file?: File) {
    const token = ++request.current; setCandidate(null); setError('');
    if (!file) return;
    if (file.size > 24_000_000) { setError('备份文件超过 24 MB，未导入。'); return; }
    setBusy(true);
    try {
      const result = validateBackup(JSON.parse(await file.text()));
      if (token !== request.current) return;
      if (!result.ok) throw new Error(result.errors.join('；'));
      setCandidate(result.project);
    } catch (e) { if (token === request.current) setError(e instanceof SyntaxError ? '文件不是有效的 JSON 备份，未修改任何项目。' : e instanceof Error ? e.message : '无法读取备份。'); }
    finally { if (token === request.current) setBusy(false); }
  }
  return <Modal title="恢复项目备份" subtitle="校验完成后，创建独立副本" close={close}><label className="sg-field">选择 ScriptGraph JSON 备份<input type="file" accept=".json,application/json" onChange={e => void read(e.target.files?.[0])}/></label><p className="sg-muted">恢复时会检查原文、分场和每条任务引用。已有项目保持原样。</p>{busy && <p role="status">正在核验备份…</p>}{error && <p className="sg-error" role="alert">{error}</p>}{candidate && <div className="sg-notice"><div><h3>{candidate.title}</h3><p>{candidate.versions.length} 稿原文 · {candidate.entities.length} 项索引 · {candidate.issues.length} 项任务</p><p>当前稿本：{getVersion(candidate).label}，{getVersion(candidate).scenes.length} 场。恢复后可继续修改。</p></div></div>}<div className="sg-modal-actions"><button className="sg-secondary" onClick={close}>取消</button><button className="sg-primary" disabled={!candidate || busy} onClick={() => { if (candidate) try { commit(candidate); } catch (e) { setError(e instanceof Error ? e.message : '恢复失败'); } }}>恢复为新项目</button></div></Modal>;
}
