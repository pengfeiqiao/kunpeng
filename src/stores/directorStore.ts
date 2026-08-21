/**
 * directorStore v2 — 白模动态预演工程状态。
 *
 * 每个工坊镜头/画布来源使用独立文件，来源只保存定位信息，不复制外部资产。
 * three 对象仍由 DirectorEngine 持有，store 只保存可序列化方案、镜头与动作。
 */
import { create } from 'zustand';
import { nanoid } from 'nanoid';
import { readProjectFile, writeProjectFile } from '@/lib/aigc/projectStore';
import { safeLocalStorage } from '@/lib/safeStorage';
import { useUnifiedProjectStore } from './unifiedProjectStore';
import {
  type AspectId,
  type DirectorActionClip,
  type DirectorElement,
  type DirectorElementState,
  type DirectorExportRecord,
  type DirectorGroup,
  type DirectorOrigin,
  type DirectorPlan,
  type DirectorSceneFile,
  type DirectorSequenceShot,
  type MannequinElement,
  vec3,
} from '@/lib/director/types';
import { createMotionKeyframes } from '@/lib/director/motionTemplates';

const FREE_KEY = 'kunpeng-director-v2-free';
let saveTimer: ReturnType<typeof setTimeout> | null = null;

export type TransformMode = 'translate' | 'rotate' | 'scale';

interface DirectorLaunchSeed {
  elements?: DirectorElement[];
  plans?: DirectorPlan[];
  forceNew?: boolean;
}

interface HistorySnapshot {
  elements: DirectorElement[];
  groups: DirectorGroup[];
  plans: DirectorPlan[];
  activePlanId: string | null;
  activeShotId: string | null;
}

interface DirectorState {
  isOpen: boolean;
  projectId: string | null;
  loaded: boolean;
  loadedFromExisting: boolean;
  origin: DirectorOrigin;
  launchSeed: DirectorLaunchSeed | null;

  elements: DirectorElement[];
  groups: DirectorGroup[];
  plans: DirectorPlan[];
  exports: DirectorExportRecord[];
  aspect: AspectId;

  selectedIds: string[];
  activePlanId: string | null;
  activeShotId: string | null;
  currentTimeSec: number;
  playing: boolean;
  transformMode: TransformMode;
  panoramaPath: string | null;

  undoStack: HistorySnapshot[];
  redoStack: HistorySnapshot[];

  prepareLaunch: (origin: DirectorOrigin, seed?: DirectorLaunchSeed) => void;
  open: () => Promise<void>;
  close: () => void;

  checkpoint: () => void;
  undo: () => void;
  redo: () => void;

  addElement: (e: DirectorElement) => void;
  reconcileMannequins: (expected: MannequinElement[]) => void;
  updateElement: (id: string, patch: Partial<DirectorElement>) => void;
  updateShotElementState: (shotId: string, elementId: string, patch: Partial<DirectorElementState>) => void;
  removeElements: (ids: string[]) => void;
  duplicateElements: (ids: string[]) => string[];
  groupElements: (ids: string[]) => string | null;
  ungroup: (groupId: string) => void;

  addPlan: (plan?: Partial<DirectorPlan>) => string;
  replacePlans: (plans: DirectorPlan[]) => void;
  duplicatePlan: (id: string) => string | null;
  updatePlan: (id: string, patch: Partial<Pick<DirectorPlan, 'name' | 'summary'>>) => void;
  removePlan: (id: string) => void;
  setActivePlan: (id: string) => void;

  addShot: (shot?: Partial<DirectorSequenceShot>) => string;
  updateShot: (id: string, patch: Partial<DirectorSequenceShot>) => void;
  removeShot: (id: string) => void;
  reorderShot: (id: string, targetIndex: number) => void;
  setActiveShot: (id: string | null) => void;

  addAction: (shotId: string, clip: Omit<DirectorActionClip, 'id'>) => string;
  updateAction: (shotId: string, actionId: string, patch: Partial<DirectorActionClip>) => void;
  removeAction: (shotId: string, actionId: string) => void;

  setSelected: (ids: string[]) => void;
  setTransformMode: (m: TransformMode) => void;
  setAspect: (a: AspectId) => void;
  setPanorama: (_p: string | null) => void;
  setCurrentTime: (timeSec: number) => void;
  setPlaying: (playing: boolean) => void;
  addExport: (record: DirectorExportRecord) => void;
  markExportWrittenBack: (id: string) => void;

  scheduleSave: () => void;
  save: () => Promise<void>;
}

const FREE_ORIGIN: DirectorOrigin = { kind: 'free', title: '自由预演' };

function clone<T>(value: T): T {
  return structuredClone(value);
}

function stateOfElement(element: DirectorElement): DirectorElementState {
  return {
    position: clone(element.position),
    rotationDeg: clone(element.rotationDeg),
    scale: clone(element.scale),
    visible: element.visible,
  };
}

function elementStateMap(elements: DirectorElement[]): Record<string, DirectorElementState> {
  return Object.fromEntries(elements.map((element) => [element.id, stateOfElement(element)]));
}

function makeSequenceShot(
  index: number,
  startSec: number,
  durationSec: number,
  aspect: AspectId,
  elements: DirectorElement[],
): DirectorSequenceShot {
  const angles = [0, -22, 20, -8];
  const distances = [7.2, 5.2, 4.2, 6.0];
  const yaw = (angles[index % angles.length] * Math.PI) / 180;
  const distance = distances[index % distances.length];
  const position = vec3(Math.sin(yaw) * distance, index === 2 ? 1.7 : 2.3, Math.cos(yaw) * distance);
  const target = vec3(0, 1, 0);
  return {
    id: `shot-${nanoid(7)}`,
    name: `镜头 ${index + 1}`,
    position,
    target,
    fov: index === 2 ? 34 : index === 1 ? 42 : 50,
    aspect,
    createdAt: Date.now(),
    startSec,
    durationSec,
    cameraEnd: { position: clone(position), target: clone(target), fov: index === 2 ? 34 : index === 1 ? 42 : 50 },
    cameraMove: 'static',
    elementStates: elementStateMap(elements),
    actions: [],
  };
}

function makeDefaultPlan(elements: DirectorElement[], aspect: AspectId, name = '稳定叙事'): DirectorPlan {
  const duration = 3.75;
  return {
    id: `plan-${nanoid(7)}`,
    name,
    summary: '15 秒 · 4 个镜头 · 白模动态预演',
    createdAt: Date.now(),
    shots: Array.from({ length: 4 }, (_, index) => makeSequenceShot(index, index * duration, duration, aspect, elements)),
  };
}

function originKey(origin: DirectorOrigin): string {
  const raw = [origin.kind, origin.projectId, origin.shotNo, origin.nodeId].filter(Boolean).join('-') || 'free';
  return raw.replace(/[^a-zA-Z0-9_-]+/g, '_').slice(0, 100);
}

export function directorProjectFileName(origin: DirectorOrigin): string {
  return `director-v2-${originKey(origin)}.json`;
}

export async function hasDirectorProject(projectId: string, shotNo: string, mode: 'storyboard' | 'video-prompt'): Promise<boolean> {
  const origin: DirectorOrigin = {
    kind: mode === 'storyboard' ? 'workshop-storyboard' : 'workshop-video-prompt',
    title: '',
    projectId,
    shotNo,
  };
  const raw = await readProjectFile(projectId, directorProjectFileName(origin));
  if (!raw) return false;
  try {
    const file = JSON.parse(raw) as Partial<DirectorSceneFile>;
    return file.version === 2 && Array.isArray(file.plans) && file.plans.length > 0;
  } catch {
    return false;
  }
}

function snapshot(state: DirectorState): HistorySnapshot {
  return clone({
    elements: state.elements,
    groups: state.groups,
    plans: state.plans,
    activePlanId: state.activePlanId,
    activeShotId: state.activeShotId,
  });
}

function normalizeShotTimes(plan: DirectorPlan): DirectorPlan {
  let cursor = 0;
  return {
    ...plan,
    shots: plan.shots.map((shot) => {
      const next = { ...shot, startSec: cursor, durationSec: Math.max(0.25, shot.durationSec) };
      cursor += next.durationSec;
      return next;
    }),
  };
}

function upgradePlanKeyframes(plan: DirectorPlan): DirectorPlan {
  return {
    ...plan,
    shots: plan.shots.map((shot) => ({
      ...shot,
      cameraKeyframes: shot.cameraKeyframes?.length ? shot.cameraKeyframes : [
        { id: `ckf-${nanoid(7)}`, timeSec: 0, position: clone(shot.position), target: clone(shot.target), fov: shot.fov, rollDeg: shot.rollDeg ?? 0, interpolation: 'smooth', source: 'template', note: '旧工程起始机位' },
        { id: `ckf-${nanoid(7)}`, timeSec: shot.durationSec, position: clone(shot.cameraEnd.position), target: clone(shot.cameraEnd.target), fov: shot.cameraEnd.fov, rollDeg: shot.cameraEnd.rollDeg ?? shot.rollDeg ?? 0, interpolation: 'smooth', source: 'template', note: '旧工程结束机位' },
      ],
      actions: shot.actions.map((action) => ({
        ...action,
        templateId: action.templateId ?? action.action,
        intensity: action.intensity ?? 1,
        source: action.source ?? 'legacy',
        keyframes: action.keyframes?.length ? action.keyframes : createMotionKeyframes(action.action, action.durationSec, action.from, action.to, 'template'),
      })),
    })),
  };
}

export function newElementId(): string {
  return `el-${nanoid(8)}`;
}

export const useDirectorStore = create<DirectorState>((set, get) => ({
  isOpen: false,
  projectId: null,
  loaded: false,
  loadedFromExisting: false,
  origin: FREE_ORIGIN,
  launchSeed: null,
  elements: [],
  groups: [],
  plans: [],
  exports: [],
  aspect: '16:9',
  selectedIds: [],
  activePlanId: null,
  activeShotId: null,
  currentTimeSec: 0,
  playing: false,
  transformMode: 'translate',
  panoramaPath: null,
  undoStack: [],
  redoStack: [],

  prepareLaunch: (origin, seed) => set({ origin, launchSeed: seed ?? null }),

  open: async () => {
    const projectId = useUnifiedProjectStore.getState().activeId;
    const { origin, launchSeed } = get();
    set({ isOpen: true, projectId, loaded: false, loadedFromExisting: false, selectedIds: [], playing: false, currentTimeSec: 0 });
    try {
      const raw = projectId
        ? await readProjectFile(projectId, directorProjectFileName(origin))
        : safeLocalStorage.getItem(`${FREE_KEY}-${originKey(origin)}`);
      let file: DirectorSceneFile | null = null;
      try { file = raw ? JSON.parse(raw) as DirectorSceneFile : null; } catch { file = null; }
      if (file?.version === 2 && !launchSeed?.forceNew) {
        const firstPlan = file.plans[0];
        set({
          elements: file.elements ?? [],
          groups: file.groups ?? [],
          plans: (file.plans ?? []).map(upgradePlanKeyframes),
          exports: file.exports ?? [],
          aspect: file.aspect ?? '16:9',
          origin: { ...(file.origin ?? {}), ...origin },
          activePlanId: file.activePlanId ?? firstPlan?.id ?? null,
          activeShotId: (file.plans.find((plan) => plan.id === file.activePlanId) ?? firstPlan)?.shots[0]?.id ?? null,
          undoStack: [],
          redoStack: [],
          loadedFromExisting: true,
        });
        if ((origin.kind === 'workshop-storyboard' || origin.kind === 'workshop-video-prompt') && launchSeed?.elements) {
          const canonicalPeople = launchSeed.elements.filter((element): element is MannequinElement => element.kind === 'mannequin');
          get().reconcileMannequins(canonicalPeople);
          set({ undoStack: [], redoStack: [] });
        }
      } else {
        const elements = clone(launchSeed?.elements ?? []);
        const plans = clone(launchSeed?.plans ?? [makeDefaultPlan(elements, '16:9')]).map(upgradePlanKeyframes);
        set({
          elements,
          groups: [],
          plans,
          exports: [],
          aspect: '16:9',
          activePlanId: plans[0]?.id ?? null,
          activeShotId: plans[0]?.shots[0]?.id ?? null,
          undoStack: [],
          redoStack: [],
          loadedFromExisting: false,
        });
      }
    } finally {
      set({ loaded: true, launchSeed: null });
    }
  },

  close: () => {
    if (saveTimer) { clearTimeout(saveTimer); saveTimer = null; }
    void get().save();
    set({ isOpen: false, selectedIds: [], playing: false });
  },

  checkpoint: () => set((state) => {
    const next = snapshot(state);
    const previous = state.undoStack[state.undoStack.length - 1];
    // Several UI controls share a gesture start. Keep one history entry when
    // they checkpoint the exact same scene state.
    if (previous && JSON.stringify(previous) === JSON.stringify(next)) return { redoStack: [] };
    return { undoStack: [...state.undoStack.slice(-39), next], redoStack: [] };
  }),
  undo: () => {
    const state = get();
    const previous = state.undoStack[state.undoStack.length - 1];
    if (!previous) return;
    set({ ...clone(previous), undoStack: state.undoStack.slice(0, -1), redoStack: [...state.redoStack, snapshot(state)] });
    get().scheduleSave();
  },
  redo: () => {
    const state = get();
    const next = state.redoStack[state.redoStack.length - 1];
    if (!next) return;
    set({ ...clone(next), redoStack: state.redoStack.slice(0, -1), undoStack: [...state.undoStack, snapshot(state)] });
    get().scheduleSave();
  },

  addElement: (element) => {
    get().checkpoint();
    const baseState = stateOfElement(element);
    set((state) => ({
      elements: [...state.elements, element],
      selectedIds: [element.id],
      plans: state.plans.map((plan) => ({
        ...plan,
        shots: plan.shots.map((shot) => ({ ...shot, elementStates: { ...shot.elementStates, [element.id]: clone(baseState) } })),
      })),
    }));
    get().scheduleSave();
  },

  reconcileMannequins: (expected) => {
    const state = get();
    const current = state.elements.filter((element): element is MannequinElement => element.kind === 'mannequin');
    const alreadyCanonical = current.length === expected.length && expected.every((target) => current.some((element) => element.id === target.id && element.name === target.name && element.color === target.color));
    if (alreadyCanonical) return;
    get().checkpoint();
    const used = new Set<string>();
    const sourceForTarget = new Map<string, MannequinElement | undefined>();
    expected.forEach((target) => {
      const source = current.find((element) => !used.has(element.id) && element.id === target.id)
        ?? current.find((element) => !used.has(element.id) && element.name === target.name)
        ?? current.find((element) => !used.has(element.id));
      if (source) used.add(source.id);
      sourceForTarget.set(target.id, source);
    });
    const idMap = new Map<string, string>();
    sourceForTarget.forEach((source, targetId) => { if (source) idMap.set(source.id, targetId); });
    const oldIds = new Set(current.map((element) => element.id));
    const canonical = expected.map((target) => {
      const source = sourceForTarget.get(target.id);
      return source ? {
        ...source,
        id: target.id,
        name: target.name,
        characterId: target.characterId,
        identitySource: target.identitySource,
        color: target.color,
        visible: true,
        groupId: null,
      } : target;
    });
    const plans = state.plans.map((plan) => ({
      ...plan,
      shots: plan.shots.map((shot) => {
        const elementStates = Object.fromEntries(Object.entries(shot.elementStates).filter(([id]) => !oldIds.has(id)));
        canonical.forEach((target) => {
          const source = sourceForTarget.get(target.id);
          const previous = source ? shot.elementStates[source.id] : undefined;
          elementStates[target.id] = previous ? { ...previous, visible: true } : stateOfElement(target);
        });
        return {
          ...shot,
          elementStates,
          primaryElementId: shot.primaryElementId ? idMap.get(shot.primaryElementId) ?? (oldIds.has(shot.primaryElementId) ? canonical[0]?.id : shot.primaryElementId) : undefined,
          actions: shot.actions.flatMap((action) => {
            if (!oldIds.has(action.elementId)) return [action];
            const nextId = idMap.get(action.elementId);
            return nextId ? [{ ...action, elementId: nextId }] : [];
          }),
        };
      }),
    }));
    set({
      elements: [...state.elements.filter((element) => element.kind !== 'mannequin'), ...canonical],
      plans,
      selectedIds: state.selectedIds.map((id) => idMap.get(id) ?? id).filter((id) => !oldIds.has(id) || canonical.some((element) => element.id === id)),
    });
    get().scheduleSave();
  },

  updateElement: (id, patch) => {
    const activeShotId = get().activeShotId;
    set((state) => ({
      elements: state.elements.map((element) => element.id === id ? { ...element, ...patch } as DirectorElement : element),
      plans: activeShotId ? state.plans.map((plan) => ({
        ...plan,
        shots: plan.shots.map((shot) => {
          if (shot.id !== activeShotId) return shot;
          const current = shot.elementStates[id];
          if (!current) return shot;
          return {
            ...shot,
            elementStates: {
              ...shot.elementStates,
              [id]: {
                ...current,
                ...(patch.position ? { position: clone(patch.position) } : {}),
                ...(patch.rotationDeg ? { rotationDeg: clone(patch.rotationDeg) } : {}),
                ...(patch.scale ? { scale: clone(patch.scale) } : {}),
                ...(patch.visible !== undefined ? { visible: patch.visible } : {}),
              },
            },
          };
        }),
      })) : state.plans,
    }));
    get().scheduleSave();
  },

  updateShotElementState: (shotId, elementId, patch) => {
    set((state) => ({ plans: state.plans.map((plan) => ({
      ...plan,
      shots: plan.shots.map((shot) => shot.id === shotId ? {
        ...shot,
        elementStates: { ...shot.elementStates, [elementId]: { ...shot.elementStates[elementId], ...clone(patch) } },
      } : shot),
    })) }));
    get().scheduleSave();
  },

  removeElements: (ids) => {
    get().checkpoint();
    const remove = new Set(ids);
    set((state) => ({
      elements: state.elements.filter((element) => !remove.has(element.id)),
      selectedIds: state.selectedIds.filter((id) => !remove.has(id)),
      plans: state.plans.map((plan) => ({
        ...plan,
        shots: plan.shots.map((shot) => ({
          ...shot,
          elementStates: Object.fromEntries(Object.entries(shot.elementStates).filter(([id]) => !remove.has(id))),
          actions: shot.actions.filter((action) => !remove.has(action.elementId)),
        })),
      })),
    }));
    get().scheduleSave();
  },

  duplicateElements: (ids) => {
    const clones = get().elements.filter((element) => ids.includes(element.id)).map((source) => ({
      ...clone(source),
      id: newElementId(),
      name: `${source.name} 副本`,
      position: vec3(source.position.x + 0.6, source.position.y, source.position.z + 0.6),
      groupId: null,
    } as DirectorElement));
    clones.forEach((element) => get().addElement(element));
    if (clones.length) set({ selectedIds: clones.map((element) => element.id) });
    return clones.map((element) => element.id);
  },

  groupElements: (ids) => {
    if (ids.length < 2) return null;
    get().checkpoint();
    const id = `grp-${nanoid(6)}`;
    set((state) => ({
      groups: [...state.groups, { id, name: `组 ${state.groups.length + 1}` }],
      elements: state.elements.map((element) => ids.includes(element.id) ? { ...element, groupId: id } : element),
    }));
    get().scheduleSave();
    return id;
  },

  ungroup: (groupId) => {
    get().checkpoint();
    set((state) => ({
      groups: state.groups.filter((group) => group.id !== groupId),
      elements: state.elements.map((element) => element.groupId === groupId ? { ...element, groupId: null } : element),
    }));
    get().scheduleSave();
  },

  addPlan: (partial) => {
    get().checkpoint();
    const plan = { ...makeDefaultPlan(get().elements, get().aspect, partial?.name), ...partial, id: partial?.id ?? `plan-${nanoid(7)}` } as DirectorPlan;
    set((state) => ({ plans: [...state.plans, plan], activePlanId: plan.id, activeShotId: plan.shots[0]?.id ?? null, currentTimeSec: 0 }));
    get().scheduleSave();
    return plan.id;
  },

  replacePlans: (plans) => {
    if (!plans.length) return;
    get().checkpoint();
    const next = clone(plans).map(normalizeShotTimes);
    set({ plans: next, activePlanId: next[0].id, activeShotId: next[0].shots[0]?.id ?? null, currentTimeSec: 0, playing: false });
    get().scheduleSave();
  },

  duplicatePlan: (id) => {
    const source = get().plans.find((plan) => plan.id === id);
    if (!source) return null;
    const copy = clone(source);
    copy.id = `plan-${nanoid(7)}`;
    copy.name = `${source.name} 副本`;
    copy.createdAt = Date.now();
    copy.shots = copy.shots.map((shot) => ({
      ...shot,
      id: `shot-${nanoid(7)}`,
      actions: shot.actions.map((action) => ({ ...action, id: `act-${nanoid(7)}`, keyframes: action.keyframes?.map((keyframe) => ({ ...keyframe, id: `kf-${nanoid(7)}` })) })),
      cameraKeyframes: shot.cameraKeyframes?.map((keyframe) => ({ ...keyframe, id: `ckf-${nanoid(7)}` })),
    }));
    get().checkpoint();
    set((state) => ({ plans: [...state.plans, copy], activePlanId: copy.id, activeShotId: copy.shots[0]?.id ?? null, currentTimeSec: 0 }));
    get().scheduleSave();
    return copy.id;
  },

  updatePlan: (id, patch) => { set((state) => ({ plans: state.plans.map((plan) => plan.id === id ? { ...plan, ...patch } : plan) })); get().scheduleSave(); },
  removePlan: (id) => {
    if (get().plans.length <= 1) return;
    get().checkpoint();
    set((state) => {
      const plans = state.plans.filter((plan) => plan.id !== id);
      const active = state.activePlanId === id ? plans[0] : plans.find((plan) => plan.id === state.activePlanId);
      return { plans, activePlanId: active?.id ?? null, activeShotId: active?.shots[0]?.id ?? null, currentTimeSec: 0 };
    });
    get().scheduleSave();
  },
  setActivePlan: (id) => {
    const plan = get().plans.find((item) => item.id === id);
    if (plan) set({ activePlanId: id, activeShotId: plan.shots[0]?.id ?? null, currentTimeSec: 0, playing: false });
  },

  addShot: (partial) => {
    const plan = get().plans.find((item) => item.id === get().activePlanId);
    if (!plan) return '';
    get().checkpoint();
    const duration = partial?.durationSec ?? 3.75;
    const start = plan.shots.reduce((sum, shot) => sum + shot.durationSec, 0);
    const shot = { ...makeSequenceShot(plan.shots.length, start, duration, get().aspect, get().elements), ...partial, id: partial?.id ?? `shot-${nanoid(7)}` } as DirectorSequenceShot;
    set((state) => ({
      plans: state.plans.map((item) => item.id === plan.id ? normalizeShotTimes({ ...item, shots: [...item.shots, shot] }) : item),
      activeShotId: shot.id,
      currentTimeSec: start,
    }));
    get().scheduleSave();
    return shot.id;
  },

  updateShot: (id, patch) => {
    set((state) => ({ plans: state.plans.map((plan) => normalizeShotTimes({
      ...plan,
      shots: plan.shots.map((shot) => {
        if (shot.id !== id) return shot;
        const next = { ...shot, ...clone(patch) };
        if (patch.durationSec !== undefined && patch.durationSec > 0 && shot.durationSec > 0) {
          const ratio = patch.durationSec / shot.durationSec;
          if (patch.cameraKeyframes === undefined && next.cameraKeyframes) next.cameraKeyframes = next.cameraKeyframes.map((keyframe) => ({ ...keyframe, timeSec: Math.min(patch.durationSec!, keyframe.timeSec * ratio) }));
          if (patch.actions === undefined) next.actions = next.actions.map((action) => ({ ...action, startSec: Math.min(patch.durationSec! - 0.2, action.startSec * ratio), durationSec: Math.min(patch.durationSec!, action.durationSec * ratio), keyframes: action.keyframes?.map((keyframe) => ({ ...keyframe, timeSec: keyframe.timeSec * ratio })) }));
        }
        return next;
      }),
    })) }));
    get().scheduleSave();
  },
  removeShot: (id) => {
    const plan = get().plans.find((item) => item.id === get().activePlanId);
    if (!plan || plan.shots.length <= 1) return;
    get().checkpoint();
    set((state) => ({ plans: state.plans.map((item) => item.id === plan.id ? normalizeShotTimes({ ...item, shots: item.shots.filter((shot) => shot.id !== id) }) : item) }));
    const next = get().plans.find((item) => item.id === plan.id)?.shots[0];
    if (get().activeShotId === id) set({ activeShotId: next?.id ?? null, currentTimeSec: next?.startSec ?? 0 });
    get().scheduleSave();
  },
  reorderShot: (id, targetIndex) => {
    get().checkpoint();
    set((state) => ({ plans: state.plans.map((plan) => {
      const index = plan.shots.findIndex((shot) => shot.id === id);
      if (index < 0) return plan;
      const shots = [...plan.shots];
      const [shot] = shots.splice(index, 1);
      shots.splice(Math.max(0, Math.min(targetIndex, shots.length)), 0, shot);
      return normalizeShotTimes({ ...plan, shots });
    }) }));
    get().scheduleSave();
  },
  setActiveShot: (id) => {
    const shot = get().plans.flatMap((plan) => plan.shots).find((item) => item.id === id);
    set({ activeShotId: id, currentTimeSec: shot?.startSec ?? get().currentTimeSec, playing: false });
  },

  addAction: (shotId, clip) => {
    const id = `act-${nanoid(7)}`;
    const complete = { ...clip, id, templateId: clip.templateId ?? clip.action, intensity: clip.intensity ?? 1, source: clip.source ?? 'manual', keyframes: clip.keyframes?.length ? clip.keyframes : createMotionKeyframes(clip.action, clip.durationSec, clip.from, clip.to, clip.source === 'agent' ? 'agent' : 'template') } as DirectorActionClip;
    get().checkpoint();
    get().updateShot(shotId, {
      actions: [...(get().plans.flatMap((plan) => plan.shots).find((shot) => shot.id === shotId)?.actions ?? []), complete],
    });
    return id;
  },
  updateAction: (shotId, actionId, patch) => {
    const shot = get().plans.flatMap((plan) => plan.shots).find((item) => item.id === shotId);
    if (shot) get().updateShot(shotId, { actions: shot.actions.map((action) => {
      if (action.id !== actionId) return action;
      const next = { ...action, ...clone(patch) };
      if (patch.durationSec !== undefined && patch.keyframes === undefined && action.durationSec > 0 && next.keyframes) {
        const ratio = Math.max(0.01, patch.durationSec) / action.durationSec;
        next.keyframes = next.keyframes.map((keyframe) => ({ ...keyframe, timeSec: Math.min(patch.durationSec!, keyframe.timeSec * ratio) }));
      }
      return next;
    }) });
  },
  removeAction: (shotId, actionId) => {
    const shot = get().plans.flatMap((plan) => plan.shots).find((item) => item.id === shotId);
    if (shot) {
      get().checkpoint();
      get().updateShot(shotId, { actions: shot.actions.filter((action) => action.id !== actionId) });
    }
  },

  setSelected: (ids) => set({ selectedIds: ids }),
  setTransformMode: (transformMode) => set({ transformMode }),
  setAspect: (aspect) => { set({ aspect }); get().scheduleSave(); },
  setPanorama: () => set({ panoramaPath: null }),
  setCurrentTime: (currentTimeSec) => set({ currentTimeSec: Math.max(0, currentTimeSec) }),
  setPlaying: (playing) => set({ playing }),
  addExport: (record) => { set((state) => ({ exports: [...state.exports, record] })); get().scheduleSave(); },
  markExportWrittenBack: (id) => { set((state) => ({ exports: state.exports.map((item) => item.id === id ? { ...item, writtenBack: true } : item) })); get().scheduleSave(); },

  scheduleSave: () => {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => void get().save(), 800);
  },
  save: async () => {
    const state = get();
    if (!state.loaded) return;
    const file: DirectorSceneFile = {
      version: 2,
      elements: state.elements,
      groups: state.groups,
      plans: state.plans,
      activePlanId: state.activePlanId,
      aspect: state.aspect,
      origin: state.origin,
      exports: state.exports,
      updatedAt: Date.now(),
    };
    const json = JSON.stringify(file);
    if (state.projectId) await writeProjectFile(state.projectId, directorProjectFileName(state.origin), json);
    else safeLocalStorage.setItem(`${FREE_KEY}-${originKey(state.origin)}`, json);
  },
}));

export function activeDirectorPlan(state = useDirectorStore.getState()): DirectorPlan | undefined {
  return state.plans.find((plan) => plan.id === state.activePlanId);
}

export function activeDirectorShot(state = useDirectorStore.getState()): DirectorSequenceShot | undefined {
  return activeDirectorPlan(state)?.shots.find((shot) => shot.id === state.activeShotId);
}
