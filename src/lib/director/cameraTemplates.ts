import { nanoid } from 'nanoid';
import type { DirectorCameraKeyframe, DirectorCameraMove, DirectorSequenceShot, Vec3 } from './types';

export type CameraCategory = '稳定' | '推拉' | '横移' | '摇摄' | '升降' | '弧线' | '跟拍' | '表现性';

export interface CameraTemplate {
  id: DirectorCameraMove;
  label: string;
  category: CameraCategory;
  description: string;
  intensity: '克制' | '标准' | '强烈';
}

const rows = (category: CameraCategory, items: Array<[DirectorCameraMove, string, string, CameraTemplate['intensity']?]>): CameraTemplate[] =>
  items.map(([id, label, description, intensity = '标准']) => ({ id, label, category, description, intensity }));

export const CAMERA_TEMPLATES: CameraTemplate[] = [
  ...rows('稳定', [['static', '锁定机位', '完全固定，强调表演和构图', '克制']]),
  ...rows('推拉', [
    ['push', '轨道推近', '沿视线方向稳定靠近主体'], ['pull', '轨道拉远', '从主体退出并交代环境'],
    ['zoom-in', '光学变焦推近', '机位不动，仅收窄视角'], ['zoom-out', '光学变焦拉远', '机位不动，扩大视角'],
    ['dolly-zoom', '希区柯克变焦', '机位与焦段反向变化，制造空间异变', '强烈'],
  ]),
  ...rows('横移', [
    ['truck-left', '左横移', '摄影机平行向左移动'], ['truck-right', '右横移', '摄影机平行向右移动'],
  ]),
  ...rows('摇摄', [
    ['pan-left', '向左摇摄', '机位固定，视线向左寻找主体'], ['pan-right', '向右摇摄', '机位固定，视线向右寻找主体'],
    ['tilt-up', '向上摇摄', '由低处揭示高处信息'], ['tilt-down', '向下摇摄', '由高处落向人物或细节'],
    ['whip-pan-left', '左甩镜', '快速左甩并在目标处制动', '强烈'], ['whip-pan-right', '右甩镜', '快速右甩并在目标处制动', '强烈'],
  ]),
  ...rows('升降', [
    ['crane-up', '升镜头', '垂直升高，扩大空间'], ['crane-down', '降镜头', '垂直下降，靠近人物'],
    ['jib-up', '摇臂升起', '摄影机和注视点共同上扬'], ['jib-down', '摇臂落下', '摄影机和注视点共同下降'],
  ]),
  ...rows('弧线', [
    ['orbit', '半环绕', '围绕主体建立空间关系'], ['arc-left', '左弧线', '沿主体左侧小弧移动'], ['arc-right', '右弧线', '沿主体右侧小弧移动'],
  ]),
  ...rows('跟拍', [
    ['follow', '后方跟拍', '保持距离跟随主体'], ['tracking', '侧向跟拍', '平行跟随人物运动'], ['steadicam', '稳定器跟拍', '带轻微呼吸的平滑跟拍'],
  ]),
  ...rows('表现性', [
    ['handheld', '轻手持', '细微呼吸和身体反馈', '克制'], ['handheld-intense', '强手持', '冲突场面的明显震动', '强烈'],
    ['roll-left', '左倾揭示', '画面逐渐向左倾斜', '强烈'], ['roll-right', '右倾揭示', '画面逐渐向右倾斜', '强烈'],
  ]),
];

export function cameraTemplate(id: DirectorCameraMove): CameraTemplate {
  return CAMERA_TEMPLATES.find((item) => item.id === id) ?? CAMERA_TEMPLATES[0];
}

const add = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
const sub = (a: Vec3, b: Vec3): Vec3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const scale = (v: Vec3, amount: number): Vec3 => ({ x: v.x * amount, y: v.y * amount, z: v.z * amount });
const length = (v: Vec3): number => Math.max(0.001, Math.hypot(v.x, v.y, v.z));
const norm = (v: Vec3): Vec3 => scale(v, 1 / length(v));

function keyframe(timeSec: number, position: Vec3, target: Vec3, fov: number, rollDeg = 0, note?: string): DirectorCameraKeyframe {
  return { id: `ckf-${nanoid(7)}`, timeSec, position, target, fov, rollDeg, interpolation: 'smooth', source: 'template', note };
}

export function createCameraKeyframes(shot: DirectorSequenceShot, move: DirectorCameraMove): DirectorCameraKeyframe[] {
  const duration = Math.max(0.25, shot.durationSec);
  const startPosition = { ...shot.position };
  const startTarget = { ...shot.target };
  const forward = norm(sub(startTarget, startPosition));
  const right = norm({ x: forward.z, y: 0, z: -forward.x });
  let endPosition = { ...startPosition };
  let endTarget = { ...startTarget };
  let endFov = shot.fov;
  let endRoll = shot.rollDeg ?? 0;
  if (move === 'push' || move === 'follow' || move === 'steadicam') endPosition = add(startPosition, scale(forward, 1.6));
  if (move === 'pull') endPosition = add(startPosition, scale(forward, -1.8));
  if (move === 'truck-left' || move === 'tracking') endPosition = add(startPosition, scale(right, -1.8));
  if (move === 'truck-right') endPosition = add(startPosition, scale(right, 1.8));
  if (move === 'crane-up') endPosition.y += 1.6;
  if (move === 'crane-down') endPosition.y = Math.max(0.3, endPosition.y - 1.4);
  if (move === 'jib-up') { endPosition.y += 1.5; endTarget.y += 0.7; }
  if (move === 'jib-down') { endPosition.y = Math.max(0.3, endPosition.y - 1.3); endTarget.y = Math.max(0.2, endTarget.y - 0.6); }
  if (move === 'pan-left' || move === 'whip-pan-left') endTarget = add(startTarget, scale(right, -2.4));
  if (move === 'pan-right' || move === 'whip-pan-right') endTarget = add(startTarget, scale(right, 2.4));
  if (move === 'tilt-up') endTarget.y += 1.5;
  if (move === 'tilt-down') endTarget.y = Math.max(0, endTarget.y - 1.3);
  if (move === 'zoom-in') endFov = Math.max(12, shot.fov * 0.68);
  if (move === 'zoom-out') endFov = Math.min(85, shot.fov * 1.35);
  if (move === 'dolly-zoom') { endPosition = add(startPosition, scale(forward, 1.8)); endFov = Math.min(90, shot.fov * 1.45); }
  if (move === 'roll-left') endRoll -= 14;
  if (move === 'roll-right') endRoll += 14;
  if (move === 'orbit' || move === 'arc-left' || move === 'arc-right') {
    const relative = sub(startPosition, startTarget);
    const angle = (move === 'orbit' ? 55 : move === 'arc-left' ? -28 : 28) * Math.PI / 180;
    endPosition = add(startTarget, { x: relative.x * Math.cos(angle) + relative.z * Math.sin(angle), y: relative.y, z: -relative.x * Math.sin(angle) + relative.z * Math.cos(angle) });
  }
  const frames = [keyframe(0, startPosition, startTarget, shot.fov, shot.rollDeg ?? 0, '起始机位')];
  if (move === 'whip-pan-left' || move === 'whip-pan-right') {
    frames.push(keyframe(duration * 0.72, startPosition, startTarget, shot.fov, shot.rollDeg ?? 0, '甩镜起势'));
    frames.push(keyframe(duration * 0.9, endPosition, endTarget, endFov, endRoll, '快速甩动'));
  } else if (move === 'handheld' || move === 'handheld-intense') {
    const amount = move === 'handheld-intense' ? 0.12 : 0.035;
    frames.push(keyframe(duration * 0.35, add(startPosition, { x: amount, y: -amount * 0.4, z: 0 }), startTarget, shot.fov, endRoll, '手持呼吸'));
    frames.push(keyframe(duration * 0.68, add(startPosition, { x: -amount * 0.7, y: amount * 0.5, z: 0 }), startTarget, shot.fov, endRoll, '身体反馈'));
  }
  frames.push(keyframe(duration, endPosition, endTarget, endFov, endRoll, '结束机位'));
  return frames;
}

export function cameraPatchFromTemplate(shot: DirectorSequenceShot, move: DirectorCameraMove): Partial<DirectorSequenceShot> {
  const cameraKeyframes = createCameraKeyframes(shot, move);
  const end = cameraKeyframes[cameraKeyframes.length - 1];
  return { cameraMove: move, cameraKeyframes, cameraEnd: { position: { ...end.position }, target: { ...end.target }, fov: end.fov, rollDeg: end.rollDeg } };
}
