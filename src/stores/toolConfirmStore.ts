import { create } from 'zustand';
import { buildGenerationDraft, type GenerationDraft } from '@/lib/projectObjects/generationDraft';
import { buildCanvasGenerationDraft } from '@/lib/canvas/generationDraftPreview';
import { ConfirmationQueue, type ConfirmationEntry } from '@/lib/agent/confirmationQueue';
import { confirmToolItems } from '@/lib/agent/confirmBatch';
import type { ToolRisk } from '@/lib/agent/types';

interface ToolConfirmRequest {
  toolName: string;
  params: Record<string, unknown>;
  reason?: string;
  generationDraft?: GenerationDraft;
}

interface ToolConfirmState {
  pending: readonly ConfirmationEntry<ToolConfirmRequest>[];
  total: number;
  /** Called by coordinator to request confirmation */
  requestConfirm: (
    toolName: string,
    params: Record<string, unknown>,
    reason?: string,
    options?: { scope?: string; signal?: AbortSignal; risk?: ToolRisk },
  ) => Promise<boolean>;
  /** Called by UI to approve */
  approve: (id: number) => void;
  /** Called by UI to reject */
  reject: (id: number) => void;
  approveAll: (id: number, visibleIds: readonly number[]) => void;
  cancelScope: (scope: string) => void;
}

export const useToolConfirmStore = create<ToolConfirmState>((set) => {
  const queue = new ConfirmationQueue<ToolConfirmRequest>((state) => set(state));
  return {
    ...queue.getSnapshot(),
    requestConfirm: (toolName, params, reason, options) => confirmToolItems(toolName, params, (item) => {
      const frozenParams = structuredClone(item.params);
      return queue.request({
        toolName: item.toolName,
        params: frozenParams,
        reason,
        generationDraft: structuredClone((item.toolName === 'canvas_generate'
          ? buildCanvasGenerationDraft(item.toolName, frozenParams, options?.risk)
          : buildGenerationDraft(item.toolName, frozenParams, options?.risk)) ?? undefined),
      }, options);
    }, options?.signal),
    approve: (id) => queue.decide(id, true),
    reject: (id) => queue.decide(id, false),
    approveAll: (id, visibleIds) => queue.approveGroup(id, visibleIds),
    cancelScope: (scope) => queue.cancelScope(scope),
  };
});
