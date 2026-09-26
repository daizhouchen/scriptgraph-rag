import { lazy, Suspense, useEffect, useState } from 'react';
import { Workbench } from './Workbench';
const Lab = lazy(() => import('./LegacyDemo').then(module => ({ default: module.LegacyDemo })));
export function App() {
  const [lab, setLab] = useState(location.hash === '#lab');
  useEffect(() => {
    const sync = () => setLab(location.hash === '#lab');
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);
  return <><div hidden={lab}><Workbench/></div>{lab && <><div className="sg-lab-return"><a href="#">← 返回剧本改稿工作台</a><span>固定语料 · 检索方法与评测</span></div><Suspense fallback={<p>正在打开技术实验室…</p>}><Lab/></Suspense></>}</>;
}
