export type SkillScope = 'global' | 'project';

export interface SkillPreference {
  enabled: boolean;
  scope: SkillScope;
  projectId?: string;
  lastUsedAt?: number;
}

const STORAGE_KEY = 'kunpeng:skill-preferences:v1';

function storage(): Storage | null {
  return typeof window !== 'undefined' && window.localStorage ? window.localStorage : null;
}

export function readSkillPreferences(): Record<string, SkillPreference> {
  try {
    const raw = storage()?.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) as Record<string, SkillPreference> : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function readSkillPreference(skillId: string): SkillPreference {
  return readSkillPreferences()[skillId] ?? { enabled: true, scope: 'global' };
}

export function isSkillPreferenceActive(
  preference: SkillPreference | undefined,
  projectId?: string,
): boolean {
  if (!preference) return true;
  if (!preference.enabled) return false;
  return preference.scope !== 'project' || Boolean(projectId && preference.projectId === projectId);
}

export function isSkillEnabled(skillId: string, projectId?: string): boolean {
  return isSkillPreferenceActive(readSkillPreferences()[skillId], projectId);
}

export function writeSkillPreference(skillId: string, patch: Partial<SkillPreference>): SkillPreference {
  const all = readSkillPreferences();
  const current = all[skillId];
  const next: SkillPreference = {
    enabled: patch.enabled ?? current?.enabled ?? true,
    scope: patch.scope ?? current?.scope ?? 'global',
    projectId: patch.projectId ?? current?.projectId,
    lastUsedAt: patch.lastUsedAt ?? current?.lastUsedAt,
  };
  if (next.scope === 'global') delete next.projectId;
  all[skillId] = next;
  storage()?.setItem(STORAGE_KEY, JSON.stringify(all));
  if (typeof window !== 'undefined') window.dispatchEvent(new CustomEvent('kunpeng:skill-preferences'));
  return next;
}

export function markSkillUsed(skillId: string): void {
  writeSkillPreference(skillId, { lastUsedAt: Date.now() });
}
