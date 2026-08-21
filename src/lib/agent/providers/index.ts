/**
 * Provider package entrypoint. Importing this module registers the built-in
 * providers so call sites can look them up via `getProvider(id)`.
 *
 * Order matters only for the default fallback chain in router.ts — first
 * registered is the typical default in settings UI.
 */

export * from './types';
export * from './registry';
export * from './router';
export { GLMProvider } from './glm';
export { DeepSeekProvider } from './deepseek';
export { KimiProvider } from './kimi';
export {
  ANTHROPIC_PRESETS,
  AnthropicCompatibleProvider,
  getAnthropicPreset,
} from './anthropic';

import { registerProvider, unregisterProvider } from './registry';
import { GLMProvider } from './glm';
import { DeepSeekProvider } from './deepseek';
import { KimiProvider } from './kimi';
import {
  ANTHROPIC_PRESETS,
  AnthropicCompatibleProvider,
} from './anthropic';

export interface BootstrapConfig {
  glmApiKey?: string;
  glmBaseUrl?: string;
  glmModel?: string;
  deepseekApiKey?: string;
  deepseekBaseUrl?: string;
  deepseekModel?: string;
  kimiApiKey?: string;
  kimiBaseUrl?: string;
  kimiModel?: string;
  /** Generic Anthropic-compatible providers (minimax/qwen/doubao), keyed by id. */
  anthropic?: Record<string, { apiKey?: string; baseUrl?: string; model?: string }>;
}

/**
 * Call once at app startup (App.tsx useEffect) after settings load. Re-calling
 * replaces any existing registrations — useful when the user updates keys in
 * ProviderSettings and we want the new key / baseUrl / model to take effect
 * without restart.
 */
export function bootstrapProviders(cfg: BootstrapConfig): void {
  if (cfg.glmApiKey) {
    registerProvider(
      new GLMProvider({
        apiKey: cfg.glmApiKey,
        baseUrl: cfg.glmBaseUrl || undefined,
        modelId: cfg.glmModel || undefined,
      }),
    );
  } else {
    unregisterProvider('glm');
  }
  if (cfg.deepseekApiKey) {
    registerProvider(
      new DeepSeekProvider({
        apiKey: cfg.deepseekApiKey,
        baseUrl: cfg.deepseekBaseUrl || undefined,
        modelId: cfg.deepseekModel || undefined,
      }),
    );
  } else {
    unregisterProvider('deepseek');
  }
  if (cfg.kimiApiKey) {
    registerProvider(
      new KimiProvider({
        apiKey: cfg.kimiApiKey,
        baseUrl: cfg.kimiBaseUrl || undefined,
        modelId: cfg.kimiModel || undefined,
      }),
    );
  } else {
    unregisterProvider('kimi');
  }
  for (const preset of ANTHROPIC_PRESETS) {
    const entry = cfg.anthropic?.[preset.id];
    if (entry?.apiKey) {
      registerProvider(
        new AnthropicCompatibleProvider(preset, {
          apiKey: entry.apiKey,
          baseUrl: entry.baseUrl || undefined,
          modelId: entry.model || undefined,
        }),
      );
    } else {
      unregisterProvider(preset.id);
    }
  }
}
