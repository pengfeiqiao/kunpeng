/**
 * useCanvasTaskRecovery — 失联任务的后台恢复与回填。
 *
 * 职责边界（防双头竞跑的核心纪律）：
 * 1. 前台 Promise 活着（updatedAt 持续刷新）就绝不介入——staleness 是唯一
 *    的接管信号；前台每 3-8s 都会 updateTask 写 progress，天然心跳。
 * 2. 回填讲所有权：分镜有 genTaskId 时只认领自己的任务；别的任务正在生成
 *    时旧 succeeded 任务不得劫持回填。
 * 3. 跨项目隔离：task.projectId 与当前打开项目不符时跳过，等切回再回填。
 */
import { useEffect, useRef } from 'react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useCanvasTaskStore, type CanvasTask } from '@/stores/canvasTaskStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { rhtvQuery } from '@/lib/rhtv/client';
import { rhtvDownloadAll } from '@/lib/rhtv/download';
import { RhtvBusinessError } from '@/lib/rhtv/types';
import { runImageFallback, spawnVariantNodes } from '@/lib/canvasGen/index';
import { kuaiziQueryTask } from '@/lib/kuaizi/seedance';
import { appendArtifact } from '@/lib/artifacts';
import { ensureVideoThumb } from '@/lib/canvas/videoThumbs';
import {
  DreaminaLoginRequiredError,
  queryDreaminaSeedreamTask,
} from '@/lib/dreamina/image';
import {
  DREAMINA_SEEDANCE_25_ENDPOINT,
  queryDreaminaSeedance25Task,
} from '@/lib/dreamina/video';
import {
  APIMART_MIDJOURNEY_ENDPOINT,
  queryApimartMidjourneyTask,
} from '@/lib/midjourney/apimart';
import {
  APIMART_MINIMAX_H3_ENDPOINT,
  APIMART_SEEDREAM_ENDPOINT,
  APIMART_WAN3_ENDPOINT,
  queryApimartTask,
} from '@/lib/apimart/client';
import { kuaiziH3QueryTask } from '@/lib/kuaizi/minimaxH3';
import { kuaiziWan3QueryTask } from '@/lib/kuaizi/wan3';
import { customQueryTask, findCustomMediaApi, isCustomMediaEngine } from '@/lib/customMedia/runner';

const ACTIVE = new Set(['queued', 'uploading', 'running', 'downloading']);
const POLL_INTERVAL_MS = 8_000;
const STALE_AFTER_MS = 90_000;
const WORKSHOP_STALE_AFTER_MS = 30_000;
/** 恢复轮询的用户可见等待线：超过后不再说“马上完成”，但仍继续查远端。
 * 视频模型偶发排队会到 20 分钟左右；一到 20 分钟就判失败会丢失迟到结果。 */
const MAX_TASK_AGE_IMAGE_MS = 10 * 60_000;
const SOFT_TASK_AGE_VIDEO_MS = 20 * 60_000;
/** 真正放弃查询的硬期限。视频结果 URL 通常完成后 24h 有效，因此恢复线程
 * 保守地查到 24h；只要远端后面变 SUCCESS，仍能下载并回填。 */
const HARD_TASK_AGE_VIDEO_MS = 24 * 60 * 60_000;
/** 按引擎放宽硬期限（前缀匹配 engineId），新模型更慢时在这里加 */
const ENGINE_AGE_OVERRIDES: { prefix: string; maxAgeMs: number }[] = [
  // 例：{ prefix: 'sora-', maxAgeMs: 40 * 60_000 },
];

function isActiveTask(task: CanvasTask): boolean {
  return ACTIVE.has(task.status);
}

function taskHasRecoverableHandle(task: CanvasTask): boolean {
  return Boolean(task.rhTaskId || task.resultPaths.length > 0 || task.resultUrls.length > 0);
}

function isKuaiziTask(task: CanvasTask): boolean {
  return task.endpoint === 'kuaizi-lz/video/task/create' || task.engineLabel.includes('筷子丽帧');
}

function isApimartMidjourneyTask(task: CanvasTask): boolean {
  return task.endpoint === APIMART_MIDJOURNEY_ENDPOINT;
}

function isApimartGenerationTask(task: CanvasTask): boolean {
  return task.endpoint === APIMART_SEEDREAM_ENDPOINT
    || task.endpoint === APIMART_MINIMAX_H3_ENDPOINT
    || task.endpoint === APIMART_WAN3_ENDPOINT;
}

/** 筷子系任务按协议分派：Seedance（POST 查询）与 H3/万相（GET 查询）接口不同。 */
function isKuaiziH3Task(task: CanvasTask): boolean {
  return task.endpoint === 'kuaizi/minimax-h3';
}

function isKuaiziWan3Task(task: CanvasTask): boolean {
  return task.endpoint === 'kuaizi/wan-3.0';
}

function isDreaminaImageTask(task: CanvasTask): boolean {
  return task.endpoint === 'dreamina-cli/seedream-5.0-pro' || task.engineId.startsWith('dreamina:');
}

function isDreaminaSeedance25Task(task: CanvasTask): boolean {
  // 2.5 默认走筷子丽帧：engineId 仍是 dreamina-seedance-2.5，但 endpoint/label
  // 是筷子的任务必须用筷子通道恢复（rhTaskId 是筷子 task_id）
  if (isKuaiziTask(task)) return false;
  return task.endpoint === DREAMINA_SEEDANCE_25_ENDPOINT || task.engineId === 'dreamina-seedance-2.5';
}

/** 跨项目隔离：任务属于别的项目时，一切回填/恢复动作跳过 */
function taskProjectMatches(task: CanvasTask): boolean {
  if (!task.projectId) return true; // 旧任务/纯画布任务无此字段，维持原行为
  return useWorkshopStore.getState().data?.projectId === task.projectId;
}

/** 该任务是不是这个 nodeId 的最新一次生成（防旧任务劫持重新生成中的节点） */
function isLatestTaskForNode(task: CanvasTask): boolean {
  const tasks = useCanvasTaskStore.getState().tasks;
  for (let i = tasks.length - 1; i >= 0; i--) {
    if (tasks[i].nodeId === task.nodeId) return tasks[i].id === task.id;
  }
  return false;
}

function nodeNeedsSucceededResult(task: CanvasTask): boolean {
  if (!task.nodeId) return false;
  if (task.status !== 'succeeded') return false;
  if (task.resultPaths.length === 0 && task.resultUrls.length === 0) return false;
  if (!isLatestTaskForNode(task)) return false;

  const node = useCanvasStore.getState().nodes.find((n) => n.id === task.nodeId);
  if (!node) return false;
  const data = (node.data ?? {}) as Record<string, unknown>;
  if (data.isGenerating) return true;

  if (task.kind === 'image') return !data.generatedImageUrl && !data.localPath;
  if (task.kind === 'audio') return !data.audioUrl && !data.localPath;
  return !data.generatedVideoUrl && !data.localPath;
}

function storyboardFrameIdOf(task: CanvasTask): string | undefined {
  // 只信显式 ID。prompt 匹配已废弃：两格同词时会串格（persist v2 已清掉旧任务）。
  return task.workshopStoryboardFrameId || undefined;
}

function storyboardNeedsSucceededResult(task: CanvasTask): boolean {
  const frameId = storyboardFrameIdOf(task);
  if (!task.workshopShotNo || !frameId) return false;
  if (task.status !== 'succeeded') return false;
  if (task.resultPaths.length === 0 && task.resultUrls.length === 0) return false;
  if (!taskProjectMatches(task)) return false;
  const shot = useWorkshopStore.getState().data?.shots.find((s) => s.shotNo === task.workshopShotNo);
  const frame = shot?.storyboardFrames?.find((f) => f.id === frameId);
  if (!frame) return false;
  // 只补两种格子：还在等结果的（generating/无图）。已有最终图的格子不动——
  // 尤其 legacy 无 candidates 的格子，用户手选的图不能被旧任务单向翻转。
  return frame.status === 'generating' || !frame.imagePath;
}

function workshopNeedsSucceededResult(task: CanvasTask): boolean {
  if (!task.workshopShotNo || !task.workshopShotKind) return false;
  if (task.workshopStoryboardFrameId) return false; // 格子任务走 storyboard 分支
  if (task.status !== 'succeeded') return false;
  if (task.resultPaths.length === 0 && task.resultUrls.length === 0) return false;
  if (!taskProjectMatches(task)) return false;
  const shot = useWorkshopStore.getState().data?.shots.find((s) => s.shotNo === task.workshopShotNo);
  if (!shot) return false;
  // 所有权判定：分镜指名任务时只认领自己的；别的任务在生成时绝不插手；
  // 无主且缺结果才允许补填（如 genTaskId 因 commitNow 时序丢失）。
  if (shot.genTaskId) return shot.genTaskId === task.id;
  if (shot.genStatus === 'generating' || shot.genStatus === 'queued') return false;
  return task.workshopShotKind === 'image' ? !shot.imagePath : !shot.videoPath;
}

function resetFailedGeneratingNode(task: CanvasTask): void {
  if (task.status !== 'failed' || !task.nodeId) return;
  const node = useCanvasStore.getState().nodes.find((n) => n.id === task.nodeId);
  const data = (node?.data ?? {}) as Record<string, unknown>;
  if (node && data.isGenerating && isLatestTaskForNode(task)) {
    useCanvasStore.getState().updateNode(task.nodeId, { isGenerating: false });
  }
}

function outputPatch(task: CanvasTask, path: string): Record<string, unknown> {
  const url = convertFileSrc(path);
  if (task.kind === 'image') return { generatedImageUrl: url, localPath: path };
  if (task.kind === 'audio') return { audioUrl: url, localPath: path, fileName: path.split('/').pop() };
  return { generatedVideoUrl: url, localPath: path, mediaRole: 'output' };
}

function applyCanvasResult(task: CanvasTask, paths: string[]): void {
  if (!task.nodeId || paths.length === 0) return;
  if (!isLatestTaskForNode(task)) return;
  const store = useCanvasStore.getState();
  if (!store.nodes.some((n) => n.id === task.nodeId)) return;
  store.updateNode(task.nodeId, {
    isGenerating: false,
    justCompletedAt: Date.now(),
    ...outputPatch(task, paths[0]),
  });
  // MJ 等多图输出：与前台路径对齐，其余产物落为变体节点，不静默丢弃
  if (task.kind === 'image' && paths.length > 1) {
    spawnVariantNodes(task.nodeId, paths.slice(1), task.prompt);
  }
}

function applyWorkshopResult(task: CanvasTask, paths: string[]): void {
  if (!task.workshopShotNo || !task.workshopShotKind || paths.length === 0) return;
  if (!taskProjectMatches(task)) return;
  const store = useWorkshopStore.getState();
  const shot = store.data?.shots.find((s) => s.shotNo === task.workshopShotNo);
  if (!shot) return;
  const storyboardFrameId = storyboardFrameIdOf(task);
  if (storyboardFrameId) {
    const frames = shot.storyboardFrames ?? [];
    if (!frames.some((f) => f.id === storyboardFrameId)) return;
    store.updateShot(task.workshopShotNo, {
      storyboardFrames: frames.map((frame) => {
        if (frame.id !== storyboardFrameId) return frame;
        const candidates = frame.candidates?.length
          ? frame.candidates
          : frame.imagePath
            ? [{ path: frame.imagePath, source: 'generate' as const, prompt: frame.prompt, createdAt: Date.now() }]
            : [];
        const nextCandidates = candidates.some((c) => c.path === paths[0])
          ? candidates
          : [...candidates, {
              path: paths[0],
              source: 'generate' as const,
              engineId: task.engineId,
              prompt: task.prompt,
              createdAt: task.finishedAt ?? Date.now(),
            }];
        return { ...frame, imagePath: paths[0], candidates: nextCandidates, status: 'done' as const, error: undefined };
      }),
    });
    void store.commitNow();
    return;
  }
  // 所有权二次校验（succeeded 判定与写回之间状态可能已变）
  if (shot.genTaskId && shot.genTaskId !== task.id) return;
  const mediaPath = task.workshopShotKind === 'video'
    ? paths.find((p) => /\.(mp4|mov|webm|m4v|mkv|avi)(?:\?|$)/i.test(p))
    : paths.find((p) => /\.(png|jpe?g|webp|gif|bmp)(?:\?|$)/i.test(p)) ?? paths[0];
  if (!mediaPath) return;
  store.updateShot(task.workshopShotNo, {
    genStatus: 'done',
    genTaskId: undefined,
    genError: undefined,
    ...(task.workshopShotKind === 'image'
      ? { imagePath: mediaPath }
      : { videoPath: mediaPath }),
  });
  if (task.workshopShotKind === 'video') {
    void ensureVideoThumb(mediaPath).then((thumb) => {
      if (!thumb?.path) return;
      const latest = useWorkshopStore.getState();
      const latestShot = latest.data?.shots.find((s) => s.shotNo === task.workshopShotNo);
      if (latestShot?.videoPath !== mediaPath || latestShot.videoThumbPath === thumb.path) return;
      latest.updateShot(task.workshopShotNo!, { videoThumbPath: thumb.path });
      void latest.commitNow();
    }).catch(() => {});
  }
  void store.commitNow();
}

function finalizeTask(task: CanvasTask, paths: string[], remoteUrls = task.resultUrls): void {
  applyCanvasResult(task, paths);
  applyWorkshopResult(task, paths);
  // 产物库记账：前台路径都有 appendArtifact，恢复路径不能漏——否则重启后
  // 恢复下载的产物在产物库里搜提示词搜不到（扫描器兜底丢元数据）
  const prevPaths = new Set(task.resultPaths);
  for (const p of paths) {
    if (!prevPaths.has(p) || task.resultPaths.length === 0) {
      void appendArtifact({ path: p, type: task.kind, engine: task.engineId, prompt: task.prompt, taskId: task.id });
    }
  }
  useCanvasTaskStore.getState().updateTask(task.id, {
    status: 'succeeded',
    progress: '完成',
    resultPaths: paths,
    resultUrls: remoteUrls,
    error: undefined,
    recoveryAttempts: 0,
    finishedAt: Date.now(),
  });
}

function failTask(task: CanvasTask, message: string): void {
  if (task.nodeId && isLatestTaskForNode(task)) {
    useCanvasStore.getState().updateNode(task.nodeId, { isGenerating: false });
  }
  if (task.workshopShotNo && taskProjectMatches(task)) {
    const store = useWorkshopStore.getState();
    const shot = store.data?.shots.find((s) => s.shotNo === task.workshopShotNo);
    const storyboardFrameId = storyboardFrameIdOf(task);
    if (storyboardFrameId && shot?.storyboardFrames?.some((f) => f.id === storyboardFrameId)) {
      store.updateShot(task.workshopShotNo, {
        storyboardFrames: shot.storyboardFrames.map((frame) =>
          frame.id === storyboardFrameId
            ? { ...frame, status: 'failed' as const, error: message }
            : frame,
        ),
      });
      void store.commitNow();
    } else if (shot && (!shot.genTaskId || shot.genTaskId === task.id)) {
      store.updateShot(task.workshopShotNo, {
        genStatus: 'failed',
        genTaskId: undefined,
        genError: message,
      });
      void store.commitNow();
    }
  }
  useCanvasTaskStore.getState().updateTask(task.id, {
    status: 'failed',
    error: message,
    finishedAt: Date.now(),
  });
}

function taskAgeLimitMs(task: CanvasTask): number {
  const override = ENGINE_AGE_OVERRIDES.find((o) => task.engineId.startsWith(o.prefix));
  if (override) return override.maxAgeMs;
  return task.kind === 'video' ? HARD_TASK_AGE_VIDEO_MS : MAX_TASK_AGE_IMAGE_MS;
}

function taskSoftAgeMs(task: CanvasTask): number {
  return task.kind === 'video' ? SOFT_TASK_AGE_VIDEO_MS : MAX_TASK_AGE_IMAGE_MS;
}

async function recoverOne(task: CanvasTask): Promise<void> {
  const latest = useCanvasTaskStore.getState().tasks.find((t) => t.id === task.id);
  if (!latest) return;
  task = latest;

  if (task.resultPaths.length > 0) {
    finalizeTask(task, task.resultPaths);
    return;
  }

  if (task.resultUrls.length > 0) {
    useCanvasTaskStore.getState().updateTask(task.id, {
      status: 'downloading',
      progress: `恢复下载 ${task.resultUrls.length} 个产物…`,
    });
    const paths = await rhtvDownloadAll(task.resultUrls, task.kind, task.engineId, (phase) => {
      useCanvasTaskStore.getState().updateTask(task.id, { status: 'downloading', progress: phase });
    });
    finalizeTask(task, paths);
    return;
  }

  if (!task.rhTaskId) {
    useCanvasTaskStore.getState().updateTask(task.id, {
      progress: task.status === 'queued' ? '等待提交…' : '等待 RunningHub taskId…',
    });
    return;
  }

  // 硬期限：远端任务过期后可能永远回非终态（甚至 UNKNOWN），不能无限轮询。
  // 视频的“用户等待线”是 20 分钟，但硬期限更长，允许迟到结果继续被捞回。
  if (Date.now() - task.createdAt > taskAgeLimitMs(task)) {
    throw new RhtvBusinessError(
      'task_failed',
      `任务超过 ${Math.round(taskAgeLimitMs(task) / 60_000)} 分钟仍未完成，已放弃（远端任务可能已过期）`,
    );
  }
  const softTimedOut = Date.now() - task.createdAt > taskSoftAgeMs(task);

  if (isApimartGenerationTask(task)) {
    const response = await queryApimartTask(task.rhTaskId, task.kind === 'video' ? 'video' : 'image');
    const elapsed = Math.max(0, Date.now() - task.createdAt);
    if (response.status === 'succeeded') {
      useCanvasTaskStore.getState().updateTask(task.id, {
        status: 'downloading',
        progress: `APIMart 已完成，恢复下载 ${response.urls.length} 个产物…`,
        resultUrls: response.urls,
      });
      const paths = await rhtvDownloadAll(response.urls, task.kind, task.engineId, (phase) => {
        useCanvasTaskStore.getState().updateTask(task.id, { status: 'downloading', progress: phase });
      });
      finalizeTask(task, paths, response.urls);
      return;
    }
    if (response.status === 'failed') {
      throw new RhtvBusinessError('task_failed', response.error || 'APIMart 任务失败');
    }
    useCanvasTaskStore.getState().updateTask(task.id, {
      status: 'running',
      progress: `APIMart 后台恢复：${response.status === 'pending' ? '排队中' : '生成中'}${response.progress !== undefined ? ` ${response.progress}%` : ''} · ${Math.round(elapsed / 1000)}s`,
      recoveryAttempts: 0,
    });
    return;
  }

  if (isApimartMidjourneyTask(task)) {
    const response = await queryApimartMidjourneyTask(task.rhTaskId);
    const elapsed = Math.max(0, Date.now() - task.createdAt);
    if (response.status === 'succeeded') {
      useCanvasTaskStore.getState().updateTask(task.id, {
        status: 'downloading',
        progress: `APIMart 已完成，恢复下载 ${response.urls.length} 张图片…`,
        resultUrls: response.urls,
      });
      const paths = await rhtvDownloadAll(response.urls, 'image', task.engineId, (phase) => {
        useCanvasTaskStore.getState().updateTask(task.id, { status: 'downloading', progress: phase });
      });
      finalizeTask(task, paths, response.urls);
      return;
    }
    if (response.status === 'failed') {
      throw new RhtvBusinessError('task_failed', response.error || 'APIMart Midjourney 任务失败');
    }
    useCanvasTaskStore.getState().updateTask(task.id, {
      status: 'running',
      progress: `APIMart 后台恢复：${response.status === 'pending' ? '排队中' : '生成中'}${response.progress !== undefined ? ` ${response.progress}%` : ''} · ${Math.round(elapsed / 1000)}s`,
      recoveryAttempts: 0,
    });
    return;
  }

  if (isDreaminaSeedance25Task(task)) {
    try {
      const response = await queryDreaminaSeedance25Task(task.rhTaskId, {
        taskContext: [
          task.workshopShotNo ? `工坊镜号 ${task.workshopShotNo}` : '',
          task.nodeId ? `画布节点 ${task.nodeId}` : '',
          `提示词：${task.prompt}`,
        ].filter(Boolean).join('；'),
      });
      if (response.status === 'succeeded') {
        finalizeTask(task, response.paths, response.urls);
        return;
      }
      if (response.status === 'failed') {
        throw new RhtvBusinessError('task_failed', response.error || 'Seedance 2.5 任务失败');
      }
      useCanvasTaskStore.getState().updateTask(task.id, {
        status: 'running',
        progress: `Seedance 2.5 后台恢复轮询 · ${Math.round((Date.now() - task.createdAt) / 1000)}s`,
        recoveryAttempts: 0,
      });
      return;
    } catch (error) {
      if (error instanceof DreaminaLoginRequiredError) {
        useCanvasTaskStore.getState().updateTask(task.id, {
          status: 'running',
          progress: '等待 Agent 完成即梦登录…',
          recoveryAttempts: 0,
        });
        return;
      }
      throw error;
    }
  }

  if (isDreaminaImageTask(task)) {
    try {
      const response = await queryDreaminaSeedreamTask(task.rhTaskId, {
        taskContext: [
          task.workshopShotNo ? `工坊镜号 ${task.workshopShotNo}` : '',
          task.nodeId ? `画布节点 ${task.nodeId}` : '',
          `提示词：${task.prompt}`,
        ].filter(Boolean).join('；'),
      });
      if (response.status === 'succeeded') {
        finalizeTask(task, response.paths, response.urls);
        return;
      }
      if (response.status === 'failed') {
        throw new RhtvBusinessError('task_failed', response.error || '即梦任务失败');
      }
      useCanvasTaskStore.getState().updateTask(task.id, {
        status: 'running',
        progress: `即梦后台恢复轮询 · ${Math.round((Date.now() - task.createdAt) / 1000)}s`,
        recoveryAttempts: 0,
      });
      return;
    } catch (error) {
      if (error instanceof DreaminaLoginRequiredError) {
        useCanvasTaskStore.getState().updateTask(task.id, {
          status: 'running',
          progress: '等待 Agent 完成即梦登录…',
          recoveryAttempts: 0,
        });
        return;
      }
      throw error;
    }
  }

  if (isKuaiziH3Task(task)) {
    const h3 = await kuaiziH3QueryTask(task.rhTaskId);
    const elapsed = Math.max(0, Date.now() - task.createdAt);
    if (h3.status === 'succeeded') {
      const url = h3.content?.url;
      if (!url) throw new RhtvBusinessError('task_failed', '筷子 MiniMax H3 已成功但没有返回视频地址');
      useCanvasTaskStore.getState().updateTask(task.id, {
        status: 'downloading', progress: 'H3 已完成，恢复下载视频…', resultUrls: [url],
      });
      const paths = await rhtvDownloadAll([url], 'video', task.engineId, (phase) => {
        useCanvasTaskStore.getState().updateTask(task.id, { status: 'downloading', progress: phase });
      });
      finalizeTask(task, paths, [url]);
      return;
    }
    if (h3.status === 'failed') {
      throw new RhtvBusinessError('task_failed', h3.error?.message || '筷子 MiniMax H3 任务失败');
    }
    useCanvasTaskStore.getState().updateTask(task.id, {
      status: 'running',
      progress: `H3 后台恢复轮询：${h3.status ?? 'running'} · ${Math.round(elapsed / 1000)}s`,
      recoveryAttempts: 0,
    });
    return;
  }

  if (isKuaiziWan3Task(task)) {
    const output = await kuaiziWan3QueryTask(task.rhTaskId);
    const elapsed = Math.max(0, Date.now() - task.createdAt);
    if (output.task_status === 'SUCCEEDED') {
      if (!output.video_url) throw new RhtvBusinessError('task_failed', '筷子 万相3.0 已成功但没有返回 video_url');
      useCanvasTaskStore.getState().updateTask(task.id, {
        status: 'downloading', progress: '万相 3.0 已完成，恢复下载视频…', resultUrls: [output.video_url],
      });
      const paths = await rhtvDownloadAll([output.video_url], 'video', task.engineId, (phase) => {
        useCanvasTaskStore.getState().updateTask(task.id, { status: 'downloading', progress: phase });
      });
      finalizeTask(task, paths, [output.video_url]);
      return;
    }
    if (output.task_status === 'FAILED' || output.task_status === 'CANCELED') {
      throw new RhtvBusinessError('task_failed', output.message || output.code || '筷子 万相3.0 任务失败');
    }
    useCanvasTaskStore.getState().updateTask(task.id, {
      status: 'running',
      progress: `万相 3.0 后台恢复轮询：${output.task_status ?? 'RUNNING'} · ${Math.round(elapsed / 1000)}s`,
      recoveryAttempts: 0,
    });
    return;
  }

  // 自定义模型插件（custom-media:{插件id}）：按插件自己的 baseUrl/Key 查询
  if (isCustomMediaEngine(task.engineId)) {
    const api = findCustomMediaApi(task.engineId);
    if (!api) {
      throw new RhtvBusinessError('task_failed', `自定义插件已删除或停用（${task.engineId}），无法恢复远端任务；如远端已出结果请按 taskId 到插件后台手动下载`);
    }
    const state = await customQueryTask(api, task.rhTaskId);
    const elapsed = Math.max(0, Date.now() - task.createdAt);
    if (state.status === 'succeeded') {
      if (state.urls.length === 0) throw new RhtvBusinessError('task_failed', `${api.label} 已成功但没有返回产物`);
      useCanvasTaskStore.getState().updateTask(task.id, {
        status: 'downloading', progress: `${api.label} 已完成，恢复下载…`, resultUrls: state.urls,
      });
      const paths = await rhtvDownloadAll(state.urls, task.kind, task.engineId, (phase) => {
        useCanvasTaskStore.getState().updateTask(task.id, { status: 'downloading', progress: phase });
      });
      finalizeTask(task, paths, state.urls);
      return;
    }
    if (state.status === 'failed') {
      throw new RhtvBusinessError('task_failed', state.error || `${api.label} 任务失败`);
    }
    useCanvasTaskStore.getState().updateTask(task.id, {
      status: 'running',
      progress: `${api.label} 后台恢复轮询：${state.status} · ${Math.round(elapsed / 1000)}s`,
      recoveryAttempts: 0,
    });
    return;
  }

  if (isKuaiziTask(task)) {
    const resp = await kuaiziQueryTask(task.rhTaskId);
    const data = resp.data!;
    const elapsed = Math.max(0, Date.now() - task.createdAt);
    if (data.status === 'succeeded') {
      if (!data.video_url) {
        // 终态业务错误：远端说成功却没给产物，重试也不会有——直接失败
        throw new RhtvBusinessError('task_failed', '筷子丽帧已成功但没有返回 video_url');
      }
      useCanvasTaskStore.getState().updateTask(task.id, {
        status: 'downloading',
        progress: '丽帧已完成，恢复下载视频…',
        resultUrls: [data.video_url],
      });
      const paths = await rhtvDownloadAll([data.video_url], 'video', task.engineId, (phase) => {
        useCanvasTaskStore.getState().updateTask(task.id, { status: 'downloading', progress: phase });
      });
      finalizeTask(task, paths, [data.video_url]);
      return;
    }
    if (data.status === 'failed') {
      throw new RhtvBusinessError('task_failed', data.error || resp.message || '筷子丽帧任务失败');
    }
    useCanvasTaskStore.getState().updateTask(task.id, {
      status: 'running',
      progress: softTimedOut
        ? `已超过 20 分钟，丽帧后台继续查：${data.status} · ${Math.round(elapsed / 1000)}s`
        : `丽帧后台恢复轮询：${data.status} · ${Math.round(elapsed / 1000)}s`,
      recoveryAttempts: 0,
    });
    return;
  }

  const resp = await rhtvQuery(task.rhTaskId);
  const status = resp.status ?? 'UNKNOWN';
  if (status === 'SUCCESS') {
    const urls = (resp.results ?? []).map((r) => r.url || r.outputUrl || '').filter(Boolean);
    if (urls.length === 0) throw new RhtvBusinessError('task_failed', 'RunningHub 已完成但没有返回输出文件');
    useCanvasTaskStore.getState().updateTask(task.id, {
      status: 'downloading',
      progress: `恢复下载 ${urls.length} 个产物…`,
      resultUrls: urls,
    });
    const paths = await rhtvDownloadAll(urls, task.kind, task.engineId, (phase) => {
      useCanvasTaskStore.getState().updateTask(task.id, { status: 'downloading', progress: phase });
    });
    finalizeTask(task, paths, urls);
    return;
  }

  if (status === 'FAILED') {
    const msg = resp.errorMessage || 'RunningHub 任务失败';
    if (task.engineId.startsWith('gpt-image-2') || task.engineId.includes('seedream-v5-pro')) {
      console.warn(`[recovery] 图片任务 FAILED，尝试容灾 fallback: ${msg}`);
      useCanvasTaskStore.getState().updateTask(task.id, {
        progress: '任务失败，尝试备用通道…',
      });
      const fbResult = await runImageFallback(task);
      if (fbResult.success && fbResult.paths) {
        finalizeTask(task, fbResult.paths, fbResult.urls ?? task.resultUrls);
        return;
      }
      if (fbResult.pending) return;
    }
    throw new RhtvBusinessError('task_failed', msg);
  }

  const elapsed = Math.max(0, Date.now() - task.createdAt);
  useCanvasTaskStore.getState().updateTask(task.id, {
    status: 'running',
    progress: softTimedOut
      ? `已超过 20 分钟，后台继续查：${status} · ${Math.round(elapsed / 1000)}s`
      : `后台恢复轮询：${status} · ${Math.round(elapsed / 1000)}s`,
    recoveryAttempts: 0,
  });
}

export async function recoverCanvasTaskNow(params: { taskId?: string; rhTaskId?: string }): Promise<CanvasTask> {
  const taskId = String(params.taskId ?? '').trim();
  const rhTaskId = String(params.rhTaskId ?? '').trim();
  let task = useCanvasTaskStore.getState().tasks.find((t) =>
    (taskId && t.id === taskId) || (rhTaskId && t.rhTaskId === rhTaskId),
  );
  if (!task) {
    throw new Error(`没有找到可恢复任务：${taskId || rhTaskId || '未提供 taskId/rhTaskId'}`);
  }
  if (!taskHasRecoverableHandle(task)) {
    throw new Error(`任务 ${task.id} 没有远端 taskId 或结果 URL，无法从 API 取回`);
  }
  // 允许 agent 对已经被前台标记 failed 的超时任务重新查远端。
  if (task.status === 'failed' && task.rhTaskId) {
    useCanvasTaskStore.getState().updateTask(task.id, {
      status: 'running',
      progress: '手动恢复：正在从 API 查询结果…',
      error: undefined,
      finishedAt: undefined,
    });
    task = useCanvasTaskStore.getState().tasks.find((t) => t.id === task!.id)!;
  }
  try {
    await recoverOne(task);
  } catch (err) {
    const latest = useCanvasTaskStore.getState().tasks.find((t) => t.id === task!.id) ?? task;
    if (err instanceof RhtvBusinessError) {
      failTask(latest, err.message);
    }
    throw err;
  }
  return useCanvasTaskStore.getState().tasks.find((t) => t.id === task!.id) ?? task;
}

/**
 * Reclaims stale RunningHub canvas/workshop tasks after a lost foreground
 * Promise, app reload, or transient poll/download failure.
 */
export function useCanvasTaskRecovery(): void {
  const runningRef = useRef(false);
  const recoveredIds = useRef(new Set<string>());

  useEffect(() => {
    const tick = async () => {
      if (runningRef.current) return;
      const now = Date.now();
      const allTasks = useCanvasTaskStore.getState().tasks;
      allTasks.forEach(resetFailedGeneratingNode);
      const tasks = allTasks.filter((task) => {
        // ── 已完成任务的回填补偿（结果在、目标没收到）──
        if (nodeNeedsSucceededResult(task) || storyboardNeedsSucceededResult(task) || workshopNeedsSucceededResult(task)) {
          return true;
        }
        // ── 活跃任务的失联接管 ──
        if (!isActiveTask(task)) return false;
        if (!taskHasRecoverableHandle(task)) return false;
        if (task.inFlight) return false; // 前台 Promise 正在驱动，绝不介入
        // staleness 是唯一接管信号：前台轮询每 3-8s 刷 updatedAt，
        // 失联（重启/Promise 丢失/长时间网络故障）才轮到恢复线程。
        // 一旦接管过（recoveredIds），后续 tick 不再等 staleness——
        // 恢复自己的 updateTask 也会刷新 updatedAt，不能自己挡自己。
        if (recoveredIds.current.has(task.id)) return true;
        const staleMs = task.workshopShotNo ? WORKSHOP_STALE_AFTER_MS : STALE_AFTER_MS;
        return now - (task.updatedAt ?? task.createdAt) > staleMs;
      });
      if (tasks.length === 0) return;

      runningRef.current = true;
      try {
        await Promise.allSettled(tasks.map(async (task) => {
          recoveredIds.current.add(task.id);
          try {
            await recoverOne(task);
            const latest = useCanvasTaskStore.getState().tasks.find((t) => t.id === task.id);
            if (!latest || !isActiveTask(latest)) recoveredIds.current.delete(task.id);
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            if (err instanceof RhtvBusinessError) {
              failTask(task, msg);
              recoveredIds.current.delete(task.id);
            } else {
              // 瞬态错误（网络/5xx/超时）不再按次数判死：付费任务允许迟到，
              // 持续退避重试直到 taskAgeLimitMs 硬期限（到期由 recoverOne 统一
              // 抛 RhtvBusinessError 判 failed）。曾经 30 次就放弃，一次几小时
              // 的断网就会永久丢失已付费的远端任务。
              const attempts = (task.recoveryAttempts ?? 0) + 1;
              useCanvasTaskStore.getState().updateTask(task.id, {
                recoveryAttempts: attempts,
                status: 'running' as const,
                progress: `后台恢复轮询暂时失败（第 ${attempts} 次，将持续重试至硬期限）：${msg.slice(0, 80)}`,
              });
            }
          }
        }));
      } finally {
        runningRef.current = false;
      }
    };

    void tick();
    const timer = setInterval(() => void tick(), POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, []);
}
