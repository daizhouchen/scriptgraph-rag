import { useEffect, useRef, useState } from "react";
import { AlertCircle, ArrowDownToLine, ArrowLeft, ArrowUpRight, BookOpen, Check, ChevronLeft, ChevronRight, FileText, GitBranch, ListChecks, Search, X } from "lucide-react";
import { api, type Conflict, type Impact, type Project, type QueryResult, type Workspace } from "./api";
import benchmark from "../../reports/baseline.json";
import './styles.css';

type Mode = "query" | "conflicts" | "impact";
type ReviewStatus = "pending" | "adjust" | "intentional" | "discuss";
type Review = { status: ReviewStatus; note: string };
type Reviews = Record<string, Review>;
const IS_STATIC = import.meta.env.VITE_STATIC_DEMO === "true";
const REPO = "https://github.com/daizhouchen/scriptgraph-rag";
const categoryNames: Record<string, string> = { alias: "人物称谓", knowledge: "知情状态", prop: "道具归属", timeline: "时间顺序" };
const reviewNames: Record<ReviewStatus, string> = { pending: "待复核", adjust: "需要调整", intentional: "创作设定", discuss: "待讨论" };
const methodNames: Record<string, string> = { graph: "混合检索 + 图扩展", hybrid: "混合检索", bm25: "关键词 BM25", dense: "字符向量" };
const tasks = [
  { id: "query" as const, title: "查证原文", detail: "找到判断的出处", icon: Search },
  { id: "conflicts" as const, title: "连续性复核", detail: "对照前后设定", icon: ListChecks },
  { id: "impact" as const, title: "改稿核对", detail: "列出关联场次", icon: GitBranch },
];
const emptyReview: Review = { status: "pending", note: "" };

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url; link.download = filename;
  document.body.appendChild(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function ResearchNotes() {
  return <details className="research-notes" id="research">
    <summary><span><GitBranch size={18} /> 从体验到工程：数据与检索方法</span><span>展开说明</span></summary>
    <div className="research-body">
      <p>本页使用原创合成剧本。公开样例包含两部剧本；仓库的四部剧本、120 场与 180 道固定问题用于离线评测。连续性候选来自语料中注入的事实标记，不代表对真实剧本的自动理解能力。</p>
      <p>{IS_STATIC ? "样例问题展示由仓库检索引擎预先计算的结果；自由输入在浏览器中查找关键词候选，不生成剧情。" : "当前工作台通过本地 API 运行选定的检索方法，展示引擎返回的原文候选；实际图与向量后端由本地服务配置决定。"}改稿核对列出对象关联的场次，不预测改写后的情节。</p>
      <div className="table-scroll" tabIndex={0} aria-label="检索方法评测对比，可横向滚动"><table>
        <caption>固定合成集 · 阶段性结果，关键样本仍待逐条人工复核</caption>
        <thead><tr><th>检索方法</th><th>跨场 Recall@5</th><th>首条引用准确率</th><th>无答案拒答率</th></tr></thead>
        <tbody>{(["bm25", "dense", "hybrid", "graph"] as const).map(method => <tr key={method}><th>{methodNames[method]}</th><td>{(benchmark[method].multi_hop.recall_at_5 * 100).toFixed(1)}%</td><td>{(benchmark[method].citation_precision_at_1 * 100).toFixed(1)}%</td><td>{(benchmark[method].unanswerable.refusal_rate * 100).toFixed(1)}%</td></tr>)}</tbody>
      </table></div>
      <p className="muted">本页的复核标记是你的本次操作记录，不会改变仓库的数据集复核状态。合成数据上的结果不等于真实项目效果。</p>
      <div className="research-links"><a href={`${REPO}/blob/main/DATA_CARD.md`} target="_blank" rel="noopener">数据卡 <ArrowUpRight size={14}/></a><a href={`${REPO}/blob/main/reports/baseline.json`} target="_blank" rel="noopener">完整评测 <ArrowUpRight size={14}/></a><a href={`${REPO}#一条命令启动`} target="_blank" rel="noopener">运行本地版本 <ArrowUpRight size={14}/></a></div>
    </div>
  </details>;
}

function SourceDialog({ workspace, sceneId, close, navigate }: { workspace: Workspace; sceneId: string; close: () => void; navigate: (id: string) => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const sceneIndex = workspace.scenes.findIndex(s => s.id === sceneId);
  const scene = workspace.scenes[sceneIndex];
  useEffect(() => { ref.current?.showModal(); }, []);
  useEffect(() => { ref.current?.querySelector(".source-lines")?.scrollTo(0, 0); }, [sceneId]);
  return <dialog ref={ref} className="source-dialog" aria-labelledby="source-title" onCancel={close} onClose={close} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <div className="dialog-header"><div><p className="eyebrow">{workspace.project.title} / 原始剧本 v1</p><h2 id="source-title">{scene ? `第 ${scene.number} 场 · ${scene.heading}` : "找不到该场次"}</h2></div><button className="icon-button" aria-label="关闭原文" onClick={close}><X size={20}/></button></div>
    {scene && <>
      <div className="scene-navigation"><button className="text-button" onClick={() => navigate(workspace.scenes[sceneIndex - 1].id)} disabled={sceneIndex <= 0}><ChevronLeft size={16}/>上一场</button><span>{scene.number} / {workspace.scenes.length} 场</span><button className="text-button" onClick={() => navigate(workspace.scenes[sceneIndex + 1].id)} disabled={sceneIndex >= workspace.scenes.length - 1}>下一场<ChevronRight size={16}/></button></div>
      <p className="source-caption">原文第 {scene.line_start}–{scene.line_end} 行。方括号是合成语料中的道具、事件与事实标记，保留原样供核对。</p>
      <div className="source-lines" tabIndex={0} aria-label="带行号的场次原文"><ol>{workspace.lines.slice(scene.line_start - 1, scene.line_end).map((line, index) => <li key={scene.line_start + index}><span className="line-number" aria-hidden="true">{scene.line_start + index}</span><code>{line || " "}</code></li>)}</ol></div>
      <div className="dialog-footer"><span>来源：{workspace.project.id}.fountain</span><a href={`${REPO}/blob/main/data/scripts/${workspace.project.id}.fountain#L${scene.line_start}-L${scene.line_end}`} target="_blank" rel="noopener">核对仓库原文 <ArrowUpRight size={14}/></a></div>
    </>}
  </dialog>;
}

function ProjectDesk({ projectId, mode, reviews, updateReview }: { projectId: string; mode: Mode; reviews: Reviews; updateReview: (id: string, review: Review) => void }) {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loadError, setLoadError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const [question, setQuestion] = useState("");
  const [method, setMethod] = useState("graph");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[] | null>(null);
  const [category, setCategory] = useState("all");
  const [reviewFilter, setReviewFilter] = useState("all");
  const [entity, setEntity] = useState("");
  const [change, setChange] = useState("");
  const [impacts, setImpacts] = useState<Impact[] | null>(null);
  const [checked, setChecked] = useState<string[]>([]);
  const [sourceId, setSourceId] = useState<string | null>(null);
  const [busy, setBusy] = useState<Mode | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const requestId = useRef(0);
  const sourceTrigger = useRef<HTMLElement | null>(null);

  useEffect(() => {
    let active = true;
    setLoadError(""); setWorkspace(null);
    api.workspace(projectId).then(data => {
      if (!active) return;
      setWorkspace(data); setQuestion(data.examples[0] || "");
      setEntity(data.entities[0] || "");
    }).catch(e => { if (active) setLoadError(e instanceof Error ? e.message : "剧本加载失败"); });
    return () => { active = false; requestId.current++; };
  }, [projectId, attempt]);
  useEffect(() => { requestId.current++; setBusy(null); setError(""); setMessage(""); setSourceId(null); }, [mode]);

  function cancel() { requestId.current++; setBusy(null); setError(""); setMessage(""); }
  function editQuestion(value: string) { cancel(); setQuestion(value); setResult(null); }
  function editImpact(value: string, field: "entity" | "change") {
    cancel(); field === "entity" ? setEntity(value) : setChange(value); setImpacts(null); setChecked([]);
  }
  async function run(task: Mode) {
    const id = ++requestId.current;
    setBusy(task); setError(""); setMessage("");
    try {
      if (task === "query") {
        const response = await api.query(projectId, question.trim(), method);
        if (id === requestId.current) { setResult(response); setMessage(`找到 ${response.evidences.length} 条候选证据。`); }
      } else if (task === "conflicts") {
        const response = await api.conflicts(projectId);
        if (id === requestId.current) { setConflicts(response.conflicts); setMessage(`已载入 ${response.conflicts.length} 项待人工复核候选。`); }
      } else {
        const response = await api.impact(projectId, entity.trim(), change.trim());
        if (id === requestId.current) { setImpacts(response.impacts); setChecked([]); setMessage(`找到 ${response.impacts.length} 个关联场次。`); }
      }
    } catch (e) { if (id === requestId.current) setError(e instanceof Error ? e.message : "操作未完成，请重试。"); }
    finally { if (id === requestId.current) setBusy(null); }
  }

  function saveReview() {
    if (!workspace || !conflicts) return;
    const text = [`ScriptGraph · ${workspace.project.title} · 连续性复核记录`, "版本：v1 / 原创合成语料", "以下为本次人工操作记录，不修改原剧本或数据集复核状态。", "", ...conflicts.flatMap(c => {
      const review = reviews[c.id] || emptyReview;
      return [`[${reviewNames[review.status]}] ${c.summary}`, ...c.scene_ids.map(id => {
        const s = workspace.scenes.find(scene => scene.id === id);
        return s ? `第${s.number}场 ${s.heading} / 原文${s.line_start}–${s.line_end}行` : id;
      }), ...c.evidence.map(line => `依据：${line}`), `备注：${review.note || "未填写"}`, ""];
    })].join("\n");
    download(`${projectId}-continuity-review.txt`, text); setMessage("已导出全部候选及当前复核标记。");
  }
  function saveImpact() {
    if (!workspace || !impacts) return;
    const text = [`ScriptGraph · ${workspace.project.title} · 改稿核对清单`, "版本：v1 / 原创合成语料", `修改对象：${entity}`, `改稿计划：${change}`, "范围：按对象在原文中的关联列出场次；未自动预测剧情或修改剧本。", "", ...impacts.flatMap(item => {
      const s = workspace.scenes.find(scene => scene.id === item.scene_id);
      return [`[${checked.includes(item.scene_id) ? "已核对" : "待核对"}] 第${item.scene_number}场 ${item.heading}`, item.reason, `关联：${item.path.join(" → ")}`, s ? `原文：${s.line_start}–${s.line_end}行` : "", ""];
    })].join("\n");
    download(`${projectId}-revision-checklist.txt`, text); setMessage("已导出改稿计划、关联场次和当前核对进度。");
  }

  if (loadError) return <div className="work-panel"><div className="error" role="alert"><AlertCircle size={20}/><div><h2>暂时无法打开这部剧本</h2><p>{loadError}</p><button className="secondary" onClick={() => setAttempt(n => n + 1)}>重新加载</button></div></div></div>;
  if (!workspace) return <div className="work-panel"><p className="loading" role="status">正在打开剧本与原文索引…</p></div>;
  const source = (id: string) => {
    sourceTrigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSourceId(id);
  };
  const closeSource = () => {
    setSourceId(null);
    requestAnimationFrame(() => { if (sourceTrigger.current?.isConnected) sourceTrigger.current.focus(); });
  };
  const scene = (id: string) => workspace.scenes.find(s => s.id === id);
  const reviewed = conflicts?.filter(c => (reviews[c.id]?.status || "pending") !== "pending").length || 0;
  const filtered = conflicts?.filter(c => (category === "all" || c.category === category) && (reviewFilter === "all" || (reviews[c.id]?.status || "pending") === reviewFilter)) || [];

  return <div className="work-panel" aria-busy={busy !== null}>
    {mode === "query" && <>
      <div className="panel-head"><div><p className="eyebrow">01 / FIND THE SOURCE</p><h2>先找到原文，再做判断。</h2><p>从一个具体场次、线索编号或人物道具开始。每条候选都能打开完整原文。</p></div></div>
      <form className="task-form" onSubmit={e => { e.preventDefault(); if (question.trim().length >= 2) run("query"); }}>
        <label className="form-label" htmlFor="question">想核对什么？</label>
        <textarea className="query-input" id="question" value={question} onChange={e => editQuestion(e.target.value)} maxLength={300} rows={3} placeholder="例如：线索编号，或一段原文中的关键词"/>
        <div className="form-footer"><span>{question.trim().length}/300 · {IS_STATIC ? "仅在此页面检索" : "使用本地检索服务"}</span><button className="primary" disabled={busy !== null || question.trim().length < 2}><Search size={16}/>{busy === "query" ? "正在查找…" : "查找依据"}</button></div>
      </form>
      <div className="suggestions" aria-label="当前剧本示例问题"><span>从样例开始</span>{workspace.examples.slice(0, 3).map((q, i) => <button key={q} onClick={() => editQuestion(q)}><span>0{i + 1}</span>{q}</button>)}</div>
      <details className="advanced"><summary>检索方式与样例范围</summary><div><label htmlFor="method">样例检索方案</label><select id="method" value={method} onChange={e => { cancel(); setMethod(e.target.value); setResult(null); }}>{Object.entries(methodNames).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><p>{IS_STATIC ? "样例问题读取该方案的预计算结果。自由输入使用同一套浏览器关键词查找，不运行图数据库、向量模型或实时大模型。" : "当前运行本地检索引擎；检索结果仍须结合原文人工复核。"}</p></div></details>
      {!result && <div className="empty-state"><BookOpen size={27}/><div><h3>证据会在这里展开</h3><p>先试第一个样例，再点「打开原文」核对场次与行号。</p><button className="text-button" onClick={() => source(workspace.scenes[0].id)}>先翻阅这部剧本 <ChevronRight size={15}/></button></div></div>}
      {result && <div className="query-results">
        <div className={`result-summary ${result.evidences.length ? "has-evidence" : "no-evidence"}`}><span className="result-label">{result.execution === "snapshot" ? "固定样例 · 引擎预计算" : result.execution === "keyword" ? "关键词候选 · 未生成回答" : "本地引擎 · 原文摘取"}</span><h3>{result.evidences.length ? `${result.evidences.length} 条原文候选，等你核对` : "现有材料无法支持这个问题"}</h3><p>{result.evidences.length && result.execution !== "keyword" ? `按「${methodNames[method]}」找到以下场次。排序表示检索相关性，请打开原文后再判断。` : result.answer}</p>{!result.evidences.length && <p className="muted">可以改用原文中的线索编号或词语，也可以返回上面的样例问题。</p>}</div>
        <div className="evidence-list">{result.evidences.map((item, index) => <article className="evidence-card" key={item.scene_id}>
          <div className="evidence-head"><span className="scene-number">{String(item.scene_number).padStart(2, "0")}</span><div><span className="muted">候选 {index + 1} / 第 {item.scene_number} 场</span><h3>{item.heading}</h3></div></div>
          <p className="excerpt">{item.excerpt}</p><div className="evidence-foot"><span>原文第 {item.line_start}–{item.line_end} 行</span><button className="secondary" onClick={() => source(item.scene_id)} disabled={!scene(item.scene_id)}><BookOpen size={15}/>打开原文</button></div>
        </article>)}</div>
      </div>}
    </>}

    {mode === "conflicts" && <>
      <div className="panel-head"><div><p className="eyebrow">02 / CONTINUITY REVIEW</p><h2>把前后两场，放在一起看。</h2><p>候选由合成语料中的事实标记产生。对照原文后，由你判断是需要调整，还是有意的创作设定。</p></div></div>
      <div className="task-toolbar"><button className="primary" disabled={busy !== null} onClick={() => run("conflicts")}><ListChecks size={17}/>{busy === "conflicts" ? "正在载入…" : conflicts ? "重新载入候选" : "载入复核候选"}</button>{conflicts !== null && <button className="secondary" onClick={saveReview} disabled={!conflicts.length}><ArrowDownToLine size={16}/>导出复核记录</button>}</div>
      {conflicts === null ? <div className="empty-state"><ListChecks size={28}/><div><h3>一次只判断一组前后设定</h3><p>打开两侧原文 → 留下复核标记与备注 → 导出后继续改稿。</p></div></div> : <>
        <div className="review-progress"><strong>{reviewed} <span>/ {conflicts.length} 项已标记</span></strong><span>标记可随时调整；切换剧本保留，刷新页面清除。</span></div>
        <div className="filters"><label>风险类别<select value={category} onChange={e => setCategory(e.target.value)}><option value="all">全部类别</option>{Object.entries(categoryNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><label>复核状态<select value={reviewFilter} onChange={e => setReviewFilter(e.target.value)}><option value="all">全部状态</option>{Object.entries(reviewNames).map(([id, name]) => <option key={id} value={id}>{name}</option>)}</select></label><span>当前显示 {filtered.length} 项</span></div>
        {!filtered.length && <div className="empty-state"><Check size={25}/><div><h3>当前筛选下没有候选</h3><p>这不代表剧本没有其他风险。可切回全部类别与状态继续查看。</p><button className="text-button" onClick={() => { setCategory("all"); setReviewFilter("all"); }}>查看全部候选</button></div></div>}
        <div className="conflict-list">{filtered.map(c => {
          const review = reviews[c.id] || emptyReview;
          return <article className="conflict-card" key={c.id}>
            <header><span className="category">{categoryNames[c.category] || c.category}</span><span className={`review-badge ${review.status}`}>{reviewNames[review.status]}</span><h3>{c.summary}</h3></header>
            <div className="source-pair">{c.scene_ids.map((id, index) => { const s = scene(id); return <article className="source-note" key={id}><span className="source-label">{index === 0 ? "前一处设定" : "后一处设定"}{s && ` · 第 ${s.number} 场`}</span><p>{c.evidence[index]?.replace(`${id}: `, "") || "请打开原文核对这处设定。"}</p>{s && <button className="text-button" onClick={() => source(id)}>查看第 {s.number} 场原文 <ChevronRight size={15}/></button>}</article>; })}</div>
            <div className="review-controls"><span className="form-label">你的复核结论</span><div className="status-options" role="group" aria-label={`${c.summary}的复核结论`}>{Object.entries(reviewNames).map(([id, name]) => <button key={id} aria-pressed={review.status === id} className={review.status === id ? "selected" : ""} onClick={() => updateReview(c.id, { ...review, status: id as ReviewStatus })}>{review.status === id && <Check size={13}/>} {name}</button>)}</div><label className="review-note">备注（选填）<textarea rows={2} maxLength={500} value={review.note} placeholder="例如：这里是角色有意隐瞒，保留；或需补一场交接。" onChange={e => updateReview(c.id, { ...review, note: e.target.value })}/></label></div>
          </article>;
        })}</div>
      </>}
    </>}

    {mode === "impact" && <>
      <div className="panel-head"><div><p className="eyebrow">03 / REVISION CHECKLIST</p><h2>改动一处，先核对它出现的地方。</h2><p>选定人物或道具，写下改稿计划，生成逐场核对清单。工具不会自动改写原剧本。</p></div></div>
      <form className="impact-form" onSubmit={e => { e.preventDefault(); if (entity.trim() && change.trim().length >= 2) run("impact"); }}>
        <label>修改对象<select value={entity} onChange={e => editImpact(e.target.value, "entity")}>{workspace.entities.map(name => <option key={name} value={name}>{name}</option>)}</select></label>
        <label>这次计划怎么改？<textarea rows={3} maxLength={300} value={change} onChange={e => editImpact(e.target.value, "change")} placeholder="例如：把这个道具的交接提前，需要核对哪些场次？"/></label>
        <button className="primary" disabled={busy !== null || !entity.trim() || change.trim().length < 2}><GitBranch size={17}/>{busy === "impact" ? "正在查找…" : "生成核对清单"}</button>
      </form>
      <p className="impact-scope"><AlertCircle size={16}/>按当前对象的原文关联列出场次。改稿文字会附在清单中，不用于自动推断情节变化。</p>
      {impacts === null ? <div className="empty-state"><GitBranch size={28}/><div><h3>先把改稿意图说清楚</h3><p>清单会附上关联路径和原文入口，供你逐场判断是否需要同步修改。</p></div></div> : <>
        <div className="task-toolbar"><div><strong>{checked.length} / {impacts.length} 场已核对</strong><p className="muted">修改对象或计划后，旧清单会清空并等待重新生成。</p></div><button className="secondary" onClick={saveImpact}><ArrowDownToLine size={16}/>导出核对清单</button></div>
        <p className="notice">本次计划：{change}</p>
        {!impacts.length && <div className="empty-state"><BookOpen size={25}/><div><h3>当前剧本没有找到这个对象的关联场次</h3><p>可以换一个对象；未检出不等于没有间接影响。</p></div></div>}
        <div className="impact-list">{impacts.map(item => { const s = scene(item.scene_id); return <article className={`impact-item ${checked.includes(item.scene_id) ? "checked" : ""}`} key={item.scene_id}>
          <label className="check-scene"><input type="checkbox" checked={checked.includes(item.scene_id)} onChange={e => setChecked(ids => e.target.checked ? [...ids, item.scene_id] : ids.filter(id => id !== item.scene_id))}/><span>第 {item.scene_number} 场<br/>{checked.includes(item.scene_id) ? "已核对" : "待核对"}</span></label>
          <div className="impact-body"><h3>{item.heading}</h3><p>{s?.text.split("\n").find(line => line.includes(entity)) || item.reason}</p><p className="relation-path">{item.path.map(part => part === item.scene_id ? `第 ${item.scene_number} 场` : part).join(" → ")}</p>{s && <button className="text-button" onClick={() => source(item.scene_id)}>核对第 {s.number} 场原文 <ChevronRight size={15}/></button>}</div>
        </article>; })}</div>
      </>}
    </>}
    {error && <p className="error" role="alert"><AlertCircle size={18}/>{error} 请重试当前操作。</p>}
    <p className="live-message" role="status" aria-live="polite">{message}</p>
    <div className="project-footer"><FileText size={15}/><span>{workspace.project.title} · v1 · {workspace.scenes.length} 场原创合成语料</span><button className="text-button" onClick={() => source(workspace.scenes[0].id)}>翻阅剧本</button></div>
    {sourceId && <SourceDialog workspace={workspace} sceneId={sourceId} close={closeSource} navigate={setSourceId}/>}
  </div>;
}

export function LegacyDemo() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("");
  const [mode, setMode] = useState<Mode>("query");
  const [reviews, setReviews] = useState<Record<string, Reviews>>({});
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let active = true; setError("");
    api.projects().then(rows => { if (active) { setProjects(rows); setProjectId(rows[0]?.id || ""); if (!rows.length) setError("当前没有可用剧本。"); } }).catch(e => { if (active) setError(e instanceof Error ? e.message : "剧本目录加载失败"); });
    return () => { active = false; };
  }, [attempt]);
  const project = projects.find(p => p.id === projectId);
  return <div className="app-shell">
    <a className="skip-link" href="#lab" onClick={e => { e.preventDefault(); document.getElementById("workspace")?.scrollIntoView(); }}>跳到工作区</a>
    <header className="topbar"><a className="brand" href="#lab" onClick={e => { e.preventDefault(); document.getElementById("workspace")?.scrollIntoView(); }}><span className="brand-mark"><GitBranch size={21}/></span>ScriptGraph<span className="brand-sub">剧本核对工作台</span></a><span className="sample-badge">{IS_STATIC ? "原创语料 · 浏览器样例" : "本地检索服务"}</span><div className="top-links"><a href="https://daizhouchen.github.io/#product-showcase"><ArrowLeft size={15}/><span>作品集</span></a><a href={REPO} target="_blank" rel="noopener">GitHub<ArrowUpRight size={14}/></a></div></header>
    <main>
      <section className="intro"><p className="eyebrow">EVIDENCE BEFORE REVISION</p><h1>每一次改稿，<br className="mobile-break"/>都能回到原文。</h1><p>查证一句话，对照两场戏，留下一份可以接着工作的核对记录。</p></section>
      <section className="workspace" id="workspace" aria-label="剧本核对工作区">
        <aside className="sidebar"><div className="project-picker"><label htmlFor="project">当前剧本</label><select id="project" value={projectId} onChange={e => setProjectId(e.target.value)} disabled={!projects.length}>{projects.map(p => <option key={p.id} value={p.id}>{p.title}</option>)}</select></div><p className="project-logline">{project?.logline || "正在打开剧本目录…"}</p><p className="project-meta">{project ? `${project.scene_count} 场 / v1 / 原创合成` : ""}</p>
          <nav className="task-nav" aria-label="工作任务">{tasks.map(({ id, title, detail, icon: Icon }) => <button key={id} className={mode === id ? "active" : ""} onClick={() => setMode(id)} aria-pressed={mode === id}><Icon size={19}/><span className="nav-copy"><strong>{title}</strong><small>{detail}</small></span></button>)}</nav>
          <div className="sidebar-note"><BookOpen size={19}/><p>{IS_STATIC ? "固定原创语料，不上传文件，不接实时 AI。" : "使用本地服务与当前配置的语料。"}<br/>复核记录保留在本次页面中，可导出保存。</p><a href="#lab" onClick={e => { e.preventDefault(); const target = document.getElementById("research"); if (target instanceof HTMLDetailsElement) target.open = true; target?.scrollIntoView(); }}>数据与能力范围 <ChevronRight size={14}/></a></div>
        </aside>
        {error ? <div className="work-panel"><div className="error" role="alert"><AlertCircle size={20}/><p>{error}</p><button className="secondary" onClick={() => setAttempt(n => n + 1)}>重试加载</button></div></div> : projectId ? <ProjectDesk key={projectId} projectId={projectId} mode={mode} reviews={reviews[projectId] || {}} updateReview={(id, review) => setReviews(all => ({ ...all, [projectId]: { ...all[projectId], [id]: review } }))}/> : <div className="work-panel"><p role="status">正在加载剧本目录…</p></div>}
      </section>
      <ResearchNotes/>
    </main>
    <footer className="page-footer"><span>ScriptGraph / 原文是判断的起点</span><span>戴宙辰 · 产品与工程实践</span></footer>
  </div>;
}
