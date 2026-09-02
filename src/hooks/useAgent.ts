import { useCallback, useRef, useEffect, useState } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { emit } from '@tauri-apps/api/event';
import {
  GLMClient,
  AgentCoordinator,
  createDefaultRegistry,
  SkillLoader,
  createBackgroundTaskTool,
  createTodoWriteTool,
  executeCommand,
  McpManager,
  MCP_SERVERS,
  repairToolPairingSnapshot,
} from '@/lib/agent';
import { ensureMemoryDirs } from '@/lib/aigc/seedData';
import { appendGenerationLog } from '@/lib/aigc/genLogger';
import { registerHook } from '@/lib/agent/hooks';
import { buildSkillRelevanceNotice } from '@/lib/agent/skillPromptPolicy';
import { recordTrajectory, maybeEvolve } from '@/lib/agent/evolution';
import { registerCleanup } from '@/lib/cleanupRegistry';
import { getShellInfo, osDisplayName } from '@/lib/platform';
import { safeLocalStorage } from '@/lib/safeStorage';
import {
  writeSessionToFile,
  readSessionFromFile,
  writeSessionIndex,
  readAgentMessagesFromLocalStorage,
  readMessagesFromLocalStorage,
  hydrateLocalStorageSession,
  compactAgentMessagesForStorage,
} from '@/lib/historyPersistence';
import type {
  AgentMessage,
  CoordinatorCallbacks,
  ToolExecution,
  TokenUsage,
  AgentUserContentBlock,
} from '@/lib/agent';
import { useChatStore } from '@/stores/chatStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey, resolveSlotApiKey, type CredentialHostState } from '@/lib/credentials';
import { useToolConfirmStore } from '@/stores/toolConfirmStore';
import { useBackgroundTaskStore } from '@/stores/backgroundTaskStore';
import { useAigcProjectStore } from '@/stores/aigcProjectStore';
import { useRunStepStore } from '@/stores/runStepStore';
import { useDeepseekHarnessStore } from '@/stores/deepseekHarnessStore';
import { useTodoStore } from '@/stores/todoStore';
import type { AigcProject } from '@/lib/aigc/projectStore';
import type { Message } from '@/types';
import { randomUUID } from '@/lib/uuid';
import {
  ensureActiveConversationSessionRaw,
  ensureSessionTitleRaw,
  useSessions,
  setCoordinatorRestoreCallback,
} from './useSessions';
import { normalizeCustomRules } from '@/lib/agent/rulePolicy';
import { agentLog } from '@/lib/agent/logger';
import { notify } from '@/lib/notify';
import {
  projectUIMessagesToAgentMessages,
  recoverDegradedAgentHistory,
} from '@/lib/agent/projectMessages';
import { stripHarnessPrefix } from '@/lib/agent/harnessDisplay';
import type { RouteStrategy } from '@/lib/agent/providers/router';
import { decodeChatModel, inferAgentWorkspaceScope } from '@/lib/agent/modelCatalog';
import {
  loadMediaInput,
  normalizeLocalMediaPath,
} from '@/lib/agent/mediaInput';
import { isImageMediaPath, isVideoMediaPath } from '@/lib/agent/mediaKind';
import { uploadVideoToKimi, type KimiVideoUploadProgress } from '@/lib/agent/kimiFiles';
import { normalizeRunProgress } from '@/lib/agent/runStepPresentation';
import { buildChatRouteStrategy, getPrimaryRouteSelection } from '@/lib/agent/routeStrategy';
import { CoalescedIdleWork } from '@/lib/performance/coalescedIdleWork';
import {
  DshBridge,
  deepseekBuiltinRoute,
  shouldFallbackHarnessToBuiltin,
} from '@/lib/agent/dsh';

async function invokeWithStartupTimeout<T>(
  command: string,
  args: Record<string, unknown>,
  timeoutMs = 3_000,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      invoke<T>(command, args),
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(
          () => reject(new Error(`${command} 启动读取超时（${timeoutMs}ms）`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function hasAnyChatProviderKey(
  settings: CredentialHostState & { glmApiKey?: string },
): boolean {
  if (resolveApiKey(settings, 'glm', settings.glmApiKey ?? '').trim()) return true;
  const ids = new Set<string>([
    ...Object.keys(settings.providerApiKeys ?? {}),
    ...Object.keys(settings.credentialRefs ?? {})
      .filter((cap) => cap.startsWith('provider:'))
      .map((cap) => cap.slice('provider:'.length)),
  ]);
  for (const id of ids) {
    if (resolveApiKey(settings, `provider:${id}`, settings.providerApiKeys?.[id] ?? '').trim()) return true;
  }
  return false;
}

function buildRouteStrategyFromSettings(
  settings: ReturnType<typeof useSettingsStore.getState>,
  legacyGlmApiKey?: string,
  preferredProviderId?: string,
  pinned?: { providerId: string; modelId: string } | null,
): RouteStrategy | undefined {
  return buildChatRouteStrategy(settings, {
    legacyGlmApiKey,
    primary: pinned,
    legacyAgentPreference: preferredProviderId,
  });
}

type SettingsSnapshot = ReturnType<typeof useSettingsStore.getState>;

function buildComposerModelRules(settings: SettingsSnapshot): string {
  return `## 普通对话生成模型偏好
- 生图默认模型：${settings.chatImageModel || 'gpt-image-2'}
- 生视频默认模型：${settings.chatVideoModel || 'seedance-2.0'}
当用户在普通对话中要求生视频时，直接调用 video_generate；用户指定 MiniMax/H3/海螺 H3 时 engine=minimax-h3。不要切换到画布，不要创建画布节点，除非用户明确说“放到画布”或要求操作某个画布节点。普通 MG 动画使用 mg_generate_with_reference_boards，也不要求进入画布。
当用户没有明确指定模型时，必须使用上述选择。用户明确指定、当前模型不支持任务，或路由失败时才改用其他模型，并说明原因。此偏好不覆盖画布节点、工坊镜头或剪辑时间线里已经保存的模型选择。`;
}

function buildAgentCustomRules(
  baseRules: string | undefined,
  settings: SettingsSnapshot,
  agentId: string,
): string | undefined {
  const meta = settings.agentMetas[agentId];
  return [
    baseRules,
    buildComposerModelRules(settings),
    meta?.systemPromptAddition
      ? `## Agent 专属规则 (${meta.name ?? agentId})\n${meta.systemPromptAddition}`
      : undefined,
  ].filter(Boolean).join('\n\n') || undefined;
}

function historyText(content: AgentMessage['content']): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .map((block) => block.type === 'text' ? block.text : `[${block.type}附件]`)
    .join('\n');
}

/** Rehydrate an ACP session from the coordinator's persisted conversation. */
function buildDshConversationContext(messages: AgentMessage[], maxChars = 160_000): string {
  const turns = messages
    .filter((message) => message.role === 'user' || message.role === 'assistant')
    .map((message) => `${message.role === 'user' ? '用户' : '助手'}：${historyText(message.content)}`);
  const selected: string[] = [];
  let used = 0;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (selected.length > 0 && used + turn.length > maxChars) break;
    selected.unshift(turn);
    used += turn.length;
  }
  return selected.length > 0
    ? `[当前任务的既有对话记录，仅作为上下文继续处理]\n${selected.join('\n\n')}`
    : '';
}

async function buildDshMediaBlocks(filePaths: string[]): Promise<AgentUserContentBlock[]> {
  const blocks: AgentUserContentBlock[] = [];
  for (const path of filePaths) {
    const isImage = isImageMediaPath(path);
    const isRemoteVideo = /^https?:\/\//i.test(path) && isVideoMediaPath(path);
    if (!isImage && !isRemoteVideo) continue;
    try {
      const { dataUrl, mediaType } = await loadMediaInput(path);
      const source = dataUrl.startsWith('data:')
        ? { type: 'base64' as const, media_type: mediaType, data: dataUrl.slice(dataUrl.indexOf(',') + 1) }
        : { type: 'url' as const, url: dataUrl };
      blocks.push(isImage ? { type: 'image', source } : { type: 'video', source });
    } catch (error) {
      agentLog.warn('DSH', `Failed to attach media: ${path}`, error);
    }
  }
  return blocks;
}

const KIMI_INLINE_VIDEO_MAX_BYTES = 12 * 1024 * 1024;
const KIMI_FILE_VIDEO_MAX_BYTES = 100 * 1024 * 1024;

interface KimiMediaBuildResult {
  blocks: AgentUserContentBlock[];
  notices: string[];
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatKimiUploadProgress(progress: KimiVideoUploadProgress, fileName: string): string {
  const capacity = progress.totalBytes > 0
    ? `${formatMegabytes(progress.loadedBytes)} / ${formatMegabytes(progress.totalBytes)}`
    : formatMegabytes(progress.loadedBytes);
  if (progress.percent >= 100) return `Kimi 视频上传完成，正在分析“${fileName}”`;
  return `正在上传“${fileName}”到 Kimi：${progress.percent}% · ${capacity}`;
}

function localFileName(path: string): string {
  return normalizeLocalMediaPath(path).split(/[\\/]/).pop() || 'video.mp4';
}

async function buildKimiMediaBlocks(
  filePaths: string[],
  runId?: string,
): Promise<KimiMediaBuildResult> {
  const blocks: AgentUserContentBlock[] = [];
  const notices: string[] = [];
  for (const path of filePaths) {
    const isImage = isImageMediaPath(path);
    const isVideo = isVideoMediaPath(path);
    if (!isImage && !isVideo) continue;
    try {
      const isRemote = /^https?:\/\//i.test(path) || path.startsWith('data:');
      if (isVideo && !isRemote) {
        const localPath = normalizeLocalMediaPath(path);
        const size = await invoke<number>('get_file_size', { path: localPath });
        if (size > KIMI_INLINE_VIDEO_MAX_BYTES) {
          const fileName = localFileName(localPath);
          if (size > KIMI_FILE_VIDEO_MAX_BYTES) {
            notices.push(
              `大型视频“${fileName}”大小为 ${formatMegabytes(size)}，超过 Kimi 单文件 100 MB 上限。` +
              `必须调用 timeline_analyze_reference_video 在本地建立转写、镜头索引和关键帧；需要精看时再截取小片段，不得上传整段原片，也不得声称已经直接观看。`,
            );
            continue;
          }
          const progressKey = `kimi-upload-${Date.now()}`;
          useRunStepStore.getState().upsertProgressUpdate(
            progressKey,
            `视频较大（${formatMegabytes(size)}），准备上传到 Kimi`,
            runId,
          );
          try {
            const uploaded = await uploadVideoToKimi(
              localPath,
              (progress) => useRunStepStore.getState().upsertProgressUpdate(
                progressKey,
                formatKimiUploadProgress(progress, fileName),
                runId,
              ),
            );
            blocks.push({ type: 'video', source: { type: 'url', url: uploaded.url } });
            notices.push(`视频附件“${fileName}”已上传到 Kimi 文件服务，可直接分析画面与声音。`);
            continue;
          } catch (error) {
            agentLog.warn('Kimi', `Kimi file upload failed for large video: ${localPath}`, error);
            useRunStepStore.getState().upsertProgressUpdate(
              progressKey,
              `Kimi 视频上传失败，已切换本地分析：${error instanceof Error ? error.message : String(error)}`,
              runId,
            );
            notices.push(
              `视频附件“${fileName}”大小为 ${formatMegabytes(size)}，Kimi 文件上传失败，未直接附加给模型。` +
              `请使用本地视频分析、抽帧或转写工具读取该文件，不得声称已经直接观看。`,
            );
          }
          continue;
        }
      }

      const { dataUrl, mediaType } = await loadMediaInput(path);
      const source = dataUrl.startsWith('data:')
        ? {
            type: 'base64' as const,
            media_type: mediaType,
            data: dataUrl.slice(dataUrl.indexOf(',') + 1),
          }
        : { type: 'url' as const, url: dataUrl };
      blocks.push(isVideo ? { type: 'video', source } : { type: 'image', source });
      if (isImage) {
        notices.push(
          `图片附件“${localFileName(path)}”已作为原生图片内容直接传给 Kimi K3。` +
          '请直接观察并回答，不要调用 image_recognition 进行二次识别。',
        );
      }
    } catch (error) {
      agentLog.warn('Kimi', `Failed to attach media directly: ${path}`, error);
      notices.push(`附件“${localFileName(path)}”无法直接附加，请改用文件读取或媒体分析工具。`);
    }
  }
  return { blocks, notices };
}

// ── AgentMessage 持久化 ─────────────────────────────────────────────────────
const AGENT_MSGS_PREFIX = 'kunpeng-agent-messages-';
function compactToolExecutionsForHistory(executions: ToolExecution[]): ToolExecution[] {
  return executions.map((execution) => {
    const output = execution.result?.output ?? '';
    const error = execution.result?.error;
    return {
      ...execution,
      params: {},
      result: execution.result
        ? {
            ...execution.result,
            output: output.length > 4_000
              ? `${output.slice(0, 3_200)}\n\n[结果已压缩，原始长度 ${output.length.toLocaleString()} 字符]`
              : output,
            ...(error ? { error: error.slice(0, 4_000) } : {}),
          }
        : undefined,
    };
  });
}

interface AgentMessagesSaveSnapshot {
  sessionId: string;
  messages: AgentMessage[];
}

async function persistAgentMessagesNow({ sessionId, messages }: AgentMessagesSaveSnapshot): Promise<void> {
  const compactMessages = compactAgentMessagesForStorage(messages);
  try {
    safeLocalStorage.setItem(AGENT_MSGS_PREFIX + sessionId, JSON.stringify(compactMessages));
  } catch { /* quota */ }
  const uiMessages = readMessagesFromLocalStorage(sessionId) ?? [];
  // localStorage is only a small fast cache. The per-session file receives
  // the richer history and applies its own much larger disk safety limit.
  await writeSessionToFile(sessionId, { messages: uiMessages, agentMessages: messages });
}

const agentMessagesSaveQueue = new CoalescedIdleWork<AgentMessagesSaveSnapshot>(
  persistAgentMessagesNow,
  { debounceMs: 1_500, minIntervalMs: 15_000 },
);

function saveAgentMessages(sessionId: string, messages: AgentMessage[]) {
  // getMessages returns a snapshot array today; copy it defensively so later
  // coordinator appends cannot change the queued persistence boundary.
  agentMessagesSaveQueue.schedule(sessionId, { sessionId, messages: [...messages] });
}

function flushAgentMessages(sessionId: string, messages: AgentMessage[]): Promise<void> {
  return agentMessagesSaveQueue.flush(sessionId, { sessionId, messages: [...messages] });
}

function loadAgentMessages(sessionId: string): AgentMessage[] | null {
  return readAgentMessagesFromLocalStorage(sessionId);
}

function deleteAgentMessages(sessionId: string) {
  try {
    localStorage.removeItem(AGENT_MSGS_PREFIX + sessionId);
  } catch { /* ignore */ }
}

/** 从设置中构建生图 API 上下文文本，注入 system prompt */
function buildImageApiContext(settings: ReturnType<typeof useSettingsStore.getState>): string | undefined {
  const slots = settings.imageApiSlots?.filter(s => s.enabled && s.baseUrl && resolveSlotApiKey(settings, s));
  if (!slots || slots.length === 0) return undefined;

  const latency = settings.imageApiLatency || {};
  const ONE_HOUR = 60 * 60 * 1000;

  // 按测速缓存排序（未过期的按延迟升序，过期/无缓存的按 priority）
  const sorted = [...slots].sort((a, b) => {
    const la = latency[a.id];
    const lb = latency[b.id];
    const aFresh = la && la.latencyMs >= 0 && (Date.now() - la.testedAt) < ONE_HOUR;
    const bFresh = lb && lb.latencyMs >= 0 && (Date.now() - lb.testedAt) < ONE_HOUR;
    if (aFresh && bFresh) return la.latencyMs - lb.latencyMs;
    if (aFresh) return -1;
    if (bFresh) return 1;
    return a.priority - b.priority;
  });

  const lines = sorted.map((s, i) => {
    const lat = latency[s.id];
    const latStr = lat && lat.latencyMs >= 0 ? ` (${lat.latencyMs}ms)` : '';
    return `${i + 1}. ${s.label}: provider=${s.provider || 'dmxapi'}${latStr}`;
  });

  return `普通对话生图必须优先调用 image_generate 工具，禁止自己拼 API 请求或临时编写生图脚本。该工具会读取底部当前选择的 GPT Image 2 / 豆包 5 Pro，并自动完成多 API 降级、参考图压缩、比例到像素尺寸的转换和图片回传。

  GPT Image 2 由「设置 → 图片模型」中的 API 槽位自动路由。

  比例纪律：调用 image_generate 时必须传 aspect_ratio。用户明确说横版/竖版/方图或 16:9、9:16、1:1 等比例时严格照传；用户未指定才默认 16:9。禁止只把比例写进 prompt 而遗漏工具参数。

  当前配置的生图 API（按速度排序）：

  ${lines.join('\n')}

  只有 image_generate 不可用或维护旧任务时，才允许降级使用 ~/.kunpeng/skills/image-generation/image_client.py。旧客户端调用也必须显式传 aspect_ratio：
\`\`\`python
import sys, os, json
sys.path.insert(0, os.path.expanduser('~/.kunpeng/skills/image-generation'))
from image_client import ImageGenerationClient
# 槽位配置（含 key）由鲲鹏写入此文件，不要把 key 打印到输出
slots = json.load(open(os.path.expanduser('~/.kunpeng/image_api_slots.json')))
client = ImageGenerationClient(api_slots=slots)
result = client.generate(prompt='描述', output_path='/path/to/output.png', model='gpt-image-2', aspect_ratio='16:9', resolution='2k')
result_pro = client.generate(prompt='描述', output_path='/path/to/seedream.png', model='seedream-v5-pro', aspect_ratio='16:9', resolution='2k')
print(json.dumps({"success": result.success, "path": result.image_path, "model": result.model_used}, ensure_ascii=False))
\`\`\`

  旧客户端图生图示例（带参考图）：
\`\`\`python
import base64
ref_b64 = base64.b64encode(open('参考图.png', 'rb').read()).decode()
result = client.generate(
    prompt='描述',
    output_path='/path/to/output.png',
    model='gpt-image-2',  # 也可用 seedream-v5-pro；带图时务必传 reference_images，避免退化成文生图
    aspect_ratio='16:9',
    reference_images=[("ref", ref_b64)],  # 客户端会自动压缩到 1536px
)
\`\`\`

支持模型：gpt-image-2（主力）、seedream-v5-pro（Seedream 5.0 Pro，DMXAPI / 即梦 CLI / RunningHub 智能路由；适合审美要求高的资产图/分镜图）。即梦 CLI 未登录时，系统会自动发起 Agent 登录恢复，不要把登录错误误判成提示词失败。
参考图会自动压缩到 1536px/85quality，避免几十兆原图拖慢上传，同时保留人物/场景参考细节。`;
}

/**
 * 把生图槽位（含 key）写到 ~/.kunpeng/image_api_slots.json，供 image_client.py
 * 读取。这样 key 不进入 system prompt / 对话历史（修复 key 泄漏问题）。
 */
async function syncImageSlotsFile(settings: ReturnType<typeof useSettingsStore.getState>): Promise<void> {
  const slots = settings.imageApiSlots?.filter(s => s.enabled && s.baseUrl && resolveSlotApiKey(settings, s)) ?? [];
  const payload = slots.map(s => ({
    label: s.label,
    base_url: s.baseUrl,
    api_key: resolveSlotApiKey(settings, s),
    provider: s.provider || 'dmxapi',
  }));
  try {
    // Owner-only (0600) write: this file carries per-channel API keys.
    await invoke('write_text_file_private', {
      path: '.kunpeng/image_api_slots.json',
      contents: JSON.stringify(payload, null, 2),
    });
  } catch (err) {
    agentLog.warn('Agent', 'Failed to sync image slots file', err);
  }
}

function buildRunninghubContext(settings: ReturnType<typeof useSettingsStore.getState>): string | undefined {
  const key = resolveApiKey(settings, 'runninghub', settings.runninghubApiKey);
  if (key) {
    // key 本体不进提示词（避免进入持久化的对话历史），脚本自动从
    // ~/.kunpeng/kunpeng.json 或环境变量读取（见 syncRunninghubKeyFile）。
    return `RunningHub API Key 已配置（脚本会自动从 ~/.kunpeng/kunpeng.json 读取，不需要传 --api-key）：
\`\`\`bash
python3 ~/.kunpeng/skills/rhtv/scripts/runninghub.py --endpoint ... --prompt "..." -o /tmp/kunpeng/rh-output/...
\`\`\`
普通对话直接生视频优先调用 video_generate；它会读取底部选择的默认视频模型，直接保存并交付结果，不需要切换画布。MiniMax H3 也由 video_generate 直接调用。
仅在 video_generate 不覆盖的长尾模型上使用脚本。Seedance 视频脚本兜底必须用 kuaizi.py，不要用 runninghub.py：
\`\`\`bash
python3 ~/.kunpeng/skills/rhtv/scripts/kuaizi.py --prompt "..." --mode pro --image ref.png -o /tmp/kunpeng/rh-output/seedance_$(date +%s).mp4
\`\`\`
画布场景用 canvas_generate 工具（后端自动走丽帧）。用户没有要求进入画布时，禁止为了生视频自行切换到画布或创建节点。
⚠️ 下载生成结果时禁止自行 curl/wget——脚本内置 COS 云函数中转加速，直连极慢。如需单独下载远程文件：
\`\`\`bash
python3 ~/.kunpeng/skills/rhtv/scripts/runninghub.py --download-url "URL" -o /tmp/kunpeng/rh-output/name.ext
\`\`\``;
  }
  // 即使设置中没有填 key，也注入上下文：脚本会自动从环境变量 RUNNINGHUB_API_KEY 获取
  return `RunningHub 可用。API Key 未在鲲鹏设置中配置，但 runninghub.py 会自动从环境变量 RUNNINGHUB_API_KEY 或 ~/.kunpeng/kunpeng.json 获取。
执行时不需要传 --api-key 参数，脚本会自动读取：
\`\`\`bash
python3 ~/.kunpeng/skills/rhtv/scripts/runninghub.py --endpoint ... --prompt "..." -o /tmp/kunpeng/rh-output/...
\`\`\`
如果执行失败提示 key 未配置，请在鲲鹏设置中填写 RunningHub API Key，或在 shell 配置文件（macOS/Linux 为 ~/.zshrc，Windows 为系统环境变量）中设置 RUNNINGHUB_API_KEY=xxx。`;
}

/**
 * 把 RunningHub key 同步到 ~/.kunpeng/kunpeng.json（runninghub.py 的标准读取
 * 位置），替代把 key 拼进 system prompt 的旧做法。
 */
async function syncRunninghubKeyFile(settings: ReturnType<typeof useSettingsStore.getState>): Promise<void> {
  const key = resolveApiKey(settings, 'runninghub', settings.runninghubApiKey).trim();
  if (!key) return;
  try {
    const { readTextFile: rtf, exists: ex, BaseDirectory: BD } = await import('@tauri-apps/api/fs');
    const path = '.kunpeng/kunpeng.json';
    let cfg: Record<string, any> = {};
    if (await ex(path, { dir: BD.Home })) {
      try { cfg = JSON.parse(await rtf(path, { dir: BD.Home })); } catch { cfg = {}; }
    }
    const entries = ((cfg.skills ??= {}).entries ??= {});
    let changed = false;
    if (entries.runninghub?.apiKey !== key) {
      (entries.runninghub ??= {}).apiKey = key;
      changed = true;
    }
    const transit = settings.cosTransitEndpoint?.trim() || '';
    if (transit && entries.runninghub?.cosTransitEndpoint !== transit) {
      (entries.runninghub ??= {}).cosTransitEndpoint = transit;
      changed = true;
    }
    if (!changed) return;
    // Owner-only (0600) write: this file carries the RunningHub key.
    await invoke('write_text_file_private', { path, contents: JSON.stringify(cfg, null, 2) });
  } catch (err) {
    agentLog.warn('Agent', 'Failed to sync runninghub key file', err);
  }
}

/** 从当前 AIGC 项目构建上下文文本（注入 system prompt 的 aigcMemoryContext 槽位） */
function buildAigcProjectContext(project: AigcProject | null): string | undefined {
  if (!project) return undefined;

  const STATUS_LABEL: Record<AigcProject['status'], string> = {
    'draft': '草稿（待上传文档）',
    'parsed': '文档已解析',
    'prompts-ready': '提示词已生成',
    'scenes-ready': '场景图已生成',
    'assets-ready': '资产图已就绪',
    'bitable-created': '飞书表格已创建',
    'video-generating': '正在生成视频',
    'completed': '已完成',
  };

  const lines: string[] = [];
  lines.push(`[当前 AIGC 项目]`);
  lines.push(`- 名称: ${project.name}`);
  lines.push(`- slug: ${project.slug}`);
  lines.push(`- 阶段: ${STATUS_LABEL[project.status]}`);
  lines.push(`- 项目目录: ~/.kunpeng/aigc-memory/projects/${project.id}/`);
  lines.push(`- 视频引擎: ${project.videoEngine === 'dreamina' ? '即梦（非真人） — dreamina multimodal2video' : 'rhtv (RunningHub seedance2.0)'}`);

  if (project.sources.length > 0) {
    const names = project.sources.map((s) => s.name.split('/').pop() || s.name).join(', ');
    lines.push(`- 已上传文档: ${names}`);
  } else {
    lines.push(`- 已上传文档: （无）`);
  }

  const { shots, scenes, assets, videosCompleted } = project.stats;
  lines.push(`- 进度: 分镜 ${shots} · 场景图 ${scenes} · 资产图 ${assets} · 视频已完成 ${videosCompleted}`);

  if (project.bitable?.url) {
    lines.push(`- 飞书多维表格: ${project.bitable.url}`);
  }

  lines.push('');
  lines.push('当用户在对话中提到"当前项目""这个项目""继续做镜头 N"等指代时，默认指向上述项目；');
  lines.push('读取/写入项目数据请使用 `~/.kunpeng/aigc-memory/projects/<id>/` 下对应子目录（sources/parsed/prompts/scenes/assets）。');

  return lines.join('\n');
}

// DeepSeek Harness runs outlive individual view components. Canvas/workshop/
// editor drawers are remounted while the shared chat store keeps streaming,
// so cancellation cannot be owned only by one hook instance's refs.
const sharedDshBridges = new Map<string, DshBridge>();

function registerSharedDshBridge(agentId: string, bridge: DshBridge): void {
  sharedDshBridges.set(agentId, bridge);
}

function unregisterSharedDshBridge(agentId: string, bridge: DshBridge): void {
  if (sharedDshBridges.get(agentId) === bridge) sharedDshBridges.delete(agentId);
}

function getSharedDshBridge(agentId: string): DshBridge | null {
  const exact = sharedDshBridges.get(agentId);
  if (exact) return exact;
  // A remounted drawer can temporarily lose its local Agent identity while
  // the shared chat store still owns one active stream. Falling back is safe
  // only when there is exactly one candidate; never stop an arbitrary run.
  return sharedDshBridges.size === 1
    ? sharedDshBridges.values().next().value ?? null
    : null;
}

/**
 * useAgent — Agent 生命周期管理 Hook
 * 替代原有的 useGateway + useSessions 中的消息发送逻辑
 */
export function useAgent(options?: { primary?: boolean }) {
  // Secondary instances (skill wizard) get their own coordinators but must
  // NOT own session-level duties: restoring the chat session into their
  // coordinator, registering the global restore callback (would hijack the
  // primary instance's session switching), or persisting their short
  // wizard-scoped history into the real session file.
  const isPrimary = options?.primary !== false;
  const glmClientRef = useRef<GLMClient | null>(null);
  const coordinatorRef = useRef<AgentCoordinator | null>(null);
  // Tier 4: per-agent coordinators. Each agent gets its own coordinator so
  // two agents can run concurrent streams. `coordinatorRef` tracks the active
  // one (most recently used or the one matching the current agent) so legacy
  // call sites (e.g. abort/switchCwd) keep working.
  const coordinatorsRef = useRef<Map<string, AgentCoordinator>>(new Map());
  const dshBridgesRef = useRef<Map<string, DshBridge>>(new Map());
  const activeRunIdsRef = useRef<Map<string, string>>(new Map());
  /** Session locked by the currently in-flight UI run (serialized by
   * sendingRef, so at most one). Read by session-scoped tool getters. */
  const activeRunSessionRef = useRef<string | null>(null);
  /** Coordinators/bridges whose teardown was deferred because a settings
   * change (e.g. clearing every provider key) fired the engine effect's
   * cleanup while they were mid-run. Drained once their runs finish. */
  const deferredTeardownRef = useRef<Array<{ getIsRunning: () => boolean; abort: () => unknown }>>([]);
  const drainDeferredTeardown = () => {
    const pending = deferredTeardownRef.current;
    if (!pending.length) return;
    deferredTeardownRef.current = pending.filter((entry) => {
      if (entry.getIsRunning()) return true;
      try {
        entry.abort();
      } catch {
        /* best effort */
      }
      return false;
    });
  };
  const coordinatorFactoryRef = useRef<((agentId: string) => AgentCoordinator) | null>(null);
  // Latest coordinator config — resolved by the agent (sub-agent) tool at
  // execute time so dispatched sub-agents don't inherit a stale closure.
  const latestCoordinatorConfigRef = useRef<ConstructorParameters<typeof AgentCoordinator>[0] | null>(null);
  const baseCustomRulesRef = useRef<string | undefined>(undefined);
  const skillLoaderRef = useRef<SkillLoader | null>(null);
  const mcpManagerRef = useRef<McpManager | null>(null);
  const toolExecutionsRef = useRef<ToolExecution[]>([]);
  const userAbortedRef = useRef(false); // guards against double-cleanup after user abort
  const activeRunTokenRef = useRef(0);
  const lastUiSendRef = useRef<{ content: string; at: number } | null>(null);
  // Serializes session restores: a slow restore (LLM compact inside
  // restoreMessages) must not overwrite a newer one.
  const restoreSeqRef = useRef(0);
  // Closes the sendMessage startup window: between the isRunning check and
  // coordinator.run() there are awaits (session ensure, Kimi media upload)
  // during which a second send would start a competing run on the same
  // coordinator and silently drop the first message.
  const sendingRef = useRef(false);
  const [isReady, setIsReady] = useState(false);

  // Hermes-style self-evolution: every finished run appends a compact
  // trajectory record, then maybe fires a background reflection pass.
  // Best-effort — never blocks or breaks the foreground run.
  const recordRunTrajectory = useCallback(
    (status: 'done' | 'failed' | 'aborted', req: string, startTime: number | null) => {
      try {
        const tools: Record<string, number> = {};
        const fail: Record<string, number> = {};
        for (const te of toolExecutionsRef.current) {
          tools[te.toolName] = (tools[te.toolName] || 0) + 1;
          if (te.status === 'error') fail[te.toolName] = (fail[te.toolName] || 0) + 1;
        }
        void recordTrajectory({
          ts: Date.now(),
          req: req.slice(0, 160),
          tools,
          fail,
          secs: startTime ? Math.max(0, Math.floor((Date.now() - startTime) / 1000)) : 0,
          status,
        })
          .then(() => maybeEvolve())
          .catch(() => {});
      } catch { /* evolution is best-effort */ }
    },
    [],
  );

  const { persistMessages } = useSessions();

  const addMessage = useChatStore((s) => s.addMessage);
  const setIsStreaming = useChatStore((s) => s.setIsStreaming);
  const clearStreamingContent = useChatStore((s) => s.clearStreamingContent);
  const setStreamingPhase = useChatStore((s) => s.setStreamingPhase);
  const setStreamingSessionId = useChatStore((s) => s.setStreamingSessionId);
  const setSessionStreaming = useChatStore((s) => s.setSessionStreaming);
  const startStreaming = useChatStore((s) => s.startStreaming);
  const setError = useChatStore((s) => s.setError);

  const glmApiKey = useSettingsStore((s) => resolveApiKey(s, 'glm', s.glmApiKey));
  const providerGlmApiKey = useSettingsStore((s) => resolveApiKey(s, 'provider:glm', s.providerApiKeys?.glm ?? ''));
  const credentials = useSettingsStore((s) => s.credentials);
  const credentialRefs = useSettingsStore((s) => s.credentialRefs);
  const glmBaseUrl = useSettingsStore((s) => s.glmBaseUrl);
  const glmModel = useSettingsStore((s) => s.glmModel);
  const defaultCwd = useSettingsStore((s) => s.defaultCwd);
  const maxTurns = useSettingsStore((s) => s.maxTurns);
  const providerApiKeys = useSettingsStore((s) => s.providerApiKeys);
  const imageSlotsSig = useSettingsStore((s) =>
    JSON.stringify([
      (s.imageApiSlots ?? []).map(x => [x.label, x.baseUrl, x.apiKey, x.credentialId, x.provider, x.enabled]),
      s.credentials,
    ]),
  );
  const runninghubApiKey = useSettingsStore((s) => resolveApiKey(s, 'runninghub', s.runninghubApiKey));
  const chatImageModel = useSettingsStore((s) => s.chatImageModel);
  const chatVideoModel = useSettingsStore((s) => s.chatVideoModel);
  const hasConfiguredChatProvider = hasAnyChatProviderKey({ glmApiKey, providerApiKeys, credentials, credentialRefs });

  // Initialize agent engine
  useEffect(() => {
    if (!hasConfiguredChatProvider) {
      setIsReady(false);
      return;
    }

    let cancelled = false;
    let unregisterGenHook: (() => void) | null = null;
    let unregisterCleanup: (() => void) | null = null;

    const initializeAgentEngine = async () => {
      const markStage = (stage: string) => agentLog.info('AgentInit', stage);
      markStage('开始初始化 Agent 引擎');
      // Get home dir from Tauri backend (process.env.HOME is not available in WebView)
      let homeDir = '~';
      try {
        homeDir = await invoke<string>('get_home_dir');
      } catch {
        agentLog.warn('Agent', 'Failed to get home dir from Tauri');
      }

      if (cancelled) return;

      // Sync API keys to disk files read by skill scripts (keys must NOT be
      // embedded into system prompts — they'd persist into chat history).
      markStage('正在同步本地模型配置');
      {
        const settingsSnapshot = useSettingsStore.getState();
        await Promise.all([
          syncImageSlotsFile(settingsSnapshot),
          syncRunninghubKeyFile(settingsSnapshot),
        ]);
      }
      markStage('本地模型配置同步完成');

      // Load skills first so we can inject descriptions into system prompt
      markStage('正在加载技能库');
      const loader = new SkillLoader([
        `${homeDir}/.kunpeng/skills`,
        `${homeDir}/kunpeng/skills`,
      ]);
      skillLoaderRef.current = loader;
      await loader.loadAll();
      agentLog.info('Agent', `Loaded ${loader.getAll().length} skills`);
      markStage('技能库加载完成');

      // Memory seeding is maintenance work, not a readiness dependency. Large
      // existing memory libraries can take seconds to inspect on slower disks;
      // keeping this off the critical path prevents the whole Agent UI from
      // appearing disconnected while those files are checked.
      markStage('正在后台维护项目记忆');
      setTimeout(() => {
        void ensureMemoryDirs()
          .then(() => agentLog.info('AgentInit', '项目记忆后台维护完成'))
          .catch((err) => agentLog.warn('AgentInit', `项目记忆后台维护失败：${String(err)}`));
      }, 15_000);

      // Register post-generation logging hook
      unregisterGenHook = registerHook('postToolUse', async (ev) => {
        if (ev.toolName === 'canvas_add_node') {
          const data = ev.params?.data as Record<string, unknown> | undefined;
          if (data?.generatedImageUrl || data?.generatedVideoUrl) {
            await appendGenerationLog({
              timestamp: new Date().toISOString(),
              director: '',
              taskType: data.type === 'image' ? 'text-to-image' : 'text-to-video',
              engine: 'other',
              prompt: '',
              outputPath: String(data.generatedImageUrl || data.generatedVideoUrl || ''),
            }).catch(() => {});
          }
        }
      });

      if (cancelled) return;

      // Create GLM client
      const client = new GLMClient({
        apiKey: glmApiKey || providerGlmApiKey || '__kunpeng_no_glm_key__',
        baseUrl: glmBaseUrl || 'https://open.bigmodel.cn/api/anthropic',
        model: glmModel || 'glm-5.1',
      });
      glmClientRef.current = client;

      // Create tool registry (built-in tools only — MCP loads later)
      const registry = createDefaultRegistry();

      // Register background task tool (for async dreamina polling).
      // Session getters prefer the session locked by the in-flight run:
      // a view/session switch mid-run must not redirect tool writes (todos,
      // background tasks) into the newly opened session.
      registry.register(createBackgroundTaskTool(
        () => activeRunSessionRef.current || useChatStore.getState().currentSessionId || '',
        (task) => useBackgroundTaskStore.getState().addTask(task),
      ));

      // Tier 3: todo list tool (needs session id)
      registry.register(createTodoWriteTool(
        () => activeRunSessionRef.current || useChatStore.getState().currentSessionId || '',
      ));

      // Ensure workspace exists and get today's workspace path
      let workspace = '';
      markStage('正在准备工作区');
      try {
        workspace = await invoke<string>('ensure_workspace');
        agentLog.info('Agent', `Workspace: ${workspace}`);
      } catch {
        agentLog.warn('Agent', 'Failed to create workspace');
      }
      markStage('工作区准备完成');

      // Load layered memory: global (~/.kunpeng/) + project ({cwd}/.kunpeng/)
      const ruleParts: string[] = [];

      // 1. Global rules: ~/.kunpeng/AGENT.md or ~/.kunpeng/CLAUDE.md
      markStage('正在读取全局 Agent 规则');
      try {
        for (const filename of ['AGENT.md', 'CLAUDE.md']) {
          const path = `${homeDir}/.kunpeng/${filename}`;
          try {
            const result = await invokeWithStartupTimeout<{ content: string }>('read_file', { path });
            const content = result.content.replace(/^\s*\d+\t/gm, '');
            if (content.trim()) {
              ruleParts.push(content);
              agentLog.info('Agent', `Loaded global rules from ${path} (${content.length} chars)`);
              break; // Use first found
            }
          } catch {
            // File doesn't exist, try the next supported global rule name.
          }
        }
      } catch {
        agentLog.warn('Agent', 'Failed to load global rules');
      }
      markStage('全局 Agent 规则读取完成');

      // 2. Project-level rules: {cwd}/.kunpeng/CLAUDE.md
      const cwd = workspace || defaultCwd || homeDir;
      markStage('正在读取项目 Agent 规则');
      try {
        const projectPaths = [
          `${cwd}/.kunpeng/CLAUDE.md`,
          `${cwd}/.kunpeng/AGENT.md`,
          `${cwd}/CLAUDE.md`,
        ];
        for (const projectPath of projectPaths) {
          try {
            const content = await invokeWithStartupTimeout<{ content: string }>(
              'read_file',
              { path: projectPath },
            );
            if (content?.content?.trim()) {
              // Strip line numbers (read_file returns cat -n format)
              const raw = content.content.replace(/^\s*\d+\t/gm, '');
              ruleParts.push(`\n## 项目规则 (${projectPath})\n${raw}`);
              agentLog.info('Agent', `Loaded project rules from ${projectPath}`);
              break;
            }
          } catch {
            // File doesn't exist, try next
          }
        }
      } catch {
        agentLog.warn('Agent', 'Failed to load project rules');
      }
      markStage('项目 Agent 规则读取完成');

      const normalizedRules = normalizeCustomRules(ruleParts.join('\n\n'));
      if (normalizedRules.notices.length > 0) {
        agentLog.warn('Agent', `Custom rule compatibility: ${normalizedRules.notices.join(' ')}`);
      }
      const customRules = [
        normalizedRules.notices.length > 0
          ? `## 自定义规则兼容说明\n${normalizedRules.notices.map((notice) => `- ${notice}`).join('\n')}`
          : '',
        normalizedRules.rules,
      ].filter(Boolean).join('\n\n') || undefined;
      baseCustomRulesRef.current = customRules;

      // Factory — lazily builds a coordinator for a given agent id.
      // Closes over the shared client/registry/workspace/customRules so
      // additional agents are cheap to spin up (no duplicated skill load).
      const shellEnv = await getShellInfo();
      const buildCoordinator = (agentId: string): AgentCoordinator => {
        const settings = useSettingsStore.getState();
        const meta = settings.agentMetas[agentId];
        const globalOutputStyle = settings.outputStyle;
        const mergedRules = buildAgentCustomRules(customRules, settings, agentId);

        const coordinatorConfig = {
          glmClient: client,
          toolRegistry: registry,
          cwd,
          os: osDisplayName(shellEnv.platform),
          shell: shellEnv.shell,
          maxTurns: maxTurns || 30,
          workspace: workspace || undefined,
          skillDescriptions: loader.getDescriptionText({
            activeView: useChatStore.getState().activeView,
          }) || undefined,
          skillDescriptionResolver: (query: string) => loader.getDescriptionText({
            activeView: useChatStore.getState().activeView,
            query,
          }) || undefined,
          // Query-dependent relevance goes to a transient attachment, not the
          // system prompt — keeps the cached prefix byte-stable across turns.
          skillNoticeResolver: (query: string) =>
            buildSkillRelevanceNotice(loader.getAll(), {
              activeView: useChatStore.getState().activeView,
              query,
            }),
          customRules: mergedRules,
          routeStrategy: buildRouteStrategyFromSettings(settings, glmApiKey, meta?.preferredProviderId),
          outputStyle: meta?.outputStyle ?? globalOutputStyle ?? 'default',
          imageApiContext: buildImageApiContext(settings),
          runninghubContext: buildRunninghubContext(settings),
          aigcMemoryContext: buildAigcProjectContext(useAigcProjectStore.getState().getCurrent()),
        };

        const c = new AgentCoordinator(coordinatorConfig);
        // Keep the latest coordinator config visible to the agent tool getter.
        latestCoordinatorConfigRef.current = coordinatorConfig;

        return c;
      };

      coordinatorFactoryRef.current = buildCoordinator;

      // Create the default 'main' coordinator eagerly so existing single-agent
      // flows keep working unchanged.
      const defaultAgentId = 'main';
      const defaultCoordinator = buildCoordinator(defaultAgentId);
      coordinatorsRef.current.set(defaultAgentId, defaultCoordinator);
      coordinatorRef.current = defaultCoordinator;

      // Register cleanup for window close: persist all coordinator state
      unregisterCleanup = registerCleanup(() => {
        const state = useChatStore.getState();
        const sid = state.currentSessionId;
        if (!sid) return;
        // Persist UI messages from Zustand to localStorage
        if (state.messages.length > 0) {
          try { safeLocalStorage.setItem('kunpeng-messages-' + sid, JSON.stringify(state.messages)); } catch { /* quota */ }
        }
        // Persist coordinator messages
        for (const [agentId, c] of coordinatorsRef.current.entries()) {
          const msgs = compactAgentMessagesForStorage(c.getMessages());
          if (msgs.length <= 1) continue;
          const parts = sid.split(':');
          const sAgentId = parts.length >= 3 ? parts[1] : 'main';
          if (sAgentId === agentId) {
            try { safeLocalStorage.setItem('kunpeng-agent-messages-' + sid, JSON.stringify(msgs)); } catch { /* quota */ }
          }
        }
        // Update session timestamp
        try {
          const updated = state.sessions.map(s =>
            s.id === sid ? { ...s, updatedAt: Date.now() } : s
          );
          safeLocalStorage.setItem('kunpeng-sessions', JSON.stringify(updated));
          void writeSessionIndex(updated);
        } catch { /* quota */ }
        // Mirror to per-session file (file is the source of truth on reload).
        try {
          const activeAgentId = (sid.split(':').length >= 3 ? sid.split(':')[1] : 'main');
          const activeCoord = coordinatorsRef.current.get(activeAgentId);
          const agentMessages = activeCoord ? activeCoord.getMessages() : [];
          void flushAgentMessages(sid, agentMessages);
        } catch { /* ignore */ }
      });

      // Restore AgentMessage[] from the current active session (if any).
      // Primary instance only — a secondary (wizard) engine restoring the
      // chat session into its own coordinator is wasted work and double IO.
      const currentSessionId = useChatStore.getState().currentSessionId;
      if (isPrimary && currentSessionId) {
        markStage('正在恢复当前会话');
        let saved = loadAgentMessages(currentSessionId);
        if (saved === null) {
          const fromFile = await readSessionFromFile(currentSessionId);
          if (fromFile) {
            hydrateLocalStorageSession(currentSessionId, fromFile);
            saved = fromFile.agentMessages;
          } else {
            saved = [];
          }
        }
        if (saved.length > 0) {
          let uiMsgs = readMessagesFromLocalStorage(currentSessionId);
          if (uiMsgs === null) {
            const fromFile = await readSessionFromFile(currentSessionId);
            uiMsgs = fromFile?.messages ?? [];
          }
          const recovered = recoverDegradedAgentHistory(saved, uiMsgs);
          await defaultCoordinator.restoreMessages(recovered);
          if (recovered !== saved) {
            saveAgentMessages(currentSessionId, recovered);
            agentLog.warn('Agent', `Rebuilt degraded compacted history from ${uiMsgs.length} visible messages for ${currentSessionId}`);
          } else {
            agentLog.info('Agent', `Restored ${saved.length} agent messages for session ${currentSessionId}`);
          }
        } else {
          // Fallback: rebuild from UI messages if agent-messages was lost
          let uiMsgs = readMessagesFromLocalStorage(currentSessionId);
          if (uiMsgs === null) {
            const fromFile = await readSessionFromFile(currentSessionId);
            uiMsgs = fromFile?.messages ?? [];
          }
          if (uiMsgs.length > 0) {
            const projected = projectUIMessagesToAgentMessages(uiMsgs);
            if (projected.length > 0) {
              await defaultCoordinator.restoreMessages(projected);
              agentLog.warn('Agent', `Rebuilt ${projected.length} agent msgs from UI for session ${currentSessionId}`);
            }
          }
        }
        markStage('当前会话恢复完成');
      }

      // Ready immediately with built-in tools — no waiting for MCP
      setIsReady(true);
      agentLog.info('Agent', 'Engine initialized (built-in tools)');

      // Non-blocking: load MCP tools in background
      if (MCP_SERVERS.length > 0 && (glmApiKey || providerGlmApiKey)) {
        const mcpManager = new McpManager(MCP_SERVERS);
        mcpManagerRef.current = mcpManager;
        mcpManager.initialize(glmApiKey || providerGlmApiKey).then(({ tools: mcpTools, errors: mcpErrors }) => {
          if (cancelled) { mcpManager.shutdown(); return; }
          for (const tool of mcpTools) {
            registry.register(tool);
          }
          // Refresh system prompt so ALL coordinators pick up new MCP tools
          for (const c of coordinatorsRef.current.values()) {
            c.refreshSystemPrompt();
          }
          agentLog.info('Agent', `MCP: ${mcpTools.length} tools loaded${mcpErrors.length > 0 ? `, ${mcpErrors.length} errors` : ''}`);
        }).catch((err) => {
          agentLog.error('Agent', 'MCP initialization failed', err);
        });
      }
    };

    void initializeAgentEngine().catch((error) => {
      if (cancelled) return;
      const reason = error instanceof Error ? error.message : String(error);
      agentLog.error('AgentInit', `Agent 引擎初始化失败: ${reason}`, error);
      setIsReady(false);
      setError(`Agent 初始化失败：${reason}`);
    });

    return () => {
      cancelled = true;
      unregisterGenHook?.();
      unregisterCleanup?.();
      // Persist coordinator state to localStorage before abort
      const cleanupState = useChatStore.getState();
      const cleanupSid = cleanupState.currentSessionId;
      if (cleanupSid) {
        const cleanupCoordinator = coordinatorRef.current;
        if (cleanupCoordinator) {
          const msgs = compactAgentMessagesForStorage(cleanupCoordinator.getMessages());
          if (msgs.length > 1) {
            try { safeLocalStorage.setItem(AGENT_MSGS_PREFIX + cleanupSid, JSON.stringify(msgs)); } catch { /* quota */ }
          }
        }
        if (cleanupState.messages.length > 0) {
          try { safeLocalStorage.setItem('kunpeng-messages-' + cleanupSid, JSON.stringify(cleanupState.messages)); } catch { /* quota */ }
        }
      }
      // Abort every per-agent coordinator, not just the active one — EXCEPT
      // when this cleanup was triggered by a settings change (e.g. the user
      // cleared all provider keys) rather than a real unmount: tearing down
      // mid-run would kill an active task. Recompute the flag from the store;
      // on unmount the keys are still there, on key-clear they are gone.
      const settingsNow = useSettingsStore.getState();
      const isRealUnmount = hasAnyChatProviderKey(settingsNow);
      for (const c of coordinatorsRef.current.values()) {
        if (!isRealUnmount && c.getIsRunning()) deferredTeardownRef.current.push(c);
        else c.abort();
      }
      for (const bridge of dshBridgesRef.current.values()) {
        for (const [agentId, shared] of sharedDshBridges) {
          if (shared === bridge) unregisterSharedDshBridge(agentId, bridge);
        }
        if (!isRealUnmount && bridge.getIsRunning()) deferredTeardownRef.current.push(bridge);
        else void bridge.abort();
      }
      dshBridgesRef.current.clear();
      coordinatorsRef.current.clear();
      coordinatorFactoryRef.current = null;
      baseCustomRulesRef.current = undefined;
      mcpManagerRef.current?.shutdown();
    };
  // LLM/model routing is resolved from the latest settings immediately before
  // every run. Do not rebuild the entire Agent engine when the user changes
  // provider/model/fallback order: cleanup aborts all coordinators and creates
  // a short but user-visible "API unavailable" race. Structural engine inputs
  // still rebuild normally.
  }, [hasConfiguredChatProvider]);

  // Provider keys, generation defaults and prompt contexts are hot settings.
  // Applying them must never tear down an active coordinator or Harness run.
  useEffect(() => {
    if (!hasConfiguredChatProvider) return;
    const settings = useSettingsStore.getState();
    void Promise.all([
      syncImageSlotsFile(settings),
      syncRunninghubKeyFile(settings),
    ]).catch((error) => agentLog.warn('Agent', `同步模型配置失败：${String(error)}`));
    for (const [agentId, coordinator] of coordinatorsRef.current) {
      const meta = settings.agentMetas[agentId];
      coordinator.setRuntimePromptConfig({
        customRules: buildAgentCustomRules(baseCustomRulesRef.current, settings, agentId),
        outputStyle: meta?.outputStyle ?? settings.outputStyle ?? 'default',
        imageApiContext: buildImageApiContext(settings),
        runninghubContext: buildRunninghubContext(settings),
        maxTurns: settings.maxTurns || 30,
      });
    }
    drainDeferredTeardown();
  }, [hasConfiguredChatProvider, imageSlotsSig, runninghubApiKey, chatImageModel, chatVideoModel, maxTurns]);

  // Update GLM client config when settings change
  useEffect(() => {
    if (glmClientRef.current && glmApiKey) {
      glmClientRef.current.updateConfig({
        apiKey: glmApiKey,
        baseUrl: glmBaseUrl || 'https://open.bigmodel.cn/api/anthropic',
        model: glmModel || 'glm-5.1',
      });
    }
  }, [glmApiKey, glmBaseUrl, glmModel]);

  // Push current AIGC project context into every coordinator's system prompt.
  // Re-runs whenever the user selects a different project or the project's
  // sources / stats / status change.
  useEffect(() => {
    const apply = () => {
      const project = useAigcProjectStore.getState().getCurrent();
      const context = buildAigcProjectContext(project);
      for (const c of coordinatorsRef.current.values()) {
        c.setAigcMemoryContext(context);
      }
    };
    apply();
    const unsub = useAigcProjectStore.subscribe(apply);
    return () => unsub();
  }, []);

  // 联网搜索开关切换时刷新各 coordinator 的系统提示词，
  // 让系统提示词里的工具清单同步增删 web_search（工具可见性本身由
  // getDefinitions per-turn 门控，此处仅同步提示词文本）。
  useEffect(() => {
    let prev = useSettingsStore.getState().webSearchEnabled;
    const unsub = useSettingsStore.subscribe((s) => {
      if (s.webSearchEnabled !== prev) {
        prev = s.webSearchEnabled;
        for (const c of coordinatorsRef.current.values()) c.refreshSystemPrompt();
      }
    });
    return () => unsub();
  }, []);

  /** 发送消息 */
  const sendMessage = useCallback(
    async (content: string, filePaths?: string[]) => {
      // Tier 4: pick the coordinator for the CURRENT agent. Lazy-init on first
      // use so non-main agents get their own coordinator only when actually
      // invoked. The factory closes over shared client/registry/skills, so
      // this is cheap.
      const currentAgentId = useChatStore.getState().currentAgent?.id || 'main';
      let coordinator = coordinatorsRef.current.get(currentAgentId);
      if (!coordinator && coordinatorFactoryRef.current) {
        coordinator = coordinatorFactoryRef.current(currentAgentId);
        coordinatorsRef.current.set(currentAgentId, coordinator);
        agentLog.info('Agent', `Spawned coordinator for agent ${currentAgentId}`);
      }
      if (!coordinator) {
        setError('Agent 引擎未初始化，请检查 API Key 设置');
        return;
      }
      // Secondary (wizard) engines share the global chat stores but must not
      // write session files — their coordinators hold wizard-scoped history
      // that would overwrite the real chat session's agent history on disk.
      const persistUiMessages: typeof persistMessages = isPrimary ? persistMessages : () => {};
      const displayContent = stripHarnessPrefix(content);
      const activeDsh = dshBridgesRef.current.get(currentAgentId);
      if (activeDsh) {
        const pathPrefix = filePaths?.length
          ? `[用户补充了以下文件]\n${filePaths.map((path) => `- ${path}`).join('\n')}\n\n`
          : '';
        // queueGuidance 返回 false 只有一种情况：bridge 已 abort（运行刚结束）。
        // 此时不能把消息静默丢掉，也不能让它落进已失效的桥——清掉失效桥，
        // 按新任务走正常启动路径。bridge 在 ref 里存在即视为任务存活，
        // 绝不在它活着时并行起第二个 Harness 进程（并行抢同一工具桥）。
        if (activeDsh.queueGuidance(`${pathPrefix}${displayContent}`)) {
          const sessionId = useChatStore.getState().currentSessionId;
          addMessage({
            id: randomUUID(),
            role: 'user',
            content: displayContent,
            filePaths: filePaths?.length ? filePaths : undefined,
            timestamp: Date.now(),
          });
          persistUiMessages(sessionId ?? undefined);
          return;
        }
        if (dshBridgesRef.current.get(currentAgentId) === activeDsh) {
          dshBridgesRef.current.delete(currentAgentId);
        }
      }
      if (coordinator.getIsRunning()) {
        const pathPrefix = filePaths?.length
          ? `[用户补充了以下文件]\n${filePaths.map((path) => `- ${path}`).join('\n')}\n\n`
          : '';
        const queued = coordinator.queueGuidance(`${pathPrefix}${displayContent}`);
        if (!queued) return;
        const sessionId = useChatStore.getState().currentSessionId;
        addMessage({
          id: randomUUID(),
          role: 'user',
          content: displayContent,
          filePaths: filePaths?.length ? filePaths : undefined,
          timestamp: Date.now(),
        });
        persistUiMessages(sessionId ?? undefined);
        return;
      }

      // Reset abort guard only when starting a genuinely new run. Doing this
      // for mid-run guidance would invalidate the active run's callbacks.
      setError(null);
      const settings = useSettingsStore.getState();
      const surface = inferAgentWorkspaceScope(content);
      const workspaceSelection = surface
        ? decodeChatModel(settings.workspaceAgentModels[surface])
        : null;
      const agentMeta = settings.agentMetas[currentAgentId];
      const routeStrategy = buildRouteStrategyFromSettings(
        settings,
        resolveApiKey(settings, 'glm', settings.glmApiKey),
        agentMeta?.preferredProviderId,
        workspaceSelection,
      );
      const primaryRoute = getPrimaryRouteSelection(routeStrategy);
      const usingHarness = primaryRoute.providerId === 'deepseek' && settings.deepseekEngine !== 'builtin';
      let executingHarness = usingHarness;
      coordinator.setRouteStrategy(routeStrategy);
      // Make this the "active" coordinator so abort/switchCwd/agent-tool
      // relay target the right instance.
      coordinatorRef.current = coordinator;

      // Check for slash commands. Drawer wrappers (canvas/workshop/editor)
      // prepend a "[用户正在…]\n\n" context prefix — strip it so /auto etc.
      // work from every chat surface.
      const now = Date.now();
      const lastSend = lastUiSendRef.current;
      if (lastSend && lastSend.content === displayContent && now - lastSend.at < 5000) {
        agentLog.warn('Agent', 'Dropped duplicate UI send within 5s');
        return;
      }
      lastUiSendRef.current = { content: displayContent, at: now };
      // Close the startup race: from here until coordinator.run() starts there
      // are awaits (slash command, session ensure, Kimi media upload) during
      // which a second sendMessage would start a competing run on the same
      // coordinator — dropping the first message's final reply. Released in
      // the run's finally and on the early-return paths below.
      if (sendingRef.current) {
        agentLog.warn('Agent', 'Dropped concurrent send during startup window');
        return;
      }
      sendingRef.current = true;
      // Bump the run token only AFTER the duplicate/concurrent guards above.
      // Doing it earlier meant a dropped second send still invalidated the
      // active run's token — silencing all its callbacks, losing its final
      // reply, and leaving its run stuck in 'running'.
      userAbortedRef.current = false;
      const runToken = ++activeRunTokenRef.current;
      const isCurrentRun = () => activeRunTokenRef.current === runToken && !userAbortedRef.current;
      const cmdText = displayContent;
      if (cmdText.startsWith('/')) {
        let result: Awaited<ReturnType<typeof executeCommand>>;
        try {
          result = await executeCommand(cmdText, {
            coordinator,
            addSystemMessage: (msg) => {
              addMessage({
                id: randomUUID(),
                role: 'system',
                content: msg,
                timestamp: Date.now(),
              });
            },
            skillLoader: skillLoaderRef.current || undefined,
            mcpManager: mcpManagerRef.current || undefined,
            toolRegistry: coordinator.getToolRegistry(),
            apiKey: glmApiKey || undefined,
          });
        } catch (err) {
          sendingRef.current = false;
          throw err;
        }

        if (result.handled) {
          sendingRef.current = false;
          // Add command output as system message
          if (result.output) {
            addMessage({
              id: randomUUID(),
              role: 'assistant',
              content: result.output,
              timestamp: Date.now(),
            });
          }
          return;
        }
      }

      // A drawer and the main chat are two views of the same task. Recover a
      // temporarily lost active session before creating anything new.
      try {
        await ensureActiveConversationSessionRaw();
      } catch (err) {
        sendingRef.current = false;
        throw err;
      }

      // Lock sessionId now — any view switch after this point must NOT change
      // which session we write to. All persist/streaming callbacks use this value.
      const sessionId = useChatStore.getState().currentSessionId;
      activeRunSessionRef.current = sessionId;

      // Add user message to UI
      addMessage({
        id: randomUUID(),
        role: 'user',
        content: displayContent,
        filePaths: filePaths?.length ? filePaths : undefined,
        timestamp: Date.now(),
      });
      if (sessionId) {
        const attachmentTitle = filePaths?.[0] ? `查看 ${filePaths[0].split('/').pop() || '附件'}` : '新任务';
        ensureSessionTitleRaw(sessionId, displayContent || attachmentTitle);
      }

      // Atomic: reset content + set phase='waiting' + set isStreaming=true in ONE set() call
      // so React sees consistent state in a single re-render.
      const startTime = Date.now();
      startStreaming(sessionId);
      emit('agent-status-change', 'working');
      toolExecutionsRef.current = [];
      const runId = useRunStepStore.getState().startRun({
        sessionId: sessionId || 'unknown',
        userRequest: displayContent,
        modelProvider: primaryRoute.providerId,
        modelId: primaryRoute.modelId,
      });
      activeRunIdsRef.current.set(currentAgentId, runId);

      // Yield one frame so "正在思考..." renders before the network call
      await new Promise((r) => requestAnimationFrame(r));

      persistUiMessages(sessionId ?? undefined);

      // Snapshot cheaply here; compaction/stringify/disk IPC are coalesced and
      // run during browser idle time by agentMessagesSaveQueue.
      const persistAgentMsgs = () => {
        if (isPrimary && sessionId && coordinator) {
          saveAgentMessages(sessionId, coordinator.getMessages());
        }
      };

      let accumulatedText = '';
      let accumulatedThinking = '';
      let accumulatedSubAgent = '';
      let pendingLastTextAt: number | null = null;
      // Context-usage pill: only push a store update when the estimate moved
      // meaningfully — estimateMessages is cached, but a fresh object identity
      // every frame would still re-render pill subscribers for no visual change.
      let lastStatsEstimated = -1;
      let lastStatsMax = -1;

      // 流式文本会触发 Markdown、执行链和多个抽屉重排。限制到约 12fps，
      // 保持可读的流式感，同时给画布拖拽、看图和提示词点击留出主线程时间。
      let flushTimerId: number | null = null;
      let pendingPhase: 'thinking' | 'streaming' | null = null;

      const flushToStore = () => {
        flushTimerId = null;
        // Ghost-write guard: after abort, a pending 80ms flush must not
        // resurrect streaming state that abort() just cleared.
        if (!isCurrentRun()) return;
        // ONE Zustand set() per frame — merges phase, content, thinking, lastTextAt, subAgent
        const update: Record<string, unknown> = {
          streamingThinkingContent: accumulatedThinking,
          streamingContent: accumulatedText,
        };
        if (pendingPhase) {
          update.streamingPhase = pendingPhase;
          pendingPhase = null;
        }
        if (pendingLastTextAt !== null) {
          update.streamingLastTextAt = pendingLastTextAt;
          pendingLastTextAt = null;
        }
        if (accumulatedSubAgent) {
          update.streamingSubAgentText = accumulatedSubAgent;
        }
        if (coordinator && !executingHarness) {
          const stats = coordinator.getContextStats();
          if (
            Math.abs(stats.estimatedTokens - lastStatsEstimated) >= 512
            || stats.maxTokens !== lastStatsMax
          ) {
            lastStatsEstimated = stats.estimatedTokens;
            lastStatsMax = stats.maxTokens;
            update.contextStats = stats;
          }
        }
        useChatStore.setState(update);
      };

      const scheduleFlush = () => {
        if (flushTimerId !== null) return;
        flushTimerId = window.setTimeout(flushToStore, 80);
      };

      const cancelFlush = () => {
        if (flushTimerId !== null) {
          window.clearTimeout(flushTimerId);
          flushTimerId = null;
        }
      };
      // ────────────────────────────────────────────────────────────────

      const callbacks: CoordinatorCallbacks = {
        onThinkingDelta: (text) => {
          if (!isCurrentRun()) return;
          accumulatedThinking += text;
          pendingPhase = 'thinking';
          scheduleFlush();
        },

        onTextDelta: (text) => {
          if (!isCurrentRun()) return;
          accumulatedText += text;
          pendingPhase = 'streaming';
          pendingLastTextAt = Date.now();
          scheduleFlush();
        },

        onProgressText: (text, displayText) => {
          if (!isCurrentRun()) return;
          const progress = displayText || text;
          const normalized = normalizeRunProgress(progress);
          if (normalized?.kind === 'context') {
            useRunStepStore.getState().upsertProgressUpdate('context', progress, runId);
          } else if (normalized) {
            useRunStepStore.getState().addProgressUpdate(progress, runId);
          }

          // The same text arrived through onTextDelta while the model was
          // streaming. Move it from the answer draft into the task log now
          // that the coordinator knows this turn continues with tools.
          if (text && accumulatedText.endsWith(text)) {
            accumulatedText = accumulatedText.slice(0, -text.length).trimEnd();
          }
          cancelFlush();
          flushToStore();
        },

        onToolBatchStart: (calls) => {
          if (!isCurrentRun()) return;
          useRunStepStore.getState().beginToolBatch(calls, runId);
        },

        onToolBatchEnd: (results) => {
          if (!isCurrentRun()) return;
          useRunStepStore.getState().finishToolBatch(results, runId);
        },

        onToolStart: (name, params) => {
          if (!isCurrentRun()) return;
          // Tool events are infrequent — flush immediately
          cancelFlush();
          flushToStore();
          useChatStore.setState({
            streamingPhase: 'processing',
            streamingToolName: name,
          });

          const execution: ToolExecution = {
            id: useRunStepStore.getState().startTool(name, params as Record<string, unknown>, runId) || randomUUID(),
            toolName: name,
            params: params as Record<string, unknown>,
            status: 'running',
            startTime: Date.now(),
          };
          toolExecutionsRef.current = [...toolExecutionsRef.current, execution];
        },

        onToolEnd: (name, result) => {
          if (!isCurrentRun()) return;
          useChatStore.setState({ streamingToolName: null });
          const running = [...toolExecutionsRef.current].reverse().find((te) =>
            te.toolName === name && te.status === 'running'
          );
          useRunStepStore.getState().finishTool(running?.id ?? null, result.success, result, runId);
          toolExecutionsRef.current = toolExecutionsRef.current.map((te) =>
            te.toolName === name && te.status === 'running'
              ? {
                  ...te,
                  status: result.success ? 'completed' : 'error',
                  result,
                  endTime: Date.now(),
                }
              : te,
          );
          persistAgentMsgs();
        },

        onComplete: (finalText) => {
          // If user already aborted, skip this callback — abort() already
          // cleaned up state and we don't want duplicate messages/notifications.
          if (!isCurrentRun()) return;

          // Cancel pending RAF and do a final sync flush
          cancelFlush();

          const duration = Math.floor((Date.now() - startTime) / 1000);
          // Add assistant message
          addMessage({
            id: randomUUID(),
            role: 'assistant',
            content: finalText || accumulatedText,
            thinkingContent: accumulatedThinking || undefined,
            timestamp: Date.now(),
            workingDuration: duration,
            metadata: {
              runId,
              ...(toolExecutionsRef.current.length > 0
                ? { toolExecutions: compactToolExecutionsForHistory(toolExecutionsRef.current) }
                : {}),
            },
          } as Message);

          persistUiMessages(sessionId ?? undefined);
          persistAgentMsgs();
          if (coordinator && !executingHarness) useChatStore.getState().setContextStats(coordinator.getContextStats());
          setIsStreaming(false);
          setStreamingSessionId(null);
          if (sessionId) setSessionStreaming(sessionId, false);
          clearStreamingContent();
          setStreamingPhase('idle');
          emit('agent-status-change', 'idle');
          useRunStepStore.getState().finishRun('done', runId);
          recordRunTrajectory('done', displayContent, startTime);

          // Tier 4: OS notification when window is unfocused. Skip very
          // short turns (<5s) — those are clearly already in front of the user.
          if (useSettingsStore.getState().notificationsEnabled && duration >= 5) {
            const preview = (finalText || accumulatedText).trim().slice(0, 80);
            void notify({
              title: `${useChatStore.getState().currentAgent?.name || '鲲鹏'} 已完成`,
              body: preview || '回复已生成',
            });
          }
        },

        onError: (error) => {
          // If user already aborted, skip this callback.
          if (!isCurrentRun()) return;

          cancelFlush();
          setError(error.message);
          persistUiMessages(sessionId ?? undefined);
          persistAgentMsgs();
          setIsStreaming(false);
          setStreamingSessionId(null);
          if (sessionId) setSessionStreaming(sessionId, false);
          clearStreamingContent();
          setStreamingPhase('idle');
          emit('agent-status-change', 'error');
          useRunStepStore.getState().finishRun('failed', runId);
          recordRunTrajectory('failed', displayContent, startTime);

          if (useSettingsStore.getState().notificationsEnabled) {
            void notify({
              title: `${useChatStore.getState().currentAgent?.name || '鲲鹏'} 出错了`,
              body: error.message.slice(0, 120),
            });
          }
        },

        onToolConfirm: (name, params, reason) => {
          // 自动执行模式：跳过确认弹窗（bashSecurity 的 deny 裁决在 coordinator
          // 层先于此回调，危险命令仍会被拦）
          if (useSettingsStore.getState().toolConfirmMode === 'auto') {
            return Promise.resolve(true);
          }
          return useToolConfirmStore.getState().requestConfirm(name, params, reason);
        },

        onSubAgentDelta: (text) => {
          if (!isCurrentRun()) return;
          accumulatedSubAgent += text;
          scheduleFlush();
        },

        onContextUsage: (stats) => {
          if (!isCurrentRun()) return;
          lastStatsEstimated = stats.estimatedTokens;
          lastStatsMax = stats.maxTokens;
          useChatStore.getState().setContextStats(stats);
        },

        onCompacting: () => {
          if (!isCurrentRun()) return;
          cancelFlush();
          flushToStore();
          persistAgentMsgs();
          useRunStepStore.getState().ensureSystemStep(
            '整理上下文',
            '正在整理较早的历史消息，避免重复内容拖慢后续操作。',
            runId,
          );
          useChatStore.setState({ streamingPhase: 'processing', streamingToolName: '整理上下文' });
        },

        // Unfinished-todo guard: when the model tries to end the turn while
        // the session's todo list still has open items, hand it one reminder
        // so multi-step tasks don't silently stop half-way (CC-style).
        shouldContinue: () => {
          if (!sessionId) return null;
          const todos = useTodoStore.getState().todosBySession[sessionId];
          if (!todos?.length) return null;
          const unfinished = todos.filter((t) => t.status !== 'completed');
          if (unfinished.length === 0) return null;
          const list = unfinished
            .map((t) => `- [${t.status === 'in_progress' ? '进行中' : '待处理'}] ${t.content}`)
            .join('\n');
          return (
            `[系统提醒] 你准备结束回复，但当前待办列表还有 ${unfinished.length} 项未完成：\n${list}\n` +
            '请继续完成这些事项；如果它们确实不需要做了，先用 todo_write 更新列表（标记完成或移除），再给出最终答复。'
          );
        },
      };

      // Periodic mid-stream snapshot. The global queue enforces the same
      // 15-second minimum across tool-completion bursts.
      const persistInterval = setInterval(persistAgentMsgs, 15000);
      try {
        // Prepend file paths to content so agent can see them
        let finalContent = content;
        if (filePaths?.length) {
          const pathList = filePaths.map(p => `- ${p}`).join('\n');
          finalContent = `[用户附加了以下文件，请根据需要读取]\n${pathList}\n\n${content}`;
        }
        let mediaBlocks: AgentUserContentBlock[] = [];
        if (primaryRoute.providerId === 'kimi' && filePaths?.length) {
          const media = await buildKimiMediaBlocks(filePaths, runId);
          mediaBlocks = media.blocks;
          if (media.notices.length) {
            finalContent += `\n\n[媒体输入状态]\n${media.notices.map((notice) => `- ${notice}`).join('\n')}`;
          }
        }
        if (usingHarness) {
          const bridge = new DshBridge();
          useDeepseekHarnessStore.getState().startRun(runId);
          dshBridgesRef.current.set(currentAgentId, bridge);
          registerSharedDshBridge(currentAgentId, bridge);
          try {
            const context = await coordinator.buildHarnessTurnContext(finalContent);
            const history = buildDshConversationContext(coordinator.getMessages());
            let input = context.turnContext
              ? `${context.turnContext}\n\n[用户请求]\n${finalContent}`
              : finalContent;
            if (filePaths?.length) mediaBlocks = await buildDshMediaBlocks(filePaths);
            // DeepSeek 视觉模型（deepseek-v4-flash-vision-exp 起）在 Harness
            // 里原生看图：fork 的 ACP 桥（dsh-runtime/kunpeng-acp.mjs）接受
            // image 块 → attachment store 持久化 → pi-ai 路由（模型声明
            // input:[text,image]，见 dsh.rs 的 llm-pi-ai 条目）。
            // 非视觉 DeepSeek 模型的带图轮次才改道内置通道（内置路径会把
            // 模型自动切到官方视觉模型，同供应商）。含视频附件的轮次一律
            // 留在 Harness 走分析/转写工具（视频块不进模型）。
            const hasImageMedia = mediaBlocks.some((block) => block.type === 'image');
            const hasVideoMedia = mediaBlocks.some((block) => block.type === 'video');
            const harnessModel = primaryRoute.modelId || settings.providerModels.deepseek || 'deepseek-v4-flash-vision-exp';
            const harnessVisionCapable = /vision/i.test(harnessModel);
            if (hasImageMedia && !hasVideoMedia && !harnessVisionCapable) {
              executingHarness = false;
              coordinator.setRouteStrategy(deepseekBuiltinRoute(primaryRoute.modelId));
              await coordinator.run(finalContent, callbacks, mediaBlocks);
            } else {
            // 视觉模型：图片以 ACP image 块原生进 Harness；非视觉模型或含
            // 视频时维持工具路径（图片块在 mediaFilter 丢 base64 前有 directive 指引）。
            const acpMediaBlocks: AgentUserContentBlock[] = harnessVisionCapable && !hasVideoMedia
              ? mediaBlocks
              : [];
            if (mediaBlocks.length > 0 && acpMediaBlocks.length === 0) {
              input += '\n\n[媒体附件说明] 当前执行引擎不能直接接收图片/视频内容块。'
                + '如需查看上方列出的图片，请调用 image_recognition 工具并传入对应文件路径；'
                + '视频请使用视频分析/转写工具处理。不要直接 read_file 读取图片/视频二进制。';
            } else if (hasImageMedia && acpMediaBlocks.length > 0) {
              // 原生视觉轮次：明确告知图片已直达，防止历史记忆里的
              // image_recognition 指引让模型重复识别。
              input += '\n\n[媒体附件说明] 图片已作为原生内容块直接传入，你能直接看到画面内容；'
                + '请直接看图回答，禁止再调用 image_recognition 做重复识别。';
            }
            const result = await bridge.run({
              runId,
              apiKey: resolveApiKey(settings, 'provider:deepseek', settings.providerApiKeys.deepseek || ''),
              baseUrl: settings.providerBaseUrls.deepseek || 'https://api.deepseek.com',
              model: harnessModel,
              // DSH exposes Kunpeng tools through its MCP bridge with a fixed
              // `mcp__kunpeng__` prefix (upstream naming invariant, cannot be
              // disabled). Kunpeng's own prompts reference bare tool names, so
              // spell the mapping out to avoid first-turn `unknown tool`
              // errors observed in real sessions.
              persona: [
                context.systemPrompt,
                '[工具命名规则] 本会话中所有工具的实际名称都带有 mcp__kunpeng__ 前缀'
                  + '（例如 image_recognition 的完整名称是 mcp__kunpeng__image_recognition）。'
                  + '调用工具时必须使用工具列表里给出的完整名称，不要省略前缀。',
                history,
              ].filter(Boolean).join('\n\n'),
              workspace: coordinator.getCwd(),
              maxTokens: 32_768,
              contextWindow: 1_000_000,
              input,
              mediaBlocks: acpMediaBlocks,
              toolRegistry: coordinator.getToolRegistry(),
              callbacks,
            });
            coordinator.recordHarnessTurn(finalContent, result.text, result.thinking, mediaBlocks);
            persistAgentMsgs();
            callbacks.onComplete(result.text);
            }
          } catch (error) {
            if (!isCurrentRun()) return;
            const normalized = error instanceof Error ? error : new Error(String(error));
            agentLog.error('DeepSeekHarness', normalized.message);
            if (shouldFallbackHarnessToBuiltin(error, bridge.hasVisibleOutput())) {
              const reason = normalized.message.replace(/\s+/g, ' ').trim().slice(0, 240);
              executingHarness = false;
              useDeepseekHarnessStore.getState().markFallback(runId);
              useRunStepStore.getState().addProgressUpdate(
                `DeepSeek Harness 暂时不可用：${reason}。正在由 DeepSeek 普通模式接管本次任务。`,
                runId,
              );
              void emit('provider-fallback', {
                from: 'deepseek-harness',
                to: 'deepseek-builtin',
                reason: normalized.message,
              });
              coordinator.setRouteStrategy(deepseekBuiltinRoute(primaryRoute.modelId));
              await coordinator.run(finalContent, callbacks, mediaBlocks);
            } else {
              callbacks.onError(normalized);
            }
          } finally {
            useDeepseekHarnessStore.getState().finishRun(runId);
            if (dshBridgesRef.current.get(currentAgentId) === bridge) {
              dshBridgesRef.current.delete(currentAgentId);
            }
            unregisterSharedDshBridge(currentAgentId, bridge);
          }
        } else {
          await coordinator.run(finalContent, callbacks, mediaBlocks);
        }
      } catch (err) {
        persistAgentMsgs();
        setError(err instanceof Error ? err.message : String(err));
        setIsStreaming(false);
        setStreamingSessionId(null);
        if (sessionId) setSessionStreaming(sessionId, false);
        setStreamingPhase('idle');
        emit('agent-status-change', 'error');
        useRunStepStore.getState().finishRun('failed', runId);
      } finally {
        if (activeRunIdsRef.current.get(currentAgentId) === runId) {
          activeRunIdsRef.current.delete(currentAgentId);
        }
        activeRunSessionRef.current = null;
        sendingRef.current = false;
        drainDeferredTeardown();
        clearInterval(persistInterval);
        cancelFlush();
      }
    },
    [
      addMessage,
      setIsStreaming,
      clearStreamingContent,
      setStreamingPhase,
      setStreamingSessionId,
      setSessionStreaming,
      startStreaming,
      setError,
      persistMessages,
      recordRunTrajectory,
    ],
  );

  /** 中止操作（中止当前 agent 的 coordinator） */
  const abort = useCallback(() => {
    userAbortedRef.current = true; // prevent onComplete/onError from double-cleanup
    activeRunTokenRef.current += 1; // invalidate callbacks from the aborted run
    const currentAgentId = useChatStore.getState().currentAgent?.id || 'main';
    // Prefer the agent the user is looking at, but if it has no active run,
    // fall back to the one agent that actually does — a Stop click right
    // after switching panels must stop the run the user means, and must
    // never finish a run that belongs to another agent or a background
    // (lark/wechat) run.
    let targetAgentId = currentAgentId;
    let activeRunId = activeRunIdsRef.current.get(currentAgentId);
    let activeDsh = dshBridgesRef.current.get(currentAgentId)
      ?? getSharedDshBridge(currentAgentId);
    if (!activeRunId && !activeDsh) {
      const candidates = [...new Set([
        ...activeRunIdsRef.current.keys(),
        ...dshBridgesRef.current.keys(),
      ])];
      if (candidates.length === 1) {
        targetAgentId = candidates[0];
        activeRunId = activeRunIdsRef.current.get(targetAgentId);
        activeDsh = dshBridgesRef.current.get(targetAgentId)
          ?? getSharedDshBridge(targetAgentId);
      }
    }
    if (activeDsh) {
      void activeDsh.abort();
      for (const [agentId, shared] of sharedDshBridges) {
        if (shared === activeDsh) unregisterSharedDshBridge(agentId, activeDsh);
      }
      for (const [agentId, bridge] of dshBridgesRef.current) {
        if (bridge === activeDsh) dshBridgesRef.current.delete(agentId);
      }
    }
    const c = coordinatorsRef.current.get(targetAgentId)
      ?? (coordinatorRef.current && coordinatorsRef.current.size <= 1
        ? coordinatorRef.current
        : undefined);
    let savedAgentMessages: ReturnType<AgentCoordinator['getMessages']> | null = null;
    // Persist coordinator state before abort so partial results are saved
    if (c) {
      const abortState = useChatStore.getState();
      const abortSid = abortState.currentSessionId;
      if (abortSid) {
        // The snapshot may catch the run mid-tool-execution (assistant
        // tool_calls pushed, results not yet). Persisting that verbatim
        // poisons the session file — OpenAI-style endpoints 400 on every
        // later request. Repair pairs before persisting/restoring.
        const rawMessages = repairToolPairingSnapshot(c.getMessages());
        const cachedMessages = compactAgentMessagesForStorage(rawMessages);
        savedAgentMessages = rawMessages;
        if (cachedMessages.length > 1) {
          try { safeLocalStorage.setItem(AGENT_MSGS_PREFIX + abortSid, JSON.stringify(cachedMessages)); } catch { /* quota */ }
        }
        if (abortState.messages.length > 0) {
          try { safeLocalStorage.setItem('kunpeng-messages-' + abortSid, JSON.stringify(abortState.messages)); } catch { /* quota */ }
        }
        // Mirror to disk so a force-quit right after abort doesn't lose state.
        void flushAgentMessages(abortSid, rawMessages);
      }
    }
    c?.abort();
    const fresh = coordinatorFactoryRef.current?.(targetAgentId);
    if (fresh) {
      if (savedAgentMessages?.length) {
        void fresh.restoreMessages(savedAgentMessages);
      }
      coordinatorsRef.current.set(targetAgentId, fresh);
      coordinatorRef.current = fresh;
      agentLog.info('Agent', `Replaced coordinator for ${targetAgentId} after abort`);
    }
    // Immediately clear ALL streaming state — no timeout, no waiting
    setIsStreaming(false);
    setStreamingPhase('idle');
    const sid = useChatStore.getState().streamingSessionId;
    // 截断保留：把已流出的部分正文作为截断消息落进会话，而不是整段消失
    // （abort 使回调失效后，pending flush 被 ghost-guard 拦截，随后
    // clearStreamingContent 会把这部分内容清掉）。
    {
      const snapshot = useChatStore.getState();
      const partialText = snapshot.streamingContent.trim();
      const partialThinking = snapshot.streamingThinkingContent.trim();
      if (partialText || partialThinking) {
        snapshot.addMessage({
          id: randomUUID(),
          role: 'assistant',
          content: partialText
            ? `${partialText}\n\n_（已停止，以上为截断部分）_`
            : '_（已停止，未产出正文）_',
          ...(partialThinking ? { thinkingContent: partialThinking } : {}),
          timestamp: Date.now(),
        });
        const persistSid = useChatStore.getState().currentSessionId;
        if (persistSid) {
          try { safeLocalStorage.setItem('kunpeng-messages-' + persistSid, JSON.stringify(useChatStore.getState().messages)); } catch { /* quota */ }
        }
      }
    }
    if (sid) {
      useChatStore.getState().setStreamingSessionId(null);
      useChatStore.getState().setSessionStreaming(sid, false);
      useChatStore.getState().clearStreamingContent();
    }
    emit('agent-status-change', 'idle');
    // Only finish the run we actually targeted. Without an activeRunId there
    // is nothing of ours to close — calling finishRun without a runId would
    // stamp 'aborted' onto whatever run holds the global currentRunId slot
    // (another agent, or a background lark/wechat run).
    if (activeRunId) {
      useRunStepStore.getState().finishRun('aborted', activeRunId);
      activeRunIdsRef.current.delete(targetAgentId);
    }
    // Aborts are a user-dissatisfaction signal — feed the evolution journal.
    const lastUserMsg = [...useChatStore.getState().messages].reverse().find((m) => m.role === 'user');
    recordRunTrajectory('aborted', lastUserMsg?.content || '', useChatStore.getState().streamingSentAt);
  }, [setIsStreaming, setStreamingPhase, recordRunTrajectory]);

  /** 切换工作目录（应用到所有 agent 的 coordinator） */
  const switchCwd = useCallback((cwd: string) => {
    for (const c of coordinatorsRef.current.values()) c.setCwd(cwd);
  }, []);

  /** 清空对话（仅当前 agent） */
  const clearConversation = useCallback(() => {
    const currentAgentId = useChatStore.getState().currentAgent?.id || 'main';
    coordinatorsRef.current.get(currentAgentId)?.clear();
  }, []);

  /** 获取 token 使用量（当前 agent） */
  const getTokenUsage = useCallback((): TokenUsage | null => {
    const currentAgentId = useChatStore.getState().currentAgent?.id || 'main';
    return coordinatorsRef.current.get(currentAgentId)?.getTokenUsage() || null;
  }, []);

  /** 恢复会话上下文到对应 agent 的 coordinator（切换会话时调用） */
  const restoreSession = useCallback(async (sessionId: string) => {
    // Sequence guard: restores contain slow awaits (file reads, and an LLM
    // compact inside restoreMessages). Two rapid session switches interleave;
    // without this, an older restore can finish LAST and overwrite the newer
    // session's messages — UI shows session B while the coordinator holds A.
    const seq = ++restoreSeqRef.current;
    const isStale = () => seq !== restoreSeqRef.current;
    // Session id format: `agent:{agentId}:{uuid}`. Pick the matching agent.
    const parts = sessionId.split(':');
    const agentId = parts.length >= 3 && parts[0] === 'agent' ? parts[1] : 'main';
    if ((dshBridgesRef.current.get(agentId) ?? getSharedDshBridge(agentId))?.getIsRunning()) {
      agentLog.warn('Agent', `Session switch: DeepSeek Harness for ${agentId} is running, deferring restore`);
      return;
    }
    let coordinator = coordinatorsRef.current.get(agentId);
    if (!coordinator && coordinatorFactoryRef.current) {
      coordinator = coordinatorFactoryRef.current(agentId);
      coordinatorsRef.current.set(agentId, coordinator);
    }
    if (!coordinator) return;
    coordinatorRef.current = coordinator;

    let saved = loadAgentMessages(sessionId);
    if (saved === null) {
      const fromFile = await readSessionFromFile(sessionId);
      if (isStale()) return;
      if (fromFile) {
        hydrateLocalStorageSession(sessionId, fromFile);
        saved = fromFile.agentMessages;
      } else {
        saved = [];
      }
    }
    // Don't clear a running coordinator — would corrupt an active conversation
    if (coordinator.getIsRunning()) {
      agentLog.warn('Agent', `Session switch: ${agentId} is running, deferring restore`);
      return;
    }
    if (saved.length > 0) {
      let uiMsgs = readMessagesFromLocalStorage(sessionId);
      if (uiMsgs === null) {
        const fromFile = await readSessionFromFile(sessionId);
        if (isStale()) return;
        uiMsgs = fromFile?.messages ?? [];
      }
      const recovered = recoverDegradedAgentHistory(saved, uiMsgs);
      coordinator.clear();
      await coordinator.restoreMessages(recovered);
      if (isStale()) return;
      if (recovered !== saved) {
        saveAgentMessages(sessionId, recovered);
        agentLog.warn('Agent', `Session switch: rebuilt degraded history from visible chat for ${agentId}`);
      } else {
        agentLog.info('Agent', `Session switch: restored ${saved.length} agent messages for ${agentId}`);
      }
    } else {
      // Fallback: agent-messages key missing but UI messages may still exist
      // (storage eviction, dev↔prod origin switch). Read UI messages for
      // THIS session id (not chatStore — that still holds the previous
      // session's messages at this point in the load flow).
      let uiMsgs = readMessagesFromLocalStorage(sessionId);
      if (uiMsgs === null) {
        const fromFile = await readSessionFromFile(sessionId);
        if (isStale()) return;
        uiMsgs = fromFile?.messages ?? [];
      }
      if (uiMsgs.length > 0) {
        const projected = projectUIMessagesToAgentMessages(uiMsgs);
        coordinator.clear();
        if (projected.length > 0) {
          await coordinator.restoreMessages(projected);
          if (isStale()) return;
          agentLog.warn('Agent', `Session switch: rebuilt ${projected.length} agent msgs from UI for ${agentId}`);
        }
      } else {
        coordinator.clear();
        agentLog.info('Agent', `Session switch: ${agentId} starting fresh`);
      }
    }
    // Refresh the context-usage pill for the newly active conversation.
    useChatStore.getState().setContextStats(coordinator.getContextStats());
  }, []);

  // 注册到 useSessions 的回调，确保切换会话时 coordinator 同步。
  // 仅主实例注册——次级实例（技能向导）注册会劫持会话恢复，导致主聊天
  // 切换会话后 coordinator 不再更新、历史串台。
  useEffect(() => {
    if (!isPrimary) return;
    setCoordinatorRestoreCallback(restoreSession);
  }, [restoreSession, isPrimary]);

  return {
    isReady,
    sendMessage,
    abort,
    switchCwd,
    clearConversation,
    getTokenUsage,
    restoreSession,
    deleteAgentMessages,
    toolExecutions: toolExecutionsRef.current,
    skills: skillLoaderRef.current?.getAll() || [],
  };
}
