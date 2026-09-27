import { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowRight, ArrowUp, BookOpen, Check, Download, FileText, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { addDraftScene, buildGraph, discardDraft, makeEvidence, moveDraftScene, previewDraft, publishDraft, removeDraftScene, renameDraft, startDraft, updateDraftScene, type Project } from './domain';
import { issueImpact } from './revision-analysis';
import { EvidenceButton, getVersion, Modal, saveFile, STATUS_NAMES } from './components';
import { LineDiff } from './RevisionTools';
import type { ViewProps } from './ProjectViews';

export type EditFocus = { sceneId?: string; issueId?: string; nonce: number };
export function EditorView({ project, update, openSource, editIssue, focus, published }: ViewProps & { focus?: EditFocus; published: (project: Project) => void }) {
  const draft = project.draft;
  const [selectedId, setSelectedId] = useState(draft?.scenes.find(s => s.sourceSceneId === focus?.sceneId)?.id || draft?.lastEditedSceneId || draft?.scenes[0]?.id || '');
  const [filter, setFilter] = useState('');
  const [showCompare, setShowCompare] = useState(false);
  const [error, setError] = useState('');
  const [dialog, setDialog] = useState<'publish' | 'discard' | 'remove' | 'reset' | null>(null);
  const [label, setLabel] = useState(draft?.label || '');
  const dialogTrigger = useRef<HTMLElement | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const selected = draft?.scenes.find(s => s.id === selectedId) || draft?.scenes[0];
  const base = getVersion(project, draft?.baseVersionId);
  const original = base.scenes.find(s => s.id === selected?.sourceSceneId);
  const preview = useMemo(() => draft ? previewDraft(project) : null, [project]);
  const graph = useMemo(() => buildGraph(project, base.id), [project.entities, project.versions, base.id]);
  const impacts = useMemo(() => project.issues.map(issue => ({ issue, impact: issueImpact(project, issue, base.id) })), [project.issues, project.versions, base.id]);
  const linked = impacts.filter(({ issue, impact }) => issue.id === focus?.issueId || (!!selected?.sourceSceneId && impact.mappings.some(m => m.candidate?.sceneId === selected?.sourceSceneId || (m.original.versionId === base.id && m.original.sceneId === selected?.sourceSceneId))));
  const relatedEntities = graph.edges.filter(edge => edge.sceneId === selected?.sourceSceneId).map(edge => edge.entityId);
  const relatedScenes = graph.edges.filter(edge => relatedEntities.includes(edge.entityId) && edge.sceneId !== selected?.sourceSceneId);
  const related = [...new Set(relatedScenes.map(edge => edge.sceneId))].slice(0, 6);
  useEffect(() => {
    const target = draft?.scenes.find(s => s.sourceSceneId === focus?.sceneId);
    if (target) setSelectedId(target.id);
  }, [focus?.nonce]);
  function mutate(operation: () => Project) { try { update(operation()); setError(''); return true; } catch (e) { setError(e instanceof Error ? e.message : '修改未保存'); return false; } }
  function openDialog(value: 'publish' | 'discard' | 'remove' | 'reset') { dialogTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; setDialog(value); }
  function closeDialog() { setDialog(null); requestAnimationFrame(() => { if (dialogTrigger.current?.isConnected) dialogTrigger.current.focus(); else editorRef.current?.focus(); }); }
  useEffect(() => { if (draft) setLabel(draft.label); }, [draft?.baseVersionId]);
  useEffect(() => { if (focus?.sceneId) requestAnimationFrame(() => { editorRef.current?.focus({ preventScroll: true }); editorRef.current?.scrollIntoView({ block: 'center' }); }); }, [focus?.nonce]);
  if (!draft) return <><div className="sg-view-head"><div><p className="sg-overline">REVISION DESK</p><h2>带着任务，改好这一场。</h2><p>从当前稿本建立修订草稿，逐场修改、增删和调整顺序。完成后统一生成下一稿，原稿与旧引用保留。</p></div></div><div className="sg-empty"><BookOpen/><div><h3>当前还没有未完成的修订稿</h3><p>修订草稿会自动保存在此浏览器，可以随时离开再继续。</p><button className="sg-primary" onClick={() => mutate(() => startDraft(project))}><Plus/>开始一轮改稿</button></div></div>{error && <p className="sg-error" role="alert">{error}</p>}</>;
  const index = draft.scenes.findIndex(s => s.id === selected?.id);
  const heading = (text: string) => text.split('\n').find(line => line.trim())?.trim() || '未填写场头';
  return <>
    <div className="sg-view-head"><div><p className="sg-overline">REVISION DESK / {base.label}</p><h2>修改这一场，保留前后的依据。</h2><p>草稿与正式稿分开保存。自动保存状态在顶部；只有「生成修订稿」才会进入版本比较与复核。</p></div></div>
    <div className="sg-editor-toolbar"><div><span className="sg-badge">未生成的修订草稿</span><span className="sg-muted"> {draft.scenes.length} 场 · {preview?.changedScenes || 0} 场涉及修改</span></div><div className="sg-actions"><button className="sg-quiet" onClick={() => saveFile(`${project.title}-未完成草稿.fountain`, preview?.text || '')}><Download/>导出草稿</button><button className="sg-secondary" onClick={() => openDialog('discard')}>放弃本轮草稿</button><button className="sg-primary sg-editor-title-action" disabled={!preview?.changedScenes} onClick={() => { setLabel(draft.label); openDialog('publish'); }}><Check/>生成修订稿</button></div></div>
    <label className="sg-field sg-draft-name">修订草稿名称<input value={label} maxLength={100} onChange={e => { setLabel(e.target.value); if (e.target.value.trim()) mutate(() => renameDraft(project, e.target.value)); }} onBlur={() => { if (!label.trim()) setLabel(draft.label); }}/></label>
    {draft.baseVersionId !== project.activeVersionId && <p className="sg-error">正式稿已改变，这份草稿仍基于「{base.label}」。请先导出草稿或备份，重新建立修订；不会自动覆盖当前稿本。</p>}
    {error && <p className="sg-error" role="alert">{error}</p>}
    <div className="sg-editor-desk"><aside className="sg-editor-scenes"><label className="sg-field">查找草稿场次<input value={filter} onChange={e => setFilter(e.target.value)} placeholder="场次编号或地点"/></label><div>{draft.scenes.map((scene, i) => ({ scene, i })).filter(({ scene, i }) => `${i + 1} ${heading(scene.text)}`.includes(filter)).map(({ scene, i }) => { const source = base.scenes.find(s => s.id === scene.sourceSceneId); return <button key={scene.id} aria-pressed={scene.id === selected?.id} onClick={() => setSelectedId(scene.id)}><span>{String(i + 1).padStart(2, '0')}</span><strong>{heading(scene.text)}</strong><small>{!source ? '新增场次' : source.text !== scene.text ? '正文已修改' : source.number !== i + 1 ? '位置已调整' : '正文未改'}</small></button>; })}</div><button className="sg-secondary" onClick={() => {
      try { const next = addDraftScene(project, { afterSceneId: selected?.id, text: '内景 新场次 - 日\n\n' }); const added = next.draft!.scenes.find(s => !draft.scenes.some(old => old.id === s.id))!; update(next); setSelectedId(added.id); setFilter(''); setError(''); } catch (e) { setError(e instanceof Error ? e.message : '场次未添加'); }
    }}><Plus/>在此后新增场次</button></aside>
    <section className="sg-editor-writing">{selected ? <><header><div><span className="sg-overline">草稿第 {index + 1} 场{original ? ` / 原稿第 ${original.number} 场` : ' / 新增'}</span><h3>{heading(selected.text)}</h3></div><div className="sg-actions"><button className="sg-icon" aria-label="将当前场次上移" disabled={index === 0} onClick={() => mutate(() => moveDraftScene(project, selected.id, 'up'))}><ArrowUp/></button><button className="sg-icon" aria-label="将当前场次下移" disabled={index === draft.scenes.length - 1} onClick={() => mutate(() => moveDraftScene(project, selected.id, 'down'))}><ArrowDown/></button><button className="sg-icon" aria-label="删除草稿当前场次" disabled={draft.scenes.length < 2} onClick={() => openDialog('remove')}><Trash2/></button></div></header>
      <label className="sg-field">编辑本场剧本<textarea aria-label="编辑本场剧本" ref={editorRef} rows={21} spellCheck={false} value={selected.text} maxLength={2_000_000} onChange={e => mutate(() => updateDraftScene(project, selected.id, e.target.value))} onKeyDown={e => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') e.preventDefault(); }}/></label><p className="sg-muted">第一行保留场头。新增场次请用左侧入口；行号在生成修订稿后重新计算。</p>
      <div className="sg-toolbar"><button className="sg-secondary" onClick={() => setShowCompare(!showCompare)}>{showCompare ? '收起文字对照' : '对照本场改动'}</button>{original && <button className="sg-quiet" disabled={original.text === selected.text} onClick={() => openDialog('reset')}><RotateCcw/>还原本场原文</button>}</div>
      {showCompare && <LineDiff key={selected.id} before={original?.text || ''} after={selected.text} beforeStart={original?.lineStart || 1}/>}
    </> : <p className="sg-empty">请选择一个草稿场次。</p>}</section>
    <aside className="sg-editor-context"><span className="sg-overline">修改时一起看</span><h3>本场相关任务 · {linked.length}</h3>{linked.length ? linked.map(({ issue }) => <article key={issue.id}><span className="sg-status">{STATUS_NAMES[issue.status]}</span><h4>{issue.title}</h4><p>{issue.note || '尚未填写修改要求。'}</p>{issue.evidence.map((ref, i) => <EvidenceButton key={i} project={project} evidence={ref} open={openSource}/>)}<button className="sg-quiet" onClick={() => editIssue(issue)}>编辑任务说明<ArrowRight/></button></article>) : <p className="sg-muted">本场还没有关联的任务，可以直接修改正文；任务的引用会保留在正式稿上。</p>}
      <details className="sg-related-context"><summary>原稿中的关联场次 · {related.length}</summary><p className="sg-muted">以下场次也提及本场的人物或道具，供你检查交接与前后文；不代表它们一定需要修改。</p>{related.map(id => { const scene = base.scenes.find(s => s.id === id)!; return <article key={id}><h4>第 {scene.number} 场 · {scene.heading}</h4><p>{[...new Set(relatedScenes.filter(e => e.sceneId === id).map(e => project.entities.find(item => item.id === e.entityId)?.name))].join('、')}</p><button className="sg-secondary" onClick={() => openSource(makeEvidence(project, base.id, id))}>查看原稿</button><button className="sg-quiet" onClick={() => { const item = draft.scenes.find(s => s.sourceSceneId === id); if (item) { setSelectedId(item.id); setFilter(''); } }} disabled={!draft.scenes.some(s => s.sourceSceneId === id)}>转到此场编辑</button></article>; })}{!related.length && <p className="sg-muted">尚无已确认的实体关联。</p>}</details>
    </aside></div>
    {dialog === 'publish' && <Modal title="生成一份可复核的修订稿" subtitle={`基于 ${base.label} · 旧稿保留`} close={closeDialog} wide><label className="sg-field">修订稿名称<input value={label} maxLength={100} onChange={e => setLabel(e.target.value)}/></label><p>本轮有 {preview?.changedScenes} 场涉及修改。生成后，草稿成为正式版本，任务进入按依据变化分类的复核列表。</p>{preview?.diagnostics.map((d, i) => <p className={d.level === 'error' ? 'sg-error' : 'sg-notice'} key={i}>{d.message}</p>)}<ol className="sg-preview-scenes">{preview?.scenes.map((s, i) => <li key={s.draftSceneId}><strong>{String(i + 1).padStart(2, '0')}</strong><span>{s.heading}<small>修订稿第 {s.lineStart}–{s.lineEnd} 行</small></span></li>)}</ol>{error && <p className="sg-error" role="alert">{error}</p>}<div className="sg-modal-actions"><button className="sg-secondary" onClick={closeDialog}>继续编辑</button><button className="sg-primary" disabled={!preview?.canPublish || !label.trim()} onClick={() => { try { const next = publishDraft(project, { label }); published(next); setDialog(null); } catch (e) { setError(e instanceof Error ? e.message : '修订稿未生成'); } }}>确认生成修订稿</button></div></Modal>}
    {dialog && dialog !== 'publish' && <Modal title={dialog === 'discard' ? '放弃本轮修订草稿？' : dialog === 'remove' ? '从草稿中删除这一场？' : '将这一场还原为原稿？'} close={closeDialog}><p>{dialog === 'discard' ? '已生成的版本和任务都会保留。这份尚未生成的草稿将被移除，可先导出文本。' : dialog === 'remove' ? '正式原稿和任务引用仍然保留。删除将在生成修订稿时计入本轮变化。' : '只还原当前场次的文字，其他场次的修改继续保留。'}</p>{dialog === 'discard' && <button className="sg-secondary" onClick={() => saveFile(`${project.title}-未完成草稿.fountain`, preview?.text || '')}><Download/>先导出草稿</button>}<div className="sg-modal-actions"><button className="sg-secondary" onClick={closeDialog}>取消</button><button className="sg-danger" onClick={() => { const ok = mutate(() => dialog === 'discard' ? discardDraft(project) : dialog === 'remove' ? removeDraftScene(project, selected!.id) : updateDraftScene(project, selected!.id, original!.text)); if (ok) closeDialog(); }}>确认{dialog === 'discard' ? '放弃草稿' : dialog === 'remove' ? '删除此场' : '还原本场'}</button></div></Modal>}
  </>;
}
