import { useSettingsStore } from '@/stores/settingsStore';

/**
 * Private defaults overlay (see 开源计划 06).
 *
 * `public/private.defaults.json` only exists in the author's own builds
 * (scripts/prepare-private.mjs copies the gitignored root file into public/).
 * Public clones ship without it, so this silently no-ops. Values are applied
 * only where the user has not configured anything yet — saved settings always
 * win. The overlay must NEVER carry API keys.
 */
interface PrivateDefaults {
  cosTransitEndpoint?: string;
  greetingName?: string;
}

let attempted = false;

export async function applyPrivateDefaults(): Promise<void> {
  if (attempted) return;
  attempted = true;
  try {
    const res = await fetch('/private.defaults.json', { cache: 'no-store' });
    if (!res.ok) return;
    const data = (await res.json()) as PrivateDefaults;
    const s = useSettingsStore.getState();
    const patch: Partial<Record<'cosTransitEndpoint' | 'greetingName', string>> = {};
    if (typeof data.cosTransitEndpoint === 'string' && data.cosTransitEndpoint.trim() && !s.cosTransitEndpoint?.trim()) {
      patch.cosTransitEndpoint = data.cosTransitEndpoint.trim();
    }
    if (typeof data.greetingName === 'string' && data.greetingName.trim() && !s.greetingName?.trim()) {
      patch.greetingName = data.greetingName.trim();
    }
    if (Object.keys(patch).length > 0) useSettingsStore.setState(patch);
  } catch {
    // No overlay (public build) or malformed file — ignore by design.
  }
}
