import { create } from 'zustand';

export type DeepseekHarnessRunPhase = 'running' | 'fallback';

interface DeepseekHarnessState {
  runs: Record<string, DeepseekHarnessRunPhase>;
  startRun: (runId: string) => void;
  markFallback: (runId: string) => void;
  finishRun: (runId: string) => void;
}

/** Ephemeral runtime state shared by every DeepSeek model control. */
export const useDeepseekHarnessStore = create<DeepseekHarnessState>((set) => ({
  runs: {},
  startRun: (runId) => set((state) => ({
    runs: { ...state.runs, [runId]: 'running' },
  })),
  markFallback: (runId) => set((state) => ({
    runs: { ...state.runs, [runId]: 'fallback' },
  })),
  finishRun: (runId) => set((state) => {
    if (!(runId in state.runs)) return state;
    const runs = { ...state.runs };
    delete runs[runId];
    return { runs };
  }),
}));
