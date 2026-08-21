import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface OceanAccount {
  id: string;
  name: string;
  aadvid: string;
  isActive: boolean;
  lastLogin?: number;
}

export interface TouliuProject {
  projectId: string;
  name: string;
  budget: number;
  status: 'draft' | 'running' | 'paused' | 'completed';
  createdAt: number;
}

export type TouliuTaskType = 'create-project' | 'add-keywords' | 'select-video' | 'full-pipeline' | 'fetch-metrics';

export interface TouliuTask {
  id: string;
  type: TouliuTaskType;
  status: 'pending' | 'running' | 'success' | 'failed';
  progress: number;
  logs: string[];
  params: Record<string, unknown>;
  result?: Record<string, unknown>;
  startedAt?: number;
  finishedAt?: number;
}

export interface TouliuMetrics {
  projectId: string;
  date: string;
  cost: number;
  impressions: number;
  clicks: number;
  ctr: number;
  conversions: number;
  conversionCost: number;
  interactions: number;
}

export interface TouliuUnitRow {
  name: string;
  type: string;
  id: string;
  projectName: string;
  projectStatus: string;
  projectBudget: string;
  unitStatus: string;
  unitBudget: string;
  unitBid: string;
  cost: number;
  impressions: number;
  cpm: number;
  clicks: number;
  ctr: number;
  conversions: number;
  cvr: number;
  cpa: number;
  diagnosis: string;
}

export interface TouliuDashboard {
  fetchedAt: number;
  accountName: string;
  aadvid: string;
  totalCost: number;
  totalBudget: string;
  totalImpressions: number;
  totalClicks: number;
  totalCtr: number;
  totalConversions: number;
  totalCpa: number;
  totalCpm: number;
  balance: string;
  units: TouliuUnitRow[];
}

interface TouliuState {
  accounts: OceanAccount[];
  activeAccountId: string | null;

  tasks: TouliuTask[];
  activeTaskId: string | null;

  projects: TouliuProject[];
  metrics: TouliuMetrics[];

  dashboard: TouliuDashboard | null;

  addAccount: (account: Omit<OceanAccount, 'id' | 'isActive'>) => void;
  removeAccount: (id: string) => void;
  setActiveAccount: (id: string) => void;
  getActiveAccount: () => OceanAccount | undefined;

  addTask: (task: Omit<TouliuTask, 'id' | 'status' | 'progress' | 'logs'>) => string;
  updateTask: (id: string, partial: Partial<TouliuTask>) => void;
  appendTaskLog: (id: string, log: string) => void;
  clearTasks: () => void;

  setProjects: (projects: TouliuProject[]) => void;
  addProject: (project: TouliuProject) => void;
  setMetrics: (metrics: TouliuMetrics[]) => void;
  setDashboard: (dashboard: TouliuDashboard) => void;
}

let _taskCounter = 0;

export const useTouliuStore = create<TouliuState>()(
  persist(
    (set, get) => ({
      accounts: [],
      activeAccountId: null,

      tasks: [],
      activeTaskId: null,

      projects: [],
      metrics: [],

      dashboard: null,

      addAccount: (acct) => {
        const id = `ocean-${Date.now()}`;
        const newAcct: OceanAccount = { ...acct, id, isActive: false };
        set((s) => {
          const accounts = [...s.accounts, newAcct];
          const activeAccountId = s.activeAccountId ?? id;
          return {
            accounts: accounts.map((a) => ({ ...a, isActive: a.id === activeAccountId })),
            activeAccountId,
          };
        });
      },

      removeAccount: (id) =>
        set((s) => {
          const accounts = s.accounts.filter((a) => a.id !== id);
          const activeAccountId = s.activeAccountId === id ? (accounts[0]?.id ?? null) : s.activeAccountId;
          return {
            accounts: accounts.map((a) => ({ ...a, isActive: a.id === activeAccountId })),
            activeAccountId,
          };
        }),

      setActiveAccount: (id) =>
        set((s) => ({
          accounts: s.accounts.map((a) => ({ ...a, isActive: a.id === id })),
          activeAccountId: id,
        })),

      getActiveAccount: () => {
        const s = get();
        return s.accounts.find((a) => a.id === s.activeAccountId);
      },

      addTask: (partial) => {
        const id = `task-${++_taskCounter}-${Date.now()}`;
        const task: TouliuTask = {
          ...partial,
          id,
          status: 'pending',
          progress: 0,
          logs: [],
        };
        set((s) => ({ tasks: [...s.tasks, task], activeTaskId: id }));
        return id;
      },

      updateTask: (id, partial) =>
        set((s) => ({
          tasks: s.tasks.map((t) => (t.id === id ? { ...t, ...partial } : t)),
        })),

      appendTaskLog: (id, log) =>
        set((s) => ({
          tasks: s.tasks.map((t) =>
            t.id === id ? { ...t, logs: [...t.logs, `[${new Date().toLocaleTimeString()}] ${log}`] } : t,
          ),
        })),

      clearTasks: () => set({ tasks: [], activeTaskId: null }),

      setProjects: (projects) => set({ projects }),
      addProject: (project) => set((s) => ({ projects: [...s.projects, project] })),
      setMetrics: (metrics) => set({ metrics }),
      setDashboard: (dashboard) => set({ dashboard }),
    }),
    {
      name: 'kunpeng-touliu',
      partialize: (state) => ({
        accounts: state.accounts,
        activeAccountId: state.activeAccountId,
        projects: state.projects,
        dashboard: state.dashboard,
      }),
    },
  ),
);
