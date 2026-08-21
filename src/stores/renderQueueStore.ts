import { create } from 'zustand';

export type RenderJobStatus = 'queued' | 'running' | 'completed' | 'failed' | 'cancelled';

export interface RenderJob {
  id: string;
  kind: 'video' | 'jianying' | 'proxy' | 'prerender';
  status: RenderJobStatus;
  title: string;
  outputPath?: string;
  stage?: string;
  detail?: string;
  percent?: number;
  error?: string;
  createdAt: number;
  startedAt?: number;
  finishedAt?: number;
}

interface RenderQueueState {
  jobs: RenderJob[];
  activeJobId: string | null;
  createJob: (job: Omit<RenderJob, 'id' | 'status' | 'createdAt'> & { id?: string; status?: RenderJobStatus }) => string;
  startJob: (id: string) => void;
  updateJob: (id: string, patch: Partial<Pick<RenderJob, 'stage' | 'detail' | 'percent' | 'outputPath'>>) => void;
  finishJob: (id: string, status: Exclude<RenderJobStatus, 'queued' | 'running'>, patch?: Partial<Pick<RenderJob, 'error' | 'outputPath' | 'detail'>>) => void;
  latest: () => RenderJob | null;
}

export const useRenderQueueStore = create<RenderQueueState>((set, get) => ({
  jobs: [],
  activeJobId: null,
  createJob: (job) => {
    const id = job.id ?? `render-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const now = Date.now();
    set((s) => ({
      jobs: [
        {
          ...job,
          id,
          status: job.status ?? 'queued',
          createdAt: now,
        },
        ...s.jobs,
      ].slice(0, 30),
      activeJobId: job.status === 'running' ? id : s.activeJobId,
    }));
    return id;
  },
  startJob: (id) => set((s) => ({
    activeJobId: id,
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, status: 'running', startedAt: j.startedAt ?? Date.now() } : j)),
  })),
  updateJob: (id, patch) => set((s) => ({
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch } : j)),
  })),
  finishJob: (id, status, patch = {}) => set((s) => ({
    activeJobId: s.activeJobId === id ? null : s.activeJobId,
    jobs: s.jobs.map((j) => (j.id === id ? { ...j, ...patch, status, finishedAt: Date.now(), percent: status === 'completed' ? 100 : j.percent } : j)),
  })),
  latest: () => get().jobs[0] ?? null,
}));
