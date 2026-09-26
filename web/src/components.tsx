import { useEffect, useRef, type ReactNode } from 'react';
import { X, Download, FileText } from 'lucide-react';
import type { EvidenceRef, Project, ScriptVersion, Scene } from './domain';

export const STATUS_NAMES = { open: '待处理', working: '修改中', resolved: '已解决', dismissed: '保留设定' } as const;
export function getVersion(project: Project, id = project.activeVersionId) { return project.versions.find(v => v.id === id)!; }
export function shortDate(value: number) { return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }); }
export function saveFile(name: string, text: string, type = 'text/plain;charset=utf-8') {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function backupProject(project: Project) {
  saveFile(`${project.title.replace(/[\\/:*?"<>|]/g, '_')}-ScriptGraph.json`, JSON.stringify({ format: 'scriptgraph-project', schemaVersion: 2, project }, null, 2), 'application/json');
}
export function Modal({ title, subtitle, children, close, wide = false }: { title: string; subtitle?: string; children: ReactNode; close: () => void; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { ref.current?.showModal(); }, []);
  return <dialog ref={ref} className={`sg-modal ${wide ? 'sg-modal-wide' : ''}`} aria-labelledby="sg-modal-title" onCancel={e => { e.preventDefault(); close(); }} onClick={e => { if (e.target === e.currentTarget) close(); }}>
    <header className="sg-modal-head"><div>{subtitle && <p className="sg-overline">{subtitle}</p>}<h2 id="sg-modal-title">{title}</h2></div><button className="sg-icon" onClick={close} aria-label="关闭窗口"><X size={20}/></button></header>
    <div className="sg-modal-body">{children}</div>
  </dialog>;
}
export function Lines({ version, scene, highlight }: { version: ScriptVersion; scene: Scene; highlight?: EvidenceRef }) {
  return <div className="sg-lines" tabIndex={0} aria-label={`第${scene.number}场原文`}><ol>{version.text.split('\n').slice(scene.lineStart - 1, scene.lineEnd).map((line, i) => {
    const number = scene.lineStart + i;
    return <li key={number} className={highlight && number >= highlight.lineStart && number <= highlight.lineEnd ? 'sg-highlight' : ''}><span aria-hidden="true">{number}</span><code>{line || ' '}</code></li>;
  })}</ol></div>;
}
export function EvidenceButton({ project, evidence, open }: { project: Project; evidence: EvidenceRef; open: (ref: EvidenceRef) => void }) {
  const version = project.versions.find(v => v.id === evidence.versionId);
  const scene = version?.scenes.find(s => s.id === evidence.sceneId);
  return <button className="sg-evidence" onClick={() => open(evidence)}><FileText size={15}/><span>{version?.label || '旧版本'} · 第{scene?.number || '?'}场<span className="sg-evidence-range">原文 {evidence.lineStart}–{evidence.lineEnd} 行</span></span></button>;
}
export function BackupButton({ project }: { project: Project }) { return <button className="sg-secondary" onClick={() => backupProject(project)}><Download size={16}/>备份项目</button>; }
