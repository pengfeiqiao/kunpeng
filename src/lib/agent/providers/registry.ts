/**
 * Registry of all available providers. New backends are added by importing
 * their module (which side-effect-registers itself) and the registry handles
 * the rest. Settings UI iterates `listProviders()` to render rows.
 */

import type { Provider } from './types';

const REGISTRY = new Map<string, Provider>();

export function registerProvider(p: Provider): void {
  if (REGISTRY.has(p.id)) {
    console.warn(`[providers] overwriting registration for "${p.id}"`);
  }
  REGISTRY.set(p.id, p);
}

export function getProvider(id: string): Provider | undefined {
  return REGISTRY.get(id);
}

export function listProviders(): Provider[] {
  return Array.from(REGISTRY.values());
}

export function unregisterProvider(id: string): void {
  REGISTRY.delete(id);
}
