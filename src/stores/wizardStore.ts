import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { SkillManifest, WizardStep } from '@/types/skill';
import { useSkillStore } from './skillStore';

// ── Types ───────────────────────────────────────────────────────────────────

export interface CharacterData {
  name: string;
  archetype: string;
  age: number;
  personality: string;
  appearance: string;
  visualMemory: string;
  boneStructure: string;
  costume: string;
  faceReference?: string; // 真人照片参考（现代旅游风格）
}

export interface SceneData {
  name: string;
  description: string;
  type: 'indoor-day' | 'indoor-night' | 'outdoor-day' | 'outdoor-night';
  characters: string[];
  // Loaded from project
  conceptPath?: string;
  status?: string;
  folderPath?: string;
}

export interface WizardProject {
  id: string;
  skillId: string;
  createdAt: number;
  updatedAt: number;
  status: 'active' | 'completed' | 'abandoned';

  // Phase 0: Project Init
  style: 'costume' | 'wasteland' | 'travel' | null;
  projectName: string;
  saveLocation: string;

  // Phase 1: Characters
  characters: CharacterData[];
  selectedMakeupImages: Record<string, string>; // characterName -> imageId

  // Phase 2: Scenes
  scenes: SceneData[];

  // Phase 3: Storyboard
  storyboardImages: string[];

  // Phase 4: Review
  approvedShots: number[];

  // Phase 5: Video Prompts
  videoPrompts: string[];

  // Navigation
  currentPhase: number;

  // Generated images storage
  generatedImages: Record<string, string[]>;
}

interface WizardState {
  /** Current active project (single project mode) */
  project: WizardProject | null;
  /** Whether the wizard panel is open */
  isPanelOpen: boolean;
  /** Whether an async operation is in progress */
  isGenerating: boolean;
  /** Current generating operation description */
  generatingMessage: string;

  // Actions - Project Management
  createProject: (skillId: string) => string;
  loadProject: (project: WizardProject) => void;
  clearProject: () => void;

  // Actions - Navigation
  nextPhase: () => void;
  prevPhase: () => void;
  goToPhase: (phase: number) => void;

  // Actions - Phase 0
  setStyle: (style: 'costume' | 'wasteland' | 'travel') => void;
  setProjectName: (name: string) => void;
  setSaveLocation: (location: string) => void;

  // Actions - Phase 1
  setCharacters: (characters: CharacterData[]) => void;
  addCharacter: (character: CharacterData) => void;
  updateCharacter: (index: number, character: Partial<CharacterData>) => void;
  removeCharacter: (index: number) => void;
  selectMakeupImage: (characterName: string, imageId: string) => void;

  // Actions - Phase 2
  setScenes: (scenes: SceneData[]) => void;
  addScene: (scene: SceneData) => void;
  updateScene: (index: number, scene: Partial<SceneData>) => void;
  removeScene: (index: number) => void;

  // Actions - Phase 3
  setStoryboardImages: (images: string[]) => void;

  // Actions - Phase 4
  approveShot: (shotIndex: number) => void;
  rejectShot: (shotIndex: number) => void;

  // Actions - Phase 5
  setVideoPrompts: (prompts: string[]) => void;

  // Actions - Generated Images
  setGeneratedImages: (key: string, images: string[]) => void;
  appendGeneratedImages: (key: string, images: string[]) => void;
  clearGeneratedImages: (key: string) => void;

  // Actions - UI State
  setPanelOpen: (open: boolean) => void;
  setGenerating: (isGenerating: boolean, message?: string) => void;

  // Helpers
  getActiveSkill: () => SkillManifest | null;
  getCurrentStep: () => WizardStep | null;
  getTotalSteps: () => number;
}

// ── Helper Functions ────────────────────────────────────────────────────────

function createEmptyProject(skillId: string): WizardProject {
  return {
    id: `wizard-${Date.now()}`,
    skillId,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    status: 'active',
    style: null,
    projectName: '',
    saveLocation: '',
    characters: [],
    selectedMakeupImages: {},
    scenes: [],
    storyboardImages: [],
    approvedShots: [],
    videoPrompts: [],
    currentPhase: 0,
    generatedImages: {},
  };
}

// ── Store ───────────────────────────────────────────────────────────────────

export const useWizardStore = create<WizardState>()(
  persist(
    (set, get) => ({
      project: null,
      isPanelOpen: false,
      isGenerating: false,
      generatingMessage: '',

      // Project Management
      createProject: (skillId) => {
        const project = createEmptyProject(skillId);
        set({ project, isPanelOpen: true });
        return project.id;
      },

      loadProject: (project) => {
        set({ project, isPanelOpen: true });
      },

      clearProject: () => {
        set({ project: null, isPanelOpen: false });
      },

      // Navigation
      nextPhase: () => {
        const { project } = get();
        if (!project) return;
        const skill = get().getActiveSkill();
        const totalSteps = skill?.wizard?.steps.length ?? 6;
        if (project.currentPhase < totalSteps - 1) {
          set({
            project: {
              ...project,
              currentPhase: project.currentPhase + 1,
              updatedAt: Date.now(),
            },
          });
        }
      },

      prevPhase: () => {
        const { project } = get();
        if (!project || project.currentPhase <= 0) return;
        set({
          project: {
            ...project,
            currentPhase: project.currentPhase - 1,
            updatedAt: Date.now(),
          },
        });
      },

      goToPhase: (phase) => {
        const { project } = get();
        if (!project) return;
        set({
          project: {
            ...project,
            currentPhase: phase,
            updatedAt: Date.now(),
          },
        });
      },

      // Phase 0
      setStyle: (style) => {
        const { project } = get();
        if (!project) return;
        set({
          project: { ...project, style, updatedAt: Date.now() },
        });
      },

      setProjectName: (name) => {
        const { project } = get();
        if (!project) return;
        set({
          project: { ...project, projectName: name, updatedAt: Date.now() },
        });
      },

      setSaveLocation: (location) => {
        const { project } = get();
        if (!project) return;
        set({
          project: { ...project, saveLocation: location, updatedAt: Date.now() },
        });
      },

      // Phase 1 - Characters
      setCharacters: (characters) => {
        const { project } = get();
        if (!project) return;
        set({
          project: { ...project, characters, updatedAt: Date.now() },
        });
      },

      addCharacter: (character) => {
        const { project } = get();
        if (!project) return;
        set({
          project: {
            ...project,
            characters: [...project.characters, character],
            updatedAt: Date.now(),
          },
        });
      },

      updateCharacter: (index, character) => {
        const { project } = get();
        if (!project) return;
        const newCharacters = [...project.characters];
        newCharacters[index] = { ...newCharacters[index], ...character };
        set({
          project: { ...project, characters: newCharacters, updatedAt: Date.now() },
        });
      },

      removeCharacter: (index) => {
        const { project } = get();
        if (!project) return;
        const newCharacters = project.characters.filter((_, i) => i !== index);
        set({
          project: { ...project, characters: newCharacters, updatedAt: Date.now() },
        });
      },

      selectMakeupImage: (characterName, imageId) => {
        const { project } = get();
        if (!project) return;
        set({
          project: {
            ...project,
            selectedMakeupImages: {
              ...project.selectedMakeupImages,
              [characterName]: imageId,
            },
            updatedAt: Date.now(),
          },
        });
      },

      // Phase 2 - Scenes
      setScenes: (scenes) => {
        const { project } = get();
        if (!project) return;
        set({
          project: { ...project, scenes, updatedAt: Date.now() },
        });
      },

      addScene: (scene) => {
        const { project } = get();
        if (!project) return;
        set({
          project: {
            ...project,
            scenes: [...project.scenes, scene],
            updatedAt: Date.now(),
          },
        });
      },

      updateScene: (index, scene) => {
        const { project } = get();
        if (!project) return;
        const newScenes = [...project.scenes];
        newScenes[index] = { ...newScenes[index], ...scene };
        set({
          project: { ...project, scenes: newScenes, updatedAt: Date.now() },
        });
      },

      removeScene: (index) => {
        const { project } = get();
        if (!project) return;
        const newScenes = project.scenes.filter((_, i) => i !== index);
        set({
          project: { ...project, scenes: newScenes, updatedAt: Date.now() },
        });
      },

      // Phase 3 - Storyboard
      setStoryboardImages: (images) => {
        const { project } = get();
        if (!project) return;
        set({
          project: { ...project, storyboardImages: images, updatedAt: Date.now() },
        });
      },

      // Phase 4 - Review
      approveShot: (shotIndex) => {
        const { project } = get();
        if (!project) return;
        if (!project.approvedShots.includes(shotIndex)) {
          set({
            project: {
              ...project,
              approvedShots: [...project.approvedShots, shotIndex],
              updatedAt: Date.now(),
            },
          });
        }
      },

      rejectShot: (shotIndex) => {
        const { project } = get();
        if (!project) return;
        set({
          project: {
            ...project,
            approvedShots: project.approvedShots.filter((i) => i !== shotIndex),
            updatedAt: Date.now(),
          },
        });
      },

      // Phase 5 - Video Prompts
      setVideoPrompts: (prompts) => {
        const { project } = get();
        if (!project) return;
        set({
          project: { ...project, videoPrompts: prompts, updatedAt: Date.now() },
        });
      },

      // Generated Images
      setGeneratedImages: (key, images) => {
        const { project } = get();
        if (!project) return;
        set({
          project: {
            ...project,
            generatedImages: { ...project.generatedImages, [key]: images },
            updatedAt: Date.now(),
          },
        });
      },

      appendGeneratedImages: (key, images) => {
        const { project } = get();
        if (!project) return;
        const existing = project.generatedImages[key] || [];
        set({
          project: {
            ...project,
            generatedImages: {
              ...project.generatedImages,
              [key]: [...existing, ...images],
            },
            updatedAt: Date.now(),
          },
        });
      },

      clearGeneratedImages: (key) => {
        const { project } = get();
        if (!project) return;
        const newImages = { ...project.generatedImages };
        delete newImages[key];
        set({
          project: { ...project, generatedImages: newImages, updatedAt: Date.now() },
        });
      },

      // UI State
      setPanelOpen: (open) => {
        set({ isPanelOpen: open });
      },

      setGenerating: (isGenerating, message = '') => {
        set({ isGenerating, generatingMessage: message });
      },

      // Helpers
      getActiveSkill: () => {
        const { project } = get();
        if (!project) return null;
        const skills = useSkillStore.getState().skills;
        return skills.find((s) => s.id === project.skillId) ?? null;
      },

      getCurrentStep: () => {
        const skill = get().getActiveSkill();
        const { project } = get();
        if (!skill?.wizard || !project) return null;
        return skill.wizard.steps[project.currentPhase] ?? null;
      },

      getTotalSteps: () => {
        const skill = get().getActiveSkill();
        return skill?.wizard?.steps.length ?? 6;
      },
    }),
    {
      name: 'wizard-storage',
      partialize: (state) => ({
        project: state.project,
      }),
    }
  )
);
