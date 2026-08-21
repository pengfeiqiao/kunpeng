/**
 * presetCameras — CAMERA_COMBOS 的 3D 数值映射（快捷机位）。
 * fov 由焦段反推：fov = 2·atan(12/f)（全画幅垂直）。
 */
import { CAMERA_COMBOS, type CameraCombo } from '@/lib/canvas/cameraPresets';

export interface PresetCameraPose {
  comboId: string;
  pitchDeg: number;
  yawDeg: number;
  distance: number;
  fov: number;
}

function fovOf(focalMm: number): number {
  return 2 * Math.atan(12 / focalMm) * 180 / Math.PI;
}

/** 按 combo id 前缀/关键词映射数值；未知 combo 给 50mm 标准位 */
const POSE_TABLE: Record<string, Omit<PresetCameraPose, 'comboId'>> = {
  // 85mm 人像特写
  'portrait-85': { pitchDeg: 0, yawDeg: 0, distance: 3.0, fov: fovOf(85) },
  // 24mm 产品全景
  'product-24': { pitchDeg: -10, yawDeg: 25, distance: 2.0, fov: fovOf(24) },
  // 50mm 场景
  'scene-50': { pitchDeg: 0, yawDeg: 0, distance: 5.0, fov: fovOf(50) },
  // 35mm 环境人像
  'env-portrait-35': { pitchDeg: 0, yawDeg: 15, distance: 3.5, fov: fovOf(35) },
  // 100mm 微距
  'macro-100': { pitchDeg: -5, yawDeg: 0, distance: 1.2, fov: fovOf(100) },
  // 变形宽银幕
  anamorphic: { pitchDeg: 0, yawDeg: 10, distance: 6.0, fov: fovOf(40) },
  // 35mm 纪实
  'leica-doc': { pitchDeg: 0, yawDeg: -20, distance: 4.0, fov: fovOf(35) },
  // 航拍广角
  'drone-wide': { pitchDeg: -55, yawDeg: 30, distance: 25, fov: fovOf(16) },
  // 58mm 老镜头
  'vintage-helios': { pitchDeg: 2, yawDeg: 10, distance: 3.0, fov: fovOf(58) },
  // 200mm 长焦压缩
  'tele-200': { pitchDeg: 0, yawDeg: 0, distance: 18, fov: fovOf(200) },
  // 鱼眼
  fisheye: { pitchDeg: -5, yawDeg: 0, distance: 1.5, fov: 110 },
  // 黄金时刻低角度
  goldenhour: { pitchDeg: 8, yawDeg: -35, distance: 5.0, fov: fovOf(35) },
};

const FALLBACK: Omit<PresetCameraPose, 'comboId'> = { pitchDeg: 0, yawDeg: 0, distance: 4.5, fov: fovOf(50) };

function matchPose(combo: CameraCombo): Omit<PresetCameraPose, 'comboId'> {
  // 直接 id 命中
  if (POSE_TABLE[combo.id]) return POSE_TABLE[combo.id];
  // 关键词匹配（combos 的 id/label 命名不完全可预知）
  const key = `${combo.id} ${combo.label}`.toLowerCase();
  if (/85/.test(key)) return POSE_TABLE['portrait-85'];
  if (/24/.test(key)) return POSE_TABLE['product-24'];
  if (/200|长焦|tele/.test(key)) return POSE_TABLE['tele-200'];
  if (/100|微距|macro/.test(key)) return POSE_TABLE['macro-100'];
  if (/航拍|无人机|drone|aerial/.test(key)) return POSE_TABLE['drone-wide'];
  if (/鱼眼|fisheye/.test(key)) return POSE_TABLE.fisheye;
  if (/宽银幕|anamorphic|变形/.test(key)) return POSE_TABLE.anamorphic;
  if (/58|老镜|vintage|helios/.test(key)) return POSE_TABLE['vintage-helios'];
  if (/黄金|golden|落日|夕阳/.test(key)) return POSE_TABLE.goldenhour;
  if (/纪实|街头|doc|leica/.test(key)) return POSE_TABLE['leica-doc'];
  if (/35/.test(key)) return POSE_TABLE['env-portrait-35'];
  if (/50/.test(key)) return POSE_TABLE['scene-50'];
  return FALLBACK;
}

export const PRESET_CAMERA_POSES: (PresetCameraPose & { combo: CameraCombo })[] =
  CAMERA_COMBOS.map((combo) => ({ comboId: combo.id, combo, ...matchPose(combo) }));
