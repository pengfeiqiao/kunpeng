import type { RouteStrategy } from './providers/router';
// 相对路径 + .ts 后缀：node --test 直接加载本文件时无法解析 '@/' 别名
import { resolveApiKey, type CredentialHostState } from '../credentials.ts';

export interface RouteSettingsSnapshot extends CredentialHostState {
  providerApiKeys?: Record<string, string>;
  providerModels?: Record<string, string>;
  providerDefault?: string;
  providerFallbackChain?: string[];
}

export interface RouteSelection {
  providerId: string;
  modelId?: string;
}

export interface BuildRouteOptions {
  legacyGlmApiKey?: string;
  /** Explicit selection made in the current surface, such as a workspace picker. */
  primary?: RouteSelection | null;
  /** Old per-agent preference kept only as a recovery path for migrated settings. */
  legacyAgentPreference?: string;
}

function hasProviderKey(
  settings: RouteSettingsSnapshot,
  providerId: string,
  legacyGlmApiKey?: string,
): boolean {
  const providerApiKeys = settings.providerApiKeys ?? {};
  const legacy = providerId === 'glm'
    ? (providerApiKeys.glm ?? legacyGlmApiKey)
    : providerApiKeys[providerId];
  // 凭证注册表优先，旧 providerApiKeys 字段回退
  return Boolean(resolveApiKey(settings, `provider:${providerId}`, legacy ?? '').trim());
}

/**
 * Build one deterministic route from the visible model selection.
 *
 * Priority is deliberately user-facing: current-surface selection, then the
 * explicit fallback list. A migrated per-agent preference must never silently
 * override the model shown in the composer; it is consulted only when the
 * visible primary has no usable key.
 */
export function buildChatRouteStrategy(
  settings: RouteSettingsSnapshot,
  options: BuildRouteOptions = {},
): RouteStrategy | undefined {
  const chain: RouteSelection[] = [];
  const seen = new Set<string>();
  const add = (selection: RouteSelection | null | undefined): boolean => {
    const providerId = selection?.providerId?.trim();
    if (!providerId || seen.has(providerId)) return false;
    if (!hasProviderKey(settings, providerId, options.legacyGlmApiKey)) return false;
    chain.push({
      providerId,
      modelId: selection?.modelId || settings.providerModels?.[providerId] || undefined,
    });
    seen.add(providerId);
    return true;
  };

  const visiblePrimary = options.primary ?? {
    providerId: settings.providerDefault || 'deepseek',
  };
  const hasVisiblePrimary = add(visiblePrimary);

  // Backward compatibility for old agent metadata. It is intentionally not a
  // hidden override when the current UI selection is valid.
  if (!hasVisiblePrimary && options.legacyAgentPreference) {
    add({ providerId: options.legacyAgentPreference });
  }

  for (const providerId of settings.providerFallbackChain ?? []) {
    add({ providerId });
  }

  if (chain.length >= 2) return { kind: 'fallback_chain', chain };
  if (chain.length === 1) {
    return {
      kind: 'primary',
      providerId: chain[0].providerId,
      modelId: chain[0].modelId,
    };
  }
  return undefined;
}

export function getPrimaryRouteSelection(strategy: RouteStrategy | undefined): RouteSelection {
  if (!strategy) return { providerId: 'deepseek' };
  if (strategy.kind === 'primary') {
    return { providerId: strategy.providerId, modelId: strategy.modelId };
  }
  if (strategy.kind === 'fallback_chain') {
    return strategy.chain[0] ?? { providerId: 'deepseek' };
  }
  return { providerId: 'deepseek' };
}
