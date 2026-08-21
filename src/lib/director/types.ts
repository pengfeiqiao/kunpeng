/**
 * director/types — 3D 导演台可序列化类型（无 three 依赖）。
 * directorStore 持久化（director.json）与机位描述算法共用。
 */

export interface Vec3 { x: number; y: number; z: number }

export type ElementKind = 'box' | 'sphere' | 'cylinder' | 'wall' | 'mannequin' | 'billboard' | 'crowd';
export type AspectId = '16:9' | '9:16' | '4:3' | '1:1';

export const ASPECT_RATIOS: Record<AspectId, number> = {
  '16:9': 16 / 9,
  '9:16': 9 / 16,
  '4:3': 4 / 3,
  '1:1': 1,
};

export type JointName =
  | 'hips' | 'spine' | 'neck'
  | 'shoulderL' | 'elbowL' | 'shoulderR' | 'elbowR'
  | 'hipL' | 'kneeL' | 'hipR' | 'kneeR';

interface ElementBase {
  id: string;
  kind: ElementKind;
  name: string;
  position: Vec3;
  /** 欧拉角（度），UI 友好；engine 内转弧度 */
  rotationDeg: Vec3;
  scale: Vec3;
  color: string;
  visible: boolean;
  groupId: string | null;
}

export interface PrimitiveElement extends ElementBase {
  kind: 'box' | 'sphere' | 'cylinder' | 'wall';
}

export interface MannequinElement extends ElementBase {
  kind: 'mannequin';
  bodyType?: 'person' | 'animal';
  animalSpecies?: 'quadruped' | 'small';
  characterId?: string;
  identitySource?: 'workshop' | 'temporary' | 'image-analysis';
  /** 预设姿势 id；关节微调后为 'custom' */
  poseId: string;
  /** 关节角度覆盖（度） */
  joints: Partial<Record<JointName, Vec3>>;
  heightM: number;
  performanceProfileId?: string;
  dominantHand?: 'left' | 'right';
  motionScale?: number;
  personalSpaceM?: number;
}

export interface BillboardElement extends ElementBase {
  kind: 'billboard';
  /** 角色图绝对路径（不存 dataURL） */
  imagePath: string;
  assetRef?: { source: 'library' | 'workshop'; id: string };
  heightM: number;
}

export interface CrowdElement extends ElementBase {
  kind: 'crowd';
  rows: number;
  cols: number;
  spacing: number;
  poseId: string;
}

export type DirectorElement = PrimitiveElement | MannequinElement | BillboardElement | CrowdElement;

export interface DirectorShot {
  id: string;
  name: string;
  position: Vec3;
  target: Vec3;
  /** 垂直 FOV（度） */
  fov: number;
  rollDeg?: number;
  focalLengthMm?: number;
  shotScale?: DirectorShotScale;
  primaryElementId?: string;
  recognition?: DirectorRecognitionMeta;
  aspect: AspectId;
  /** 来自 CAMERA_COMBOS 快捷机位时记录 */
  comboId?: string;
  createdAt: number;
}

export type DirectorShotScale = 'extreme-wide' | 'wide' | 'medium' | 'medium-close' | 'close-up' | 'extreme-close-up';

export interface DirectorRecognitionMeta {
  version: number;
  confidence: number;
  sourcePath?: string;
  rawShotType?: string;
  evidence?: {
    headHeightRatio?: number;
    bodyHeightRatio?: number;
    cropAt?: string;
    horizonY?: number;
  };
  cameraYawDeg?: number;
  cameraPitchDeg?: number;
  cameraRollDeg?: number;
  composition?: string;
}

export interface DirectorGroup { id: string; name: string }

export type DirectorSourceKind =
  | 'free'
  | 'workshop-storyboard'
  | 'workshop-video-prompt'
  | 'canvas-image'
  | 'canvas-prompt';

/** 只记录来源定位，不复制来源节点或工坊资产，避免参考资产串入生成链。 */
export interface DirectorOrigin {
  kind: DirectorSourceKind;
  title: string;
  projectId?: string;
  shotNo?: string;
  nodeId?: string;
  prompt?: string;
  storyboardFrameIds?: string[];
  referenceImagePaths?: string[];
}

export type DirectorCameraMove =
  | 'static' | 'push' | 'pull' | 'truck-left' | 'truck-right'
  | 'crane-up' | 'crane-down' | 'pan-left' | 'pan-right'
  | 'tilt-up' | 'tilt-down' | 'orbit' | 'arc-left' | 'arc-right'
  | 'follow' | 'tracking' | 'steadicam' | 'handheld' | 'handheld-intense'
  | 'jib-up' | 'jib-down' | 'zoom-in' | 'zoom-out' | 'dolly-zoom'
  | 'whip-pan-left' | 'whip-pan-right' | 'roll-left' | 'roll-right';

export type DirectorActionId =
  | 'stand' | 'wait' | 'walk' | 'fast-walk' | 'run' | 'stop'
  | 'sit' | 'stand-up' | 'turn' | 'look-back' | 'crouch' | 'kneel'
  | 'lie-down' | 'raise-hand' | 'wave' | 'point' | 'pick-up'
  | 'put-down' | 'push' | 'pull' | 'open-door' | 'close-door'
  | 'hug' | 'face-to-face' | 'pass-by' | 'follow' | 'dodge'
  | 'fall' | 'get-up' | 'enter-car' | 'exit-car'
  | 'sew' | 'read' | 'write' | 'speak' | 'nod' | 'shake-head'
  | 'look-up' | 'look-down' | 'look-at' | 'reach' | 'hold'
  | 'idle-breathe' | 'listen' | 'hesitate' | 'bow' | 'cross-arms'
  | 'hands-on-hips' | 'clap' | 'drink' | 'phone' | 'hand-over'
  | 'receive' | 'step-back' | 'step-forward' | 'glance' | 'inspect' | 'knock';

export interface DirectorElementState {
  position: Vec3;
  rotationDeg: Vec3;
  scale: Vec3;
  visible: boolean;
}

export interface DirectorActionClip {
  id: string;
  elementId: string;
  action: DirectorActionId;
  startSec: number;
  durationSec: number;
  from: Vec3;
  to: Vec3;
  fromRotationDeg?: Vec3;
  toRotationDeg?: Vec3;
  templateId?: string;
  intensity?: number;
  locked?: boolean;
  source?: 'agent' | 'template' | 'manual' | 'legacy';
  keyframes?: DirectorMotionKeyframe[];
}

export type DirectorKeyframeInterpolation = 'hold' | 'linear' | 'smooth' | 'ease-in' | 'ease-out';

export interface DirectorMotionKeyframe {
  id: string;
  /** 动作片段内的相对时间。 */
  timeSec: number;
  position?: Vec3;
  /**
   * Cubic Bezier path handles, stored as offsets from `position`.
   * Missing handles keep the segment linear for backwards compatibility.
   */
  pathIn?: Vec3;
  pathOut?: Vec3;
  pathMode?: 'corner' | 'smooth';
  rotationDeg?: Vec3;
  joints?: Partial<Record<JointName, Vec3>>;
  interpolation: DirectorKeyframeInterpolation;
  locked?: boolean;
  source?: 'agent' | 'template' | 'manual';
  note?: string;
}

export interface DirectorCameraKeyframe {
  id: string;
  /** 镜头内的相对时间。 */
  timeSec: number;
  position: Vec3;
  target: Vec3;
  fov: number;
  rollDeg?: number;
  interpolation: DirectorKeyframeInterpolation;
  locked?: boolean;
  source?: 'agent' | 'template' | 'manual';
  note?: string;
}

export interface DirectorSequenceShot extends DirectorShot {
  startSec: number;
  durationSec: number;
  cameraEnd: { position: Vec3; target: Vec3; fov: number; rollDeg?: number };
  cameraMove: DirectorCameraMove;
  cameraKeyframes?: DirectorCameraKeyframe[];
  elementStates: Record<string, DirectorElementState>;
  actions: DirectorActionClip[];
  sourceFrameId?: string;
  thumbnailPath?: string;
  notes?: string;
}

export interface DirectorPlan {
  id: string;
  name: string;
  summary: string;
  createdAt: number;
  shots: DirectorSequenceShot[];
}

export interface DirectorExportRecord {
  id: string;
  type: 'still' | 'top-view' | 'path-map' | 'transparent' | 'previs-video' | 'final-image' | 'ai-video';
  path: string;
  createdAt: number;
  planId: string;
  shotId?: string;
  writtenBack?: boolean;
}

/** director.json schema v2 */
export interface DirectorSceneFile {
  version: 2;
  elements: DirectorElement[];
  groups: DirectorGroup[];
  plans: DirectorPlan[];
  activePlanId: string | null;
  aspect: AspectId;
  origin: DirectorOrigin;
  exports: DirectorExportRecord[];
  updatedAt: number;
}

export function vec3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function vecEq(a: Vec3, b: Vec3, eps = 1e-4): boolean {
  return Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;
}
