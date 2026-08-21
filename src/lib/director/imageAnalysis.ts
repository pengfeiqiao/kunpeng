import { nanoid } from 'nanoid';
import { visionTool } from '@/lib/agent/tools/visionTool';
import type { DirectorElement, DirectorElementState, DirectorRecognitionMeta, DirectorShotScale, MannequinElement, Vec3 } from './types';

interface NormalizedBox { x: number; y: number; width: number; height: number }

export interface DirectorImagePerson {
  id: string;
  name: string;
  horizontal: number;
  depth: number;
  facingDeg: number;
  pose: 'stand' | 'sit' | 'walk' | 'run' | 'kneel' | 'lie';
  bbox?: NormalizedBox;
  headBox?: NormalizedBox;
  cropAt: 'none' | 'feet' | 'knees' | 'waist' | 'chest' | 'shoulders' | 'face';
  isPrimary: boolean;
  confidence: number;
  enabled: boolean;
}

export interface DirectorImageAnalysis {
  shotType: string;
  cameraHeight: 'low' | 'eye' | 'high';
  cameraAngle: 'front' | 'side' | 'back' | 'over-shoulder';
  cameraYawDeg: number;
  cameraPitchDeg: number;
  cameraRollDeg: number;
  focalLengthMm: number;
  horizonY: number;
  confidence: number;
  composition: 'single' | 'two-shot' | 'group' | 'over-shoulder';
  shotScale: DirectorShotScale;
  people: DirectorImagePerson[];
}

function parseJson(text: string): Record<string, unknown> {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1];
  const source = fenced ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1);
  return JSON.parse(source) as Record<string, unknown>;
}

export async function analyzeDirectorImage(path: string, expectedCharacterNames: string[] = []): Promise<DirectorImageAnalysis> {
  const identityRule = expectedCharacterNames.length
    ? `本镜角色身份只能从以下名单中选择：${expectedCharacterNames.join('、')}。name 必须原样返回名单中的名字，不得创建“人物1”或临时人物；画面人数多于名单时忽略无关人物。`
    : '没有提供角色名单，只按人物1、人物2标记检测位置，不推断真实身份。';
  const result = await visionTool.execute({
    image: path,
    prompt: `你是专业影视分镜匹配师。分析图片用于三维白模预演，只测量构图和摄影机，不描述美术风格、背景内容或文字。
${identityRule}

景别必须以主人物为准，并按裁切位置和占比判断：五官局部=大特写；头肩且头部高度通常超过画面30%=特写；胸部以上=近景；腰部以上=中近景；膝盖以上=中景；全身可见=全景；人物很小=大全景。
角度必须区分摄影机相对主人物的水平角度 yaw：正面0，摄影机在人物右前方为正45，右侧90，背面180，左侧-90。pitch：仰拍为负，俯拍为正。roll：画面顺时针倾斜为正。
每个人返回身体框 bbox 和头部框 headBox，坐标均为0到1。cropAt 表示画面下边缘裁到人物的哪个部位。明确标记唯一主人物 isPrimary。

只返回 JSON：{"shotType":"大特写/特写/近景/中近景/中景/全景/大全景","cameraHeight":"low/eye/high","cameraAngle":"front/side/back/over-shoulder","cameraYawDeg":0,"cameraPitchDeg":0,"cameraRollDeg":0,"focalLengthMm":50,"horizonY":0.5,"confidence":0.8,"composition":"single/two-shot/group/over-shoulder","people":[{"name":"人物1","horizontal":0,"depth":0.5,"facingDeg":0,"pose":"stand/sit/walk/run/kneel/lie","bbox":{"x":0.2,"y":0.1,"width":0.5,"height":0.9},"headBox":{"x":0.35,"y":0.1,"width":0.2,"height":0.25},"cropAt":"none/feet/knees/waist/chest/shoulders/face","isPrimary":true,"confidence":0.9}]}`,
  });
  if (!result.success) throw new Error(result.error || '图片站位识别失败');
  const parsed = parseJson(result.output);
  const rawPeople = Array.isArray(parsed.people) ? parsed.people : [];
  const clamp = (value: unknown, min: number, max: number, fallback: number) => {
    const number = Number(value);
    return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
  };
  const box = (value: unknown): NormalizedBox | undefined => {
    if (!value || typeof value !== 'object') return undefined;
    const item = value as Record<string, unknown>;
    return {
      x: clamp(item.x, 0, 1, 0), y: clamp(item.y, 0, 1, 0),
      width: clamp(item.width, 0, 1, 0), height: clamp(item.height, 0, 1, 0),
    };
  };
  const peopleLimit = expectedCharacterNames.length || 12;
  const usedNames = new Set<string>();
  const people = rawPeople.slice(0, peopleLimit).map((item, index) => {
    const person = item as Record<string, unknown>;
    const pose = ['stand', 'sit', 'walk', 'run', 'kneel', 'lie'].includes(String(person.pose)) ? String(person.pose) as DirectorImagePerson['pose'] : 'stand';
    const cropAt = ['none', 'feet', 'knees', 'waist', 'chest', 'shoulders', 'face'].includes(String(person.cropAt)) ? String(person.cropAt) as DirectorImagePerson['cropAt'] : 'none';
    const rawName = typeof person.name === 'string' ? person.name.trim() : '';
    const canonicalName = expectedCharacterNames.find((name) => !usedNames.has(name) && (rawName === name || rawName.includes(name) || name.includes(rawName)))
      ?? expectedCharacterNames.find((name) => !usedNames.has(name));
    if (canonicalName) usedNames.add(canonicalName);
    return {
      id: `recognition-${nanoid(6)}`,
      name: canonicalName ?? (rawName || `人物 ${index + 1}`),
      horizontal: clamp(person.horizontal, -1, 1, 0), depth: clamp(person.depth, 0, 1, 0.5),
      facingDeg: clamp(person.facingDeg, -360, 360, 0), pose,
      bbox: box(person.bbox), headBox: box(person.headBox), cropAt,
      isPrimary: Boolean(person.isPrimary), confidence: clamp(person.confidence, 0, 1, 0.6), enabled: true,
    };
  });
  if (people.length > 0 && !people.some((person) => person.isPrimary)) {
    const largest = people.reduce((best, item) => (item.bbox?.height ?? 0) > (best.bbox?.height ?? 0) ? item : best, people[0]);
    largest.isPrimary = true;
  }
  const primary = people.find((person) => person.isPrimary) ?? people[0];
  const headRatio = primary?.headBox?.height ?? 0;
  const bodyRatio = primary?.bbox?.height ?? 0;
  const cropAt = primary?.cropAt ?? 'none';
  const rawShotType = typeof parsed.shotType === 'string' ? parsed.shotType : '中景';
  const shotScale = deriveShotScale(rawShotType, headRatio, bodyRatio, cropAt);
  return {
    shotType: shotScaleLabel(shotScale), shotScale,
    cameraHeight: parsed.cameraHeight === 'low' || parsed.cameraHeight === 'high' ? parsed.cameraHeight : 'eye',
    cameraAngle: parsed.cameraAngle === 'side' || parsed.cameraAngle === 'back' || parsed.cameraAngle === 'over-shoulder' ? parsed.cameraAngle : 'front',
    cameraYawDeg: clamp(parsed.cameraYawDeg, -180, 180, 0), cameraPitchDeg: clamp(parsed.cameraPitchDeg, -75, 85, 0),
    cameraRollDeg: clamp(parsed.cameraRollDeg, -30, 30, 0), focalLengthMm: clamp(parsed.focalLengthMm, 18, 135, defaultFocalLength(shotScale)),
    horizonY: clamp(parsed.horizonY, 0, 1, 0.5), confidence: clamp(parsed.confidence, 0, 1, 0.65),
    composition: ['single', 'two-shot', 'group', 'over-shoulder'].includes(String(parsed.composition)) ? parsed.composition as DirectorImageAnalysis['composition'] : people.length > 2 ? 'group' : people.length === 2 ? 'two-shot' : 'single',
    people,
  };
}

export function shotScaleLabel(scale: DirectorShotScale): string {
  return ({ 'extreme-wide': '大全景', wide: '全景', medium: '中景', 'medium-close': '中近景', 'close-up': '特写', 'extreme-close-up': '大特写' } as const)[scale];
}

function deriveShotScale(raw: string, head: number, body: number, crop: DirectorImagePerson['cropAt']): DirectorShotScale {
  if (crop === 'face' || head >= 0.55 || raw.includes('大特写')) return 'extreme-close-up';
  if (crop === 'shoulders' || crop === 'chest' || head >= 0.28 || raw === '特写') return 'close-up';
  if (crop === 'waist' || raw.includes('近景') || raw.includes('中近')) return 'medium-close';
  if (crop === 'knees' || body >= 0.62 || raw === '中景') return 'medium';
  if (body > 0 && body < 0.38 || raw.includes('大全景')) return 'extreme-wide';
  return 'wide';
}

function defaultFocalLength(scale: DirectorShotScale): number {
  return ({ 'extreme-wide': 24, wide: 35, medium: 50, 'medium-close': 65, 'close-up': 85, 'extreme-close-up': 105 } as const)[scale];
}

export function analysisToElements(analysis: DirectorImageAnalysis): DirectorElement[] {
  return analysis.people.filter((person) => person.enabled).map((person, index) => ({
    id: `el-recognized-${nanoid(7)}`,
    kind: 'mannequin',
    name: person.name || `人物 ${index + 1}`,
    position: { x: person.horizontal * 3.2, y: person.pose === 'sit' ? -0.4 : person.pose === 'kneel' ? -0.28 : person.pose === 'lie' ? -0.75 : 0, z: person.depth * 3 - 1.5 },
    rotationDeg: { x: 0, y: person.facingDeg, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: '#d7d9dd', visible: true, groupId: null,
    poseId: person.pose, joints: {}, heightM: 1.7, identitySource: 'image-analysis',
  } as MannequinElement));
}

export function analysisToShotLayout(analysis: DirectorImageAnalysis, elements: DirectorElement[]): {
  elementStates: Record<string, DirectorElementState>;
  camera: { position: Vec3; target: Vec3; fov: number; rollDeg: number; focalLengthMm: number };
  primaryElementId?: string;
  recognition: DirectorRecognitionMeta;
} {
  const people = analysis.people.filter((person) => person.enabled);
  const mannequins = elements.filter((element) => element.kind === 'mannequin');
  const elementStates = Object.fromEntries(elements.map((element) => [element.id, {
    position: { ...element.position }, rotationDeg: { ...element.rotationDeg }, scale: { ...element.scale }, visible: element.visible,
  }]));
  const assignedPeople = new Set<string>();
  mannequins.forEach((element, index) => {
    const person = people.find((item) => !assignedPeople.has(item.id) && (item.name === element.name || item.name.includes(element.name) || element.name.includes(item.name)))
      ?? people.find((item) => !assignedPeople.has(item.id))
      ?? people[index];
    if (person) assignedPeople.add(person.id);
    elementStates[element.id] = person ? {
      position: {
        x: person.horizontal * 3.2,
        y: person.pose === 'sit' ? -0.4 : person.pose === 'kneel' ? -0.28 : person.pose === 'lie' ? -0.75 : 0,
        z: person.depth * 3 - 1.5,
      },
      rotationDeg: { x: 0, y: person.facingDeg, z: 0 },
      scale: { ...element.scale },
      visible: true,
    } : { ...elementStates[element.id], visible: elementStates[element.id]?.visible ?? true };
  });
  const primaryIndex = Math.max(0, people.findIndex((person) => person.isPrimary));
  const primaryElement = mannequins[primaryIndex] ?? mannequins[0];
  const primaryState = primaryElement ? elementStates[primaryElement.id] : undefined;
  const targetY = analysis.shotScale === 'extreme-close-up' ? 1.53 : analysis.shotScale === 'close-up' ? 1.42 : analysis.shotScale === 'medium-close' ? 1.2 : 1;
  const target = primaryState ? { x: primaryState.position.x, y: targetY, z: primaryState.position.z } : { x: 0, y: targetY, z: 0 };
  const focalLengthMm = analysis.focalLengthMm || defaultFocalLength(analysis.shotScale);
  const fov = Math.max(12, Math.min(65, (2 * Math.atan(24 / (2 * focalLengthMm)) * 180) / Math.PI));
  const primaryPerson = people[primaryIndex];
  const measuredRatio = analysis.shotScale === 'close-up' || analysis.shotScale === 'extreme-close-up'
    ? Math.max(0.18, primaryPerson?.headBox?.height ?? (analysis.shotScale === 'extreme-close-up' ? 0.6 : 0.34))
    : Math.max(0.22, primaryPerson?.bbox?.height ?? ({ 'extreme-wide': 0.2, wide: 0.48, medium: 0.72, 'medium-close': 0.95 } as Record<string, number>)[analysis.shotScale] ?? 0.7);
  const measuredHeight = analysis.shotScale === 'close-up' || analysis.shotScale === 'extreme-close-up' ? 0.24 : 1.7;
  const distance = Math.max(0.8, Math.min(18, measuredHeight / (2 * measuredRatio * Math.tan((fov * Math.PI / 180) / 2))));
  const yaw = analysis.cameraYawDeg * Math.PI / 180;
  const pitch = analysis.cameraPitchDeg * Math.PI / 180;
  const horizontalDistance = Math.max(0.5, distance * Math.cos(pitch));
  const position = {
    x: target.x + Math.sin(yaw) * horizontalDistance,
    y: Math.max(0.35, target.y + Math.sin(pitch) * distance),
    z: target.z + Math.cos(yaw) * horizontalDistance,
  };
  return {
    elementStates,
    camera: {
      position, target, fov, rollDeg: analysis.cameraRollDeg, focalLengthMm,
    },
    primaryElementId: primaryElement?.id,
    recognition: {
      version: 2, confidence: analysis.confidence, rawShotType: analysis.shotType,
      evidence: { headHeightRatio: primaryPerson?.headBox?.height, bodyHeightRatio: primaryPerson?.bbox?.height, cropAt: primaryPerson?.cropAt, horizonY: analysis.horizonY },
      cameraYawDeg: analysis.cameraYawDeg, cameraPitchDeg: analysis.cameraPitchDeg, cameraRollDeg: analysis.cameraRollDeg,
      composition: analysis.composition,
    },
  };
}
