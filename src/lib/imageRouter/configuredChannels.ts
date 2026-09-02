import {
  normalizeBaseUrl,
  resolveApiKey,
  resolveSlotApiKey,
  type Credential,
  type CredentialHostState,
} from '../credentials.ts';

export type CompatibleImageProvider = 'dmxapi' | 'aihubmix' | 'zexapi';

export interface ConfiguredImageSlot {
  id: string;
  label: string;
  provider: CompatibleImageProvider;
  baseUrl: string;
  apiKey: string;
  credentialId?: string;
  enabled: boolean;
  priority: number;
  mode?: 'text-to-image' | 'image-to-image';
  tier?: 'cheap' | 'standard';
}

export interface ImageChannelSettings extends CredentialHostState {
  imageApiSlots?: ConfiguredImageSlot[];
  dmxApiKey?: string;
  omniApimartApiKey?: string;
}

const PROVIDER_DEFAULTS: Record<CompatibleImageProvider, { label: string; baseUrl: string }> = {
  dmxapi: { label: 'DMXAPI', baseUrl: 'https://www.dmxapi.cn' },
  aihubmix: { label: 'AiHubMix', baseUrl: 'https://api.inferera.com' },
  zexapi: { label: 'ZexAPI', baseUrl: 'https://zexapi.com' },
};

const APIMART_HOSTS = new Set(['api.apimart.ai', 'apib.ai', 'aiuxu.com', 'aishuch.com']);

function hostname(value: string | undefined): string {
  try {
    return new URL(value ?? '').hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function imageProviderForBaseUrl(value: string | undefined): CompatibleImageProvider | undefined {
  const host = hostname(value);
  if (host === 'dmxapi.cn' || host.endsWith('.dmxapi.cn')) return 'dmxapi';
  if (host === 'aihubmix.com' || host.endsWith('.aihubmix.com')) return 'aihubmix';
  if (host === 'inferera.com' || host.endsWith('.inferera.com')) return 'aihubmix';
  if (host === 'zexapi.com' || host.endsWith('.zexapi.com')) return 'zexapi';
  return undefined;
}

function matchingCredential(
  credentials: Credential[] | undefined,
  provider: CompatibleImageProvider,
  preferredBaseUrl?: string,
): Credential | undefined {
  const candidates = (credentials ?? []).filter((credential) => (
    credential.apiKey?.trim() && imageProviderForBaseUrl(credential.baseUrl) === provider
  ));
  const preferred = normalizeBaseUrl(preferredBaseUrl ?? '');
  return candidates.find((credential) => normalizeBaseUrl(credential.baseUrl) === preferred) ?? candidates[0];
}

/**
 * Return every runnable GPT-compatible image slot without changing persisted settings.
 * Credentials-only imports and stale credential references are repaired in memory, while
 * an explicitly disabled provider remains disabled.
 */
export function discoverConfiguredImageSlots(state: ImageChannelSettings): ConfiguredImageSlot[] {
  const explicitSlots = Array.isArray(state.imageApiSlots) ? state.imageApiSlots : [];
  const explicitProviders = new Set<CompatibleImageProvider>();
  const resolved: ConfiguredImageSlot[] = [];

  for (const slot of explicitSlots) {
    const provider = slot.provider ?? imageProviderForBaseUrl(slot.baseUrl);
    if (!provider) continue;
    explicitProviders.add(provider);
    if (!slot.enabled || !slot.baseUrl?.trim()) continue;

    const directKey = resolveSlotApiKey(state, slot).trim();
    const fallbackCredential = directKey
      ? undefined
      : matchingCredential(state.credentials, provider, slot.baseUrl);
    const apiKey = directKey || fallbackCredential?.apiKey?.trim() || '';
    if (!apiKey) continue;

    resolved.push({
      ...slot,
      provider,
      baseUrl: normalizeBaseUrl(slot.baseUrl),
      apiKey,
      credentialId: directKey ? slot.credentialId : fallbackCredential?.id,
    });
  }

  for (const provider of Object.keys(PROVIDER_DEFAULTS) as CompatibleImageProvider[]) {
    if (explicitProviders.has(provider)) continue;
    const credential = matchingCredential(state.credentials, provider);
    const legacyDmxKey = provider === 'dmxapi'
      ? resolveApiKey(state, 'dmx', state.dmxApiKey ?? '').trim()
      : '';
    const apiKey = credential?.apiKey?.trim() || legacyDmxKey;
    if (!apiKey) continue;
    const info = PROVIDER_DEFAULTS[provider];
    resolved.push({
      id: `credential-image-${credential?.id ?? 'dmx-legacy'}`,
      label: credential?.label?.trim() || info.label,
      provider,
      baseUrl: normalizeBaseUrl(credential?.baseUrl || info.baseUrl),
      apiKey,
      credentialId: credential?.id,
      enabled: true,
      priority: 100 + resolved.length,
      tier: provider === 'aihubmix' ? 'standard' : 'cheap',
    });
  }

  return resolved;
}

/** APIMart may be configured as a capability or imported as a standalone credential. */
export function resolveConfiguredApimartApiKey(state: ImageChannelSettings): string {
  const linked = resolveApiKey(state, 'omniApimart', state.omniApimartApiKey ?? '').trim();
  if (linked) return linked;
  return (state.credentials ?? []).find((credential) => (
    credential.apiKey?.trim() && APIMART_HOSTS.has(hostname(credential.baseUrl))
  ))?.apiKey?.trim() ?? '';
}
