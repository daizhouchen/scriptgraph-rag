import corpus from "./demo-corpus.json";
import { createDemoApi, type DemoCorpus } from "./demo-logic";

const demo = createDemoApi(corpus as DemoCorpus);

// No simulated delay or fabricated results: all public data comes from the source corpus.
export const staticApi = {
  projects: async () => demo.projects(),
  workspace: async (projectId: string) => demo.workspace(projectId),
  query: async (projectId: string, question: string, method: string) => demo.query(projectId, question, method),
  conflicts: async (projectId: string) => demo.conflicts(projectId),
  impact: async (projectId: string, entity: string, change: string) => demo.impact(projectId, entity, change),
};
