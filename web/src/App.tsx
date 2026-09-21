import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, ArrowUpRight, BarChart3, BookOpen, CheckCircle2, GitBranch, Network, Search, Sparkles } from "lucide-react";
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
      <a className="top-link" href="#results"><BarChart3 size={14}/>实验结果</a>
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

      <section className="results" id="results">
        <div className="results-heading">
          <div><p className="eyebrow">EXPERIMENT RESULTS</p><h2>不只展示功能，也验证它是否找得准。</h2><p>测试围绕编剧和剧本统筹最常见的三类任务展开：跨场追踪线索、给出原文依据、发现前后设定冲突。</p></div>
          <div className="results-scope"><strong>4</strong><span>部原创剧本</span><i/><strong>180</strong><span>道固定问题</span><i/><strong>48</strong><span>处注入冲突</span></div>
        </div>

        <div className="story-flow">
          <article><span>01</span><div><strong>剧本被拆成可追踪信息</strong><p>人物、场景、道具和事件进入知识图谱，同时保留对应的原文位置。</p></div></article>
          <ArrowRight size={18}/>
          <article><span>02</span><div><strong>问题同时查文本与关系</strong><p>先找相关段落，再沿人物、事件和道具关系补足跨场线索。</p></div></article>
          <ArrowRight size={18}/>
          <article><span>03</span><div><strong>结论必须附带证据</strong><p>回答显示场次和原文行号；证据不足时拒绝补写剧情。</p></div></article>
        </div>

        <div className="result-cards">
          <article><span>跨场线索</span><strong>60 / 60</strong><p>使用图关系扩展后，多场景问题全部在前 5 条结果中找到正确证据；纯向量方案为 47.5 / 60。</p></article>
          <article><span>原文引用</span><strong>95.3%</strong><p>系统给出的第一条证据能够准确指向回答依据，便于编剧直接回到原文核对。</p></article>
          <article><span>无依据时</span><strong>30 / 30</strong><p>面对剧本中没有答案的问题全部选择拒答，没有用模型常识补全剧情。</p></article>
          <article><span>连续性审校</span><strong>F1 100%</strong><p>在 48 处人工注入的称谓、知情状态、道具归属和时间冲突上全部检出。</p></article>
        </div>

        <details className="technical-results">
          <summary><span><BarChart3 size={17}/>查看四种检索方案的完整对比</span><small>适合技术面试与复现</small></summary>
          <div className="benchmark-scroll"><table>
            <thead><tr><th>检索方案</th><th>单场 Recall@5</th><th>跨场 Recall@5</th><th>时序 Recall@5</th><th>引用准确率</th><th>无答案拒答</th></tr></thead>
            <tbody>
              <tr><td>BM25 关键词检索</td><td>1.000</td><td>0.883</td><td>1.000</td><td>0.980</td><td>1.000</td></tr>
              <tr><td>字符向量检索</td><td>0.683</td><td>0.792</td><td>0.000</td><td>0.466</td><td>1.000</td></tr>
              <tr><td>关键词 + 向量</td><td>1.000</td><td>0.858</td><td>1.000</td><td>0.980</td><td>1.000</td></tr>
              <tr className="best"><td>混合检索 + 图扩展</td><td>1.000</td><td>1.000</td><td>1.000</td><td>0.953</td><td>1.000</td></tr>
            </tbody>
          </table></div>
          <p className="metric-note">图扩展在跨场 Recall@5 上较字符向量基线提升 20.83 个百分点。所有结论均可由仓库中的固定数据与评测脚本复现。</p>
        </details>

        <div className="results-actions"><div><CheckCircle2 size={20}/><div><strong>数据、评测集与逐项结果均已公开</strong><p>可查看原创剧本、问题分类、冲突标注和基线输出。</p></div></div><a href="https://github.com/daizhouchen/scriptgraph-rag/blob/main/reports/baseline.json" target="_blank" rel="noreferrer">查看完整结果 <ArrowUpRight size={14}/></a></div>
        <p className="provisional"><i/>结果基于原创合成剧本和固定测试集；关键测试样本完成人工逐条复核前，页面将其标记为阶段性结果。</p>
      </section>
    </main>
    <footer className="page-footer"><span>ScriptGraph · Evidence before generation</span><span>Dai Zhouchen · 2026</span></footer>
  </div>;
}
