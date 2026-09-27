import { useMemo, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, FileUp, Plus, Check, Download } from 'lucide-react';
import { addVersion, createProject, setEntities, parseScript, makeEvidence, resolveEvidence, diffVersions, type Project, type EvidenceRef, type ReviewIssue, type IssueInput, type ParsedScript, type EntityInput } from './domain';
import { Modal, Lines, EvidenceButton, getVersion, STATUS_NAMES, saveFile } from './components';
import { EvidencePicker, LineDiff } from './RevisionTools';
import { issueImpact } from './revision-analysis';
import { SAMPLE_REVISION } from './sample-project';

export function ImportDialog({ project, close, commit }: { project?: Project; close: () => void; commit: (project: Project) => void }) {
  const [title, setTitle] = useState(project?.title || '');
  const [label, setLabel] = useState(project ? `稿本 ${project.versions.length + 1}` : '初稿');
  const [text, setText] = useState(project ? getVersion(project).text : '');
  const [fileName, setFileName] = useState('');
  const [manual, setManual] = useState('');
  const [parsed, setParsed] = useState<ParsedScript | null>(null);
  const [candidateProject, setCandidateProject] = useState<Project | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [props, setProps] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const request = useRef(0);
  function invalidate() { request.current++; setBusy(false); setParsed(null); setCandidateProject(null); setError(''); }
  async function loadFile(file?: File) {
    if (!file) return;
    invalidate();
    if (!/\.(fountain|txt)$/i.test(file.name)) { setError('请选择 UTF-8 编码的 .fountain 或 .txt 文件，也可以直接粘贴文本。'); return; }
    if (file.size > 6_000_000) { setError('文件超过 6 MB，请分成单集或较短的剧本后导入。'); return; }
    const token = request.current;
    setBusy(true);
    try {
      const content = new TextDecoder('utf-8', { fatal: true }).decode(await file.arrayBuffer());
      if (token !== request.current) return;
      setText(content); setFileName(file.name); if (!title) setTitle(file.name.replace(/\.[^.]+$/, ''));
    } catch { if (token === request.current) setError('无法按 UTF-8 读取这个文件。请另存为 UTF-8 文本，或复制内容到输入框。'); }
    finally { if (token === request.current) setBusy(false); }
  }
  function preview() {
    setError(''); setBusy(true);
    const token = ++request.current;
    setTimeout(() => {
      if (token !== request.current) return;
      try {
        const sceneStarts = manual.trim() ? manual.split(/[,，\s]+/).map(Number) : undefined;
        if (sceneStarts?.some(n => !Number.isInteger(n) || n < 1)) throw new Error('手动分场请填写从 1 开始的行号，用逗号分隔。');
        const result = parseScript(text, { sceneStarts }); setParsed(result);
        if (!result.canImport) { setCandidateProject(null); return; }
        const draft = project ? addVersion(project, { text, label, sceneStarts }) : createProject({ title, text, versionLabel: label, origin: fileName ? 'import' : 'paste', sceneStarts });
        setCandidateProject(draft);
        setSelected(result.entityCandidates.filter(c => c.source !== 'candidate').map(c => `${c.kind}:${c.name}`));
      } catch (e) { setError(e instanceof Error ? e.message : '无法解析，请检查文本。'); }
      finally { setBusy(false); }
    }, 0);
  }
  function existingEntity(kind: string, name: string) { return project?.entities.find(e => e.kind === kind && [e.name, ...e.aliases].some(value => value.toLocaleLowerCase() === name.toLocaleLowerCase())); }
  function confirm() {
    if (!candidateProject || !parsed) return;
    try {
      const entries = new Map<string, EntityInput>();
      for (const e of project?.entities || []) entries.set(`${e.kind}:${e.name}`, e);
      for (const e of parsed.entityCandidates) if (selected.includes(`${e.kind}:${e.name}`) && !existingEntity(e.kind, e.name)) entries.set(`${e.kind}:${e.name}`, { kind: e.kind, name: e.name, aliases: [], confirmed: true });
      for (const name of props.split(/[,，、\n]/).map(x => x.trim()).filter(Boolean)) if (!entries.has(`prop:${name}`) && !existingEntity('prop', name)) entries.set(`prop:${name}`, { kind: 'prop', name, aliases: [], confirmed: true });
      commit(setEntities(candidateProject, [...entries.values()]));
    } catch (e) { setError(e instanceof Error ? e.message : '项目未创建，请重试。'); }
  }
  const diff = candidateProject && project ? diffVersions(candidateProject, project.activeVersionId, candidateProject.activeVersionId) : null;
  return <Modal title={project ? '导入新版，保留原稿与审阅记录' : '导入你的剧本'} subtitle={project ? project.title : '文本只在当前浏览器处理'} close={close} wide>
    <div className="sg-import-grid"><div className="sg-import-input sg-form">
      {!project && <label className="sg-field">项目名称<input value={title} maxLength={100} onChange={e => { setTitle(e.target.value); invalidate(); }} placeholder="例如：短片《末班放映》"/></label>}
      <label className="sg-field">稿本名称<input value={label} maxLength={80} onChange={e => { setLabel(e.target.value); invalidate(); }}/></label>
      <label className="sg-file-picker"><FileUp size={19}/><span>选择 Fountain / TXT 文件</span><input type="file" accept=".fountain,.txt,text/plain" onChange={e => loadFile(e.target.files?.[0])}/></label>
      {fileName && <p className="sg-muted">已读取：{fileName}</p>}
      <label className="sg-field">或粘贴完整剧本文本<textarea rows={13} value={text} maxLength={2_000_000} onChange={e => { setText(e.target.value); setFileName(''); invalidate(); }} placeholder={'内景 放映室 - 夜\n\n@林夏\n散场以后，把钥匙还给我。'}/></label>
      <details className="sg-format-help"><summary>分场格式与手动修正</summary><p>支持「内景／外景 地点 - 时间」、INT./EXT. 和 Fountain 场头。中文人物可使用 @姓名。解析结果会先给你确认。</p><label className="sg-field">指定场次起始行（可选）<input value={manual} onChange={e => { setManual(e.target.value); invalidate(); }} placeholder="例如：1, 18, 35"/></label><p>没有场头的短文本可填 1，作为单场导入。原文不会被改写。</p></details>
      {project?.origin === 'sample' && <button className="sg-quiet" onClick={() => { setText(SAMPLE_REVISION); setLabel('补足交接的修订稿'); setFileName(''); setManual(''); invalidate(); }}>载入示例修订稿：补足两次交接</button>}
      <button className="sg-primary" disabled={busy || !text.trim() || !label.trim() || (!project && !title.trim())} onClick={preview}>{busy ? '正在解析…' : '解析并预览'}<ArrowRight size={16}/></button>
    </div><div className="sg-import-preview">
      {!parsed && <div className="sg-empty"><FileUp size={28}/><h3>先确认结构，再进入工作台</h3><p>这里会显示识别到的场次、人物候选和需要你修正的地方。导入新版时还会预览变化。</p></div>}
      {parsed && <>
        <h3>{parsed.scenes.length} 个场次 · {parsed.lines.length} 行原文</h3>
        {parsed.diagnostics.map((d, i) => <p className={d.level === 'error' ? 'sg-error' : 'sg-notice'} key={i}>{d.line ? `第 ${d.line} 行：` : ''}{d.message}</p>)}
        {diff && <p className="sg-notice">与当前稿本比较：修改 {diff.counts.modified} · 新增 {diff.counts.added} · 删除 {diff.counts.removed} · 调序 {diff.counts.moved} · 待确认对应 {diff.counts.ambiguous}。已有任务保留旧版证据，需逐项复查。</p>}
        <ol className="sg-preview-scenes">{parsed.scenes.map(s => <li key={s.id}><strong>{String(s.number).padStart(2, '0')}</strong><span>{s.heading}<small>第 {s.lineStart}–{s.lineEnd} 行</small></span></li>)}</ol>
        {!!candidateProject && <><h3>确认人物与道具</h3><p className="sg-muted">新增候选请核对后勾选。已有索引及别名会保留，可在「剧本与关系」中修改或暂停。</p><div className="sg-candidates">{parsed.entityCandidates.map(c => { const key = `${c.kind}:${c.name}`; const existing = existingEntity(c.kind, c.name); return <label className="sg-check-row" key={key}><input type="checkbox" disabled={!!existing} checked={existing ? existing.confirmed : selected.includes(key)} onChange={e => setSelected(v => e.target.checked ? [...v, key] : v.filter(x => x !== key))}/><span>{c.name}<small>{c.kind === 'character' ? '人物' : '道具'} · {existing ? `已有索引「${existing.name}」 · 保留${existing.confirmed ? '已确认' : '暂停'}状态` : c.reason || '原文格式候选'}</small></span></label>; })}</div>
        <label className="sg-field">补充本次要追踪的道具（选填）<input value={props} onChange={e => setProps(e.target.value)} placeholder="例如：黄铜钥匙，旧票根"/></label><p className="sg-muted">也可稍后添加别名、调整索引。文字出现只代表提及，不代表持有或因果。</p></>}
      </>}
    </div></div>
    {error && <p className="sg-error" role="alert">{error}</p>}
    <div className="sg-modal-actions"><button className="sg-secondary" onClick={close}>取消</button><button className="sg-primary" onClick={confirm} disabled={!candidateProject || busy}><Check size={17}/>{project ? '确认导入新版' : '确认并创建项目'}</button></div>
  </Modal>;
}

export function SourceModal({ project, evidence, close, newIssue, editScene }: { project: Project; evidence: EvidenceRef; close: () => void; newIssue?: (ref: EvidenceRef) => void; editScene?: (sceneId: string) => void }) {
  const [ref, setRef] = useState(evidence);
  const resolved = resolveEvidence(project, ref);
  if (!resolved) return <Modal title="引用无法解析" close={close}><p className="sg-error">这条引用未通过原文校验，请恢复完整项目备份后重试。</p></Modal>;
  const { version, scene } = resolved;
  const index = version.scenes.findIndex(s => s.id === scene.id);
  return <Modal title={`第 ${scene.number} 场 · ${scene.heading}`} subtitle={`${project.title} / ${version.label}${version.id !== project.activeVersionId ? ' · 历史稿本' : ' · 当前稿本'}`} close={close} wide>
    <div className="sg-toolbar"><button className="sg-secondary" disabled={index === 0} onClick={() => setRef(makeEvidence(project, version.id, version.scenes[index - 1].id))}><ArrowLeft size={15}/>上一场</button><span>第 {scene.lineStart}–{scene.lineEnd} 行 · 原文不作改写</span><button className="sg-secondary" disabled={index === version.scenes.length - 1} onClick={() => setRef(makeEvidence(project, version.id, version.scenes[index + 1].id))}>下一场<ArrowRight size={15}/></button></div>
    {version.id !== project.activeVersionId && <p className="sg-notice">这是任务引用的历史原稿，未替换成新版的同序号场次。</p>}
    <EvidencePicker key={scene.id} project={project} version={version} scene={scene} initial={ref} useEvidence={newIssue} editScene={version.id === project.activeVersionId && editScene ? () => editScene(scene.id) : undefined}/>
    <div className="sg-modal-actions"><button className="sg-secondary" onClick={() => saveFile(`${project.title}-${version.label}.fountain`, version.text)}><Download size={16}/>导出此稿原文</button><button className="sg-primary" onClick={close}>完成核对</button></div>
  </Modal>;
}

export function IssueDialog({ project, issue, initialEvidence = [], review = false, close, save }: { project: Project; issue?: ReviewIssue; initialEvidence?: EvidenceRef[]; review?: boolean; close: () => void; save: (data: IssueInput) => void }) {
  const version = getVersion(project);
  const impact = useMemo(() => issue ? issueImpact(project, issue) : null, [project, issue]);
  const [title, setTitle] = useState(issue?.title || '');
  const [note, setNote] = useState(issue?.note || '');
  const [status, setStatus] = useState(issue?.status || 'open');
  const [evidence, setEvidence] = useState<EvidenceRef[]>(issue?.evidence || initialEvidence);
  const [sceneId, setSceneId] = useState(impact?.mappings.find(m => m.candidate)?.candidate?.sceneId || initialEvidence.find(ref => ref.versionId === version.id)?.sceneId || version.scenes[0].id);
  const [error, setError] = useState('');
  const [showPicker, setShowPicker] = useState(!review && !evidence.length);
  const scene = version.scenes.find(s => s.id === sceneId) || version.scenes[0];
  const sameRef = (a: EvidenceRef, b: EvidenceRef) => a.versionId === b.versionId && a.sceneId === b.sceneId && a.lineStart === b.lineStart && a.lineEnd === b.lineEnd;
  function add(ref: EvidenceRef) { if (!evidence.some(e => sameRef(e, ref))) setEvidence([...evidence, ref]); setError(''); }
  function submit() {
    try {
      if (!title.trim()) throw new Error('请给任务写一个具体标题。');
      if (status === 'resolved' && !evidence.length) throw new Error('解决任务前，请至少添加一处可核对的原文依据。');
      if (review && !evidence.some(e => e.versionId === version.id)) throw new Error('请先阅读并添加当前稿本的依据，再确认复核。删除场次的问题可引用新版相邻场说明处理结果。');
      save({ title: title.trim(), note, status, evidence });
    } catch (e) { setError(e instanceof Error ? e.message : '任务未保存'); }
  }
  return <Modal title={review ? `在「${version.label}」中核对这项任务` : issue ? '编辑改稿任务' : '记下一项改稿任务'} subtitle={review && impact ? `${impact.label} · 阅读后确认，不自动沿用判断` : '让疑点带着出处进入修改流程'} close={close} wide={review || showPicker}>
    {review && impact && <section className="sg-review-evidence"><p className="sg-notice">{impact.reason}</p>{impact.mappings.map((mapping, index) => {
      const original = resolveEvidence(project, mapping.original); const candidate = mapping.candidate; const included = candidate && evidence.some(e => sameRef(e, candidate));
      return <article className="sg-map-card" key={index}><div className="sg-toolbar"><h3>依据 {index + 1} · {mapping.reason}</h3></div><div className="sg-review-map"><div><span className="sg-overline">此前依据</span><p>{original?.version.label} · 第 {original?.scene.number} 场 · {mapping.original.lineStart}–{mapping.original.lineEnd} 行</p><pre>{mapping.original.quote}</pre></div><div><span className="sg-overline">当前稿本中的候选</span>{candidate ? <><p>{version.label} · 第 {mapping.toScene?.number} 场 · {candidate.lineStart}–{candidate.lineEnd} 行</p><pre>{candidate.quote}</pre><button className="sg-secondary" disabled={!!included} onClick={() => add(candidate)}>{included ? '已加入本次复核依据' : '采用这段新版原文'}</button><button className="sg-quiet" onClick={() => { setSceneId(candidate.sceneId); setShowPicker(true); }}>展开本场并调整行段</button></> : <><p>没有可直接沿用的唯一位置。请在下方选择当前场次，说明如何处理该变化。</p><button className="sg-secondary" onClick={() => setShowPicker(true)}>手动选择新版依据</button></>}</div></div>{candidate && mapping.original.quote !== candidate.quote && <details><summary>展开这处引用的文字差异</summary><LineDiff before={mapping.original.quote} after={candidate.quote} beforeStart={mapping.original.lineStart} afterStart={candidate.lineStart}/></details>}</article>;
    })}{!impact.mappings.length && <p className="sg-muted">这项任务尚无可追踪的原文依据。请先选择当前稿本中的相关场次。</p>}</section>}
    <div className="sg-form"><label className="sg-field">任务标题<input value={title} onChange={e => setTitle(e.target.value)} maxLength={180} placeholder="例如：补足第5与第6场之间的钥匙交接"/></label><label className="sg-field">判断、修改方案与验收条件<textarea rows={4} value={note} onChange={e => setNote(e.target.value)} maxLength={5000} placeholder="哪里需要核对？准备怎么改？什么结果算处理完成？"/></label>
    <label className="sg-field">处理状态<select value={status} onChange={e => setStatus(e.target.value as typeof status)}>{Object.entries(STATUS_NAMES).map(([id, label]) => <option key={id} value={id}>{label}</option>)}</select></label>
    <div className="sg-field"><span>已附原文依据 · {evidence.length} 处</span><div className="sg-evidence-row">{evidence.map((ref, i) => { const v = getVersion(project, ref.versionId); const s = v.scenes.find(s => s.id === ref.sceneId); return <div className="sg-ref-edit" key={`${ref.versionId}-${ref.sceneId}-${i}`}><span>{v.label} · 第{s?.number}场 · {ref.lineStart}–{ref.lineEnd}行{v.id === version.id ? ' · 当前稿本' : ' · 历史原稿'}</span><details><summary>展开引用原文</summary><pre>{ref.quote}</pre></details><button className="sg-quiet" onClick={() => setEvidence(evidence.filter((_, index) => index !== i))}>移除此处引用</button></div>; })}</div></div>
    <button className="sg-secondary" onClick={() => setShowPicker(!showPicker)}><Plus size={16}/>{showPicker ? '收起原文选择器' : '选择场次与精确行段'}</button>
    {showPicker && <section className="sg-inline-source"><label className="sg-field">添加当前稿本场次<select value={sceneId} onChange={e => setSceneId(e.target.value)}>{version.scenes.map(s => <option key={s.id} value={s.id}>第{s.number}场 · {s.heading}</option>)}</select></label><EvidencePicker key={scene.id} project={project} version={version} scene={scene} useEvidence={add} actionLabel="添加所选原文依据"/></section>}
    {review && <p className="sg-muted">生成新稿不会自动解决旧任务。附上新版原文并提交后，才记录为已核对当前稿本；历史依据继续保留。</p>}{error && <p className="sg-error" role="alert">{error}</p>}</div>
    <div className="sg-modal-actions"><button className="sg-secondary" onClick={close}>取消</button><button className="sg-primary" onClick={submit}>{review ? '确认本轮复核' : '保存任务'}</button></div>
  </Modal>;
}
