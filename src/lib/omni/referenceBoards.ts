import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { createDir } from '@tauri-apps/api/fs';
import { nanoid } from 'nanoid';
import { generateImage } from '@/lib/imageGen/client';
import { quickChat } from '@/lib/agent/quickChat';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import { useCanvasStore } from '@/stores/canvasStore';
import { getMgStylePreset, type MgMotionRecipe } from '@/lib/omni/styles';
import { assetUrlToLocalPath } from '@/lib/canvas/imageSource';
import { detectFfmpeg, probeDuration } from '@/lib/canvas/videoCompose';
import { ensureVideoThumb } from '@/lib/canvas/videoThumbs';
import {
  buildMgReferenceGuide,
  mgChineseIndex,
} from '@/lib/omni/referenceContract';

export type MgReferenceStage = 'hook' | 'develop' | 'payoff';

export interface MgReferenceFramePlan {
  label: string;
  stage: MgReferenceStage;
  visual: string;
  motion: string;
}

export interface MgReferencePlan {
  concept: string;
  frames: MgReferenceFramePlan[];
}

export interface MgReferenceBoard {
  kind: 'master' | 'frame';
  label: string;
  stage?: MgReferenceStage;
  prompt: string;
  path: string;
}

export interface MgReferenceBoardResult {
  plan: MgReferencePlan;
  boards: MgReferenceBoard[];
  masterPath: string;
  referenceGuide: string;
  warnings: string[];
}

interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

function quoteShell(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

/**
 * A video remains the authoritative motion/identity reference for the video
 * model. These stills only let the image pre-production stage see the same
 * person/object before it designs the master board.
 */
export async function extractMgVideoReferenceFrames(
  videoUrls: string[],
  onProgress?: (message: string) => void,
): Promise<string[]> {
  const unique = [...new Set(videoUrls)].slice(0, 1);
  if (unique.length === 0) return [];
  const videoPath = assetUrlToLocalPath(unique[0]) ?? unique[0];
  const ffmpeg = await detectFfmpeg().catch(() => null);
  if (!ffmpeg) {
    const thumb = await ensureVideoThumb(videoPath).catch(() => null);
    return thumb?.path ? [thumb.path] : [];
  }
  try {
    onProgress?.('正在从参考视频提取主体帧，供 MG 母版锁定人物与物品…');
    const workspace = await invoke<string>('ensure_workspace');
    const outDir = `${workspace}/images`;
    await createDir(outDir, { recursive: true }).catch(() => {});
    const duration = await probeDuration(videoPath).catch(() => 0);
    const times = duration > 1
      ? [Math.min(duration - 0.1, Math.max(0.1, duration * 0.2)), Math.min(duration - 0.1, Math.max(0.1, duration * 0.65))]
      : [0.1];
    const paths: string[] = [];
    for (let index = 0; index < times.length; index++) {
      const output = `${outDir}/mg-video-ref-${Date.now()}-${index}.jpg`;
      const result = await invoke<CommandResult>('execute_command', {
        command: `${ffmpeg} -y -ss ${times[index].toFixed(3)} -i ${quoteShell(videoPath)} -frames:v 1 -vf "scale='min(1280,iw)':-2" -q:v 2 ${quoteShell(output)}`,
        timeoutMs: 60000,
      });
      if (result.exit_code === 0) paths.push(output);
    }
    return paths;
  } catch {
    const thumb = await ensureVideoThumb(videoPath).catch(() => null);
    return thumb?.path ? [thumb.path] : [];
  }
}

function cleanJson(raw: string): string {
  return raw
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/, '');
}

function asStage(value: unknown, index: number): MgReferenceStage {
  if (value === 'hook' || value === 'develop' || value === 'payoff') return value;
  return index === 0 ? 'hook' : index >= 2 ? 'payoff' : 'develop';
}

function fallbackPlan(userPrompt: string): MgReferencePlan {
  const subject = userPrompt.trim().slice(0, 220) || '产品功能与核心价值';
  return {
    concept: `以“${subject}”为核心，建立统一的主视觉、图形符号、色彩、材质和空间层级。`,
    frames: [
      {
        label: '视觉钩子',
        stage: 'hook',
        visual: '核心主视觉快速出现，辅助图形从前后景聚合，第一眼建立主题。',
        motion: '快速揭示、尺度对比、短暂停顿。',
      },
      {
        label: '关系展开',
        stage: 'develop',
        visual: '用图标、路径、卡片或物体关系解释内容，保持母版中的元素身份。',
        motion: '错峰进入、传递、连接、局部推镜。',
      },
      {
        label: '完整收束',
        stage: 'payoff',
        visual: '全部核心元素形成完整构图，留下清楚的最终视觉记忆。',
        motion: '聚合、秩序重排、稳定落版。',
      },
    ],
  };
}

export function parseMgReferencePlan(raw: string, userPrompt: string): MgReferencePlan {
  try {
    const parsed = JSON.parse(cleanJson(raw)) as {
      concept?: unknown;
      frames?: Array<Record<string, unknown>>;
    };
    const frames = Array.isArray(parsed.frames)
      ? parsed.frames
          .slice(0, 4)
          .map((frame, index) => ({
            label: String(frame.label || `参考帧 ${index + 1}`).slice(0, 16),
            stage: asStage(frame.stage, index),
            visual: String(frame.visual || '').trim().slice(0, 360),
            motion: String(frame.motion || '').trim().slice(0, 220),
          }))
          .filter((frame) => frame.visual)
      : [];
    if (frames.length >= 2) {
      return {
        concept: String(parsed.concept || '').trim().slice(0, 500)
          || fallbackPlan(userPrompt).concept,
        frames,
      };
    }
  } catch {
    // The deterministic fallback keeps generation available when the planning
    // model returns prose or malformed JSON.
  }
  return fallbackPlan(userPrompt);
}

async function planReferenceFrames(args: {
  userPrompt: string;
  styleId?: string;
  duration: number;
  recipe?: Partial<MgMotionRecipe>;
}): Promise<MgReferencePlan> {
  const style = getMgStylePreset(args.styleId);
  try {
    const raw = await quickChat([
      {
        role: 'system',
        content: [
          '你是专业 MG 动画美术指导。请把内容规划成一张母版概念图和 2-4 张同风格派生参考帧。',
          '母版负责锁定全部重复出现的核心元素、色彩、材质和图形语言；派生帧只改变构图、景别和动作阶段，不新增另一套风格。',
          '画面以图形、图标、物体、界面、空间关系和动作隐喻为主。不要做 PPT，不要安排长段文字。',
          '只有用户明确给出且确有必要时，才允许 1 个短标题或 1-4 个大字；其他信息都转成无字视觉。',
          '只返回 JSON：{"concept":"母版设计概念","frames":[{"label":"短名称","stage":"hook|develop|payoff","visual":"该帧构图和元素","motion":"进入下一阶段的动作"}]}',
        ].join('\n'),
      },
      {
        role: 'user',
        content: [
          `内容：${args.userPrompt}`,
          `风格：${style.name}；${style.guidance}`,
          `时长：${args.duration}s`,
          args.recipe ? `效果：${JSON.stringify(args.recipe)}` : '',
        ].filter(Boolean).join('\n'),
      },
    ], { maxTokens: 1000 });
    return parseMgReferencePlan(raw, args.userPrompt);
  } catch {
    return fallbackPlan(args.userPrompt);
  }
}

function masterBoardPrompt(args: {
  userPrompt: string;
  concept: string;
  styleId?: string;
  aspectRatio: '16:9' | '9:16';
  sourceReferenceCount: number;
}): string {
  const style = getMgStylePreset(args.styleId);
  return [
    `Create one ${args.aspectRatio} master concept style board for a premium MG animation.`,
    'This is the visual bible for all later frames. Show every recurring hero object, supporting icon family, graphic motif, color, material, lighting and spatial layer together in one coherent designed scene.',
    `Content concept: ${args.concept}`,
    `Selected style: ${style.name}. ${style.prompt}. ${style.guidance}`,
    'The design must feel like motion graphics, not a PPT slide, storyboard contact sheet, mood-board collage or static poster.',
    'Use rich but organized visual elements with clear foreground, hero plane and supporting layers. Give every element a recognizable identity that can be reused unchanged in later frames.',
    args.sourceReferenceCount > 0
      ? `SUBJECT LOCK: @图片一${args.sourceReferenceCount > 1 ? ` 至 @图片${mgChineseIndex(args.sourceReferenceCount)}` : ''} are user-provided identity/object references. Preserve the same person, artifact, product shape, proportions, texture, markings and key details. The MG design supports these subjects and must not replace or redesign them.`
      : '',
    'TEXT RULE: Prefer no visible text. Do not create captions, paragraphs, fake UI copy, random Chinese, logos or watermarks. Only if the user explicitly provided an essential short phrase, show that exact phrase once as a large clean title; never invent text.',
    'No frame numbers, annotations, production notes, split-screen panels or labels.',
    '',
    `User requirement: ${args.userPrompt}`,
  ].join('\n');
}

function derivativeBoardPrompt(args: {
  userPrompt: string;
  frame: MgReferenceFramePlan;
  styleId?: string;
  aspectRatio: '16:9' | '9:16';
  sourceReferenceCount: number;
}): string {
  const style = getMgStylePreset(args.styleId);
  return [
    `Create one ${args.aspectRatio} keyframe for the same MG animation. @图片一 is the locked master concept board.`,
    args.sourceReferenceCount > 0
      ? `@图片二${args.sourceReferenceCount > 1 ? ` 至 @图片${mgChineseIndex(args.sourceReferenceCount + 1)}` : ''} are original user-provided identity/object references. Preserve the same person or object exactly.`
      : '',
    `Stage: ${args.frame.stage}. Shot purpose: ${args.frame.label}.`,
    `Composition and action: ${args.frame.visual}`,
    `Motion implication: ${args.frame.motion}`,
    `Keep exactly the same recurring objects, icon family, colors, materials, lighting and design identity as the master board. Change only composition, scale, camera distance and animation phase.`,
    `Style remains locked: ${style.name}. ${style.prompt}.`,
    'This must be a single cinematic MG frame, not a contact sheet, collage, storyboard grid or presentation slide.',
    'TEXT RULE: Prefer no visible text. Never invent captions, labels, paragraphs, random Chinese, fake UI copy, logos or watermarks. Preserve only an essential short phrase that already exists in the master board.',
    '',
    `User requirement: ${args.userPrompt}`,
  ].join('\n');
}

export async function generateMgReferenceBoards(args: {
  userPrompt: string;
  styleId?: string;
  aspectRatio: '16:9' | '9:16';
  duration: number;
  recipe?: Partial<MgMotionRecipe>;
  /** All references visible to image pre-production, including video stills. */
  sourceReferenceUrls?: string[];
  /** Original image references that will also be sent to the final video model. */
  submittedSourceReferenceUrls?: string[];
  onProgress?: (message: string) => void;
}): Promise<MgReferenceBoardResult> {
  const sourceRefs = [...new Set(args.sourceReferenceUrls ?? [])].slice(0, 6);
  const submittedSourceRefs = [...new Set(
    args.submittedSourceReferenceUrls ?? sourceRefs,
  )].slice(0, 6);
  args.onProgress?.('正在分析内容，规划 MG 母版和关键参考帧…');
  const plan = await planReferenceFrames(args);
  const size = args.aspectRatio === '9:16' ? '1152x2048' : '2048x1152';

  args.onProgress?.('正在生成包含全部核心元素的 MG 母版概念图…');
  const masterPrompt = masterBoardPrompt({
    userPrompt: args.userPrompt,
    concept: plan.concept,
    styleId: args.styleId,
    aspectRatio: args.aspectRatio,
    sourceReferenceCount: sourceRefs.length,
  });
  const master = await generateImage({
    model: 'gpt-image-2',
    prompt: masterPrompt,
    aspectRatio: args.aspectRatio,
    size,
    quality: 'high',
    referenceImageUrls: sourceRefs,
  });
  if (!master.success || !master.imagePath) {
    throw new Error(`MG 母版概念图生成失败：${master.error || '生图通道未返回图片'}`);
  }

  args.onProgress?.(`母版已完成，正在并行生成 ${plan.frames.length} 张同风格参考帧…`);
  const derivativeRefs = [master.imagePath, ...sourceRefs].slice(0, 7);
  const settled = await Promise.allSettled(plan.frames.map(async (frame) => {
    const prompt = derivativeBoardPrompt({
      userPrompt: args.userPrompt,
      frame,
      styleId: args.styleId,
      aspectRatio: args.aspectRatio,
      sourceReferenceCount: sourceRefs.length,
    });
    const result = await generateImage({
      model: 'gpt-image-2',
      prompt,
      aspectRatio: args.aspectRatio,
      size,
      quality: 'high',
      referenceImageUrls: derivativeRefs,
    });
    if (!result.success || !result.imagePath) {
      throw new Error(result.error || `${frame.label}未返回图片`);
    }
    return {
      kind: 'frame' as const,
      label: frame.label,
      stage: frame.stage,
      prompt,
      path: result.imagePath,
    };
  }));

  const warnings: string[] = [];
  const frames: MgReferenceBoard[] = [];
  settled.forEach((result, index) => {
    if (result.status === 'fulfilled') {
      frames.push(result.value);
    } else {
      warnings.push(`${plan.frames[index]?.label || `参考帧 ${index + 1}`}生成失败`);
    }
  });
  const boards: MgReferenceBoard[] = [
    { kind: 'master', label: 'MG 母版概念图', prompt: masterPrompt, path: master.imagePath },
    ...frames,
  ];
  const referenceGuide = buildMgReferenceGuide(boards, submittedSourceRefs.length);

  return {
    plan,
    boards,
    masterPath: master.imagePath,
    referenceGuide,
    warnings,
  };
}

export function materializeMgReferenceBoardsOnCanvas(
  targetNodeId: string,
  result: MgReferenceBoardResult,
): string[] {
  const store = useCanvasStore.getState();
  const target = store.nodes.find((node) => node.id === targetNodeId);
  if (!target) return [];

  const oldIds = store.nodes
    .filter((node) => {
      const data = node.data as Record<string, unknown>;
      return data.isMgReferenceBoard === true && data.mgReferenceFor === targetNodeId;
    })
    .map((node) => node.id);
  oldIds.forEach((id) => store.deleteNode(id));

  const batchId = `mg-ref-${nanoid(8)}`;
  const displayPaths = result.boards.map((board) => convertFileSrc(board.path));
  const nodeIds = result.boards.map((board, index) => {
    const id = `node-${nanoid(8)}`;
    const column = index % 2;
    const row = Math.floor(index / 2);
    const isMaster = board.kind === 'master';
    const width = isMaster ? 300 : 260;
    const height = isMaster ? 169 : 146;
    store.addNode({
      id,
      type: 'image',
      position: {
        x: target.position.x - 660 + column * 300,
        y: target.position.y - 210 + row * 190,
      },
      style: { ...(defaultNodeStyle('image') ?? {}), width, height },
      data: {
        description: board.label,
        generatedImageUrl: displayPaths[index],
        referenceImage: displayPaths[index],
        localPath: board.path,
        imagePrompt: board.prompt,
        imageModel: 'gpt-image-2',
        modelVersion: 'gpt-image-2',
        aspectRatio: (target.data as Record<string, unknown>).aspectRatio || '16:9',
        resolution: '2k',
        isMgReferenceBoard: true,
        isMgMasterBoard: isMaster,
        mgReferenceFor: targetNodeId,
        mgReferenceBatchId: batchId,
        mgReferenceStage: board.stage,
      },
    });
    store.onConnect({ source: id, target: targetNodeId, sourceHandle: null, targetHandle: null });
    return id;
  });

  // collectNodeReferences uses edge order as the single source of truth for
  // display labels, @ mentions and provider submission. Put the generated
  // design boards before the user's original incoming references so all
  // three surfaces agree that the master is @图片一.
  const currentEdges = useCanvasStore.getState().edges;
  const generatedIds = new Set(nodeIds);
  const targetIncoming = currentEdges.filter((edge) => edge.target === targetNodeId);
  const generatedIncoming = targetIncoming.filter((edge) => generatedIds.has(edge.source));
  const originalIncoming = targetIncoming.filter((edge) => !generatedIds.has(edge.source));
  const firstTargetIndex = currentEdges.findIndex((edge) => edge.target === targetNodeId);
  if (firstTargetIndex >= 0) {
    const withoutTargetIncoming = currentEdges.filter((edge) => edge.target !== targetNodeId);
    withoutTargetIncoming.splice(
      Math.min(firstTargetIndex, withoutTargetIncoming.length),
      0,
      ...generatedIncoming,
      ...originalIncoming,
    );
    store.setEdges(withoutTargetIncoming);
  }

  store.updateNode(targetNodeId, {
    mgReferenceBatchId: batchId,
    mgReferenceBoardNodeIds: nodeIds,
    mgReferenceBoardPaths: result.boards.map((board) => board.path),
    mgReferenceMasterPath: result.masterPath,
    mgReferenceMentionSummary: result.referenceGuide,
  });
  return nodeIds;
}

export function sourceRefsWithoutGeneratedMgBoards(
  targetNodeId: string,
  refs: Array<{ submitUrl: string; sourceNodeId?: string }>,
): string[] {
  const nodes = useCanvasStore.getState().nodes;
  const generatedIds = new Set(nodes
    .filter((node) => {
      const data = node.data as Record<string, unknown>;
      return data.isMgReferenceBoard === true && data.mgReferenceFor === targetNodeId;
    })
    .map((node) => node.id));
  return refs
    .filter((ref) => !ref.sourceNodeId || !generatedIds.has(ref.sourceNodeId))
    .map((ref) => ref.submitUrl);
}
