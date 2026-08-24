/**
 * canvasGen — single orchestration layer for ALL generation.
 *
 * runGeneration() is the store-agnostic core: queue slot → upload references
 * → rhtv submit → poll → download → artifact/log bookkeeping; on rhtv failure
 * images fall back to the dmxapi slot chain (lib/imageGen/client.ts) — videos
 * have no fallback. Canvas (generateForNode) and Workshop (workshopStore)
 * both call it, sharing the same MAX 3 task queue.
 * GPT-Image-2 has an image route manager; Midjourney uses APIMart first (with
 * a RunningHub V8.1 fallback), while Seedance keeps its dedicated routes.
 *
 * generateForNode() wraps it with canvas-node semantics: version-tree derive,
 * node patches, MJ multi-output variant nodes.
 *
 * Seedance prompt red lines (AGENT.md): reference attachments must be cited
 * as @图片N in --image order. validateSeedancePrompt() enforces the basics
 * before spending money.
 */
import { useCanvasStore } from '@/stores/canvasStore';
import { createTask as arkCreateTask, pollUntilDone as arkPollUntilDone, type SeedanceContentItem } from '@/lib/seedance/client';
import { loadMediaInput } from '@/lib/agent/mediaInput';
import {
  useCanvasTaskStore,
  MAX_CONCURRENT_CANVAS_TASKS,
  type CanvasTask,
} from '@/stores/canvasTaskStore';
import { rhtvSubmit } from '@/lib/rhtv/client';
import { effectiveRhtvWebappId, rhtvSubmitApp, type RhtvAppNodeInfo } from '@/lib/rhtv/client';
import { rhtvPollTask } from '@/lib/rhtv/poll';
import { rhtvResolveMedia } from '@/lib/rhtv/upload';
import { rhtvResolveMediaForApp } from '@/lib/rhtv/upload';
import { rhtvDownloadAll } from '@/lib/rhtv/download';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import {
  isTerminalRhtvRejection,
  RhtvBusinessError,
  RhtvSubmissionUnknownError,
  type RhtvCanvasEngine,
  type RhtvParams,
  type RhtvSubmitResponse,
} from '@/lib/rhtv/types';
import { resolveImageEngine, findCanvasEngine } from '@/lib/rhtv/canvasEngines';
import { generateImage } from '@/lib/imageGen/client';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { appendGenerationLog } from '@/lib/aigc/genLogger';
import { appendArtifact } from '@/lib/artifacts';
import { formatSeedanceValidation, validateSeedancePrompt as validateSeedancePromptDetailed } from '@/lib/seedance/validation';
import {
  KUAIZI_SEEDANCE_ENGINE_ID,
  KuaiziBusinessError,
  appendKuaiziLog,
  getKuaiziApiKey,
  isTransientKuaiziError,
  runKuaiziSeedance2Generation,
  type KuaiziImageInput,
  type KuaiziVideoMode,
} from '@/lib/kuaizi/seedance';
import { runKuaiziMinimaxH3Generation } from '@/lib/kuaizi/minimaxH3';
import { runKuaiziWan3Generation } from '@/lib/kuaizi/wan3';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import {
  DreaminaLoginRequiredError,
  DreaminaTaskPendingError,
  generateSeedreamWithDreamina,
} from '@/lib/dreamina/image';
import {
  DREAMINA_SEEDANCE_25_ENDPOINT,
  DREAMINA_SEEDANCE_25_ENGINE_ID,
  generateSeedance25WithDreamina,
} from '@/lib/dreamina/video';
import {
  chooseGptImageChannel,
  chooseSeedreamProChannel,
  getImageRouteDefinition,
  pickNextHealthyChannel,
  recordImageRouteMetric,
  type ImageRouteModel,
} from '@/lib/imageRouter/metrics';
import {
  isAmbiguousPaidSubmitStatus,
  PaidSubmissionUnknownError,
  PaidTaskCreatedError,
  mustNotAutoResubmit,
  paidRetryStoppedMessage,
  paidTaskId,
  shouldStopAutomaticPaidFallback,
} from '@/lib/billingSafety';
import {
  APIMART_MINIMAX_H3_ENDPOINT,
  APIMART_WAN3_ENDPOINT,
  ApimartTaskFailedError,
  hasApimartApiKey,
  pollApimartTask,
  resolveApimartPublicMedia,
  submitApimartTask,
} from '@/lib/apimart/client';
import {
  APIMART_SUNO_ENDPOINT,
  buildApimartMinimaxH3Payload,
  buildApimartSunoPayload,
  buildApimartWan3Payload,
} from '@/lib/apimart/contracts';
import {
  chooseMinimaxH3Channel,
  recordMinimaxH3Metric,
  type MinimaxH3Channel,
} from '@/lib/videoRouter/minimaxH3';
import {
  chooseWan3Channel,
  recordWan3Metric,
  WAN3_CHANNEL_PREFERENCE,
  type Wan3Channel,
} from '@/lib/videoRouter/wan3';
import {
  APIMART_MIDJOURNEY_ENDPOINT,
  ApimartMidjourneyTaskError,
  hasApimartMidjourneyKey,
  normalizeMidjourneyVersion,
  runApimartMidjourney,
  type MidjourneyVersion,
} from '@/lib/midjourney/apimart';
import {
  MIDJOURNEY_DEFAULT_VERSION,
  MIDJOURNEY_PARAMETER_PRESETS,
  isMidjourneyEngineId,
} from '@/lib/midjourney/prompt';

export interface CanvasGenRequest {
  nodeId: string;
  engineId: string;
  prompt: string;
  /** Reference media: asset:// URLs, local paths, or remote URLs. */
  referenceUrls?: string[];
  /** Midjourney style reference, kept separate from subject/image references. */
  styleReferenceUrls?: string[];
  /** Reference audio (Seedance multimodal @音频一 convention). */
  audioUrls?: string[];
  /** Reference video (Seedance multimodal @视频N, e.g. video-extend). */
  videoUrls?: string[];
  /** 万相 3.0 参考文档 URL（docx/pdf/md 等，与 linkUrl 互斥）。 */
  documentUrl?: string;
  /** 万相 3.0 参考网页 URL（公开免登录，与 documentUrl 互斥）。 */
  linkUrl?: string;
  /** Engine param overrides (aspectRatio/resolution/duration/ratio...). */
  params?: RhtvParams;
  /** Force writing into the node even if it already holds a result. */
  overwrite?: boolean;
}

/** Store-agnostic generation request (no canvas node required). */
export interface CoreGenRequest {
  engineId: string;
  prompt: string;
  referenceUrls?: string[];
  /** Midjourney style reference, kept separate from subject/image references. */
  styleReferenceUrls?: string[];
  audioUrls?: string[];
  videoUrls?: string[];
  /** 万相 3.0 参考文档 URL（与 linkUrl 互斥）。 */
  documentUrl?: string;
  /** 万相 3.0 参考网页 URL（与 documentUrl 互斥）。 */
  linkUrl?: string;
  params?: RhtvParams;
  /** Optional canvas node to associate in the task queue UI. */
  nodeId?: string;
  /** 任务归属的 AIGC 项目（工坊/故事板任务必传）——恢复回填时做跨项目隔离。 */
  projectId?: string;
  /** Workshop shot number — threads through to CanvasTask for retry routing. */
  workshopShotNo?: string;
  workshopShotKind?: 'image' | 'video';
  /** Workshop storyboard frame id — lets background recovery write result back after modal is closed. */
  workshopStoryboardFrameId?: string;
  /** Called as soon as the queue task is registered (before slot wait). */
  onTaskCreated?: (taskId: string) => void;
  /** Internal benchmark/debug path: run one exact image channel. */
  forceChannel?: string;
}

export interface CoreGenResult {
  success: boolean;
  taskId: string;
  resultPaths: string[];
  /** Display (asset://) URLs matching resultPaths. */
  resultUrls: string[];
  engineKind?: 'image' | 'video' | 'audio';
  fallbackUsed?: boolean;
  error?: string;
  /** 远端提供商任务 id（已提交才存在）——2.5 兜底据此判断能否安全降级。 */
  providerTaskId?: string;
  /** 远端任务进入 failed 终态（失败不扣费）——可以安全降级重试。 */
  providerFailed?: boolean;
  /** 任务已提交且转后台恢复（轮询超时/网络抖动）——禁止降级，防重复扣费。 */
  backgroundPending?: boolean;
  /** 创建请求可能已被提供商接收，但响应丢失；路由策略据工作负载决定是否重试。 */
  submissionUncertain?: boolean;
  /** 已收到远端任务/同步产物；后续本地处理失败也禁止切换渠道重生成。 */
  submissionCommitted?: boolean;
  /** 筷子 Seedance 已进入可能计费阶段；Agent 本轮不得再次提交。 */
  automaticRetryBlocked?: boolean;
}

export interface CanvasGenResult {
  success: boolean;
  taskId: string;
  resultPaths: string[];
  /** Display (asset://) URL of the primary output, already written to node. */
  primaryUrl?: string;
  fallbackUsed?: boolean;
  error?: string;
  /** 透传付费视频保护，防止 Agent 在工具失败后自动再调用。 */
  automaticRetryBlocked?: boolean;
}

// ── Local run controller per task ────────────────────────────────────────────
const taskAborts = new Map<string, AbortController>();
const IMAGE_MAIN_CHAIN_TIMEOUT_MS = 180_000;

function isSeedreamProImageEngine(engineId: string): boolean {
  return engineId.includes('seedream-v5-pro') ||
    engineId === 'seedream-v5-pro' ||
    engineId === 'seedream-v5-pro-i2i' ||
    engineId === 'seedream-v5-pro-rhtv' ||
    engineId === 'seedream-v5-pro-rhtv-i2i';
}

function imageRouteModelForEngine(engineId: string): ImageRouteModel {
  return isSeedreamProImageEngine(engineId) ? 'seedream-v5-pro' : 'gpt-image-2';
}

function seedreamSizeFor(aspectRatio: unknown, resolution: unknown): { width: number; height: number } {
  const table: Record<'1k' | '2k' | '4k', Record<string, [number, number]>> = {
    '1k': {
      '1:1': [1024, 1024],
      '4:3': [1152, 864],
      '3:4': [864, 1152],
      '16:9': [1424, 800],
      '9:16': [800, 1424],
      '3:2': [1248, 832],
      '2:3': [832, 1248],
      '21:9': [1568, 672],
    },
    '2k': {
      '1:1': [2048, 2048],
      '4:3': [2368, 1776],
      '3:4': [1776, 2368],
      '16:9': [2816, 1584],
      '9:16': [1584, 2816],
      '3:2': [2496, 1664],
      '2:3': [1664, 2496],
      '21:9': [3136, 1344],
    },
    '4k': {
      '1:1': [4096, 4096],
      '4:3': [4096, 3072],
      '3:4': [3072, 4096],
      '16:9': [4096, 2304],
      '9:16': [2304, 4096],
      '3:2': [4096, 2720],
      '2:3': [2720, 4096],
      '21:9': [4096, 1760],
    },
  };
  const requested = String(resolution || '2k').toLowerCase();
  const res: '1k' | '2k' | '4k' = requested === '1k' || requested === '4k' ? requested : '2k';
  const [width, height] = table[res][String(aspectRatio || '16:9')] ?? table[res]['16:9'];
  return { width, height };
}

function normalizeSeedreamProPayload(payload: RhtvParams): void {
  const { width, height } = seedreamSizeFor(payload.aspectRatio, payload.resolution);
  payload.width = width;
  payload.height = height;
  payload.outputFormat = String(payload.outputFormat || 'jpeg').toLowerCase();
  // RunningHub says resolution wins over width/height. We delete it so user
  // selected aspect ratio remains real instead of only a prompt hint.
  delete payload.aspectRatio;
  delete payload.resolution;
}

export function abortCanvasTask(taskId: string): void {
  taskAborts.get(taskId)?.abort();
}

// ── Seedance prompt validation (AGENT.md red lines) ──────────────────────────
export function validateSeedancePrompt(prompt: string, refCount: number): string | null {
  const result = validateSeedancePromptDetailed(prompt, { refCount, requireSceneRef: false, allowVideoRefs: true });
  return result.ok ? null : formatSeedanceValidation(result);
}

/** Resolve engineId + refs to a concrete engine, validating red lines. */
export function resolveGenEngine(
  req: Pick<CoreGenRequest, 'engineId' | 'prompt' | 'referenceUrls' | 'audioUrls' | 'videoUrls'>,
): { engine?: RhtvCanvasEngine; error?: string } {
  const refs = req.referenceUrls ?? [];
  const baseEngine = findCanvasEngine(req.engineId);
  // 未知引擎必须报错——resolveImageEngine 的 `?? CANVAS_IMAGE_ENGINES[0]`
  // 兜底会把拼错的视频/音频 id 静默当 GPT 图片任务提交扣费
  if (!baseEngine && !req.engineId.startsWith('gpt-image') && !isSeedreamProImageEngine(req.engineId)) {
    return { error: `未知引擎: ${req.engineId}` };
  }
  // GPT Image 2 的 RunningHub 通道（海外节点）已下线；到达这里说明没有可用
  // 的生图 API 槽位（有槽位时 chooseGptImageChannel 会返回 api: 路由）。
  // 绝不能静默换成 Seedream 扣费——明确告诉用户怎么恢复。
  if (!baseEngine && req.engineId.startsWith('gpt-image')) {
    return {
      error: 'GPT Image 2 的 RunningHub 渠道（海外节点）已于 2026-08 下线。请在「设置 → 图片模型」配置生图 API 槽位（DMXAPI / AiHubMix / ZexAPI），或改用 Seedream 5.0 Pro / 即梦通道。',
    };
  }
  const engine: RhtvCanvasEngine | undefined =
    baseEngine?.kind === 'image' || !baseEngine
      ? resolveImageEngine(req.engineId, refs.length)
      : baseEngine;

  if (!engine) return { error: `未知引擎: ${req.engineId}` };
  if (engine.appConfig) {
    const imageSlots = engine.appConfig.nodes.filter((n) => n.source === 'image').length;
    const audioSlots = engine.appConfig.nodes.filter((n) => n.source === 'audio').length;
    const videoSlots = engine.appConfig.nodes.filter((n) => n.source === 'video').length;
    if (refs.length > imageSlots && engine.kind !== 'image') {
      return { error: `${engine.label} 当前 AI 应用只配置了 ${imageSlots} 个图片输入节点，但本次需要传 ${refs.length} 张参考图。请减少参考图，或在 RunningHub 应用中增加图片输入节点。` };
    }
    if ((req.audioUrls?.length ?? 0) > audioSlots) {
      return { error: `${engine.label} 当前 AI 应用只配置了 ${audioSlots} 个音频输入节点，但本次需要传 ${req.audioUrls?.length ?? 0} 个音频。` };
    }
    if ((req.videoUrls?.length ?? 0) > videoSlots) {
      return { error: `${engine.label} 当前 AI 应用只配置了 ${videoSlots} 个视频输入节点，但本次需要传 ${req.videoUrls?.length ?? 0} 个视频。` };
    }
  }

  // Seedance multimodal requires references (AGENT.md). Auto-route to t2v
  // is forbidden ("绝对禁止改用 text-to-video") — surface the error instead.
  // MiniMax H3 例外：单端点多模态（t2v/i2v 同端点，prompt 必填、参考可选），
  // 不适用 Seedance 的"必须有参考素材"红线与 @图片N 提示词校验。
  // 万相 3.0 同样例外：全能参考模型，文生/首帧/参考/文档/网页同端点。
  const isMinimaxH3 = engine.id === 'minimax-hailuo-h3' || engine.id === 'wan-3.0';
  if (!isMinimaxH3 && engine.mode === 'multimodal-video' && refs.length === 0 && (req.audioUrls?.length ?? 0) === 0 && (req.videoUrls?.length ?? 0) === 0) {
    return { error: 'Seedance 多模态视频必须提供参考素材（项目红线）。请连接参考图节点或改选「文生视频」引擎。' };
  }
  if (engine.mode === 'start-end-video' && refs.length === 0) {
    return { error: '首尾帧模式需要至少 1 张图（第 1 张=首帧，第 2 张=尾帧，可只传首帧）。' };
  }
  if (!isMinimaxH3 && engine.mode === 'multimodal-video') {
    const issue = validateSeedancePrompt(req.prompt, refs.length);
    if (issue) return { error: issue };
  }
  // 标准 API 引擎的能力校验（appConfig 引擎上面已校验槽位数，这里对称补齐）：
  // 传了引擎不支持的参考类型必须报错——曾经是静默上传后丢弃，用户以为参考
  // 生效了（Fast 丢音频、Mini 首尾帧丢第 3 张图都是这么漏的）。
  if (!engine.appConfig) {
    if ((req.audioUrls?.length ?? 0) > 0 && !engine.audioParam) {
      return { error: `${engine.label} 不支持音频参考（本次传了 ${req.audioUrls!.length} 个）。请改用 Seedance 2.0 多模态引擎，或去掉音频参考。` };
    }
    if ((req.videoUrls?.length ?? 0) > 0 && !engine.videoParam && engine.mode !== 'start-end-video') {
      return { error: `${engine.label} 不支持视频参考（本次传了 ${req.videoUrls!.length} 个）。请改用 Seedance 2.0 多模态引擎，或去掉视频参考。` };
    }
    if (engine.mode === 'start-end-video' && refs.length > 2) {
      return { error: `首尾帧模式只使用前 2 张图（首帧+尾帧），本次传了 ${refs.length} 张——多余的图不会生效。请减到 2 张以内，或改用 Seedance 2.0 多模态引擎（支持多参考图）。` };
    }
  }
  return { engine };
}

function appImageSlotCount(engine: RhtvCanvasEngine): number {
  return engine.appConfig?.nodes.filter((n) => n.source === 'image').length ?? Infinity;
}

// ── Node helpers ──────────────────────────────────────────────────────────────
function patchNode(nodeId: string, data: Record<string, unknown>) {
  useCanvasStore.getState().updateNode(nodeId, data);
}

/** Lay extra outputs out as variant nodes to the right of the source node. */
export function spawnVariantNodes(sourceNodeId: string, paths: string[], prompt: string) {
  const store = useCanvasStore.getState();
  const src = store.nodes.find((n) => n.id === sourceNodeId);
  if (!src) return;
  const baseX = (src.position?.x ?? 0) + (src.width ?? 200) + 60;
  const baseY = src.position?.y ?? 0;
  paths.forEach((p, i) => {
    const id = `node-var-${Date.now()}-${i}`;
    store.addNode({
      id,
      type: 'image',
      position: { x: baseX, y: baseY + i * 190 },
      style: defaultNodeStyle('image'),
      data: {
        generatedImageUrl: convertFileSrc(p),
        localPath: p,
        description: `${prompt.slice(0, 30)} · 变体 ${i + 2}`,
      },
    });
    store.onConnect({
      source: sourceNodeId,
      target: id,
      sourceHandle: null,
      targetHandle: null,
      data: { relation: 'version' },
    });
  });
}

// ── Queue management ──────────────────────────────────────────────────────────

/**
 * Build the nodeInfoList for an AI-application submit from the engine's
 * appConfig, the resolved prompt/params, and uploaded media fileNames.
 */
function buildNodeInfoList(
  engine: RhtvCanvasEngine,
  prompt: string,
  params: RhtvParams,
  imageFileNames: string[],
  videoFileNames: string[],
  audioFileNames: string[],
): RhtvAppNodeInfo[] {
  const cfg = engine.appConfig!;
  const list: RhtvAppNodeInfo[] = [];
  let imgIdx = 0;
  let vidIdx = 0;
  let audIdx = 0;

  for (const node of cfg.nodes) {
    let value: string;
    switch (node.source) {
      case 'prompt':
        value = prompt;
        break;
      case 'image':
        value = imageFileNames[imgIdx++] ?? '';
        if (!value) continue;
        break;
      case 'video':
        value = videoFileNames[vidIdx++] ?? '';
        if (!value) continue;
        break;
      case 'audio':
        value = audioFileNames[audIdx++] ?? '';
        if (!value) continue;
        break;
      case 'param': {
        const raw = params[node.paramKey!] ?? engine.fixedParams?.[node.paramKey!];
        if (raw === undefined) continue;
        value = String(raw);
        break;
      }
    }
    list.push({ nodeId: node.nodeId, fieldName: node.fieldName, fieldValue: value });
  }
  return list;
}

function generationTaskType(engine: RhtvCanvasEngine, refCount: number): 'text-to-image' | 'image-to-video' | 'text-to-video' {
  if (engine.kind === 'image') return 'text-to-image';
  if (engine.kind === 'video') return refCount > 0 ? 'image-to-video' : 'text-to-video';
  return 'text-to-video';
}

const waiters: (() => void)[] = [];

async function acquireSlot(taskId: string): Promise<void> {
  const store = useCanvasTaskStore.getState();
  if (store.runningCount() < MAX_CONCURRENT_CANVAS_TASKS) return;
  await new Promise<void>((resolve) => {
    waiters.push(resolve);
    // Re-check periodically too, in case a release was missed (defensive).
    const iv = setInterval(() => {
      if (useCanvasTaskStore.getState().runningCount() < MAX_CONCURRENT_CANVAS_TASKS) {
        clearInterval(iv);
        const idx = waiters.indexOf(resolve);
        if (idx >= 0) waiters.splice(idx, 1);
        resolve();
      }
    }, 2000);
  });
  void taskId;
}

function releaseSlot(): void {
  const next = waiters.shift();
  next?.();
}

interface NonRhtvImageResult {
  paths: string[];
  urls: string[];
  apiUsed: string;
  providerTaskId?: string;
}

function markDreaminaPending(
  update: (patch: Partial<CanvasTask>) => void,
  routeId: string,
  pending: DreaminaTaskPendingError,
  fallbackUsed = true,
): void {
  update({
    engineId: routeId,
    engineLabel: getImageRouteDefinition(routeId)?.label ?? '即梦 Seedream 5.0 Pro',
    endpoint: 'dreamina-cli/seedream-5.0-pro',
    status: 'running',
    progress: '即梦仍在生成，后台继续查询…',
    rhTaskId: pending.submitId,
    fallbackUsed,
    error: undefined,
  });
}

async function generateViaNonRhtvRoute(
  req: CoreGenRequest,
  routeId: string,
  signal?: AbortSignal,
  onProgress?: (progress: string) => void,
  onSubmitted?: (submitId: string, endpoint?: string) => void,
): Promise<NonRhtvImageResult> {
  const route = getImageRouteDefinition(routeId);
  const refs = req.referenceUrls ?? [];
  const routeModel = route?.model ?? imageRouteModelForEngine(req.engineId);
  if (route?.provider === 'dreamina') {
    const result = await generateSeedreamWithDreamina({
      prompt: req.prompt,
      referenceUrls: refs,
      aspectRatio: String(req.params?.aspectRatio ?? req.params?.ratio ?? '16:9'),
      resolution: String(req.params?.resolution ?? '2k'),
      signal,
      onProgress,
      taskContext: [
        req.workshopShotNo ? `工坊镜号 ${req.workshopShotNo}` : '',
        req.nodeId ? `画布节点 ${req.nodeId}` : '',
        req.prompt ? `提示词：${req.prompt}` : '',
      ].filter(Boolean).join('；'),
      onSubmitted,
    });
    return {
      paths: result.paths,
      urls: result.paths.map((path) => convertFileSrc(path)),
      apiUsed: 'dreamina-cli/seedream-5.0-pro',
      providerTaskId: result.submitId,
    };
  }
  let providerTaskId = '';
  const generated = await generateImage({
    prompt: req.prompt,
    model: routeModel,
    aspectRatio: String(req.params?.aspectRatio ?? req.params?.ratio ?? '16:9'),
    size: typeof req.params?.size === 'string' ? req.params.size : undefined,
    resolution: String(req.params?.resolution ?? '2k'),
    quality: String(req.params?.quality ?? 'high'),
    referenceImageUrls: refs,
    forceSlotId: route?.slotId,
    forceTier: route?.tier,
    signal,
    onSubmitted: (submitId, endpoint) => {
      providerTaskId = submitId;
      onSubmitted?.(submitId, endpoint);
    },
  });
  if (!generated.success || !generated.imagePath) {
    throw new Error(generated.error || '兼容接口没有返回图片');
  }
  return {
    paths: [generated.imagePath],
    urls: [generated.imageUrl ?? convertFileSrc(generated.imagePath)],
    apiUsed: generated.apiUsed,
    providerTaskId: providerTaskId || undefined,
  };
}

async function cascadeFallback(
  req: CoreGenRequest,
  failedIds: Set<string>,
  taskId: string,
  update: (patch: Partial<CanvasTask>) => void,
  attemptErrors: string[] = [],
): Promise<CoreGenResult | null> {
  const refs = req.referenceUrls ?? [];
  const mode = refs.length > 0 ? 'image-to-image' : 'text-to-image';
  const routeModel = imageRouteModelForEngine(req.engineId);
  while (true) {
    const next = pickNextHealthyChannel(mode, failedIds, routeModel);
    if (!next) return null;
    failedIds.add(next);
    const routeDef = getImageRouteDefinition(next);
    const fbStart = new Date().toISOString();
    const fbT0 = Date.now();
    let attemptTaskId = '';
    let attemptCommitted = false;
    update({ progress: `切换通道: ${routeDef?.label ?? next}…` });
    try {
      if (next.startsWith('api:') || next.startsWith('dreamina:')) {
        const fb = await generateViaNonRhtvRoute(req, next, undefined, (progress) => update({ progress }), (submitId, endpoint) => {
          attemptTaskId = submitId;
          update({ rhTaskId: submitId, ...(endpoint ? { endpoint } : {}) });
        });
        recordImageRouteMetric({
          routeId: next, engineId: routeModel, mode, startedAt: fbStart,
          totalMs: Date.now() - fbT0, success: true, webappId: fb.apiUsed,
        });
        update({
          status: 'succeeded', progress: `完成（${routeDef?.label ?? next}）`,
          resultPaths: fb.paths,
          resultUrls: fb.urls,
          rhTaskId: fb.providerTaskId,
          fallbackUsed: true, finishedAt: Date.now(),
        });
        for (const path of fb.paths) void appendArtifact({ path, type: 'image', engine: fb.apiUsed, prompt: req.prompt, taskId });
        return {
          success: true, taskId, resultPaths: fb.paths,
          resultUrls: fb.urls,
          engineKind: 'image', fallbackUsed: true,
        };
      }
      const rhEngine = resolveImageEngine(next, refs.length);
      if (!rhEngine) throw new Error(`引擎 ${next} 不可解析`);
      const useAppApi = !!rhEngine.appConfig;
      const resolvedRefs: string[] = [];
      for (const r of refs) {
        resolvedRefs.push(useAppApi ? await rhtvResolveMediaForApp(r) : await rhtvResolveMedia(r));
      }
      const payload: RhtvParams = { prompt: req.prompt, ...(rhEngine.fixedParams ?? {}) };
      for (const p of rhEngine.params) { if (p.default !== undefined) payload[p.key] = p.default; }
      Object.assign(payload, req.params ?? {});
      if (payload.aspectRatio === 'empty') delete payload.aspectRatio;
      if (isSeedreamProImageEngine(rhEngine.id)) normalizeSeedreamProPayload(payload);
      let submitResp: RhtvSubmitResponse;
      if (useAppApi) {
        const nodeInfoList = buildNodeInfoList(rhEngine, req.prompt, payload, resolvedRefs, [], []);
        submitResp = await rhtvSubmitApp(effectiveRhtvWebappId(rhEngine.appConfig!.webappId), nodeInfoList);
      } else {
        if (rhEngine.imageParam && resolvedRefs.length > 0) {
          payload[rhEngine.imageParam.key] = rhEngine.imageParam.multiple ? resolvedRefs : resolvedRefs[0];
        }
        submitResp = await rhtvSubmit(rhEngine.endpoint, payload);
      }
      attemptCommitted = true;
      const rhTaskId = submitResp.taskId;
      attemptTaskId = rhTaskId ?? '';
      let urls: string[];
      if (submitResp.status === 'SUCCESS' && submitResp.results?.length) {
        urls = submitResp.results.map((r) => r.url || r.outputUrl || '').filter(Boolean);
      } else {
        if (!rhTaskId) throw new Error('RunningHub 未返回 taskId');
        update({ rhTaskId });
        const polled = await rhtvPollTask(rhTaskId, {
          maxMs: IMAGE_MAIN_CHAIN_TIMEOUT_MS,
          onProgress: (status, elapsed) => update({ progress: `${routeDef?.label ?? next}: ${status} · ${Math.round(elapsed / 1000)}s` }),
        });
        urls = polled.urls;
      }
      if (urls.length === 0) throw new Error('生成完成但没有输出文件');
      update({ status: 'downloading', progress: `下载 ${urls.length} 个产物…`, resultUrls: urls });
      const paths = await rhtvDownloadAll(urls, 'image', rhEngine.id, (phase) => update({ progress: phase }));
      recordImageRouteMetric({
        routeId: next, engineId: rhEngine.id, mode, startedAt: fbStart,
        totalMs: Date.now() - fbT0, success: true, webappId: rhEngine.appConfig?.webappId,
      });
      update({
        status: 'succeeded', progress: `完成（${routeDef?.label ?? next}）`,
        resultPaths: paths, resultUrls: urls, fallbackUsed: true, finishedAt: Date.now(),
      });
      for (const p of paths) void appendArtifact({ path: p, type: 'image', engine: rhEngine.endpoint, prompt: req.prompt, taskId });
      return {
        success: true, taskId, resultPaths: paths,
        resultUrls: paths.map((p) => convertFileSrc(p)),
        engineKind: 'image', fallbackUsed: true,
      };
    } catch (fbErr) {
      const fbMsg = fbErr instanceof Error ? fbErr.message : String(fbErr);
      if (fbErr instanceof DreaminaTaskPendingError) {
        markDreaminaPending(update, next, fbErr);
        return {
          success: false,
          taskId,
          resultPaths: [],
          resultUrls: [],
          engineKind: 'image',
          fallbackUsed: true,
          error: fbErr.message,
          providerTaskId: fbErr.submitId,
          backgroundPending: true,
        };
      }
      console.warn(`[canvasGen] 降级通道 ${next} 失败: ${fbMsg}`);
      const uncertainSuffix = attemptTaskId
        ? `（原任务 ${attemptTaskId} 状态未知，按图片容灾策略继续）`
        : (attemptCommitted || mustNotAutoResubmit(fbErr))
          ? '（提交结果可能已生效，按图片容灾策略继续）'
          : '';
      attemptErrors.push(`${routeDef?.label ?? next}: ${fbMsg}${uncertainSuffix}`);
      recordImageRouteMetric({
        routeId: next, engineId: routeModel, mode, startedAt: fbStart,
        totalMs: Date.now() - fbT0,
        success: false,
        errorType: fbErr instanceof DreaminaLoginRequiredError ? 'dreamina-login' : 'cascade-fallback',
        errorMessage: fbMsg,
      });
      update({
        status: 'running',
        progress: fbErr instanceof DreaminaLoginRequiredError
          ? '即梦不可用，继续切换备用 API…'
          : `通道失败，继续切换: ${fbMsg}`,
        fallbackUsed: true,
      });
    }
  }
}

export async function runImageFallback(task: CanvasTask): Promise<{
  success: boolean;
  pending?: boolean;
  paths?: string[];
  urls?: string[];
  error?: string;
}> {
  const failedIds = new Set<string>([task.engineId]);
  // 用任务持久化的参考图/参数重生成——缺了它们图生图会退化成文生图，
  // 生成出角色/场景全不对的图静默写回。
  const refs = task.referenceUrls ?? [];
  const aspectRatio = String(task.params?.aspectRatio ?? task.params?.ratio ?? '16:9');
  const mode = refs.length > 0 ? 'image-to-image' : 'text-to-image';
  const routeModel = imageRouteModelForEngine(task.engineId);
  const attemptErrors: string[] = [];
  const update = (patch: Partial<CanvasTask>) =>
    useCanvasTaskStore.getState().updateTask(task.id, patch);
  while (true) {
    const next = pickNextHealthyChannel(mode, failedIds, routeModel);
    if (!next) {
      return {
        success: false,
        error: attemptErrors.length > 0
          ? `所有备用通道均已尝试：${attemptErrors.join('；')}`
          : '所有备用通道均已尝试',
      };
    }
    failedIds.add(next);
    const routeDef = getImageRouteDefinition(next);
    const attemptStartedAt = new Date().toISOString();
    const attemptT0 = Date.now();
    let attemptTaskId = '';
    let attemptCommitted = false;
    update({ progress: `容灾切换: ${routeDef?.label ?? next}…` });
    try {
      if (next.startsWith('api:') || next.startsWith('dreamina:')) {
        const fb = await generateViaNonRhtvRoute({
          engineId: task.engineId,
          prompt: task.prompt,
          referenceUrls: refs,
          params: { ...task.params, aspectRatio },
          nodeId: task.nodeId,
          projectId: task.projectId,
          workshopShotNo: task.workshopShotNo,
          workshopShotKind: task.workshopShotKind,
          workshopStoryboardFrameId: task.workshopStoryboardFrameId,
        }, next, undefined, (progress) => update({ progress }), (submitId, endpoint) => {
          attemptTaskId = submitId;
          update({
            engineId: next,
            engineLabel: routeDef?.label ?? 'Seedream 5.0 Pro',
            endpoint: endpoint ?? (routeDef?.provider === 'dreamina'
              ? 'dreamina-cli/seedream-5.0-pro'
              : 'seedream-v5-pro-compatible'),
            rhTaskId: submitId,
            status: 'running',
          });
        });
        recordImageRouteMetric({
          routeId: next,
          engineId: routeModel,
          mode,
          startedAt: attemptStartedAt,
          totalMs: Date.now() - attemptT0,
          success: true,
          webappId: fb.apiUsed,
        });
        return { success: true, paths: fb.paths, urls: fb.urls };
      }
      const rhEngine = resolveImageEngine(next, refs.length);
      if (!rhEngine) throw new Error(`引擎 ${next} 不可解析`);
      const payload: RhtvParams = { prompt: task.prompt, ...(rhEngine.fixedParams ?? {}) };
      for (const p of rhEngine.params) { if (p.default !== undefined) payload[p.key] = p.default; }
      if (task.params?.aspectRatio && task.params.aspectRatio !== 'empty') payload.aspectRatio = task.params.aspectRatio;
      if (task.params?.resolution) payload.resolution = task.params.resolution;
      if (isSeedreamProImageEngine(rhEngine.id)) normalizeSeedreamProPayload(payload);
      const useAppApi = !!rhEngine.appConfig;
      const resolvedRefs: string[] = [];
      for (const r of refs) {
        resolvedRefs.push(useAppApi ? await rhtvResolveMediaForApp(r) : await rhtvResolveMedia(r));
      }
      let submitResp: RhtvSubmitResponse;
      if (useAppApi) {
        const nodeInfoList = buildNodeInfoList(rhEngine, task.prompt, payload, resolvedRefs, [], []);
        submitResp = await rhtvSubmitApp(effectiveRhtvWebappId(rhEngine.appConfig!.webappId), nodeInfoList);
      } else {
        if (rhEngine.imageParam && resolvedRefs.length > 0) {
          payload[rhEngine.imageParam.key] = rhEngine.imageParam.multiple ? resolvedRefs : resolvedRefs[0];
        }
        submitResp = await rhtvSubmit(rhEngine.endpoint, payload);
      }
      attemptCommitted = true;
      attemptTaskId = submitResp.taskId ?? '';
      let urls: string[];
      if (submitResp.status === 'SUCCESS' && submitResp.results?.length) {
        urls = submitResp.results.map((r) => r.url || r.outputUrl || '').filter(Boolean);
      } else {
        if (!submitResp.taskId) throw new Error('RunningHub 未返回 taskId');
        const polled = await rhtvPollTask(submitResp.taskId, { maxMs: IMAGE_MAIN_CHAIN_TIMEOUT_MS });
        urls = polled.urls;
      }
      if (urls.length === 0) throw new Error('生成完成但没有输出文件');
      const paths = await rhtvDownloadAll(urls, 'image', rhEngine.id, (phase) => update({ progress: phase }));
      recordImageRouteMetric({
        routeId: next,
        engineId: routeModel,
        mode,
        startedAt: attemptStartedAt,
        totalMs: Date.now() - attemptT0,
        success: true,
        webappId: rhEngine.appConfig?.webappId,
      });
      return { success: true, paths, urls };
    } catch (fbErr) {
      if (fbErr instanceof DreaminaTaskPendingError) {
        markDreaminaPending(update, next, fbErr);
        return { success: false, pending: true, error: fbErr.message };
      }
      const failureMessage = fbErr instanceof Error ? fbErr.message : String(fbErr);
      const uncertainSuffix = attemptTaskId
        ? `（原任务 ${attemptTaskId} 状态未知，按图片容灾策略继续）`
        : (attemptCommitted || mustNotAutoResubmit(fbErr))
          ? '（提交结果可能已生效，按图片容灾策略继续）'
          : '';
      attemptErrors.push(`${routeDef?.label ?? next}: ${failureMessage}${uncertainSuffix}`);
      recordImageRouteMetric({
        routeId: next,
        engineId: routeModel,
        mode,
        startedAt: attemptStartedAt,
        totalMs: Date.now() - attemptT0,
        success: false,
        errorType: fbErr instanceof DreaminaLoginRequiredError ? 'dreamina-login' : 'recovery-fallback',
        errorMessage: failureMessage,
      });
      console.warn(`[canvasGen] recovery 降级通道 ${next} 失败: ${failureMessage}`);
      update({
        progress: fbErr instanceof DreaminaLoginRequiredError
          ? '即梦不可用，继续尝试其他 API…'
          : `备用通道失败，继续切换: ${failureMessage}`,
      });
    }
  }
}

async function runApiCompatibleImageGeneration(req: CoreGenRequest, routeId: string): Promise<CoreGenResult> {
  const refs = req.referenceUrls ?? [];
  const route = getImageRouteDefinition(routeId);
  const routeModel = route?.model ?? imageRouteModelForEngine(req.engineId);
  const taskStore = useCanvasTaskStore.getState();
  const taskId = taskStore.addTask({
    nodeId: req.nodeId ?? '',
    kind: 'image',
    engineId: routeId,
    engineLabel: route?.label ?? '兼容生图接口',
    endpoint: route?.provider === 'dreamina'
      ? 'dreamina-cli/seedream-5.0-pro'
      : routeModel === 'seedream-v5-pro' ? 'seedream-v5-pro-compatible' : 'gpt-image-2-compatible',
    prompt: req.prompt,
    referenceUrls: refs.length > 0 ? refs : undefined,
    params: req.params,
    projectId: req.projectId,
    workshopShotNo: req.workshopShotNo,
    workshopShotKind: req.workshopShotKind,
    workshopStoryboardFrameId: req.workshopStoryboardFrameId,
    inFlight: true,
  });
  const ac = new AbortController();
  taskAborts.set(taskId, ac);
  try { req.onTaskCreated?.(taskId); } catch { /* caller callback must not break the run */ }
  const update = (patch: Partial<CanvasTask>) =>
    useCanvasTaskStore.getState().updateTask(taskId, patch);
  const startedAt = new Date().toISOString();
  const t0 = Date.now();

  try {
    await acquireSlot(taskId);
    if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    update({ status: 'running', progress: '正在生成…' });
    const fb = await generateViaNonRhtvRoute(
      req,
      routeId,
      ac.signal,
      (progress) => update({ progress }),
      (submitId, endpoint) => update({ rhTaskId: submitId, ...(endpoint ? { endpoint } : {}) }),
    );
    update({
      status: 'succeeded',
      progress: '完成',
      resultPaths: fb.paths,
      resultUrls: fb.urls,
      rhTaskId: fb.providerTaskId,
      finishedAt: Date.now(),
    });
    recordImageRouteMetric({
      routeId,
      engineId: routeModel,
      mode: refs.length > 0 ? 'image-to-image' : 'text-to-image',
      startedAt,
      totalMs: Date.now() - t0,
      success: true,
      webappId: fb.apiUsed,
    });
    void appendArtifact({
      path: fb.paths[0], type: 'image', engine: fb.apiUsed, prompt: req.prompt, taskId,
    });
    return {
      success: true,
      taskId,
      resultPaths: fb.paths,
      resultUrls: fb.urls,
      engineKind: 'image',
    };
  } catch (err) {
    const msg = err instanceof DOMException && err.name === 'AbortError'
      ? '已取消'
      : err instanceof Error ? err.message : String(err);
    if (!(err instanceof DreaminaLoginRequiredError) && !(err instanceof DreaminaTaskPendingError)) {
      recordImageRouteMetric({
        routeId,
        engineId: routeModel,
        mode: refs.length > 0 ? 'image-to-image' : 'text-to-image',
        startedAt,
        totalMs: Date.now() - t0,
        success: false,
        errorType: 'compatible-api',
        errorMessage: msg,
        webappId: route?.label ?? 'compatible-api',
      });
    }
    if (msg === '已取消') {
      update({ status: 'failed', error: msg, finishedAt: Date.now() });
      return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'image', error: msg };
    }
    if (err instanceof DreaminaTaskPendingError) {
      update({
        status: 'running',
        progress: '即梦仍在生成，后台继续查询…',
        rhTaskId: err.submitId,
        error: undefined,
      });
      return {
        success: false,
        taskId,
        resultPaths: [],
        resultUrls: [],
        engineKind: 'image',
        error: err.message,
      };
    }
    if (shouldStopAutomaticPaidFallback(err, 'image')) {
      update({ status: 'failed', error: msg, progress: msg, finishedAt: Date.now() });
      return {
        success: false,
        taskId,
        resultPaths: [],
        resultUrls: [],
        engineKind: 'image',
        error: msg,
        providerTaskId: paidTaskId(err),
        submissionUncertain: true,
      };
    }
    console.warn(`[canvasGen] API 通道 ${routeId} 失败，级联 fallback: ${msg}`);
    update({
      status: 'running',
      progress: err instanceof DreaminaLoginRequiredError
        ? '即梦不可用，切换备用 API…'
        : '当前通道失败，切换备用通道…',
      fallbackUsed: true,
    });
    const failedIds = new Set<string>([routeId]);
    const attemptErrors = [`${route?.label ?? routeId}: ${msg}`];
    const cascadeResult = await cascadeFallback(req, failedIds, taskId, update, attemptErrors);
    if (cascadeResult) return cascadeResult;
    const finalMsg = `所有通道均失败：${attemptErrors.join('；')}`;
    update({ status: 'failed', error: finalMsg, finishedAt: Date.now() });
    return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'image', error: finalMsg };
  } finally {
    taskAborts.delete(taskId);
    useCanvasTaskStore.getState().updateTask(taskId, { inFlight: false });
    releaseSlot();
  }
}

// ── Seedance engine → Kuaizi routing ────────────────────────────────────────
const SEEDANCE_VIDEO_ENGINE_IDS = new Set([
  'seedance-2.0',
  'seedance-2.0-t2v',
  'seedance-2.0-fast',
  'startend-v3.1-pro',
  'seedance-2.0-mini-t2v',
  'seedance-2.0-mini-i2v',
]);

function isSeedanceVideoEngine(engineId: string): boolean {
  return SEEDANCE_VIDEO_ENGINE_IDS.has(engineId) || engineId === KUAIZI_SEEDANCE_ENGINE_ID;
}

function mapSeedanceToKuaiziMode(engineId: string): KuaiziVideoMode {
  if (engineId === DREAMINA_SEEDANCE_25_ENGINE_ID) return 'seedance2.5';
  if (engineId === 'seedance-2.0-fast') return 'fast';
  if (engineId.includes('mini')) return 'mini';
  return 'pro';
}

function mapSeedanceToKuaiziImageRoles(
  engineId: string,
  refCount: number,
): KuaiziImageInput['role'][] | undefined {
  // 按引擎语义判断而不是枚举 id：所有 start-end-video 模式引擎（startend-v3.1-pro、
  // seedance-2.0-mini-i2v）首图都必须是 first_frame——否则丢给筷子当普通
  // reference_image，"图生视频"退化成"参考图生视频"，起始帧约束丢失。
  const engine = findCanvasEngine(engineId);
  if (engine?.mode === 'start-end-video') {
    const roles: KuaiziImageInput['role'][] = [];
    if (refCount >= 1) roles.push('first_frame');
    if (refCount >= 2) roles.push('last_frame');
    return roles;
  }
  return undefined;
}

function isVideoOutputUrl(url: string): boolean {
  return /\.(mp4|mov|webm|m4v|mkv|avi)(?:\?|$)/i.test(url);
}

type SeedanceEngineChoice = 'kuaizi' | 'runninghub' | 'ark';

function getSeedanceEngineChoice(): SeedanceEngineChoice {
  const s = useSettingsStore.getState();
  // v31+ 用引擎选择；老配置（无 seedanceEngine 时）回退到旧布尔。
  return s.seedanceEngine ?? (s.useRhtvSeedance ? 'runninghub' : 'kuaizi');
}

function shouldUseKuaiziForSeedance(): boolean {
  return getSeedanceEngineChoice() === 'kuaizi';
}

/** Seedance 2.0 引擎 id → 火山方舟目录模型 ID（注册表 src/lib/channels/arkModels.ts）。 */
function arkModelForSeedanceEngine(engineId: string): string {
  if (engineId === 'seedance-2.0-fast') return 'doubao-seedance-2-0-fast-260128';
  if (engineId.includes('mini')) return 'doubao-seedance-2-0-mini-260615';
  return 'doubao-seedance-2-0-260128';
}

function requestsProviderAutoDuration(req: CoreGenRequest): boolean {
  return req.engineId.includes('seedance-2.0-mini')
    && Number(req.params?.duration) === -1;
}

function isMidjourneyEngine(engineId: string): boolean {
  return isMidjourneyEngineId(engineId);
}

function midjourneyVersionOf(req: CoreGenRequest): MidjourneyVersion {
  const explicit = req.params?.version ?? req.params?.modelVersion;
  if (explicit) return normalizeMidjourneyVersion(explicit);
  const match = req.engineId.match(/midjourney-(v?\d+(?:[.-]\d+)?|niji-?\d+)/i)?.[1];
  return normalizeMidjourneyVersion(match?.replace('-', '.') ?? MIDJOURNEY_DEFAULT_VERSION);
}

async function runApimartMidjourneyGeneration(
  req: CoreGenRequest,
  version: MidjourneyVersion,
  fallbackUsed = false,
): Promise<CoreGenResult> {
  const refs = req.referenceUrls ?? [];
  const styleRefs = req.styleReferenceUrls ?? [];
  if (!hasApimartMidjourneyKey()) {
    return {
      success: false,
      taskId: '',
      resultPaths: [],
      resultUrls: [],
      engineKind: 'image',
      error: '未配置 APIMart API Key。请在设置 > Omni MG > APIMart 中填写后重试。',
    };
  }
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId: req.nodeId ?? '',
    kind: 'image',
    engineId: `midjourney-${version}`,
    engineLabel: `Midjourney ${version.toUpperCase()} · APIMart`,
    endpoint: APIMART_MIDJOURNEY_ENDPOINT,
    prompt: req.prompt,
    referenceUrls: refs.length > 0 ? refs : undefined,
    params: { ...(req.params ?? {}), version },
    projectId: req.projectId,
    workshopShotNo: req.workshopShotNo,
    workshopShotKind: req.workshopShotKind,
    workshopStoryboardFrameId: req.workshopStoryboardFrameId,
    inFlight: true,
    fallbackUsed,
    submissionReceipt: {
      requestedImages: refs.length,
      requestedAudio: 0,
      requestedVideo: 0,
      submittedImages: refs.length,
      submittedAudio: 0,
      submittedVideo: 0,
      provider: APIMART_MIDJOURNEY_ENDPOINT,
      fallbackUsed,
    },
  });
  const ac = new AbortController();
  taskAborts.set(taskId, ac);
  try { req.onTaskCreated?.(taskId); } catch { /* callback must not break a paid task */ }
  const update = (patch: Partial<CanvasTask>) => useCanvasTaskStore.getState().updateTask(taskId, patch);
  let providerTaskId = '';
  try {
    await acquireSlot(taskId);
    if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    update({ status: 'uploading', progress: fallbackUsed ? '主节点失败，准备 APIMart 备用通道…' : '准备 APIMart Midjourney 参考素材…' });
    const result = await runApimartMidjourney({
      prompt: req.prompt,
      version,
      referenceUrls: refs,
      styleReferenceUrls: styleRefs,
      aspectRatio: String(req.params?.aspectRatio ?? req.params?.ratio ?? '16:9'),
      stylize: Number(req.params?.stylize ?? MIDJOURNEY_PARAMETER_PRESETS.balanced.stylize),
      chaos: Number(req.params?.chaos ?? MIDJOURNEY_PARAMETER_PRESETS.balanced.chaos),
      raw: Boolean(req.params?.raw),
      weird: Number(req.params?.weird ?? 0),
      styleWeight: Number(req.params?.sw ?? 100),
      imageWeight: Number(req.params?.iw ?? 1),
      quality: req.params?.quality === undefined ? '1' : String(req.params.quality),
      speed: (req.params?.speed === 'fast' || req.params?.speed === 'turbo') ? req.params.speed : 'relax',
      signal: ac.signal,
      onSubmitted: (remoteTaskId) => {
        providerTaskId = remoteTaskId;
        update({ rhTaskId: remoteTaskId, status: 'running', progress: `APIMart 已提交 · ${version.toUpperCase()}` });
      },
      onProgress: (progress) => update({ status: progress.includes('下载') ? 'downloading' : 'running', progress }),
    });
    const displayUrls = result.paths.map((path) => convertFileSrc(path));
    update({
      status: 'succeeded',
      progress: fallbackUsed ? '完成（APIMart 备用通道）' : '完成（APIMart）',
      rhTaskId: result.taskId,
      resultPaths: result.paths,
      resultUrls: result.urls,
      fallbackUsed,
      finishedAt: Date.now(),
    });
    for (const path of result.paths) {
      void appendArtifact({ path, type: 'image', engine: APIMART_MIDJOURNEY_ENDPOINT, prompt: req.prompt, taskId });
    }
    void appendGenerationLog({
      timestamp: new Date().toISOString(),
      director: '',
      taskType: 'text-to-image',
      engine: 'other',
      prompt: req.prompt,
      outputPath: result.paths[0],
      outputPaths: result.paths,
      model: `midjourney-${version}`,
      taskId,
      providerTaskId: result.taskId,
      endpoint: APIMART_MIDJOURNEY_ENDPOINT,
      shotNo: req.workshopShotNo,
      params: { ...(req.params ?? {}), version },
      refs: refs.map((source, index) => ({ index: index + 1, type: 'image' as const, source })),
    }).catch(() => {});
    return {
      success: true,
      taskId,
      resultPaths: result.paths,
      resultUrls: displayUrls,
      engineKind: 'image',
      fallbackUsed,
      providerTaskId: result.taskId,
    };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (err instanceof DOMException && err.name === 'AbortError') {
      update({ status: 'failed', error: '已取消', finishedAt: Date.now() });
      return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'image', error: '已取消' };
    }
    if (providerTaskId && !(err instanceof ApimartMidjourneyTaskError)) {
      update({ status: 'running', rhTaskId: providerTaskId, progress: '连接暂时中断，后台继续查询 APIMart 结果…', error: undefined });
      return {
        success: false,
        taskId,
        resultPaths: [],
        resultUrls: [],
        engineKind: 'image',
        error: `${reason}（后台仍在继续查询结果）`,
        providerTaskId,
        backgroundPending: true,
      };
    }
    update({ status: 'failed', error: reason, finishedAt: Date.now() });
    return {
      success: false,
      taskId,
      resultPaths: [],
      resultUrls: [],
      engineKind: 'image',
      error: reason,
      providerTaskId,
      providerFailed: err instanceof ApimartMidjourneyTaskError,
    };
  } finally {
    taskAborts.delete(taskId);
    useCanvasTaskStore.getState().updateTask(taskId, { inFlight: false });
    releaseSlot();
  }
}

async function runMidjourneyGeneration(req: CoreGenRequest): Promise<CoreGenResult> {
  // 2026-08: RunningHub 悠船（海外节点）已下线，Midjourney 只走 APIMart。
  return runApimartMidjourneyGeneration(req, midjourneyVersionOf(req));
}

async function runApimartMinimaxH3Generation(
  req: CoreGenRequest,
  fallbackUsed = false,
): Promise<CoreGenResult> {
  const imageRefs = req.referenceUrls ?? [];
  const videoRefs = req.videoUrls ?? [];
  const audioRefs = req.audioUrls ?? [];
  if (!hasApimartApiKey()) {
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'video',
      error: '未配置 APIMart API Key，请在设置 > API 密钥 > APIMart 中填写。',
    };
  }
  if (imageRefs.length > 9 || videoRefs.length > 3 || audioRefs.length > 3) {
    const detail = imageRefs.length > 9
      ? `参考图 ${imageRefs.length}/9`
      : videoRefs.length > 3
        ? `参考视频 ${videoRefs.length}/3`
        : `参考音频 ${audioRefs.length}/3`;
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'video',
      error: `APIMart MiniMax H3 参考素材超限（${detail}），请减少素材后重试。`,
    };
  }
  if (audioRefs.length > 0 && imageRefs.length === 0 && videoRefs.length === 0) {
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'video',
      error: 'APIMart MiniMax H3 不能只传音频，至少还需要一张参考图或一段参考视频。',
    };
  }
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId: req.nodeId ?? '',
    kind: 'video',
    engineId: 'minimax-hailuo-h3',
    engineLabel: 'MiniMax H3 · APIMart',
    endpoint: APIMART_MINIMAX_H3_ENDPOINT,
    prompt: req.prompt,
    referenceUrls: imageRefs.length > 0 ? imageRefs : undefined,
    params: req.params,
    projectId: req.projectId,
    workshopShotNo: req.workshopShotNo,
    workshopShotKind: req.workshopShotKind,
    workshopStoryboardFrameId: req.workshopStoryboardFrameId,
    inFlight: true,
    fallbackUsed,
    submissionReceipt: {
      requestedImages: imageRefs.length,
      requestedAudio: audioRefs.length,
      requestedVideo: videoRefs.length,
      submittedImages: imageRefs.length,
      submittedAudio: audioRefs.length,
      submittedVideo: videoRefs.length,
      provider: APIMART_MINIMAX_H3_ENDPOINT,
      fallbackUsed,
    },
  });
  const ac = new AbortController();
  taskAborts.set(taskId, ac);
  try { req.onTaskCreated?.(taskId); } catch { /* callback must not break a paid task */ }
  const update = (patch: Partial<CanvasTask>) => useCanvasTaskStore.getState().updateTask(taskId, patch);
  let providerTaskId = '';
  try {
    await acquireSlot(taskId);
    if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    update({ status: 'uploading', progress: fallbackUsed ? '主通道失败，准备 APIMart H3…' : '准备 APIMart H3 参考素材…' });
    const imageUrls = await Promise.all(imageRefs.map((source, index) =>
      resolveApimartPublicMedia(source, index, (message) => update({ progress: message }))));
    const videoUrls = await Promise.all(videoRefs.map((source, index) =>
      resolveApimartPublicMedia(source, index + imageUrls.length, (message) => update({ progress: message }))));
    const audioUrls = await Promise.all(audioRefs.map((source, index) =>
      resolveApimartPublicMedia(source, index + imageUrls.length + videoUrls.length, (message) => update({ progress: message }))));
    providerTaskId = await submitApimartTask({
      path: '/v1/videos/generations',
      label: 'APIMart MiniMax H3',
      signal: ac.signal,
      payload: buildApimartMinimaxH3Payload({
        prompt: req.prompt,
        imageUrls,
        videoUrls,
        audioUrls,
        duration: typeof req.params?.duration === 'number' || typeof req.params?.duration === 'string'
          ? req.params.duration
          : undefined,
        resolution: typeof req.params?.resolution === 'string' ? req.params.resolution : undefined,
        aspectRatio: String(req.params?.ratio ?? req.params?.aspectRatio ?? 'adaptive'),
      }),
    });
    update({ rhTaskId: providerTaskId, status: 'running', progress: 'APIMart H3 已提交，等待生成…' });
    const state = await pollApimartTask({
      taskId: providerTaskId,
      kind: 'video',
      label: 'APIMart MiniMax H3',
      signal: ac.signal,
      onProgress: (progress) => update({ status: 'running', progress }),
    });
    update({ status: 'downloading', progress: 'H3 已完成，正在保存视频…', resultUrls: state.urls });
    const paths = await rhtvDownloadAll(state.urls, 'video', 'minimax-hailuo-h3', (progress) => update({ progress }));
    update({ status: 'succeeded', progress: '完成', resultPaths: paths, resultUrls: state.urls, finishedAt: Date.now() });
    for (const path of paths) {
      void appendArtifact({ path, type: 'video', engine: APIMART_MINIMAX_H3_ENDPOINT, prompt: req.prompt, taskId });
    }
    return {
      success: true,
      taskId,
      resultPaths: paths,
      resultUrls: paths.map((path) => convertFileSrc(path)),
      engineKind: 'video',
      fallbackUsed,
      providerTaskId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DOMException && error.name === 'AbortError') {
      update({ status: 'failed', error: '已取消', finishedAt: Date.now() });
      return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video', error: '已取消' };
    }
    if (error instanceof PaidTaskCreatedError) providerTaskId = error.taskId;
    if (providerTaskId && !(error instanceof ApimartTaskFailedError)) {
      update({ status: 'running', rhTaskId: providerTaskId, progress: '连接暂时中断，后台继续查询 APIMart H3…', error: undefined });
      return {
        success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video',
        error: `${message}（后台仍在继续查询结果）`, providerTaskId, backgroundPending: true,
      };
    }
    const submissionUncertain = error instanceof PaidSubmissionUnknownError || mustNotAutoResubmit(error);
    update({ status: 'failed', error: message, progress: message, finishedAt: Date.now() });
    return {
      success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video', error: message,
      providerTaskId,
      providerFailed: error instanceof ApimartTaskFailedError,
      submissionUncertain,
    };
  } finally {
    taskAborts.delete(taskId);
    useCanvasTaskStore.getState().updateTask(taskId, { inFlight: false });
    releaseSlot();
  }
}

/** 各视频渠道的统一展示名 */
function videoChannelLabel(channel: string): string {
  if (channel === 'runninghub') return 'RunningHub';
  if (channel === 'apimart') return 'APIMart';
  return '筷子丽帧';
}

/**
 * 多渠道视频容灾通用循环：首选失败后，按 available 顺序依次尝试剩余渠道。
 * 已扣费/仍在跑/提交状态不明/已取消时立即停止——绝不自动重发付费请求。
 */
async function runVideoChannelCascade<C extends string>(input: {
  available: C[];
  first: C;
  runChannel: (channel: C, fallbackUsed: boolean) => Promise<CoreGenResult>;
}): Promise<CoreGenResult> {
  const tried: C[] = [input.first];
  const attemptErrors: string[] = [];
  let result = await input.runChannel(input.first, false);
  if (!result.success) attemptErrors.push(`${videoChannelLabel(input.first)}: ${result.error ?? '失败'}`);

  while (true) {
    const paidOrStillRunning = result.success || result.backgroundPending || result.submissionUncertain
      || result.submissionCommitted || result.automaticRetryBlocked
      || Boolean(result.providerTaskId && !result.providerFailed);
    const cancelled = result.error === '已取消';
    if (paidOrStillRunning || cancelled) return result;
    const next = input.available.find((channel) => !tried.includes(channel));
    if (!next) break;
    if (result.taskId) useCanvasTaskStore.getState().removeTask(result.taskId);
    result = await input.runChannel(next, true);
    tried.push(next);
    if (!result.success && !result.backgroundPending && !result.submissionUncertain) {
      attemptErrors.push(`${videoChannelLabel(next)}: ${result.error ?? '失败'}`);
    }
  }
  return { ...result, error: attemptErrors.join('；') };
}

/**
 * 筷子系视频渠道（H3 / 万相 3.0）的 canvasGen 包装：任务队列注册、并发槽、
 * 计费安全错误语义与 runKuaiziSeedanceGeneration 对齐。
 */
async function runKuaiziVideoChannel(
  req: CoreGenRequest,
  opts: {
    engineLabel: string;
    endpoint: string;
    provider: string;
    fallbackUsed?: boolean;
    run: (args: {
      signal: AbortSignal;
      onProgress: (phase: string) => void;
      onProviderTaskCreated: (remoteTaskId: string) => void;
    }) => Promise<{ taskId: string; resultPaths: string[]; resultUrls: string[] }>;
  },
): Promise<CoreGenResult> {
  const refs = req.referenceUrls ?? [];
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId: req.nodeId ?? '',
    kind: 'video',
    engineId: req.engineId,
    engineLabel: opts.engineLabel,
    endpoint: opts.endpoint,
    prompt: req.prompt,
    referenceUrls: refs.length > 0 ? refs : undefined,
    params: req.params,
    projectId: req.projectId,
    workshopShotNo: req.workshopShotNo,
    workshopShotKind: req.workshopShotKind,
    workshopStoryboardFrameId: req.workshopStoryboardFrameId,
    inFlight: true,
    fallbackUsed: opts.fallbackUsed,
  });
  const ac = new AbortController();
  taskAborts.set(taskId, ac);
  try { req.onTaskCreated?.(taskId); } catch { /* caller callback must not break a paid task */ }
  const update = (patch: Partial<CanvasTask>) =>
    useCanvasTaskStore.getState().updateTask(taskId, patch);
  let providerTaskId = '';

  try {
    await acquireSlot(taskId);
    if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    update({ status: 'uploading', progress: `准备${opts.engineLabel}参考素材…` });
    const result = await opts.run({
      signal: ac.signal,
      onProviderTaskCreated: (remoteTaskId) => {
        providerTaskId = remoteTaskId;
        update({ rhTaskId: remoteTaskId, status: 'running', progress: `已提交${opts.engineLabel}任务，等待生成…` });
      },
      onProgress: (phase) => {
        const status = /下载/.test(phase) ? 'downloading' : /上传|COS/.test(phase) ? 'uploading' : 'running';
        update({ status, progress: phase });
      },
    });

    update({
      status: 'succeeded',
      progress: `完成（${opts.engineLabel}）`,
      rhTaskId: result.taskId,
      resultPaths: result.resultPaths,
      resultUrls: [],
      finishedAt: Date.now(),
    });
    return {
      success: true,
      taskId,
      resultPaths: result.resultPaths,
      resultUrls: result.resultUrls,
      engineKind: 'video',
      fallbackUsed: opts.fallbackUsed,
    };
  } catch (err) {
    const kuaiziRetryStopped = shouldStopAutomaticPaidFallback(err, 'kuaizi-video');
    const rawMessage = kuaiziRetryStopped
      ? paidRetryStoppedMessage(err, opts.engineLabel)
      : err instanceof Error ? err.message : String(err);
    const msg = err instanceof DOMException && err.name === 'AbortError'
      ? '已取消'
      : `${opts.engineLabel}失败: ${rawMessage}`;
    // 业务错误（余额不足 / 远端 failed 终态）不产生扣费，视为可安全降级的 provider 终态
    const providerFailed = err instanceof KuaiziBusinessError
      && (err.kind === 'task_failed' || err.kind === 'balance');
    const protectedTaskId = providerTaskId || paidTaskId(err) || '';
    const submissionUncertain = kuaiziRetryStopped && !protectedTaskId;
    const recoverable = Boolean(protectedTaskId)
      && !(err instanceof DOMException && err.name === 'AbortError')
      && !(err instanceof KuaiziBusinessError)
      && (mustNotAutoResubmit(err) || isTransientKuaiziError(err));
    update(recoverable
      ? { status: 'running', rhTaskId: protectedTaskId, progress: '网络抖动，后台继续查询结果…', error: undefined }
      : { status: 'failed', error: msg, finishedAt: Date.now() });
    await appendKuaiziLog({
      timestamp: new Date().toISOString(),
      provider: opts.provider,
      event: recoverable ? 'recoverable_failure' : 'failure',
      localTaskId: taskId,
      taskId: protectedTaskId || undefined,
      error: msg,
    });
    return {
      success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video', error: msg,
      providerTaskId: protectedTaskId || undefined,
      providerFailed,
      backgroundPending: recoverable,
      submissionUncertain,
      automaticRetryBlocked: kuaiziRetryStopped,
    };
  } finally {
    taskAborts.delete(taskId);
    useCanvasTaskStore.getState().updateTask(taskId, { inFlight: false });
    releaseSlot();
  }
}

async function runMinimaxH3Generation(req: CoreGenRequest): Promise<CoreGenResult> {
  const settings = useSettingsStore.getState();
  const available: MinimaxH3Channel[] = [];
  if (resolveApiKey(settings, 'runninghub', settings.runninghubApiKey).trim()) available.push('runninghub');
  if (hasApimartApiKey()) available.push('apimart');
  if (getKuaiziApiKey()) available.push('kuaizi');
  // 用户在「设置 → 视频与语音」里可以指定 H3 优先渠道；auto 保持按
  // 健康度/延迟自动选路。失败时仍会容灾到其余渠道（防止单点不可用）。
  const pref = settings.minimaxH3Channel ?? 'auto';
  const first = pref !== 'auto' && available.includes(pref)
    ? pref
    : chooseMinimaxH3Channel(available);
  if (!first) {
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'video',
      error: 'MiniMax H3 没有可用渠道，请在设置中填写 RunningHub、APIMart 或筷子丽帧的 API Key。',
    };
  }

  const runChannel = async (channel: MinimaxH3Channel, fallbackUsed: boolean) => {
    const startedAt = Date.now();
    const result = channel === 'apimart'
      ? await runApimartMinimaxH3Generation(req, fallbackUsed)
      : channel === 'kuaizi'
        ? await runKuaiziVideoChannel(req, {
            engineLabel: 'MiniMax H3 · 筷子丽帧',
            endpoint: 'kuaizi/minimax-h3',
            provider: 'kuaizi-minimax-h3',
            fallbackUsed,
            run: (args) => runKuaiziMinimaxH3Generation({
              prompt: req.prompt,
              referenceUrls: req.referenceUrls,
              videoUrls: req.videoUrls,
              audioUrls: req.audioUrls,
              params: req.params,
              signal: args.signal,
              onProgress: args.onProgress,
            }),
          })
        : await runStandardGeneration(req);
    const accepted = result.success || result.backgroundPending || result.submissionCommitted
      || Boolean(result.providerTaskId && !result.providerFailed);
    if (!result.submissionUncertain) {
      recordMinimaxH3Metric({
        channel,
        startedAt,
        totalMs: Date.now() - startedAt,
        success: accepted,
        error: accepted ? undefined : result.error,
      });
    }
    if (fallbackUsed && result.taskId) {
      useCanvasTaskStore.getState().updateTask(result.taskId, { fallbackUsed: true });
    }
    return fallbackUsed ? { ...result, fallbackUsed: true } : result;
  };

  return runVideoChannelCascade({ available, first, runChannel });
}

// ── 万相 3.0（wan-3.0）：筷子主渠道 + RunningHub + APIMart 三渠道容灾 ──────────

const WAN3_RHTV_ENDPOINT = 'alibaba/wan-3.0/reference-to-video';
const WAN3_RESOLUTIONS = ['480P', '720P', '1080P'];
const WAN3_RATIOS = ['adaptive', '16:9', '4:3', '1:1', '3:4', '9:16'];

function normalizeWan3Params(params: RhtvParams | undefined): {
  resolution: string;
  aspectRatio: string;
  duration: number | 'auto';
  audio: boolean;
  seed?: number;
} {
  const p = params ?? {};
  const resRaw = String(p.resolution || '720P').toUpperCase();
  const ratioRaw = String(p.ratio ?? p.aspectRatio ?? 'adaptive');
  const durRaw = String(p.duration ?? '5');
  const durationNum = Math.round(Number(durRaw));
  return {
    resolution: WAN3_RESOLUTIONS.includes(resRaw) ? resRaw : '720P',
    aspectRatio: WAN3_RATIOS.includes(ratioRaw) ? ratioRaw : 'adaptive',
    duration: durRaw === '-1' || durRaw === 'auto'
      ? 'auto'
      : Number.isFinite(durationNum) ? Math.min(30, Math.max(2, durationNum)) : 5,
    audio: p.generateAudio !== false && p.audio !== false,
    seed: Number(p.seed) > 0 ? Math.trunc(Number(p.seed)) : undefined,
  };
}

/** RunningHub 标准模型 API：alibaba/wan-3.0/reference-to-video */
async function runRhtvWan3Generation(req: CoreGenRequest, fallbackUsed = false): Promise<CoreGenResult> {
  const refs = req.referenceUrls ?? [];
  const audioRefs = req.audioUrls ?? [];
  const videoRefs = req.videoUrls ?? [];
  if (refs.length > 10 || videoRefs.length > 5 || audioRefs.length > 5) {
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'video',
      error: `万相 3.0 参考素材超限（图 ${refs.length}/10、视频 ${videoRefs.length}/5、音频 ${audioRefs.length}/5），请减少素材后重试。`,
    };
  }
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId: req.nodeId ?? '',
    kind: 'video',
    engineId: 'wan-3.0',
    engineLabel: '万相 3.0 · RunningHub',
    endpoint: WAN3_RHTV_ENDPOINT,
    prompt: req.prompt,
    referenceUrls: refs.length > 0 ? refs : undefined,
    params: req.params,
    projectId: req.projectId,
    workshopShotNo: req.workshopShotNo,
    workshopShotKind: req.workshopShotKind,
    workshopStoryboardFrameId: req.workshopStoryboardFrameId,
    inFlight: true,
    fallbackUsed,
  });
  const ac = new AbortController();
  taskAborts.set(taskId, ac);
  try { req.onTaskCreated?.(taskId); } catch { /* caller callback must not break a paid task */ }
  const update = (patch: Partial<CanvasTask>) =>
    useCanvasTaskStore.getState().updateTask(taskId, patch);
  let providerTaskId = '';
  let submissionCommitted = false;

  try {
    await acquireSlot(taskId);
    if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    update({ status: 'uploading', progress: '上传万相 3.0 参考素材…' });
    const resolvedRefs: string[] = [];
    for (const r of refs) resolvedRefs.push(await rhtvResolveMedia(r));
    const resolvedAudio: string[] = [];
    for (const a of audioRefs) resolvedAudio.push(await rhtvResolveMedia(a));
    const resolvedVideos: string[] = [];
    for (const v of videoRefs) resolvedVideos.push(await rhtvResolveMedia(v));

    const norm = normalizeWan3Params(req.params);
    const payload: RhtvParams = {
      prompt: req.prompt,
      resolution: norm.resolution,
      aspectRatio: norm.aspectRatio,
      duration: String(norm.duration),
      audio: norm.audio,
      ...(norm.seed ? { seed: norm.seed } : {}),
    };
    if (resolvedRefs.length > 0) payload.imageUrls = resolvedRefs;
    if (resolvedVideos.length > 0) payload.videoUrls = resolvedVideos;
    if (resolvedAudio.length > 0) payload.audioUrls = resolvedAudio;
    if (req.documentUrl) payload.fileUrl = req.documentUrl;
    if (req.linkUrl) payload.linkUrl = req.linkUrl;

    update({ status: 'running', progress: '已提交 RunningHub 万相 3.0，等待生成…' });
    const submitResp = await rhtvSubmit(WAN3_RHTV_ENDPOINT, payload, ac.signal);
    submissionCommitted = true;
    providerTaskId = submitResp.taskId ?? '';

    let urls: string[];
    if (submitResp.status === 'SUCCESS' && submitResp.results?.length) {
      urls = submitResp.results.map((r) => r.url || r.outputUrl || '').filter(Boolean);
    } else {
      if (!providerTaskId) throw new Error(`RunningHub 未返回 taskId: ${JSON.stringify(submitResp).slice(0, 200)}`);
      update({ rhTaskId: providerTaskId });
      const polled = await rhtvPollTask(providerTaskId, {
        signal: ac.signal,
        onProgress: (status, elapsed) => update({ progress: `${status} · ${Math.round(elapsed / 1000)}s` }),
      });
      urls = polled.urls;
    }
    const videoUrls = urls.filter(isVideoOutputUrl);
    if (videoUrls.length > 0) urls = videoUrls;
    if (urls.length === 0) throw new Error('生成完成但没有输出文件');

    update({ status: 'downloading', progress: `下载 ${urls.length} 个产物…`, resultUrls: urls });
    const paths = await rhtvDownloadAll(urls, 'video', 'wan-3.0', (phase) => update({ progress: phase }));
    update({ status: 'succeeded', progress: '完成', resultPaths: paths, finishedAt: Date.now() });
    for (const p of paths) {
      void appendArtifact({ path: p, type: 'video', engine: WAN3_RHTV_ENDPOINT, prompt: req.prompt, taskId });
    }
    void appendGenerationLog({
      timestamp: new Date().toISOString(),
      director: '',
      taskType: refs.length > 0 || videoRefs.length > 0 ? 'image-to-video' : 'text-to-video',
      engine: 'other',
      prompt: req.prompt,
      outputPath: paths[0],
      outputPaths: paths,
      model: WAN3_RHTV_ENDPOINT,
      taskId,
      providerTaskId,
      endpoint: WAN3_RHTV_ENDPOINT,
      shotNo: req.workshopShotNo,
      params: req.params,
      refs: [
        ...refs.map((source, i) => ({ index: i + 1, type: 'image' as const, source })),
        ...videoRefs.map((source, i) => ({ index: i + 1, type: 'video' as const, source })),
        ...audioRefs.map((source, i) => ({ index: i + 1, type: 'audio' as const, source })),
      ],
    }).catch(() => {});
    return {
      success: true, taskId, resultPaths: paths,
      resultUrls: paths.map((p) => convertFileSrc(p)),
      engineKind: 'video', fallbackUsed, providerTaskId,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      update({ status: 'failed', error: '已取消', finishedAt: Date.now() });
      return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video', error: '已取消' };
    }
    const submissionUncertain = err instanceof RhtvSubmissionUnknownError || mustNotAutoResubmit(err);
    if (submissionUncertain) {
      const reason = err instanceof Error ? err.message : String(err);
      update({ status: 'failed', error: reason, progress: reason, finishedAt: Date.now() });
      return {
        success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video',
        error: reason, providerTaskId: providerTaskId || paidTaskId(err), submissionUncertain: true,
      };
    }
    if (submissionCommitted && !providerTaskId) {
      const reason = err instanceof Error ? err.message : String(err);
      update({ status: 'failed', error: reason, progress: '远端已生成产物，本地处理失败；已停止容灾以避免重复扣费。', finishedAt: Date.now() });
      return {
        success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video',
        error: reason, submissionCommitted: true,
      };
    }
    // 已有远端任务且非终态拒单：保持归属，不做渠道降级（防重复扣费）
    if (providerTaskId && !isTerminalRhtvRejection(err)) {
      const reason = err instanceof Error ? err.message : String(err);
      const transient = !(err instanceof RhtvBusinessError) && isTransientKuaiziError(err);
      update(transient
        ? { status: 'running', rhTaskId: providerTaskId, progress: '网络抖动，后台继续查询结果…', error: undefined }
        : { status: 'failed', rhTaskId: providerTaskId, error: reason, progress: reason, finishedAt: Date.now() });
      return {
        success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video',
        error: transient ? `${reason}（后台仍在继续查询结果）` : reason,
        providerTaskId,
        backgroundPending: transient,
      };
    }
    const msg = err instanceof RhtvBusinessError
      ? err.message
      : `生成失败: ${err instanceof Error ? err.message : String(err)}`;
    update({ status: 'failed', error: msg, finishedAt: Date.now() });
    return {
      success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video',
      error: msg, providerTaskId,
      providerFailed: isTerminalRhtvRejection(err),
      submissionCommitted: submissionCommitted && !providerTaskId,
    };
  } finally {
    taskAborts.delete(taskId);
    useCanvasTaskStore.getState().updateTask(taskId, { inFlight: false });
    releaseSlot();
  }
}

/** APIMart：wan3.0-video（/v1/videos/generations 异步任务） */
async function runApimartWan3Generation(req: CoreGenRequest, fallbackUsed = false): Promise<CoreGenResult> {
  const imageRefs = req.referenceUrls ?? [];
  const videoRefs = req.videoUrls ?? [];
  const audioRefs = req.audioUrls ?? [];
  if (!hasApimartApiKey()) {
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'video',
      error: '未配置 APIMart API Key，请在设置 > API 密钥 > APIMart 中填写。',
    };
  }
  if (imageRefs.length > 10 || videoRefs.length > 5 || audioRefs.length > 5) {
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'video',
      error: `APIMart 万相 3.0 参考素材超限（图 ${imageRefs.length}/10、视频 ${videoRefs.length}/5、音频 ${audioRefs.length}/5），请减少素材后重试。`,
    };
  }
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId: req.nodeId ?? '',
    kind: 'video',
    engineId: 'wan-3.0',
    engineLabel: '万相 3.0 · APIMart',
    endpoint: APIMART_WAN3_ENDPOINT,
    prompt: req.prompt,
    referenceUrls: imageRefs.length > 0 ? imageRefs : undefined,
    params: req.params,
    projectId: req.projectId,
    workshopShotNo: req.workshopShotNo,
    workshopShotKind: req.workshopShotKind,
    workshopStoryboardFrameId: req.workshopStoryboardFrameId,
    inFlight: true,
    fallbackUsed,
  });
  const ac = new AbortController();
  taskAborts.set(taskId, ac);
  try { req.onTaskCreated?.(taskId); } catch { /* caller callback must not break a paid task */ }
  const update = (patch: Partial<CanvasTask>) =>
    useCanvasTaskStore.getState().updateTask(taskId, patch);
  let providerTaskId = '';
  try {
    await acquireSlot(taskId);
    if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    update({ status: 'uploading', progress: fallbackUsed ? '主通道失败，准备 APIMart 万相 3.0…' : '准备 APIMart 万相 3.0 参考素材…' });
    const imageUrls = await Promise.all(imageRefs.map((source, index) =>
      resolveApimartPublicMedia(source, index, (message) => update({ progress: message }))));
    const videoUrls = await Promise.all(videoRefs.map((source, index) =>
      resolveApimartPublicMedia(source, index + imageUrls.length, (message) => update({ progress: message }))));
    const audioUrls = await Promise.all(audioRefs.map((source, index) =>
      resolveApimartPublicMedia(source, index + imageUrls.length + videoUrls.length, (message) => update({ progress: message }))));
    const norm = normalizeWan3Params(req.params);
    providerTaskId = await submitApimartTask({
      path: '/v1/videos/generations',
      label: 'APIMart 万相 3.0',
      signal: ac.signal,
      payload: buildApimartWan3Payload({
        prompt: req.prompt,
        imageUrls,
        videoUrls,
        audioUrls,
        fileUrl: req.documentUrl,
        linkUrl: req.linkUrl,
        duration: norm.duration === 'auto' ? -1 : norm.duration,
        resolution: norm.resolution,
        aspectRatio: norm.aspectRatio,
        audio: norm.audio,
      }),
    });
    update({ rhTaskId: providerTaskId, status: 'running', progress: 'APIMart 万相 3.0 已提交，等待生成…' });
    const state = await pollApimartTask({
      taskId: providerTaskId,
      kind: 'video',
      label: 'APIMart 万相 3.0',
      signal: ac.signal,
      onProgress: (progress) => update({ status: 'running', progress }),
    });
    update({ status: 'downloading', progress: '万相 3.0 已完成，正在保存视频…', resultUrls: state.urls });
    const paths = await rhtvDownloadAll(state.urls, 'video', 'wan-3.0', (progress) => update({ progress }));
    update({ status: 'succeeded', progress: '完成', resultPaths: paths, resultUrls: state.urls, finishedAt: Date.now() });
    for (const path of paths) {
      void appendArtifact({ path, type: 'video', engine: APIMART_WAN3_ENDPOINT, prompt: req.prompt, taskId });
    }
    return {
      success: true,
      taskId,
      resultPaths: paths,
      resultUrls: paths.map((path) => convertFileSrc(path)),
      engineKind: 'video',
      fallbackUsed,
      providerTaskId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DOMException && error.name === 'AbortError') {
      update({ status: 'failed', error: '已取消', finishedAt: Date.now() });
      return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video', error: '已取消' };
    }
    if (error instanceof PaidTaskCreatedError) providerTaskId = error.taskId;
    if (providerTaskId && !(error instanceof ApimartTaskFailedError)) {
      update({ status: 'running', rhTaskId: providerTaskId, progress: '连接暂时中断，后台继续查询 APIMart 万相 3.0…', error: undefined });
      return {
        success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video',
        error: `${message}（后台仍在继续查询结果）`, providerTaskId, backgroundPending: true,
      };
    }
    const submissionUncertain = error instanceof PaidSubmissionUnknownError || mustNotAutoResubmit(error);
    update({ status: 'failed', error: message, progress: message, finishedAt: Date.now() });
    return {
      success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video', error: message,
      providerTaskId,
      providerFailed: error instanceof ApimartTaskFailedError,
      submissionUncertain,
    };
  } finally {
    taskAborts.delete(taskId);
    useCanvasTaskStore.getState().updateTask(taskId, { inFlight: false });
    releaseSlot();
  }
}

async function runWan3Generation(req: CoreGenRequest): Promise<CoreGenResult> {
  if (req.documentUrl && req.linkUrl) {
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'video',
      error: '万相 3.0 的文档与网页链接互斥，一次只能传一个。',
    };
  }
  const settings = useSettingsStore.getState();
  // 主渠道顺序：筷子 → RunningHub → APIMart（按已配置的 Key 过滤）
  const available: Wan3Channel[] = WAN3_CHANNEL_PREFERENCE.filter((channel) => {
    if (channel === 'kuaizi') return Boolean(getKuaiziApiKey());
    if (channel === 'runninghub') return Boolean(resolveApiKey(settings, 'runninghub', settings.runninghubApiKey).trim());
    return hasApimartApiKey();
  });
  const pref = settings.wan3Channel ?? 'auto';
  const first = pref !== 'auto' && available.includes(pref)
    ? pref
    : chooseWan3Channel(available);
  if (!first) {
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'video',
      error: '万相 3.0 没有可用渠道，请在设置中填写筷子丽帧、RunningHub 或 APIMart 的 API Key。',
    };
  }

  const runChannel = async (channel: Wan3Channel, fallbackUsed: boolean) => {
    const startedAt = Date.now();
    const result = channel === 'kuaizi'
      ? await runKuaiziVideoChannel(req, {
          engineLabel: '万相 3.0 · 筷子丽帧',
          endpoint: 'kuaizi/wan-3.0',
          provider: 'kuaizi-wan3',
          fallbackUsed,
          run: (args) => runKuaiziWan3Generation({
            prompt: req.prompt,
            referenceUrls: req.referenceUrls,
            videoUrls: req.videoUrls,
            audioUrls: req.audioUrls,
            documentUrl: req.documentUrl,
            linkUrl: req.linkUrl,
            params: req.params,
            signal: args.signal,
            onProgress: args.onProgress,
          }),
        })
      : channel === 'apimart'
        ? await runApimartWan3Generation(req, fallbackUsed)
        : await runRhtvWan3Generation(req, fallbackUsed);
    const accepted = result.success || result.backgroundPending || result.submissionCommitted
      || Boolean(result.providerTaskId && !result.providerFailed);
    if (!result.submissionUncertain) {
      recordWan3Metric({
        channel,
        startedAt,
        totalMs: Date.now() - startedAt,
        success: accepted,
        error: accepted ? undefined : result.error,
      });
    }
    if (fallbackUsed && result.taskId) {
      useCanvasTaskStore.getState().updateTask(result.taskId, { fallbackUsed: true });
    }
    return fallbackUsed ? { ...result, fallbackUsed: true } : result;
  };

  return runVideoChannelCascade({ available, first, runChannel });
}

export async function runGeneration(req: CoreGenRequest): Promise<CoreGenResult> {
  if (isMidjourneyEngine(req.engineId)) return runMidjourneyGeneration(req);
  if (req.engineId === 'minimax-hailuo-h3') return runMinimaxH3Generation(req);
  if (req.engineId === 'wan-3.0') return runWan3Generation(req);
  if (req.engineId === 'suno-v5' || req.engineId === 'suno') return runSunoGeneration(req);
  return runStandardGeneration(req);
}

// ── Suno 音乐生成（APIMart /v1/music/generations，2026-08 接回）──────────────
async function runSunoGeneration(req: CoreGenRequest): Promise<CoreGenResult> {
  if (!hasApimartApiKey()) {
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'audio',
      error: 'Suno 现在走 APIMart 通道，请在「设置 → 视频与语音 → Omni MG 渠道 → APIMart」中填写 Key。',
    };
  }
  const version = String(req.params?.version ?? 'v5');
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId: req.nodeId ?? '',
    kind: 'audio',
    engineId: 'suno-v5',
    engineLabel: `Suno ${version} · APIMart`,
    endpoint: APIMART_SUNO_ENDPOINT,
    prompt: req.prompt,
    params: req.params,
    projectId: req.projectId,
    workshopShotNo: req.workshopShotNo,
    workshopShotKind: req.workshopShotKind,
    workshopStoryboardFrameId: req.workshopStoryboardFrameId,
    inFlight: true,
  });
  const ac = new AbortController();
  taskAborts.set(taskId, ac);
  try { req.onTaskCreated?.(taskId); } catch { /* callback must not break a paid task */ }
  const update = (patch: Partial<CanvasTask>) => useCanvasTaskStore.getState().updateTask(taskId, patch);
  let providerTaskId = '';
  try {
    await acquireSlot(taskId);
    if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    update({ status: 'running', progress: 'Suno 已提交，等待生成…' });
    providerTaskId = await submitApimartTask({
      path: '/v1/music/generations',
      label: 'APIMart Suno',
      signal: ac.signal,
      payload: buildApimartSunoPayload({
        prompt: req.prompt,
        custom: req.params?.custom !== false && req.params?.custom !== 'false',
        instrumental: req.params?.instrumental === true || req.params?.instrumental === 'true',
        version,
        title: typeof req.params?.title === 'string' ? req.params.title : undefined,
        style: typeof req.params?.style === 'string' ? req.params.style : undefined,
        negativeTags: typeof req.params?.negativeTags === 'string' ? req.params.negativeTags : undefined,
        vocalGender: req.params?.vocalGender === 'Male' || req.params?.vocalGender === 'Female'
          ? req.params.vocalGender
          : undefined,
      }),
    });
    update({ rhTaskId: providerTaskId });
    const state = await pollApimartTask({
      taskId: providerTaskId,
      kind: 'music',
      label: 'APIMart Suno',
      signal: ac.signal,
      maxMs: 8 * 60_000,
      onProgress: (progress) => update({ status: 'running', progress }),
    });
    const urls = state.urls.slice(0, 2);
    if (urls.length === 0) throw new Error('Suno 生成完成但没有返回音频地址');
    update({ status: 'downloading', progress: '生成完成，正在保存音频…', resultUrls: urls });
    const paths = await rhtvDownloadAll(urls, 'audio', 'suno', (progress) => update({ progress }));
    update({ status: 'succeeded', progress: '完成', resultPaths: paths, resultUrls: urls, finishedAt: Date.now() });
    for (const path of paths) {
      void appendArtifact({ path, type: 'audio', engine: APIMART_SUNO_ENDPOINT, prompt: req.prompt, taskId });
    }
    return {
      success: true, taskId, resultPaths: paths,
      resultUrls: paths.map((path) => convertFileSrc(path)),
      engineKind: 'audio',
      providerTaskId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DOMException && error.name === 'AbortError') {
      update({ status: 'failed', error: '已取消', finishedAt: Date.now() });
      return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'audio', error: '已取消' };
    }
    if (error instanceof PaidTaskCreatedError) providerTaskId = error.taskId;
    update({ status: 'failed', rhTaskId: providerTaskId || undefined, error: message, finishedAt: Date.now() });
    return {
      success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'audio',
      error: message,
      providerTaskId: providerTaskId || undefined,
      providerFailed: error instanceof ApimartTaskFailedError,
    };
  } finally {
    taskAborts.delete(taskId);
    useCanvasTaskStore.getState().updateTask(taskId, { inFlight: false });
    releaseSlot();
  }
}

// ── Seedance 2.0 via 火山方舟 Ark（contents/generations/tasks）──────────────
// 参考图内联为 data URI；参考视频/音频仅支持公网 URL（本地文件请先用 COS 中转）。
async function runArkSeedanceGeneration(req: CoreGenRequest): Promise<CoreGenResult> {
  const settings = useSettingsStore.getState();
  if (!resolveApiKey(settings, 'ark', settings.arkApiKey).trim()) {
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'video',
      error: '未配置火山方舟 API Key，请在「设置 → 视频与语音 → 火山方舟 Seedance」中填写。',
    };
  }
  const model = arkModelForSeedanceEngine(req.engineId);
  const refs = req.referenceUrls ?? [];
  const videoRefs = req.videoUrls ?? [];
  const audioRefs = req.audioUrls ?? [];
  const localVideo = [...videoRefs, ...audioRefs].filter((u) => !/^https?:\/\//i.test(u));
  if (localVideo.length > 0) {
    return {
      success: false, taskId: '', resultPaths: [], resultUrls: [], engineKind: 'video',
      error: '火山方舟通道的参考视频/音频需要公网 URL；本地文件请先在「存储与集成」配置 COS 中转，或改用筷子丽帧/RunningHub 通道。',
    };
  }
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId: req.nodeId ?? '',
    kind: 'video',
    engineId: req.engineId,
    engineLabel: `Seedance 2.0 · 火山方舟`,
    endpoint: `ark/${model}`,
    prompt: req.prompt,
    referenceUrls: refs.length > 0 ? refs : undefined,
    params: req.params,
    projectId: req.projectId,
    workshopShotNo: req.workshopShotNo,
    workshopShotKind: req.workshopShotKind,
    workshopStoryboardFrameId: req.workshopStoryboardFrameId,
    inFlight: true,
  });
  const ac = new AbortController();
  taskAborts.set(taskId, ac);
  try { req.onTaskCreated?.(taskId); } catch { /* callback must not break a paid task */ }
  const update = (patch: Partial<CanvasTask>) => useCanvasTaskStore.getState().updateTask(taskId, patch);
  let providerTaskId = '';
  try {
    await acquireSlot(taskId);
    if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    update({ status: 'uploading', progress: '准备火山方舟参考素材…' });
    const content: SeedanceContentItem[] = [{ type: 'text', text: req.prompt }];
    for (const [index, source] of refs.entries()) {
      const url = /^https?:\/\//i.test(source)
        ? source
        : (await loadMediaInput(source)).dataUrl;
      const role = req.engineId === 'startend-v3.1-pro'
        ? (index === 0 ? 'first_frame' : 'last_frame')
        : undefined;
      content.push({ type: 'image_url', image_url: { url }, ...(role ? { role } : {}) });
    }
    for (const url of videoRefs) content.push({ type: 'video_url', video_url: { url } });
    for (const url of audioRefs) content.push({ type: 'audio_url', audio_url: { url } });

    update({ status: 'running', progress: '火山方舟 Seedance 已提交，等待生成…' });
    let created;
    try {
      created = await arkCreateTask({
        model,
        content,
        duration: typeof req.params?.duration === 'number' ? req.params.duration
          : Number(req.params?.duration) || undefined,
        ratio: String(req.params?.ratio ?? req.params?.aspectRatio ?? 'adaptive'),
        resolution: typeof req.params?.resolution === 'string' ? req.params.resolution : undefined,
        generate_audio: req.params?.generateAudio !== false,
      });
    } catch (submitError) {
      const message = submitError instanceof Error ? submitError.message : String(submitError);
      const statusMatch = message.match(/API error: (\d{3})/);
      const status = statusMatch ? Number(statusMatch[1]) : 0;
      const lower = message.toLowerCase();
      // 认证/余额类错误不可能已创建任务（不扣费），可以安全降级或重试；
      // 408/5xx 可能已创建，按「提交结果未知」处理，禁止盲目重放。
      const terminal = status === 401 || status === 403
        || /balance|insufficient|余额|quota/.test(lower);
      const uncertain = isAmbiguousPaidSubmitStatus(status);
      update({ status: 'failed', error: message, finishedAt: Date.now() });
      return {
        success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video',
        error: message, providerFailed: terminal, submissionUncertain: uncertain,
      };
    }
    providerTaskId = created.id ?? '';
    if (!providerTaskId) throw new Error(`火山方舟未返回任务 ID: ${JSON.stringify(created).slice(0, 200)}`);
    update({ rhTaskId: providerTaskId });
    const done = await arkPollUntilDone(providerTaskId, (status) => update({ progress: `火山方舟 ${status}` }), 10_000, ac.signal);
    if (done.status === 'failed') {
      const detail = done.error?.message || '生成失败';
      update({ status: 'failed', rhTaskId: providerTaskId, error: detail, finishedAt: Date.now() });
      return {
        success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video',
        error: `火山方舟任务失败: ${detail}`, providerTaskId, providerFailed: true,
      };
    }
    const videoUrl = done.content?.video_url;
    if (!videoUrl) throw new Error('火山方舟生成完成但没有返回视频地址');
    update({ status: 'downloading', progress: '生成完成，正在保存视频…', resultUrls: [videoUrl] });
    const paths = await rhtvDownloadAll([videoUrl], 'video', `ark-${model}`, (progress) => update({ progress }));
    update({ status: 'succeeded', progress: '完成', resultPaths: paths, resultUrls: [videoUrl], finishedAt: Date.now() });
    for (const path of paths) {
      void appendArtifact({ path, type: 'video', engine: `ark/${model}`, prompt: req.prompt, taskId });
    }
    return {
      success: true, taskId, resultPaths: paths,
      resultUrls: paths.map((path) => convertFileSrc(path)),
      engineKind: 'video',
      providerTaskId,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof DOMException && error.name === 'AbortError') {
      update({ status: 'failed', error: '已取消', finishedAt: Date.now() });
      return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video', error: '已取消' };
    }
    update({ status: 'failed', rhTaskId: providerTaskId || undefined, error: message, finishedAt: Date.now() });
    return {
      success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video',
      error: message, providerTaskId: providerTaskId || undefined,
    };
  } finally {
    taskAborts.delete(taskId);
    useCanvasTaskStore.getState().updateTask(taskId, { inFlight: false });
    releaseSlot();
  }
}

// ── Core: store-agnostic generation run ──────────────────────────────────────
async function runStandardGeneration(req: CoreGenRequest): Promise<CoreGenResult> {
  if (req.engineId === DREAMINA_SEEDANCE_25_ENGINE_ID) {
    // Seedance 2.5：默认筷子丽帧（mode=seedance2.5），仅提交前/提交即失败时降级即梦 CLI
    return runSeedance25Generation(req);
  }
  if (req.engineId === KUAIZI_SEEDANCE_ENGINE_ID) {
    return runKuaiziSeedanceGeneration(req);
  }

  // Mini 的 -1 是 RunningHub 上游的“自动时长”语义，筷子只接受具体秒数。
  // 不能把 -1 钳成 4 秒悄悄改变用户选择；保留该请求走原生 RHTV 路由。
  if (
    isSeedanceVideoEngine(req.engineId)
    && shouldUseKuaiziForSeedance()
    && !requestsProviderAutoDuration(req)
  ) {
    return runKuaiziSeedanceGeneration(req);
  }

  // 火山方舟通道：用户在「设置 → 视频与语音」选择的 Seedance 2.0 通道。
  if (isSeedanceVideoEngine(req.engineId) && getSeedanceEngineChoice() === 'ark') {
    return runArkSeedanceGeneration(req);
  }

  const refs = req.referenceUrls ?? [];
  const requestedRouteModel = imageRouteModelForEngine(req.engineId);
  if (requestedRouteModel === 'seedream-v5-pro' && refs.length > 10) {
    return {
      success: false,
      taskId: '',
      resultPaths: [],
      resultUrls: [],
      engineKind: 'image',
      error: `Seedream 5.0 Pro 最多支持 10 张参考图，当前 ${refs.length} 张。`,
    };
  }
  const channel = req.forceChannel
    ?? (requestedRouteModel === 'seedream-v5-pro'
      ? chooseSeedreamProChannel(req.engineId, refs.length > 0)
      : chooseGptImageChannel(req.engineId, refs.length > 0));
  if (channel.startsWith('api:') || channel.startsWith('dreamina:')) {
    return runApiCompatibleImageGeneration(req, channel);
  }
  const routedReq = channel !== req.engineId ? { ...req, engineId: channel } : req;
  const resolved = resolveGenEngine(routedReq);
  if (!resolved.engine) {
    return { success: false, taskId: '', resultPaths: [], resultUrls: [], error: resolved.error };
  }
  const engine = resolved.engine;
  const isRoutedImageEngine = engine.id.startsWith('gpt-image-2') || isSeedreamProImageEngine(engine.id);
  const taskEngineId = isSeedreamProImageEngine(engine.id) ? channel : engine.id;

  const taskStore = useCanvasTaskStore.getState();
  const taskId = taskStore.addTask({
    nodeId: req.nodeId ?? '',
    kind: engine.kind,
    engineId: taskEngineId,
    engineLabel: engine.label,
    endpoint: engine.endpoint,
    prompt: routedReq.prompt,
    referenceUrls: refs.length > 0 ? refs : undefined,
    params: req.params,
    projectId: req.projectId,
    workshopShotNo: routedReq.workshopShotNo,
    workshopShotKind: routedReq.workshopShotKind,
    workshopStoryboardFrameId: routedReq.workshopStoryboardFrameId,
    inFlight: true,
  });
  const ac = new AbortController();
  taskAborts.set(taskId, ac);
  try { req.onTaskCreated?.(taskId); } catch { /* caller callback must not break the run */ }
  const update = (patch: Partial<CanvasTask>) =>
    useCanvasTaskStore.getState().updateTask(taskId, patch);
  const routeStartedAt = new Date().toISOString();
  const routeT0 = Date.now();
  let uploadMs = 0;
  let submitMs = 0;
  let queueMs = 0;
  let downloadMs = 0;
  let submittedParams: RhtvParams | undefined;
  let submittedNodeInfoList: RhtvAppNodeInfo[] | undefined;
  let providerTaskId = '';
  let submissionCommitted = false;
  const recordRoute = (success: boolean, error?: unknown) => {
    if (!isRoutedImageEngine) return;
    recordImageRouteMetric({
      routeId: channel,
      engineId: engine.id,
      mode: refs.length > 0 ? 'image-to-image' : 'text-to-image',
      startedAt: routeStartedAt,
      uploadMs,
      submitMs,
      queueMs,
      downloadMs,
      totalMs: Date.now() - routeT0,
      success,
      errorType: error instanceof RhtvBusinessError ? error.kind : error ? 'runtime' : undefined,
      errorMessage: error instanceof Error ? error.message : error ? String(error) : undefined,
      webappId: engine.appConfig?.webappId,
    });
  };

  try {
    await acquireSlot(taskId);
    if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    const mainStartedAt = Date.now();
    const ensureMainBudget = (phase: string) => {
      if (!isRoutedImageEngine) return;
      const elapsed = Date.now() - mainStartedAt;
      if (elapsed > IMAGE_MAIN_CHAIN_TIMEOUT_MS) {
        throw new Error(`RHTV 图片主链超过 180 秒（${phase}），转入生图 API 降级链`);
      }
    };

    // 1) Resolve references (upload as needed)
    update({ status: 'uploading', progress: '上传参考素材…' });
    const uploadStarted = Date.now();
    const useAppApi = !!engine.appConfig;
    if (engine.kind === 'image' && useAppApi && refs.length > appImageSlotCount(engine)) {
      throw new Error(isRoutedImageEngine
        ? `RunningHub AI 应用最多接收 ${appImageSlotCount(engine)} 张图，本次 ${refs.length} 张，转入生图 API 降级链`
        : `RunningHub AI 应用最多接收 ${appImageSlotCount(engine)} 张图，本次 ${refs.length} 张`);
    }
    const resolvedRefs: string[] = [];
    for (const r of refs) {
      ensureMainBudget('上传参考素材前');
      resolvedRefs.push(useAppApi ? await rhtvResolveMediaForApp(r) : await rhtvResolveMedia(r));
      ensureMainBudget('上传参考素材后');
    }
    const resolvedAudio: string[] = [];
    for (const a of req.audioUrls ?? []) {
      resolvedAudio.push(useAppApi ? await rhtvResolveMediaForApp(a) : await rhtvResolveMedia(a));
    }
    const resolvedVideos: string[] = [];
    for (const v of req.videoUrls ?? []) {
      resolvedVideos.push(useAppApi ? await rhtvResolveMediaForApp(v) : await rhtvResolveMedia(v));
    }
    uploadMs = Date.now() - uploadStarted;

    // 2) Build payload
    const payload: RhtvParams = {
      prompt: req.prompt,
      ...(engine.fixedParams ?? {}),
    };
    for (const p of engine.params) {
      if (p.default !== undefined) payload[p.key] = p.default;
    }
    Object.assign(payload, req.params ?? {});
    // Drop 'empty' aspectRatio sentinel only when user didn't pick one
    if (payload.aspectRatio === 'empty') delete payload.aspectRatio;
    if (isSeedreamProImageEngine(engine.id)) normalizeSeedreamProPayload(payload);
    submittedParams = { ...payload };

    // 3) Submit + poll
    ensureMainBudget('提交前');
    update({ status: 'running', progress: '已提交，等待生成…' });
    let submitResp: RhtvSubmitResponse;
    const submitStarted = Date.now();
    if (useAppApi) {
      const nodeInfoList = buildNodeInfoList(engine, req.prompt, payload, resolvedRefs, resolvedVideos, resolvedAudio);
      submittedNodeInfoList = nodeInfoList;
      console.log(`[canvasGen] RHTV AI 应用提交: ${engine.label}, images=${resolvedRefs.length}, videos=${resolvedVideos.length}, audios=${resolvedAudio.length}, nodeInfo=${nodeInfoList.length}`);
      submitResp = await rhtvSubmitApp(effectiveRhtvWebappId(engine.appConfig!.webappId), nodeInfoList, ac.signal);
    } else {
      // Standard model API path (domestic engines)
      if (engine.mode === 'start-end-video') {
        payload.firstFrameUrl = resolvedRefs[0];
        if (resolvedRefs[1]) payload.lastFrameUrl = resolvedRefs[1];
      } else if (engine.imageParam && resolvedRefs.length > 0) {
        payload[engine.imageParam.key] = engine.imageParam.multiple
          ? resolvedRefs
          : resolvedRefs[0];
      }
      if (engine.audioParam && resolvedAudio.length > 0) {
        payload[engine.audioParam.key] = engine.audioParam.multiple
          ? resolvedAudio
          : resolvedAudio[0];
      }
      if (engine.videoParam && resolvedVideos.length > 0) {
        payload[engine.videoParam.key] = engine.videoParam.multiple
          ? resolvedVideos
          : resolvedVideos[0];
      }
      submitResp = await rhtvSubmit(engine.endpoint, payload, ac.signal);
    }
    submissionCommitted = true;
    submitMs = Date.now() - submitStarted;
    ensureMainBudget('提交后');
    const rhTaskId = submitResp.taskId;
    providerTaskId = rhTaskId ?? '';
    let urls: string[];
    if (submitResp.status === 'SUCCESS' && submitResp.results?.length) {
      urls = submitResp.results.map((r) => r.url || r.outputUrl || '').filter(Boolean);
    } else {
      if (!rhTaskId) throw new Error(`RunningHub 未返回 taskId: ${JSON.stringify(submitResp).slice(0, 200)}`);
      update({ rhTaskId });
      const pollStarted = Date.now();
      const polled = await rhtvPollTask(rhTaskId, {
        signal: ac.signal,
        maxMs: isRoutedImageEngine
          ? Math.max(1, IMAGE_MAIN_CHAIN_TIMEOUT_MS - (Date.now() - mainStartedAt))
          : undefined,
        onProgress: (status, elapsed) =>
          update({ progress: `${status} · ${Math.round(elapsed / 1000)}s` }),
      });
      queueMs = Date.now() - pollStarted;
      urls = polled.urls;
    }
    if (engine.kind === 'video') {
      const videoUrls = urls.filter(isVideoOutputUrl);
      if (videoUrls.length > 0) urls = videoUrls;
    }
    if (urls.length === 0) throw new Error('生成完成但没有输出文件');

    // 4) Download outputs
    update({ status: 'downloading', progress: `下载 ${urls.length} 个产物…`, resultUrls: urls });
    const downloadStarted = Date.now();
    const paths = await rhtvDownloadAll(urls, engine.kind, engine.id, (phase) => {
      update({ progress: phase });
    });
    downloadMs = Date.now() - downloadStarted;

    update({ status: 'succeeded', progress: '完成', resultPaths: paths, finishedAt: Date.now() });
    for (const p of paths) {
      void appendArtifact({
        path: p,
        type: engine.kind,
        engine: engine.endpoint,
        prompt: req.prompt,
        taskId,
      });
    }
    void appendGenerationLog({
      timestamp: new Date().toISOString(),
      director: '',
      taskType: generationTaskType(engine, refs.length),
      engine: engine.id.startsWith('gpt-image') ? 'gpt-image-2' : engine.id.startsWith('seedance') ? 'seedance' : 'other',
      prompt: req.prompt,
      outputPath: paths[0],
      outputPaths: paths,
      model: engine.endpoint,
      taskId,
      providerTaskId,
      endpoint: engine.endpoint,
      webappId: engine.appConfig?.webappId,
      shotNo: req.workshopShotNo,
      params: req.params,
      submittedParams,
      nodeInfoList: submittedNodeInfoList,
      refs: [
        ...refs.map((source, i) => ({ index: i + 1, type: 'image' as const, source })),
        ...(req.audioUrls ?? []).map((source, i) => ({ index: i + 1, type: 'audio' as const, source })),
        ...(req.videoUrls ?? []).map((source, i) => ({ index: i + 1, type: 'video' as const, source })),
      ],
      validation: engine.mode === 'multimodal-video'
        ? {
            passed: true,
            errors: [],
            warnings: validateSeedancePromptDetailed(req.prompt, { refCount: refs.length, requireSceneRef: false, allowVideoRefs: true }).warnings,
          }
        : undefined,
    }).catch(() => {});

    recordRoute(true);
    return {
      success: true, taskId, resultPaths: paths,
      resultUrls: paths.map((p) => convertFileSrc(p)),
      engineKind: engine.kind,
    };
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      update({ status: 'failed', error: '已取消', finishedAt: Date.now() });
      return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: engine.kind, error: '已取消' };
    }

    const submissionUncertain = err instanceof RhtvSubmissionUnknownError || mustNotAutoResubmit(err);
    if (!isRoutedImageEngine && submissionUncertain) {
      const reason = err instanceof Error ? err.message : String(err);
      recordRoute(false, err);
      update({ status: 'failed', error: reason, progress: reason, finishedAt: Date.now() });
      return {
        success: false,
        taskId,
        resultPaths: [],
        resultUrls: [],
        engineKind: engine.kind,
        error: reason,
        providerTaskId: providerTaskId || paidTaskId(err),
        submissionUncertain: true,
      };
    }

    if (!isRoutedImageEngine && submissionCommitted && !providerTaskId) {
      const reason = err instanceof Error ? err.message : String(err);
      recordRoute(false, err);
      update({ status: 'failed', error: reason, progress: '远端已生成产物，本地处理失败；已停止容灾以避免重复扣费。', finishedAt: Date.now() });
      return {
        success: false,
        taskId,
        resultPaths: [],
        resultUrls: [],
        engineKind: engine.kind,
        error: reason,
        submissionCommitted: true,
      };
    }

    // Non-image paid tasks stay attached to their existing remote task. Routed
    // image generation deliberately prefers availability and may fail over.
    // Terminal rejections (task_failed / balance / auth) are excluded: no
    // charge happened, so the task id must not suppress channel fallback.
    if (!isRoutedImageEngine && providerTaskId && !isTerminalRhtvRejection(err)) {
      const reason = err instanceof Error ? err.message : String(err);
      const transient = !(err instanceof RhtvBusinessError) && isTransientKuaiziError(err);
      recordRoute(false, err);
      update(transient
        ? { status: 'running', rhTaskId: providerTaskId, progress: '网络抖动，后台继续查询结果…', error: undefined }
        : { status: 'failed', rhTaskId: providerTaskId, error: reason, progress: reason, finishedAt: Date.now() });
      return {
        success: false,
        taskId,
        resultPaths: [],
        resultUrls: [],
        engineKind: engine.kind,
        error: transient ? `${reason}（后台仍在继续查询结果）` : reason,
        providerTaskId,
        backgroundPending: transient,
      };
    }

    // ── Fallback: image tasks cascade through all remaining channels ────
    if (isRoutedImageEngine) {
      const reason = err instanceof Error ? err.message : String(err);
      recordRoute(false, err);
      console.warn(`[canvasGen] RunningHub 失败，级联 fallback: ${reason}`);
      update({ status: 'running', progress: '主链失败，切换备用通道…', fallbackUsed: true });
      const failedIds = new Set<string>([channel]);
      const attemptErrors = [`${getImageRouteDefinition(channel)?.label ?? channel}: ${reason}`];
      const cascadeResult = await cascadeFallback(req, failedIds, taskId, update, attemptErrors);
      if (cascadeResult) return cascadeResult;
      const finalMsg = `所有通道均失败：${attemptErrors.join('；')}`;
      update({ status: 'failed', error: finalMsg, finishedAt: Date.now() });
      return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'image', error: finalMsg };
    }

    const msg = err instanceof RhtvBusinessError
      ? err.message
      : `生成失败: ${err instanceof Error ? err.message : String(err)}`;
    // 瞬态错误（网络抖动/轮询超时，非业务失败）且已有远端 taskId：转后台
    // 恢复而不是永久判失败——恢复钩子不碰 failed 任务，直接 failed 会把
    // 远端仍在跑/已完成的结果永久丢掉。与 Kuaizi 路径的处理对齐。
    const transient = !(err instanceof RhtvBusinessError) && isTransientKuaiziError(err);
    if (transient && providerTaskId) {
      update({
        status: 'running',
        rhTaskId: providerTaskId,
        progress: '网络抖动，后台继续查询结果…',
        error: undefined,
      });
      return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: engine.kind, error: `${msg}（后台仍在继续查询结果）` };
    }
    update({ status: 'failed', error: msg, finishedAt: Date.now() });
    void appendGenerationLog({
      timestamp: new Date().toISOString(),
      director: '',
      taskType: generationTaskType(engine, refs.length),
      engine: engine.id.startsWith('gpt-image') ? 'gpt-image-2' : engine.id.startsWith('seedance') ? 'seedance' : 'other',
      prompt: req.prompt,
      outputPath: '',
      outputPaths: [],
      model: engine.endpoint,
      taskId,
      providerTaskId,
      endpoint: engine.endpoint,
      webappId: engine.appConfig?.webappId,
      shotNo: req.workshopShotNo,
      params: req.params,
      submittedParams,
      nodeInfoList: submittedNodeInfoList,
      refs: [
        ...refs.map((source, i) => ({ index: i + 1, type: 'image' as const, source })),
        ...(req.audioUrls ?? []).map((source, i) => ({ index: i + 1, type: 'audio' as const, source })),
        ...(req.videoUrls ?? []).map((source, i) => ({ index: i + 1, type: 'video' as const, source })),
      ],
      validation: engine.mode === 'multimodal-video'
        ? (() => {
            const v = validateSeedancePromptDetailed(req.prompt, { refCount: refs.length, requireSceneRef: false, allowVideoRefs: true });
            return { passed: v.ok, errors: v.errors, warnings: v.warnings };
          })()
        : undefined,
      failureReason: msg,
    }).catch(() => {});
    return {
      success: false,
      taskId,
      resultPaths: [],
      resultUrls: [],
      engineKind: engine.kind,
      error: msg,
      providerTaskId,
      providerFailed: isTerminalRhtvRejection(err),
      submissionCommitted: submissionCommitted && !providerTaskId,
    };
  } finally {
    taskAborts.delete(taskId);
    useCanvasTaskStore.getState().updateTask(taskId, { inFlight: false });
    releaseSlot();
  }
}

async function runDreaminaSeedance25Generation(req: CoreGenRequest): Promise<CoreGenResult> {
  const refs = req.referenceUrls ?? [];
  const audioUrls = req.audioUrls ?? [];
  const videoUrls = req.videoUrls ?? [];
  const taskId = useCanvasTaskStore.getState().addTask({
    nodeId: req.nodeId ?? '',
    kind: 'video',
    engineId: DREAMINA_SEEDANCE_25_ENGINE_ID,
    engineLabel: '即梦 Seedance 2.5',
    endpoint: DREAMINA_SEEDANCE_25_ENDPOINT,
    prompt: req.prompt,
    referenceUrls: refs.length > 0 ? refs : undefined,
    params: req.params,
    projectId: req.projectId,
    workshopShotNo: req.workshopShotNo,
    workshopShotKind: req.workshopShotKind,
    workshopStoryboardFrameId: req.workshopStoryboardFrameId,
    inFlight: true,
    submissionReceipt: {
      requestedImages: refs.length,
      requestedAudio: audioUrls.length,
      requestedVideo: videoUrls.length,
      submittedImages: refs.length,
      submittedAudio: audioUrls.length,
      submittedVideo: videoUrls.length,
      provider: DREAMINA_SEEDANCE_25_ENDPOINT,
    },
  });
  const ac = new AbortController();
  taskAborts.set(taskId, ac);
  try { req.onTaskCreated?.(taskId); } catch { /* caller callback must not break the run */ }
  const update = (patch: Partial<CanvasTask>) => useCanvasTaskStore.getState().updateTask(taskId, patch);
  let providerTaskId = '';

  try {
    await acquireSlot(taskId);
    if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');
    update({ status: 'uploading', progress: '准备 Seedance 2.5 参考素材…' });
    const result = await generateSeedance25WithDreamina({
      prompt: req.prompt,
      imageUrls: refs,
      videoUrls,
      audioUrls,
      duration: Number(req.params?.duration ?? 5),
      ratio: String(req.params?.ratio ?? req.params?.aspectRatio ?? '16:9'),
      resolution: String(req.params?.resolution ?? '720p'),
      signal: ac.signal,
      taskContext: [
        req.workshopShotNo ? `工坊镜号 ${req.workshopShotNo}` : '',
        req.nodeId ? `画布节点 ${req.nodeId}` : '',
      ].filter(Boolean).join('；'),
      onSubmitted: (submitId) => {
        providerTaskId = submitId;
        update({ rhTaskId: submitId, status: 'running', progress: `Seedance 2.5 已提交，等待生成…` });
      },
      onProgress: (progress) => update({ status: 'running', progress }),
    });
    const displayUrls = result.paths.map((path) => convertFileSrc(path));
    update({
      status: 'succeeded',
      progress: '完成（Seedance 2.5）',
      rhTaskId: result.submitId,
      resultPaths: result.paths,
      resultUrls: result.urls.length > 0 ? result.urls : displayUrls,
      finishedAt: Date.now(),
    });
    for (const path of result.paths) {
      void appendArtifact({ path, type: 'video', engine: DREAMINA_SEEDANCE_25_ENGINE_ID, prompt: req.prompt, taskId });
    }
    void appendGenerationLog({
      timestamp: new Date().toISOString(),
      director: '',
      taskType: refs.length > 0 || audioUrls.length > 0 || videoUrls.length > 0 ? 'image-to-video' : 'text-to-video',
      engine: 'seedance',
      prompt: req.prompt,
      outputPath: result.paths[0] ?? '',
      outputPaths: result.paths,
      model: 'dreamina-cli/seedance-2.5',
      taskId,
      shotNo: req.workshopShotNo,
      params: req.params,
      refs: [
        ...refs.map((source, i) => ({ index: i + 1, type: 'image' as const, source })),
        ...audioUrls.map((source, i) => ({ index: i + 1, type: 'audio' as const, source })),
        ...videoUrls.map((source, i) => ({ index: i + 1, type: 'video' as const, source })),
      ],
    }).catch(() => {});
    return {
      success: true,
      taskId,
      resultPaths: result.paths,
      resultUrls: result.urls.length > 0 ? result.urls : displayUrls,
      engineKind: 'video',
    };
  } catch (err) {
    const aborted = err instanceof DOMException && err.name === 'AbortError';
    const pending = err instanceof DreaminaTaskPendingError && Boolean(err.submitId || providerTaskId);
    const remoteTaskId = err instanceof DreaminaTaskPendingError ? err.submitId : providerTaskId;
    if (pending && !aborted) {
      update({
        status: 'running',
        rhTaskId: remoteTaskId,
        progress: 'Seedance 2.5 仍在生成，后台继续查询…',
        error: undefined,
      });
      return {
        success: false,
        taskId,
        resultPaths: [],
        resultUrls: [],
        engineKind: 'video',
        error: 'Seedance 2.5 仍在生成，鲲鹏会在后台继续查询',
      };
    }
    const message = aborted ? '已取消' : `Seedance 2.5 失败: ${err instanceof Error ? err.message : String(err)}`;
    update({ status: 'failed', error: message, finishedAt: Date.now() });
    return { success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video', error: message };
  } finally {
    taskAborts.delete(taskId);
    useCanvasTaskStore.getState().updateTask(taskId, { inFlight: false });
    releaseSlot();
  }
}

async function runKuaiziSeedanceGeneration(req: CoreGenRequest): Promise<CoreGenResult> {
  const refs = req.referenceUrls ?? [];
  const kuaiziMode = mapSeedanceToKuaiziMode(req.engineId);
  const imageRoles = mapSeedanceToKuaiziImageRoles(req.engineId, refs.length);
  // 用 engine 声明的参数默认值预填（与 RHTV 路径一致）——曾经跳过这步，
  // 同一引擎两条后端的 ratio/duration 默认行为不一致（RHTV adaptive vs 筷子 16:9）
  const engineDef = findCanvasEngine(req.engineId);
  const defaults: RhtvParams = { ...(engineDef?.fixedParams ?? {}) };
  for (const p of engineDef?.params ?? []) {
    if (p.default !== undefined) defaults[p.key] = p.default;
  }
  req = { ...req, params: { ...defaults, ...(req.params ?? {}) } };
  const taskStore = useCanvasTaskStore.getState();
  const taskId = taskStore.addTask({
    nodeId: req.nodeId ?? '',
    kind: 'video',
    engineId: req.engineId,
    engineLabel: kuaiziMode === 'seedance2.5'
      ? '筷子丽帧 Seedance 2.5'
      : `筷子丽帧 Seedance 2.0${kuaiziMode === 'mini' ? ' Mini' : kuaiziMode === 'fast' ? ' Fast' : ''}`,
    endpoint: 'kuaizi-lz/video/task/create',
    prompt: req.prompt,
    referenceUrls: refs.length > 0 ? refs : undefined,
    params: req.params,
    projectId: req.projectId,
    workshopShotNo: req.workshopShotNo,
    workshopShotKind: req.workshopShotKind,
    workshopStoryboardFrameId: req.workshopStoryboardFrameId,
    inFlight: true,
  });
  const ac = new AbortController();
  taskAborts.set(taskId, ac);
  try { req.onTaskCreated?.(taskId); } catch { /* caller callback must not break the run */ }
  const update = (patch: Partial<CanvasTask>) =>
    useCanvasTaskStore.getState().updateTask(taskId, patch);
  let providerTaskId = '';

  try {
    await acquireSlot(taskId);
    if (ac.signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const validation = validateSeedancePromptDetailed(req.prompt, {
      refCount: refs.length,
      requireSceneRef: false,
      allowVideoRefs: true,
    });
    if (validation.warnings.length > 0 || validation.errors.length > 0) {
      await appendKuaiziLog({
        timestamp: new Date().toISOString(),
        provider: 'kuaizi-lz',
        event: 'prompt_validation',
        taskId,
        validation,
        note: 'hidden trial path logs validation only; it does not block Kuaizi submission',
      });
    }

    update({ status: 'uploading', progress: '准备筷子丽帧参考素材…' });
    const result = await runKuaiziSeedance2Generation({
      prompt: req.prompt,
      referenceUrls: refs,
      videoUrls: req.videoUrls,
      audioUrls: req.audioUrls,
      params: { ...(req.params ?? {}), mode: kuaiziMode },
      imageRoles,
      signal: ac.signal,
      onProviderTaskCreated: (remoteTaskId) => {
        providerTaskId = remoteTaskId;
        update({ rhTaskId: remoteTaskId, status: 'running', progress: `已提交筷子丽帧任务 ${remoteTaskId}，等待生成…` });
      },
      onProgress: (phase) => {
        const status = /下载/.test(phase) ? 'downloading' : /上传|COS/.test(phase) ? 'uploading' : 'running';
        update({ status, progress: phase });
      },
    });

    update({
      status: 'succeeded',
      progress: '完成（筷子丽帧）',
      rhTaskId: result.taskId,
      resultPaths: result.resultPaths,
      resultUrls: result.status.video_url ? [result.status.video_url] : [],
      finishedAt: Date.now(),
    });

    return {
      success: true,
      taskId,
      resultPaths: result.resultPaths,
      resultUrls: result.resultUrls,
      engineKind: 'video',
    };
  } catch (err) {
    const kuaiziRetryStopped = shouldStopAutomaticPaidFallback(err, 'kuaizi-video');
    const rawKuaiziMessage = kuaiziRetryStopped
      ? paidRetryStoppedMessage(err, '筷子丽帧')
      : err instanceof Error ? err.message : String(err);
    const msg = err instanceof DOMException && err.name === 'AbortError'
      ? '已取消'
      : `筷子丽帧失败: ${rawKuaiziMessage}`;
    // 业务错误（余额不足 / 远端 failed 终态）不算“网络抖动”，不进后台恢复分支；
    // 两者都不产生扣费，都视为可安全降级的 provider 终态。
    const providerFailed = err instanceof KuaiziBusinessError
      && (err.kind === 'task_failed' || err.kind === 'balance');
    const protectedTaskId = providerTaskId || paidTaskId(err) || '';
    const submissionUncertain = kuaiziRetryStopped && !protectedTaskId;
    const recoverable = Boolean(protectedTaskId)
      && !(err instanceof DOMException && err.name === 'AbortError')
      && !(err instanceof KuaiziBusinessError)
      && (mustNotAutoResubmit(err) || isTransientKuaiziError(err));
    update(recoverable
      ? {
          status: 'running',
          rhTaskId: protectedTaskId,
          progress: '丽帧网络抖动，后台继续查询结果…',
          error: undefined,
        }
      : { status: 'failed', error: msg, finishedAt: Date.now() });
    await appendKuaiziLog({
      timestamp: new Date().toISOString(),
      provider: 'kuaizi-lz',
      event: recoverable ? 'recoverable_failure' : 'failure',
      localTaskId: taskId,
      taskId: protectedTaskId || undefined,
      error: msg,
    });
    void appendGenerationLog({
      timestamp: new Date().toISOString(),
      director: '',
      taskType: refs.length > 0 ? 'image-to-video' : 'text-to-video',
      engine: 'seedance',
      prompt: req.prompt,
      outputPath: '',
      outputPaths: [],
      model: kuaiziMode === 'seedance2.5'
        ? 'kuaizi-lz/seedance-2.5'
        : `kuaizi-lz/seedance-2.0${kuaiziMode !== 'pro' ? '-' + kuaiziMode : ''}`,
      taskId,
      shotNo: req.workshopShotNo,
      params: req.params,
      refs: [
        ...refs.map((source, i) => ({ index: i + 1, type: 'image' as const, source })),
        ...(req.audioUrls ?? []).map((source, i) => ({ index: i + 1, type: 'audio' as const, source })),
        ...(req.videoUrls ?? []).map((source, i) => ({ index: i + 1, type: 'video' as const, source })),
      ],
      failureReason: msg,
    }).catch(() => {});
    return {
      success: false, taskId, resultPaths: [], resultUrls: [], engineKind: 'video', error: msg,
      providerTaskId: protectedTaskId || undefined,
      providerFailed,
      backgroundPending: recoverable,
      submissionUncertain,
      automaticRetryBlocked: kuaiziRetryStopped,
    };
  } finally {
    taskAborts.delete(taskId);
    useCanvasTaskStore.getState().updateTask(taskId, { inFlight: false });
    releaseSlot();
  }
}

/**
 * Seedance 2.5 路由：默认走筷子丽帧（mode=seedance2.5），仅“提交前/提交即失败”
 * 时降级即梦 CLI 兜底——API Key 未配置、创建被拒（含余额不足）、素材上传失败、
 * 远端任务 failed（失败不扣费）。筷子任务已提交后的轮询超时/中断绝不降级
 * （防重复扣费），保持 task running 交给后台恢复机制。
 */
async function runSeedance25Generation(req: CoreGenRequest): Promise<CoreGenResult> {
  const dreaminaFallback = async (reason: string, kuaiziTaskId?: string, kuaiziProviderTaskId?: string): Promise<CoreGenResult> => {
    console.warn(`[canvasGen] Seedance 2.5 筷子丽帧通道不可用（${reason}），降级即梦 CLI 兜底`);
    if (kuaiziTaskId) {
      // 原筷子任务已判 failed——补上兜底去向，排查时不致误判为漏处理
      useCanvasTaskStore.getState().updateTask(kuaiziTaskId, { error: `${reason}（已降级即梦 CLI 兜底）` });
    }
    void appendKuaiziLog({
      timestamp: new Date().toISOString(),
      provider: 'kuaizi-lz',
      event: 'seedance25_fallback_dreamina',
      localTaskId: kuaiziTaskId,
      taskId: kuaiziProviderTaskId,
      error: reason,
    });
    const result = await runDreaminaSeedance25Generation(req);
    return { ...result, fallbackUsed: true };
  };

  // Key 未配置时直接兜底，不必先建任务再失败（也省下素材上传）
  if (!getKuaiziApiKey()) {
    return dreaminaFallback('未配置筷子丽帧 API Key');
  }

  const kuaiziResult = await runKuaiziSeedanceGeneration(req);
  if (kuaiziResult.success) return kuaiziResult;
  const cancelled = (kuaiziResult.error ?? '') === '已取消';
  const fallbackEligible = !cancelled
    && !kuaiziResult.backgroundPending
    && !kuaiziResult.submissionUncertain
    && (!kuaiziResult.providerTaskId || kuaiziResult.providerFailed === true);
  if (!fallbackEligible) return kuaiziResult;
  return dreaminaFallback(kuaiziResult.error ?? '未知原因', kuaiziResult.taskId, kuaiziResult.providerTaskId);
}

// ── Canvas entry: node semantics on top of runGeneration ─────────────────────
export async function generateForNode(req: CanvasGenRequest): Promise<CanvasGenResult> {
  const isDreaminaSeedance25 = req.engineId === DREAMINA_SEEDANCE_25_ENGINE_ID;
  const isKuaiziRoute = req.engineId === KUAIZI_SEEDANCE_ENGINE_ID ||
    (isSeedanceVideoEngine(req.engineId) && shouldUseKuaiziForSeedance());
  const isMidjourneyRoute = isMidjourneyEngine(req.engineId);
  const dedicatedEngineKind = isMidjourneyRoute
    ? 'image' as const
    : isKuaiziRoute || isDreaminaSeedance25
      ? 'video' as const
      : undefined;
  // Midjourney V8.2 is an APIMart-only route and deliberately does not live in
  // the generic RunningHub canvas engine registry. Do not reject it before
  // runGeneration() can hand it to the dedicated APIMart implementation.
  const resolved = dedicatedEngineKind ? { engine: undefined } : resolveGenEngine(req);
  if (!dedicatedEngineKind && !resolved.engine) {
    return { success: false, taskId: '', resultPaths: [], error: resolved.error };
  }
  const engine = resolved.engine;

  // ── Version tree: never overwrite an existing result by default ──────
  // LibTV pattern — regenerating a node that already has output derives a
  // NEW connected node, keeping the original as a version ancestor.
  let targetNodeId = req.nodeId;
  if (!req.overwrite) {
    const store = useCanvasStore.getState();
    const srcNode = store.nodes.find((n) => n.id === req.nodeId);
    const srcData = srcNode?.data as Record<string, unknown> | undefined;
    const expectedKind = dedicatedEngineKind ?? engine?.kind ?? 'video';
    const hasResult = Boolean(
      expectedKind === 'image' ? srcData?.generatedImageUrl
        : expectedKind === 'audio' ? srcData?.audioUrl
          : srcData?.generatedVideoUrl,
    );
    if (srcNode && hasResult) {
      const newId = `node-ver-${Date.now()}`;
      store.addNode({
        id: newId,
        type: srcNode.type,
        position: {
          x: srcNode.position.x + (srcNode.width ?? 200) + 60,
          y: srcNode.position.y + 30,
        },
        style: defaultNodeStyle(srcNode.type),
        data: {
          description: req.prompt,
          ...(expectedKind === 'image' ? { generationMode: srcData?.generationMode ?? 'text-to-image' } : {}),
        },
      });
      store.onConnect({
        source: req.nodeId,
        target: newId,
        sourceHandle: null,
        targetHandle: null,
        data: { relation: 'version' },
      });
      store.setSelectedNodeId(newId);
      targetNodeId = newId;
    }
  }

  patchNode(targetNodeId, { isGenerating: true, description: req.prompt });

  const result = await runGeneration({
    engineId: req.engineId,
    prompt: req.prompt,
    referenceUrls: req.referenceUrls,
    audioUrls: req.audioUrls,
    videoUrls: req.videoUrls,
    documentUrl: req.documentUrl,
    linkUrl: req.linkUrl,
    params: req.params,
    nodeId: targetNodeId,
    onTaskCreated: (taskId) => {
      useCanvasTaskStore.getState().updateTask(taskId, {
        submissionReceipt: {
          requestedImages: req.referenceUrls?.length ?? 0,
          requestedAudio: req.audioUrls?.length ?? 0,
          requestedVideo: req.videoUrls?.length ?? 0,
          submittedImages: req.referenceUrls?.length ?? 0,
          submittedAudio: req.audioUrls?.length ?? 0,
          submittedVideo: req.videoUrls?.length ?? 0,
        },
      });
    },
  });

  if (!result.success) {
    patchNode(targetNodeId, { isGenerating: false });
    return {
      success: false,
      taskId: result.taskId,
      resultPaths: [],
      error: result.error,
      automaticRetryBlocked: result.automaticRetryBlocked,
    };
  }

  const completedTask = useCanvasTaskStore.getState().tasks.find((task) => task.id === result.taskId);
  if (completedTask) {
    useCanvasTaskStore.getState().updateTask(result.taskId, {
      submissionReceipt: {
        requestedImages: req.referenceUrls?.length ?? 0,
        requestedAudio: req.audioUrls?.length ?? 0,
        requestedVideo: req.videoUrls?.length ?? 0,
        submittedImages: completedTask.referenceUrls?.length ?? req.referenceUrls?.length ?? 0,
        submittedAudio: req.audioUrls?.length ?? 0,
        submittedVideo: req.videoUrls?.length ?? 0,
        provider: completedTask.endpoint,
        fallbackUsed: Boolean(result.fallbackUsed),
      },
    });
  }

  // Write back to node（image/audio/video 三元——audio 曾落进 else 写成
  // generatedVideoUrl，AudioNode 只认 audioUrl，导致音频节点永远空白）
  const paths = result.resultPaths;
  const primaryUrl = result.resultUrls[0];
  const outKind = result.engineKind ?? dedicatedEngineKind ?? engine?.kind ?? 'video';
  patchNode(targetNodeId, {
    isGenerating: false,
    justCompletedAt: Date.now(),
    ...(outKind === 'image'
      ? { generatedImageUrl: primaryUrl, localPath: paths[0] }
      : outKind === 'audio'
        ? { audioUrl: primaryUrl, localPath: paths[0], fileName: paths[0]?.split('/').pop() }
        : { generatedVideoUrl: primaryUrl, localPath: paths[0], mediaRole: 'output' }),
  });

  // Resize node to match the generated media's aspect ratio (long edge = 420)
  // —— 音频节点不适用（无画幅概念）
  if (outKind !== 'audio') {
    const ratio = String(req.params?.ratio ?? req.params?.aspectRatio ?? '16:9');
    const [rw, rh] = ratio.split(':').map(Number);
    if (rw > 0 && rh > 0) {
      const maxEdge = 420;
      const w = rw >= rh ? maxEdge : Math.round(maxEdge * (rw / rh));
      const h = rh >= rw ? maxEdge : Math.round(maxEdge * (rh / rw));
      useCanvasStore.getState().updateNodeStyle(targetNodeId, { width: w, height: h });
    }
  }

  // Multi-output (MJ returns 4): primary goes to the target node, the
  // rest land as sibling "variant" nodes connected to it.
  if (outKind === 'image' && paths.length > 1) {
    spawnVariantNodes(targetNodeId, paths.slice(1), req.prompt);
  }

  return {
    success: true,
    taskId: result.taskId,
    resultPaths: paths,
    primaryUrl,
    fallbackUsed: result.fallbackUsed,
  };
}
