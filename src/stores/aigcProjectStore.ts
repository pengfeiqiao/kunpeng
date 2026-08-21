import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import {
  type AigcProject,
  type VideoEngine,
  listProjects,
  readProject,
  createProject as createProjectFile,
  deleteProject as deleteProjectFile,
  writeProject,
} from '@/lib/aigc/projectStore';

interface AigcProjectState {
  currentProjectId: string | null;
  projects: AigcProject[];
  loading: boolean;
  query: string;

  loadProjects: () => Promise<void>;
  selectProject: (id: string | null) => Promise<void>;
  createProject: (name: string) => Promise<AigcProject>;
  deleteProject: (id: string) => Promise<void>;
  refreshCurrent: () => Promise<void>;
  setVideoEngine: (engine: VideoEngine) => Promise<void>;
  setQuery: (q: string) => void;

  getCurrent: () => AigcProject | null;
}

export const useAigcProjectStore = create<AigcProjectState>()(
  persist(
    (set, get) => ({
      currentProjectId: null,
      projects: [],
      loading: false,
      query: '',

      loadProjects: async () => {
        set({ loading: true });
        const projects = await listProjects();
        projects.sort((a, b) => b.updatedAt - a.updatedAt);
        set({ projects, loading: false });
      },

      selectProject: async (id) => {
        set({ currentProjectId: id });
        if (id) {
          const p = await readProject(id);
          if (p) {
            const list = get().projects.map((x) => (x.id === id ? p : x));
            set({ projects: list });
          }
        }
      },

      createProject: async (name) => {
        const p = await createProjectFile(name);
        set((s) => ({
          projects: [p, ...s.projects],
          currentProjectId: p.id,
        }));
        return p;
      },

      deleteProject: async (id) => {
        await deleteProjectFile(id);
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          currentProjectId: s.currentProjectId === id ? null : s.currentProjectId,
        }));
      },

      refreshCurrent: async () => {
        const id = get().currentProjectId;
        if (!id) return;
        const p = await readProject(id);
        if (p) {
          set((s) => ({
            projects: s.projects.map((x) => (x.id === id ? p : x)),
          }));
        }
      },

      setVideoEngine: async (engine) => {
        const id = get().currentProjectId;
        if (!id) return;
        const p = get().projects.find((x) => x.id === id);
        if (!p) return;
        const updated: AigcProject = { ...p, videoEngine: engine, updatedAt: Date.now() };
        await writeProject(updated);
        set((s) => ({ projects: s.projects.map((x) => (x.id === id ? updated : x)) }));
      },

      setQuery: (q) => set({ query: q }),

      getCurrent: () => {
        const { currentProjectId, projects } = get();
        return projects.find((p) => p.id === currentProjectId) ?? null;
      },
    }),
    {
      name: 'aigc-project-storage',
      partialize: (s) => ({ currentProjectId: s.currentProjectId }),
    },
  ),
);
