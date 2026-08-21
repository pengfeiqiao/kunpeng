import { nanoid } from 'nanoid';
import { useDirectorStore } from '@/stores/directorStore';
import { useChatStore } from '@/stores';
import type { WsShot } from '@/lib/workshop/types';
import type { DirectorElement, DirectorOrigin, DirectorPlan, DirectorSequenceShot, MannequinElement, PrimitiveElement } from './types';
import { actorIdentityColor } from './identityPalette';

type LaunchCharacter = { id: string; name: string; assetImagePath?: string };
export type WorkshopDirectorMode = 'storyboard' | 'video-prompt';

export interface WorkshopDirectorLaunch {
  origin: DirectorOrigin;
  seed: { elements: DirectorElement[]; plans: DirectorPlan[] };
}

export function mannequinFor(character: LaunchCharacter, index: number): MannequinElement {
  return {
    id: `el-character-${character.id}`,
    kind: 'mannequin',
    name: character.name,
    characterId: character.id,
    identitySource: 'workshop',
    position: { x: (index - 0.5) * 1.2, y: 0, z: 0 },
    rotationDeg: { x: 0, y: index % 2 ? -20 : 20, z: 0 },
    scale: { x: 1, y: 1, z: 1 },
    color: actorIdentityColor(index),
    visible: true,
    groupId: null,
    poseId: 'stand',
    joints: {},
    heightM: 1.7,
    performanceProfileId: 'neutral', dominantHand: 'right', motionScale: 1, personalSpaceM: 0.8,
  };
}

function elementStates(elements: DirectorElement[]) {
  return Object.fromEntries(elements.map((element) => [element.id, {
    position: { ...element.position }, rotationDeg: { ...element.rotationDeg },
    scale: { ...element.scale }, visible: element.visible,
  }]));
}

function proxyElementsFromPrompt(prompt: string): PrimitiveElement[] {
  const definitions: Array<{ pattern: RegExp; name: string; kind: PrimitiveElement['kind']; position: { x: number; y: number; z: number }; scale: { x: number; y: number; z: number } }> = [
    { pattern: /门|门口/, name: '门代理', kind: 'wall', position: { x: 2.5, y: 1.2, z: -1 }, scale: { x: 0.8, y: 1, z: 1 } },
    { pattern: /桌|桌边|桌前/, name: '桌子代理', kind: 'box', position: { x: 0.8, y: 0.42, z: 0.5 }, scale: { x: 1.5, y: 0.82, z: 0.8 } },
    { pattern: /椅|坐下|座位/, name: '座椅代理', kind: 'box', position: { x: -0.6, y: 0.24, z: 0.7 }, scale: { x: 0.55, y: 0.48, z: 0.55 } },
    { pattern: /车|汽车|上车|下车/, name: '车辆代理', kind: 'box', position: { x: 2.4, y: 0.65, z: 1.5 }, scale: { x: 2.2, y: 1.3, z: 4 } },
  ];
  return definitions.filter((item) => item.pattern.test(prompt)).map((item) => ({
    id: `el-proxy-${nanoid(7)}`, kind: item.kind, name: item.name,
    position: item.position, rotationDeg: { x: 0, y: 0, z: 0 }, scale: item.scale,
    color: '#8b9098', visible: true, groupId: null,
  }));
}

function seededPlan(shot: WsShot, elements: DirectorElement[], mode: WorkshopDirectorMode): DirectorPlan {
  const frames = mode === 'storyboard' ? (shot.storyboardFrames ?? []).filter((frame) => frame.prompt || frame.imagePath) : [];
  const count = frames.length || 4;
  const total = Math.max(1, shot.durationSec ?? 15);
  const perShot = total / count;
  const sequence: DirectorSequenceShot[] = Array.from({ length: count }, (_, index) => {
    const yaw = ((index % 4) - 1.5) * 0.22;
    const distance = index % 4 === 2 ? 4.1 : index % 4 === 1 ? 5.2 : 6.8;
    const position = { x: Math.sin(yaw) * distance, y: index % 3 === 0 ? 2.4 : 1.8, z: Math.cos(yaw) * distance };
    const target = { x: 0, y: 1, z: 0 };
    return {
      id: `shot-${nanoid(7)}`,
      name: frames[index] ? `分镜 ${index + 1}` : `镜头 ${index + 1}`,
      position,
      target,
      fov: index % 4 === 2 ? 34 : 48,
      aspect: (shot.videoRatio === '9:16' || shot.videoRatio === '4:3' || shot.videoRatio === '1:1') ? shot.videoRatio : '16:9',
      createdAt: Date.now(),
      startSec: index * perShot,
      durationSec: perShot,
      cameraEnd: { position: { ...position }, target: { ...target }, fov: index % 4 === 2 ? 34 : 48 },
      cameraMove: mode === 'video-prompt' ? (index % 2 ? 'push' : 'static') : 'static',
      elementStates: elementStates(elements),
      actions: [],
      sourceFrameId: frames[index]?.id,
      notes: frames[index]?.prompt || undefined,
    };
  });
  return {
    id: `plan-${nanoid(7)}`,
    name: mode === 'storyboard' ? '分镜还原' : '提示词预演',
    summary: `${total.toFixed(1)} 秒 · ${count} 镜 · ${shot.shotNo}`,
    createdAt: Date.now(),
    shots: sequence,
  };
}

export function buildWorkshopDirectorLaunch(
  shot: WsShot,
  characters: LaunchCharacter[],
  projectId: string,
  mode: WorkshopDirectorMode,
): WorkshopDirectorLaunch {
  const selected = (shot.characterIds ?? []).map((id) => characters.find((character) => character.id === id)).filter(Boolean) as LaunchCharacter[];
  const people = selected.map(mannequinFor);
  const prompt = shot.videoPrompt || shot.description || '';
  const elements: DirectorElement[] = mode === 'video-prompt' ? [...people, ...proxyElementsFromPrompt(prompt)] : people;
  const sourceFrames = (shot.storyboardFrames ?? []).filter((frame) => frame.prompt || frame.imagePath);
  const framePaths = sourceFrames.map((frame) => frame.imagePath ?? '');
  const characterReferencePath = sourceFrames.find((frame) => frame.imagePath && selected.some((character) => frame.prompt?.includes(character.name)))?.imagePath
    ?? framePaths.find(Boolean);
  const origin: DirectorOrigin = {
    kind: mode === 'storyboard' ? 'workshop-storyboard' : 'workshop-video-prompt',
    title: `${shot.shotNo} · ${shot.description || (mode === 'storyboard' ? '分镜白模' : '动作预演')}`,
    projectId,
    shotNo: shot.shotNo,
    prompt: mode === 'video-prompt' ? (shot.videoPrompt || shot.description) : (shot.imagePrompt || shot.description),
    storyboardFrameIds: sourceFrames.map((frame) => frame.id),
    referenceImagePaths: mode === 'storyboard' ? framePaths : characterReferencePath ? [characterReferencePath] : [],
  };
  return { origin, seed: { elements, plans: [seededPlan(shot, elements, mode)] } };
}

export function openWorkshopDirector(
  shot: WsShot,
  characters: LaunchCharacter[],
  projectId: string,
  mode: WorkshopDirectorMode,
): void {
  const launch = buildWorkshopDirectorLaunch(shot, characters, projectId, mode);
  useDirectorStore.getState().prepareLaunch(launch.origin, launch.seed);
  useChatStore.getState().setActiveView('canvas');
  window.setTimeout(() => window.dispatchEvent(new CustomEvent('kunpeng-open-director', { detail: { origin: launch.origin } })), 80);
}
