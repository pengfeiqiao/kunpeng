import { nanoid } from 'nanoid';
import { runGeneration } from '@/lib/canvasGen';
import { saveCanvasImage } from '@/lib/canvas/assetPersist';
import { appendArtifact } from '@/lib/artifacts';
import { getSceneReferencePaths, useWorkshopStore } from '@/stores/workshopStore';
import { useDirectorStore } from '@/stores/directorStore';
import type { DirectorEngine } from './engine';
import { spawnIsolatedCanvasOutput } from './export';
import type { DirectorOrigin, DirectorSequenceShot } from './types';

export interface FinalImageOptions {
  engineId: 'gpt-image-2' | 'seedream-v5-pro';
  resolution: '1k' | '2k' | '4k';
  writeBack: boolean;
  placeOnCanvas: boolean;
}

function workshopContext(origin: DirectorOrigin) {
  const store = useWorkshopStore.getState();
  const data = store.data;
  const shot = data?.shots.find((item) => item.shotNo === origin.shotNo);
  if (!data || !shot) return null;
  const characters = (shot.characterIds ?? []).map((id) => data.characters.find((item) => item.id === id)).filter(Boolean);
  const props = (shot.propIds ?? []).map((id) => (data.props ?? []).find((item) => item.id === id)).filter(Boolean);
  const scenePaths = getSceneReferencePaths(shot, data.scenes);
  return { store, data, shot, characters, props, scenePaths };
}

export async function renderDirectorFinalImage(
  engine: DirectorEngine,
  directorShot: DirectorSequenceShot,
  origin: DirectorOrigin,
  options: FinalImageOptions,
): Promise<string> {
  const whitePath = await saveCanvasImage(engine.captureShot(directorShot.aspect, 1920), 'director-white-reference');
  const context = workshopContext(origin);
  const refs = [whitePath];
  if (context) {
    refs.push(...context.scenePaths);
    refs.push(...context.characters.map((item) => item!.assetImagePath).filter(Boolean) as string[]);
    refs.push(...context.props.map((item) => item!.assetImagePath).filter(Boolean) as string[]);
  }
  const maxRefs = options.engineId === 'seedream-v5-pro' ? 10 : 16;
  const prompt = `以参考图一的白模预演为唯一构图、人物站位、摄影机角度和景别依据，将白模渲染为正式电影分镜画面。白模只提供空间调度，不保留灰模材质。${context?.shot.imagePrompt || origin.prompt || origin.title}

其余参考图依次用于恢复真实场景、人物身份、服装和道具。严格保持人物数量、左右关系、朝向、遮挡和画面边界，不得增加无关人物或改变机位。画面无字幕、无说明文字、无白模、无网格。`;
  const result = await runGeneration({
    engineId: options.engineId,
    prompt,
    referenceUrls: refs.slice(0, maxRefs),
    params: { aspectRatio: directorShot.aspect, resolution: options.resolution },
    projectId: origin.projectId,
    workshopShotNo: origin.shotNo,
    workshopShotKind: 'image',
    workshopStoryboardFrameId: directorShot.sourceFrameId,
  });
  if (!result.success || !result.resultPaths[0]) throw new Error(result.error || '正式分镜没有返回图片');
  const path = result.resultPaths[0];
  await appendArtifact({ path, type: 'image', engine: options.engineId, prompt, projectId: origin.projectId, taskId: result.taskId });
  useDirectorStore.getState().addExport({ id: `director-export-${nanoid(8)}`, type: 'final-image', path, createdAt: Date.now(), planId: useDirectorStore.getState().activePlanId ?? '', shotId: directorShot.id });
  if (options.placeOnCanvas) spawnIsolatedCanvasOutput(path, origin, 'image', `${origin.title} · 正式分镜`);
  if (options.writeBack && context) {
    const frames = [...(context.shot.storyboardFrames ?? [])];
    const index = directorShot.sourceFrameId ? frames.findIndex((frame) => frame.id === directorShot.sourceFrameId) : -1;
    const candidate = { path, source: 'generate' as const, engineId: options.engineId, prompt, createdAt: Date.now() };
    if (index >= 0) {
      const frame = frames[index];
      frames[index] = { ...frame, imagePath: path, status: 'done', error: undefined, candidates: [...(frame.candidates ?? []), candidate] };
    } else {
      frames.push({ id: `sb-${nanoid(8)}`, prompt, imagePath: path, selected: true, status: 'done', refImagePaths: refs.slice(1), candidates: [candidate] });
    }
    context.store.updateShot(context.shot.shotNo, { storyboardFrames: frames });
    await context.store.commitNow();
  }
  return path;
}

export async function generateDirectorSeedanceVideo(
  previsPath: string,
  origin: DirectorOrigin,
  writeBack: boolean,
  placeOnCanvas: boolean,
): Promise<string> {
  const context = workshopContext(origin);
  const prompt = context?.shot.videoPrompt || origin.prompt || origin.title;
  if (!prompt.trim()) throw new Error('当前来源没有可用于 Seedance 的视频提示词');
  const result = await runGeneration({
    engineId: 'seedance-2.0',
    prompt,
    videoUrls: [previsPath],
    params: { ratio: context?.shot.videoRatio || '16:9', resolution: '1080p', duration: Math.min(15, Math.max(4, context?.shot.durationSec ?? 10)) },
    projectId: origin.projectId,
    workshopShotNo: origin.shotNo,
    workshopShotKind: 'video',
  });
  if (!result.success || !result.resultPaths[0]) throw new Error(result.error || 'Seedance 没有返回视频');
  const path = result.resultPaths[0];
  useDirectorStore.getState().addExport({ id: `director-export-${nanoid(8)}`, type: 'ai-video', path, createdAt: Date.now(), planId: useDirectorStore.getState().activePlanId ?? '' });
  if (placeOnCanvas) spawnIsolatedCanvasOutput(path, origin, 'video', `${origin.title} · Seedance 成片`);
  if (writeBack && context) {
    context.store.updateShot(context.shot.shotNo, { videoPath: path, genStatus: 'done', genError: undefined });
    await context.store.commitNow();
  }
  return path;
}

export async function writeBackDirectorPrevisVideo(path: string, origin: DirectorOrigin): Promise<void> {
  const context = workshopContext(origin);
  if (!context) return;
  const current = context.shot.directorPrevisVideoPaths ?? [];
  if (!current.includes(path)) {
    context.store.updateShot(context.shot.shotNo, { directorPrevisVideoPaths: [...current, path] });
    await context.store.commitNow();
  }
}

export async function writeBackDirectorStill(path: string, directorShot: DirectorSequenceShot, origin: DirectorOrigin): Promise<void> {
  const context = workshopContext(origin);
  if (!context) return;
  const frames = [...(context.shot.storyboardFrames ?? [])];
  const index = directorShot.sourceFrameId ? frames.findIndex((frame) => frame.id === directorShot.sourceFrameId) : -1;
  const candidate = { path, source: 'canvas' as const, engineId: 'director-previs', prompt: '白模构图预演', createdAt: Date.now() };
  if (index >= 0) {
    const frame = frames[index];
    frames[index] = { ...frame, candidates: [...(frame.candidates ?? []), candidate] };
  } else {
    frames.push({ id: `sb-${nanoid(8)}`, prompt: directorShot.notes || '白模构图预演', imagePath: path, selected: true, status: 'done', candidates: [candidate] });
  }
  context.store.updateShot(context.shot.shotNo, { storyboardFrames: frames });
  await context.store.commitNow();
}
