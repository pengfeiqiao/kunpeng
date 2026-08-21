import { create } from 'zustand';
import type { SkillManifest } from '@/types/skill';
import { loadSkills, getBuiltinSkills } from '@/lib/skillLoader';
import { buildPrompt, getFieldDefaults } from '@/lib/promptBuilder';
import { useSettingsStore } from './settingsStore';
import { resolveApiKey, resolveSlotApiKey } from '@/lib/credentials';

interface SkillState {
  /** All loaded skills */
  skills: SkillManifest[];
  /** Currently active skill ID (null = no skill selected) */
  activeSkillId: string | null;
  /** Field values for the active skill's panel */
  fieldValues: Record<string, unknown>;
  /** Whether skills have been loaded */
  loaded: boolean;

  // Actions
  loadAllSkills: () => Promise<void>;
  setActiveSkill: (skillId: string | null) => void;
  setFieldValue: (key: string, value: unknown) => void;
  setFieldValues: (values: Record<string, unknown>) => void;
  resetFieldValues: () => void;

  // Derived helpers
  getActiveSkill: () => SkillManifest | null;
  buildActivePrompt: (userContent: string) => string;
}

export const useSkillStore = create<SkillState>((set, get) => ({
  skills: getBuiltinSkills(),
  activeSkillId: null,
  fieldValues: {},
  loaded: false,

  loadAllSkills: async () => {
    try {
      const skills = await loadSkills();
      set({ skills, loaded: true });
    } catch (err) {
      console.error('[skillStore] Failed to load skills:', err);
      set({ loaded: true });
    }
  },

  setActiveSkill: (skillId) => {
    if (skillId === null) {
      set({ activeSkillId: null, fieldValues: {} });
      return;
    }
    const skill = get().skills.find((s) => s.id === skillId);
    if (skill) {
      const defaults = getFieldDefaults(skill);
      set({ activeSkillId: skillId, fieldValues: defaults });
    }
  },

  setFieldValue: (key, value) => {
    set((state) => ({
      fieldValues: { ...state.fieldValues, [key]: value },
    }));
  },

  setFieldValues: (values) => {
    set((state) => ({
      fieldValues: { ...state.fieldValues, ...values },
    }));
  },

  resetFieldValues: () => {
    const skill = get().getActiveSkill();
    if (skill) {
      set({ fieldValues: getFieldDefaults(skill) });
    } else {
      set({ fieldValues: {} });
    }
  },

  getActiveSkill: () => {
    const { skills, activeSkillId } = get();
    if (!activeSkillId) return null;
    return skills.find((s) => s.id === activeSkillId) ?? null;
  },

  buildActivePrompt: (userContent) => {
    const skill = get().getActiveSkill();
    if (!skill) return userContent;

    const { fieldValues } = get();
    const settings = useSettingsStore.getState();

    const firstSlot = settings.imageApiSlots?.find(s => s.enabled && resolveSlotApiKey(settings, s));
    return buildPrompt(skill, fieldValues, userContent, {
      geminiApiKey: resolveApiKey(settings, 'gemini', settings.geminiApiKey),
      dmxApiKey: resolveApiKey(settings, 'dmx', settings.dmxApiKey) || resolveSlotApiKey(settings, firstSlot),
      bananaProApiKey: resolveApiKey(settings, 'bananaPro', settings.bananaProApiKey) || resolveSlotApiKey(settings, firstSlot),
    });
  },
}));
