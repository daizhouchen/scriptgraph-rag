import { validateBackup, type Project } from './domain';

export type Library = { schemaVersion: 2; projects: Project[]; selectedProjectId: string | null };
const DB_NAME = 'scriptgraph-projects';
const STORE = 'workspace';
const KEY = 'library-v2';
let expectedRevision: number | null = null;
export const emptyLibrary = (): Library => ({ schemaVersion: 2, projects: [], selectedProjectId: null });

export class StorageConflictError extends Error {
  readonly code = 'STORAGE_CONFLICT';
  constructor() {
    super('另一个标签页已更新本机项目。为避免覆盖，当前修改尚未保存。请先备份本页修改，再重新载入最新项目。');
    this.name = 'StorageConflictError';
  }
}

function storageRevision(value: unknown): number {
  if (value === undefined) return 0;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('本机记录格式异常，未覆盖原数据。');
  const revision = (value as Record<string, unknown>).storageRevision;
  if (revision === undefined) return 0;
  if (typeof revision !== 'number' || !Number.isSafeInteger(revision) || revision < 0 || revision >= Number.MAX_SAFE_INTEGER)
    throw new Error('本机记录的保存版本异常，未覆盖原数据。');
  return revision;
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(STORE)) request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('浏览器未能打开本机项目存储。'));
    request.onblocked = () => reject(new Error('另一个页面阻止了存储打开，请关闭旧页面后重试。'));
  });
}

export async function loadLibrary(): Promise<Library> {
  const db = await openDatabase();
  try {
    const value: unknown = await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, 'readonly');
      const request = tx.objectStore(STORE).get(KEY);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new Error('读取本机项目失败，原有记录未被覆盖。'));
    });
    if (value === undefined) { expectedRevision = 0; return emptyLibrary(); }
    if (!value || typeof value !== 'object') throw new Error('本机记录格式异常，原有记录未被覆盖。');
    const candidate = value as Library;
    if (candidate.schemaVersion !== 2 || !Array.isArray(candidate.projects) || candidate.projects.length > 30) throw new Error('本机项目版本无法读取，请先备份再处理。');
    const projects: Project[] = [];
    for (const item of candidate.projects) {
      const parsed = validateBackup(item);
      if (!parsed.ok || !parsed.project) throw new Error('有项目未通过完整性校验，原有记录未被覆盖。');
      projects.push(parsed.project);
    }
    if (new Set(projects.map(p => p.id)).size !== projects.length) throw new Error('本机存在重复项目编号，未覆盖记录。');
    const revision = storageRevision(value);
    const library: Library = { schemaVersion: 2, projects, selectedProjectId: candidate.selectedProjectId === null ? null : projects.some(p => p.id === candidate.selectedProjectId) ? candidate.selectedProjectId : projects[0]?.id || null };
    expectedRevision = revision;
    return library;
  } finally { db.close(); }
}

let queue: Promise<void> = Promise.resolve();
export function saveLibrary(library: Library): Promise<void> {
  const snapshot = structuredClone(library);
  const operation = queue.catch(() => undefined).then(async () => {
    if (expectedRevision === null) throw new Error('尚未成功读取本机项目，无法保存。请重新读取，原有记录未被覆盖。');
    const db = await openDatabase();
    try {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORE, 'readwrite');
        let failure: Error | null = null;
        let writtenRevision: number | null = null;
        const abort = (error: Error) => {
          failure = error;
          try { tx.abort(); } catch { reject(error); }
        };
        tx.oncomplete = () => {
          if (writtenRevision === null) { reject(failure ?? new Error('保存未完成，原有记录未被覆盖。')); return; }
          expectedRevision = writtenRevision;
          resolve();
        };
        tx.onerror = () => reject(failure ?? new Error('保存失败：本机存储不可用或空间不足。当前修改仍在此页面，请导出备份。'));
        tx.onabort = () => reject(failure ?? new Error('保存未完成。当前修改仍在此页面，请重试或导出备份。'));
        const store = tx.objectStore(STORE);
        const current = store.get(KEY);
        current.onsuccess = () => {
          try {
            const actualRevision = storageRevision(current.result);
            if (actualRevision !== expectedRevision) { abort(new StorageConflictError()); return; }
            const nextRevision = actualRevision + 1;
            try { store.put({ ...snapshot, storageRevision: nextRevision }, KEY); }
            catch { abort(new Error('浏览器拒绝保存。当前修改仍在此页面，请导出备份。')); return; }
            writtenRevision = nextRevision;
          } catch (error) { abort(error instanceof Error ? error : new Error('浏览器拒绝保存。当前修改仍在此页面，请导出备份。')); }
        };
      });
    } finally { db.close(); }
  });
  queue = operation;
  return operation;
}
