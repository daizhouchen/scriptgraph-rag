import { useMemo, useState } from 'react';
import { Plus, Pencil } from 'lucide-react';
import { makeEvidence, type Project, type Scene, type ScriptVersion, type EvidenceRef } from './domain';
import { Lines } from './components';
import { diffLines } from './revision-analysis';

export function EvidencePicker({ project, version, scene, initial, useEvidence, editScene, actionLabel = '用所选原文建任务' }: { project: Project; version: ScriptVersion; scene: Scene; initial?: EvidenceRef; useEvidence?: (ref: EvidenceRef) => void; editScene?: () => void; actionLabel?: string }) {
  const [start, setStart] = useState(String(initial?.lineStart || scene.lineStart));
  const [end, setEnd] = useState(String(initial?.lineEnd || scene.lineEnd));
  const evidence = useMemo(() => { try { return makeEvidence(project, version.id, scene.id, Number(start), Number(end)); } catch { return null; } }, [project, version.id, scene.id, start, end]);
  return <div className="sg-evidence-picker">
    <div className="sg-range-toolbar"><div><strong>选择依据行段</strong><p className="sg-muted">点击行号选中一句；Shift + 点击可扩展，也可填写行号。</p></div><label>起始行<input type="number" min={scene.lineStart} max={scene.lineEnd} value={start} onChange={e => setStart(e.target.value)}/></label><span>—</span><label>结束行<input type="number" min={scene.lineStart} max={scene.lineEnd} value={end} onChange={e => setEnd(e.target.value)}/></label><button className="sg-quiet" onClick={() => { setStart(String(scene.lineStart)); setEnd(String(scene.lineEnd)); }}>选择整场</button></div>
    <Lines version={version} scene={scene} highlight={evidence || undefined} selectLine={(line, extend) => { const anchor = Number(start) || line; setStart(String(extend ? Math.min(anchor, line) : line)); setEnd(String(extend ? Math.max(anchor, line) : line)); }}/>
    <div className="sg-range-actions"><span className={evidence ? 'sg-muted' : 'sg-error'}>{evidence ? `已选第 ${start}–${end} 行 · ${Number(end) - Number(start) + 1} 行` : `请输入 ${scene.lineStart}–${scene.lineEnd} 之间的有效范围`}</span><div className="sg-actions">{editScene && <button className="sg-secondary" onClick={editScene}><Pencil size={16}/>修改这一场</button>}{useEvidence && <button className="sg-primary" disabled={!evidence?.quote.trim()} onClick={() => { if (evidence) useEvidence(evidence); }}><Plus size={16}/>{actionLabel}</button>}</div></div>
  </div>;
}

export function LineDiff({ before, after, beforeStart = 1, afterStart = 1 }: { before: string; after: string; beforeStart?: number; afterStart?: number }) {
  const result = useMemo(() => diffLines(before, after, beforeStart, afterStart), [before, after, beforeStart, afterStart]);
  const [full, setFull] = useState(false);
  const changed = result.rows.flatMap((row, i) => row.kind === 'same' ? [] : [i]);
  const visible = new Set<number>();
  for (const i of changed) for (let j = Math.max(0, i - 2); j <= Math.min(result.rows.length - 1, i + 2); j++) visible.add(j);
  if (!changed.length) for (let i = 0; i < Math.min(5, result.rows.length); i++) visible.add(i);
  let lastShown = -1;
  return <div className="sg-line-diff"><div className="sg-toolbar"><span className="sg-muted">旧行号 / 新行号 · <span className="sg-diff-legend removed">− 删除</span> <span className="sg-diff-legend added">+ 新增</span></span><label className="sg-check-row"><input type="checkbox" checked={full} onChange={e => setFull(e.target.checked)}/>显示完整场次</label></div>{!changed.length && <p className="sg-muted">文字一致，可继续核对场次顺序和上下文。</p>}{result.truncated && <p className="sg-notice">文本较长，本次采用分段对照；以下仍完整保留对应文字，可打开原稿核对。</p>}<div className="sg-diff-lines" tabIndex={0} aria-label="逐行文字变化">{result.rows.map((row, i) => {
    if (!full && !visible.has(i)) return null;
    const gap = i > lastShown + 1; lastShown = i;
    return <div key={i}>{gap && <div className="sg-diff-gap">⋯ 未变化的文字已折叠</div>}<div className={`sg-diff-line ${row.kind}`}><span>{row.beforeLine || '—'}</span><span>{row.afterLine || '—'}</span><b aria-label={row.kind === 'added' ? '新增' : row.kind === 'removed' ? '删除' : '相同'}>{row.kind === 'added' ? '+' : row.kind === 'removed' ? '−' : ' '}</b><code>{row.text || ' '}</code></div></div>;
  })}{!full && lastShown < result.rows.length - 1 && <div className="sg-diff-gap">⋯ 后续未变化文字已折叠</div>}</div></div>;
}
