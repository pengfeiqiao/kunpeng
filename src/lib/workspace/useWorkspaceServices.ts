import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { discoverConfiguredImageSlots, resolveConfiguredApimartApiKey } from '@/lib/imageRouter/configuredChannels';
import { previewPrice } from '@/lib/rhtv/pricePreview';
import { estimateWorkspacePrice, type WorkspaceCapabilities } from './services';
import type { WorkspaceDraft } from './types';

/** Only booleans leave the settings selector. No credentials enter components, drafts or diagnostics. */
export function useWorkspaceServices() {
  const signature = useSettingsStore((state) => JSON.stringify({
    gpt: discoverConfiguredImageSlots(state).length > 0 || Boolean(resolveConfiguredApimartApiKey(state)),
    apimart: Boolean(resolveConfiguredApimartApiKey(state)),
    runninghub: Boolean(resolveApiKey(state, 'runninghub', state.runninghubApiKey).trim()),
    kuaizi: Boolean(resolveApiKey(state, 'kuaizi', state.kuaiziApiKey).trim()),
    ark: Boolean(resolveApiKey(state, 'ark', state.arkApiKey).trim()),
    seedanceChannel: state.seedanceEngine ?? (state.useRhtvSeedance ? 'runninghub' : 'kuaizi'),
  }));
  const capabilities = JSON.parse(signature) as WorkspaceCapabilities;
  return { capabilities, estimate: async (draft: WorkspaceDraft) => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 8_000);
    try { return await estimateWorkspacePrice(draft, capabilities.runninghub,
      (endpoint, params) => previewPrice(endpoint, params, controller.signal)); }
    finally { clearTimeout(timeout); }
  } };
}
