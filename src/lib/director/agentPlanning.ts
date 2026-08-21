import { nanoid } from 'nanoid';
import { quickChat } from '@/lib/agent/quickChat';
import type {
  DirectorActionId,
  DirectorActionClip,
  DirectorCameraMove,
  DirectorElement,
  DirectorOrigin,
  DirectorPlan,
  DirectorSequenceShot,
  DirectorShotScale,
  Vec3,
} from './types';
import { createMotionKeyframes, MOTION_TEMPLATES } from './motionTemplates';
import { cameraPatchFromTemplate, CAMERA_TEMPLATES } from './cameraTemplates';

interface RawAction {
  elementName?: string;
  action?: DirectorActionId;
  startSec?: number;
  durationSec?: number;
  moveX?: number;
  moveZ?: number;
}

interface RawShot {
  name?: string;
  primaryElementName?: string;
  durationSec?: number;
  cameraMove?: DirectorCameraMove;
  shotScale?: DirectorShotScale;
  cameraYawDeg?: number;
  cameraPitchDeg?: number;
  focalLengthMm?: number;
  actions?: RawAction[];
}

interface RawPlan { name?: string; summary?: string; shots?: RawShot[] }

export interface DirectorConsultMessage {
  role: 'user' | 'assistant';
  content: string;
}

export type DirectorAgentCommand =
  | { type: 'repair_visibility' }
  | { type: 'focus_people' }
  | { type: 'select_person'; name: string }
  | { type: 'set_camera_move'; shotId?: string; move: DirectorCameraMove }
  | { type: 'apply_camera_template'; shotId?: string; templateId: DirectorCameraMove }
  | { type: 'set_active_plan'; planId: string }
  | { type: 'rename_plan'; planId: string; name: string }
  | { type: 'add_plan'; name?: string }
  | { type: 'duplicate_plan'; planId: string }
  | { type: 'delete_plan'; planId: string }
  | { type: 'set_active_shot'; shotId: string }
  | { type: 'add_shot'; name?: string; durationSec?: number }
  | { type: 'delete_shot'; shotId: string }
  | { type: 'reorder_shot'; shotId: string; targetIndex: number }
  | { type: 'update_shot'; shotId?: string; name?: string; durationSec?: number; cameraMove?: DirectorCameraMove }
  | { type: 'add_action'; shotId?: string; personId?: string; personName?: string; action: DirectorActionId; startSec?: number; durationSec?: number; moveX?: number; moveZ?: number }
  | { type: 'apply_motion_template'; shotId?: string; personId?: string; personName?: string; templateId: DirectorActionId; startSec?: number; durationSec?: number; moveX?: number; moveZ?: number; locked?: boolean }
  | { type: 'update_action'; shotId: string; actionId: string; startSec?: number; durationSec?: number; moveX?: number; moveZ?: number }
  | { type: 'lock_action'; shotId: string; actionId: string; locked: boolean }
  | { type: 'set_action_keyframe'; shotId: string; actionId: string; timeSec: number; poseId?: string; position?: Vec3; rotationDeg?: Vec3; interpolation?: 'hold' | 'linear' | 'smooth' | 'ease-in' | 'ease-out' }
  | { type: 'delete_action_keyframe'; shotId: string; actionId: string; keyframeId: string }
  | { type: 'delete_action'; shotId: string; actionId: string }
  | { type: 'move_person'; shotId?: string; personId?: string; personName?: string; x: number; y?: number; z: number }
  | { type: 'rotate_person'; shotId?: string; personId?: string; personName?: string; yawDeg: number }
  | { type: 'set_visibility'; shotId?: string; personId?: string; personName?: string; visible: boolean }
  | { type: 'select_element'; elementId: string }
  | { type: 'rename_element'; elementId: string; name: string }
  | { type: 'move_element'; shotId?: string; elementId: string; x: number; y?: number; z: number }
  | { type: 'rotate_element'; shotId?: string; elementId: string; yawDeg: number }
  | { type: 'set_element_visibility'; shotId?: string; elementId: string; visible: boolean }
  | { type: 'add_proxy'; kind: 'box' | 'wall' | 'cylinder'; name?: string; x?: number; y?: number; z?: number }
  | { type: 'duplicate_element'; elementId: string }
  | { type: 'delete_element'; elementId: string }
  | { type: 'set_camera'; shotId?: string; position: Vec3; target: Vec3; fov?: number }
  | { type: 'set_camera_keyframe'; shotId?: string; timeSec: number; position: Vec3; target: Vec3; fov?: number; rollDeg?: number; interpolation?: 'hold' | 'linear' | 'smooth' | 'ease-in' | 'ease-out' }
  | { type: 'delete_camera_keyframe'; shotId: string; keyframeId: string }
  | { type: 'inspect_frame'; timeSec: number }
  | { type: 'play' }
  | { type: 'pause' }
  | { type: 'seek'; timeSec: number }
  | { type: 'save' }
  | { type: 'undo' }
  | { type: 'redo' }
  | { type: 'switch_workshop_shot'; shotNo: string; mode: 'storyboard' | 'video-prompt' };

const CAMERA_MOVES = new Set<DirectorCameraMove>([
  'static', 'push', 'pull', 'truck-left', 'truck-right', 'crane-up', 'crane-down',
  'pan-left', 'pan-right', 'tilt-up', 'tilt-down', 'orbit', 'arc-left', 'arc-right',
  'follow', 'tracking', 'steadicam', 'handheld', 'handheld-intense', 'jib-up', 'jib-down',
  'zoom-in', 'zoom-out', 'dolly-zoom', 'whip-pan-left', 'whip-pan-right', 'roll-left', 'roll-right',
]);

const ACTIONS = new Set<DirectorActionId>([
  'stand', 'wait', 'walk', 'fast-walk', 'run', 'stop', 'sit', 'stand-up', 'turn',
  'look-back', 'crouch', 'kneel', 'lie-down', 'raise-hand', 'wave', 'point', 'pick-up',
  'put-down', 'push', 'pull', 'open-door', 'close-door', 'hug', 'face-to-face', 'pass-by',
  'follow', 'dodge', 'fall', 'get-up', 'enter-car', 'exit-car',
  'sew', 'read', 'write', 'speak', 'nod', 'shake-head', 'look-up', 'look-down', 'look-at', 'reach', 'hold',
  'idle-breathe', 'listen', 'hesitate', 'bow', 'cross-arms', 'hands-on-hips', 'clap', 'drink', 'phone',
  'hand-over', 'receive', 'step-back', 'step-forward', 'glance', 'inspect', 'knock',
]);

const ACTION_KEYWORDS: Array<{ action: DirectorActionId; pattern: RegExp }> = [
  { action: 'sew', pattern: /走针|落针|缝制|缝纫|刺绣|针线|针尖.*布料|穿刺布料|针穿|丝线绷紧/ },
  { action: 'read', pattern: /阅读|展卷|看卷|竹简上读|读它们|山海图.*(?:读|看)/ },
  { action: 'write', pattern: /书写|写字|记录|落笔/ },
  { action: 'look-up', pattern: /抬眼|抬头|仰头/ },
  { action: 'look-down', pattern: /低头|垂眼|俯视/ },
  { action: 'look-at', pattern: /看向|注视|凝视|望向|目光.*移|盯着/ },
  { action: 'look-back', pattern: /回头|回望/ },
  { action: 'turn', pattern: /转身|转向/ },
  { action: 'open-door', pattern: /开门|推门而入/ },
  { action: 'close-door', pattern: /关门/ },
  { action: 'stand-up', pattern: /起身|站起/ },
  { action: 'stop', pattern: /停下|顿住|停顿|悬停|静止/ },
  { action: 'sit', pattern: /坐下|落座/ },
  { action: 'run', pattern: /跑|冲|逃/ },
  { action: 'fast-walk', pattern: /快走|疾走/ },
  { action: 'walk', pattern: /走进|走向|走到|进入|离开|步行/ },
  { action: 'reach', pattern: /伸手|探手|手伸向|靠近.*手/ },
  { action: 'point', pattern: /指向|指着|手指.*滑动|划过/ },
  { action: 'pick-up', pattern: /拿起|拾起|捡起/ },
  { action: 'put-down', pattern: /放下|搁下/ },
  { action: 'hold', pattern: /握住|托住|捧着|拿着|握紧/ },
  { action: 'nod', pattern: /点头/ },
  { action: 'shake-head', pattern: /摇头/ },
  { action: 'wave', pattern: /挥手|招手/ },
  { action: 'raise-hand', pattern: /举手|抬手/ },
  { action: 'hug', pattern: /拥抱|抱住/ },
  { action: 'face-to-face', pattern: /对视|面对面/ },
  { action: 'kneel', pattern: /跪下|跪地/ },
  { action: 'crouch', pattern: /蹲下|俯身/ },
  { action: 'fall', pattern: /跌倒|摔倒|倒地/ },
  { action: 'speak', pattern: /说[：{]|回答|开口|台词|问道/ },
];

const ACTION_PRIORITY: Partial<Record<DirectorActionId, number>> = {
  sew: 100, read: 100, write: 100, speak: 95,
  walk: 90, 'fast-walk': 90, run: 90, 'open-door': 90, 'close-door': 90,
  'pick-up': 85, 'put-down': 85, reach: 85, hold: 85, point: 85,
  'look-up': 70, 'look-down': 70, 'look-at': 70, 'look-back': 70,
};

const SHOT_SCALES = new Set<DirectorShotScale>(['extreme-wide', 'wide', 'medium', 'medium-close', 'close-up', 'extreme-close-up']);

function applyRawCamera(shot: DirectorSequenceShot, raw: RawShot, elements: DirectorElement[]): DirectorSequenceShot {
  if (!SHOT_SCALES.has(raw.shotScale as DirectorShotScale) && raw.cameraYawDeg === undefined && raw.cameraPitchDeg === undefined) return shot;
  const scale = SHOT_SCALES.has(raw.shotScale as DirectorShotScale) ? raw.shotScale! : shot.shotScale ?? 'medium';
  const settings = ({
    'extreme-wide': { distance: 12, focal: 24, targetY: 0.9 }, wide: { distance: 7.5, focal: 35, targetY: 0.95 },
    medium: { distance: 4.8, focal: 50, targetY: 1.05 }, 'medium-close': { distance: 3.3, focal: 65, targetY: 1.2 },
    'close-up': { distance: 2.05, focal: 85, targetY: 1.43 }, 'extreme-close-up': { distance: 1.25, focal: 105, targetY: 1.53 },
  } as const)[scale];
  const primary = elements.find((element) => element.kind === 'mannequin' && raw.primaryElementName && (element.name === raw.primaryElementName || raw.primaryElementName.includes(element.name) || element.name.includes(raw.primaryElementName)))
    ?? elements.find((element) => element.kind === 'mannequin');
  const primaryPosition = primary ? shot.elementStates[primary.id]?.position ?? primary.position : { x: 0, y: 0, z: 0 };
  const target = { x: primaryPosition.x, y: settings.targetY, z: primaryPosition.z };
  const yawDeg = Math.max(-180, Math.min(180, Number(raw.cameraYawDeg) || 0));
  const pitchDeg = Math.max(-45, Math.min(75, Number(raw.cameraPitchDeg) || 0));
  const yaw = yawDeg * Math.PI / 180;
  const pitch = pitchDeg * Math.PI / 180;
  const horizontal = settings.distance * Math.cos(pitch);
  const position = { x: target.x + Math.sin(yaw) * horizontal, y: Math.max(0.35, target.y + Math.sin(pitch) * settings.distance), z: target.z + Math.cos(yaw) * horizontal };
  const focal = Math.max(18, Math.min(135, Number(raw.focalLengthMm) || settings.focal));
  const fov = (2 * Math.atan(24 / (2 * focal)) * 180) / Math.PI;
  return { ...shot, position, target, fov, focalLengthMm: focal, shotScale: scale, primaryElementId: primary?.id, recognition: { version: 2, confidence: 0.7, cameraYawDeg: yawDeg, cameraPitchDeg: pitchDeg } };
}

function parseJson(text: string): { plans?: RawPlan[] } {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(source) as { plans?: RawPlan[] };
}

function promptShotSections(prompt: string): string[] {
  const matches = [...prompt.matchAll(/(?:^|\n)(镜头[^\n]*)([\s\S]*?)(?=\n镜头|\n\{|$)/g)];
  return matches.map((match) => `${match[1]}\n${match[2]}`.trim());
}

function alignRawPlanToPrompt(rawPlan: RawPlan, prompt: string): RawPlan {
  const sections = promptShotSections(prompt);
  if (sections.length === 0) return rawPlan;
  return {
    ...rawPlan,
    shots: sections.map((section, index) => {
      const sourceDuration = Number(section.match(/^镜头[^\n]*?\s(\d+(?:\.\d+)?)s\b/i)?.[1]);
      const sourceScale: DirectorShotScale | undefined = /微距|极近|大特写/.test(section) ? 'extreme-close-up'
        : /特写/.test(section) ? 'close-up'
          : /中近景/.test(section) ? 'medium-close'
            : /近景/.test(section) ? 'close-up'
              : /中景/.test(section) ? 'medium'
                : /远景|大全景/.test(section) ? 'extreme-wide'
                  : /全景/.test(section) ? 'wide' : undefined;
      const sourceMove: DirectorCameraMove | undefined = /前推|推近|推进/.test(section) ? 'push'
        : /拉远|后拉|缓拉/.test(section) ? 'pull'
          : /环绕/.test(section) ? 'orbit'
            : /跟随|跟拍/.test(section) ? 'follow'
              : /手持|肩扛/.test(section) ? 'handheld'
                : /固定/.test(section) ? 'static' : undefined;
      return {
        ...(rawPlan.shots?.[index] ?? {}),
        name: section.match(/^(镜头\S+)/)?.[1] ?? rawPlan.shots?.[index]?.name,
        durationSec: Number.isFinite(sourceDuration) ? sourceDuration : rawPlan.shots?.[index]?.durationSec,
        shotScale: sourceScale ?? rawPlan.shots?.[index]?.shotScale,
        cameraMove: sourceMove ?? rawPlan.shots?.[index]?.cameraMove,
      };
    }),
  };
}

function inferSectionActions(section: string, elements: DirectorElement[]): RawAction[] {
  const people = elements.filter((element) => element.kind === 'mannequin');
  const clauses = section.split(/[。！？；，,、\n]|——/).map((item) => item.trim()).filter(Boolean);
  const inferred: RawAction[] = [];
  // The first named person is normally the shot subject. Later names may only
  // describe an eyeline target or a foreground occluder, so they must not take
  // over the subject unless that same clause gives them an action.
  let activePerson = people.find((person) => section.indexOf(person.name) >= 0);
  for (const clause of clauses) {
    const matched = ACTION_KEYWORDS
      .map((rule) => ({ rule, index: clause.search(rule.pattern) }))
      .filter((item) => item.index >= 0)
      .sort((left, right) => (ACTION_PRIORITY[right.rule.action] ?? 80) - (ACTION_PRIORITY[left.rule.action] ?? 80) || left.index - right.index)[0];
    const mentions = people.map((person) => ({ person, index: clause.indexOf(person.name) })).filter((item) => item.index >= 0).sort((left, right) => left.index - right.index);
    if (!matched) continue;
    const subjectsBeforeAction = mentions.filter((item) => item.index <= matched.index).sort((left, right) => right.index - left.index);
    const person = subjectsBeforeAction[0]?.person ?? activePerson ?? mentions[0]?.person;
    if (!person) continue;
    activePerson = person;
    if (inferred.some((action) => action.elementName === person.name && action.action === matched.rule.action)) continue;
    const moving = ['walk', 'fast-walk', 'run', 'follow', 'pass-by', 'dodge'].includes(matched.rule.action);
    inferred.push({ elementName: person.name, action: matched.rule.action, startSec: Math.min(0.15 + inferred.length * 0.85, 3), durationSec: moving ? 2.4 : 1.5, moveX: moving ? 1.8 : 0, moveZ: 0 });
  }
  return inferred.slice(0, 5);
}

export function inferPromptActionsByShot(prompt: string, elements: DirectorElement[], shotCount: number): RawAction[][] {
  const sections = promptShotSections(prompt);
  if (sections.length > 0) return Array.from({ length: shotCount }, (_, index) => inferSectionActions(sections[index] ?? '', elements));
  const flat = inferSectionActions(prompt, elements);
  return Array.from({ length: shotCount }, (_, index) => flat[index] ? [flat[index]] : []);
}

export function inferPromptActions(prompt: string, elements: DirectorElement[]): RawAction[] {
  const sections = promptShotSections(prompt);
  return inferPromptActionsByShot(prompt, elements, Math.max(1, sections.length)).flat();
}

function ensurePlanActions(rawPlan: RawPlan, prompt: string, elements: DirectorElement[]): RawPlan {
  const hintsByShot = inferPromptActionsByShot(prompt, elements, Math.max(1, rawPlan.shots?.length ?? 0));
  const needsMeaningfulAction = promptImpliesCharacterAction(prompt);
  const validPersonName = (name?: string) => Boolean(name && elements.some((element) => element.kind === 'mannequin' && (name === element.name || name.includes(element.name) || element.name.includes(name))));
  return {
    ...rawPlan,
    shots: (rawPlan.shots ?? []).map((shot, index) => {
      const validActions = (shot.actions ?? []).filter((action) => ACTIONS.has(action.action as DirectorActionId) && validPersonName(action.elementName) && (!needsMeaningfulAction || (action.action !== 'stand' && action.action !== 'wait')));
      const sourceActions = hintsByShot[index] ?? [];
      const sourceMatches = sourceActions.filter((expected) => validActions.some((actual) => actual.action === expected.action && actual.elementName && expected.elementName && (actual.elementName === expected.elementName || actual.elementName.includes(expected.elementName) || expected.elementName.includes(actual.elementName))));
      const sourceCoverage = sourceActions.length > 0 ? sourceMatches.length / sourceActions.length : 1;
      const actions = sourceActions.length > 0 && sourceCoverage < 0.6 ? sourceActions : validActions;
      return {
        ...shot,
        primaryElementName: sourceActions[0]?.elementName ?? shot.primaryElementName,
        actions: actions.map((action) => ({ ...action, durationSec: Math.min(action.durationSec ?? 1.8, Math.max(0.5, Number(shot.durationSec) || 2)) })),
      };
    }),
  };
}

export function promptImpliesCharacterAction(prompt: string): boolean {
  return ACTION_KEYWORDS.some((rule) => rule.pattern.test(prompt));
}

function buildPlans(rawPlans: RawPlan[], base: DirectorPlan, elements: DirectorElement[]): DirectorPlan[] {
  return rawPlans.slice(0, 3).map((rawPlan, planIndex) => {
    let cursor = 0;
    const currentPositions = new Map(elements.map((element) => [element.id, { ...element.position }]));
    const shots = base.shots.map((baseShot, shotIndex) => {
      const raw = rawPlan.shots?.[shotIndex] ?? {};
      const durationSec = Math.max(0.5, Number(raw.durationSec) || baseShot.durationSec);
      const cameraMove = CAMERA_MOVES.has(raw.cameraMove as DirectorCameraMove) ? raw.cameraMove! : baseShot.cameraMove;
      const shotStartPositions = new Map([...currentPositions].map(([id, position]) => [id, { ...position }]));
      const workingPositions = new Map([...currentPositions].map(([id, position]) => [id, { ...position }]));
      let actions = (raw.actions ?? []).flatMap((item) => {
        const rawName = item.elementName?.trim() ?? '';
        const element = (rawName ? elements.find((candidate) => candidate.kind === 'mannequin' && (candidate.name === rawName || rawName.includes(candidate.name) || candidate.name.includes(rawName))) : undefined)
          ?? (elements.filter((candidate) => candidate.kind === 'mannequin').length === 1 ? elements.find((candidate) => candidate.kind === 'mannequin') : undefined);
        if (!element || !ACTIONS.has(item.action as DirectorActionId)) return [];
        const state = baseShot.elementStates[element.id];
        const from = { ...(workingPositions.get(element.id) ?? state?.position ?? element.position) };
        const action: DirectorActionClip = {
          id: `act-${nanoid(7)}`,
          elementId: element.id,
          action: item.action!,
          startSec: Math.max(0, Math.min(durationSec - 0.1, Number(item.startSec) || 0)),
          durationSec: Math.max(0.2, Math.min(durationSec, Number(item.durationSec) || Math.min(2.5, durationSec))),
          from,
          to: { x: from.x + (Number(item.moveX) || 0), y: from.y, z: from.z + (Number(item.moveZ) || 0) },
          templateId: item.action!,
          source: 'agent' as const,
          intensity: 1,
          keyframes: [],
        };
        action.keyframes = createMotionKeyframes(action.action, action.durationSec, action.from, action.to, 'agent');
        workingPositions.set(element.id, { ...action.to });
        return [action];
      });
      for (const element of elements) {
        let actionCursor = 0;
        actions.filter((action) => action.elementId === element.id).sort((a, b) => a.startSec - b.startSec).forEach((action) => {
          action.startSec = Math.max(action.startSec, actionCursor);
          action.durationSec = Math.min(action.durationSec, Math.max(0, durationSec - action.startSec));
          actionCursor = action.startSec + action.durationSec;
        });
      }
      actions = actions.filter((action) => action.startSec < durationSec - 0.05 && action.durationSec >= 0.15);
      const elementStates = Object.fromEntries(Object.entries(baseShot.elementStates).map(([id, state]) => [id, { ...state, position: { ...(shotStartPositions.get(id) ?? state.position) } }]));
      let shot: DirectorSequenceShot = {
        ...structuredClone(baseShot),
        id: `shot-${nanoid(7)}`,
        name: raw.name?.trim() || baseShot.name,
        startSec: cursor,
        durationSec,
        cameraMove,
        actions,
        elementStates,
      };
      shot = applyRawCamera(shot, raw, elements);
      workingPositions.forEach((position, id) => currentPositions.set(id, { ...position }));
      shot = { ...shot, ...cameraPatchFromTemplate(shot, cameraMove) };
      cursor += durationSec;
      return shot;
    });
    return {
      id: `plan-${nanoid(7)}`,
      name: rawPlan.name?.trim() || ['克制观察', '压迫跟随', '运动调度'][planIndex],
      summary: rawPlan.summary?.trim() || `${cursor.toFixed(1)} 秒 · ${shots.length} 镜`,
      createdAt: Date.now(),
      shots,
    };
  });
}

function preserveLockedEdits(generated: DirectorPlan[], base: DirectorPlan): DirectorPlan[] {
  return generated.map((plan) => ({
    ...plan,
    shots: plan.shots.map((shot, index) => {
      const source = base.shots[index];
      if (!source) return shot;
      const lockedActions = source.actions.filter((action) => action.locked || action.keyframes?.some((keyframe) => keyframe.locked));
      const actions = [
        ...shot.actions.filter((candidate) => !lockedActions.some((locked) => locked.elementId === candidate.elementId && candidate.startSec < locked.startSec + locked.durationSec && locked.startSec < candidate.startSec + candidate.durationSec)),
        ...structuredClone(lockedActions),
      ].sort((a, b) => a.startSec - b.startSec);
      const lockedCamera = source.cameraKeyframes?.filter((keyframe) => keyframe.locked) ?? [];
      const cameraKeyframes = lockedCamera.length ? [
        ...(shot.cameraKeyframes ?? []).filter((candidate) => !lockedCamera.some((locked) => Math.abs(locked.timeSec - candidate.timeSec) < 0.04)),
        ...structuredClone(lockedCamera),
      ].sort((a, b) => a.timeSec - b.timeSec) : shot.cameraKeyframes;
      return { ...shot, actions, cameraKeyframes };
    }),
  }));
}

function fallbackPlans(base: DirectorPlan, elements: DirectorElement[], prompt: string): DirectorPlan[] {
  const hintsByShot = inferPromptActionsByShot(prompt, elements, base.shots.length);
  const shotActions = (index: number) => (hintsByShot[index] ?? []).map((hint) => ({ ...hint, startSec: Math.max(0.1, hint.startSec ?? 0.1) }));
  const raw: RawPlan[] = [
    { name: '克制观察', summary: `稳定机位与轻微推近 · ${prompt || '当前任务'}`, shots: base.shots.map((_, index) => ({ cameraMove: index % 2 ? 'push' : 'static', actions: shotActions(index) })) },
    { name: '压迫跟随', summary: `近距离跟随与手持呼吸 · ${prompt || '当前任务'}`, shots: base.shots.map((_, index) => ({ cameraMove: index % 2 ? 'handheld' : 'follow', actions: shotActions(index) })) },
    { name: '运动调度', summary: `横移、环绕与空间走位 · ${prompt || '当前任务'}`, shots: base.shots.map((_, index) => ({ cameraMove: index % 2 ? 'orbit' : 'truck-right', actions: shotActions(index) })) },
  ];
  return raw.map((plan) => {
    const complete = ensurePlanActions(alignRawPlanToPrompt(plan, prompt), prompt, elements);
    return buildPlans([complete], adaptBaseForMotion(base, complete), elements)[0];
  });
}

function adaptBaseForMotion(base: DirectorPlan, rawPlan: RawPlan): DirectorPlan {
  const count = Math.max(1, Math.min(8, rawPlan.shots?.length || base.shots.length || 4));
  const total = Math.max(1, planDuration(base));
  const duration = total / count;
  let cursor = 0;
  const shots = Array.from({ length: count }, (_, index) => {
    const source = structuredClone(base.shots[index % Math.max(1, base.shots.length)] ?? base.shots[0]);
    const rawDuration = Math.max(0.5, Number(rawPlan.shots?.[index]?.durationSec) || duration);
    const shot = { ...source, id: `shot-${nanoid(7)}`, startSec: cursor, durationSec: rawDuration, actions: [] } as DirectorSequenceShot;
    cursor += rawDuration;
    return shot;
  });
  return { ...base, shots };
}

export async function generateDirectorMotionDraftProposals(
  origin: DirectorOrigin,
  base: DirectorPlan,
  elements: DirectorElement[],
  userGuidance = '',
): Promise<DirectorPlan[]> {
  const characters = elements.filter((element) => element.kind === 'mannequin').map((element) => element.name);
  const total = planDuration(base).toFixed(1);
  const prompt = `你是专业影视 Previs 动作导演。把视频提示词转换成 3 套可立即播放的白模动作预演方案，第一套最忠实、最实用，后两套只改变导演调度，不改变剧情。

原始视频提示词：${origin.prompt || origin.title}
用户补充调度：${userGuidance || '无，忠实还原原提示词'}
人物名称：${characters.join('、') || '人物'}
总时长：${total} 秒。

根据动作语义拆成 3 到 5 个镜头。每镜必须包含具体人物动作；禁止只给空镜头。动作只能使用：${[...ACTIONS].join(', ')}。摄影机运动只能使用：${[...CAMERA_MOVES].join(', ')}。
startSec 是动作在本镜内的开始时间，durationSec 是动作持续时间。moveX/moveZ 是相对起点的米数，限制 -4 到 4。行走、跑步、跟随必须给非零位移。没有明确时间时按自然动作速度分配，总时长尽量接近 ${total} 秒。
景别 shotScale 只能使用 extreme-wide/wide/medium/medium-close/close-up/extreme-close-up。cameraYawDeg 为 -180 到 180 的水平角度，cameraPitchDeg 为 -45 到 75 的俯仰角，focalLengthMm 为 18 到 135。

只返回 JSON：{"plans":[{"name":"忠实动作草案","summary":"方案特点","shots":[{"name":"镜头名","durationSec":3,"shotScale":"medium","cameraYawDeg":0,"cameraPitchDeg":0,"focalLengthMm":50,"cameraMove":"follow","actions":[{"elementName":"人物名","action":"walk","startSec":0,"durationSec":2.5,"moveX":2,"moveZ":0}]}]}]}`;
  try {
    const response = await quickChat([
      { role: 'system', content: '只输出合法 JSON。动作预演必须有动作，不要输出解释或 markdown。' },
      { role: 'user', content: prompt },
    ], { maxTokens: 4200 });
    const parsed = parseJson(response);
    if (!Array.isArray(parsed.plans) || parsed.plans.length < 2) throw new Error('动作方案数量不足');
    return preserveLockedEdits(parsed.plans.slice(0, 3).map((raw) => {
      const aligned = alignRawPlanToPrompt(raw, origin.prompt || origin.title);
      const complete = ensurePlanActions(aligned, origin.prompt || origin.title, elements);
      return buildPlans([complete], adaptBaseForMotion(base, complete), elements)[0];
    }), base);
  } catch (error) {
    console.warn('[director] motion draft fallback:', error);
    const combinedPrompt = [origin.prompt || origin.title, userGuidance ? `用户补充：${userGuidance}` : ''].filter(Boolean).join('\n');
    return preserveLockedEdits(fallbackPlans(base, elements, combinedPrompt), base);
  }
}

export async function generateDirectorPlanProposals(
  origin: DirectorOrigin,
  base: DirectorPlan,
  elements: DirectorElement[],
  userPrompt: string,
): Promise<DirectorPlan[]> {
  const characters = elements.filter((element) => element.kind === 'mannequin').map((element) => element.name);
  const proxies = elements.filter((element) => element.kind !== 'mannequin').map((element) => element.name);
  const prompt = `你是专业影视预演导演。根据已有任务，为白模预演设计 3 套明显不同但可执行的导演方案。

任务：${origin.prompt || origin.title}
用户补充：${userPrompt || '无'}
人物：${characters.join('、') || '尚未添加人物'}
代理道具：${proxies.join('、') || '无'}
镜头数固定为 ${base.shots.length}，不要增加或减少。总时长尽量保持 ${planDuration(base).toFixed(1)} 秒。

每套方案需要具体说明镜头名称、时长、摄影机运动，以及人物的基础动作。动作只允许：${[...ACTIONS].join(', ')}。摄影机运动只允许：${[...CAMERA_MOVES].join(', ')}。
moveX/moveZ 是人物相对起点的米数，保持在 -4 到 4。

只返回 JSON：
{"plans":[{"name":"方案名","summary":"一句话特点","shots":[{"name":"镜头名","durationSec":3.75,"shotScale":"medium","cameraYawDeg":0,"cameraPitchDeg":0,"focalLengthMm":50,"cameraMove":"push","actions":[{"elementName":"人物名","action":"walk","startSec":0,"durationSec":2.5,"moveX":2,"moveZ":0}]}]}]}`;
  try {
    const response = await quickChat([
      { role: 'system', content: '只输出合法 JSON，不要解释，不要使用 markdown。' },
      { role: 'user', content: prompt },
    ], { maxTokens: 3500 });
    const parsed = parseJson(response);
    if (!Array.isArray(parsed.plans) || parsed.plans.length < 2) throw new Error('方案数量不足');
    return preserveLockedEdits(buildPlans(parsed.plans, base, elements), base);
  } catch (error) {
    console.warn('[director] Agent plan fallback:', error);
    return preserveLockedEdits(fallbackPlans(base, elements, userPrompt), base);
  }
}

function planDuration(plan: DirectorPlan): number {
  return plan.shots.reduce((sum, shot) => sum + shot.durationSec, 0);
}

export async function consultDirectorPlan(
  origin: DirectorOrigin,
  plan: DirectorPlan,
  elements: DirectorElement[],
  messages: DirectorConsultMessage[],
  sceneContext: string,
): Promise<{ content: string; ready: boolean; commands: DirectorAgentCommand[] }> {
  const userTurns = messages.filter((message) => message.role === 'user').length;
  const characters = elements.filter((element) => element.kind === 'mannequin' || element.kind === 'crowd').map((element) => element.kind === 'crowd' ? `${element.name}(群演)` : element.name).join('、') || '人物';
  const conversation = messages.map((message) => `${message.role === 'user' ? '用户' : '导演助手'}：${message.content}`).join('\n');
  const response = await quickChat([
    {
      role: 'system',
      content: `你是专业、克制的影视预演导演助手。你的任务是通过对话明确导演意图，不要直接生成镜头方案，不要输出 JSON。
每次只问一个最关键、普通人容易回答的问题，同时可以主动给 2 个简短建议帮助用户选择。不要连续罗列问题。
第 1 次用户回复后必须继续追问，绝不能判定完成。第 2 次及之后，信息足够时用 3 条以内总结已经确认的动作、调度和摄影机倾向，并在最后单独输出 [[READY]]；信息不足则继续问一个问题，不输出标记。
你能读取并操控整个导演项目。只有用户明确要求查看、修复或修改时，才在回复末尾输出命令数组：[[COMMANDS]][{"type":"repair_visibility"}][[/COMMANDS]]。
命令：repair_visibility, focus_people, select_person, set_camera_move, apply_camera_template, set_active_plan, rename_plan, add_plan, duplicate_plan, delete_plan, set_active_shot, add_shot, delete_shot, reorder_shot, update_shot, add_action, apply_motion_template, update_action, lock_action, set_action_keyframe, delete_action_keyframe, delete_action, move_person/rotate_person/set_visibility, select_element, rename_element, move_element/rotate_element/set_element_visibility, add_proxy, duplicate_element, delete_element, set_camera, set_camera_keyframe, delete_camera_keyframe, inspect_frame, play, pause, seek, save, undo, redo, switch_workshop_shot。
优先使用 apply_motion_template 和 apply_camera_template，它们会产生可编辑关键帧。需要精修时再使用 set_action_keyframe / set_camera_keyframe。必须使用场景状态里的真实 ID；不得覆盖 locked=true 的动作或关键帧，除非用户明确要求解锁或覆盖。每次写入后都要读取场景状态验证，不得仅凭命令已发送就宣称完成。删除只在用户明确说删除时执行。命令之外不要假装操作成功。
personId / personName 字段也可指向 kind=crowd 的群演对象。群演只编排整体位置、朝向和运动路径，不给群演写人体姿态或关节数据。
可用人物动作模板：${MOTION_TEMPLATES.map((item) => `${item.id}(${item.label}/${item.category})`).join(', ')}。
可用电影运镜模板：${CAMERA_TEMPLATES.map((item) => `${item.id}(${item.label}/${item.category})`).join(', ')}。
表达简洁、像真正的导演在沟通，不使用空泛套话。`,
    },
    {
      role: 'user',
      content: `任务：${origin.prompt || origin.title}\n当前长度：${planDuration(plan).toFixed(1)} 秒，${plan.shots.length} 个镜头\n人物：${characters}\n当前对话轮数：${userTurns}\n\n当前场景状态：\n${sceneContext}\n\n${conversation}`,
    },
  ], { maxTokens: 700 });
  const modelReady = response.includes('[[READY]]');
  const commandText = response.match(/\[\[COMMANDS\]\]([\s\S]*?)\[\[\/COMMANDS\]\]/)?.[1];
  let commands: DirectorAgentCommand[] = [];
  try {
    const parsed = commandText ? JSON.parse(commandText) : [];
    if (Array.isArray(parsed)) commands = parsed.filter((command): command is DirectorAgentCommand => Boolean(command && typeof command === 'object' && [
      'repair_visibility', 'focus_people', 'select_person', 'set_camera_move', 'apply_camera_template', 'set_active_plan', 'rename_plan', 'add_plan', 'duplicate_plan', 'delete_plan',
      'set_active_shot', 'add_shot', 'delete_shot', 'reorder_shot', 'update_shot', 'add_action', 'update_action', 'delete_action', 'move_person',
      'apply_motion_template', 'lock_action', 'set_action_keyframe', 'delete_action_keyframe',
      'rotate_person', 'set_visibility', 'select_element', 'rename_element', 'move_element', 'rotate_element', 'set_element_visibility', 'add_proxy', 'duplicate_element', 'delete_element',
      'set_camera', 'set_camera_keyframe', 'delete_camera_keyframe', 'inspect_frame', 'play', 'pause', 'seek', 'save', 'undo', 'redo', 'switch_workshop_shot',
    ].includes(String(command.type))));
  } catch { commands = []; }
  return {
    content: response.replace(/\[\[READY\]\]/g, '').replace(/\[\[COMMANDS\]\][\s\S]*?\[\[\/COMMANDS\]\]/g, '').trim(),
    ready: userTurns >= 2 && modelReady,
    commands,
  };
}
