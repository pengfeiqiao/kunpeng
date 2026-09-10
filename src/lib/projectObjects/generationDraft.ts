import type { RhtvCanvasEngine } from '@/lib/rhtv/types';
import { errorText } from '../errorText.ts';
import type { GenerationConfirmationPreference } from './types';
import type { ToolRisk } from '../agent/types';

export type GenerationFailureKind =
  | 'balance'
  | 'rate-limit'
  | 'network-timeout'
  | 'unsupported-params'
  | 'content-review'
  | 'task-query'
  | 'unknown';

export interface GenerationFailurePresentation {
  title: string;
  remedy: string;
  canRetry: boolean;
}

export interface GenerationReferenceDraft {
  type: 'image' | 'video' | 'audio' | 'file' | 'link';
  value: string;
  ordinal: number;
}

export interface GenerationDraft {
  toolName: string;
  prompt: string;
  engineId?: string;
  references: GenerationReferenceDraft[];
  params: Record<string, unknown>;
  count: number;
  estimatedCost?: string;
  fallbackNotice?: string;
  paid: boolean;
}

const GENERATION_TOOL_NAMES = new Set([
  'canvas_generate',
  'canvas_generate_batch',
  'image_generate',
  'video_generate',
  'mg_generate_with_reference_boards',
  'timeline_omni_mg_generate',
  'timeline_omni_mg_generate_batch',
  'timeline_mg_text_fallback',
]);

export function isGenerationToolName(toolName: string): boolean {
  return GENERATION_TOOL_NAMES.has(toolName)
    || toolName.startsWith('custom-media:')
    || /(?:^|_)(?:generate|generation)(?:_|$)/i.test(toolName);
}

/** Trusted tool risk, never a model-supplied params.paid flag. Unknown tools stay conservative. */
export function isPaidGeneration(risk?: ToolRisk): boolean {
  return risk !== 'safe';
}

export function shouldOfferToolConfirmation(toolName: string, risk: ToolRisk): boolean {
  return risk !== 'deny' && (risk === 'ask' || isGenerationToolName(toolName));
}

function strings(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
  return typeof value === 'string' && value.length > 0 ? [value] : [];
}

function orderedReferences(params: Record<string, unknown>): GenerationReferenceDraft[] {
  const groups: Array<[GenerationReferenceDraft['type'], unknown]> = [
    ['image', params.reference_urls ?? params.image_urls ?? params.images],
    ['video', params.video_urls ?? params.videos],
    ['audio', params.audio_urls ?? params.audios],
    ['file', params.file_url],
    ['link', params.link_url],
  ];
  return groups.flatMap(([type, value]) => strings(value).map((item, index) => ({
    type,
    value: item,
    // 图片、视频、音频各自独立编号，与提示词里的 @图片N/@视频N 一致。
    ordinal: index + 1,
  })));
}

export function buildGenerationDraft(
  toolName: string,
  rawParams: Record<string, unknown>,
  risk?: ToolRisk,
): GenerationDraft | null {
  if (!isGenerationToolName(toolName)) return null;
  const nestedParams = rawParams.params && typeof rawParams.params === 'object' && !Array.isArray(rawParams.params)
    ? rawParams.params as Record<string, unknown>
    : {};
  const jobs = Array.isArray(rawParams.jobs) ? rawParams.jobs : undefined;
  const firstJob = jobs?.find((item): item is Record<string, unknown> => Boolean(item && typeof item === 'object'));
  const source = firstJob ? { ...rawParams, ...firstJob } : rawParams;
  const countValue = Number(rawParams.count ?? jobs?.length ?? 1);
  return {
    toolName,
    prompt: String(source.prompt ?? ''),
    engineId: typeof source.engine === 'string'
      ? source.engine
      : typeof source.model === 'string' ? source.model : undefined,
    references: orderedReferences(source),
    params: {
      ...nestedParams,
      ...(firstJob?.params && typeof firstJob.params === 'object' && !Array.isArray(firstJob.params)
        ? firstJob.params as Record<string, unknown>
        : {}),
    },
    count: Number.isFinite(countValue) && countValue > 0 ? Math.floor(countValue) : 1,
    estimatedCost: typeof rawParams.estimated_cost === 'string' ? rawParams.estimated_cost : undefined,
    fallbackNotice: typeof rawParams.fallback_notice === 'string' ? rawParams.fallback_notice : undefined,
    paid: isPaidGeneration(risk),
  };
}

export function shouldConfirmGeneration(
  preference: GenerationConfirmationPreference,
  paid: boolean,
): boolean {
  if (preference === 'always-confirm') return true;
  if (preference === 'direct-execute') return false;
  return paid;
}

export interface CalibratedGenerationParams {
  params: Record<string, unknown>;
  references: {
    images: string[];
    videos: string[];
    audios: string[];
  };
  adjustments: string[];
}

function maxReferenceCount(engineId: string, kind: 'image' | 'video' | 'audio', multiple: boolean): number {
  if (!multiple) return 1;
  const id = engineId.toLowerCase();
  if (id.includes('hailuo-h3') || id.includes('minimax-h3')) return kind === 'image' ? 9 : 3;
  if (id.includes('seedance-2.5')) return kind === 'image' ? 30 : 10;
  // Seedance 2.0 家族（pro/fast/mini 多模态档）：API 矩阵 参考图≤9 / 视频≤3 / 音频≤3
  if (id.includes('seedance-2.0')) return kind === 'image' ? 9 : 3;
  if (id.includes('wan-3')) return kind === 'image' ? 10 : 5;
  return Number.POSITIVE_INFINITY;
}

function clampReferences(
  engine: RhtvCanvasEngine,
  kind: 'image' | 'video' | 'audio',
  values: string[],
  multiple: boolean,
  adjustments: string[],
  cap?: number,
): string[] {
  const limit = Math.min(cap ?? Number.POSITIVE_INFINITY, maxReferenceCount(engine.id, kind, multiple));
  if (values.length <= limit) return [...values];
  const label = kind === 'image' ? '参考图片' : kind === 'video' ? '参考视频' : '参考音频';
  adjustments.push(`${label}由 ${values.length} 个调整为 ${limit} 个（${engine.label} 上限）`);
  return values.slice(0, limit);
}

export function calibrateGenerationForEngine(
  engine: RhtvCanvasEngine,
  rawParams: Record<string, unknown>,
  references: { images?: string[]; videos?: string[]; audios?: string[] } = {},
): CalibratedGenerationParams {
  const params: Record<string, unknown> = { ...rawParams };
  const adjustments: string[] = [];

  for (const definition of engine.params) {
    const value = params[definition.key];
    if (definition.type === 'list' && definition.options?.length) {
      const normalized = value == null ? undefined : String(value);
      if (!normalized || !definition.options.includes(normalized)) {
        const fallback = definition.default ?? definition.options[0];
        if (normalized !== undefined) {
          adjustments.push(`${definition.label}由“${normalized}”调整为“${String(fallback)}”`);
        }
        params[definition.key] = fallback;
      }
    } else if (value == null && definition.default !== undefined) {
      params[definition.key] = definition.default;
    }
  }

  // start-end-video 引擎（首尾帧/Mini 图生）经 firstFrameUrl/lastFrameUrl 特判提交，
  // schema 不带 imageParam，但确实支持参考图——不能按"不支持"剥光。
  // 上限：Mini 图生走筷子 mini 档支持 ≤9 图（首帧 + 其余 reference_image）；
  // startend 首尾帧语义就是首帧+尾帧两张。
  const startEnd = engine.mode === 'start-end-video';
  const startEndImageCap = engine.id.includes('mini') ? 9 : 2;
  const images = engine.imageParam || startEnd
    ? clampReferences(engine, 'image', references.images ?? [], engine.imageParam?.multiple ?? true, adjustments, startEnd ? startEndImageCap : undefined)
    : [];
  const videos = engine.videoParam
    ? clampReferences(engine, 'video', references.videos ?? [], engine.videoParam.multiple, adjustments)
    : [];
  const audios = engine.audioParam
    ? clampReferences(engine, 'audio', references.audios ?? [], engine.audioParam.multiple, adjustments)
    : [];

  if (!engine.imageParam && !startEnd && (references.images?.length ?? 0) > 0) adjustments.push(`${engine.label} 不支持参考图片，已移除`);
  if (!engine.videoParam && (references.videos?.length ?? 0) > 0) adjustments.push(`${engine.label} 不支持参考视频，已移除`);
  if (!engine.audioParam && (references.audios?.length ?? 0) > 0) adjustments.push(`${engine.label} 不支持参考音频，已移除`);

  return { params, references: { images, videos, audios }, adjustments };
}

export function classifyGenerationFailure(error: unknown): GenerationFailureKind {
  const message = errorText(error);
  if (/余额|积分|insufficient|balance|credit/i.test(message)) return 'balance';
  if (/限流|频繁|rate.?limit|429/i.test(message)) return 'rate-limit';
  if (/超时|timed?\s*out|tcp|network|网络/i.test(message)) return 'network-timeout';
  if (/参数|unsupported|invalid.?param|400/i.test(message)) return 'unsupported-params';
  if (/审核|安全|违规|copyright|真人|content.?policy|moderation/i.test(message)) return 'content-review';
  if (/轮询|查询|poll|task.?status/i.test(message)) return 'task-query';
  return 'unknown';
}

/**
 * Converts provider diagnostics into a safe user action. Submission and query
 * ambiguity intentionally have no retry affordance; billingSafety remains the
 * authority for any paid retry.
 */
export function describeGenerationFailure(error: unknown): GenerationFailurePresentation {
  switch (classifyGenerationFailure(error)) {
    case 'balance':
      return { title: '余额或积分不足', remedy: '充值或切换已配置的可用渠道后重新生成。', canRetry: false };
    case 'rate-limit':
      return { title: '请求过于频繁', remedy: '稍等片刻后可以重试；若任务可能已经提交，请先查询任务记录。', canRetry: true };
    case 'network-timeout':
      return { title: '连接中断，提交状态不明', remedy: '先到任务记录确认是否已经提交，避免重复扣费。', canRetry: false };
    case 'unsupported-params':
      return { title: '当前参数不受支持', remedy: '调整时长、比例、分辨率或参考素材数量后再生成；Midjourney 8.2 不支持 raw 参数（已自动忽略，不需要手动去除）。', canRetry: false };
    case 'content-review':
      return { title: '内容审核未通过', remedy: '修改涉及真人、版权或敏感内容的描述后再生成。', canRetry: false };
    case 'task-query':
      return { title: '暂时无法确认任务结果', remedy: '任务可能仍在供应商侧运行，请稍后查询任务记录，不要重复提交。', canRetry: false };
    default:
      return { title: '生成未完成', remedy: '查看详情并确认任务没有提交后，再决定是否重新生成；连续被拒可用 apimart_route_status 检查通道状态，或改用 Seedream 5 Pro / GPT Image 2.5 通道。', canRetry: false };
  }
}
