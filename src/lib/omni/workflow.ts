import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useCanvasTaskStore, type CanvasTask } from '@/stores/canvasTaskStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useEditorStore, type EditorClip, type ReferenceTranscriptSegment } from '@/stores/editorStore';
import { probeDuration } from '@/lib/canvas/videoCompose';
import { collectNodeReferences, selfVideoFallback } from '@/lib/canvas/collectRefs';
import { buildOmniMgPrompt, type MgMotionRecipe } from '@/lib/omni/styles';
import { runOmniGeneration, type OmniGenerateResult } from '@/lib/omni/client';
import { runGeneration } from '@/lib/canvasGen';
import { generateImage } from '@/lib/imageGen/client';
import { runKuaiziSeedance2Generation } from '@/lib/kuaizi/seedance';
import {
  extractMgVideoReferenceFrames,
  generateMgReferenceBoards,
  materializeMgReferenceBoardsOnCanvas,
  sourceRefsWithoutGeneratedMgBoards,
  type MgReferenceBoardResult,
} from '@/lib/omni/referenceBoards';
import { composeMgSubmittedImageRefs } from '@/lib/omni/referenceContract';
import { normalizeKuaiziDuration } from '@/lib/kuaizi/duration';
import { paidRetryStoppedMessage, shouldStopAutomaticPaidFallback } from '@/lib/billingSafety';

export const OMNI_MG_ENGINE_ID = 'omni-mg-animation';
export type MgVideoEngine = 'omni' | 'minimax-h3' | 'seedance-mini';

function updateTask(taskId: string, patch: Partial<CanvasTask>): void {
  useCanvasTaskStore.getState().updateTask(taskId, patch);
}

function kuaiziSeedanceFailureMessage(error: unknown): string {
  return shouldStopAutomaticPaidFallback(error, 'kuaizi-video')
    ? paidRetryStoppedMessage(error, '筷子丽帧')
    : error instanceof Error ? error.message : String(error);
}

function kuaiziSeedanceFailureResult(error: unknown): Pick<OmniGenerateResult, 'error' | 'preventFallback'> {
  const preventFallback = shouldStopAutomaticPaidFallback(error, 'kuaizi-video');
  return {
    preventFallback,
    error: preventFallback
      ? paidRetryStoppedMessage(error, '筷子丽帧')
      : error instanceof Error ? error.message : String(error),
  };
}

function asAspectRatio(v: unknown): '16:9' | '9:16' {
  return v === '9:16' ? '9:16' : '16:9';
}

function nearestOmniDuration(seconds: number): 4 | 6 | 10 {
  void seconds;
  return 10;
}

function textPlatePrompt(prompt: string, aspectRatio: '16:9' | '9:16', styleName?: string): string {
  return [
    `生成一张 ${aspectRatio} 的 720p MG 动画文字定版参考图，用于后续视频生成严格参考。`,
    '最高优先级：所有可见文字必须与下面用户原文完全一致，不得改写、翻译、增删、错别字、乱码或生成无关小字。',
    '如果文字较多，请做成清晰的分层版式：主标题最大，次级文字做成 2-4 个清晰短标签或卡片；不要生成密密麻麻的小字。',
    '设计要像高级 MG 动画的定帧：清晰构图、足够留白、图标/箭头/UI 卡片辅助，文字边缘锐利，高对比，可读性第一。',
    styleName ? `视觉风格参考：${styleName}。` : '',
    `用户原文：${prompt}`,
  ].filter(Boolean).join('\n');
}

function cleanGeneratedPrompt(raw: string): string {
  let s = raw.trim();
  s = s.replace(/^```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1);
  }
  return s.trim();
}

export function isMgTextFallbackRequest(text: string): boolean {
  return /文字.*(错|錯|错误|錯誤|乱码|亂碼|不对|不對|不准|还是错|仍然错|有问题)|字幕.*(错|乱码|不对|有问题)|不满意|不滿意|还是不行|仍然不行|重做.*文字|字.*(错|亂|乱)|文案.*(错|不对)/i.test(text);
}

function seedanceFallbackPrompt(args: {
  userPrompt: string;
  styleName?: string;
  duration: number;
}): string {
  return [
    'Use the provided reference image as the locked visual design board and first-frame style reference.',
    'Highest priority: preserve every visible Chinese character and all typography exactly as shown in the reference image. Do not invent, replace, translate, misspell, or add any text.',
    'Animate the design into a premium MG motion-graphics video: subtle camera push, layered parallax, card/shape reveals, icon motion, mask wipes, elastic easing, and clean transitions.',
    'If any text needs to move, move the whole text layer as an image plate; never redraw or regenerate the characters.',
    `Duration: ${args.duration}s. Resolution: 720p.`,
    args.styleName ? `Style direction: ${args.styleName}.` : '',
    '',
    'User requirement:',
    args.userPrompt,
  ].filter(Boolean).join('\n');
}

export async function runMgTextFallbackForCanvasNode(
  nodeId: string,
  opts: {
    prompt?: string;
    styleId?: string;
    duration?: number;
    aspectRatio?: '16:9' | '9:16';
  } = {},
): Promise<OmniGenerateResult> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== 'video') {
    return { success: false, resultUrls: [], resultPaths: [], error: '文字兜底需要选择一个视频 / MG 动画节点' };
  }
  const data = node.data as Record<string, unknown>;
  const prompt = cleanGeneratedPrompt(String(opts.prompt ?? data.description ?? '').trim());
  if (!prompt) {
    return { success: false, resultUrls: [], resultPaths: [], error: '请先填写用于文字兜底的提示词 / 文案' };
  }
  const aspectRatio = opts.aspectRatio ?? asAspectRatio(data.aspectRatio);
  const duration = opts.duration ?? Number(data.duration ?? 6);
  const safeDuration = normalizeKuaiziDuration(duration, 6);
  const styleName = opts.styleId || String(data.mgStyleId ?? '');
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId,
    kind: 'video',
    engineId: 'mg-text-fallback-seedance-mini',
    engineLabel: 'MG文字兜底 · GPT-Image-2 + Seedance Mini',
    endpoint: 'gpt-image-2 -> kuaizi-lz/seedance-2.0-mini',
    prompt,
    params: { aspectRatio, ratio: aspectRatio, resolution: '720p', duration: String(safeDuration), mode: 'mini' },
    inFlight: true,
  });

  const patchTask = (patch: Partial<CanvasTask>) => updateTask(taskId, patch);
  patchTask({ status: 'uploading', progress: '文字仍有问题，启动二次兜底：先生成文字定版图…' });
  store.updateNode(nodeId, {
    isGenerating: true,
    description: prompt,
    modelVersion: 'seedance-2.0-mini',
    resolution: '720p',
    duration: safeDuration,
  });

  try {
    const plate = await generateImage({
      model: 'gpt-image-2',
      prompt: textPlatePrompt(prompt, aspectRatio, styleName),
      aspectRatio,
      size: aspectRatio === '9:16' ? '1152x2048' : '2048x1152',
      quality: 'high',
    });
    if (!plate.success || !plate.imagePath) {
      throw new Error(`文字定版图生成失败：${plate.error || 'GPT-Image-2 未返回图片'}`);
    }
    patchTask({
      status: 'running',
      progress: '文字定版图已生成，交给筷子 Seedance 2.0 Mini 做图生视频…',
      referenceUrls: [plate.imagePath],
    });

    const result = await runKuaiziSeedance2Generation({
      prompt: seedanceFallbackPrompt({ userPrompt: prompt, styleName, duration: safeDuration }),
      referenceUrls: [plate.imagePath],
      params: {
        mode: 'mini',
        resolution: '720p',
        ratio: aspectRatio,
        duration: safeDuration,
        generateAudio: false,
      },
      imageRoles: ['first_frame'],
      onProviderTaskCreated: (remoteTaskId) => patchTask({ rhTaskId: remoteTaskId, status: 'running', progress: `已提交 Seedance Mini 任务 ${remoteTaskId}…` }),
      onProgress: (message) => patchTask({
        status: /下载/.test(message) ? 'downloading' : /上传|COS/.test(message) ? 'uploading' : 'running',
        progress: message,
      }),
    });
    if (!result.resultPaths[0]) throw new Error('Seedance Mini 未返回视频文件');

    patchTask({
      status: 'succeeded',
      progress: '完成（文字兜底）',
      resultPaths: result.resultPaths,
      resultUrls: result.resultUrls,
      finishedAt: Date.now(),
    });
    store.updateNode(nodeId, {
      isGenerating: false,
      generatedVideoUrl: convertFileSrc(result.resultPaths[0]),
      localPath: result.resultPaths[0],
      mediaRole: 'output',
      textFallbackImagePath: plate.imagePath,
      justCompletedAt: Date.now(),
    });
    return {
      success: true,
      taskId,
      resultUrls: result.resultUrls,
      resultPaths: result.resultPaths,
    };
  } catch (err) {
    const failure = kuaiziSeedanceFailureResult(err);
    const msg = failure.error || kuaiziSeedanceFailureMessage(err);
    patchTask({ status: 'failed', error: msg, progress: msg, finishedAt: Date.now() });
    store.updateNode(nodeId, { isGenerating: false });
    return { success: false, taskId, resultUrls: [], resultPaths: [], ...failure };
  } finally {
    patchTask({ inFlight: false });
  }
}

export async function runMgTextFallbackStandalone(args: {
  prompt: string;
  aspectRatio?: '16:9' | '9:16';
  duration?: number;
  styleName?: string;
  nodeId?: string;
  label?: string;
  onProgress?: (message: string) => void;
}): Promise<OmniGenerateResult & { textPlatePath?: string }> {
  const prompt = cleanGeneratedPrompt(args.prompt);
  if (!prompt) return { success: false, resultUrls: [], resultPaths: [], error: '请提供用于文字兜底的提示词 / 文案' };
  const aspectRatio = args.aspectRatio ?? '16:9';
  const duration = args.duration ?? 6;
  const safeDuration = [4, 6, 10].includes(duration) ? duration : 6;
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId: args.nodeId ?? '',
    kind: 'video',
    engineId: 'mg-text-fallback-seedance-mini',
    engineLabel: args.label ?? 'MG文字兜底 · GPT-Image-2 + Seedance Mini',
    endpoint: 'gpt-image-2 -> kuaizi-lz/seedance-2.0-mini',
    prompt,
    params: { aspectRatio, ratio: aspectRatio, resolution: '720p', duration: String(safeDuration), mode: 'mini' },
    inFlight: true,
  });
  const patchTask = (patch: Partial<CanvasTask>) => updateTask(taskId, patch);
  try {
    const say = (message: string) => {
      args.onProgress?.(message);
      patchTask({ progress: message });
    };
    patchTask({ status: 'uploading', progress: '启动文字兜底：先生成 GPT-Image-2 文字定版图…' });
    say('启动文字兜底：先生成 GPT-Image-2 文字定版图…');
    const plate = await generateImage({
      model: 'gpt-image-2',
      prompt: textPlatePrompt(prompt, aspectRatio, args.styleName),
      aspectRatio,
      size: aspectRatio === '9:16' ? '1152x2048' : '2048x1152',
      quality: 'high',
    });
    if (!plate.success || !plate.imagePath) {
      throw new Error(`文字定版图生成失败：${plate.error || 'GPT-Image-2 未返回图片'}`);
    }
    patchTask({ status: 'running', referenceUrls: [plate.imagePath] });
    say('文字定版图已生成，交给筷子 Seedance 2.0 Mini 做图生视频…');
    const result = await runKuaiziSeedance2Generation({
      prompt: seedanceFallbackPrompt({ userPrompt: prompt, styleName: args.styleName, duration: safeDuration }),
      referenceUrls: [plate.imagePath],
      params: {
        mode: 'mini',
        resolution: '720p',
        ratio: aspectRatio,
        duration: safeDuration,
        generateAudio: false,
      },
      imageRoles: ['first_frame'],
      onProviderTaskCreated: (remoteTaskId) => patchTask({ rhTaskId: remoteTaskId, status: 'running', progress: `已提交 Seedance Mini 任务 ${remoteTaskId}…` }),
      onProgress: (message) => patchTask({
        status: /下载/.test(message) ? 'downloading' : /上传|COS/.test(message) ? 'uploading' : 'running',
        progress: message,
      }),
    });
    if (!result.resultPaths[0]) throw new Error('Seedance Mini 未返回视频文件');
    patchTask({
      status: 'succeeded',
      progress: '完成（文字兜底）',
      resultPaths: result.resultPaths,
      resultUrls: result.resultUrls,
      finishedAt: Date.now(),
    });
    return {
      success: true,
      taskId,
      resultUrls: result.resultUrls,
      resultPaths: result.resultPaths,
      textPlatePath: plate.imagePath,
    };
  } catch (err) {
    const failure = kuaiziSeedanceFailureResult(err);
    const msg = failure.error || kuaiziSeedanceFailureMessage(err);
    patchTask({ status: 'failed', error: msg, progress: msg, finishedAt: Date.now() });
    return { success: false, taskId, resultUrls: [], resultPaths: [], ...failure };
  } finally {
    patchTask({ inFlight: false });
  }
}

export async function runMgTextFallbackForEditorSegment(
  plan: EditorOmniSegmentPlan,
  styleName?: string,
): Promise<OmniGenerateResult & { textPlatePath?: string }> {
  const editor = useEditorStore.getState();
  const aspectRatio = asAspectRatio(editor.aspect);
  const result = await runMgTextFallbackStandalone({
    prompt: plan.prompt,
    aspectRatio,
    duration: plan.duration,
    styleName,
    label: '剪辑MG文字兜底 · GPT-Image-2 + Seedance Mini',
  });
  if (result.success && result.resultPaths[0]) {
    const duration = await probeDuration(result.resultPaths[0]).catch(() => plan.duration);
    const overlayId = await useEditorStore.getState().addOverlayClip({
      path: result.resultPaths[0],
      kind: 'video',
      trackIndex: 0,
      label: plan.label || 'MG文字兜底',
      startSec: plan.startSec,
    });
    useEditorStore.getState().updateOverlayClip(overlayId, {
      duration: Math.min(duration, plan.duration),
      outSec: Math.min(duration, plan.duration),
    });
  }
  return result;
}

function canvasMgInputs(nodeId: string): {
  sourceImageRefs: string[];
  videoRefs: string[];
  audioRefs: string[];
} {
  const collected = collectNodeReferences(nodeId);
  return {
    sourceImageRefs: sourceRefsWithoutGeneratedMgBoards(nodeId, collected.images),
    videoRefs: selfVideoFallback(nodeId, collected).slice(0, 1),
    audioRefs: collected.audios.map((ref) => ref.submitUrl),
  };
}

function boardPathsFirst(
  boards: MgReferenceBoardResult,
  sourceRefs: string[],
  limit: number,
): string[] {
  return composeMgSubmittedImageRefs(
    boards.boards.map((board) => board.path),
    sourceRefs,
    limit,
  );
}

function videoReferenceMentionGuide(videoCount: number): string {
  if (videoCount <= 0) return '';
  return [
    'REFERENCE VIDEO:',
    '- @视频一 is the original motion and identity reference.',
    '- Preserve the original person, face, facial features, hairstyle, expression, lip sync, body motion, voice, artifact/product identity and background subject.',
    '- Generated MG boards control graphic style only. They must not replace or reinterpret the protected subject from @视频一.',
  ].join('\n');
}

export async function runOmniForCanvasNode(nodeId: string, styleId?: string): Promise<OmniGenerateResult> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((n) => n.id === nodeId);
  if (!node || node.type !== 'video') {
    return { success: false, resultUrls: [], resultPaths: [], error: '请选择一个视频节点或 MG 动画节点' };
  }
  const data = node.data as Record<string, unknown>;
  const prompt = String(data.description ?? '').trim();
  if (!prompt) {
    return { success: false, resultUrls: [], resultPaths: [], error: '请先填写 MG 动画提示词' };
  }

  const duration = 10;
  const { sourceImageRefs, videoRefs } = canvasMgInputs(nodeId);
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId,
    kind: 'video',
    engineId: OMNI_MG_ENGINE_ID,
    engineLabel: 'Omni版MG动画',
    endpoint: 'apimart-compatible/v1/videos/generations',
    prompt,
    referenceUrls: [...sourceImageRefs, ...videoRefs],
    submissionReceipt: {
      requestedImages: sourceImageRefs.length,
      requestedAudio: 0,
      requestedVideo: videoRefs.length,
      submittedImages: 0,
      submittedAudio: 0,
      submittedVideo: 0,
      provider: 'omni-router',
    },
    params: { aspectRatio: asAspectRatio(data.aspectRatio), resolution: '720p', duration: String(duration) },
    inFlight: true,
  });

  updateTask(taskId, { status: 'uploading', progress: '准备 Omni MG 动画…' });
  store.updateNode(nodeId, {
    isGenerating: true,
    modelVersion: OMNI_MG_ENGINE_ID,
    resolution: '720p',
    duration,
  });

  try {
    const videoStillRefs = await extractMgVideoReferenceFrames(
      videoRefs,
      (message) => updateTask(taskId, { status: 'uploading', progress: message }),
    );
    const protectedSourceRefs = [...new Set([...sourceImageRefs, ...videoStillRefs])];
    const boards = await generateMgReferenceBoards({
      userPrompt: prompt,
      styleId: styleId || String(data.mgStyleId ?? ''),
      aspectRatio: asAspectRatio(data.aspectRatio),
      duration,
      recipe: typeof data.mgRecipe === 'object' && data.mgRecipe
        ? data.mgRecipe as Partial<MgMotionRecipe>
        : undefined,
      sourceReferenceUrls: protectedSourceRefs,
      submittedSourceReferenceUrls: sourceImageRefs,
      onProgress: (message) => updateTask(taskId, { status: 'uploading', progress: message }),
    });
    materializeMgReferenceBoardsOnCanvas(nodeId, boards);
    const imageRefs = boardPathsFirst(boards, sourceImageRefs, 16);
    updateTask(taskId, {
      referenceUrls: [...imageRefs, ...videoRefs],
      submissionReceipt: {
        requestedImages: imageRefs.length,
        requestedAudio: 0,
        requestedVideo: videoRefs.length,
        submittedImages: imageRefs.length,
        submittedAudio: 0,
        submittedVideo: videoRefs.length,
        provider: 'omni-router',
      },
    });
    const result = await runOmniGeneration({
      prompt: [
        buildOmniMgPrompt({
          userPrompt: prompt,
          styleId: styleId || String(data.mgStyleId ?? ''),
          accentStyleId: typeof data.mgAccentStyleId === 'string' ? data.mgAccentStyleId : undefined,
          recipe: typeof data.mgRecipe === 'object' && data.mgRecipe
            ? data.mgRecipe as Partial<MgMotionRecipe>
            : undefined,
          duration,
          mode: videoRefs.length > 0 ? 'video' : 'image',
        }),
        boards.referenceGuide,
        videoReferenceMentionGuide(videoRefs.length),
      ].join('\n\n'),
      imageUrls: imageRefs,
      videoUrls: videoRefs,
      aspectRatio: asAspectRatio(data.aspectRatio),
      resolution: '720p',
      taskLabel: OMNI_MG_ENGINE_ID,
      onProgress: (message) => updateTask(taskId, { status: message.includes('下载') ? 'downloading' : 'running', progress: message }),
    });
    if (!result.success || !result.resultPaths[0]) {
      throw new Error(result.error || 'Omni 未返回结果');
    }
    updateTask(taskId, {
      status: 'succeeded',
      progress: result.creditsCost ? `完成 · ${result.creditsCost} 积分` : '完成',
      rhTaskId: result.taskId,
      resultUrls: result.resultUrls,
      resultPaths: result.resultPaths,
      finishedAt: Date.now(),
      submissionReceipt: {
        requestedImages: imageRefs.length,
        requestedAudio: 0,
        requestedVideo: videoRefs.length,
        submittedImages: imageRefs.length,
        submittedAudio: 0,
        submittedVideo: videoRefs.length,
        provider: result.baseUrl || 'omni-router',
      },
    });
    store.updateNode(nodeId, {
      isGenerating: false,
      generatedVideoUrl: convertFileSrc(result.resultPaths[0]),
      localPath: result.resultPaths[0],
      mediaRole: 'output',
      mgReferenceBoardPaths: boards.boards.map((board) => board.path),
      mgReferenceMasterPath: boards.masterPath,
      justCompletedAt: Date.now(),
    });
    return { ...result, taskId };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    updateTask(taskId, { status: 'failed', error: msg, progress: msg, finishedAt: Date.now() });
    store.updateNode(nodeId, { isGenerating: false });
    return { success: false, taskId, resultUrls: [], resultPaths: [], error: msg };
  } finally {
    updateTask(taskId, { inFlight: false });
  }
}

export async function runSeedanceMiniMgForCanvasNode(
  nodeId: string,
  opts: {
    styleId?: string;
    duration?: number;
    aspectRatio?: '16:9' | '9:16';
  } = {},
): Promise<OmniGenerateResult> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== 'video') {
    return { success: false, resultUrls: [], resultPaths: [], error: '请选择一个视频节点或 MG 动画节点' };
  }
  const data = node.data as Record<string, unknown>;
  const prompt = String(data.description ?? '').trim();
  if (!prompt) {
    return { success: false, resultUrls: [], resultPaths: [], error: '请先填写 MG 动画提示词' };
  }
  const duration = Math.min(15, Math.max(4, Math.round(opts.duration ?? Number(data.duration ?? 6))));
  const aspectRatio = opts.aspectRatio ?? asAspectRatio(data.aspectRatio);
  const styleId = opts.styleId || String(data.mgStyleId ?? '');
  const { sourceImageRefs, videoRefs, audioRefs } = canvasMgInputs(nodeId);
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId,
    kind: 'video',
    engineId: 'seedance-2.0-mini-i2v',
    engineLabel: 'Seedance Mini · MG 参考帧工作流',
    endpoint: 'gpt-image-2 -> kuaizi-lz/seedance-2.0-mini',
    prompt,
    referenceUrls: [...sourceImageRefs, ...videoRefs],
    params: { aspectRatio, ratio: aspectRatio, resolution: '720p', duration: String(duration), mode: 'mini' },
    inFlight: true,
  });
  const patchTask = (patch: Partial<CanvasTask>) => updateTask(taskId, patch);
  store.updateNode(nodeId, {
    isGenerating: true,
    modelVersion: 'seedance-2.0-mini-i2v',
    resolution: '720p',
    duration,
  });

  try {
    const videoStillRefs = await extractMgVideoReferenceFrames(
      videoRefs,
      (message) => patchTask({ status: 'uploading', progress: message }),
    );
    const protectedSourceRefs = [...new Set([...sourceImageRefs, ...videoStillRefs])];
    const boards = await generateMgReferenceBoards({
      userPrompt: prompt,
      styleId,
      aspectRatio,
      duration,
      recipe: typeof data.mgRecipe === 'object' && data.mgRecipe
        ? data.mgRecipe as Partial<MgMotionRecipe>
        : undefined,
      sourceReferenceUrls: protectedSourceRefs,
      submittedSourceReferenceUrls: sourceImageRefs,
      onProgress: (message) => patchTask({ status: 'uploading', progress: message }),
    });
    materializeMgReferenceBoardsOnCanvas(nodeId, boards);
    const imageRefs = boardPathsFirst(boards, sourceImageRefs, 9);
    patchTask({
      status: 'running',
      progress: '参考帧已进入画布，正在提交 Seedance Mini…',
      referenceUrls: [...imageRefs, ...videoRefs],
      submissionReceipt: {
        requestedImages: imageRefs.length,
        requestedAudio: audioRefs.length,
        requestedVideo: videoRefs.length,
        submittedImages: imageRefs.length,
        submittedAudio: audioRefs.length,
        submittedVideo: videoRefs.length,
        provider: 'kuaizi-seedance-mini',
      },
    });
    const compiledPrompt = [
      buildOmniMgPrompt({
        userPrompt: prompt,
        styleId,
        accentStyleId: typeof data.mgAccentStyleId === 'string' ? data.mgAccentStyleId : undefined,
        duration,
        mode: videoRefs.length > 0 ? 'video' : 'image',
        preservePerson: videoRefs.length > 0,
        recipe: typeof data.mgRecipe === 'object' && data.mgRecipe
          ? data.mgRecipe as Partial<MgMotionRecipe>
          : undefined,
      }),
      boards.referenceGuide,
      videoReferenceMentionGuide(videoRefs.length),
    ].join('\n\n');
    const result = await runKuaiziSeedance2Generation({
      prompt: compiledPrompt,
      referenceUrls: imageRefs,
      videoUrls: videoRefs,
      audioUrls: audioRefs,
      params: {
        mode: 'mini',
        resolution: '720p',
        ratio: aspectRatio,
        duration,
        generateAudio: true,
        realPersonMode: true,
      },
      imageRoles: imageRefs.map(() => 'reference_image'),
      onProviderTaskCreated: (remoteTaskId) => patchTask({
        rhTaskId: remoteTaskId,
        status: 'running',
        progress: `已提交 Seedance Mini 任务 ${remoteTaskId}…`,
      }),
      onProgress: (message) => patchTask({
        status: /下载/.test(message) ? 'downloading' : /上传|COS/.test(message) ? 'uploading' : 'running',
        progress: message,
      }),
    });
    if (!result.resultPaths[0]) throw new Error('Seedance Mini 未返回视频文件');
    patchTask({
      status: 'succeeded',
      progress: boards.warnings.length > 0 ? `完成 · ${boards.warnings.join('；')}` : '完成',
      resultPaths: result.resultPaths,
      resultUrls: result.resultUrls,
      finishedAt: Date.now(),
    });
    store.updateNode(nodeId, {
      isGenerating: false,
      generatedVideoUrl: convertFileSrc(result.resultPaths[0]),
      localPath: result.resultPaths[0],
      mediaRole: 'output',
      mgReferenceBoardPaths: boards.boards.map((board) => board.path),
      mgReferenceMasterPath: boards.masterPath,
      justCompletedAt: Date.now(),
    });
    return {
      success: true,
      taskId,
      resultUrls: result.resultUrls,
      resultPaths: result.resultPaths,
    };
  } catch (err) {
    const failure = kuaiziSeedanceFailureResult(err);
    const message = failure.error || kuaiziSeedanceFailureMessage(err);
    patchTask({ status: 'failed', error: message, progress: message, finishedAt: Date.now() });
    store.updateNode(nodeId, { isGenerating: false });
    return { success: false, taskId, resultUrls: [], resultPaths: [], ...failure };
  } finally {
    patchTask({ inFlight: false });
  }
}

/**
 * MiniMax H3 版 MG 参考帧工作流：与 runSeedanceMiniMgForCanvasNode 同构
 * （母版+派生参考帧 → 连同用户原始素材提交），但提交走 RunningHub 标准
 * 模型 API（minimax/hailuo-h3/multimodal-to-video，通用 runGeneration 通路）。
 * H3 限制：分辨率只有 2K，时长 5-15 秒，参考图 ≤9。
 */
export async function runMinimaxH3MgForCanvasNode(
  nodeId: string,
  opts: {
    styleId?: string;
    duration?: number;
    aspectRatio?: '16:9' | '9:16';
  } = {},
): Promise<OmniGenerateResult> {
  const store = useCanvasStore.getState();
  const node = store.nodes.find((item) => item.id === nodeId);
  if (!node || node.type !== 'video') {
    return { success: false, resultUrls: [], resultPaths: [], error: '请选择一个视频节点或 MG 动画节点' };
  }
  const data = node.data as Record<string, unknown>;
  const prompt = String(data.description ?? '').trim();
  if (!prompt) {
    return { success: false, resultUrls: [], resultPaths: [], error: '请先填写 MG 动画提示词' };
  }
  const duration = Math.min(15, Math.max(5, Math.round(opts.duration ?? Number(data.duration ?? 6))));
  const aspectRatio = opts.aspectRatio ?? asAspectRatio(data.aspectRatio);
  const styleId = opts.styleId || String(data.mgStyleId ?? '');
  const { sourceImageRefs, videoRefs, audioRefs } = canvasMgInputs(nodeId);
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId,
    kind: 'video',
    engineId: 'minimax-hailuo-h3',
    engineLabel: 'MiniMax H3 · MG 参考帧工作流',
    endpoint: 'gpt-image-2 -> minimax/hailuo-h3/multimodal-to-video',
    prompt,
    referenceUrls: [...sourceImageRefs, ...videoRefs],
    params: { aspectRatio, ratio: aspectRatio, resolution: '2K', duration: String(duration) },
    inFlight: true,
  });
  const patchTask = (patch: Partial<CanvasTask>) => updateTask(taskId, patch);
  store.updateNode(nodeId, {
    isGenerating: true,
    modelVersion: 'minimax-hailuo-h3',
    resolution: '2K',
    duration,
  });

  try {
    const videoStillRefs = await extractMgVideoReferenceFrames(
      videoRefs,
      (message) => patchTask({ status: 'uploading', progress: message }),
    );
    const protectedSourceRefs = [...new Set([...sourceImageRefs, ...videoStillRefs])];
    const boards = await generateMgReferenceBoards({
      userPrompt: prompt,
      styleId,
      aspectRatio,
      duration,
      recipe: typeof data.mgRecipe === 'object' && data.mgRecipe
        ? data.mgRecipe as Partial<MgMotionRecipe>
        : undefined,
      sourceReferenceUrls: protectedSourceRefs,
      submittedSourceReferenceUrls: sourceImageRefs,
      onProgress: (message) => patchTask({ status: 'uploading', progress: message }),
    });
    materializeMgReferenceBoardsOnCanvas(nodeId, boards);
    const imageRefs = boardPathsFirst(boards, sourceImageRefs, 9);
    patchTask({
      status: 'running',
      progress: '参考帧已进入画布，正在提交 MiniMax H3…',
      referenceUrls: [...imageRefs, ...videoRefs],
      submissionReceipt: {
        requestedImages: imageRefs.length,
        requestedAudio: audioRefs.length,
        requestedVideo: videoRefs.length,
        submittedImages: imageRefs.length,
        submittedAudio: audioRefs.length,
        submittedVideo: videoRefs.length,
        provider: 'runninghub-minimax-h3',
      },
    });
    const compiledPrompt = [
      buildOmniMgPrompt({
        userPrompt: prompt,
        styleId,
        accentStyleId: typeof data.mgAccentStyleId === 'string' ? data.mgAccentStyleId : undefined,
        duration,
        resolution: '2K',
        mode: videoRefs.length > 0 ? 'video' : 'image',
        preservePerson: videoRefs.length > 0,
        recipe: typeof data.mgRecipe === 'object' && data.mgRecipe
          ? data.mgRecipe as Partial<MgMotionRecipe>
          : undefined,
      }),
      boards.referenceGuide,
      videoReferenceMentionGuide(videoRefs.length),
    ].join('\n\n');
    // 提交/轮询/下载由 runGeneration 负责（它会自建一条提交任务记录，携带
    // rhTaskId，供断线恢复）；本 taskId 只承担参考帧阶段进度与最终状态。
    const result = await runGeneration({
      engineId: 'minimax-hailuo-h3',
      prompt: compiledPrompt,
      referenceUrls: imageRefs,
      videoUrls: videoRefs.length > 0 ? videoRefs : undefined,
      audioUrls: audioRefs.length > 0 ? audioRefs : undefined,
      params: { resolution: '2K', duration: String(duration), ratio: aspectRatio },
      nodeId,
    });
    if (!result.success || !result.resultPaths[0]) {
      throw new Error(result.error || 'MiniMax H3 未返回视频文件');
    }
    patchTask({
      status: 'succeeded',
      progress: boards.warnings.length > 0 ? `完成 · ${boards.warnings.join('；')}` : '完成',
      resultPaths: result.resultPaths,
      resultUrls: result.resultUrls,
      finishedAt: Date.now(),
    });
    store.updateNode(nodeId, {
      isGenerating: false,
      generatedVideoUrl: convertFileSrc(result.resultPaths[0]),
      localPath: result.resultPaths[0],
      mediaRole: 'output',
      mgReferenceBoardPaths: boards.boards.map((board) => board.path),
      mgReferenceMasterPath: boards.masterPath,
      justCompletedAt: Date.now(),
    });
    return {
      success: true,
      taskId: result.taskId || taskId,
      resultUrls: result.resultUrls,
      resultPaths: result.resultPaths,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    patchTask({ status: 'failed', error: message, progress: message, finishedAt: Date.now() });
    store.updateNode(nodeId, { isGenerating: false });
    return { success: false, taskId, resultUrls: [], resultPaths: [], error: message };
  } finally {
    patchTask({ inFlight: false });
  }
}

export async function runMgWithReferenceBoardsStandalone(args: {
  prompt: string;
  engine?: MgVideoEngine;
  styleId?: string;
  aspectRatio?: '16:9' | '9:16';
  duration?: number;
  sourceReferenceUrls?: string[];
  videoUrls?: string[];
  audioUrls?: string[];
  recipe?: Partial<MgMotionRecipe>;
  onProgress?: (message: string) => void;
}): Promise<OmniGenerateResult & { referenceBoardPaths?: string[]; masterBoardPath?: string }> {
  const prompt = cleanGeneratedPrompt(args.prompt);
  if (!prompt) return { success: false, resultUrls: [], resultPaths: [], error: '请提供 MG 动画内容' };
  const engine = args.engine ?? 'minimax-h3';
  const aspectRatio = args.aspectRatio ?? '16:9';
  // Omni 固定 10s；MiniMax H3 时长枚举 5-15；Seedance Mini 4-15
  const duration = engine === 'omni'
    ? 10
    : engine === 'minimax-h3'
      ? Math.min(15, Math.max(5, Math.round(args.duration ?? 6)))
      : Math.min(15, Math.max(4, Math.round(args.duration ?? 6)));
  try {
    const videoUrls = (args.videoUrls ?? []).slice(0, engine === 'omni' ? 1 : 3);
    const videoStillRefs = await extractMgVideoReferenceFrames(videoUrls, args.onProgress);
    const submittedSourceRefs = [...new Set(args.sourceReferenceUrls ?? [])];
    const protectedSourceRefs = [...new Set([
      ...submittedSourceRefs,
      ...videoStillRefs,
    ])];
    const boards = await generateMgReferenceBoards({
      userPrompt: prompt,
      styleId: args.styleId,
      aspectRatio,
      duration,
      recipe: args.recipe,
      sourceReferenceUrls: protectedSourceRefs,
      submittedSourceReferenceUrls: submittedSourceRefs,
      onProgress: args.onProgress,
    });
    const imageRefs = boardPathsFirst(
      boards,
      submittedSourceRefs,
      engine === 'omni' ? 16 : 9,
    );
    const compiledPrompt = [
      buildOmniMgPrompt({
        userPrompt: prompt,
        styleId: args.styleId,
        duration,
        resolution: engine === 'minimax-h3' ? '2K' : '720p',
        mode: args.videoUrls?.length ? 'video' : 'image',
        preservePerson: Boolean(args.videoUrls?.length),
        recipe: args.recipe,
      }),
      boards.referenceGuide,
      videoReferenceMentionGuide(videoUrls.length),
    ].join('\n\n');
    if (engine === 'omni') {
      const result = await runOmniGeneration({
        prompt: compiledPrompt,
        imageUrls: imageRefs,
        videoUrls,
        aspectRatio,
        resolution: '720p',
        taskLabel: OMNI_MG_ENGINE_ID,
        onProgress: args.onProgress,
      });
      return {
        ...result,
        referenceBoardPaths: boards.boards.map((board) => board.path),
        masterBoardPath: boards.masterPath,
      };
    }
    if (engine === 'minimax-h3') {
      // MiniMax H3：走任务 1 验证过的通用 RHTV 通路（runGeneration 按引擎声明
      // 的 imageParam/videoParam/audioParam 把 imageUrls/videoUrls/audioUrls
      // 组装进 payload）；分辨率只有 2K，ratio 透传。
      const result = await runGeneration({
        engineId: 'minimax-hailuo-h3',
        prompt: compiledPrompt,
        referenceUrls: imageRefs,
        videoUrls: videoUrls.length > 0 ? videoUrls : undefined,
        audioUrls: (args.audioUrls ?? []).length > 0 ? args.audioUrls : undefined,
        params: { resolution: '2K', duration: String(duration), ratio: aspectRatio },
      });
      return {
        success: result.success && Boolean(result.resultPaths[0]),
        taskId: result.taskId,
        resultUrls: result.resultUrls,
        resultPaths: result.resultPaths,
        error: result.success && result.resultPaths[0] ? undefined : (result.error || 'MiniMax H3 未返回视频文件'),
        preventFallback: Boolean(
          result.backgroundPending || result.submissionUncertain || result.submissionCommitted
          // A providerTaskId only blocks fallback while the remote task might
          // still deliver. Terminal rejections (balance/auth/task_failed)
          // carry no charge and must not suppress the MG engine cascade.
          || (result.providerTaskId && !result.providerFailed),
        ),
        referenceBoardPaths: boards.boards.map((board) => board.path),
        masterBoardPath: boards.masterPath,
      };
    }
    const result = await runKuaiziSeedance2Generation({
      prompt: compiledPrompt,
      referenceUrls: imageRefs,
      videoUrls,
      params: {
        mode: 'mini',
        resolution: '720p',
        ratio: aspectRatio,
        duration,
        generateAudio: true,
      },
      imageRoles: imageRefs.map(() => 'reference_image'),
      onProgress: args.onProgress,
    });
    return {
      success: Boolean(result.resultPaths[0]),
      taskId: result.taskId,
      resultUrls: result.resultUrls,
      resultPaths: result.resultPaths,
      referenceBoardPaths: boards.boards.map((board) => board.path),
      masterBoardPath: boards.masterPath,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    const stopFallback = shouldStopAutomaticPaidFallback(err, 'kuaizi-video');
    return {
      success: false,
      resultUrls: [],
      resultPaths: [],
      preventFallback: stopFallback,
      error: stopFallback
        ? paidRetryStoppedMessage(err, '筷子丽帧')
        : err instanceof Error ? err.message : String(err),
    };
  }
}

export interface EditorOmniSegmentPlan {
  label: string;
  startSec: number;
  duration: number;
  prompt: string;
  sourcePath?: string;
  sourceInSec?: number;
  generationMode?: 'video_to_mg' | 'text_to_mg';
}

function clipTimelineStart(clips: EditorClip[], clipId: string): number {
  let t = 0;
  for (const clip of clips) {
    if (clip.id === clipId) return t;
    const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
    t += (clip.outSec - clip.inSec) / speed;
  }
  return t;
}

export function planOmniSegmentsFromEditorText(text: string): EditorOmniSegmentPlan[] {
  const parts = text
    .split(/[\n。！？!?]+/)
    .map((x) => x.trim())
    .filter(Boolean);
  const chunks = parts.length > 0 ? parts : [text.trim() || '产品功能 MG 动画展示'];
  return chunks.slice(0, 6).map((chunk, i) => ({
    label: `MG ${i + 1}`,
    startSec: i * 10,
    duration: nearestOmniDuration(Math.max(4, Math.min(10, chunk.length / 8))),
    prompt: chunk,
  }));
}

export function planOmniSegmentsFromTranscript(
  segments: ReferenceTranscriptSegment[],
  userRequirement: string,
): EditorOmniSegmentPlan[] {
  const picked = segments
    .filter((s) => s.end > s.start && s.text.trim())
    .slice(0, 8);
  return picked.map((s, i) => ({
    label: `口播 MG ${i + 1}`,
    startSec: s.start,
    duration: nearestOmniDuration(s.end - s.start),
    prompt: `${userRequirement}\n根据这句口播设计图形动效：${s.text}`,
  }));
}

function orderedMgEngines(preferred: MgVideoEngine): Array<{ engine: MgVideoEngine; label: string }> {
  const labels: Record<MgVideoEngine, string> = {
    'minimax-h3': 'MiniMax H3',
    omni: 'Omni',
    'seedance-mini': 'Seedance Mini',
  };
  const fallbackOrder: MgVideoEngine[] = ['minimax-h3', 'omni', 'seedance-mini'];
  return [preferred, ...fallbackOrder.filter((engine) => engine !== preferred)]
    .map((engine) => ({ engine, label: labels[engine] }));
}

export async function runMgForEditorSegment(
  plan: EditorOmniSegmentPlan,
  styleId?: string,
  preferredEngine: MgVideoEngine = 'minimax-h3',
): Promise<OmniGenerateResult> {
  const editor = useEditorStore.getState();
  const useReferenceVideo = plan.generationMode !== 'text_to_mg';
  const sourceClip = useReferenceVideo
    ? (plan.sourcePath
        ? editor.clips.find((c) => c.path === plan.sourcePath)
        : editor.clips.find((clip) => {
            const start = clipTimelineStart(editor.clips, clip.id);
            const end = start + editor.clipLength(clip);
            return plan.startSec >= start && plan.startSec < end;
          }))
    : undefined;
  const videoUrls = sourceClip ? [sourceClip.path] : [];
  const aspectRatio = asAspectRatio(editor.aspect);

  // 只在首个成功的结果上插入 overlay（失败不插入）
  const insertOverlay = async (result: OmniGenerateResult, engineLabel?: string) => {
    const duration = await probeDuration(result.resultPaths[0]).catch(() => plan.duration);
    const overlayId = await useEditorStore.getState().addOverlayClip({
      path: result.resultPaths[0],
      kind: 'video',
      trackIndex: 0,
      label: engineLabel ? `${plan.label} · ${engineLabel}` : plan.label,
      startSec: plan.startSec,
    });
    useEditorStore.getState().updateOverlayClip(overlayId, {
      duration: Math.min(duration, plan.duration),
      outSec: Math.min(duration, plan.duration),
    });
  };

  // 明确选择的引擎优先；未选择时默认 H3。只有明确失败或没有产物时
  // 才按 H3 → Omni → Mini 的剩余顺序容灾，避免重复扣费。
  const chain = orderedMgEngines(preferredEngine);
  const failures: string[] = [];
  for (const step of chain) {
    const result = await runMgWithReferenceBoardsStandalone({
      prompt: plan.prompt,
      engine: step.engine,
      styleId,
      duration: plan.duration,
      aspectRatio,
      videoUrls,
    });
    if (result.success && result.resultPaths[0]) {
      // 降级成功时把引擎名写进 overlay 标签，方便排查
      await insertOverlay(result, step.engine === 'omni' ? undefined : step.label);
      return {
        ...result,
        engineUsed: step.label,
        error: failures.length > 0 ? `已降级到 ${step.label}（${failures.join('；')}）` : result.error,
      };
    }
    if (result.preventFallback) return result;
    failures.push(`${step.label}: ${result.error || '未返回结果'}`);
  }
  return {
    success: false,
    resultUrls: [],
    resultPaths: [],
    error: `MG 降级链全部失败——${failures.join('；')}`,
  };
}

/** 兼容旧调用方；旧函数名仍明确表示 Omni 优先。 */
export function runOmniForEditorSegment(
  plan: EditorOmniSegmentPlan,
  styleId?: string,
): Promise<OmniGenerateResult> {
  return runMgForEditorSegment(plan, styleId, 'omni');
}
