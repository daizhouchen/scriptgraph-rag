import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowUpRight, BookOpen, GitBranch, Network, Search, Sparkles } from "lucide-react";
import { api, Conflict, Impact, Project, QueryResult } from "./api";

type Mode = "query" | "conflicts" | "impact";
const examples = [
  "线索ECHO-STATION-01出现在哪里，与什么道具有关？",
  "林岚前后两次围绕零点录音留下了哪些线索？",
  "第25场发生在什么时间，谁处理了什么道具？",
];

export function App() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [projectId, setProjectId] = useState("echo-station");
  const [mode, setMode] = useState<Mode>("query");
  const [question, setQuestion] = useState(examples[0]);
  const [method, setMethod] = useState("graph");
  const [result, setResult] = useState<QueryResult | null>(null);
  const [conflicts, setConflicts] = useState<Conflict[]>([]);
  const [impacts, setImpacts] = useState<Impact[]>([]);
  const [entity, setEntity] = useState("银色录音带");
  const [change, setChange] = useState("改为由周砚保管");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => { api.projects().then(setProjects).catch((e) => setError(e.message)); }, []);
  const project = useMemo(() => projects.find((p) => p.id === projectId), [projects, projectId]);

  const run = async () => {
    setBusy(true); setError("");
    try {
      if (mode === "query") setResult(await api.query(projectId, question, method));
      if (mode === "conflicts") setConflicts((await api.conflicts(projectId)).conflicts);
      if (mode === "impact") setImpacts((await api.impact(projectId, entity, change)).impacts);
    } catch (e) { setError(e instanceof Error ? e.message : "未知错误"); }
    finally { setBusy(false); }
  };

  return <div className="shell">
    <header className="topbar">
      <a className="brand" href="#top"><span className="brand-mark"><Network size={19} /></span><span>ScriptGraph</span></a>
      <span className="demo-badge">DEMO MODE · 固定原创样例</span>
      <a className="repo-link" href="https://github.com/daizhouchen/scriptgraph-rag">GitHub <ArrowUpRight size={14} /></a>
    </header>

    <main id="top">
      <section className="hero">
        <div>
          <p className="eyebrow">SCREENPLAY INTELLIGENCE / 01</p>
          <h1>让每条剧情判断<br />都有原文可循。</h1>
          <p className="lede">面向编剧与剧本统筹的知识图谱：检索人物、场景与道具关系，定位连续性冲突，并评估一次改稿会影响哪些场次。</p>
        </div>
        <div className="hero-metrics">
          <div><strong>{project?.scene_count ?? 30}</strong><span>场原创剧本</span></div>
          <div><strong>4</strong><span>检索基线</span></div>
          <div><strong>100%</strong><span>证据可回溯</span></div>
        </div>
      </section>

      <section className="workspace">
        <aside className="sidebar">
          <p className="side-label">当前项目</p>
          <select value={projectId} onChange={(e) => {
            const next = e.target.value;
            setProjectId(next);
            setQuestion(next === "paper-moon" ? "线索PAPER-MOON-01出现在哪里，与什么道具有关？" : examples[0]);
            setResult(null);
          }}>
            {projects.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
          <p className="project-logline">{project?.logline}</p>
          <nav>
            <button className={mode === "query" ? "active" : ""} onClick={() => setMode("query")}><Search size={17}/>证据问答</button>
            <button className={mode === "conflicts" ? "active" : ""} onClick={() => setMode("conflicts")}><AlertTriangle size={17}/>一致性审校</button>
            <button className={mode === "impact" ? "active" : ""} onClick={() => setMode("impact")}><GitBranch size={17}/>改稿影响</button>
          </nav>
          <div className="privacy"><BookOpen size={16}/><p>公开演示不接受文件上传，不保存输入；仅查询原创合成剧本。</p></div>
        </aside>

        <div className="panel">
          {mode === "query" && <>
            <div className="panel-heading"><div><p className="eyebrow">EVIDENCE QA</p><h2>剧本证据问答</h2></div>
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="graph">混合检索 + 图扩展</option><option value="hybrid">混合检索</option>
                <option value="dense">向量检索</option><option value="bm25">BM25</option>
              </select>
            </div>
            <div className="composer">
              <textarea value={question} onChange={(e) => setQuestion(e.target.value)} maxLength={300}/>
              <div className="composer-footer"><span>{question.length}/300</span><button onClick={run} disabled={busy || question.length < 2}><Sparkles size={16}/>{busy ? "检索中" : "检索证据"}</button></div>
            </div>
            <div className="chips">{examples.map((x) => <button key={x} onClick={() => setQuestion(x)}>{x}</button>)}</div>
            {result && <div className="result">
              <div className="result-meta"><span className={`confidence ${result.confidence}`}>{result.confidence}</span><span>{result.elapsed_ms} ms</span><span>{result.retrieval_path.join(" → ")}</span></div>
              <p className="answer">{result.answer}</p>
              <h3>原文证据</h3>
              <div className="evidence-grid">{result.evidences.map((e) => <article key={e.scene_id}>
                <div><span>第 {e.scene_number} 场</span><small>score {e.score.toFixed(3)}</small></div>
                <h4>{e.heading}</h4><p>{e.excerpt}</p><footer>原文行 {e.line_start}–{e.line_end} · {e.reasons.join(" / ")}</footer>
              </article>)}</div>
            </div>}
          </>}

          {mode === "conflicts" && <>
            <div className="panel-heading"><div><p className="eyebrow">CONTINUITY</p><h2>一致性审校</h2></div><button className="primary" onClick={run} disabled={busy}>运行检查</button></div>
            <p className="section-note">系统只标记需要复核的矛盾，不替代创作者作出设定判断。</p>
            <div className="conflict-list">{conflicts.map((c) => <article key={c.id}><span className="category">{c.category}</span><div><h3>{c.summary}</h3><p>{c.evidence.join(" · ")}</p><small>{c.scene_ids.join(" → ")} · 待人工确认</small></div></article>)}</div>
          </>}

          {mode === "impact" && <>
            <div className="panel-heading"><div><p className="eyebrow">CHANGE IMPACT</p><h2>改稿影响分析</h2></div></div>
            <div className="impact-form"><label>修改对象<input value={entity} onChange={(e) => setEntity(e.target.value)}/></label><label>修改内容<input value={change} onChange={(e) => setChange(e.target.value)}/></label><button className="primary" onClick={run} disabled={busy}>分析影响</button></div>
            <div className="impact-list">{impacts.map((x) => <article key={x.scene_id}><span>{String(x.scene_number).padStart(2,"0")}</span><div><h3>{x.heading}</h3><p>{x.reason}</p><small>{x.path.join(" → ")}</small></div></article>)}</div>
          </>}
          {error && <p className="error">{error}</p>}
        </div>
      </section>
    </main>
    <footer className="page-footer"><span>ScriptGraph · Evidence before generation</span><span>Dai Zhouchen · 2026</span></footer>
  </div>;
}
