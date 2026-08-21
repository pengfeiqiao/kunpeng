import { create } from 'zustand';

interface ToolConfirmRequest {
  toolName: string;
  params: Record<string, unknown>;
  reason?: string;
  resolve: (allowed: boolean) => void;
}

interface ToolConfirmState {
  pending: ToolConfirmRequest | null;
  /** Called by coordinator to request confirmation */
  requestConfirm: (
    toolName: string,
    params: Record<string, unknown>,
    reason?: string,
  ) => Promise<boolean>;
  /** Called by UI to approve */
  approve: () => void;
  /** Called by UI to reject */
  reject: () => void;
}

export const useToolConfirmStore = create<ToolConfirmState>((set, get) => ({
  pending: null,

  requestConfirm: (toolName, params, reason) => {
    return new Promise<boolean>((resolve) => {
      set({ pending: { toolName, params, reason, resolve } });
    });
  },

  approve: () => {
    const { pending } = get();
    if (pending) {
      pending.resolve(true);
      set({ pending: null });
    }
  },

  reject: () => {
    const { pending } = get();
    if (pending) {
      pending.resolve(false);
      set({ pending: null });
    }
  },
}));
