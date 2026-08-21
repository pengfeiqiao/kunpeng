import { nanoid } from 'nanoid';
import type { Tool, ToolResult } from '../types';
import { generateDirectorPlanProposals } from '@/lib/director/agentPlanning';
import { evaluateDirectorFrame, inspectDirectorPlan, planDuration } from '@/lib/director/playback';
import { createMotionKeyframes, motionTemplate, MOTION_TEMPLATES } from '@/lib/director/motionTemplates';
import { cameraPatchFromTemplate, CAMERA_TEMPLATES } from '@/lib/director/cameraTemplates';
import { findPose, POSE_PRESETS } from '@/lib/director/poses';
import { cornerPathFrame, smoothPathFrame } from '@/lib/director/pathCurve';
import type {
  DirectorActionClip,
  DirectorActionId,
  DirectorCameraKeyframe,
  DirectorElement,
  DirectorKeyframeInterpolation,
  DirectorMotionKeyframe,
  DirectorPlan,
  DirectorSequenceShot,
  ElementKind,
  Vec3,
} from '@/lib/director/types';
import { activeDirectorPlan, activeDirectorShot, newElementId, useDirectorStore } from '@/stores/directorStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { dispatchDirectorRuntimeCommand, getDirectorRuntimeSnapshot } from '@/lib/director/runtimeControl';

const FPS = 24;
const pendingProposals = new Map<string, { plans: DirectorPlan[]; createdAt: number }>();
const interpolationValues = ['hold', 'linear', 'smooth', 'ease-in', 'ease-out'];
const cameraMoveValues = CAMERA_TEMPLATES.map((item) => item.id);
const actionValues = MOTION_TEMPLATES.map((item) => item.id);

function ok(value: unknown): ToolResult {
  return { success: true, output: typeof value === 'string' ? value : JSON.stringify(value, null, 2) };
}

function fail(error: unknown): ToolResult {
  return { success: false, output: '', error: error instanceof Error ? error.message : String(error) };
}

function num(value: unknown, fallback: number, min = -Infinity, max = Infinity): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(min, Math.min(max, parsed)) : fallback;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function vecFromParams(params: Record<string, unknown>, prefix: string, fallback: Vec3, limits: [number, number]): Vec3 {
  return {
    x: num(params[`${prefix}_x`], fallback.x, limits[0], limits[1]),
    y: num(params[`${prefix}_y`], fallback.y, limits[0], limits[1]),
    z: num(params[`${prefix}_z`], fallback.z, limits[0], limits[1]),
  };
}

function hasVecParams(params: Record<string, unknown>, prefix: string): boolean {
  return [`${prefix}_x`, `${prefix}_y`, `${prefix}_z`].some((key) => params[key] !== undefined);
}

function requireDirector() {
  const state = useDirectorStore.getState();
  if (!state.isOpen || !state.loaded) throw new Error('导演台尚未打开或仍在载入');
  const plan = activeDirectorPlan(state);
  if (!plan) throw new Error('导演台没有可用方案');
  return { state, plan };
}

function resolveShot(plan: DirectorPlan, shotId?: unknown): DirectorSequenceShot {
  const id = String(shotId ?? '');
  const shot = (id ? plan.shots.find((item) => item.id === id) : undefined) ?? activeDirectorShot() ?? plan.shots[0];
  if (!shot) throw new Error('找不到目标镜头');
  return shot;
}

function resolveAction(shot: DirectorSequenceShot, actionId: unknown): DirectorActionClip {
  const action = shot.actions.find((item) => item.id === String(actionId ?? ''));
  if (!action) throw new Error(`镜头 ${shot.id} 中找不到动作 ${String(actionId ?? '')}`);
  return action;
}

function elementState(shot: DirectorSequenceShot, element: DirectorElement) {
  return shot.elementStates[element.id] ?? {
    position: element.position,
    rotationDeg: element.rotationDeg,
    scale: element.scale,
    visible: element.visible,
  };
}

function absoluteFrame(shot: DirectorSequenceShot, localSec: number): number {
  return Math.round((shot.startSec + localSec) * FPS);
}

function projectStateOutput() {
  const { state, plan } = requireDirector();
  const shot = resolveShot(plan, state.activeShotId);
  const evaluated = evaluateDirectorFrame(plan, state.elements, state.currentTimeSec);
  const runtime = getDirectorRuntimeSnapshot();
  return {
    fps: FPS,
    origin: { kind: state.origin.kind, title: state.origin.title, prompt: state.origin.prompt ?? '' },
    project_shots: (useWorkshopStore.getState().data?.shots ?? []).map((item) => ({ shot_no: item.shotNo, description: item.description.slice(0, 160), character_ids: item.characterIds })),
    aspect: state.aspect,
    transport: {
      playing: state.playing,
      current_time_sec: state.currentTimeSec,
      current_frame: Math.round(state.currentTimeSec * FPS),
      duration_sec: planDuration(plan),
      duration_frames: Math.round(planDuration(plan) * FPS),
    },
    selection: { element_ids: state.selectedIds, active_plan_id: plan.id, active_shot_id: shot.id },
    current_frame: evaluated ? {
      shot_id: evaluated.shot.id,
      shot_name: evaluated.shot.name,
      shot_local_frame: Math.round(evaluated.localTimeSec * FPS),
      camera: evaluated.camera,
      visible_elements: evaluated.elements.filter((item) => item.visible).map((item) => ({
        id: item.id,
        name: item.name,
        kind: item.kind,
        position: item.position,
        rotation_deg: item.rotationDeg,
        scale: item.scale,
        pose_id: item.kind === 'mannequin' ? item.poseId : undefined,
      })),
    } : null,
    elements: state.elements.map((element) => ({
      id: element.id,
      name: element.name,
      kind: element.kind,
      character_id: element.kind === 'mannequin' ? element.characterId ?? null : null,
      identity_source: element.kind === 'mannequin' ? element.identitySource ?? null : null,
      shot_state: elementState(shot, element),
    })),
    plans: state.plans.map((item) => ({
      id: item.id,
      name: item.name,
      summary: item.summary,
      active: item.id === state.activePlanId,
      duration_sec: planDuration(item),
      shots: item.shots.map((entry, index) => ({
        id: entry.id,
        index,
        name: entry.name,
        active: entry.id === state.activeShotId,
        start_sec: entry.startSec,
        start_frame: Math.round(entry.startSec * FPS),
        duration_sec: entry.durationSec,
        duration_frames: Math.round(entry.durationSec * FPS),
        camera_move: entry.cameraMove,
        shot_scale: entry.shotScale ?? null,
        element_states: Object.entries(entry.elementStates).map(([elementId, value]) => ({ element_id: elementId, ...value })),
        camera_keyframes: (entry.cameraKeyframes ?? []).map((keyframe) => ({
          id: keyframe.id,
          shot_frame: Math.round(keyframe.timeSec * FPS),
          project_frame: absoluteFrame(entry, keyframe.timeSec),
          position: keyframe.position,
          target: keyframe.target,
          fov: keyframe.fov,
          roll_deg: keyframe.rollDeg ?? 0,
          interpolation: keyframe.interpolation,
          locked: keyframe.locked ?? false,
          source: keyframe.source ?? 'template',
        })),
        actions: entry.actions.map((action) => ({
          id: action.id,
          element_id: action.elementId,
          element_name: state.elements.find((element) => element.id === action.elementId)?.name ?? '未知对象',
          action: action.action,
          start_shot_frame: Math.round(action.startSec * FPS),
          start_project_frame: absoluteFrame(entry, action.startSec),
          duration_frames: Math.round(action.durationSec * FPS),
          from: action.from,
          to: action.to,
          locked: action.locked ?? false,
          source: action.source ?? 'legacy',
          keyframes: (action.keyframes ?? []).map((keyframe) => ({
            id: keyframe.id,
            action_frame: Math.round(keyframe.timeSec * FPS),
            project_frame: absoluteFrame(entry, action.startSec + keyframe.timeSec),
            position: keyframe.position,
            rotation_deg: keyframe.rotationDeg,
            interpolation: keyframe.interpolation,
            path_mode: keyframe.pathMode ?? 'corner',
            path_in: keyframe.pathIn,
            path_out: keyframe.pathOut,
            locked: keyframe.locked ?? false,
            source: keyframe.source ?? 'template',
            note: keyframe.note ?? '',
          })),
        })),
      })),
    })),
    health: inspectDirectorPlan(plan, state.elements),
    export_workspace: runtime ? {
      in_frame: Math.round(runtime.exportInSec * FPS),
      out_frame: Math.round(runtime.exportOutSec * FPS),
      output_path: runtime.outputPath,
      exporting: runtime.exporting,
    } : null,
    capabilities: {
      action_templates: MOTION_TEMPLATES.map((item) => ({ id: item.id, label: item.label, category: item.category, default_frames: Math.round(item.defaultDurationSec * FPS), moving: item.moving ?? false })),
      pose_templates: POSE_PRESETS.map((item) => ({ id: item.id, label: item.label })),
      camera_moves: CAMERA_TEMPLATES.map((item) => ({ id: item.id, label: item.label })),
      interpolation: interpolationValues,
      rules: ['所有写操作使用返回的真实 ID', '帧率固定 24fps', '默认不覆盖人工锁定', '修改后再次读取状态复核'],
    },
    isolation: '导演台只操作白模工程元数据；不会把来源视频或正式资产加入导演台。',
  };
}

const getStateTool: Tool = {
  definition: {
    name: 'director_get_state',
    description: '读取导演台完整可编辑状态：当前帧、真实对象 ID、镜头、人物动作、姿态 K 帧、贝塞尔路径、摄影机 K 帧、锁定状态、检查结果和可用模板。任何修改前和修改后都必须调用。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() { try { return ok(projectStateOutput()); } catch (error) { return fail(error); } },
};

const transportTool: Tool = {
  definition: {
    name: 'director_transport',
    description: '控制导演台播放头、播放、暂停、逐帧定位、撤销、重做和保存。seek 使用绝对工程帧。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['seek', 'play', 'pause', 'undo', 'redo', 'save'] },
        frame: { type: 'number', description: 'seek 时的绝对工程帧，24fps。' },
      },
      required: ['action'],
    },
  },
  risk: 'safe',
  async execute(params) {
    try {
      const { state, plan } = requireDirector();
      const action = String(params.action ?? '');
      if (action === 'seek') {
        const max = Math.max(0, Math.round(planDuration(plan) * FPS) - 1);
        const frame = Math.round(num(params.frame, 0, 0, max));
        state.setPlaying(false);
        state.setCurrentTime(frame / FPS);
      } else if (action === 'play') state.setPlaying(true);
      else if (action === 'pause') state.setPlaying(false);
      else if (action === 'undo') state.undo();
      else if (action === 'redo') state.redo();
      else if (action === 'save') await state.save();
      else throw new Error(`不支持的 transport 操作：${action}`);
      return ok({ action, current_frame: Math.round(useDirectorStore.getState().currentTimeSec * FPS), success: true });
    } catch (error) { return fail(error); }
  },
};

const selectTool: Tool = {
  definition: {
    name: 'director_select',
    description: '切换方案或镜头，并选中一个真实舞台对象。只改变当前工作焦点，不修改工程内容。',
    parameters: {
      type: 'object',
      properties: {
        plan_id: { type: 'string' },
        shot_id: { type: 'string' },
        element_id: { type: 'string', description: '传空字符串可清除对象选择。' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    try {
      const { state } = requireDirector();
      if (params.plan_id !== undefined) {
        const planId = String(params.plan_id);
        if (!state.plans.some((item) => item.id === planId)) throw new Error(`找不到方案 ${planId}`);
        state.setActivePlan(planId);
      }
      const current = useDirectorStore.getState();
      const plan = activeDirectorPlan(current)!;
      if (params.shot_id !== undefined) {
        const shotId = String(params.shot_id);
        if (!plan.shots.some((item) => item.id === shotId)) throw new Error(`当前方案找不到镜头 ${shotId}`);
        current.setActiveShot(shotId);
      }
      if (params.element_id !== undefined) {
        const id = String(params.element_id);
        if (id && !current.elements.some((item) => item.id === id)) throw new Error(`找不到对象 ${id}`);
        current.setSelected(id ? [id] : []);
      }
      const next = useDirectorStore.getState();
      return ok({ active_plan_id: next.activePlanId, active_shot_id: next.activeShotId, selected_ids: next.selectedIds, current_frame: Math.round(next.currentTimeSec * FPS) });
    } catch (error) { return fail(error); }
  },
};

const updateElementTool: Tool = {
  definition: {
    name: 'director_update_element',
    description: '修改指定镜头内对象的位置、旋转、缩放或可见性。只写入该镜头，不污染其他镜头；必须使用 director_get_state 返回的 element_id/shot_id。',
    parameters: {
      type: 'object',
      properties: {
        shot_id: { type: 'string' }, element_id: { type: 'string' },
        position_x: { type: 'number' }, position_y: { type: 'number' }, position_z: { type: 'number' },
        rotation_x: { type: 'number' }, rotation_y: { type: 'number' }, rotation_z: { type: 'number' },
        scale_x: { type: 'number' }, scale_y: { type: 'number' }, scale_z: { type: 'number' },
        visible: { type: 'boolean' },
      },
      required: ['element_id'],
    },
  },
  risk: 'ask',
  async execute(params) {
    try {
      const { state, plan } = requireDirector();
      const shot = resolveShot(plan, params.shot_id);
      const element = state.elements.find((item) => item.id === String(params.element_id));
      if (!element) throw new Error(`找不到对象 ${String(params.element_id)}`);
      const current = elementState(shot, element);
      const patch: Record<string, unknown> = {};
      if (hasVecParams(params, 'position')) patch.position = vecFromParams(params, 'position', current.position, [-100, 100]);
      if (hasVecParams(params, 'rotation')) patch.rotationDeg = vecFromParams(params, 'rotation', current.rotationDeg, [-360, 360]);
      if (hasVecParams(params, 'scale')) patch.scale = vecFromParams(params, 'scale', current.scale, [0.05, 20]);
      if (params.visible !== undefined) patch.visible = bool(params.visible, current.visible);
      if (Object.keys(patch).length === 0) throw new Error('没有提供可修改的对象参数');
      state.checkpoint();
      state.updateShotElementState(shot.id, element.id, patch);
      state.setSelected([element.id]);
      state.setActiveShot(shot.id);
      return ok({ updated: element.id, shot_id: shot.id, state: { ...current, ...patch } });
    } catch (error) { return fail(error); }
  },
};

const createElementTool: Tool = {
  definition: {
    name: 'director_create_element',
    description: '按用户明确要求新增临时人物、动物、群众或白模代理道具。不要用它替代项目已有真实人物 ID；已有角色必须复用 director_get_state 返回的对象。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['mannequin', 'animal', 'crowd', 'box', 'sphere', 'cylinder', 'wall'] },
        name: { type: 'string' },
        position_x: { type: 'number' }, position_y: { type: 'number' }, position_z: { type: 'number' },
        scale_x: { type: 'number' }, scale_y: { type: 'number' }, scale_z: { type: 'number' },
      },
      required: ['kind', 'name'],
    },
  },
  risk: 'ask',
  async execute(params) {
    try {
      const { state } = requireDirector();
      const rawKind = String(params.kind ?? 'box');
      const id = newElementId();
      const base = {
        id,
        name: String(params.name ?? '').trim() || '临时对象',
        position: vecFromParams(params, 'position', { x: 0, y: 0, z: 0 }, [-100, 100]),
        rotationDeg: { x: 0, y: 0, z: 0 },
        scale: vecFromParams(params, 'scale', { x: 1, y: 1, z: 1 }, [0.05, 20]),
        color: '#9ca3af', visible: true, groupId: null,
      };
      let element: DirectorElement;
      if (rawKind === 'mannequin' || rawKind === 'animal') {
        element = { ...base, kind: 'mannequin', bodyType: rawKind === 'animal' ? 'animal' : 'person', animalSpecies: rawKind === 'animal' ? 'quadruped' : undefined, poseId: 'stand', joints: findPose('stand')?.joints ?? {}, heightM: rawKind === 'animal' ? 0.9 : 1.7, identitySource: 'temporary' };
      } else if (rawKind === 'crowd') {
        element = { ...base, kind: 'crowd', rows: 3, cols: 3, spacing: 0.8, poseId: 'stand' };
      } else {
        element = { ...base, kind: rawKind as Extract<ElementKind, 'box' | 'sphere' | 'cylinder' | 'wall'> };
      }
      state.addElement(element);
      return ok({ created_element_id: id, kind: element.kind, name: element.name, temporary: true });
    } catch (error) { return fail(error); }
  },
};

const upsertActionTool: Tool = {
  definition: {
    name: 'director_upsert_action',
    description: '新增或修改人物、动物或群演的动作片段。群演使用整体阵列的位置、朝向和路径，不使用人体关节。start_shot_frame 是镜头内帧，duration_frames 是动作长度；修改锁定动作必须有用户明确要求并传 override_locked=true。',
    parameters: {
      type: 'object',
      properties: {
        shot_id: { type: 'string' }, action_id: { type: 'string', description: '省略时新增动作。' }, element_id: { type: 'string' },
        action: { type: 'string', enum: actionValues }, start_shot_frame: { type: 'number' }, duration_frames: { type: 'number' },
        to_x: { type: 'number' }, to_y: { type: 'number' }, to_z: { type: 'number' },
        intensity: { type: 'number' }, locked: { type: 'boolean' }, override_locked: { type: 'boolean' },
      },
      required: ['shot_id', 'element_id', 'action'],
    },
  },
  risk: 'ask',
  async execute(params) {
    try {
      const { state, plan } = requireDirector();
      const shot = resolveShot(plan, params.shot_id);
      const element = state.elements.find((item) => item.id === String(params.element_id));
      if (!element || (element.kind !== 'mannequin' && element.kind !== 'crowd')) throw new Error('动作只能绑定到 director_get_state 返回的人物、动物或群演 ID');
      const template = motionTemplate(String(params.action) as DirectorActionId);
      const existing = params.action_id ? resolveAction(shot, params.action_id) : undefined;
      if (existing?.locked && params.override_locked !== true) throw new Error('该动作已被人工锁定；只有用户明确要求覆盖时才能传 override_locked=true');
      const stateAtShot = elementState(shot, element);
      const startSec = num(params.start_shot_frame, Math.round((existing?.startSec ?? 0) * FPS), 0, Math.max(0, Math.round(shot.durationSec * FPS) - 1)) / FPS;
      const durationSec = num(params.duration_frames, Math.round((existing?.durationSec ?? template.defaultDurationSec) * FPS), 1, Math.max(1, Math.round((shot.durationSec - startSec) * FPS))) / FPS;
      const from = existing?.from ?? stateAtShot.position;
      const suggested = template.moving ? (template.suggestedDistance ?? 1.5) : 0;
      const fallbackTo = existing?.to ?? { x: from.x, y: from.y, z: from.z - suggested };
      const to = vecFromParams(params, 'to', fallbackTo, [-100, 100]);
      const frames = createMotionKeyframes(template.id, durationSec, from, to, 'agent');
      if (existing) {
        const preservedLocked = (existing.keyframes ?? []).filter((frame) => frame.locked && params.override_locked !== true);
        const generated = frames.filter((frame) => !preservedLocked.some((locked) => Math.abs(locked.timeSec - frame.timeSec) < 1 / FPS));
        state.checkpoint();
        state.updateAction(shot.id, existing.id, { action: template.id, templateId: template.id, startSec, durationSec, from, to, intensity: num(params.intensity, existing.intensity ?? 1, 0.1, 3), locked: bool(params.locked, existing.locked ?? false), source: 'agent', keyframes: [...generated, ...preservedLocked].sort((a, b) => a.timeSec - b.timeSec) });
        return ok({ updated_action_id: existing.id, shot_id: shot.id, keyframe_count: generated.length + preservedLocked.length });
      }
      const id = state.addAction(shot.id, { elementId: element.id, action: template.id, startSec, durationSec, from, to, templateId: template.id, intensity: num(params.intensity, 1, 0.1, 3), locked: bool(params.locked, false), source: 'agent', keyframes: frames });
      return ok({ created_action_id: id, shot_id: shot.id, element_id: element.id, keyframe_count: frames.length });
    } catch (error) { return fail(error); }
  },
};

const motionKeyframeTool: Tool = {
  definition: {
    name: 'director_set_motion_keyframe',
    description: '在绝对工程帧新增或修改演员动作 K 帧，可写位置、旋转、缓动、曲线路径和手柄；单个人物还可写姿态，群演仅写整体阵列运动。默认不覆盖人工锁定关键帧。',
    parameters: {
      type: 'object',
      properties: {
        shot_id: { type: 'string' }, action_id: { type: 'string' }, keyframe_id: { type: 'string' }, project_frame: { type: 'number' },
        position_x: { type: 'number' }, position_y: { type: 'number' }, position_z: { type: 'number' },
        rotation_x: { type: 'number' }, rotation_y: { type: 'number' }, rotation_z: { type: 'number' },
        pose_id: { type: 'string' }, interpolation: { type: 'string', enum: interpolationValues }, path_mode: { type: 'string', enum: ['corner', 'smooth'] },
        path_in_x: { type: 'number' }, path_in_y: { type: 'number' }, path_in_z: { type: 'number' },
        path_out_x: { type: 'number' }, path_out_y: { type: 'number' }, path_out_z: { type: 'number' },
        locked: { type: 'boolean' }, override_locked: { type: 'boolean' }, note: { type: 'string' },
      },
      required: ['shot_id', 'action_id', 'project_frame'],
    },
  },
  risk: 'ask',
  async execute(params) {
    try {
      const { state, plan } = requireDirector();
      const shot = resolveShot(plan, params.shot_id);
      const action = resolveAction(shot, params.action_id);
      const projectSec = Math.round(num(params.project_frame, 0, 0, Math.round(planDuration(plan) * FPS))) / FPS;
      const timeSec = projectSec - shot.startSec - action.startSec;
      if (timeSec < -1 / FPS || timeSec > action.durationSec + 1 / FPS) throw new Error('project_frame 不在该动作片段范围内');
      const frames = [...(action.keyframes ?? [])];
      const existing = (params.keyframe_id ? frames.find((item) => item.id === String(params.keyframe_id)) : undefined)
        ?? frames.find((item) => Math.abs(item.timeSec - timeSec) < 1 / (FPS * 2));
      if (existing?.locked && params.override_locked !== true) throw new Error('该人物关键帧已被人工锁定，未覆盖');
      const evaluated = evaluateDirectorFrame(plan, state.elements, projectSec)?.elements.find((item) => item.id === action.elementId);
      const actor = state.elements.find((item) => item.id === action.elementId);
      const supportsPose = actor?.kind === 'mannequin';
      const fallbackPosition = existing?.position ?? evaluated?.position ?? action.from;
      const fallbackRotation = existing?.rotationDeg ?? evaluated?.rotationDeg ?? { x: 0, y: 0, z: 0 };
      const pose = supportsPose && params.pose_id ? findPose(String(params.pose_id)) : undefined;
      if (supportsPose && params.pose_id && !pose) throw new Error(`找不到姿态模板 ${String(params.pose_id)}`);
      const next: DirectorMotionKeyframe = {
        ...existing,
        id: existing?.id ?? `kf-${nanoid(7)}`,
        timeSec: Math.max(0, Math.min(action.durationSec, timeSec)),
        position: hasVecParams(params, 'position') ? vecFromParams(params, 'position', fallbackPosition, [-100, 100]) : fallbackPosition,
        rotationDeg: hasVecParams(params, 'rotation') ? vecFromParams(params, 'rotation', fallbackRotation, [-360, 360]) : fallbackRotation,
        joints: supportsPose ? pose?.joints ?? existing?.joints : undefined,
        interpolation: (params.interpolation as DirectorKeyframeInterpolation | undefined) ?? existing?.interpolation ?? 'smooth',
        pathMode: (params.path_mode as 'corner' | 'smooth' | undefined) ?? existing?.pathMode,
        pathIn: hasVecParams(params, 'path_in') ? vecFromParams(params, 'path_in', existing?.pathIn ?? { x: 0, y: 0, z: 0 }, [-100, 100]) : existing?.pathIn,
        pathOut: hasVecParams(params, 'path_out') ? vecFromParams(params, 'path_out', existing?.pathOut ?? { x: 0, y: 0, z: 0 }, [-100, 100]) : existing?.pathOut,
        locked: bool(params.locked, existing?.locked ?? false),
        source: 'agent',
        note: params.note !== undefined ? String(params.note) : existing?.note,
      };
      let updated = [...frames.filter((item) => item.id !== next.id && Math.abs(item.timeSec - next.timeSec) >= 1 / (FPS * 2)), next].sort((a, b) => a.timeSec - b.timeSec);
      if (params.path_mode === 'smooth' && !hasVecParams(params, 'path_in') && !hasVecParams(params, 'path_out')) updated = smoothPathFrame(updated, next.id);
      if (params.path_mode === 'corner') updated = cornerPathFrame(updated, next.id);
      state.checkpoint();
      state.updateAction(shot.id, action.id, { keyframes: updated, source: 'agent' });
      state.setCurrentTime(projectSec);
      state.setSelected([action.elementId]);
      return ok({ keyframe_id: next.id, action_id: action.id, project_frame: Math.round(projectSec * FPS), total_keyframes: updated.length, path_mode: params.path_mode ?? next.pathMode ?? 'corner' });
    } catch (error) { return fail(error); }
  },
};

const cameraKeyframeTool: Tool = {
  definition: {
    name: 'director_set_camera_keyframe',
    description: '在绝对工程帧新增或修改摄影机 K 帧，支持位置、注视点、FOV、滚转和缓动。默认不覆盖人工锁定关键帧。',
    parameters: {
      type: 'object',
      properties: {
        shot_id: { type: 'string' }, keyframe_id: { type: 'string' }, project_frame: { type: 'number' },
        position_x: { type: 'number' }, position_y: { type: 'number' }, position_z: { type: 'number' },
        target_x: { type: 'number' }, target_y: { type: 'number' }, target_z: { type: 'number' },
        fov: { type: 'number' }, roll_deg: { type: 'number' }, interpolation: { type: 'string', enum: interpolationValues },
        locked: { type: 'boolean' }, override_locked: { type: 'boolean' }, note: { type: 'string' },
      },
      required: ['shot_id', 'project_frame'],
    },
  },
  risk: 'ask',
  async execute(params) {
    try {
      const { state, plan } = requireDirector();
      const shot = resolveShot(plan, params.shot_id);
      const projectSec = Math.round(num(params.project_frame, 0, 0, Math.round(planDuration(plan) * FPS))) / FPS;
      const timeSec = projectSec - shot.startSec;
      if (timeSec < -1 / FPS || timeSec > shot.durationSec + 1 / FPS) throw new Error('project_frame 不在该镜头范围内');
      const frames = [...(shot.cameraKeyframes ?? [])];
      const existing = (params.keyframe_id ? frames.find((item) => item.id === String(params.keyframe_id)) : undefined)
        ?? frames.find((item) => Math.abs(item.timeSec - timeSec) < 1 / (FPS * 2));
      if (existing?.locked && params.override_locked !== true) throw new Error('该摄影机关键帧已被人工锁定，未覆盖');
      const evaluated = evaluateDirectorFrame(plan, state.elements, projectSec)?.camera;
      const next: DirectorCameraKeyframe = {
        ...existing,
        id: existing?.id ?? `ckf-${nanoid(7)}`,
        timeSec: Math.max(0, Math.min(shot.durationSec, timeSec)),
        position: vecFromParams(params, 'position', existing?.position ?? evaluated?.position ?? shot.position, [-100, 100]),
        target: vecFromParams(params, 'target', existing?.target ?? evaluated?.target ?? shot.target, [-100, 100]),
        fov: num(params.fov, existing?.fov ?? evaluated?.fov ?? shot.fov, 10, 100),
        rollDeg: num(params.roll_deg, existing?.rollDeg ?? evaluated?.rollDeg ?? shot.rollDeg ?? 0, -180, 180),
        interpolation: (params.interpolation as DirectorKeyframeInterpolation | undefined) ?? existing?.interpolation ?? 'smooth',
        locked: bool(params.locked, existing?.locked ?? false),
        source: 'agent',
        note: params.note !== undefined ? String(params.note) : existing?.note,
      };
      const updated = [...frames.filter((item) => item.id !== next.id && Math.abs(item.timeSec - next.timeSec) >= 1 / (FPS * 2)), next].sort((a, b) => a.timeSec - b.timeSec);
      state.checkpoint();
      state.updateShot(shot.id, { cameraKeyframes: updated });
      state.setCurrentTime(projectSec);
      return ok({ camera_keyframe_id: next.id, shot_id: shot.id, project_frame: Math.round(projectSec * FPS), total_keyframes: updated.length });
    } catch (error) { return fail(error); }
  },
};

const manageShotTool: Tool = {
  definition: {
    name: 'director_manage_shot',
    description: '新增、修改、复制顺序或删除镜头。update 可改名称、时长、运镜、景别和备注；删除必须是用户明确要求。',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['add', 'update', 'delete', 'reorder'] }, shot_id: { type: 'string' },
        name: { type: 'string' }, duration_frames: { type: 'number' }, camera_move: { type: 'string', enum: cameraMoveValues },
        shot_scale: { type: 'string', enum: ['extreme-wide', 'wide', 'medium', 'medium-close', 'close-up', 'extreme-close-up'] },
        notes: { type: 'string' }, target_index: { type: 'number' },
      },
      required: ['operation'],
    },
  },
  risk: 'ask',
  async execute(params) {
    try {
      const { state, plan } = requireDirector();
      const op = String(params.operation);
      if (op === 'add') {
        const id = state.addShot({ name: params.name ? String(params.name) : undefined, durationSec: num(params.duration_frames, 90, 6, 2400) / FPS, notes: params.notes ? String(params.notes) : undefined });
        return ok({ created_shot_id: id });
      }
      const shot = resolveShot(plan, params.shot_id);
      if (op === 'delete') {
        if (plan.shots.length <= 1) throw new Error('方案至少保留一个镜头');
        state.removeShot(shot.id);
        return ok({ deleted_shot_id: shot.id });
      }
      if (op === 'reorder') {
        state.reorderShot(shot.id, Math.round(num(params.target_index, 0, 0, plan.shots.length - 1)));
        return ok({ reordered_shot_id: shot.id, target_index: params.target_index });
      }
      if (op === 'update') {
        const patch: Partial<DirectorSequenceShot> = {};
        if (params.name !== undefined) patch.name = String(params.name);
        if (params.duration_frames !== undefined) patch.durationSec = num(params.duration_frames, shot.durationSec * FPS, 6, 2400) / FPS;
        if (params.camera_move !== undefined) {
          const move = params.camera_move as DirectorSequenceShot['cameraMove'];
          const generated = cameraPatchFromTemplate({ ...shot, durationSec: patch.durationSec ?? shot.durationSec }, move);
          const lockedFrames = (shot.cameraKeyframes ?? []).filter((frame) => frame.locked);
          patch.cameraMove = move;
          patch.cameraEnd = generated.cameraEnd;
          patch.cameraKeyframes = [
            ...(generated.cameraKeyframes ?? []).filter((candidate) => !lockedFrames.some((locked) => Math.abs(locked.timeSec - candidate.timeSec) < 1 / FPS)),
            ...lockedFrames,
          ].sort((left, right) => left.timeSec - right.timeSec);
        }
        if (params.shot_scale !== undefined) patch.shotScale = params.shot_scale as DirectorSequenceShot['shotScale'];
        if (params.notes !== undefined) patch.notes = String(params.notes);
        if (!Object.keys(patch).length) throw new Error('没有提供镜头修改参数');
        state.checkpoint();
        state.updateShot(shot.id, patch);
        return ok({ updated_shot_id: shot.id, patch });
      }
      throw new Error(`不支持的镜头操作 ${op}`);
    } catch (error) { return fail(error); }
  },
};

const managePlanTool: Tool = {
  definition: {
    name: 'director_manage_plan',
    description: '管理导演方案：切换、重命名、复制或删除。切换不会修改内容；删除至少保留一个方案。',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['switch', 'rename', 'duplicate', 'delete'] },
        plan_id: { type: 'string' }, name: { type: 'string' }, summary: { type: 'string' },
      },
      required: ['operation', 'plan_id'],
    },
  },
  checkRisk(params) {
    return params.operation === 'switch' ? { risk: 'safe' } : { risk: 'ask', reason: '将修改导演方案结构' };
  },
  async execute(params) {
    try {
      const { state } = requireDirector();
      const id = String(params.plan_id ?? '');
      const plan = state.plans.find((item) => item.id === id);
      if (!plan) throw new Error(`找不到方案 ${id}`);
      const operation = String(params.operation ?? '');
      if (operation === 'switch') state.setActivePlan(id);
      else if (operation === 'rename') {
        if (!String(params.name ?? '').trim() && params.summary === undefined) throw new Error('需要提供方案名称或摘要');
        state.checkpoint();
        state.updatePlan(id, { ...(String(params.name ?? '').trim() ? { name: String(params.name).trim() } : {}), ...(params.summary !== undefined ? { summary: String(params.summary) } : {}) });
      } else if (operation === 'duplicate') {
        const created = state.duplicatePlan(id);
        if (!created) throw new Error('复制方案失败');
        return ok({ duplicated_from: id, created_plan_id: created });
      } else if (operation === 'delete') {
        if (state.plans.length <= 1) throw new Error('导演台至少保留一个方案');
        state.removePlan(id);
      } else throw new Error(`不支持的方案操作 ${operation}`);
      return ok({ operation, plan_id: id, active_plan_id: useDirectorStore.getState().activePlanId });
    } catch (error) { return fail(error); }
  },
};

const projectControlTool: Tool = {
  definition: {
    name: 'director_project_control',
    description: '切换同一工坊项目的分镜白模/动作预演，手动重新识别分镜图，或修复白模可见性。切换前会保存当前工程；重新识别可能调用视觉模型，必须由用户确认。',
    parameters: {
      type: 'object',
      properties: {
        operation: { type: 'string', enum: ['switch_shot', 'recognize_storyboard', 'repair_scene'] },
        shot_no: { type: 'string' }, mode: { type: 'string', enum: ['storyboard', 'video-prompt'] },
      },
      required: ['operation'],
    },
  },
  checkRisk(params) {
    return params.operation === 'repair_scene' ? { risk: 'safe' } : { risk: 'ask', reason: params.operation === 'recognize_storyboard' ? '将重新调用视觉识别' : '将保存当前导演工程并切换分镜' };
  },
  async execute(params) {
    try {
      requireDirector();
      const operation = String(params.operation ?? '');
      if (operation === 'switch_shot') {
        const shotNo = String(params.shot_no ?? '');
        const mode = params.mode === 'storyboard' ? 'storyboard' : 'video-prompt';
        const exists = useWorkshopStore.getState().data?.shots.some((item) => item.shotNo === shotNo);
        if (!exists) throw new Error(`当前项目找不到分镜 ${shotNo}`);
        dispatchDirectorRuntimeCommand({ type: 'switch-workshop-shot', shotNo, mode });
        return ok({ switching_to: shotNo, mode, asynchronous: true });
      }
      if (operation === 'recognize_storyboard') {
        dispatchDirectorRuntimeCommand({ type: 'recognize-storyboard' });
        return ok({ recognition_started: true, asynchronous: true });
      }
      if (operation === 'repair_scene') {
        dispatchDirectorRuntimeCommand({ type: 'repair-scene' });
        return ok({ repair_started: true });
      }
      throw new Error(`不支持的工程操作 ${operation}`);
    } catch (error) { return fail(error); }
  },
};

const lockTool: Tool = {
  definition: {
    name: 'director_set_lock',
    description: '锁定或解锁动作、人物 K 帧、摄影机 K 帧。锁定表示后续 Agent 不得修改；解锁必须由用户明确要求。',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['action', 'motion_keyframe', 'camera_keyframe'] }, shot_id: { type: 'string' },
        action_id: { type: 'string' }, keyframe_id: { type: 'string' }, locked: { type: 'boolean' },
      },
      required: ['target', 'shot_id', 'locked'],
    },
  },
  risk: 'ask',
  async execute(params) {
    try {
      const { state, plan } = requireDirector();
      const shot = resolveShot(plan, params.shot_id);
      const locked = bool(params.locked, true);
      if (params.target === 'action') {
        const action = resolveAction(shot, params.action_id);
        state.checkpoint(); state.updateAction(shot.id, action.id, { locked });
      } else if (params.target === 'motion_keyframe') {
        const action = resolveAction(shot, params.action_id);
        const id = String(params.keyframe_id ?? '');
        if (!(action.keyframes ?? []).some((item) => item.id === id)) throw new Error(`找不到人物关键帧 ${id}`);
        state.checkpoint(); state.updateAction(shot.id, action.id, { keyframes: action.keyframes?.map((item) => item.id === id ? { ...item, locked } : item) });
      } else if (params.target === 'camera_keyframe') {
        const id = String(params.keyframe_id ?? '');
        if (!(shot.cameraKeyframes ?? []).some((item) => item.id === id)) throw new Error(`找不到摄影机关键帧 ${id}`);
        state.checkpoint(); state.updateShot(shot.id, { cameraKeyframes: shot.cameraKeyframes?.map((item) => item.id === id ? { ...item, locked } : item) });
      } else throw new Error('不支持的锁定目标');
      return ok({ target: params.target, locked });
    } catch (error) { return fail(error); }
  },
};

const deleteTool: Tool = {
  definition: {
    name: 'director_delete',
    description: '删除动作、人物 K 帧、摄影机 K 帧或临时对象。仅在用户明确说删除时调用；锁定内容默认拒绝删除。',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['action', 'motion_keyframe', 'camera_keyframe', 'element'] }, shot_id: { type: 'string' },
        action_id: { type: 'string' }, keyframe_id: { type: 'string' }, element_id: { type: 'string' }, override_locked: { type: 'boolean' },
      },
      required: ['target'],
    },
  },
  risk: 'ask',
  async execute(params) {
    try {
      const { state, plan } = requireDirector();
      if (params.target === 'element') {
        const id = String(params.element_id ?? '');
        const element = state.elements.find((item) => item.id === id);
        if (!element) throw new Error(`找不到对象 ${id}`);
        state.removeElements([id]);
        return ok({ deleted_element_id: id });
      }
      const shot = resolveShot(plan, params.shot_id);
      if (params.target === 'action') {
        const action = resolveAction(shot, params.action_id);
        if (action.locked && params.override_locked !== true) throw new Error('动作已锁定，未删除');
        state.removeAction(shot.id, action.id);
        return ok({ deleted_action_id: action.id });
      }
      if (params.target === 'motion_keyframe') {
        const action = resolveAction(shot, params.action_id);
        const id = String(params.keyframe_id ?? '');
        const frame = action.keyframes?.find((item) => item.id === id);
        if (!frame) throw new Error(`找不到人物关键帧 ${id}`);
        if (frame.locked && params.override_locked !== true) throw new Error('人物关键帧已锁定，未删除');
        state.checkpoint(); state.updateAction(shot.id, action.id, { keyframes: action.keyframes?.filter((item) => item.id !== id) });
        return ok({ deleted_motion_keyframe_id: id });
      }
      if (params.target === 'camera_keyframe') {
        const id = String(params.keyframe_id ?? '');
        const frame = shot.cameraKeyframes?.find((item) => item.id === id);
        if (!frame) throw new Error(`找不到摄影机关键帧 ${id}`);
        if (frame.locked && params.override_locked !== true) throw new Error('摄影机关键帧已锁定，未删除');
        state.checkpoint(); state.updateShot(shot.id, { cameraKeyframes: shot.cameraKeyframes?.filter((item) => item.id !== id) });
        return ok({ deleted_camera_keyframe_id: id });
      }
      throw new Error('不支持的删除目标');
    } catch (error) { return fail(error); }
  },
};

const prepareExportTool: Tool = {
  definition: {
    name: 'director_prepare_export',
    description: '设置导出工作区并打开导出面板，但不会开始导出。用户必须在界面检查范围和保存位置后手动点击导出。',
    parameters: {
      type: 'object',
      properties: {
        in_frame: { type: 'number' }, out_frame: { type: 'number' }, output_path: { type: 'string', description: '可选的绝对 .mp4 路径。' },
      },
      required: ['in_frame', 'out_frame'],
    },
  },
  risk: 'safe',
  async execute(params) {
    try {
      const { plan } = requireDirector();
      const max = Math.round(planDuration(plan) * FPS);
      const inFrame = Math.round(num(params.in_frame, 0, 0, Math.max(0, max - 1)));
      const outFrame = Math.round(num(params.out_frame, max, inFrame + 1, max));
      dispatchDirectorRuntimeCommand({ type: 'set-export-range', inSec: inFrame / FPS, outSec: outFrame / FPS });
      if (params.output_path !== undefined) dispatchDirectorRuntimeCommand({ type: 'set-output-path', path: String(params.output_path) });
      dispatchDirectorRuntimeCommand({ type: 'open-panel', panel: 'export' });
      return ok({ prepared: true, in_frame: inFrame, out_frame: outFrame, requires_manual_export_confirmation: true, next: '请用户在右侧导出面板检查并点击导出。' });
    } catch (error) { return fail(error); }
  },
};

const proposePlansTool: Tool = {
  definition: {
    name: 'director_propose_plans',
    description: '基于当前白模工程提出 2 至 3 套候选导演方案，只生成候选，不写入工程。返回 proposal_id 后必须展示给用户确认。',
    parameters: { type: 'object', properties: { instruction: { type: 'string' } }, required: ['instruction'] },
  },
  risk: 'safe',
  async execute(params) {
    try {
      const { state, plan } = requireDirector();
      const plans = await generateDirectorPlanProposals(state.origin, plan, state.elements, String(params.instruction ?? ''));
      const proposalId = `director-proposal-${nanoid(8)}`;
      pendingProposals.set(proposalId, { plans, createdAt: Date.now() });
      for (const [id, proposal] of pendingProposals) if (Date.now() - proposal.createdAt > 30 * 60_000) pendingProposals.delete(id);
      return ok({ proposal_id: proposalId, requires_user_confirmation: true, plans: plans.map((item) => ({ name: item.name, summary: item.summary, duration_sec: planDuration(item), shots: item.shots.map((shot) => ({ name: shot.name, duration_sec: shot.durationSec, camera_move: shot.cameraMove, actions: shot.actions.length })) })) });
    } catch (error) { return fail(error); }
  },
};

const applyProposalTool: Tool = {
  definition: {
    name: 'director_apply_proposal',
    description: '把用户已明确选择的候选方案写入白模工程。会替换方案列表，可撤销；没有确认时严禁调用。',
    parameters: { type: 'object', properties: { proposal_id: { type: 'string' } }, required: ['proposal_id'] },
  },
  risk: 'ask',
  async execute(params) {
    try {
      requireDirector();
      const proposalId = String(params.proposal_id ?? '');
      const proposal = pendingProposals.get(proposalId);
      if (!proposal) throw new Error('候选方案不存在或已过期，请重新生成');
      useDirectorStore.getState().replacePlans(proposal.plans);
      pendingProposals.delete(proposalId);
      return ok({ applied: proposal.plans.length, undo_available: true });
    } catch (error) { return fail(error); }
  },
};

export const allDirectorTools: Tool[] = [
  getStateTool,
  transportTool,
  selectTool,
  updateElementTool,
  createElementTool,
  upsertActionTool,
  motionKeyframeTool,
  cameraKeyframeTool,
  manageShotTool,
  managePlanTool,
  projectControlTool,
  lockTool,
  deleteTool,
  prepareExportTool,
  proposePlansTool,
  applyProposalTool,
];
