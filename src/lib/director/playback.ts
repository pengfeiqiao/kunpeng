import type {
  DirectorActionClip,
  DirectorCameraKeyframe,
  DirectorElement,
  DirectorKeyframeInterpolation,
  DirectorMotionKeyframe,
  JointName,
  DirectorPlan,
  DirectorSequenceShot,
  Vec3,
} from './types';
import type { CameraPose } from './engine';
import { findPose } from './poses';
import { evaluatePathSegment } from './pathCurve';

export interface DirectorFrameState {
  shot: DirectorSequenceShot;
  localTimeSec: number;
  camera: CameraPose;
  elements: DirectorElement[];
}

const MOVING_ACTIONS = new Set(['walk', 'fast-walk', 'run', 'follow', 'pass-by', 'dodge', 'enter-car', 'exit-car']);

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function ease(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function interpolationProgress(value: number, interpolation: DirectorKeyframeInterpolation): number {
  const t = clamp01(value);
  if (interpolation === 'hold') return 0;
  if (interpolation === 'linear') return t;
  if (interpolation === 'ease-in') return t * t;
  if (interpolation === 'ease-out') return 1 - (1 - t) * (1 - t);
  return ease(t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) };
}

function samplePair<T extends { timeSec: number; interpolation: DirectorKeyframeInterpolation }>(frames: T[], timeSec: number): { left: T; right: T; progress: number } | null {
  const sorted = [...frames].sort((a, b) => a.timeSec - b.timeSec);
  if (!sorted.length) return null;
  const left = [...sorted].reverse().find((frame) => frame.timeSec <= timeSec) ?? sorted[0];
  const right = sorted.find((frame) => frame.timeSec > timeSec) ?? left;
  const raw = right === left ? 0 : (timeSec - left.timeSec) / Math.max(0.001, right.timeSec - left.timeSec);
  return { left, right, progress: interpolationProgress(raw, left.interpolation) };
}

function lerpJoints(left: DirectorMotionKeyframe['joints'], right: DirectorMotionKeyframe['joints'], progress: number): DirectorMotionKeyframe['joints'] {
  const names = new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})] as JointName[]);
  return Object.fromEntries([...names].map((name) => {
    const a = left?.[name] ?? { x: 0, y: 0, z: 0 };
    const b = right?.[name] ?? a;
    return [name, lerpVec(a, b, progress)];
  }));
}

function scaleJoints(joints: DirectorMotionKeyframe['joints'], amount: number): DirectorMotionKeyframe['joints'] {
  return Object.fromEntries(Object.entries(joints ?? {}).map(([name, value]) => [name, { x: value.x * amount, y: value.y * amount, z: value.z * amount }])) as DirectorMotionKeyframe['joints'];
}

export function actionPose(action: DirectorActionClip['action']): string {
  if (action === 'walk' || action === 'fast-walk' || action === 'follow' || action === 'pass-by' || action === 'step-back' || action === 'step-forward') return 'walk';
  if (action === 'run' || action === 'dodge') return 'run';
  if (action === 'sit') return 'sit';
  if (action === 'kneel' || action === 'crouch') return 'kneel';
  if (action === 'lie-down' || action === 'fall') return 'lie';
  if (action === 'point') return 'point';
  if (action === 'wave' || action === 'raise-hand') return 'wave';
  if (action === 'hug') return 'hug';
  if (action === 'sew' || action === 'read' || action === 'write' || action === 'hold') return 'stand';
  return 'stand';
}

export function animatedJoints(action: DirectorActionClip['action'], progress: number, durationSec: number): Partial<Record<JointName, Vec3>> {
  const v = (x = 0, y = 0, z = 0): Vec3 => ({ x, y, z });
  const cycles = Math.max(1, durationSec * (action === 'run' ? 2.3 : action === 'fast-walk' ? 1.8 : 1.35));
  const swing = Math.sin(progress * Math.PI * 2 * cycles);
  const envelope = Math.min(1, progress / 0.12, (1 - progress) / 0.12);
  if (action === 'walk' || action === 'fast-walk' || action === 'follow' || action === 'pass-by') {
    const amplitude = action === 'fast-walk' ? 38 : 28;
    return { hipL: v(swing * amplitude * envelope), hipR: v(-swing * amplitude * envelope), kneeL: v(Math.max(0, -swing) * 48 * envelope), kneeR: v(Math.max(0, swing) * 48 * envelope), shoulderL: v(-swing * 24 * envelope), shoulderR: v(swing * 24 * envelope), spine: v(4 * envelope) };
  }
  if (action === 'run' || action === 'dodge') {
    return { hipL: v(swing * 52 * envelope), hipR: v(-swing * 52 * envelope), kneeL: v((18 + Math.max(0, -swing) * 75) * envelope), kneeR: v((18 + Math.max(0, swing) * 75) * envelope), shoulderL: v(-swing * 42 * envelope), shoulderR: v(swing * 42 * envelope), elbowL: v(-75 * envelope), elbowR: v(-75 * envelope), spine: v(13 * envelope) };
  }
  if (action === 'wave') return { shoulderR: v(0, 0, -145), elbowR: v(0, 0, -25 + Math.sin(progress * Math.PI * 8) * 28), neck: v(0, Math.sin(progress * Math.PI * 2) * 5, 0) };
  if (action === 'raise-hand') return { shoulderR: v(0, 0, -145 * ease(progress)), elbowR: v(0, 0, -22 * ease(progress)) };
  if (action === 'turn') return { hips: v(0, progress * 55, 0), spine: v(0, progress * 28, 0), neck: v(0, progress * 18, 0) };
  if (action === 'look-back') return { spine: v(0, Math.sin(progress * Math.PI) * 22, 0), neck: v(0, Math.sin(progress * Math.PI) * 55, 0) };
  if (action === 'pick-up' || action === 'put-down') { const bend = Math.sin(progress * Math.PI); return { spine: v(bend * 38), hipL: v(-bend * 25), hipR: v(-bend * 25), kneeL: v(bend * 38), kneeR: v(bend * 38), shoulderR: v(bend * 72), elbowR: v(-bend * 24), neck: v(bend * 14) }; }
  if (action === 'push') return { spine: v(16), hipL: v(-18), kneeL: v(20), shoulderL: v(78, 0, 10), shoulderR: v(78, 0, -10), elbowL: v(-18), elbowR: v(-18) };
  if (action === 'pull') return { spine: v(-12), hipR: v(18), kneeR: v(18), shoulderL: v(50, 0, 12), shoulderR: v(50, 0, -12), elbowL: v(-95), elbowR: v(-95) };
  if (action === 'open-door' || action === 'close-door') return { spine: v(0, Math.sin(progress * Math.PI) * 18, 0), shoulderR: v(55, 0, -20), elbowR: v(-65 + progress * 28), neck: v(0, Math.sin(progress * Math.PI) * 16, 0) };
  if (action === 'face-to-face') return { neck: v(0, Math.sin(progress * Math.PI * 0.5) * 18, 0), spine: v(0, Math.sin(progress * Math.PI * 0.5) * 6, 0) };
  if (action === 'stand-up' || action === 'get-up') { const remain = 1 - ease(progress); return { hipL: v(-90 * remain), hipR: v(-90 * remain), kneeL: v(90 * remain), kneeR: v(90 * remain), spine: v(28 * remain) }; }
  if (action === 'stop') return { spine: v(Math.sin(progress * Math.PI) * 7), hipL: v(-Math.sin(progress * Math.PI) * 8), hipR: v(Math.sin(progress * Math.PI) * 8) };
  if (action === 'sew') return { shoulderL: v(35, 0, 12), shoulderR: v(38, 0, -12), elbowL: v(-62 + Math.sin(progress * Math.PI * 10) * 12), elbowR: v(-66 - Math.sin(progress * Math.PI * 10) * 10), neck: v(16, 0, 0), spine: v(7, 0, 0) };
  if (action === 'read') return { shoulderL: v(28, 0, 15), shoulderR: v(28, 0, -15), elbowL: v(-72), elbowR: v(-72), neck: v(14, 0, 0) };
  if (action === 'write') return { shoulderL: v(28, 0, 10), shoulderR: v(42, 0, -8), elbowL: v(-62), elbowR: v(-72 + Math.sin(progress * Math.PI * 9) * 8), neck: v(15, 0, 0) };
  if (action === 'speak') return { shoulderR: v(0, 0, -18 + Math.sin(progress * Math.PI * 4) * 10), elbowR: v(0, 0, -28), neck: v(0, Math.sin(progress * Math.PI * 3) * 3, 0) };
  if (action === 'nod') return { neck: v(Math.sin(progress * Math.PI * 4) * 16, 0, 0) };
  if (action === 'shake-head') return { neck: v(0, Math.sin(progress * Math.PI * 4) * 24, 0) };
  if (action === 'look-up') return { neck: v(-22, 0, 0) };
  if (action === 'look-down') return { neck: v(22, 0, 0) };
  if (action === 'look-at') return { neck: v(0, Math.sin(progress * Math.PI) * 16, 0), spine: v(0, Math.sin(progress * Math.PI) * 5, 0) };
  if (action === 'reach') return { shoulderR: v(72, 0, -6), elbowR: v(-18, 0, 0), spine: v(8, 0, 0) };
  if (action === 'hold') return { shoulderL: v(32, 0, 16), shoulderR: v(32, 0, -16), elbowL: v(-76), elbowR: v(-76) };
  if (action === 'idle-breathe') return { spine: v(Math.sin(progress * Math.PI * 4) * 1.8), shoulderL: v(Math.sin(progress * Math.PI * 4) * 1.2), shoulderR: v(Math.sin(progress * Math.PI * 4) * 1.2) };
  if (action === 'listen') return { neck: v(0, 8, 3), spine: v(2, 4, 0) };
  if (action === 'hesitate') return { neck: v(8, Math.sin(progress * Math.PI) * 10, 0), shoulderR: v(18, 0, -10), elbowR: v(-45) };
  if (action === 'bow') return { spine: v(Math.sin(progress * Math.PI) * 38), neck: v(Math.sin(progress * Math.PI) * 12) };
  if (action === 'cross-arms') return findPose('armscross')?.joints ?? {};
  if (action === 'hands-on-hips') return { shoulderL: v(15, 0, 38), shoulderR: v(15, 0, -38), elbowL: v(-95), elbowR: v(-95) };
  if (action === 'clap') { const beat = Math.abs(Math.sin(progress * Math.PI * 8)); return { shoulderL: v(55, 0, 18 + beat * 20), shoulderR: v(55, 0, -18 - beat * 20), elbowL: v(-65), elbowR: v(-65) }; }
  if (action === 'drink') return { shoulderR: v(115, 0, -8), elbowR: v(-115), neck: v(-8) };
  if (action === 'phone') return { shoulderR: v(45, 0, -25), elbowR: v(-125), neck: v(0, 8, 0) };
  if (action === 'hand-over' || action === 'receive') return { shoulderR: v(72, 0, -5), elbowR: v(-28), spine: v(5) };
  if (action === 'step-back' || action === 'step-forward') return { hipL: v(swing * 22 * envelope), hipR: v(-swing * 22 * envelope), kneeL: v(Math.max(0, -swing) * 35 * envelope), kneeR: v(Math.max(0, swing) * 35 * envelope), shoulderL: v(-swing * 12 * envelope), shoulderR: v(swing * 12 * envelope) };
  if (action === 'glance') return { neck: v(0, Math.sin(progress * Math.PI) * 30, 0) };
  if (action === 'inspect') return { neck: v(18, Math.sin(progress * Math.PI * 2) * 7, 0), spine: v(8), shoulderL: v(22), shoulderR: v(22) };
  if (action === 'knock') return { shoulderR: v(70, 0, -8), elbowR: v(-60 + Math.sin(progress * Math.PI * 8) * 24) };
  const poseId = actionPose(action);
  const preset = findPose(poseId)?.joints ?? {};
  const blend = action === 'sit' || action === 'kneel' || action === 'lie-down' || action === 'fall' ? ease(progress) : 1;
  return Object.fromEntries(Object.entries(preset).map(([joint, value]) => [joint, { x: value.x * blend, y: value.y * blend, z: value.z * blend }])) as Partial<Record<JointName, Vec3>>;
}

function applyAction(element: DirectorElement, action: DirectorActionClip, localTimeSec: number): DirectorElement {
  const keyframeSample = samplePair(action.keyframes ?? [], Math.max(0, localTimeSec - action.startSec));
  if (keyframeSample) {
    const { left, right, progress } = keyframeSample;
    const position = left.position && right.position
      ? evaluatePathSegment(left, right, progress, element.position)
      : left.position ?? element.position;
    const rotationDeg = left.rotationDeg && right.rotationDeg ? lerpVec(left.rotationDeg, right.rotationDeg, progress) : left.rotationDeg ?? element.rotationDeg;
    return {
      ...element,
      position,
      rotationDeg,
      ...(element.kind === 'mannequin' ? { poseId: action.templateId ?? actionPose(action.action), joints: scaleJoints(lerpJoints(left.joints, right.joints, progress), element.motionScale ?? 1) } : {}),
    } as DirectorElement;
  }
  const rawProgress = clamp01((localTimeSec - action.startSec) / Math.max(0.01, action.durationSec));
  const progress = ease(rawProgress);
  const moving = MOVING_ACTIONS.has(action.action) || action.from.x !== action.to.x || action.from.z !== action.to.z;
  const pathYaw = Math.atan2(action.to.x - action.from.x, action.to.z - action.from.z) * 180 / Math.PI;
  return {
    ...element,
    position: moving ? lerpVec(action.from, action.to, progress) : element.position,
    rotationDeg: action.fromRotationDeg && action.toRotationDeg
      ? lerpVec(action.fromRotationDeg, action.toRotationDeg, progress)
      : moving && Math.hypot(action.to.x - action.from.x, action.to.z - action.from.z) > 0.05 ? { ...element.rotationDeg, y: pathYaw } : element.rotationDeg,
    ...(element.kind === 'mannequin' ? { poseId: actionPose(action.action), joints: scaleJoints(animatedJoints(action.action, rawProgress, action.durationSec), element.motionScale ?? 1) } : {}),
  } as DirectorElement;
}

export function planDuration(plan: DirectorPlan): number {
  return plan.shots.reduce((max, shot) => Math.max(max, shot.startSec + shot.durationSec), 0);
}

export function shotAtTime(plan: DirectorPlan, timeSec: number): DirectorSequenceShot {
  const clamped = Math.max(0, Math.min(timeSec, Math.max(0, planDuration(plan) - 0.001)));
  return plan.shots.find((shot) => clamped >= shot.startSec && clamped < shot.startSec + shot.durationSec)
    ?? plan.shots[plan.shots.length - 1];
}

export function evaluateDirectorFrame(plan: DirectorPlan, baseElements: DirectorElement[], timeSec: number): DirectorFrameState | null {
  const shot = shotAtTime(plan, timeSec);
  if (!shot) return null;
  const localTimeSec = Math.max(0, Math.min(shot.durationSec, timeSec - shot.startSec));
  const progress = ease(localTimeSec / Math.max(0.01, shot.durationSec));
  const cameraSample = samplePair<DirectorCameraKeyframe>(shot.cameraKeyframes ?? [], localTimeSec);
  const camera: CameraPose = cameraSample ? {
    position: lerpVec(cameraSample.left.position, cameraSample.right.position, cameraSample.progress),
    target: lerpVec(cameraSample.left.target, cameraSample.right.target, cameraSample.progress),
    fov: lerp(cameraSample.left.fov, cameraSample.right.fov, cameraSample.progress),
    rollDeg: lerp(cameraSample.left.rollDeg ?? 0, cameraSample.right.rollDeg ?? cameraSample.left.rollDeg ?? 0, cameraSample.progress),
  } : {
    position: lerpVec(shot.position, shot.cameraEnd.position, progress),
    target: lerpVec(shot.target, shot.cameraEnd.target, progress),
    fov: lerp(shot.fov, shot.cameraEnd.fov, progress),
    rollDeg: lerp(shot.rollDeg ?? 0, shot.cameraEnd.rollDeg ?? shot.rollDeg ?? 0, progress),
  };
  if (shot.cameraMove === 'handheld' || shot.cameraMove === 'handheld-intense') {
    const amount = shot.cameraMove === 'handheld-intense' ? 0.085 : 0.025;
    const pulse = Math.sin(timeSec * 13.7) * amount;
    camera.position = { ...camera.position, x: camera.position.x + pulse, y: camera.position.y + Math.cos(timeSec * 11.1) * amount * 0.72 };
  }

  const elements = baseElements.map((base) => {
    const state = shot.elementStates[base.id];
    let element: DirectorElement = state ? {
      ...base,
      position: { ...state.position },
      rotationDeg: { ...state.rotationDeg },
      scale: { ...state.scale },
      visible: state.visible,
    } as DirectorElement : base;
    const actions = shot.actions
      .filter((action) => action.elementId === base.id && localTimeSec >= action.startSec)
      .sort((a, b) => a.startSec - b.startSec);
    for (const action of actions) {
      if (localTimeSec <= action.startSec + action.durationSec) element = applyAction(element, action, localTimeSec);
      else element = applyAction(element, action, action.startSec + action.durationSec);
    }
    return element;
  });
  return { shot, localTimeSec, camera, elements };
}

export interface DirectorHealthIssue {
  id: string;
  severity: 'warning' | 'error';
  shotId: string;
  message: string;
}

export function inspectDirectorPlan(plan: DirectorPlan, elements: DirectorElement[]): DirectorHealthIssue[] {
  const issues: DirectorHealthIssue[] = [];
  if (plan.shots.length === 0) return [{ id: 'no-shots', severity: 'error', shotId: '', message: '方案里还没有镜头' }];
  for (const [shotIndex, shot] of plan.shots.entries()) {
    if (shot.durationSec < 0.25) issues.push({ id: `${shot.id}-duration`, severity: 'error', shotId: shot.id, message: `${shot.name} 时长过短` });
    if (shot.position.y < 0.05 || shot.cameraEnd.position.y < 0.05) issues.push({ id: `${shot.id}-ground`, severity: 'error', shotId: shot.id, message: `${shot.name} 摄影机进入地面` });
    const visible = elements.filter((element) => shot.elementStates[element.id]?.visible !== false);
    if (visible.length === 0) issues.push({ id: `${shot.id}-empty`, severity: 'warning', shotId: shot.id, message: `${shot.name} 没有可见主体` });
    const visiblePositions = visible.map((element) => ({
      element,
      position: shot.elementStates[element.id]?.position ?? element.position,
    }));
    for (const { element, position } of visiblePositions) {
      const cameraDistance = Math.hypot(shot.position.x - position.x, shot.position.y - position.y, shot.position.z - position.z);
      if (cameraDistance < 0.65) {
        issues.push({ id: `${shot.id}-${element.id}-camera-collision`, severity: 'error', shotId: shot.id, message: `${shot.name} 的摄影机与「${element.name}」发生碰撞` });
      }
    }
    for (let left = 0; left < visiblePositions.length; left += 1) {
      for (let right = left + 1; right < visiblePositions.length; right += 1) {
        const a = visiblePositions[left];
        const b = visiblePositions[right];
        const distance = Math.hypot(a.position.x - b.position.x, a.position.z - b.position.z);
        if (distance < 0.42) {
          issues.push({ id: `${shot.id}-${a.element.id}-${b.element.id}-overlap`, severity: 'warning', shotId: shot.id, message: `${shot.name} 的「${a.element.name}」与「${b.element.name}」位置重叠` });
        }
      }
    }
    const previous = plan.shots[shotIndex - 1];
    if (previous) {
      const previousSide = { x: previous.position.x - previous.target.x, z: previous.position.z - previous.target.z };
      const currentSide = { x: shot.position.x - shot.target.x, z: shot.position.z - shot.target.z };
      const previousLength = Math.hypot(previousSide.x, previousSide.z);
      const currentLength = Math.hypot(currentSide.x, currentSide.z);
      const sideDot = previousLength > 0.01 && currentLength > 0.01
        ? (previousSide.x * currentSide.x + previousSide.z * currentSide.z) / (previousLength * currentLength)
        : 1;
      if (sideDot < -0.45) {
        issues.push({ id: `${shot.id}-axis`, severity: 'warning', shotId: shot.id, message: `${previous.name} 到 ${shot.name} 可能发生越轴，请检查人物朝向` });
      }
    }
    for (const action of shot.actions) {
      if (action.startSec < 0 || action.startSec + action.durationSec > shot.durationSec + 0.01) {
        issues.push({ id: `${shot.id}-${action.id}-range`, severity: 'warning', shotId: shot.id, message: `${shot.name} 的动作超出镜头时长` });
      }
      const distance = Math.hypot(action.to.x - action.from.x, action.to.z - action.from.z);
      const speed = distance / Math.max(action.durationSec, 0.01);
      if (speed > 6) issues.push({ id: `${shot.id}-${action.id}-speed`, severity: 'warning', shotId: shot.id, message: `${shot.name} 的人物移动速度异常` });
      if (MOVING_ACTIONS.has(action.action) && distance < 0.15) issues.push({ id: `${shot.id}-${action.id}-no-path`, severity: 'warning', shotId: shot.id, message: `${shot.name} 的「${action.action}」没有设置移动路径` });
      if (action.from.y < 0 || action.to.y < 0) issues.push({ id: `${shot.id}-${action.id}-underground`, severity: 'error', shotId: shot.id, message: `${shot.name} 的动作路径进入地面` });
      for (const keyframe of action.keyframes ?? []) {
        if (keyframe.timeSec < 0 || keyframe.timeSec > action.durationSec + 0.01) issues.push({ id: `${shot.id}-${action.id}-${keyframe.id}-keyframe-range`, severity: 'warning', shotId: shot.id, message: `${shot.name} 的人物关键帧超出动作时长` });
      }
    }
    for (const keyframe of shot.cameraKeyframes ?? []) {
      if (keyframe.timeSec < 0 || keyframe.timeSec > shot.durationSec + 0.01) issues.push({ id: `${shot.id}-${keyframe.id}-camera-keyframe-range`, severity: 'warning', shotId: shot.id, message: `${shot.name} 的摄影机关键帧超出镜头时长` });
      if (keyframe.position.y < 0.05) issues.push({ id: `${shot.id}-${keyframe.id}-camera-keyframe-ground`, severity: 'error', shotId: shot.id, message: `${shot.name} 的摄影机关键帧进入地面` });
    }
    for (const element of elements) {
      const actions = shot.actions.filter((action) => action.elementId === element.id).sort((a, b) => a.startSec - b.startSec);
      for (let index = 1; index < actions.length; index += 1) {
        const previousAction = actions[index - 1];
        const currentAction = actions[index];
        if (currentAction.startSec < previousAction.startSec + previousAction.durationSec - 0.05) {
          issues.push({ id: `${shot.id}-${element.id}-${currentAction.id}-overlap`, severity: 'error', shotId: shot.id, message: `${shot.name} 的「${element.name}」动作时间发生重叠` });
        }
        const continuityGap = Math.hypot(currentAction.from.x - previousAction.to.x, currentAction.from.z - previousAction.to.z);
        if (continuityGap > 0.8) issues.push({ id: `${shot.id}-${element.id}-${currentAction.id}-jump`, severity: 'warning', shotId: shot.id, message: `${shot.name} 的「${element.name}」动作之间发生位置跳变` });
      }
    }
  }
  return issues;
}
