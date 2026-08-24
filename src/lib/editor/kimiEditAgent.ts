/**
 * Kimi edit agent — reference-video analysis and edit planning for Kunpeng's
 * internal editor. It mirrors the Kimi Code idea: keep video/time context
 * available to a focused subagent, then let timeline tools apply the result.
 */
import { invoke } from '@tauri-apps/api/tauri';
import { fetch as tauriFetch, ResponseType, Body } from '@tauri-apps/api/http';
import { detectFfmpeg, probeDuration } from '@/lib/canvas/videoCompose';
import { dmxVisionDescribe, getDmxApiKey, loadImageInput } from '@/lib/agent/tools/dmxClient';
import { isKimiK3Configured, kimiK3Chat } from '@/lib/agent/kimiClient';
import { uploadVideoToKimi } from '@/lib/agent/kimiFiles';
import { useSettingsStore } from '@/stores/settingsStore';
import { useEditorStore, type EditReferenceProfile, type MediaNote, type ReferenceFrameNote, type ReferenceTranscriptSegment } from '@/stores/editorStore';
import { ensureTranscript } from './transcriptOps';

interface CommandResult { stdout: string; stderr: string; exit_code: number }
interface LocalFileMetadata { size: number; modifiedMs: number }

export interface AnalyzeReferenceVideoOptions {
  mode?: 'quick' | 'full';
  force?: boolean;
  nativeFirst?: boolean;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
}

export interface KimiEditPlanShot {
  label: string;
  source_path: string;
  in_sec: number;
  out_sec: number;
  reason: string;
}

export interface KimiEditPlanResult {
  title: string;
  shots: KimiEditPlanShot[];
  text_overlays?: Array<{ text: string; start_sec: number; end_sec: number; template_id?: string }>;
  fx_suggestions?: Array<{ label: string; start_sec: number; duration: number; page_template_id?: string; component_id?: string; params?: Record<string, unknown>; theme?: string }>;
  free_pages?: Array<{ label: string; start_sec: number; duration: number; brief: string; visual_reference?: string }>;
  notes?: string;
}

const DMX_BASE = 'https://www.dmxapi.cn';
const DEFAULT_KIMI_EDIT_MODEL = 'kimi-k2.7-code-cc';
const MAX_DENSE_FRAMES = 180;
const MAX_DESCRIBED_FRAMES = 48;
const MAX_ATTACHED_FRAMES = 24;
const NATIVE_VIDEO_TIMEOUT_MS = 600_000;

const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

function shortHash(input: string): string {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

export async function getVideoSourceFingerprint(path: string, duration?: number): Promise<string> {
  const metadata = await invoke<LocalFileMetadata>('get_file_metadata', { path }).catch(() => ({ size: 0, modifiedMs: 0 }));
  const resolvedDuration = duration ?? await probeDuration(path).catch(() => 0);
  return shortHash(`${path}:${metadata.size}:${metadata.modifiedMs}:${resolvedDuration}`);
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw signal.reason ?? new DOMException('Aborted', 'AbortError');
}

async function mapPool<T, R>(items: T[], limit: number, worker: (item: T, index: number) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

function evenlySelect<T>(items: T[], limit: number): T[] {
  if (items.length <= limit) return items;
  return Array.from({ length: limit }, (_, index) => items[Math.round(index * (items.length - 1) / Math.max(1, limit - 1))]);
}

function clampText(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}\n...[truncated]` : text;
}

function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname}${u.pathname.length > 44 ? `${u.pathname.slice(0, 44)}...` : u.pathname}`;
  } catch {
    return url.length > 72 ? `${url.slice(0, 72)}...` : url;
  }
}

async function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function withProgressTicker<T>(
  label: string,
  onProgress: ((message: string) => void) | undefined,
  run: () => Promise<T>,
  intervalMs = 10_000,
  limitMs?: number,
): Promise<T> {
  const started = Date.now();
  const timer = onProgress
    ? setInterval(() => {
      const elapsed = Math.round((Date.now() - started) / 1000);
      const suffix = limitMs ? ` / 最长 ${Math.round(limitMs / 1000)}s` : '';
      onProgress(`${label}，已等待 ${elapsed}s${suffix}`);
    }, intervalMs)
    : undefined;
  try {
    return await run();
  } finally {
    if (timer) clearInterval(timer);
  }
}

function uniqueTimes(times: number[], duration: number, cap = MAX_DENSE_FRAMES): number[] {
  const out: number[] = [];
  for (const t of times.filter(Number.isFinite).sort((a, b) => a - b)) {
    const v = Math.max(0.1, Math.min(duration - 0.1, t));
    if (!out.some((x) => Math.abs(x - v) < 0.35)) out.push(Number(v.toFixed(2)));
    if (out.length >= cap) break;
  }
  return out;
}

async function ensureWorkspaceImagesDir(): Promise<string> {
  const workspace = await invoke<string>('ensure_workspace');
  return `${workspace}/images`;
}

async function exec(command: string, timeoutMs = 120000): Promise<CommandResult> {
  return invoke<CommandResult>('execute_command', { command, timeoutMs });
}

async function detectSceneCuts(ffmpeg: string, path: string, maxCuts = 60): Promise<number[]> {
  const r = await exec(
    `${ffmpeg} -i ${q(path)} -vf "select='gt(scene,0.28)',showinfo" -f null - 2>&1 | grep 'pts_time'`,
    900000,
  ).catch(() => ({ stdout: '', stderr: '', exit_code: 1 }));
  const times: number[] = [];
  const re = /pts_time:([\d.]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(r.stdout + r.stderr)) !== null) times.push(parseFloat(m[1]));
  return evenlySelect(times, maxCuts);
}

function buildSampleTimes(duration: number, sceneCuts: number[], mode: 'quick' | 'full'): { t: number; source: ReferenceFrameNote['source'] }[] {
  const denseStep = mode === 'quick'
    ? (duration <= 90 ? 3 : 6)
    : (duration <= 90 ? 1.5 : 3.5);
  const dense = Array.from(
    { length: Math.max(1, Math.ceil(duration / denseStep)) },
    (_, i) => Math.min(duration - 0.1, 0.5 + i * denseStep),
  );

  const boundaries = uniqueTimes([0, ...sceneCuts, duration], duration, sceneCuts.length + 2);
  const sceneTimes: number[] = [];
  for (let i = 0; i < boundaries.length - 1; i++) {
    const start = boundaries[i];
    const end = boundaries[i + 1];
    if (end - start < 0.6) continue;
    sceneTimes.push(start + 0.25, (start + end) / 2, end - 0.25);
  }

  const sceneSet = new Set(uniqueTimes(sceneTimes, duration, MAX_DENSE_FRAMES).map((t) => t.toFixed(1)));
  return uniqueTimes([...sceneTimes, ...dense], duration, mode === 'quick' ? 72 : MAX_DENSE_FRAMES)
    .map((t) => ({ t, source: sceneSet.has(t.toFixed(1)) ? 'scene' as const : 'dense' as const }));
}

async function extractFrame(ffmpeg: string, videoPath: string, t: number, outDir: string): Promise<string | null> {
  const out = `${outDir}/kimi_ref_${Date.now()}_${Math.round(t * 100)}.jpg`;
  const r = await exec(
    `${ffmpeg} -ss ${t.toFixed(2)} -i ${q(videoPath)} -frames:v 1 -vf "scale=640:-2" -q:v 4 ${q(out)} -y`,
    60000,
  ).catch(() => ({ stdout: '', stderr: '', exit_code: 1 }));
  return r.exit_code === 0 ? out : null;
}

async function describeFrames(
  frames: ReferenceFrameNote[],
  mode: 'quick' | 'full',
  onProgress?: (message: string) => void,
  signal?: AbortSignal,
): Promise<ReferenceFrameNote[]> {
  const limit = mode === 'quick' ? 18 : MAX_DESCRIBED_FRAMES;
  const priority = [...frames]
    .sort((a, b) => (a.source === b.source ? a.t - b.t : a.source === 'scene' ? -1 : 1))
    .slice(0, limit);
  onProgress?.(`Kimi 剪辑 Agent：用多模态模型描述 ${priority.length} 张关键帧`);
  const byPath = new Map(frames.map((f) => [f.path, f]));
  let completed = 0;
  await mapPool(priority, 3, async (frame) => {
    throwIfAborted(signal);
    try {
      const desc = await dmxVisionDescribe(
        frame.path,
        '用一行专业剪辑拉片格式描述静态画面：景别 | 构图 | 主体与可见动作 | 字幕/图形/转场线索。不要根据单帧猜测运镜。直接输出。',
      );
      const target = byPath.get(frame.path);
      if (target) target.description = desc.trim();
    } catch {
      const target = byPath.get(frame.path);
      if (target) target.description = '视觉描述失败，保留关键帧路径供后续复查。';
    }
    completed += 1;
    onProgress?.(`Kimi 剪辑 Agent：分析关键帧 ${completed}/${priority.length}`);
  });
  return frames;
}

async function resolveKimiModel(preferDirect = true): Promise<string> {
  if (preferDirect && isKimiK3Configured()) return 'k3';
  const settings = useSettingsStore.getState();
  if (settings.kimiEditModel.trim()) return settings.kimiEditModel.trim();
  const key = getDmxApiKey();
  if (!key) throw new Error('缺少 DMX API Key，无法调用 Kimi 剪辑 Agent');
  try {
    const resp = await tauriFetch(`${DMX_BASE}/v1/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${key}` },
      responseType: ResponseType.JSON,
      timeout: 60,
    });
    const data = resp.data as { data?: Array<{ id?: string }> };
    const ids = (data.data ?? []).map((m) => m.id).filter((x): x is string => Boolean(x));
    return ids.find((id) => id === DEFAULT_KIMI_EDIT_MODEL)
      ?? ids.find((id) => /kimi/i.test(id) && /k2\.7|k2|code|moonshot/i.test(id))
      ?? ids.find((id) => /kimi|moonshot/i.test(id))
      ?? DEFAULT_KIMI_EDIT_MODEL;
  } catch {
    return DEFAULT_KIMI_EDIT_MODEL;
  }
}

function hasMediaParts(messages: unknown[]): boolean {
  return messages.some((m) => {
    const content = (m as { content?: unknown })?.content;
    return Array.isArray(content) && content.some((part) => {
      const type = (part as { type?: string })?.type;
      return type === 'image_url' || type === 'video_url' || type === 'input_image';
    });
  });
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return String(content ?? '');
  return content.map((part) => {
    const p = part as { type?: string; text?: string; image_url?: { url?: string }; video_url?: { url?: string } };
    if (p.type === 'text') return p.text ?? '';
    if (p.type === 'image_url') return `[参考图] ${p.image_url?.url?.slice(0, 240) ?? ''}`;
    if (p.type === 'video_url') return `[参考视频] ${p.video_url?.url ?? ''}`;
    return JSON.stringify(part);
  }).filter(Boolean).join('\n');
}

function parseAnthropicText(data: unknown): string {
  const content = (data as { content?: unknown[] })?.content;
  if (!Array.isArray(content)) return '';
  return content.map((part) => {
    const p = part as { type?: string; text?: string };
    return p.type === 'text' ? p.text ?? '' : '';
  }).join('').trim();
}

async function dmxKimiAnthropic(model: string, key: string, messages: unknown[], extra: Record<string, unknown>): Promise<string> {
  const timeout = Number(extra.timeout ?? 1000);
  const anthropicMessages = messages.map((m) => {
    const raw = m as { role?: string; content?: unknown };
    return {
      role: raw.role === 'assistant' ? 'assistant' : 'user',
      content: [{ type: 'text', text: contentToText(raw.content) }],
    };
  });
  const body = {
    model,
    max_tokens: Number(extra.max_tokens ?? 8192),
    temperature: Number(extra.temperature ?? 0.3),
    system: '你是鲲鹏内部剪辑软件的 Kimi 剪辑 Agent。你只做参考视频理解、剪辑计划和成片复盘，输出必须具体、可执行、少套话。',
    messages: anthropicMessages,
  };
  const endpoints = [
    `${DMX_BASE}/anthropic/v1/messages`,
    `${DMX_BASE}/v1/messages`,
  ];
  let lastError = '';
  for (const url of endpoints) {
    const resp = await tauriFetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': key,
        Authorization: `Bearer ${key}`,
        'anthropic-version': '2023-06-01',
        'anthropic-beta': 'claude-code-20250219',
        'User-Agent': 'claude-cli/2.1.69',
        'x-app': 'cli',
      },
      body: Body.json(body),
      responseType: ResponseType.Text,
      timeout,
    });
    if (resp.ok) {
      const text = parseAnthropicText(JSON.parse(String(resp.data)));
      if (text) return text;
      lastError = `Kimi Anthropic 返回为空: ${String(resp.data).slice(0, 300)}`;
    } else {
      lastError = `Kimi Anthropic HTTP ${resp.status}: ${String(resp.data).slice(0, 300)}`;
    }
  }
  throw new Error(lastError || 'Kimi Anthropic 调用失败');
}

async function dmxKimiOpenAI(model: string, key: string, messages: unknown[], extra: Record<string, unknown>): Promise<string> {
  const timeout = Number(extra.timeout ?? 1000);
  const requestExtra = { ...extra };
  delete requestExtra.timeout;
  const resp = await tauriFetch(`${DMX_BASE}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: Body.json({ model, messages, temperature: 0.3, ...requestExtra }),
    responseType: ResponseType.Text,
    timeout,
  });
  if (!resp.ok) throw new Error(`Kimi OpenAI HTTP ${resp.status}: ${String(resp.data).slice(0, 400)}`);
  const data = JSON.parse(String(resp.data)) as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content?.trim() ?? '';
}

async function dmxKimiChat(messages: unknown[], extra: Record<string, unknown> = {}): Promise<string> {
  let kimiError = '';
  if (isKimiK3Configured()) {
    try {
      return await kimiK3Chat([
        {
          role: 'system',
          content: '你是鲲鹏剪辑软件的 Kimi K3 多模态剪辑 Agent。优先读取视频和图片本身，再结合转写、时间码和关键帧做判断；明确区分画面事实、推断和不确定项。输出必须具体、可执行、少套话。',
        },
        ...messages,
      ], extra);
    } catch (error) {
      kimiError = error instanceof Error ? error.message : String(error);
    }
  }
  const key = getDmxApiKey();
  if (!key) {
    if (kimiError) throw new Error(`Kimi K3 调用失败，且未配置 DMX 备用通道：${kimiError}`);
    throw new Error('缺少 Kimi 或 DMX API Key，无法调用 Kimi 剪辑 Agent');
  }
  const model = await resolveKimiModel(false);
  const mediaFirst = hasMediaParts(messages);
  if (mediaFirst) {
    try { return await dmxKimiOpenAI(model, key, messages, extra); } catch { /* Anthropic text fallback below */ }
    return dmxKimiAnthropic(model, key, messages, extra);
  }
  try {
    return await dmxKimiAnthropic(model, key, messages, extra);
  } catch {
    return dmxKimiOpenAI(model, key, messages, extra);
  }
}

function extractJson<T>(raw: string, fallback: T): T {
  const cleaned = raw.replace(/^```(?:json)?/i, '').replace(/```$/i, '').trim();
  try { return JSON.parse(cleaned) as T; } catch { /* continue */ }
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start >= 0 && end > start) {
    try { return JSON.parse(cleaned.slice(start, end + 1)) as T; } catch { /* continue */ }
  }
  return fallback;
}

async function maybeKimiVideoUrl(
  path: string,
  onProgress?: (message: string) => void,
): Promise<string | null> {
  if (!useSettingsStore.getState().kimiEditUseCos) return null;
  try {
    const fileName = path.split('/').pop() || 'reference.mp4';
    const uploaded = await uploadVideoToKimi(path, (progress) => {
      const loaded = (progress.loadedBytes / 1024 / 1024).toFixed(1);
      const total = (progress.totalBytes / 1024 / 1024).toFixed(1);
      onProgress?.(`Kimi 剪辑 Agent：上传 ${fileName} ${progress.percent}% · ${loaded}/${total} MB`);
    });
    return uploaded.url;
  } catch (error) {
    onProgress?.(`Kimi 剪辑 Agent：视频上传失败，将使用抽帧和转写：${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function buildFallbackProfile(note: MediaNote, raw: string): EditReferenceProfile {
  return {
    id: note.referenceId ?? `ref-${shortHash(note.analyzedAt + raw)}`,
    sourcePath: '',
    title: 'Kimi 参考视频分析',
    duration: note.duration ?? 0,
    frameCount: note.frameNotes?.length ?? note.frames.length,
    transcriptSegmentCount: note.transcriptSegments?.length ?? 0,
    narrativeStructure: [],
    rhythm: [],
    camera: [],
    transitions: [],
    textAndFx: [],
    reusablePrinciples: [],
    editAgentNotes: raw || 'Kimi 未返回结构化分析。',
    createdAt: Date.now(),
  };
}

async function askKimiForProfile(args: {
  path: string;
  duration: number;
  frames: ReferenceFrameNote[];
  segments: ReferenceTranscriptSegment[];
  videoUrl: string | null;
}): Promise<EditReferenceProfile> {
  const model = await resolveKimiModel();
  const frameLines = args.frames.map((f, i) =>
    `${i + 1}. @${f.t.toFixed(2)}s [${f.source}] ${f.description ?? f.path}`,
  ).join('\n');
  const transcript = args.segments.map((s) => `[${s.start.toFixed(1)}-${s.end.toFixed(1)}] ${s.text}`).join('\n');
  const schema = `请只输出 JSON：
{
  "title": "参考片标题",
  "shotTable": ["00.0-03.2 | 景别/构图 | 主体动作 | 运镜 | 剪辑点 | 字幕/图形 | 声音节奏"],
  "visualDesign": ["字体/颜色/版式/材质/空间层次/画面密度"],
  "htmlCssPatterns": ["可用 HTML/CSS 复刻的页面结构、动效、布局和关键参数"],
  "narrativeStructure": ["..."],
  "rhythm": ["..."],
  "camera": ["..."],
  "transitions": ["..."],
  "textAndFx": ["..."],
  "reusablePrinciples": ["..."],
  "editAgentNotes": "给剪辑 agent 的执行建议"
}`;

  const text = `你是 Kimi 剪辑 Agent。请做专业拉片，不要写泛泛总结。
逐镜头观察：时间点、景别、构图、主体动作、运镜、转场、字幕、图形、UI、声音节奏。
设计拆解：字体大小和位置、色彩、版式网格、层级、动效进入/停留/退出方式。
复刻判断：哪些应该落到时间轴剪辑，哪些适合手写 HTML/CSS 自由页面，哪些适合花字/特效节点。
只写能从画面或转写里看出来的内容；不确定就写“不确定”，不要脑补。
调用模型：${model}
素材：${args.path}
时长：${args.duration.toFixed(2)}s

关键帧索引：
${clampText(frameLines, 18000)}

完整转写：
${clampText(transcript, 26000)}

${schema}`;

  const content: unknown[] = [{ type: 'text', text }];
  if (args.videoUrl) content.push({ type: 'video_url', video_url: { url: args.videoUrl } });
  for (const f of args.frames.filter((x) => x.description).slice(0, MAX_ATTACHED_FRAMES)) {
    try {
      content.push({ type: 'image_url', image_url: { url: await loadImageInput(f.path) } });
    } catch { /* skip frame attachment */ }
  }

  let raw = '';
  try {
    raw = await dmxKimiChat([{ role: 'user', content }]);
  } catch {
    raw = await dmxKimiChat([{ role: 'user', content: text }]);
  }
  const parsed = extractJson<Partial<EditReferenceProfile>>(raw, {});
  return {
    id: `ref-${shortHash(`${args.path}:${args.duration}:${Date.now()}`)}`,
    sourcePath: args.path,
    title: parsed.title || args.path.split('/').pop() || '参考视频',
    duration: args.duration,
    frameCount: args.frames.length,
    transcriptSegmentCount: args.segments.length,
    narrativeStructure: parsed.narrativeStructure ?? [],
    rhythm: parsed.rhythm ?? [],
    camera: parsed.camera ?? [],
    transitions: parsed.transitions ?? [],
    textAndFx: parsed.textAndFx ?? [],
    reusablePrinciples: parsed.reusablePrinciples ?? [],
    editAgentNotes: parsed.editAgentNotes || raw,
    createdAt: Date.now(),
  };
}

async function askKimiForNativeVideoProfile(args: {
  path: string;
  duration: number;
  videoUrl: string;
}): Promise<EditReferenceProfile> {
  const model = await resolveKimiModel();
  const schema = `请只输出 JSON：
{
  "title": "参考片标题",
  "shotTable": ["00.0-03.2 | 景别/构图 | 主体动作 | 运镜 | 剪辑点 | 字幕/图形 | 声音节奏"],
  "visualDesign": ["字体/颜色/版式/材质/空间层次/画面密度"],
  "htmlCssPatterns": ["可用 HTML/CSS 复刻的页面结构、动效、布局和关键参数"],
  "narrativeStructure": ["..."],
  "rhythm": ["..."],
  "camera": ["..."],
  "transitions": ["..."],
  "textAndFx": ["..."],
  "reusablePrinciples": ["..."],
  "editAgentNotes": "给剪辑 agent 的执行建议"
}`;
  const text = `你是 Kimi 剪辑 Agent。请直接观看参考视频，做专业拉片，不要只做概括。
调用模型：${model}
本地素材：${args.path}
Kimi 视频文件引用：${args.videoUrl}
时长：${args.duration.toFixed(2)}s

重点输出：
- 镜头节奏：平均镜头长度、密集切点、慢段/快段、情绪推进
- 运镜/构图：推拉摇移、手持/稳定、主观/客观视角、景别变化
- 转场：硬切、匹配剪辑、遮挡转场、速度变化、闪白/叠化等
- 字幕/花字/HTML 动画：位置、入场方式、停留节奏、动效风格
- 视觉设计：字体大小、版式、颜色、空间层次、UI/网页元素细节
- HTML/CSS 复刻：哪些元素适合手写网页动画，写清结构和动效参数
- 叙事结构：开场 hook、信息展开、高潮、收束
- 可复用剪辑原则：抽象规律，不要照抄具体博主表达

${schema}`;
  const content: unknown[] = [
    { type: 'text', text },
    { type: 'video_url', video_url: { url: args.videoUrl } },
  ];
  const raw = await dmxKimiChat([{ role: 'user', content }], { response_format: { type: 'json_object' }, timeout: 120 });
  const parsed = extractJson<Partial<EditReferenceProfile>>(raw, {});
  return {
    id: `ref-${shortHash(`${args.path}:${args.duration}:native:${Date.now()}`)}`,
    sourcePath: args.path,
    title: parsed.title || args.path.split('/').pop() || '参考视频',
    duration: args.duration,
    frameCount: 0,
    transcriptSegmentCount: 0,
    narrativeStructure: parsed.narrativeStructure ?? [],
    rhythm: parsed.rhythm ?? [],
    camera: parsed.camera ?? [],
    transitions: parsed.transitions ?? [],
    textAndFx: parsed.textAndFx ?? [],
    reusablePrinciples: parsed.reusablePrinciples ?? [],
    editAgentNotes: parsed.editAgentNotes || raw,
    createdAt: Date.now(),
  };
}

export async function analyzeReferenceVideo(path: string, options: AnalyzeReferenceVideoOptions = {}): Promise<MediaNote> {
  const mode = options.mode ?? 'full';
  const duration = await probeDuration(path);
  if (!duration) throw new Error(`无法读取视频时长: ${path}`);
  const metadata = await invoke<LocalFileMetadata>('get_file_metadata', { path }).catch(() => ({ size: 0, modifiedMs: 0 }));
  const sourceHash = shortHash(`${path}:${metadata.size}:${metadata.modifiedMs}:${duration}`);
  const canUploadNative = metadata.size > 0 && metadata.size <= 100 * 1024 * 1024;
  let uploadAttempted = false;
  let uploadedVideoUrl: string | undefined;

  const readTranscript = async (): Promise<ReferenceTranscriptSegment[]> => {
    throwIfAborted(options.signal);
    try {
      const transcript = await ensureTranscript(path);
      return transcript.sentences
        .filter((sentence) => !sentence.silence && sentence.text.trim())
        .map((sentence) => ({ start: sentence.start, end: sentence.end, text: sentence.text }));
    } catch (error) {
      options.onProgress?.(`Kimi 剪辑 Agent：转写暂不可用，继续视觉分析：${error instanceof Error ? error.message : String(error)}`);
      return [];
    }
  };

  if (options.nativeFirst !== false && canUploadNative) {
    throwIfAborted(options.signal);
    options.onProgress?.('Kimi 剪辑 Agent：优先尝试原生视频输入');
    options.onProgress?.('Kimi 剪辑 Agent：准备上传视频到 Kimi 文件服务');
    uploadAttempted = true;
    uploadedVideoUrl = await withProgressTicker(
      'Kimi 剪辑 Agent：正在准备 Kimi 视频文件',
      options.onProgress,
      () => maybeKimiVideoUrl(path, options.onProgress),
    ) ?? undefined;
    if (uploadedVideoUrl) {
      try {
        options.onProgress?.(`Kimi 剪辑 Agent：视频文件就绪（${describeUrl(uploadedVideoUrl)}），开始原生视频理解。最长等待 ${Math.round(NATIVE_VIDEO_TIMEOUT_MS / 1000)}s 后自动降级`);
        const profile = await withProgressTicker(
          'Kimi 剪辑 Agent：DMX Kimi 原生视频理解请求中',
          options.onProgress,
          () => withTimeout(
            askKimiForNativeVideoProfile({ path, duration, videoUrl: uploadedVideoUrl! }),
            NATIVE_VIDEO_TIMEOUT_MS,
            `原生视频理解超过 ${Math.round(NATIVE_VIDEO_TIMEOUT_MS / 1000)}s 未返回`,
          ),
          10_000,
          NATIVE_VIDEO_TIMEOUT_MS,
        );
        throwIfAborted(options.signal);
        options.onProgress?.('Kimi 剪辑 Agent：原生理解完成，补充可检索的时间轴证据');
        const transcriptSegments = await readTranscript();
        const ffmpeg = await detectFfmpeg();
        let frameNotes: ReferenceFrameNote[] = [];
        if (ffmpeg) {
          const cuts = await detectSceneCuts(ffmpeg, path, 18);
          const samples = evenlySelect(buildSampleTimes(duration, cuts, 'quick'), 18);
          const outDir = await ensureWorkspaceImagesDir();
          const extracted = await mapPool(samples, 4, async (sample) => {
            throwIfAborted(options.signal);
            const framePath = await extractFrame(ffmpeg, path, sample.t, outDir);
            return framePath ? { t: sample.t, path: framePath, source: sample.source } as ReferenceFrameNote : null;
          });
          frameNotes = extracted.filter((frame): frame is ReferenceFrameNote => Boolean(frame));
        }
        const referenceProfile = { ...profile, frameCount: frameNotes.length, transcriptSegmentCount: transcriptSegments.length };
        return {
          referenceId: referenceProfile.id,
          sourceHash,
          frames: frameNotes.map((frame) => [Math.round(frame.t), frame.path]),
          frameNotes,
          transcriptSegments,
          transcript: transcriptSegments.map((segment) => segment.text).join(' '),
          duration,
          referenceProfile,
          analysisMode: 'native',
          analyzedAt: Date.now(),
          analysisState: { status: 'ready', stage: '原生理解与时间轴索引完成', progress: 100, updatedAt: Date.now() },
        };
      } catch (error) {
        options.onProgress?.(`Kimi 剪辑 Agent：原生视频输入失败，切换抽帧降级链：${error instanceof Error ? error.message : String(error)}`);
      }
    } else {
      options.onProgress?.('Kimi 剪辑 Agent：未获得 Kimi 视频文件引用，切换抽帧降级链');
    }
  } else if (options.nativeFirst !== false && !canUploadNative) {
    options.onProgress?.('Kimi 剪辑 Agent：视频超过 100 MB，跳过整片上传，直接建立本地全片索引');
  }

  throwIfAborted(options.signal);
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) throw new Error('未检测到 ffmpeg（macOS: brew install ffmpeg；Windows: winget install ffmpeg）');

  options.onProgress?.('Kimi 剪辑 Agent：检测全片镜头切点');
  const sceneCuts = await detectSceneCuts(ffmpeg, path, mode === 'quick' ? 30 : 80);
  const samples = buildSampleTimes(duration, sceneCuts, mode);
  const outDir = await ensureWorkspaceImagesDir();

  options.onProgress?.(`Kimi 剪辑 Agent：并行抽取 ${samples.length} 个关键帧`);
  const extracted = await mapPool(samples, 4, async (sample) => {
    throwIfAborted(options.signal);
    const framePath = await extractFrame(ffmpeg, path, sample.t, outDir);
    return framePath ? { t: sample.t, path: framePath, source: sample.source } as ReferenceFrameNote : null;
  });
  const frameNotes = extracted.filter((frame): frame is ReferenceFrameNote => Boolean(frame));
  if (frameNotes.length === 0) throw new Error('关键帧抽取失败');
  useEditorStore.getState().setMediaNote(path, {
    frames: frameNotes.map((frame) => [Math.round(frame.t), frame.path]),
    frameNotes,
    sourceHash,
    duration,
    analyzedAt: Date.now(),
    analysisState: { status: 'running', stage: '关键帧索引完成，正在理解画面', progress: 55, updatedAt: Date.now() },
  });

  await describeFrames(frameNotes, mode, options.onProgress, options.signal);
  options.onProgress?.('Kimi 剪辑 Agent：完整转写音频');
  const transcriptSegments = await readTranscript();
  throwIfAborted(options.signal);

  options.onProgress?.('Kimi 剪辑 Agent：整理视频证据与参考片档案');
  if (!uploadAttempted && canUploadNative) {
    uploadAttempted = true;
    uploadedVideoUrl = await maybeKimiVideoUrl(path, options.onProgress) ?? undefined;
  }
  let profile: EditReferenceProfile;
  try {
    options.onProgress?.('Kimi 剪辑 Agent：生成参考片风格档案');
    profile = await askKimiForProfile({ path, duration, frames: frameNotes, segments: transcriptSegments, videoUrl: uploadedVideoUrl ?? null });
  } catch (error) {
    options.onProgress?.(`Kimi 剪辑 Agent：模型总结失败，使用本地结构化档案：${error instanceof Error ? error.message : String(error)}`);
    profile = buildFallbackProfile({
      frames: frameNotes.map((frame) => [frame.t, frame.description ?? frame.path]),
      frameNotes,
      transcriptSegments,
      transcript: transcriptSegments.map((segment) => segment.text).join(' '),
      duration,
      analyzedAt: Date.now(),
    }, error instanceof Error ? error.message : String(error));
    profile.sourcePath = path;
  }

  return {
    referenceId: profile.id,
    sourceHash,
    frames: frameNotes.map((frame) => [Math.round(frame.t), frame.description ?? frame.path]),
    frameNotes,
    transcriptSegments,
    transcript: transcriptSegments.map((segment) => segment.text).join(' '),
    duration,
    referenceProfile: profile,
    analysisMode: 'indexed',
    analyzedAt: Date.now(),
    analysisState: { status: 'ready', stage: '全片索引与参考片档案完成', progress: 100, updatedAt: Date.now() },
  };
}

export async function kimiEditPlan(args: {
  references: MediaNote[];
  timelineState: string;
  goal: string;
  duration?: number;
  aspect?: string;
}): Promise<KimiEditPlanResult> {
  const refText = args.references.map((note, i) => {
    const p = note.referenceProfile;
    return `# Reference ${i + 1}: ${p?.title ?? note.referenceId}
id=${note.referenceId}
duration=${note.duration ?? p?.duration ?? '?'}s
叙事：${(p?.narrativeStructure ?? []).join(' / ')}
节奏：${(p?.rhythm ?? []).join(' / ')}
运镜：${(p?.camera ?? []).join(' / ')}
转场：${(p?.transitions ?? []).join(' / ')}
图文特效：${(p?.textAndFx ?? []).join(' / ')}
原则：${(p?.reusablePrinciples ?? []).join(' / ')}
转写摘录：${clampText(note.transcript ?? '', 4000)}`;
  }).join('\n\n');
  const prompt = `你是 Kimi 剪辑 Agent。基于参考视频风格和当前鲲鹏时间轴，输出一个可执行剪辑计划。
要求：
- 只输出 JSON，不要解释。
- shots 必须引用当前时间轴已有素材 source_path，不能虚构文件路径。
- 每个镜头必须有明确 in_sec/out_sec/reason。
- 可额外给 text_overlays 和 fx_suggestions，但不要替代 shots。
- 如果用户目标包含“复刻参考片网页动画/自由模式/不要模板/Hyperframe”，请额外输出 free_pages，说明要手写 HTML/CSS 的页面 brief；执行时由主 Agent 调 timeline_add_free_page，不能强行套 page_template_id/component_id。
- 目标时长：${args.duration ? `${args.duration}s` : '由素材决定'}；画幅：${args.aspect ?? '沿用当前'}。

用户目标：
${args.goal}

当前时间轴：
${args.timelineState}

参考视频档案：
${refText}

JSON schema:
{
  "title": "计划标题",
  "shots": [{"label":"镜头名","source_path":"/abs/video.mp4","in_sec":0,"out_sec":3.2,"reason":"为什么这样剪"}],
  "text_overlays": [{"text":"文字","start_sec":0,"end_sec":2.5,"template_id":"可选"}],
  "fx_suggestions": [{"label":"特效名","start_sec":0,"duration":2,"page_template_id":"可选","component_id":"可选","params":{},"theme":"可选"}],
  "free_pages": [{"label":"自由网页页名","start_sec":0,"duration":4,"brief":"要手写的 HTML/CSS 页面结构、视觉、动效、复刻点","visual_reference":"参考片中对应画面/时间点，可选"}],
  "notes": "执行注意"
}`;
  const raw = await dmxKimiChat([{ role: 'user', content: prompt }], { response_format: { type: 'json_object' } });
  return extractJson<KimiEditPlanResult>(raw, { title: 'Kimi 剪辑计划', shots: [], notes: raw });
}

export async function kimiReview(args: {
  reference: MediaNote;
  outputVideoPath: string;
  timelineState: string;
}): Promise<string> {
  const outputNote = await analyzeReferenceVideo(args.outputVideoPath, { mode: 'quick' });
  const prompt = `你是 Kimi 剪辑质检 Agent。对比参考视频和鲲鹏成片，输出下一轮修改建议，要求直接、具体、可执行。

参考片档案：
${JSON.stringify(args.reference.referenceProfile ?? args.reference, null, 2)}

成片档案：
${JSON.stringify(outputNote.referenceProfile ?? outputNote, null, 2)}

当前时间轴：
${args.timelineState}

请按以下小标题输出：
1. 节奏差距
2. 运镜/转场差距
3. 字幕/图形动画差距
4. 可直接执行的 timeline_* 修改建议`;
  return dmxKimiChat([{ role: 'user', content: prompt }]);
}
