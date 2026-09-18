export type Project = {
  id: string; title: string; logline: string; versions: string[];
  scene_count: number; character_count: number; demo_enabled: boolean;
};

export type Evidence = {
  scene_id: string; scene_number: number; heading: string; excerpt: string;
  score: number; reasons: string[]; line_start: number; line_end: number;
};

export type QueryResult = {
  request_id: string; elapsed_ms: number; answer: string;
  confidence: "high" | "medium" | "insufficient";
  evidences: Evidence[]; retrieval_path: string[];
};

export type Conflict = {
  id: string; category: string; summary: string; scene_ids: string[];
  evidence: string[]; review_status: string;
};

export type Impact = {
  scene_id: string; scene_number: number; heading: string; path: string[]; reason: string;
};

import { staticApi } from "./static-demo";

const request = async <T,>(path: string, init?: RequestInit): Promise<T> => {
  const response = await fetch(path, init);
  if (!response.ok) throw new Error(`请求失败：${response.status}`);
  return response.json() as Promise<T>;
};

export const api = {
  projects: () => import.meta.env.VITE_STATIC_DEMO === "true" ? staticApi.projects() : request<Project[]>("/api/projects"),
  query: (project_id: string, question: string, method: string) => import.meta.env.VITE_STATIC_DEMO === "true" ? staticApi.query(project_id, question, method) : request<QueryResult>("/api/query", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id, question, method, top_k: 5 }),
  }),
  conflicts: (project_id: string) => import.meta.env.VITE_STATIC_DEMO === "true" ? staticApi.conflicts(project_id) : request<{ conflicts: Conflict[] }>("/api/consistency/check", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id, categories: [] }),
  }),
  impact: (project_id: string, entity: string, change: string) => import.meta.env.VITE_STATIC_DEMO === "true" ? staticApi.impact(project_id, entity, change) : request<{ impacts: Impact[] }>("/api/impact", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ project_id, entity, change }),
  }),
};
