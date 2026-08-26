/**
 * timelineTools — agent tools that operate the editor timeline directly
 * (AI 剪辑). Mirrors the canvasTools pattern: tools mutate editorStore,
 * the editor UI updates reactively.
 */
import type { Tool } from '../types';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { readTextFile } from '@tauri-apps/api/fs';
import { useEditorStore } from '@/stores/editorStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { captureEditorSnapshot } from '@/lib/editor/editorHistory';
import { TRANSITION_PRESETS } from '@/lib/editor/presets/transitionPresets';
import { FILTER_PRESETS } from '@/lib/editor/presets/filterPresets';
import { TEXT_TEMPLATES, findTextTemplate, textTemplatesDoc } from '@/lib/editor/presets/textTemplates';
import { findFxComponent, fxComponentsDoc } from '@/lib/editor/fxComponents';
import { validateFx, fxThemesDoc } from '@/lib/editor/fxDesignSystem';
import { findPageTemplate, pageTemplatesDoc } from '@/lib/editor/pageTemplates';
import { PROJECT_TEMPLATES, findProjectTemplate, applyProjectTemplate } from '@/lib/editor/presets/projectTemplates';
import { useRenderQueueStore } from '@/stores/renderQueueStore';
import { uploadToCos } from '@/lib/cos';
import { validateSceneSpec } from '@/lib/motion/validateScene';
import { sceneSpecToDoc } from '@/lib/motion/sceneDoc';
import { buildScenePreset, findScenePreset, scenePresetsDoc } from '@/lib/motion/presets';
import { sceneDslDoc } from '@/lib/motion/motionPrompt';
import { styleKitsDoc } from '@/lib/motion/styleKits';
import type { SceneSpec } from '@/lib/motion/spec';
import { EDITOR_ASPECTS, aspectOutputSize, aspectRatioValue, isEditorAspect } from '@/lib/editor/aspect';
import { flushEditorProjectNow, getEditorHydrationState } from '@/lib/editor/editorPersist';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { omniMgStylesDoc } from '@/lib/omni/styles';
import {
  planOmniSegmentsFromEditorText,
  planOmniSegmentsFromTranscript,
  runMgForEditorSegment,
  runMgTextFallbackForEditorSegment,
  type MgVideoEngine,
} from '@/lib/omni/workflow';
import { captureElementToPng, waitForElement } from '@/lib/agent/visualCapture';
import { loadMediaInput } from '@/lib/agent/mediaInput';
import { buildTranscriptTimelineRows } from '@/lib/editor/transcriptOps';

let activeExport: {
  controller: AbortController;
  startedAt: number;
  stage: string;
  detail?: string;
  percent?: number;
  outputPath?: string;
  jobId?: string;
} | null = null;

let lastExportParams: Record<string, unknown> | null = null;

async function flushTimelineMutation(): Promise<void> {
  try {
    await flushEditorProjectNow();
  } catch (err) {
    console.warn('[timelineTools] flush editor project failed', err);
  }
}

function clipReceipt(kind: string, id: string, startSec: number, durationSec: number): string {
  const start = Number(startSec.toFixed(2));
  const end = Number((startSec + durationSec).toFixed(2));
  return `${kind} 已加入时间轴，id: ${id}，位置 ${start}-${end}s。已把播放头移动到 ${start}s，预览区应该立即可见；若看不到，请调用 timeline_get_state 查看 active_at_playhead 和 last_render_error。`;
}

function timelineReadiness(): { ready: boolean; detail: Record<string, unknown>; message?: string } {
  const unified = useUnifiedProjectStore.getState();
  const hydration = getEditorHydrationState();
  const expectedProjectId = unified.activeId;
  const localStoreHydrated = useEditorStore.persist.hasHydrated();
  const hydrated = expectedProjectId
    ? hydration.status === 'ready' && hydration.activeProjectId === expectedProjectId
    : hydration.status === 'ready' || (hydration.status === 'idle' && localStoreHydrated);
  const detail = {
    loading: unified.opening || hydration.status === 'loading',
    hydrated,
    expected_project_id: expectedProjectId,
    loading_project_id: hydration.projectId,
    active_editor_project_id: hydration.activeProjectId,
    status: hydration.status,
    error: hydration.error ?? null,
  };

  if (unified.opening || hydration.status === 'loading') {
    return { ready: false, detail, message: '剪辑工程仍在从磁盘加载，当前空状态不是可信结果。请等待加载完成后重新调用 timeline_get_state。' };
  }
  if (hydration.status === 'error') {
    return { ready: false, detail, message: `剪辑工程加载失败：${hydration.error || '未知错误'}。请先恢复项目加载，不要重建或写入时间轴。` };
  }
  if (expectedProjectId && (hydration.status !== 'ready' || hydration.activeProjectId !== expectedProjectId)) {
    return { ready: false, detail, message: '当前项目与剪辑时间轴尚未完成对齐。此时读到的空时间轴不可信，请稍后重新查询。' };
  }
  if (!expectedProjectId && hydration.status === 'idle' && !localStoreHydrated) {
    return { ready: false, detail, message: '自由时间轴仍在恢复本地数据，请等待水合完成后重新查询。' };
  }
  return { ready: true, detail };
}

function timelineNotReadyResult() {
  const readiness = timelineReadiness();
  if (readiness.ready) return null;
  return {
    success: false,
    output: JSON.stringify(readiness.detail, null, 2),
    error: readiness.message,
  };
}

function findIdempotentFxClip(input: {
  clientToken?: string;
  html: string;
  css: string;
  componentId?: string;
  startSec: number;
  duration: number;
}) {
  const token = input.clientToken?.trim();
  return useEditorStore.getState().fxClips.find((clip) => {
    const storedToken = typeof clip.params?.__clientToken === 'string' ? clip.params.__clientToken : '';
    if (token && storedToken === token) return true;
    return clip.html === input.html
      && clip.css === input.css
      && (clip.componentId ?? '') === (input.componentId ?? '')
      && Math.abs(clip.startSec - input.startSec) < 0.001
      && Math.abs(clip.duration - input.duration) < 0.001;
  });
}

function idempotentFxReceipt(kind: string, id: string): string {
  return `检测到重复的${kind}请求，未再次添加；继续使用时间轴上的已有对象 id: ${id}。`;
}

const getStateTool: Tool = {
  definition: {
    name: 'timeline_get_state',
    description: '分级读取剪辑时间轴。默认 summary 只返回结构、播放头和错误；需要局部或完整数据时再提高 detail，避免把整条时间轴塞进上下文。',
    parameters: {
      type: 'object',
      properties: {
        detail: {
          type: 'string',
          enum: ['summary', 'playhead', 'selected', 'full'],
          description: 'summary=轻量摘要（默认）；playhead=当前时刻附近对象；selected=当前选中对象；full=完整状态',
        },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const notReady = timelineNotReadyResult();
    if (notReady) return notReady;
    const store = useEditorStore.getState();
    const full = JSON.parse(store.getStateSummary()) as Record<string, unknown>;
    const hydration = timelineReadiness().detail;
    const detail = String(params.detail ?? 'summary');
    if (detail === 'full') return { success: true, output: JSON.stringify({ hydration, ...full }, null, 2) };

    if (detail === 'playhead') {
      const playhead = Number(full.playhead_sec ?? 0);
      const near = (items: unknown, startKey: string, end: (item: Record<string, unknown>) => number) =>
        Array.isArray(items)
          ? items.filter((raw) => {
            const item = raw as Record<string, unknown>;
            const start = Number(item[startKey] ?? item.start ?? 0);
            return start <= playhead + 2 && end(item) >= playhead - 2;
          })
          : [];
      return {
        success: true,
        output: JSON.stringify({
          hydration,
          playhead_sec: playhead,
          total_duration_sec: full.total_duration_sec,
          active_at_playhead: full.active_at_playhead,
          last_render_error: full.last_render_error,
          clips: full.clips,
          overlays: near(full.overlays, 'start', (x) => Number(x.start ?? 0) + Number(x.effective_sec ?? 0)),
          texts: near(full.texts, 'start', (x) => Number(x.end ?? 0)),
          fx: near(full.fx, 'start', (x) => Number(x.start ?? 0) + Number(x.duration ?? 0)),
          subtitles: near(full.subtitles, 'start', (x) => Number(x.end ?? 0)),
        }, null, 2),
      };
    }

    if (detail === 'selected') {
      const selected = [
        ['clip', store.selectedClipId, full.clips],
        ['overlay', store.selectedOverlayId, full.overlays],
        ['text', store.selectedTextId, full.texts],
        ['fx', store.selectedFxId, full.fx],
        ['subtitle', store.selectedSubtitleId, full.subtitles],
        ['audio', store.selectedAudioClipId, full.audio_clips],
      ] as const;
      const hit = selected.find(([, id]) => Boolean(id));
      if (!hit) return { success: false, output: '', error: '当前没有选中的时间轴对象' };
      const [kind, id, items] = hit;
      const item = Array.isArray(items) ? items.find((x) => (x as { id?: string }).id === id) : null;
      return { success: true, output: JSON.stringify({ hydration, kind, item, playhead_sec: full.playhead_sec }, null, 2) };
    }

    return {
      success: true,
      output: JSON.stringify({
        hydration,
        aspect: full.aspect,
        total_duration_sec: full.total_duration_sec,
        playhead_sec: full.playhead_sec,
        active_at_playhead: full.active_at_playhead,
        last_render_error: full.last_render_error,
        counts: {
          clips: Array.isArray(full.clips) ? full.clips.length : 0,
          overlays: Array.isArray(full.overlays) ? full.overlays.length : 0,
          texts: Array.isArray(full.texts) ? full.texts.length : 0,
          fx: Array.isArray(full.fx) ? full.fx.length : 0,
          subtitles: Array.isArray(full.subtitles) ? full.subtitles.length : 0,
          audio: Array.isArray(full.audio_clips) ? full.audio_clips.length : 0,
        },
        track_states: full.track_states,
        export_settings: full.export_settings,
      }, null, 2),
    };
  },
};

const renderFrameTool: Tool = {
  definition: {
    name: 'timeline_render_frame',
    description: '把时间轴指定时刻的合成预览按项目画幅截成 PNG，并作为原生图片结果返回给支持视觉的模型。会自动打开剪辑视图并移动播放头。',
    parameters: {
      type: 'object',
      properties: {
        sec: { type: 'number', description: '要检查的时间轴秒数；默认当前播放头' },
        out_path: { type: 'string', description: '可选 PNG 绝对路径；不填则保存到当前工作区 images' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const store = useEditorStore.getState();
    const total = store.totalDuration();
    const sec = Math.max(0, Math.min(Number(params.sec ?? store.playheadSec) || 0, Math.max(0, total)));
    store.setPlaying(false);
    store.setPlayhead(sec);
    useChatStore.getState().setActiveView('editor');
    try {
      const preview = await waitForElement('[data-kunpeng-editor-preview="true"]', 6000);
      const videos = [...preview.querySelectorAll('video')];
      await Promise.all(videos.map((video) => new Promise<void>((resolve) => {
        if (video.readyState >= 2) return resolve();
        const done = () => resolve();
        video.addEventListener('loadeddata', done, { once: true });
        setTimeout(done, 1200);
      })));
      const path = await captureElementToPng(preview, {
        outPath: params.out_path as string | undefined,
        namePrefix: `timeline-${sec.toFixed(2).replace('.', '-')}`,
        backgroundColor: '#303030',
        cropAspectRatio: aspectRatioValue(store.aspect),
        outputSize: aspectOutputSize(store.aspect, { w: 1280, h: 720 }),
      });
      const native = await loadMediaInput(path);
      const size = aspectOutputSize(store.aspect, { w: 1280, h: 720 });
      return {
        success: true,
        output: JSON.stringify({
          path,
          sec: Number(sec.toFixed(3)),
          width: size.width,
          height: size.height,
          aspect: store.aspect,
          next: '截图已作为原生图片附加到本次工具结果，请直接检查构图、文字、动画关键状态和异常元素。',
          last_render_error: useEditorStore.getState().lastRenderError,
        }, null, 2),
        media: [{
          type: 'image',
          source: native.dataUrl.startsWith('data:')
            ? { type: 'base64', media_type: native.mediaType || 'image/png', data: native.dataUrl.slice(native.dataUrl.indexOf(',') + 1) }
            : { type: 'url', url: native.dataUrl },
        }],
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `截取时间轴预览失败：${err instanceof Error ? err.message : String(err)}；last_render_error=${useEditorStore.getState().lastRenderError ?? '无'}`,
      };
    }
  },
};

const getFxDetailTool: Tool = {
  definition: {
    name: 'timeline_get_fx_detail',
    description: '读取单个特效/自由页面/运动场景的完整可编辑详情。用于精准修改已有特效，避免看不见 spec/html/css 就整段重做。',
    parameters: {
      type: 'object',
      properties: {
        fx_id: { type: 'string', description: '特效 id，可从 timeline_get_state 的 fx 列表读取' },
        include_html_css: { type: 'boolean', description: '是否返回完整 html/css，默认 false，仅返回摘要和片段预览' },
      },
      required: ['fx_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    const fxId = String(params.fx_id ?? '');
    const clip = s.fxClips.find((f) => f.id === fxId);
    if (!clip) {
      return {
        success: false,
        output: '',
        error: `fx_id 不存在：${fxId || '(空)'}. 当前特效：${s.fxClips.map((f) => `${f.id}:${f.label}`).join('，') || '无'}`,
      };
    }
    const spec = (clip.params as { spec?: unknown } | undefined)?.spec as SceneSpec | undefined;
    const includeHtmlCss = Boolean(params.include_html_css);
    return {
      success: true,
      output: JSON.stringify({
        id: clip.id,
        label: clip.label,
        componentId: clip.componentId ?? null,
        mode: (clip.params as { mode?: unknown } | undefined)?.mode ?? (clip.componentId === 'scene' ? 'scene' : 'custom'),
        theme: clip.theme ?? null,
        start_sec: clip.startSec,
        duration_sec: clip.duration,
        disabled: clip.disabled ?? false,
        transform: clip.transform ?? null,
        render_cache_path: clip.renderCachePath ?? null,
        params: clip.params ?? null,
        spec_summary: spec ? {
          duration: spec.duration,
          theme: spec.theme,
          layer_count: Array.isArray(spec.layers) ? spec.layers.length : 0,
          layers: Array.isArray(spec.layers)
            ? spec.layers.map((layer) => ({
              id: layer.id,
              kind: layer.kind,
              text: typeof layer.text === 'string' ? layer.text.slice(0, 80) : undefined,
            }))
            : [],
        } : null,
        html_preview: includeHtmlCss ? undefined : clip.html.slice(0, 800),
        css_preview: includeHtmlCss ? undefined : clip.css.slice(0, 800),
        html: includeHtmlCss ? clip.html : undefined,
        css: includeHtmlCss ? clip.css : undefined,
        verify: '修改后调用 timeline_get_fx_detail 复查；若预览黑屏，调用 timeline_get_state 查看 last_render_error。',
      }, null, 2),
    };
  },
};

const seekPlayheadTool: Tool = {
  definition: {
    name: 'timeline_seek_playhead',
    description: '移动剪辑播放头到指定秒数，并返回该时刻活跃的视频/特效/花字/音频。添加远处特效后用它把预览对焦到正确位置。',
    parameters: {
      type: 'object',
      properties: {
        sec: { type: 'number', description: '时间轴秒数' },
      },
      required: ['sec'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    const total = s.totalDuration();
    const sec = Math.max(0, Math.min(Number(params.sec) || 0, Math.max(total, 0)));
    s.setPlayhead(sec);
    await flushTimelineMutation();
    return {
      success: true,
      output: JSON.stringify({
        playhead_sec: Number(sec.toFixed(2)),
        total_duration_sec: Number(total.toFixed(2)),
        state: JSON.parse(useEditorStore.getState().getStateSummary()),
      }, null, 2),
    };
  },
};

const exportAnalyzeTool: Tool = {
  definition: {
    name: 'timeline_export_analyze',
    description: '分析当前剪辑时间轴适合怎么导出：是否无主视频、是否需要虚拟底片、是否有特效缓存需求、是否可走快速导出。导出前应先调用。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    const { analyzeEditorExport } = await import('@/lib/editor/composeEngine');
    const analysis = analyzeEditorExport();
    return { success: true, output: JSON.stringify(analysis, null, 2) };
  },
};

const renderGraphTool: Tool = {
  definition: {
    name: 'timeline_render_graph',
    description: '输出剪辑时间轴的渲染图诊断。用于判断新渲染引擎/native compositor 是否可用、当前为什么回退 FFmpeg、哪些层最影响导出。',
    parameters: {
      type: 'object',
      properties: {
        detail: { type: 'boolean', description: '是否输出完整节点列表，默认 false' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const { buildRenderGraph } = await import('@/lib/editor/renderGraph');
    const { chooseRenderBackend, summarizeRenderGraph } = await import('@/lib/editor/renderBackends');
    const graph = buildRenderGraph();
    if (!params.detail) return { success: true, output: summarizeRenderGraph(graph) };
    return {
      success: true,
      output: JSON.stringify({
        output: graph.output,
        features: graph.features,
        backend: chooseRenderBackend(graph),
        diagnostics: graph.diagnostics,
        nodes: graph.nodes,
      }, null, 2),
    };
  },
};

const exportStatusTool: Tool = {
  definition: {
    name: 'timeline_export_status',
    description: '查看当前导出任务状态、阶段、百分比和运行时长。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    if (!activeExport) {
      const latest = useRenderQueueStore.getState().latest();
      if (!latest) return { success: true, output: '当前没有正在运行的导出任务' };
      return { success: true, output: JSON.stringify({ running: false, latest }, null, 2) };
    }
    const elapsedSec = (Date.now() - activeExport.startedAt) / 1000;
    return {
      success: true,
      output: JSON.stringify({
        running: true,
        stage: activeExport.stage,
        detail: activeExport.detail ?? '',
        percent: activeExport.percent ?? null,
        elapsed_sec: Number(elapsedSec.toFixed(1)),
        output_path: activeExport.outputPath ?? null,
        job_id: activeExport.jobId ?? null,
      }, null, 2),
    };
  },
};

const exportStopTool: Tool = {
  definition: {
    name: 'timeline_export_stop',
    description: '停止当前正在运行的剪辑导出任务。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    const { invoke } = await import('@tauri-apps/api/tauri');
    const hadActive = Boolean(activeExport);
    if (activeExport) activeExport.controller.abort();
    // 只清理鲲鹏自己的渲染进程：模式全部锚定 .kunpeng / 项目内路径 / 渲染 worker
    // 专属命名，避免 pkill 误杀用户其他 ffmpeg/Chrome 进程。
    await invoke('execute_command', {
      command: [
        "pkill -TERM -f 'render-worker\\.mjs' 2>/dev/null || true",
        "pkill -TERM -f 'kunpeng/\\.local-browsers/chromium' 2>/dev/null || true",
        "pkill -TERM -f 'puppeteer_dev_chrome_profile' 2>/dev/null || true",
        "pkill -TERM -f 'ffmpeg .*\\.kunpeng' 2>/dev/null || true",
        'sleep 0.8',
        "pgrep -f 'render-worker\\.mjs' | xargs -r kill -9 2>/dev/null || true",
        "pgrep -f 'kunpeng/\\.local-browsers/chromium' | xargs -r kill -9 2>/dev/null || true",
        "pgrep -f 'puppeteer_dev_chrome_profile' | xargs -r kill -9 2>/dev/null || true",
        "pgrep -f 'ffmpeg .*\\.kunpeng' | xargs -r kill -9 2>/dev/null || true",
      ].join('; '),
      timeoutMs: 5000,
    }).catch(() => null);
    if (activeExport?.jobId) {
      useRenderQueueStore.getState().finishJob(activeExport.jobId, 'cancelled', { error: '已停止导出' });
    }
    activeExport = null;
    return { success: true, output: hadActive ? '已停止导出，并清理底层渲染进程' : '当前没有进行中的导出；已清理可能残留的渲染进程' };
  },
};

const exportPrepareTool: Tool = {
  definition: {
    name: 'timeline_export_prepare',
    description: '导出前准备：分析时间轴并说明会使用的导出路径、虚拟底片、特效缓存和硬件编码策略。当前版本会检查并返回建议，真实预渲染由 timeline_export_video 自动执行。',
    parameters: {
      type: 'object',
      properties: {
        output_path: { type: 'string', description: '可选，用户指定的导出文件绝对路径' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const { analyzeEditorExport } = await import('@/lib/editor/composeEngine');
    const analysis = analyzeEditorExport();
    return {
      success: true,
      output: JSON.stringify({
        ...analysis,
        output_path: params.output_path ?? '未指定，导出时使用工作区 videos 目录',
        prepare_note: analysis.strategy === 'opaque-effects-direct'
          ? '当前会走黑底特效直出：特效/花字直接生成普通 MP4 视频层，跳过透明 MOV 和最终叠加。'
          : '特效/花字会在导出时渲染为总轨并写入缓存；普通视频片段也会缓存，重复导出会优先复用。',
      }, null, 2),
    };
  },
};

const exportVideoTool: Tool = {
  definition: {
    name: 'timeline_export_video',
    description: '使用新版剪辑导出引擎导出成片。支持无主视频时间轴，会自动生成虚拟底片并导出特效/花字/音频。',
    parameters: {
      type: 'object',
      properties: {
        output_path: { type: 'string', description: '导出文件绝对路径；不传则保存到工作区 videos 目录' },
        background: { type: 'string', enum: ['black', 'transparent'], description: '无主视频时的虚拟底片，mp4 默认 black' },
        encoder: { type: 'string', enum: ['auto', 'h264', 'hevc'], description: '硬件编码偏好，默认 auto/h264_videotoolbox' },
      },
      required: [],
    },
  },
  risk: 'ask',
  async execute(params, signal) {
    if (activeExport) return { success: false, output: '', error: '已有导出任务正在运行，请先 timeline_export_status 或 timeline_export_stop' };
    const s = useEditorStore.getState();
    const previousSettings = s.exportSettings;
    const controller = new AbortController();
    const queue = useRenderQueueStore.getState();
    const jobId = queue.createJob({ kind: 'video', title: 'AI 导出成片', outputPath: params.output_path as string | undefined });
    queue.startJob(jobId);
    const parentAbort = () => controller.abort();
    signal?.addEventListener('abort', parentAbort, { once: true });
    activeExport = {
      controller,
      startedAt: Date.now(),
      stage: '准备导出',
      outputPath: params.output_path as string | undefined,
      jobId,
    };
    lastExportParams = { ...params };
    try {
      s.setExportSettings({
        ...(params.background ? { background: params.background as 'black' | 'transparent' } : {}),
        ...(params.encoder ? { encoder: params.encoder as 'auto' | 'h264' | 'hevc' } : {}),
      });
      const { composeEditorTimeline } = await import('@/lib/editor/composeEngine');
      const out = await composeEditorTimeline((p) => {
        if (!activeExport) return;
        activeExport.stage = p.stage;
        activeExport.detail = p.detail;
        activeExport.percent = p.percent;
        queue.updateJob(jobId, { stage: p.stage, detail: p.detail, percent: p.percent, outputPath: params.output_path as string | undefined });
      }, {
        ...(params.output_path ? { outputPath: params.output_path as string } : {}),
        signal: controller.signal,
      });
      queue.finishJob(jobId, 'completed', { outputPath: out });
      return { success: true, output: `成片已导出: ${out}` };
    } catch (err) {
      const msg = controller.signal.aborted ? '已停止导出' : (err instanceof Error ? err.message : String(err));
      queue.finishJob(jobId, controller.signal.aborted ? 'cancelled' : 'failed', { error: msg });
      return { success: false, output: '', error: msg };
    } finally {
      signal?.removeEventListener('abort', parentAbort);
      useEditorStore.getState().setExportSettings(previousSettings);
      activeExport = null;
    }
  },
};

const exportRetryTool: Tool = {
  definition: {
    name: 'timeline_export_retry',
    description: '重试最近一次 AI 导出。可选择降低质量、改用 H.264、清理特效缓存后重试。',
    parameters: {
      type: 'object',
      properties: {
        strategy: { type: 'string', enum: ['same', 'fast_h264', 'clear_cache'], description: 'same=原参数重试；fast_h264=改 H.264/流畅；clear_cache=清缓存后重试' },
      },
      required: [],
    },
  },
  risk: 'ask',
  async execute(params, signal) {
    if (!lastExportParams) return { success: false, output: '', error: '没有可重试的导出参数' };
    const strategy = (params.strategy as string | undefined) ?? 'same';
    if (strategy === 'clear_cache') {
      const cleared = await renderCacheClearTool.execute({});
      if (!cleared.success) return cleared;
    }
    const st = useEditorStore.getState();
    if (strategy === 'fast_h264') {
      st.setExportSettings({ encoder: 'h264', bitrate: 'low' });
    }
    return exportVideoTool.execute(lastExportParams, signal);
  },
};

const renderCacheStatusTool: Tool = {
  definition: {
    name: 'timeline_render_cache_status',
    description: '查看剪辑特效渲染缓存的大致状态。用于判断导出是否能复用特效/花字缓存。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    const { invoke } = await import('@tauri-apps/api/tauri');
    const home = await invoke<string>('get_home_dir');
    const root = `${home}/.kunpeng/render-cache`;
    const q = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
    const r = await invoke<{ stdout: string; stderr: string; exit_code: number }>('execute_command', {
      command: [
        `layers_alpha=$(test -d ${q(`${root}/layers`)} && find ${q(`${root}/layers`)} -type f -name alpha.mov 2>/dev/null | wc -l || echo 0)`,
        `layers_mp4=$(test -d ${q(`${root}/layers`)} && find ${q(`${root}/layers`)} -type f -name layer.mp4 2>/dev/null | wc -l || echo 0)`,
        `segments=$(test -d ${q(`${root}/segments`)} && find ${q(`${root}/segments`)} -type f -name segment.mp4 2>/dev/null | wc -l || echo 0)`,
        `echo "透明特效缓存: $layers_alpha; 黑底特效缓存: $layers_mp4; 主轨片段缓存: $segments"`,
      ].join('; '),
      timeoutMs: 10000,
    }).catch(() => ({ stdout: '0', stderr: '', exit_code: 0 }));
    return { success: true, output: `${String(r.stdout).trim()}。缓存目录：${root}` };
  },
};

const renderDebugTailTool: Tool = {
  definition: {
    name: 'timeline_render_debug_tail',
    description: '读取最近一次剪辑特效透明轨渲染诊断日志。用于排查 Chromium 预渲染卡在哪一步、是否在截图/编码/分段合并。',
    parameters: {
      type: 'object',
      properties: {
        lines: { type: 'number', description: '读取最近多少行，默认 80' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const { invoke } = await import('@tauri-apps/api/tauri');
    const home = await invoke<string>('get_home_dir');
    const path = `${home}/.kunpeng/render-debug/latest.jsonl`;
    const lines = Math.max(20, Math.min(300, Number(params.lines ?? 80)));
    const r = await invoke<{ stdout: string; stderr: string; exit_code: number }>('execute_command', {
      command: `test -f '${path.replace(/'/g, `'\\''`)}' && tail -${lines} '${path.replace(/'/g, `'\\''`)}' || true`,
      timeoutMs: 5000,
    });
    return {
      success: true,
      output: r.stdout.trim() || '还没有渲染诊断日志。请先执行一次导出。',
    };
  },
};

const renderCacheClearTool: Tool = {
  definition: {
    name: 'timeline_render_cache_clear',
    description: '清理剪辑渲染缓存。用于导出异常、缓存失效或用户要求重新渲染时。会清理特效总轨、黑底特效视频和主轨片段缓存。',
    parameters: {
      type: 'object',
      properties: {
        scope: { type: 'string', enum: ['all'], description: '当前只支持 all：清理全部剪辑渲染缓存' },
      },
      required: [],
    },
  },
  risk: 'ask',
  async execute() {
    const { invoke } = await import('@tauri-apps/api/tauri');
    const home = await invoke<string>('get_home_dir');
    const dir = `${home}/.kunpeng/render-cache`;
    const q = `'${dir.replace(/'/g, "'\\''")}'`;
    const r = await invoke<{ stdout: string; stderr: string; exit_code: number }>('execute_command', {
      command: `rm -rf ${q} && mkdir -p ${q}`,
      timeoutMs: 30000,
    });
    if (r.exit_code !== 0) return { success: false, output: '', error: r.stderr || r.stdout || '清理缓存失败' };
    return { success: true, output: `已清理剪辑渲染缓存：${dir}` };
  },
};

const proxyPrepareTool: Tool = {
  definition: {
    name: 'timeline_proxy_prepare',
    description: '为当前主视频素材生成并启用 720p 代理文件，让大素材预览和拖动更流畅；最终导出仍使用原片。',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '可选，指定需要生成代理的视频路径；不传则处理当前主轨素材' },
      },
      required: [],
    },
  },
  risk: 'ask',
  async execute(params, signal) {
    const { invoke } = await import('@tauri-apps/api/tauri');
    const { detectFfmpeg } = await import('@/lib/canvas/videoCompose');
    const ffmpeg = await detectFfmpeg();
    if (!ffmpeg) return { success: false, output: '', error: '未检测到 ffmpeg，无法生成代理' };
    const state = useEditorStore.getState();
    const paths = ((params.paths as string[] | undefined)?.length ? params.paths as string[] : state.clips.map((c) => c.path))
      .filter(Boolean);
    if (!paths.length) return { success: false, output: '', error: '没有可生成代理的视频素材' };
    const home = await invoke<string>('get_home_dir');
    const proxyDir = `${home}/.kunpeng/proxy`;
    const q = (p: string) => `'${p.replace(/'/g, "'\\''")}'`;
    const made: string[] = [];
    // videotoolbox 仅 macOS 存在；其他平台回退 libx264（与 composeEngine 一致）。
    const { hasVideoToolbox } = await import('@/lib/editor/composeEngine');
    const proxyEncoder = (await hasVideoToolbox(ffmpeg))
      ? '-c:v h264_videotoolbox -allow_sw 1 -b:v 2500k'
      : '-c:v libx264 -preset veryfast -b:v 2500k -pix_fmt yuv420p';
    for (const p of paths) {
      if (signal?.aborted) return { success: false, output: '', error: '已停止代理生成' };
      const key = btoa(unescape(encodeURIComponent(p))).replace(/[/+=]/g, '_').slice(0, 80);
      const out = `${proxyDir}/${key}.mp4`;
      const r = await invoke<{ stdout: string; stderr: string; exit_code: number }>('execute_command', {
        command: `mkdir -p ${q(proxyDir)} && test -f ${q(out)} || ${ffmpeg} -y -i ${q(p)} -vf "scale='min(1280,iw)':-2" -r 30 ${proxyEncoder} -c:a aac -b:a 96k ${q(out)}`,
        timeoutMs: 900000,
      });
      if (r.exit_code !== 0) return { success: false, output: made.join('\n'), error: `代理生成失败：${p}\n${r.stderr || r.stdout}` };
      useEditorStore.getState().setProxyPath(p, out);
      made.push(out);
    }
    return { success: true, output: `已准备 ${made.length} 个代理文件（最终导出仍使用原片）：\n${made.join('\n')}` };
  },
};

const addClipsTool: Tool = {
  definition: {
    name: 'timeline_add_clips',
    description: '把视频素材加入时间轴末尾。可传本地路径或画布视频节点 ID。',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '视频文件绝对路径' },
        canvas_node_ids: { type: 'array', items: { type: 'string' }, description: '画布视频节点 ID（自动取其本地文件）' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const paths = (params.paths as string[] | undefined) ?? [];
    const nodeIds = (params.canvas_node_ids as string[] | undefined) ?? [];
    const items: { path: string; label?: string; sourceNodeId?: string }[] = paths.map((p) => ({ path: p }));
    for (const id of nodeIds) {
      const n = useCanvasStore.getState().nodes.find((x) => x.id === id);
      const d = n?.data as Record<string, unknown> | undefined;
      const path = d?.localPath as string | undefined;
      if (path) items.push({ path, label: (d?.description as string)?.slice(0, 24), sourceNodeId: id });
    }
    if (items.length === 0) return { success: false, output: '', error: '没有可加入的素材（路径无效或节点无本地文件）' };
    const ids = await useEditorStore.getState().addClips(items);
    return { success: true, output: `已加入 ${ids.length} 段素材，clip_ids: ${ids.join(', ')}` };
  },
};

const addClipTool: Tool = {
  definition: {
    name: 'timeline_add_clip',
    description: '把一个视频或图片加入剪辑时间轴。main=顺序追加到主轨；overlay=放到视频轨2/3，可指定 start_sec。支持设置素材入点、成片时长、速度和原声音量。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '本地素材绝对路径' },
        canvas_node_id: { type: 'string', description: '可选画布节点 ID；未传 path 时自动读取节点本地文件' },
        track: { type: 'string', enum: ['main', 'overlay'], description: '默认 main；需要任意时间位置或叠加合成时用 overlay' },
        overlay_track: { type: 'number', description: '叠加轨索引，0=视频轨2，1=视频轨3' },
        start_sec: { type: 'number', description: 'overlay 的时间轴起点；main 只能等于当前主轨末尾' },
        in_sec: { type: 'number', description: '素材入点（秒）' },
        duration: { type: 'number', description: '加入成片后的持续时间（秒）' },
        speed: { type: 'number', description: '播放速度 0.1-4，默认 1' },
        volume: { type: 'number', description: '视频原声音量 0-2' },
        label: { type: 'string' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const nodeId = String(params.canvas_node_id ?? '').trim();
    const node = nodeId ? useCanvasStore.getState().nodes.find((item) => item.id === nodeId) : undefined;
    const nodeData = node?.data as Record<string, unknown> | undefined;
    const path = String(params.path ?? nodeData?.localPath ?? '').trim();
    if (!path) return { success: false, output: '', error: '需要 path，或提供带本地文件的 canvas_node_id' };

    const track = params.track === 'overlay' ? 'overlay' : 'main';
    const speed = Math.max(0.1, Math.min(4, Number(params.speed ?? 1) || 1));
    const inSec = Math.max(0, Number(params.in_sec ?? 0) || 0);
    const requestedDuration = Number(params.duration);
    const volume = params.volume == null ? undefined : Math.max(0, Math.min(2, Number(params.volume) || 0));
    const label = String(params.label ?? nodeData?.description ?? '').trim() || undefined;
    const store = useEditorStore.getState();

    if (track === 'overlay') {
      if (Math.abs(speed - 1) > 0.001) {
        return { success: false, output: '', error: '叠加视频轨当前不支持独立变速。请先在主轨变速或生成变速后的素材，再以 speed=1 加入 overlay。' };
      }
      const trackIndex = Number(params.overlay_track) === 1 ? 1 : 0;
      const kind = /\.(?:png|jpe?g|webp|gif|bmp)(?:[?#].*)?$/i.test(path) ? 'image' : 'video';
      const id = await store.addOverlayClip({
        path,
        kind,
        trackIndex,
        label,
        startSec: Math.max(0, Number(params.start_sec ?? store.playheadSec) || 0),
      });
      const current = useEditorStore.getState().overlayClips.find((clip) => clip.id === id);
      if (current) {
        const maxSource = Math.max(0.1, current.duration);
        const nextIn = Math.min(inSec, Math.max(0, maxSource - 0.1));
        const desiredSourceLength = Number.isFinite(requestedDuration) && requestedDuration > 0
          ? requestedDuration * speed
          : maxSource - nextIn;
        useEditorStore.getState().updateOverlayClip(id, {
          inSec: nextIn,
          outSec: Math.min(maxSource, nextIn + Math.max(0.1, desiredSourceLength)),
          ...(Number.isFinite(requestedDuration) && requestedDuration > 0 ? { duration: requestedDuration } : {}),
          ...(volume != null ? { volume } : {}),
        });
      }
      const clip = useEditorStore.getState().overlayClips.find((item) => item.id === id);
      if (clip) useEditorStore.getState().setPlayhead(clip.startSec);
      await flushTimelineMutation();
      return { success: true, output: clip ? clipReceipt(`视频轨${trackIndex + 2}素材`, id, clip.startSec, Math.max(0.1, (clip.outSec - clip.inSec) / speed)) : `素材已加入，clip_id: ${id}` };
    }

    const appendAt = store.totalDuration();
    if (params.start_sec != null && Math.abs(Number(params.start_sec) - appendAt) > 0.05) {
      return {
        success: false,
        output: JSON.stringify({ requested_start_sec: Number(params.start_sec), main_track_append_sec: Number(appendAt.toFixed(3)) }),
        error: '主轨是顺序轨，不能留空隙放到任意秒。要指定 start_sec，请把 track 改为 overlay；要放主轨，请省略 start_sec 或使用当前主轨末尾。',
      };
    }
    const [id] = await store.addClips([{ path, label, sourceNodeId: nodeId || undefined }]);
    const current = useEditorStore.getState().clips.find((clip) => clip.id === id);
    if (!current) return { success: false, output: '', error: '素材探测完成后未能写入主轨' };
    const nextIn = Math.min(inSec, Math.max(0, current.duration - 0.1));
    const desiredSourceLength = Number.isFinite(requestedDuration) && requestedDuration > 0
      ? requestedDuration * speed
      : current.duration - nextIn;
    useEditorStore.getState().updateClip(id, {
      inSec: nextIn,
      outSec: Math.min(current.duration, nextIn + Math.max(0.1, desiredSourceLength)),
      speed,
      ...(volume != null ? { volume } : {}),
    });
    useEditorStore.getState().setPlayhead(appendAt);
    await flushTimelineMutation();
    const clip = useEditorStore.getState().clips.find((item) => item.id === id)!;
    return { success: true, output: clipReceipt('主轨素材', id, appendAt, useEditorStore.getState().clipLength(clip)) };
  },
};

const reorderTool: Tool = {
  definition: {
    name: 'timeline_reorder',
    description: '调整片段顺序。传 clip_id+new_index 移动单段，或传 order 数组整体重排。',
    parameters: {
      type: 'object',
      properties: {
        clip_id: { type: 'string' },
        new_index: { type: 'number', description: '目标位置（0 起）' },
        order: { type: 'array', items: { type: 'string' }, description: '完整的 clip_id 顺序数组（整体重排）' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    const order = params.order as string[] | undefined;
    if (order?.length) {
      s.setOrder(order);
      return { success: true, output: '已按指定顺序重排' };
    }
    const clipId = params.clip_id as string | undefined;
    const newIndex = params.new_index as number | undefined;
    if (!clipId || newIndex == null) return { success: false, output: '', error: '需要 clip_id+new_index 或 order' };
    s.reorderClip(clipId, newIndex);
    return { success: true, output: `已把 ${clipId} 移到位置 ${newIndex}` };
  },
};

function mainClipRange(clipId: string): { start: number; end: number } | null {
  const s = useEditorStore.getState();
  let cursor = 0;
  for (const clip of s.clips) {
    const len = s.clipLength(clip);
    if (clip.id === clipId) return { start: cursor, end: cursor + len };
    cursor += len;
  }
  return null;
}

function findMainClipAtTimeline(sec: number): { clipId: string; sourceSec: number; atClipSec: number } | null {
  const s = useEditorStore.getState();
  let cursor = 0;
  for (const clip of s.clips) {
    const len = s.clipLength(clip);
    if (sec >= cursor && sec <= cursor + len) {
      const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
      const atClipSec = Math.max(0, (sec - cursor) * speed);
      return { clipId: clip.id, sourceSec: clip.inSec + atClipSec, atClipSec };
    }
    cursor += len;
  }
  return null;
}

function rowByIdOrLabel<T extends { id: string; label: string }>(rows: T[], idOrLabel: string): T | undefined {
  return rows.find((row) => row.id === idOrLabel || row.label === idOrLabel);
}

function transcriptRowLine(row: {
  id: string;
  label: string;
  sentenceId: string;
  clipIndex: number;
  timelineStart: number;
  timelineEnd: number;
  sourceStart: number;
  sourceEnd: number;
  deleted?: boolean;
  rowDeleted?: boolean;
  sentenceDeleted?: boolean;
  silence?: boolean;
  clipped?: boolean;
  text: string;
}): string {
  const flags = [
    row.deleted ? (row.rowDeleted ? '已标删(row)' : row.sentenceDeleted ? '已标删(sentence旧)' : '已标删') : '',
    row.silence ? '无人声/无字幕' : '',
    row.clipped ? '局部' : '',
  ].filter(Boolean).join(',');
  return [
    `[row_id:${row.id}] [label:${row.label}] [sent:${row.sentenceId}]`,
    `时间轴${row.timelineStart.toFixed(2)}-${row.timelineEnd.toFixed(2)}s`,
    `源${row.sourceStart.toFixed(2)}-${row.sourceEnd.toFixed(2)}s`,
    flags ? `（${flags}）` : '',
    row.text,
    `建议: cut_rows(row_ids:["${row.id}"])；或 trim(row_id:"${row.id}", trim_mode:"to_row")`,
  ].filter(Boolean).join(' ');
}

function redundancyIssueLine(issue: {
  type: string;
  severity: string;
  labels: string[];
  rowIds: string[];
  timelineStart: number;
  timelineEnd: number;
  message: string;
  suggestion: string;
  score?: number;
}): string {
  return [
    `[${issue.severity}] ${issue.type}`,
    `时间轴${issue.timelineStart.toFixed(2)}-${issue.timelineEnd.toFixed(2)}s`,
    `行:${issue.labels.join(' / ')}`,
    issue.score != null ? `分数:${issue.score}` : '',
    issue.message,
    `建议:${issue.suggestion}`,
    `row_ids:${JSON.stringify(issue.rowIds)}`,
  ].filter(Boolean).join(' ');
}

function rhythmBinLine(bin: {
  start: number;
  end: number;
  density: number;
  fillerRatio: number;
  rowCount: number;
  labels: string[];
  snippets: string[];
}): string {
  const barLen = Math.max(1, Math.min(24, Math.round(bin.density * 2)));
  const bar = '█'.repeat(barLen);
  const note = bin.fillerRatio >= 0.25 ? '填充词偏多' : bin.density < 1 ? '偏空/停顿' : bin.density > 8 ? '过密' : '正常';
  return `${bin.start.toFixed(1)}-${bin.end.toFixed(1)}s ${bar.padEnd(24, '░')} 密度${bin.density}/s ${note} 行:${bin.labels.join(',') || '-'} ${bin.snippets.join(' | ')}`;
}

const trimTool: Tool = {
  definition: {
    name: 'timeline_trim',
    description: '裁剪片段：设置入点/出点（秒，相对于素材原始时长）。也可传 row_id/label，按文稿行语义化裁剪，避免手算句子边界。',
    parameters: {
      type: 'object',
      properties: {
        clip_id: { type: 'string' },
        in_sec: { type: 'number' },
        out_sec: { type: 'number' },
        row_id: { type: 'string', description: '来自 timeline_transcript read 的 row_id 或 label，如 片段3/句2' },
        trim_mode: { type: 'string', enum: ['to_row', 'start_to_row', 'end_to_row'], description: 'to_row=片段只保留该文稿行；start_to_row=入点改到该行开始；end_to_row=出点改到该行结束' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const rowId = params.row_id as string | undefined;
    if (rowId) {
      const ops = await import('@/lib/editor/transcriptOps');
      const rows = ops.buildTranscriptTimelineRows();
      const row = rowByIdOrLabel(rows, rowId);
      if (!row) return { success: false, output: '', error: `没有找到文稿行 ${rowId}。请先 timeline_transcript read 获取最新 row_id。` };
      const mode = (params.trim_mode as string | undefined) ?? 'to_row';
      captureEditorSnapshot();
      const inSec = mode === 'end_to_row' ? undefined : row.sourceStart;
      const outSec = mode === 'start_to_row' ? undefined : row.sourceEnd;
      useEditorStore.getState().trimClip(row.clipId, inSec, outSec);
      return {
        success: true,
        output: `已按 ${row.label} 裁剪 ${row.clipId}：${mode}，源 ${row.sourceStart.toFixed(2)}-${row.sourceEnd.toFixed(2)}s，时间轴 ${row.timelineStart.toFixed(2)}-${row.timelineEnd.toFixed(2)}s。文本：${row.text}`,
      };
    }
    const clipId = params.clip_id as string | undefined;
    if (!clipId) return { success: false, output: '', error: '需要 clip_id，或传 row_id 进行文稿行裁剪' };
    captureEditorSnapshot();
    useEditorStore.getState().trimClip(clipId, params.in_sec as number | undefined, params.out_sec as number | undefined);
    const range = mainClipRange(clipId);
    return { success: true, output: `裁剪已应用${range ? `；当前时间轴位置约 ${range.start.toFixed(2)}-${range.end.toFixed(2)}s` : ''}` };
  },
};

const transitionTool: Tool = {
  definition: {
    name: 'timeline_set_transition',
    description: '设置片段与下一段之间的转场。',
    parameters: {
      type: 'object',
      properties: {
        clip_id: { type: 'string' },
        type: { type: 'string', description: `cut=硬切，或转场预设 id：${TRANSITION_PRESETS.map((t) => `${t.id}=${t.label}`).join('，')}` },
        duration: { type: 'number', description: '转场时长（秒），默认 0.5' },
      },
      required: ['clip_id', 'type'],
    },
  },
  risk: 'safe',
  async execute(params) {
    useEditorStore.getState().setTransition(
      params.clip_id as string,
      params.type as string,
      (params.duration as number | undefined) ?? 0.5,
    );
    return { success: true, output: '转场已设置' };
  },
};

const bgmTool: Tool = {
  definition: {
    name: 'timeline_add_bgm',
    description: '挂载背景音乐（本地音频文件路径）。传空 path 移除 BGM。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        volume: { type: 'number', description: '0-1，默认 0.3' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const path = params.path as string | undefined;
    if (!path) {
      useEditorStore.getState().setBgm(null);
      return { success: true, output: 'BGM 已移除' };
    }
    useEditorStore.getState().setBgm({
      path,
      label: path.split('/').pop() ?? 'BGM',
      volume: (params.volume as number | undefined) ?? 0.3,
    });
    return { success: true, output: `BGM 已挂载: ${path.split('/').pop()}` };
  },
};

const removeClipTool: Tool = {
  definition: {
    name: 'timeline_remove_clip',
    description: '从时间轴移除一个片段。',
    parameters: { type: 'object', properties: { clip_id: { type: 'string' } }, required: ['clip_id'] },
  },
  risk: 'safe',
  async execute(params) {
    useEditorStore.getState().removeClip(params.clip_id as string);
    return { success: true, output: '片段已移除' };
  },
};


const splitTool: Tool = {
  definition: {
    name: 'timeline_split',
    description: '把主视频片段一切为二。推荐优先用 source_sec（源素材秒）或 timeline_sec（时间轴秒），避免手算片段内相对秒；at_sec 兼容旧用法，表示片段内源素材相对秒。',
    parameters: {
      type: 'object',
      properties: {
        clip_id: { type: 'string', description: '指定要切的片段；使用 timeline_sec 时可省略，系统会自动找命中的主轨片段' },
        at_sec: { type: 'number', description: '旧用法：片段内源素材相对秒，即 source_sec - clip.in_sec' },
        source_sec: { type: 'number', description: '源素材绝对秒。系统自动换算为片段内切点' },
        timeline_sec: { type: 'number', description: '时间轴节目秒。系统自动找到命中的主轨片段并换算' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    let clipId = params.clip_id as string | undefined;
    let atSec = params.at_sec as number | undefined;
    let sourceSec = params.source_sec as number | undefined;
    if (params.timeline_sec != null) {
      const hit = findMainClipAtTimeline(params.timeline_sec as number);
      if (!hit) return { success: false, output: '', error: `时间轴 ${params.timeline_sec}s 没有命中主视频片段` };
      clipId = clipId ?? hit.clipId;
      if (clipId !== hit.clipId) return { success: false, output: '', error: `timeline_sec 命中 ${hit.clipId}，但传入 clip_id 是 ${clipId}` };
      atSec = hit.atClipSec;
      sourceSec = hit.sourceSec;
    }
    if (!clipId) return { success: false, output: '', error: '需要 clip_id+at_sec/source_sec，或 timeline_sec' };
    const clip = s.clips.find((c) => c.id === clipId);
    if (!clip) return { success: false, output: '', error: `片段不存在：${clipId}` };
    if (sourceSec != null) atSec = sourceSec - clip.inSec;
    if (atSec == null) return { success: false, output: '', error: '需要 at_sec、source_sec 或 timeline_sec 之一' };
    if (atSec <= 0.08 || atSec >= clip.outSec - clip.inSec - 0.08) {
      return { success: false, output: '', error: `切点超出片段有效范围。片段源范围 ${clip.inSec.toFixed(2)}-${clip.outSec.toFixed(2)}s，收到 ${sourceSec != null ? `source_sec=${sourceSec}` : `at_sec=${atSec}`}` };
    }
    captureEditorSnapshot();
    const rightId = s.splitClip(clipId, atSec);
    if (!rightId) return { success: false, output: '', error: '片段不存在' };
    const cutSource = clip.inSec + atSec;
    const range = mainClipRange(clipId);
    return { success: true, output: `已切分 ${clipId}，源素材 ${cutSource.toFixed(2)}s${range ? `，时间轴约 ${range.start.toFixed(2)}-${range.end.toFixed(2)}s` : ''}；右半段 clip_id: ${rightId}` };
  },
};

const splitAtPlayheadTool: Tool = {
  definition: {
    name: 'timeline_split_at_playhead',
    description: '在当前播放头位置分割所有命中的未锁定轨道对象：主视频、花字、特效、画中画、音频、字幕。适合用户说“这里切一刀/按播放头切开”。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    captureEditorSnapshot();
    const ids = useEditorStore.getState().splitAtPlayhead();
    return { success: true, output: ids.length ? `已在播放头切开 ${ids.length} 个对象：${ids.join(', ')}` : '播放头附近没有可切开的对象' };
  },
};

const transcribeTool: Tool = {
  definition: {
    name: 'timeline_transcribe',
    description: '对时间轴做语音转写并生成字幕轨（调用 ASR，花钱操作）。快路径：先把当前时间轴整体导出为一条临时音频（视频会自动抽音频，切碎/重排/变速都会体现在音频里），再只转写这条音频，字幕时间戳天然对齐当前时间轴。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'ask',
  async execute() {
    const s = useEditorStore.getState();
    if (s.clips.length === 0) return { success: false, output: '', error: '时间轴为空' };
    s.setTranscribing(true);
    try {
      const { transcribeEditorTimelineAudio } = await import('@/lib/editor/transcribe');
      const cues = await transcribeEditorTimelineAudio((status) => {
        useEditorStore.getState().setTranscribing(true);
        console.log(`[timeline_transcribe] ${status}`);
      });
      useEditorStore.getState().setSubtitles(cues);
      return {
        success: true,
        output: `已按整条时间轴音频转写，生成 ${cues.length} 条字幕。\n${cues.slice(0, 10).map((c) => `[${c.startSec.toFixed(1)}-${c.endSec.toFixed(1)}] ${c.text}`).join('\n')}${cues.length > 10 ? '\n…' : ''}`,
      };
    } finally {
      useEditorStore.getState().setTranscribing(false);
    }
  },
};

const transcribeSegmentTool: Tool = {
  definition: {
    name: 'timeline_transcribe_segment',
    description: `单独转写某个片段或某段时间（调用 ASR，花钱操作）。用于精修/复核：例如只识别某个 clip、某个源文件 12-18 秒、或时间轴 35-42 秒。不会默认覆盖整条字幕轨；write_subtitles=true 时才把结果追加/写入字幕轨。`,
    parameters: {
      type: 'object',
      properties: {
        clip_id: { type: 'string', description: '可选，时间轴片段 id。传它时可按该片段的 source/timeline 时间段转写' },
        path: { type: 'string', description: '可选，源媒体绝对路径。没有 clip_id 时使用' },
        start_sec: { type: 'number', description: '起点秒。time_base=timeline 时为时间轴秒；time_base=source 时为源文件秒；不传则用片段/源文件起点' },
        end_sec: { type: 'number', description: '终点秒。不传则用片段/源文件终点' },
        time_base: { type: 'string', enum: ['timeline', 'source'], description: 'start_sec/end_sec 的坐标系。默认：有 clip_id/path 时用 source；只有时间范围时用 timeline' },
        write_subtitles: { type: 'boolean', description: '是否把识别结果写入字幕轨。默认 false，只返回文本' },
        replace_subtitles_in_range: { type: 'boolean', description: 'write_subtitles=true 时，是否先删除该时间范围内旧字幕。默认 true' },
      },
      required: [],
    },
  },
  risk: 'ask',
  async execute(params) {
    const state = useEditorStore.getState();
    if (state.clips.length === 0 && !params.path) return { success: false, output: '', error: '时间轴为空，且没有提供 path' };
    const { transcribeFileRange, transcribeFile } = await import('@/lib/editor/transcribe');
    const { nanoid } = await import('nanoid');
    const requestedBase = params.time_base as 'timeline' | 'source' | undefined;
    const writeSubtitles = Boolean(params.write_subtitles);
    const replaceInRange = (params.replace_subtitles_in_range as boolean | undefined) ?? true;

    type Job = {
      path: string;
      sourceStart: number;
      sourceEnd?: number;
      timelineStart?: number;
      clipIn?: number;
      speed?: number;
      label: string;
    };

    const jobs: Job[] = [];
    if (params.clip_id) {
      const clip = state.clips.find((c) => c.id === params.clip_id);
      if (!clip) return { success: false, output: '', error: `没有找到 clip_id=${params.clip_id}` };
      const timeBase = requestedBase ?? 'source';
      let cursor = 0;
      for (const c of state.clips) {
        if (c.id === clip.id) break;
        cursor += state.clipLength(c);
      }
      const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
      if (timeBase === 'timeline') {
        const clipTlStart = cursor;
        const clipTlEnd = cursor + state.clipLength(clip);
        const a = Math.max(clipTlStart, params.start_sec as number | undefined ?? clipTlStart);
        const b = Math.min(clipTlEnd, params.end_sec as number | undefined ?? clipTlEnd);
        if (b <= a) return { success: false, output: '', error: '指定时间段与该片段没有重叠' };
        jobs.push({
          path: clip.path,
          sourceStart: clip.inSec + (a - clipTlStart) * speed,
          sourceEnd: clip.inSec + (b - clipTlStart) * speed,
          timelineStart: a,
          clipIn: clip.inSec,
          speed,
          label: clip.label,
        });
      } else {
        const sourceStart = Math.max(clip.inSec, params.start_sec as number | undefined ?? clip.inSec);
        const sourceEnd = Math.min(clip.outSec, params.end_sec as number | undefined ?? clip.outSec);
        if (sourceEnd <= sourceStart) return { success: false, output: '', error: '源时间段无效' };
        jobs.push({
          path: clip.path,
          sourceStart,
          sourceEnd,
          timelineStart: cursor + (sourceStart - clip.inSec) / speed,
          clipIn: clip.inSec,
          speed,
          label: clip.label,
        });
      }
    } else if (params.path) {
      const sourceStart = Math.max(0, params.start_sec as number | undefined ?? 0);
      const sourceEnd = params.end_sec as number | undefined;
      if (sourceEnd != null && sourceEnd <= sourceStart) return { success: false, output: '', error: '源时间段无效' };
      jobs.push({ path: params.path as string, sourceStart, sourceEnd, label: String(params.path).split('/').pop() || '源媒体' });
    } else {
      const start = Math.max(0, params.start_sec as number | undefined ?? state.playheadSec ?? 0);
      const end = params.end_sec as number | undefined ?? Math.min(state.totalDuration(), start + 10);
      if (end <= start) return { success: false, output: '', error: '时间轴时间段无效' };
      let cursor = 0;
      for (const clip of state.clips) {
        const len = state.clipLength(clip);
        const tlA = cursor;
        const tlB = cursor + len;
        const a = Math.max(start, tlA);
        const b = Math.min(end, tlB);
        const speed = clip.speed && clip.speed > 0 ? clip.speed : 1;
        if (b > a) {
          jobs.push({
            path: clip.path,
            sourceStart: clip.inSec + (a - tlA) * speed,
            sourceEnd: clip.inSec + (b - tlA) * speed,
            timelineStart: a,
            clipIn: clip.inSec,
            speed,
            label: clip.label,
          });
        }
        cursor = tlB;
      }
      if (jobs.length === 0) return { success: false, output: '', error: '该时间轴范围内没有主视频片段' };
    }

    const cues: { id: string; startSec: number; endSec: number; text: string }[] = [];
    const lines: string[] = [];
    for (const job of jobs) {
      const raw = job.sourceEnd == null
        ? await transcribeFile(job.path)
        : await transcribeFileRange(job.path, job.sourceStart, Math.max(0.2, job.sourceEnd - job.sourceStart));
      for (const cue of raw) {
        const cueStart = cue.startSec;
        const cueEnd = cue.endSec;
        const startSec = job.timelineStart != null && job.clipIn != null
          ? job.timelineStart + (cueStart - job.sourceStart) / (job.speed ?? 1)
          : cueStart;
        const endSec = job.timelineStart != null && job.clipIn != null
          ? job.timelineStart + (cueEnd - job.sourceStart) / (job.speed ?? 1)
          : cueEnd;
        const mapped = { id: `sub-${nanoid(6)}`, startSec, endSec: Math.max(startSec + 0.1, endSec), text: cue.text };
        cues.push(mapped);
        lines.push(`[${mapped.startSec.toFixed(2)}-${mapped.endSec.toFixed(2)}] ${mapped.text}`);
      }
    }

    if (writeSubtitles && cues.length > 0) {
      captureEditorSnapshot();
      const current = useEditorStore.getState().subtitles;
      const minStart = Math.min(...cues.map((c) => c.startSec));
      const maxEnd = Math.max(...cues.map((c) => c.endSec));
      const kept = replaceInRange
        ? current.filter((c) => c.endSec <= minStart || c.startSec >= maxEnd)
        : current;
      useEditorStore.getState().setSubtitles([...kept, ...cues].sort((a, b) => a.startSec - b.startSec));
    }

    return {
      success: true,
      output: [
        `片段转写完成：${jobs.length} 段，识别 ${cues.length} 条${writeSubtitles ? '，已写入字幕轨' : ''}。`,
        lines.join('\n') || '未识别到语音内容',
      ].join('\n'),
    };
  },
};

const subtitleEditTool: Tool = {
  definition: {
    name: 'timeline_subtitle_edit',
    description: '字幕编辑。op=add 新增一条；op=update 改文字/时刻；op=remove 删除；op=shift 把 from_sec 之后的字幕整体平移 delta_sec 秒；op=clear 清空。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['add', 'update', 'remove', 'shift', 'clear'] },
        id: { type: 'string', description: 'update/remove 时的字幕 id' },
        text: { type: 'string' },
        start_sec: { type: 'number' },
        end_sec: { type: 'number' },
        from_sec: { type: 'number', description: 'shift 起点（默认 0）' },
        delta_sec: { type: 'number', description: 'shift 平移量（可为负）' },
      },
      required: ['op'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    const op = params.op as string;
    if (op === 'add') {
      if (params.text == null || params.start_sec == null || params.end_sec == null) {
        return { success: false, output: '', error: 'add 需要 text/start_sec/end_sec' };
      }
      const id = s.addSubtitle({ startSec: params.start_sec as number, endSec: params.end_sec as number, text: params.text as string });
      return { success: true, output: `已新增字幕 ${id}` };
    }
    if (op === 'update') {
      if (!params.id) return { success: false, output: '', error: 'update 需要 id' };
      s.updateSubtitle(params.id as string, {
        ...(params.text != null ? { text: params.text as string } : {}),
        ...(params.start_sec != null ? { startSec: params.start_sec as number } : {}),
        ...(params.end_sec != null ? { endSec: params.end_sec as number } : {}),
      });
      return { success: true, output: '字幕已更新' };
    }
    if (op === 'remove') {
      if (!params.id) return { success: false, output: '', error: 'remove 需要 id' };
      s.removeSubtitle(params.id as string);
      return { success: true, output: '字幕已删除' };
    }
    if (op === 'shift') {
      s.shiftSubtitles((params.from_sec as number | undefined) ?? 0, (params.delta_sec as number | undefined) ?? 0);
      return { success: true, output: '字幕已平移' };
    }
    s.setSubtitles([]);
    return { success: true, output: '字幕已清空' };
  },
};

const addAudioTool: Tool = {
  definition: {
    name: 'timeline_add_audio',
    description: '向音频轨添加素材：track=bgm（默认循环、音量 0.3）/sfx 音效/voice 旁白。start_sec 为时间轴位置。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        track: { type: 'string', enum: ['bgm', 'sfx', 'voice'] },
        start_sec: { type: 'number' },
        volume: { type: 'number', description: '0-1' },
        in_sec: { type: 'number', description: '音频素材入点（秒）' },
        duration: { type: 'number', description: '时间轴持续时间（秒）' },
        loop: { type: 'boolean', description: '是否循环；bgm 默认 true' },
        fade_in_sec: { type: 'number' },
        fade_out_sec: { type: 'number' },
      },
      required: ['path'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const track = params.track === 'sfx' || params.track === 'voice' ? params.track : 'bgm';
    const id = await useEditorStore.getState().addAudioClip(
      track,
      {
        path: params.path as string,
        startSec: params.start_sec as number | undefined,
        volume: params.volume as number | undefined,
        loop: params.loop as boolean | undefined,
      },
    );
    const s = useEditorStore.getState();
    const clip = s.audioClips.find((a) => a.id === id);
    if (clip) {
      const nextIn = Math.max(0, Math.min(Number(params.in_sec ?? 0) || 0, Math.max(0, clip.duration - 0.1)));
      const wantedDuration = Number(params.duration);
      s.updateAudioClip(id, {
        inSec: nextIn,
        outSec: Number.isFinite(wantedDuration) && wantedDuration > 0
          ? Math.min(clip.duration, nextIn + wantedDuration)
          : clip.duration,
        ...(params.fade_in_sec != null ? { fadeInSec: Math.max(0, Number(params.fade_in_sec) || 0) } : {}),
        ...(params.fade_out_sec != null ? { fadeOutSec: Math.max(0, Number(params.fade_out_sec) || 0) } : {}),
      });
    }
    const updated = useEditorStore.getState().audioClips.find((a) => a.id === id);
    if (updated) s.setPlayhead(updated.startSec);
    await flushTimelineMutation();
    return { success: true, output: updated ? clipReceipt(`音频（${track} 轨）`, id, updated.startSec, Math.max(0.1, updated.outSec - updated.inSec || updated.duration || 0)) : `音频已加入（${track} 轨），audio_clip_id: ${id}` };
  },
};

const setAspectTool: Tool = {
  definition: {
    name: 'timeline_set_aspect',
    description: '设置成片画幅。支持 16:9 横屏、9:16 竖屏、1:1 方形、4:3、3:4、21:9 宽银幕；预览、导出和剪映草稿都会按该画幅处理。',
    parameters: {
      type: 'object',
      properties: { aspect: { type: 'string', enum: [...EDITOR_ASPECTS] } },
      required: ['aspect'],
    },
  },
  risk: 'safe',
  async execute(params) {
    if (!isEditorAspect(params.aspect)) throw new Error(`不支持的画幅：${params.aspect}`);
    useEditorStore.getState().setAspect(params.aspect);
    return { success: true, output: `画幅已设为 ${params.aspect}` };
  },
};

const setExportTool: Tool = {
  definition: {
    name: 'timeline_set_export',
    description: '设置时间线导出参数，不立即开始导出。可设置分辨率、帧率、码率、编码器、格式、背景和音频处理。',
    parameters: {
      type: 'object',
      properties: {
        resolution: { type: 'string', enum: ['720p', '1080p', '2k', '4k'] },
        fps: { type: 'number', description: '24、30 或 60' },
        bitrate: { type: 'string', enum: ['low', 'medium', 'high'] },
        encoder: { type: 'string', enum: ['auto', 'h264', 'hevc'] },
        format: { type: 'string', enum: ['mp4', 'mov_alpha'] },
        background: { type: 'string', enum: ['black', 'transparent'] },
        loudnorm: { type: 'boolean' },
        denoise: { type: 'boolean' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const fps = Number(params.fps);
    if (params.fps != null && fps !== 24 && fps !== 30 && fps !== 60) {
      return { success: false, output: '', error: 'fps 只支持 24、30、60' };
    }
    const patch = Object.fromEntries(Object.entries({
      resolution: params.resolution,
      fps: params.fps == null ? undefined : fps,
      bitrate: params.bitrate,
      encoder: params.encoder,
      format: params.format,
      background: params.background,
      loudnorm: params.loudnorm,
      denoise: params.denoise,
    }).filter(([, value]) => value !== undefined));
    if (Object.keys(patch).length === 0) return { success: false, output: '', error: '至少提供一项导出参数' };
    useEditorStore.getState().setExportSettings(patch);
    await flushTimelineMutation();
    return { success: true, output: JSON.stringify({ updated: patch, export_settings: useEditorStore.getState().exportSettings }, null, 2) };
  },
};

const exportTool: Tool = {
  definition: {
    name: 'timeline_export',
    description: '导出时间轴：mp4=新版剪辑导出引擎合成成片；jianying=生成剪映草稿工程。兼容旧工具名，新任务优先使用 timeline_export_analyze + timeline_export_video。',
    parameters: {
      type: 'object',
      properties: {
        format: { type: 'string', enum: ['mp4', 'jianying'] },
        burn_subtitles: { type: 'boolean', description: '把字幕轨烧录进成片（仅 mp4）' },
      },
      required: ['format'],
    },
  },
  risk: 'ask',
  async execute(params, signal) {
    const s = useEditorStore.getState();
    if (s.totalDuration() <= 0.05) return { success: false, output: '', error: '时间轴为空' };
    if (params.format === 'jianying') {
      const { exportEditorToJianying } = await import('@/lib/export/jianying');
      const draft = await exportEditorToJianying();
      return { success: true, output: `剪映草稿已导出: ${draft}（重启剪映后在草稿列表可见）` };
    }
    return exportVideoTool.execute({}, signal);
  },
};

// ── v3：花字 / 特效 / 画中画 / 变速调色 / 智能剪口播 / 模板 / 踩点 ─────────────

const addTextTool: Tool = {
  definition: {
    name: 'timeline_add_text',
    description: `添加花字/文本卡（落花字轨）。注意：花字模板是用户 UI 面板的素材库——只在用户明确点名要"花字/某个花字模板"时使用；你自己做视觉设计时用 timeline_add_scene 原创，不要默认用花字。可用模板：\n${textTemplatesDoc()}`,
    parameters: {
      type: 'object',
      properties: {
        text: { type: 'string' },
        template_id: { type: 'string', description: '花字模板 id' },
        start_sec: { type: 'number' },
        end_sec: { type: 'number' },
        position: { type: 'string', enum: ['top', 'center', 'bottom'], description: '默认 center' },
        color: { type: 'string', description: '主色 hex（可选，默认随主题）' },
        accent: { type: 'string', description: '强调色 hex（可选）' },
      },
      required: ['text', 'template_id', 'start_sec', 'end_sec'],
    },
  },
  risk: 'safe',
  async execute(params) {
    if (!findTextTemplate(params.template_id as string)) {
      return { success: false, output: '', error: `未知模板 ${params.template_id}，可用：${TEXT_TEMPLATES.map((t) => t.id).join(', ')}` };
    }
    captureEditorSnapshot();
    const color = params.color as string | undefined;
    const accent = params.accent as string | undefined;
    const id = useEditorStore.getState().addTextClip({
      text: params.text as string,
      templateId: params.template_id as string,
      startSec: params.start_sec as number,
      endSec: params.end_sec as number,
      position: (params.position as 'top' | 'center' | 'bottom' | undefined) ?? 'center',
      ...(color || accent ? { styleOverrides: { ...(color ? { color } : {}), ...(accent ? { accent } : {}) } } : {}),
    });
    useEditorStore.getState().setPlayhead(params.start_sec as number);
    await flushTimelineMutation();
    return { success: true, output: clipReceipt('花字', id, params.start_sec as number, Math.max(0.2, (params.end_sec as number) - (params.start_sec as number))) };
  },
};

const addFxTool: Tool = {
  definition: {
    name: 'timeline_add_fx',
    description: `添加特效（落特效轨）。**注意：page_template_id 页面模板和 component_id 组件是用户 UI 面板的素材库，不是你做设计的工具**——只在用户明确点名"用某个页面模板/某个组件"时调用。你自己做 AE/MG 动画、口播包装、信息页、品牌页时一律用 timeline_add_scene 原创设计（确定性运动原语，预览导出逐帧一致）。scene 表达不了的自由 DOM（复刻具体官网等）用 timeline_add_free_page。\n\n三种模式：\n1. page_template_id：整屏页面模板（用户点名时用）\n2. component_id：参数化小组件（用户点名时用）\n3. html+css（旧兜底）：简单 CSS 特效\n\n可用页面模板：\n${pageTemplatesDoc()}\n\n可用特效组件：\n${fxComponentsDoc()}`,
    parameters: {
      type: 'object',
      properties: {
        page_template_id: { type: 'string', description: '页面模板 id，格式 {layout}__{style}，如 hero-center__linear（优先用这个展示信息）' },
        page_params: { type: 'object', description: '页面参数：title/subtitle/body/items(string[])/data({label,value}[])/quote/author/price/originalPrice/cta/steps(string[])/code/stats({value,label}[])' },
        component_id: { type: 'string', description: '特效组件 id（轻量叠加动效）' },
        params: { type: 'object', description: '组件参数，见组件列表说明' },
        theme: { type: 'string', description: `配色主题 id，必须根据内容风格选择。可用：${fxThemesDoc()}。风格→主题映射：干货教学→techblue/indigo，情感叙事→coral/sakura/lavender，带货促销→vividorange/crimson/amber，生活Vlog→mint/glacier/forest，数码评测→slate/neon/techblue，时尚美妆→rosegold/candy/mocha，文艺复古→paper/mocha/olive，奢华质感→blackgold/midnight/rosegold。不要无脑默认 blackgold——每个视频都值得一个为它选择的主题` },
        html: { type: 'string', description: '自由模式 html（与 component_id/page_template_id 三选一）' },
        css: { type: 'string', description: '自由模式 css' },
        label: { type: 'string', description: '片段显示名' },
        start_sec: { type: 'number' },
        duration: { type: 'number', description: '建议 2-5 秒' },
        client_token: { type: 'string', description: '可选幂等键。同一次意图重试时保持不变，工具会返回已有对象而不重复添加' },
      },
      required: ['start_sec', 'duration'],
    },
  },
  risk: 'safe',
  async execute(params) {
    let html: string;
    let css: string;
    let componentId: string | undefined;
    let clipParams: Record<string, unknown> | undefined;
    if (params.page_template_id) {
      const tpl = findPageTemplate(params.page_template_id as string);
      if (!tpl) return { success: false, output: '', error: `未知页面模板 ${params.page_template_id}，格式须为 {布局}__{风格}，如 hero-center__linear` };
      const pageParams = (params.page_params as Record<string, unknown>) ?? {};
      const built = tpl.render(pageParams, params.theme as string | undefined);
      componentId = `page:${tpl.id}`;
      html = built.html;
      css = built.css;
      clipParams = pageParams;
    } else if (params.component_id) {
      const def = findFxComponent(params.component_id as string);
      if (!def) return { success: false, output: '', error: `未知组件 ${params.component_id}` };
      ({ html, css } = def.render((params.params as Record<string, unknown>) ?? {}, params.theme as string | undefined));
      componentId = def.id;
      clipParams = params.params as Record<string, unknown> | undefined;
    } else if (params.html && params.css) {
      const v = validateFx(params.html as string, params.css as string);
      if (!v.ok) return { success: false, output: '', error: `特效校验未通过：${v.violations.join('；')}` };
      if (v.warnings.length) console.warn('[timeline_add_fx] 美学建议：', v.warnings.join('；'));
      html = params.html as string;
      css = params.css as string;
    } else {
      return { success: false, output: '', error: '需要 page_template_id+page_params 或 component_id+params 或 html+css' };
    }
    const startSec = params.start_sec as number;
    const duration = params.duration as number;
    const clientToken = String(params.client_token ?? '').trim() || undefined;
    const storedParams = { ...(clipParams ?? {}), ...(clientToken ? { __clientToken: clientToken } : {}) };
    const existing = findIdempotentFxClip({ clientToken, html, css, componentId, startSec, duration });
    if (existing) return { success: true, output: idempotentFxReceipt('特效', existing.id) };

    captureEditorSnapshot();
    const id = useEditorStore.getState().addFxClip({
      label: (params.label as string) ?? (componentId ?? '自定义特效'),
      html,
      css,
      componentId,
      params: storedParams,
      theme: params.theme as string | undefined,
      startSec,
      duration,
    });
    useEditorStore.getState().setPlayhead(startSec);
    await flushTimelineMutation();
    return { success: true, output: clipReceipt('特效', id, startSec, duration) };
  },
};

addTextTool.definition.description = '添加用户明确要求的花字或文本卡。模板是 UI 素材库，不用于替代原创 MG 设计；不确定模板时先读取用户选择或使用 timeline_motion_guide。';
addFxTool.definition.description = '添加用户明确点名的页面模板、组件或旧式 HTML/CSS 特效。原创 AE/MG 默认用 timeline_add_scene；要查看模板、组件和主题目录时调用 timeline_motion_guide(section="legacy-fx")。';
addFxTool.definition.parameters.properties.theme.description = '配色主题 id；可调用 timeline_motion_guide(section="legacy-fx") 查看完整目录。';

function normalizeFreePageAssetUrl(raw: string): string {
  const value = String(raw ?? '').trim();
  if (!value || value.startsWith('#') || /^var\(/i.test(value)) return value;
  if (/^data:image\//i.test(value)) return value;
  if (/^https?:\/\//i.test(value)) return value;
  if (/^asset:\/\//i.test(value) || /^https?:\/\/asset\.localhost\//i.test(value)) return value;
  if (/^file:\/\//i.test(value)) {
    try {
      return convertFileSrc(decodeURIComponent(value.replace(/^file:\/\//i, '')));
    } catch {
      return value;
    }
  }
  if (value.startsWith('/')) return convertFileSrc(value);
  return value;
}

function rewriteFreePageAssets(html: string, css: string, imageAssets: string[] = [], videoAssets: string[] = []): { html: string; css: string } {
  const assets = imageAssets.map(normalizeFreePageAssetUrl);
  const videos = videoAssets.map(normalizeFreePageAssetUrl);
  const replaceToken = (_m: string, idxRaw: string) => assets[Number(idxRaw)] ?? '';
  const replaceVideoToken = (_m: string, idxRaw: string) => videos[Number(idxRaw)] ?? '';
  html = html
    .replace(/\{\{\s*(?:asset|image)[\s:_-]*(\d+)\s*\}\}/gi, replaceToken)
    .replace(/\{\{\s*video[\s:_-]*(\d+)\s*\}\}/gi, replaceVideoToken)
    .replace(/(<img\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi, (_m, pre: string, src: string, post: string) => `${pre}${normalizeFreePageAssetUrl(src)}${post}`)
    .replace(/(<video\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi, (_m, pre: string, src: string, post: string) => `${pre}${normalizeFreePageAssetUrl(src)}${post}`)
    .replace(/(<source\b[^>]*\bsrc\s*=\s*["'])([^"']+)(["'][^>]*>)/gi, (_m, pre: string, src: string, post: string) => `${pre}${normalizeFreePageAssetUrl(src)}${post}`)
    .replace(/(<source\b[^>]*\bsrcset\s*=\s*["'])([^"']+)(["'][^>]*>)/gi, (_m, pre: string, srcset: string, post: string) => {
      const first = srcset.split(',')[0]?.trim().split(/\s+/)[0] ?? srcset;
      return `${pre}${normalizeFreePageAssetUrl(first)}${post}`;
    });
  css = css
    .replace(/\{\{\s*(?:asset|image)[\s:_-]*(\d+)\s*\}\}/gi, replaceToken)
    .replace(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi, (_m, quote: string, url: string) => `url(${quote || '"'}${normalizeFreePageAssetUrl(url)}${quote || '"'})`);
  return { html, css };
}

function normalizeFreezeAfterSec(value: unknown): number | undefined {
  const sec = Number(value);
  return Number.isFinite(sec) && sec > 0.5 && sec < 60 ? sec : undefined;
}

const FREE_PAGE_LAYOUT_VERSION = 1;
type FreePageMotionMode = 'auto' | 'ae' | 'static';

const FREE_PAGE_SAFE_CSS = `
html,body{margin:0!important;padding:0!important;width:100%;height:100%;overflow:hidden!important}
.kp-free-page{position:absolute;inset:0;overflow:hidden;box-sizing:border-box}
.kp-free-page *,.kp-free-page *::before,.kp-free-page *::after{box-sizing:border-box}
.kp-free-page>.kp-safe{position:absolute;left:160px;right:160px;top:96px;bottom:96px;min-width:0;min-height:0}
`;

const FREE_PAGE_AE_HELPER_JS = `
;(function(){
  var M = window.KPFreeMotion || {};
  M.clamp = function(v,min,max){ return Math.max(min, Math.min(max, v)); };
  M.norm = function(t,start,dur){ return M.clamp((t - start) / Math.max(0.0001, dur), 0, 1); };
  M.lerp = function(a,b,p){ return a + (b - a) * p; };
  M.easeOutCubic = function(p){ return 1 - Math.pow(1 - M.clamp(p,0,1), 3); };
  M.easeInOutCubic = function(p){ p = M.clamp(p,0,1); return p < .5 ? 4*p*p*p : 1 - Math.pow(-2*p+2,3)/2; };
  M.easeOutBack = function(p){ p = M.clamp(p,0,1); var c1=1.70158,c3=c1+1; return 1 + c3*Math.pow(p-1,3) + c1*Math.pow(p-1,2); };
  M.spring = function(p){ p = M.clamp(p,0,1); return 1 - Math.cos(p * Math.PI * 4.5) * Math.exp(-6 * p); };
  M.byId = function(id){ return document.getElementById(id); };
  M.set = function(el, props){
    if(!el) return;
    var tx = props.x || 0, ty = props.y || 0, sc = props.scale == null ? 1 : props.scale, rot = props.rotate || 0;
    el.style.transform = 'translate3d(' + tx + 'px,' + ty + 'px,0) scale(' + sc + ') rotate(' + rot + 'deg)';
    if(props.opacity != null) el.style.opacity = String(props.opacity);
    if(props.blur != null) el.style.filter = 'blur(' + props.blur + 'px)';
    if(props.clip != null) el.style.clipPath = props.clip;
  };
  window.KPFreeMotion = M;
})();`.trim();

function normalizeFreePageMotionMode(value: unknown): FreePageMotionMode {
  return value === 'ae' || value === 'static' ? value : 'auto';
}

function hasFreePageStageRoot(html: string, css: string): boolean {
  if (/\bclass\s*=\s*["'][^"']*\bkp-free-page\b/i.test(html)) return true;
  if (/\bdata-kp-free-page-stage\b/i.test(html)) return true;
  if (/\bstyle\s*=\s*["'][^"']*position\s*:\s*absolute[^"']*(?:inset\s*:\s*0|left\s*:\s*0[^"']*right\s*:\s*0[^"']*top\s*:\s*0[^"']*bottom\s*:\s*0)/is.test(html)) {
    return true;
  }
  return /\.(?:page|stage|screen|canvas|root)\b[^{]*\{[^}]*position\s*:\s*absolute[^}]*(?:inset\s*:\s*0|left\s*:\s*0[^}]*right\s*:\s*0[^}]*top\s*:\s*0[^}]*bottom\s*:\s*0)/is.test(css)
    && /\bclass\s*=\s*["'][^"']*\b(?:page|stage|screen|canvas|root)\b/i.test(html);
}

function withFreePageLayoutCss(css: string): string {
  if (css.includes('kp-free-page-layout:v')) return css;
  return `${css}\n/* kp-free-page-layout:v${FREE_PAGE_LAYOUT_VERSION} */\n${FREE_PAGE_SAFE_CSS}`.trim();
}

function wrapFreePageStage(html: string, css: string, motionMode: FreePageMotionMode): { html: string; css: string } {
  const modeAttr = motionMode === 'ae' ? ' data-kp-motion-mode="ae"' : '';
  if (/\bclass\s*=\s*["'][^"']*\bkp-free-page\b/i.test(html) || /\bdata-kp-free-page-stage\b/i.test(html)) {
    const nextHtml = motionMode === 'ae' && !/\bdata-kp-motion-mode\s*=/.test(html)
      ? html.replace(/<div\b([^>]*\bkp-free-page\b[^>]*)>/i, `<div$1${modeAttr}>`)
      : html;
    return { html: nextHtml, css: withFreePageLayoutCss(css) };
  }
  if (hasFreePageStageRoot(html, css)) {
    return {
      html: `<div class="kp-free-page" data-kp-free-page-stage="v${FREE_PAGE_LAYOUT_VERSION}"${modeAttr}>${html}</div>`,
      css: withFreePageLayoutCss(css),
    };
  }
  return {
    html: `<div class="kp-free-page" data-kp-free-page-stage="v${FREE_PAGE_LAYOUT_VERSION}"${modeAttr}><div class="kp-safe">${html}</div></div>`,
    css: withFreePageLayoutCss(css),
  };
}

function freePageLayoutWarnings(html: string, css: string, motionMode: FreePageMotionMode): string[] {
  const userCss = css.split('/* kp-free-page-layout:')[0] ?? css;
  const all = `${html}\n${userCss}`;
  const warnings: string[] = [];
  if (/\b(?:html|body)\b[^{]*\{[^}]*(?:padding|margin|display|place-items|align-items|justify-content)\s*:/is.test(all)) {
    warnings.push('自由页面不是普通网页，body/html 不能作为可靠布局容器；请用 .page/.kp-safe 的 absolute 坐标控制边距');
  }
  if (motionMode === 'ae' && !/__kunpengRenderFrame\s*=/.test(all)) {
    warnings.push('AE 页面模式建议定义 window.__kunpengRenderFrame(t)，用 t 驱动每一帧；只写 CSS animation 会更像网页/PPT');
  }
  return warnings;
}

function normalizeFreePageDoc(
  rawHtml: string,
  rawCss?: string,
  rawJs?: string,
  imageAssets: string[] = [],
  videoAssets: string[] = [],
  freezeAfterSec?: number,
  motionMode: FreePageMotionMode = 'auto',
): { html: string; css: string } {
  let html = String(rawHtml ?? '').trim();
  let css = String(rawCss ?? '').trim();
  const js = String(rawJs ?? '').trim();
  html = html.replace(/<!doctype[^>]*>/gi, '');
  html = html.replace(/<style[^>]*>([\s\S]*?)<\/style>/gi, (_m, styleBody: string) => {
    css = `${css}\n${styleBody}`.trim();
    return '';
  });
  const bodyMatch = /<body[^>]*>([\s\S]*?)<\/body>/i.exec(html);
  if (bodyMatch) html = bodyMatch[1].trim();
  html = html
    .replace(/<\/?(?:html|head|meta|title|link)[^>]*>/gi, '')
    .trim();
  const scripts: string[] = [];
  if (motionMode === 'ae' && !/window\.KPFreeMotion\b/.test(html)) scripts.push(FREE_PAGE_AE_HELPER_JS);
  if (js) scripts.push(js);
  if (scripts.length) html = `${html}\n<script>\n${scripts.join('\n')}\n</script>`;
  if (freezeAfterSec != null) css = `${css}\n:root{--kp-freeze-after:${freezeAfterSec.toFixed(3)}s;}`;
  const rewritten = rewriteFreePageAssets(html, css, imageAssets, videoAssets);
  return wrapFreePageStage(rewritten.html, rewritten.css, motionMode);
}

function collectFreePageResourceUrls(html: string, css: string): string[] {
  const urls: string[] = [];
  for (const m of html.matchAll(/\bsrc\s*=\s*["']([^"']+)["']/gi)) urls.push(m[1]);
  for (const m of css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)) urls.push(m[1]);
  return urls;
}

function isAllowedFreePageMediaUrl(url: string): boolean {
  const value = String(url ?? '').trim();
  if (!value || value.startsWith('#') || /^var\(/i.test(value)) return true;
  if (/^data:(?:image|video)\//i.test(value)) return true;
  if (/^asset:\/\//i.test(value) || /^https?:\/\/asset\.localhost\//i.test(value)) return true;
  if (/^https?:\/\//i.test(value)) return !/\.(?:js|mjs|css|woff2?|ttf|otf)(?:[?#].*)?$/i.test(value);
  if (/^file:\/\//i.test(value) || value.startsWith('/')) return true;
  return !/\.(?:js|mjs|css|woff2?|ttf|otf)(?:[?#].*)?$/i.test(value);
}

function isLocalUploadAsset(value: string): boolean {
  const v = String(value ?? '').trim();
  return v.startsWith('/') || /^file:\/\//i.test(v);
}

function basenameOfPath(value: string): string {
  const clean = value.replace(/^file:\/\//i, '').split(/[?#]/)[0] || 'asset.png';
  return decodeURIComponent(clean).split('/').filter(Boolean).pop() || 'asset.png';
}

async function maybeUploadFreePageAssetsToCos(imageAssets: string[], enabled: boolean): Promise<string[]> {
  if (!enabled) return imageAssets;
  const out: string[] = [];
  for (const asset of imageAssets) {
    if (!isLocalUploadAsset(asset)) {
      out.push(asset);
      continue;
    }
    const localPath = decodeURIComponent(asset.replace(/^file:\/\//i, ''));
    out.push(await uploadToCos(localPath, basenameOfPath(asset)));
  }
  return out;
}

function validateFreePage(html: string, css: string): string[] {
  const all = `${html}\n${css}`;
  const violations: string[] = [];
  if (!html.trim()) violations.push('html 不能为空');
  if (!css.trim()) violations.push('css 不能为空');
  if (/<script\b[^>]*\bsrc\s*=/i.test(all)) violations.push('自由网页允许内联 JS，但不允许外链脚本；需要库时请把必要逻辑写成内联受控代码');
  if (/<iframe\b|<audio\b/i.test(all)) violations.push('自由网页不支持 iframe/audio 内嵌；视频请使用 video_assets 与静音 <video>，音频应放到时间线音轨');
  if (/<video\b/i.test(all) && !/<video\b[^>]*(?:muted|data-kp-muted)/i.test(all)) {
    violations.push('自由页面视频必须静音（muted），声音请使用 timeline_add_audio 放到时间线音轨');
  }
  if (/\son[a-z]+\s*=/i.test(all)) violations.push('禁止内联事件处理器（onclick/onload 等）');
  if (/<link\b/i.test(all)) violations.push('禁止 link 外部样式/字体；图片请用 img 或 CSS background-image');
  if (/\b(?:requestAnimationFrame|setInterval|Date\.now|performance\.now)\s*\(/.test(all)) {
    violations.push('自由页面动画必须由时间轴驱动，禁止 requestAnimationFrame/setInterval/Date.now/performance.now；请使用 window.__kunpengRenderFrame(t)');
  }
  if (/__kunpengRenderLayerFrame\s*=/.test(all)) violations.push('禁止定义 window.__kunpengRenderLayerFrame（该协议位由 KPMotion 运行时占用）；逐帧动画请定义 window.__kunpengRenderFrame = (t) => {...}');
  const badResources = collectFreePageResourceUrls(html, css).filter((url) => !isAllowedFreePageMediaUrl(url));
  if (badResources.length) {
    violations.push(`自由网页只允许图片/视频资源，本地路径、公网 URL、data URI 都可以；这些资源不允许：${badResources.slice(0, 3).join('，')}`);
  }
  const durations = all.match(/(?:animation(?:-duration)?\s*:[^;]*?)([\d.]+)s/g) ?? [];
  for (const d of durations) {
    const m = /([\d.]+)s/.exec(d);
    if (m && parseFloat(m[1]) > 15) violations.push(`单段动画 ${m[1]}s 超过 15s，请压到片段 duration 内`);
  }
  return violations;
}

async function freePageSource(inlineValue: unknown, pathValue: unknown, label: string): Promise<string> {
  const path = String(pathValue ?? '').trim();
  if (path) {
    try {
      return await readTextFile(path);
    } catch (err) {
      throw new Error(`读取 ${label} 文件失败：${path}；${err instanceof Error ? err.message : String(err)}`);
    }
  }
  return String(inlineValue ?? '');
}

const addFreePageTool: Tool = {
  definition: {
    name: 'timeline_add_free_page',
    description: '把 Scene Spec 表达不了的自定义 HTML/CSS/受控 JS 页面放入特效轨。先调用 timeline_motion_guide(section="free-page") 读取逐帧时钟、布局和资源契约；建议先 validate_only=true 预检，再正式落轨。',
    parameters: {
      type: 'object',
      properties: {
        html: { type: 'string', description: '完整 HTML 文档或 body 片段。可含 style，工具会抽出并合并到 css' },
        html_path: { type: 'string', description: '可选 HTML 文件绝对路径；设置后优先于 html' },
        css: { type: 'string', description: '页面 CSS。可为空但 html 内必须含 style' },
        css_path: { type: 'string', description: '可选 CSS 文件绝对路径；设置后优先于 css' },
        js: { type: 'string', description: '可选内联 JS。需要逐帧动画时定义 window.__kunpengRenderFrame = (t) => { ... }，不要写外链 script' },
        js_path: { type: 'string', description: '可选 JS 文件绝对路径；设置后优先于 js' },
        motion_mode: { type: 'string', enum: ['auto', 'ae', 'static'], description: 'auto 默认；ae=AE 舞台模式，适合 MG/复刻/复杂动效，工具会注入 KPFreeMotion 并期待 __kunpengRenderFrame(t)；static=静态页面' },
        image_assets: { type: 'array', items: { type: 'string' }, description: '可选图片资源清单，本地绝对路径或公网 URL。HTML/CSS 中可用 {{asset0}}、{{image1}} 占位' },
        video_assets: { type: 'array', items: { type: 'string' }, description: '可选视频资源清单，本地绝对路径或公网 URL。HTML 中用 {{video0}} 占位；video 标签必须 muted，播放时间由时间轴驱动' },
        upload_images_to_cos: { type: 'boolean', description: '可选。true 时把 image_assets 里的本地图片先上传 COS，再把公网 URL 放进网页。复刻官网/大图导出时推荐 true' },
        freeze_after_sec: { type: 'number', description: '可选冻结点。只有页面前几秒动完、后面完全静止时填写；多场景/持续动画/官网复刻通常不要填' },
        validate_only: { type: 'boolean', description: '只校验和归一化，不上传资源、不写入时间轴。正式生成前建议先 true' },
        client_token: { type: 'string', description: '可选幂等键。同一次页面重试时保持不变；即使未传，完全相同的页面和时间范围也会自动去重' },
        label: { type: 'string', description: '时间轴片段显示名，如“自由网页复刻 Hook 页”' },
        start_sec: { type: 'number', description: '时间轴开始秒' },
        duration: { type: 'number', description: '持续秒，建议 2-15 秒' },
      },
      required: ['start_sec', 'duration'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const imageAssets = Array.isArray(params.image_assets)
      ? (params.image_assets as unknown[]).map(String).filter(Boolean)
      : [];
    const videoAssets = Array.isArray(params.video_assets)
      ? (params.video_assets as unknown[]).map(String).filter(Boolean)
      : [];
    const rawHtml = await freePageSource(params.html, params.html_path, 'HTML');
    const rawCss = await freePageSource(params.css, params.css_path, 'CSS');
    const rawJs = await freePageSource(params.js, params.js_path, 'JS');
    if (!rawHtml.trim()) return { success: false, output: '', error: '需要 html 或 html_path' };
    const validateOnly = Boolean(params.validate_only);
    const preparedAssets = validateOnly
      ? imageAssets
      : await maybeUploadFreePageAssetsToCos(imageAssets, Boolean(params.upload_images_to_cos));
    const motionMode = normalizeFreePageMotionMode(params.motion_mode);
    if (motionMode === 'static' && rawJs.trim()) {
      return {
        success: false,
        output: '',
        error: 'motion_mode="static" 不能同时传入 js。需要动画请改为 motion_mode="ae" 并定义 window.__kunpengRenderFrame(t)；只要静态画面请移除 js。',
      };
    }
    const { html, css } = normalizeFreePageDoc(
      rawHtml,
      rawCss,
      rawJs,
      preparedAssets,
      videoAssets,
      normalizeFreezeAfterSec(params.freeze_after_sec),
      motionMode,
    );
    const violations = validateFreePage(html, css);
    if (violations.length) return { success: false, output: '', error: `自由网页校验未通过：${violations.join('；')}` };
    const warn = freePageLayoutWarnings(html, css, motionMode);
    if (validateOnly) {
      return {
        success: true,
        output: JSON.stringify({
          valid: true,
          motion_mode: motionMode,
          warnings: warn,
          html_chars: html.length,
          css_chars: css.length,
          image_assets: preparedAssets.length,
          video_assets: videoAssets.length,
          next: '预检通过。确认画面结构后，用相同参数移除 validate_only 或设为 false 正式加入时间轴。',
        }, null, 2),
      };
    }
    const startSec = params.start_sec as number;
    const duration = Math.max(0.5, Math.min(15, params.duration as number));
    const clientToken = String(params.client_token ?? '').trim() || undefined;
    const existing = findIdempotentFxClip({ clientToken, html, css, startSec, duration });
    if (existing) return { success: true, output: idempotentFxReceipt('自由网页页面', existing.id) };

    captureEditorSnapshot();
    const id = useEditorStore.getState().addFxClip({
      label: (params.label as string) || '自由网页',
      html,
      css,
      params: {
        mode: 'free-page',
        motionMode,
        sourcePaths: { html: params.html_path, css: params.css_path, js: params.js_path },
        videoAssets,
        ...(clientToken ? { __clientToken: clientToken } : {}),
      },
      startSec,
      duration,
    });
    useEditorStore.getState().setPlayhead(startSec);
    await flushTimelineMutation();
    return { success: true, output: `${clipReceipt('自由网页页面', id, startSec, duration)}${warn.length ? `\n提示：${warn.join('；')}` : ''}` };
  },
};

// ── Scene（KPMotion 确定性运动场景） ──────────────────────────────────────────

function mergeSpecPatch(base: SceneSpec, patch: Record<string, unknown> | undefined): SceneSpec {
  if (!patch || typeof patch !== 'object') return base;
  const merged = { ...base, ...patch } as SceneSpec;
  // layers 特殊合并：patch.layers 按 id 覆盖/追加，其余字段浅覆盖
  if (Array.isArray(patch.layers)) {
    const patchLayers = patch.layers as SceneSpec['layers'];
    const out = [...base.layers];
    for (const pl of patchLayers) {
      const idx = out.findIndex((l) => l.id === pl.id);
      if (idx >= 0) out[idx] = { ...out[idx], ...pl };
      else out.push(pl);
    }
    merged.layers = out;
  }
  return merged;
}

function resolveSceneSpec(params: Record<string, unknown>): { spec: SceneSpec | null; error?: string } {
  const presetId = params.preset_id as string | undefined;
  const rawSpec = params.spec as SceneSpec | undefined;
  const duration = Number(params.duration);
  if (presetId) {
    if (!findScenePreset(presetId)) {
      return { spec: null, error: `未知预设 ${presetId}。可用预设：\n${scenePresetsDoc()}` };
    }
    const built = buildScenePreset(presetId, (params.preset_params as Record<string, unknown>) ?? {}, Number.isFinite(duration) ? duration : undefined);
    if (!built) return { spec: null, error: `预设 ${presetId} 构建失败` };
    return { spec: mergeSpecPatch(built, params.spec_patch as Record<string, unknown> | undefined) };
  }
  if (rawSpec && typeof rawSpec === 'object') {
    return { spec: rawSpec };
  }
  return { spec: null, error: '需要 spec（完整 Scene Spec）或 preset_id + preset_params' };
}

const addSceneTool: Tool = {
  definition: {
    name: 'timeline_add_scene',
    description: `把一个 KPMotion 运动场景放入时间轴特效轨——所有 AE/MG 动画、口播视觉包装、信息页、品牌感页面都用它做原创设计。场景由声明式 Scene Spec 描述，弹簧/遮罩揭示/逐字动效/镜头推拉/冲击抖动/描线/数字滚动/残影/局部聚焦都是经过测试的确定性运动原语，预览与导出逐帧一致。

**★第一问（每个场景动手前必答）：这个内容能不能演出来？**
讲概念/机制/架构/流程/关系/数据时答案几乎总是"能"——把概念做成会动的角色和关系，让观众"看见它运转"；把文字排版上屏是最后手段，不是默认。翻译词汇：实体→角色化节点(点亮/呼吸)；关系→lineDraw 连线+光点沿线飞；流程→beats 依次点亮传递；数量→真实复制 N 份+numberRoll；状态变化→形变/点亮/glitch；口播里提到聊天/网页/搜索/弹幕/榜单/代码，就把那个媒介画面直接演出来（demo.chat/webhighlight/search/danmaku/ranking/code）。demo.* 预设就是这套导演思维的现成实例，风格对口直接用，不对口拿它的 spec 当骨架复刻。只有孤立金句/标题强调/纯情绪才做文字型场景。

**★图形造型纪律（拒绝清一色圆球/方块）**：概念演示里每类实体要有自己的视觉身份——模块/服务/App=玻璃卡片(圆角矩形+线性图标+顶部渐变条)、技术组件/工位=六边形、决策点=菱形、枢纽/网关=空心环、渠道/标签=胶囊、发光圆球只留给真正无形的能量/AI核心。同场景主次节点必须在造型/大小/亮度三个维度里至少两个有区分。图标一律用 stroke 风格 SVG 线性图标（与连线同一套图形语言），禁止 emoji。手写 spec 的 html 层按此标准写造型，参照 demo.orchestra 产出的节点 html。

**MG 先做语义结构，不要默认彩色字块**：
- 列表/编号/多点并列（1、2、3、4；第一/第二/第三；几个步骤/原因/能力）= 一个整体组件，横排或网格卡片，统一标题和编号，优先 mg.listCards。
- 否定修正（不是 A 而是 B；不要 A 要 B；A 不是重点 B 才是）= 旧词划掉/盖章/叉掉，再替换新词，优先 mg.crossOutReplace。
- 对比/前后/错误正确 = 左右分栏、表格、前后滑块或对照卡。
- 流程/链路 = 节点串联、箭头、时间线。
- 孤立短词才用关键词弹出；长逻辑段要用 opaque 信息页或大底板。

**艺术方向（spec.style）**——一个字段激活整套美学人格（配色+字体+签名装饰层+质感+运动性格），是做出风格化设计的最快路径。先按内容气质选一个 style，再在其中做构图与内容：
${styleKitsDoc()}
（透明叠加场景用 style 时传 styleBackdrop:false 只要配色不要全屏装饰。不选 style 就用 theme 自由配。）

两种用法：
1. spec（完整 Scene Spec，自由编排）——**默认方式**，按设计准则原创设计：
${sceneDslDoc()}
2. preset_id + preset_params（骨架参考）：预设只是起点，产出偏保守；用它时应叠 spec_patch 注入本片的视觉个性（改 style/配色/构图/beats/动效速度域），不要原样交付。
${scenePresetsDoc()}

校验不过会返回逐条违规说明，按提示修正后重试。透明场景文字必须带 kp-chip/kp-stroke/kp-shadow 之一。`,
    parameters: {
      type: 'object',
      properties: {
        preset_id: { type: 'string', description: '预设 id，如 mg.titleReveal / talking.keywordPop / info.flowChain / web.heroApple' },
        preset_params: { type: 'object', description: '预设参数（见各预设 paramsDoc）' },
        spec: { type: 'object', description: '完整 Scene Spec（与 preset_id 二选一）' },
        spec_patch: { type: 'object', description: '可选：对预设产出 spec 的浅覆盖补丁（layers 按 id 合并）' },
        label: { type: 'string', description: '时间轴片段显示名' },
        start_sec: { type: 'number', description: '时间轴开始秒' },
        duration: { type: 'number', description: '持续秒 0.5-15；用 preset 时覆盖其默认时长，spec 模式请与 spec.duration 一致' },
        client_token: { type: 'string', description: '可选幂等键。同一次场景重试时保持不变；即使未传，完全相同的场景和时间范围也会自动去重' },
      },
      required: ['start_sec'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const { spec, error } = resolveSceneSpec(params);
    if (!spec) return { success: false, output: '', error };
    const duration = Math.max(0.5, Math.min(15, Number(params.duration) || spec.duration || 5));
    spec.duration = duration;
    const v = validateSceneSpec(spec);
    if (!v.ok) return { success: false, output: '', error: `Scene Spec 校验未通过：\n${v.violations.join('\n')}` };
    const doc = sceneSpecToDoc(spec);
    const startSec = params.start_sec as number;
    const clientToken = String(params.client_token ?? '').trim() || undefined;
    const existing = findIdempotentFxClip({
      clientToken,
      html: doc.html,
      css: doc.css,
      componentId: 'scene',
      startSec,
      duration,
    });
    if (existing) return { success: true, output: idempotentFxReceipt('运动场景', existing.id) };

    captureEditorSnapshot();
    const id = useEditorStore.getState().addFxClip({
      label: (params.label as string) || (params.preset_id ? findScenePreset(params.preset_id as string)?.label ?? '运动场景' : '运动场景'),
      html: doc.html,
      css: doc.css,
      componentId: 'scene',
      params: { mode: 'scene', spec: spec as unknown as Record<string, unknown>, ...(clientToken ? { __clientToken: clientToken } : {}) },
      theme: spec.theme,
      startSec,
      duration,
    });
    useEditorStore.getState().setPlayhead(startSec);
    await flushTimelineMutation();
    const warn = v.warnings.length ? `\n提示：${v.warnings.join('；')}` : '';
    return { success: true, output: `${clipReceipt('运动场景', id, startSec, duration)}预览与导出逐帧一致。${warn}` };
  },
};

// Keep the model-facing schema compact. Detailed DSL/style/preset knowledge is
// disclosed only when the agent asks for the relevant guide section.
addSceneTool.definition.description = '把 KPMotion 确定性运动场景放入特效轨，适合 AE/MG、口播包装、信息页和品牌页面。动手前按需调用 timeline_motion_guide：overview 读设计原则，scene-spec 读 DSL，styles 选艺术方向，presets 查预设。不要在未读契约时猜字段。';

const motionGuideTool: Tool = {
  definition: {
    name: 'timeline_motion_guide',
    description: '按需读取 KPMotion 动效指南。详细样式、DSL、预设和自由页面契约不常驻工具描述，只有做对应任务时再读取。',
    parameters: {
      type: 'object',
      properties: {
        section: {
          type: 'string',
          enum: ['overview', 'scene-spec', 'styles', 'presets', 'free-page', 'legacy-fx'],
          description: '需要读取的章节',
        },
      },
      required: ['section'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const section = String(params.section ?? 'overview');
    const docs: Record<string, string> = {
      overview: 'KPMotion 设计顺序：先判断内容能否“演出来”，再选择语义结构，最后选艺术方向。机制、流程、关系、数据优先用节点、连线、传递、数量和状态变化表达；孤立金句才用纯文字。实体造型要按语义区分，禁止所有内容都变成彩色字块或同一种圆球。列表做统一卡片组，对比做分栏，流程做节点链路，否定修正做划掉与替换。生成后必须 timeline_render_frame 截取关键时刻并用 image_recognition 验收。',
      'scene-spec': sceneDslDoc(),
      styles: `${styleKitsDoc()}\n\n透明叠加只要配色时传 styleBackdrop:false；不选 style 时才单独使用 theme。`,
      presets: `${scenePresetsDoc()}\n\n预设只作为结构骨架；交付前用 spec_patch 修改 style、配色、构图、beats 或速度，避免模板感。`,
      'free-page': '自由页面只在 Scene Spec 无法表达时使用。画布基准 1920×1080；根节点 .page{position:absolute;inset:0}，不要依赖 body/html 的 margin、padding、flex/grid。动画传 motion_mode:"ae"，唯一时钟为 window.__kunpengRenderFrame=(t)=>{...}，禁止 requestAnimationFrame、setInterval、Date.now、performance.now。脚本在舞台挂载后执行，无需 DOMContentLoaded。长页面可用 html_path/css_path/js_path，图片用 image_assets + {{image0}}，静音视频用 video_assets + {{video0}}，视频会随时间轴逐帧 seek。最小模板：html=<div class="page"><canvas id="scene" width="1920" height="1080"></canvas></div>；js=const canvas=document.getElementById(\'scene\'); const ctx=canvas.getContext(\'2d\'); window.__kunpengRenderFrame=(t)=>{ctx.clearRect(0,0,1920,1080); /* 按 t 绘制 */};。先 validate_only=true，再正式落轨，最后 timeline_render_frame 验收。',
      'legacy-fx': `页面模板和组件是用户素材库，只在用户明确点名时使用。\n页面模板：\n${pageTemplatesDoc()}\n\n组件：\n${fxComponentsDoc()}\n\n主题：\n${fxThemesDoc()}`,
    };
    return { success: true, output: docs[section] ?? docs.overview };
  },
};

const updateSceneTool: Tool = {
  definition: {
    name: 'timeline_update_scene',
    description: '更新已存在的运动场景（按 fx_id 原位修改，不新建）。传 spec 整体替换，或传 spec_patch 在现有 spec 上合并（layers 按 id 覆盖/追加）。也可只改 label/start_sec/duration。',
    parameters: {
      type: 'object',
      properties: {
        fx_id: { type: 'string', description: '场景片段 id（timeline_get_state 可查）' },
        spec: { type: 'object', description: '完整新 Scene Spec（整体替换）' },
        spec_patch: { type: 'object', description: '对现有 spec 的浅覆盖补丁' },
        label: { type: 'string' },
        start_sec: { type: 'number' },
        duration: { type: 'number' },
      },
      required: ['fx_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    const clip = s.fxClips.find((c) => c.id === params.fx_id);
    if (!clip) return { success: false, output: '', error: `特效 ${params.fx_id} 不存在` };
    const currentSpec = (clip.params as { spec?: SceneSpec } | undefined)?.spec;
    if (!currentSpec && !params.spec) {
      return { success: false, output: '', error: `${params.fx_id} 不是运动场景片段（无 spec），请用 timeline_update_fx` };
    }
    let next: SceneSpec = (params.spec as SceneSpec) ?? currentSpec!;
    if (!params.spec && params.spec_patch) next = mergeSpecPatch(currentSpec!, params.spec_patch as Record<string, unknown>);
    const duration = Math.max(0.5, Math.min(15, Number(params.duration) || next.duration || clip.duration));
    next.duration = duration;
    const v = validateSceneSpec(next);
    if (!v.ok) return { success: false, output: '', error: `Scene Spec 校验未通过：\n${v.violations.join('\n')}` };
    const doc = sceneSpecToDoc(next);
    captureEditorSnapshot();
    s.updateFxClip(clip.id, {
      html: doc.html,
      css: doc.css,
      params: { mode: 'scene', spec: next as unknown as Record<string, unknown> },
      theme: next.theme,
      ...(params.label ? { label: params.label as string } : {}),
      ...(params.start_sec != null ? { startSec: params.start_sec as number } : {}),
      duration,
    });
    await flushTimelineMutation();
    return { success: true, output: `运动场景 ${clip.id} 已更新（时长 ${duration}s）` };
  },
};

const speechKeywordFxTool: Tool = {
  definition: {
    name: 'timeline_speech_keyword_fx',
    description: '口播关键词自动锚定：只适合“孤立短词/爆点词”的瞬间强调。给一批关键词，自动在词级转写里找到每个词的说出时刻（源秒→时间轴秒自动换算），生成 talking.keywordPop 运动场景批量落轨。不要用它处理列表、编号、不是A而是B、对比、流程、长逻辑段；这些必须用 timeline_add_scene 做成一个整体语义组件。需要先有转写（自动字幕）。',
    parameters: {
      type: 'object',
      properties: {
        keywords: {
          type: 'array',
          items: { type: 'object', properties: { word: { type: 'string' }, x: { type: 'string' }, y: { type: 'string' } }, required: ['word'] },
          description: '关键词列表（≤12 个）。word 必须是转写里出现的词/短语；x/y 可选屏幕锚点（如"30%"，默认交错排布避免重叠）',
        },
        hold: { type: 'number', description: '每个词停留秒，默认 2.2' },
        theme: { type: 'string', description: '配色主题 id' },
        occurrence: { type: 'string', enum: ['first', 'all'], description: 'first（默认）只标注第一次说出；all 每次说出都标注' },
      },
      required: ['keywords'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    const transcripts = Object.values(s.transcripts ?? {});
    if (!transcripts.length) return { success: false, output: '', error: '没有词级转写，请先跑「自动字幕」' };
    const { sourceTimeToTimeline } = await import('@/lib/editor/transcriptOps');
    const keywords = (Array.isArray(params.keywords) ? params.keywords : []).slice(0, 12) as { word?: unknown; x?: unknown; y?: unknown }[];
    const occurrence = params.occurrence === 'all' ? 'all' : 'first';
    const hold = Number(params.hold) || 2.2;

    interface Hit { word: string; timelineSec: number; x?: string; y?: string }
    const hits: Hit[] = [];
    const misses: string[] = [];
    for (const k of keywords) {
      const word = String(k.word ?? '').trim();
      if (!word) continue;
      let found = false;
      for (const tr of transcripts) {
        if (!tr) continue;
        for (const sent of tr.sentences) {
          if (sent.deleted) continue;
          // 词级滑窗匹配（关键词可能跨多个 ASR 词）
          const words = sent.words;
          for (let i = 0; i < words.length; i++) {
            let joined = '';
            for (let j = i; j < Math.min(words.length, i + 8); j++) {
              joined += words[j].w;
              if (joined.replace(/\s/g, '') === word.replace(/\s/g, '')) {
                const tSec = sourceTimeToTimeline(tr.mediaPath, words[i].start);
                if (tSec != null) {
                  hits.push({ word, timelineSec: tSec, x: k.x ? String(k.x) : undefined, y: k.y ? String(k.y) : undefined });
                  found = true;
                }
                break;
              }
              if (joined.length > word.length) break;
            }
            if (found && occurrence === 'first') break;
          }
          if (found && occurrence === 'first') break;
        }
        if (found && occurrence === 'first') break;
      }
      if (!found) misses.push(word);
    }
    if (!hits.length) {
      return { success: false, output: '', error: `转写里没找到这些词：${misses.join('、')}。检查用词是否与逐字稿一致（ASR 可能有同音字）` };
    }

    // 按时间聚簇成场景片段（相邻 <4s 的合并进同一场景，减少 clip 数）
    hits.sort((a, b) => a.timelineSec - b.timelineSec);
    const clusters: Hit[][] = [];
    for (const h of hits) {
      const last = clusters[clusters.length - 1];
      if (last && h.timelineSec - last[last.length - 1].timelineSec < 4 && last.length < 6) last.push(h);
      else clusters.push([h]);
    }

    captureEditorSnapshot();
    const fxIds: string[] = [];
    const defaultAnchors = [
      { x: '28%', y: '24%' }, { x: '72%', y: '30%' }, { x: '30%', y: '68%' },
      { x: '70%', y: '64%' }, { x: '50%', y: '22%' }, { x: '50%', y: '72%' },
    ];
    for (const cluster of clusters) {
      const startSec = Math.max(0, cluster[0].timelineSec - 0.1);
      const lastAt = cluster[cluster.length - 1].timelineSec;
      const duration = Math.max(1.5, Math.min(15, lastAt - startSec + hold + 0.3));
      const spec = buildScenePreset('talking.keywordPop', {
        words: cluster.map((h, i) => ({
          word: h.word,
          x: h.x ?? defaultAnchors[i % defaultAnchors.length].x,
          y: h.y ?? defaultAnchors[i % defaultAnchors.length].y,
          at: Number((h.timelineSec - startSec).toFixed(2)),
        })),
        hold,
        theme: params.theme,
      }, duration);
      if (!spec) continue;
      const v = validateSceneSpec(spec);
      if (!v.ok) continue;
      const doc = sceneSpecToDoc(spec);
      const id = s.addFxClip({
        label: `关键词包装（${cluster.map((h) => h.word).join('/')}）`,
        html: doc.html,
        css: doc.css,
        componentId: 'scene',
        params: { mode: 'scene', spec: spec as unknown as Record<string, unknown> },
        theme: spec.theme,
        startSec,
        duration,
      });
      fxIds.push(id);
    }
    await flushTimelineMutation();
    const missNote = misses.length ? `；未找到：${misses.join('、')}` : '';
    return {
      success: true,
      output: `已按词级时间戳锚定 ${hits.length} 个关键词，生成 ${fxIds.length} 个运动场景（fx_id: ${fxIds.join(', ')}）${missNote}`,
    };
  },
};

const uploadAssetsToCosTool: Tool = {
  definition: {
    name: 'timeline_upload_assets_to_cos',
    description: '把本地图片/视频素材上传到已配置的腾讯云 COS，返回可放进自由网页、Seedance 等工具的公网 URL。Kimi 视频应走专用文件服务，不要把 COS URL 当作 Kimi 视频输入。自由网页复刻官网、插入本地大图、导出需要稳定加载图片时优先用它。',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '本地文件绝对路径列表' },
      },
      required: ['paths'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const paths = Array.isArray(params.paths) ? (params.paths as unknown[]).map(String).filter(Boolean) : [];
    if (!paths.length) return { success: false, output: '', error: '需要 paths，本地文件绝对路径数组' };
    const results: { path: string; url: string }[] = [];
    for (const p of paths) {
      const url = await uploadToCos(p, basenameOfPath(p));
      results.push({ path: p, url });
    }
    return {
      success: true,
      output: JSON.stringify({
        count: results.length,
        assets: results,
        usage: '在 timeline_add_free_page 的 image_assets 中使用这些 url，或直接写进 <img src> / background-image:url(...)。',
      }, null, 2),
    };
  },
};

const updateTextTool: Tool = {
  definition: {
    name: 'timeline_update_text',
    description: '更新已存在的花字（按 text_id 原位修改，不新建）。可改文案/模板/位置/颜色/时间，未传字段保持不变。',
    parameters: {
      type: 'object',
      properties: {
        text_id: { type: 'string', description: '花字片段 id（timeline_get_state 可查）' },
        text: { type: 'string' },
        template_id: { type: 'string' },
        position: { type: 'string', enum: ['top', 'center', 'bottom'] },
        color: { type: 'string', description: '主色 hex' },
        accent: { type: 'string', description: '强调色 hex' },
        font_scale: { type: 'number', description: '字号倍率 0.5-2' },
        start_sec: { type: 'number' },
        end_sec: { type: 'number' },
      },
      required: ['text_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    const clip = s.textClips.find((c) => c.id === params.text_id);
    if (!clip) return { success: false, output: '', error: `花字 ${params.text_id} 不存在` };
    if (params.template_id && !findTextTemplate(params.template_id as string)) {
      return { success: false, output: '', error: `未知模板 ${params.template_id}` };
    }
    captureEditorSnapshot();
    const ov = { ...(clip.styleOverrides ?? {}) };
    if (params.color) ov.color = params.color as string;
    if (params.accent) ov.accent = params.accent as string;
    if (params.font_scale != null) ov.fontScale = params.font_scale as number;
    s.updateTextClip(clip.id, {
      ...(params.text != null ? { text: params.text as string } : {}),
      ...(params.template_id ? { templateId: params.template_id as string } : {}),
      ...(params.position ? { position: params.position as 'top' | 'center' | 'bottom' } : {}),
      ...(params.start_sec != null ? { startSec: params.start_sec as number } : {}),
      ...(params.end_sec != null ? { endSec: params.end_sec as number } : {}),
      ...(Object.keys(ov).length > 0 ? { styleOverrides: ov } : {}),
    });
    await flushTimelineMutation();
    return { success: true, output: `花字 ${clip.id} 已更新` };
  },
};

const updateFxTool: Tool = {
  definition: {
    name: 'timeline_update_fx',
    description: '更新已存在的特效（按 fx_id 原位修改，不新建）。组件特效改 params/theme 会自动重新渲染；自由网页可传新 html/css/js、对应文件路径和图片/视频资源。未传字段保持不变。',
    parameters: {
      type: 'object',
      properties: {
        fx_id: { type: 'string', description: '特效片段 id（timeline_get_state 可查）' },
        params: { type: 'object', description: '组件参数（与现有参数浅合并）' },
        theme: { type: 'string', description: `配色主题 id，可用：${fxThemesDoc()}` },
        html: { type: 'string', description: '自由特效新 html' },
        html_path: { type: 'string', description: '自由网页 HTML 文件绝对路径' },
        css: { type: 'string', description: '自由特效新 css' },
        css_path: { type: 'string', description: '自由网页 CSS 文件绝对路径' },
        js: { type: 'string', description: '自由网页新内联 JS' },
        js_path: { type: 'string', description: '自由网页 JS 文件绝对路径' },
        motion_mode: { type: 'string', enum: ['auto', 'ae', 'static'], description: '更新自由网页的动效模式；ae 会注入 KPFreeMotion 并建议使用 __kunpengRenderFrame(t)' },
        image_assets: { type: 'array', items: { type: 'string' }, description: '自由网页图片资源清单，可用 {{asset0}} 占位' },
        video_assets: { type: 'array', items: { type: 'string' }, description: '自由网页视频资源清单，可用 {{video0}} 占位' },
        upload_images_to_cos: { type: 'boolean', description: 'true 时把 image_assets 里的本地图片先上传 COS，再写入网页' },
        freeze_after_sec: { type: 'number', description: '可选冻结点。只有页面前几秒动完、后面完全静止时填写' },
        label: { type: 'string' },
        start_sec: { type: 'number' },
        duration: { type: 'number' },
      },
      required: ['fx_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    const clip = s.fxClips.find((c) => c.id === params.fx_id);
    if (!clip) return { success: false, output: '', error: `特效 ${params.fx_id} 不存在` };
    captureEditorSnapshot();

    const patch: Record<string, unknown> = {};
    if (params.label) patch.label = params.label as string;
    if (params.start_sec != null) patch.startSec = params.start_sec as number;
    if (params.duration != null) patch.duration = Math.max(0.5, params.duration as number);

    if (clip.componentId && (params.params != null || params.theme != null)) {
      if (clip.componentId.startsWith('page:')) {
        const tplId = clip.componentId.slice(5);
        const tpl = findPageTemplate(tplId);
        if (!tpl) return { success: false, output: '', error: `页面模板 ${tplId} 已不存在` };
        const merged = { ...(clip.params ?? {}), ...((params.params as Record<string, unknown>) ?? {}) };
        const theme = (params.theme as string | undefined) ?? clip.theme;
        const built = tpl.render(merged, theme);
        Object.assign(patch, { html: built.html, css: built.css, params: merged, theme });
      } else {
        const def = findFxComponent(clip.componentId);
        if (!def) return { success: false, output: '', error: `组件 ${clip.componentId} 已不存在` };
        const merged = { ...(clip.params ?? {}), ...((params.params as Record<string, unknown>) ?? {}) };
        const theme = (params.theme as string | undefined) ?? clip.theme;
        const built = def.render(merged, theme);
        Object.assign(patch, { html: built.html, css: built.css, params: merged, theme });
      }
    } else if (
      params.html !== undefined
      || params.html_path !== undefined
      || params.css !== undefined
      || params.css_path !== undefined
      || params.js !== undefined
      || params.js_path !== undefined
      || params.motion_mode !== undefined
      || params.image_assets !== undefined
      || params.video_assets !== undefined
      || params.freeze_after_sec !== undefined
    ) {
      const isFreePage = (clip.params as { mode?: string } | undefined)?.mode === 'free-page';
      if (isFreePage) {
        const imageAssets = Array.isArray(params.image_assets)
          ? (params.image_assets as unknown[]).map(String).filter(Boolean)
          : [];
        const preparedAssets = await maybeUploadFreePageAssetsToCos(imageAssets, Boolean(params.upload_images_to_cos));
        const currentParams = (clip.params as { motionMode?: unknown; videoAssets?: string[]; sourcePaths?: { html?: string; css?: string; js?: string } } | undefined);
        const videoAssets = Array.isArray(params.video_assets)
          ? (params.video_assets as unknown[]).map(String).filter(Boolean)
          : (currentParams?.videoAssets ?? []);
        const currentMotionMode = normalizeFreePageMotionMode((clip.params as { motionMode?: unknown } | undefined)?.motionMode);
        const motionMode = params.motion_mode !== undefined
          ? normalizeFreePageMotionMode(params.motion_mode)
          : currentMotionMode;
        const baseHtml = (params.js !== undefined || params.js_path !== undefined) && params.html === undefined && params.html_path === undefined
          ? clip.html
            .replace(/<script\b(?![^>]*\bsrc\s*=)[^>]*>[\s\S]*?<\/script>/gi, '')
            .replace(/\sdata-kp-motion-mode\s*=\s*["']ae["']/gi, '')
            .trim()
          : clip.html;
        const sourcePaths = {
          html: String(params.html_path ?? currentParams?.sourcePaths?.html ?? '').trim() || undefined,
          css: String(params.css_path ?? currentParams?.sourcePaths?.css ?? '').trim() || undefined,
          js: String(params.js_path ?? currentParams?.sourcePaths?.js ?? '').trim() || undefined,
        };
        const nextHtml = params.html_path !== undefined
          ? await freePageSource(params.html, params.html_path, 'HTML')
          : (params.html as string | undefined) ?? baseHtml;
        const nextCss = params.css_path !== undefined
          ? await freePageSource(params.css, params.css_path, 'CSS')
          : (params.css as string | undefined) ?? clip.css;
        const nextJs = params.js_path !== undefined
          ? await freePageSource(params.js, params.js_path, 'JS')
          : params.js as string | undefined;
        const next = normalizeFreePageDoc(
          nextHtml,
          nextCss,
          nextJs,
          preparedAssets,
          videoAssets,
          normalizeFreezeAfterSec(params.freeze_after_sec),
          motionMode,
        );
        const violations = validateFreePage(next.html, next.css);
        if (violations.length) return { success: false, output: '', error: `自由网页校验未通过：${violations.join('；')}` };
        Object.assign(patch, { html: next.html, css: next.css, componentId: undefined, params: { mode: 'free-page', motionMode, sourcePaths, videoAssets } });
      } else {
        if (params.html === undefined || params.css === undefined) {
          return { success: false, output: '', error: '普通特效需要同时传 html 和 css；自由网页可单独更新 html/css' };
        }
        const v = validateFx(params.html as string, params.css as string);
        if (!v.ok) return { success: false, output: '', error: `特效校验未通过：${v.violations.join('；')}` };
        Object.assign(patch, { html: params.html, css: params.css, componentId: undefined, params: undefined });
      }
    }

    if (Object.keys(patch).length === 0) {
      return { success: false, output: '', error: '没有可更新的字段' };
    }
    s.updateFxClip(clip.id, patch);
    await flushTimelineMutation();
    return { success: true, output: `特效 ${clip.id} 已更新` };
  },
};

const addOverlayTool: Tool = {
  definition: {
    name: 'timeline_add_overlay',
    description: '向独立视频轨添加视频/图片素材（视频轨 2 或视频轨 3，会作为独立视频轨导出到剪映）。坐标归一化：x/y 0=画面中心，±0.5=半幅边缘；scale 1=与画面同宽。默认铺到视频轨并可在播放器里调整位置大小。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '素材绝对路径' },
        kind: { type: 'string', enum: ['video', 'image'] },
        track: { type: 'number', description: '视频轨索引：0=视频轨2，1=视频轨3，默认 0' },
        start_sec: { type: 'number', description: '默认当前播放头' },
        x: { type: 'number' },
        y: { type: 'number' },
        scale: { type: 'number' },
        opacity: { type: 'number', description: '0-1' },
      },
      required: ['path', 'kind'],
    },
  },
  risk: 'safe',
  async execute(params) {
    captureEditorSnapshot();
    const s = useEditorStore.getState();
    const id = await s.addOverlayClip({
      path: params.path as string,
      kind: params.kind as 'video' | 'image',
      trackIndex: (params.track as 0 | 1 | undefined) ?? 0,
      startSec: params.start_sec as number | undefined,
    });
    if (params.x != null || params.y != null || params.scale != null || params.opacity != null) {
      const o = useEditorStore.getState().overlayClips.find((c) => c.id === id);
      if (o) {
        useEditorStore.getState().updateOverlayClip(id, {
          transform: {
            ...o.transform,
            ...(params.x != null ? { x: params.x as number } : {}),
            ...(params.y != null ? { y: params.y as number } : {}),
            ...(params.scale != null ? { scale: params.scale as number } : {}),
            ...(params.opacity != null ? { opacity: params.opacity as number } : {}),
          },
        });
      }
    }
    const clip = useEditorStore.getState().overlayClips.find((c) => c.id === id);
    if (clip) useEditorStore.getState().setPlayhead(clip.startSec);
    await flushTimelineMutation();
    return { success: true, output: clip ? clipReceipt(`素材已加入视频轨 ${((params.track as number | undefined) ?? 0) + 2}`, id, clip.startSec, Math.max(0.1, clip.outSec - clip.inSec || clip.duration || 0)) : `素材已加入视频轨 ${((params.track as number | undefined) ?? 0) + 2}，overlay_id: ${id}` };
  },
};

const clipStyleTool: Tool = {
  definition: {
    name: 'timeline_set_clip_style',
    description: `设置主轨片段的变速/倒放/镜像/旋转/调色。filter_preset 可用：${FILTER_PRESETS.map((p) => `${p.id}=${p.label}`).join('，')}。`,
    parameters: {
      type: 'object',
      properties: {
        clip_id: { type: 'string' },
        speed: { type: 'number', description: '0.1-4，1=原速（时间轴时长随之变化）' },
        reversed: { type: 'boolean' },
        flip_h: { type: 'boolean', description: '水平镜像' },
        rotate: { type: 'number', description: '0/90/180/270' },
        filter_preset: { type: 'string', description: '调色预设 id' },
      },
      required: ['clip_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    const clip = s.clips.find((c) => c.id === params.clip_id);
    if (!clip) return { success: false, output: '', error: '片段不存在' };
    captureEditorSnapshot();
    const patch: Record<string, unknown> = {};
    if (params.speed != null) patch.speed = Math.max(0.1, Math.min(4, params.speed as number));
    if (params.reversed != null) patch.reversed = params.reversed as boolean;
    if (params.flip_h != null) patch.flipH = params.flip_h as boolean;
    if (params.rotate != null) patch.rotate = params.rotate as 0 | 90 | 180 | 270;
    if (params.filter_preset != null) {
      const preset = FILTER_PRESETS.find((p) => p.id === params.filter_preset);
      if (!preset) return { success: false, output: '', error: `未知调色预设 ${params.filter_preset}` };
      patch.filter = { ...preset.values, preset: preset.id };
    }
    s.updateClip(clip.id, patch);
    return { success: true, output: '片段样式已更新' };
  },
};

const smartCutTool: Tool = {
  definition: {
    name: 'timeline_smart_cut',
    description: '智能剪口播：对主轨素材做词级转写（调用 ASR，花钱）→ 自动标记口癖/语气词句 → apply=true 直接应用为时间轴真实裁剪（可撤销）；apply=false 只标记，由用户在「文稿」面板复核后手动应用。',
    parameters: {
      type: 'object',
      properties: { apply: { type: 'boolean', description: '默认 false（只标记）' } },
      required: [],
    },
  },
  risk: 'ask',
  async execute(params) {
    const s = useEditorStore.getState();
    if (s.clips.length === 0) return { success: false, output: '', error: '时间轴为空' };
    const { ensureTranscript, smartMarkFillers, applyTranscriptCuts } = await import('@/lib/editor/transcriptOps');
    s.setTranscribing(true);
    try {
      const paths = [...new Set(s.clips.map((c) => c.path))];
      for (const p of paths) await ensureTranscript(p);
      const marked = smartMarkFillers();
      if (marked === 0) return { success: true, output: '转写完成，未检测到明显口癖句。文稿已生成，可在「文稿」面板查看。' };
      if (!params.apply) {
        return { success: true, output: `转写完成，已标记 ${marked} 句口癖/语气词（未应用）。用户可在「文稿」面板复核，或再调本工具 apply=true 应用。` };
      }
      captureEditorSnapshot();
      const r = applyTranscriptCuts();
      return { success: true, output: `已标记 ${marked} 句并应用裁剪：剪除 ${r.removedSec.toFixed(1)} 秒，主轨片段 ${r.clipsBefore} → ${r.clipsAfter}。` };
    } finally {
      useEditorStore.getState().setTranscribing(false);
    }
  },
};

const detectRedundancyTool: Tool = {
  definition: {
    name: 'timeline_detect_redundancy',
    description: '检测口播里的重复、废话和 ASR 盲区（旧接口）。mode=deep 已升级为证据链审片（等同 timeline_speech_audit：停顿+能量证据 → 原始重转写 → AI 信息增量判定，结果进剪口播面板）；mode=fast 只跑本地文本启发式。新任务建议直接用 timeline_speech_audit。',
    parameters: {
      type: 'object',
      properties: {
        start_sec: { type: 'number', description: '可选，只检测时间轴起点之后' },
        end_sec: { type: 'number', description: '可选，只检测时间轴终点之前' },
        window_sec: { type: 'number', description: 'fast 模式相似句回看窗口，默认 30 秒' },
        min_repeat_score: { type: 'number', description: 'fast 模式相似句阈值，默认 0.72' },
        mode: { type: 'string', enum: ['deep', 'fast'], description: 'deep=证据链审片（转调 timeline_speech_audit）；fast=仅本地文本启发式。默认 deep' },
        max_windows: { type: 'number', description: 'deep 模式可疑窗口上限，默认 30' },
        mark_candidates: { type: 'boolean', description: 'fast 模式：是否把高风险候选预标记删除，默认 false' },
      },
      required: [],
    },
  },
  risk: 'ask',
  async execute(params) {
    const s = useEditorStore.getState();
    if (s.clips.length === 0) return { success: false, output: '', error: '时间轴为空' };
    const mode = (params.mode as string | undefined) ?? 'deep';
    // deep 模式转调新审片引擎（证据链取代文本相似度 + LLM 纯听审）
    if (mode !== 'fast') {
      return speechAuditTool.execute({
        start_sec: params.start_sec,
        end_sec: params.end_sec,
        max_windows: params.max_windows,
      });
    }
    const ops = await import('@/lib/editor/transcriptOps');
    s.setTranscribing(true);
    try {
      const paths = [...new Set(s.clips.map((c) => c.path))];
      for (const p of paths) await ops.ensureTranscript(p);
    } finally {
      useEditorStore.getState().setTranscribing(false);
    }
    const report = ops.analyzeTranscriptRedundancy({
      startSec: params.start_sec as number | undefined,
      endSec: params.end_sec as number | undefined,
      windowSec: params.window_sec as number | undefined,
      minRepeatScore: params.min_repeat_score as number | undefined,
    });
    let marked = 0;
    if (params.mark_candidates) marked = ops.markRedundancyCandidates(report);
    const lines = report.issues.slice(0, 80).map(redundancyIssueLine);
    const suffix = report.issues.length > lines.length ? `\n...还有 ${report.issues.length - lines.length} 个候选未展开` : '';
    return {
      success: true,
      output: [
        report.summary,
        '注意：fast 模式只是文本启发式，同义反复和 ASR 吞掉的重录测不到；要准确结论用 timeline_speech_audit。',
        marked > 0 ? `已预标记 ${marked} 行高风险候选，复核后用 timeline_transcript(op:"apply") 应用。` : '未自动标记；请先复核候选再删。',
        lines.join('\n') || '没有发现明显重复/废话候选。',
        suffix,
      ].filter(Boolean).join('\n'),
    };
  },
};

const previewClipTool: Tool = {
  definition: {
    name: 'timeline_preview_clip',
    description: '预览一段口播的“说话密度/填充词密度”节奏图。它不是播放音频，而是把转写映射成时间轴密度条，帮助发现停顿、过密、疑似重复或 ASR 漏识别区域。',
    parameters: {
      type: 'object',
      properties: {
        start_sec: { type: 'number', description: '时间轴起点，默认 0' },
        end_sec: { type: 'number', description: '时间轴终点，默认全片' },
        bin_sec: { type: 'number', description: '每格秒数，默认 1，范围 0.5-5' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    if (s.clips.length === 0) return { success: false, output: '', error: '时间轴为空' };
    const ops = await import('@/lib/editor/transcriptOps');
    s.setTranscribing(true);
    try {
      const paths = [...new Set(s.clips.map((c) => c.path))];
      for (const p of paths) await ops.ensureTranscript(p);
    } finally {
      useEditorStore.getState().setTranscribing(false);
    }
    const bins = ops.buildTranscriptRhythmPreview({
      startSec: params.start_sec as number | undefined,
      endSec: params.end_sec as number | undefined,
      binSec: params.bin_sec as number | undefined,
    });
    return {
      success: true,
      output: bins.length > 0
        ? bins.map(rhythmBinLine).join('\n')
        : '没有可预览的文稿节奏。请先转写或检查时间范围。',
    };
  },
};

const templateTool: Tool = {
  definition: {
    name: 'timeline_apply_template',
    description: `成片结构模板。op=list 列出详情；op=apply 应用（替换当前时间轴结构，生成占位槽位+预置花字/音乐位）。模板：${PROJECT_TEMPLATES.map((t) => `${t.id}=${t.label}`).join('；')}。`,
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['list', 'apply'] },
        template_id: { type: 'string' },
      },
      required: ['op'],
    },
  },
  risk: 'safe',
  async execute(params) {
    if (params.op === 'list') {
      return {
        success: true,
        output: PROJECT_TEMPLATES.map((t) => `${t.id}「${t.label}」：${t.desc}（${t.slots.length} 个槽位）`).join('\n'),
      };
    }
    const tpl = findProjectTemplate(params.template_id as string);
    if (!tpl) return { success: false, output: '', error: `未知模板 ${params.template_id}` };
    captureEditorSnapshot();
    applyProjectTemplate(tpl);
    return { success: true, output: `模板「${tpl.label}」已应用，请按槽位提示填充素材（左侧素材库点击即可填入选中槽位）` };
  },
};

const markersTool: Tool = {
  definition: {
    name: 'timeline_markers',
    description: '踩点标记（标尺金色菱形，拖拽吸附用）。op=detect 自动音乐踩点（优先 BGM，无则取首段视频音轨）；op=set 直接设置秒数组；op=clear 清空。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['detect', 'set', 'clear'] },
        seconds: { type: 'array', items: { type: 'number' }, description: 'op=set 时的标记秒列表' },
      },
      required: ['op'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    if (params.op === 'clear') {
      s.setMarkers([]);
      return { success: true, output: '踩点已清空' };
    }
    if (params.op === 'set') {
      const ts = (params.seconds as number[] | undefined) ?? [];
      s.setMarkers(ts);
      return { success: true, output: `已设置 ${ts.length} 个踩点` };
    }
    const src = s.audioClips.find((a) => s.audioTracks.find((t) => t.id === a.trackId)?.kind === 'bgm')?.path ?? s.clips[0]?.path;
    if (!src) return { success: false, output: '', error: '没有可分析的音频（先加 BGM 或视频素材）' };
    const { detectBeats } = await import('@/lib/editor/beatDetect');
    const beats = await detectBeats(src);
    s.setMarkers(beats);
    return { success: true, output: `检测到 ${beats.length} 个节拍点：${beats.slice(0, 12).map((b) => b.toFixed(1)).join(', ')}${beats.length > 12 ? '…' : ''}` };
  },
};

const removeItemTool: Tool = {
  definition: {
    name: 'timeline_remove_item',
    description: '移除非主轨对象：视频轨2-3素材/花字/特效/音频片段（主轨片段用 timeline_remove_clip）。',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['overlay', 'text', 'fx', 'audio'] },
        id: { type: 'string' },
      },
      required: ['kind', 'id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    captureEditorSnapshot();
    const id = params.id as string;
    if (params.kind === 'overlay') s.removeOverlayClip(id);
    else if (params.kind === 'text') s.removeTextClip(id);
    else if (params.kind === 'fx') s.removeFxClip(id);
    else s.removeAudioClip(id);
    await flushTimelineMutation();
    return { success: true, output: '已移除' };
  },
};

const removeFxTool: Tool = {
  definition: {
    name: 'timeline_remove_fx',
    description: '删除一个特效、KPMotion 场景或自由页面片段。删除前验证 fx_id，成功后返回剩余特效数量。',
    parameters: {
      type: 'object',
      properties: { fx_id: { type: 'string', description: 'timeline_get_state 返回的特效 id' } },
      required: ['fx_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const store = useEditorStore.getState();
    const id = String(params.fx_id ?? '');
    const clip = store.fxClips.find((item) => item.id === id);
    if (!clip) {
      return {
        success: false,
        output: '',
        error: `特效不存在：${id || '(空)'}。当前可删除：${store.fxClips.map((item) => item.id).join('，') || '无'}`,
      };
    }
    captureEditorSnapshot();
    store.removeFxClip(id);
    await flushTimelineMutation();
    return {
      success: true,
      output: JSON.stringify({ removed: { id, label: clip.label }, remaining_fx: useEditorStore.getState().fxClips.length }, null, 2),
    };
  },
};

const rippleDeleteTool: Tool = {
  definition: {
    name: 'timeline_ripple_delete',
    description: '波纹删除当前选中对象：删除后把后面的花字/特效/音频/字幕/视频轨2-3素材/标记整体前移补空隙。适合剪映式“删除并补位”。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    captureEditorSnapshot();
    const ok = useEditorStore.getState().rippleDeleteSelected();
    return ok ? { success: true, output: '已波纹删除并补齐后续时间轴' } : { success: false, output: '', error: '当前没有选中对象' };
  },
};

const trackStateTool: Tool = {
  definition: {
    name: 'timeline_set_track_state',
    description: '设置剪辑轨道状态：锁定后 agent/UI 不应移动或切分该轨；隐藏后仅不显示轨道内容，素材仍保留。适合“锁住花字轨/隐藏特效轨”。',
    parameters: {
      type: 'object',
      properties: {
        track: { type: 'string', enum: ['fx', 'text', 'overlay-0', 'overlay-1', 'main', 'subtitle', 'audio-bgm', 'audio-sfx', 'audio-voice'] },
        locked: { type: 'boolean' },
        hidden: { type: 'boolean' },
      },
      required: ['track'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const patch: { locked?: boolean; hidden?: boolean } = {};
    if (typeof params.locked === 'boolean') patch.locked = params.locked;
    if (typeof params.hidden === 'boolean') patch.hidden = params.hidden;
    if (Object.keys(patch).length === 0) return { success: false, output: '', error: '需要 locked 或 hidden' };
    useEditorStore.getState().setTrackState(params.track as never, patch);
    return { success: true, output: `已更新轨道 ${params.track}: ${JSON.stringify(patch)}` };
  },
};

const transcriptTool: Tool = {
  definition: {
    name: 'timeline_transcript',
    description: '文稿剪辑（AI 剪流畅核心工具）。op=read 读取按时间轴片段实例展开的文稿行；op=detect 在 read 基础上给每行标注 repeat_score/filler_ratio/speed_anomaly 并列出重复/废话候选；op=cut_rows 按 row_id 或 label 立即删除对应时间轴文段并生成剪辑点；op=mark 用 row_ids 做片段级标记删除/恢复；op=delete_silence 删除“无人声/无字幕内容段”（默认按 ASR 文稿空白，不按音量）；op=detect_silence 只检测并预标记；op=apply 把所有标记行应用为真实裁剪。推荐：剪重复/废话先 op=detect 或 timeline_detect_redundancy，再 cut_rows 精确删除。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['read', 'detect', 'cut_rows', 'mark', 'detect_silence', 'delete_silence', 'apply'] },
        row_ids: { type: 'array', items: { type: 'string' }, description: 'op=cut_rows/mark 的时间轴文稿行 id 或 label 列表，来自 read 输出的 row_id/label' },
        sentence_ids: { type: 'array', items: { type: 'string' }, description: 'op=mark 的旧句 id 列表；不推荐，可能影响同源重复片段' },
        deleted: { type: 'boolean', description: 'op=mark：true=标记删除（默认），false=恢复' },
        start_sec: { type: 'number', description: 'op=detect 时的时间轴起点' },
        end_sec: { type: 'number', description: 'op=detect 时的时间轴终点' },
        window_sec: { type: 'number', description: 'op=detect 时相似句回看窗口，默认 30 秒' },
        min_dur: { type: 'number', description: 'op=detect_silence/delete_silence：最短无人声/无字幕秒数，默认 0.8' },
        silence_mode: { type: 'string', enum: ['transcript_gap', 'low_audio'], description: 'transcript_gap=默认，按 ASR 文稿空白判断无人声/无字幕；low_audio=旧逻辑，按音量阈值检测' },
        noise_db: { type: 'number', description: 'silence_mode=low_audio 时的音量阈值 dB，默认 -35' },
      },
      required: ['op'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const s = useEditorStore.getState();
    if (s.clips.length === 0) return { success: false, output: '', error: '时间轴为空' };
    const ops = await import('@/lib/editor/transcriptOps');
    const paths = [...new Set(s.clips.map((c) => c.path))];

    if (params.op === 'read') {
      s.setTranscribing(true);
      try {
        for (const p of paths) await ops.ensureTranscript(p);
      } finally {
        useEditorStore.getState().setTranscribing(false);
      }
      const lines: string[] = [];
      for (const row of ops.buildTranscriptTimelineRows()) {
        lines.push(transcriptRowLine(row));
      }
      return { success: true, output: lines.join('\n') || '转写为空' };
    }

    if (params.op === 'detect') {
      s.setTranscribing(true);
      try {
        for (const p of paths) await ops.ensureTranscript(p);
      } finally {
        useEditorStore.getState().setTranscribing(false);
      }
      const report = ops.analyzeTranscriptRedundancy({
        startSec: params.start_sec as number | undefined,
        endSec: params.end_sec as number | undefined,
        windowSec: params.window_sec as number | undefined,
      });
      const diag = report.diagnostics.map((row) => [
        `[row_id:${row.rowId}] [label:${row.label}]`,
        `时间轴${row.timelineStart.toFixed(2)}-${row.timelineEnd.toFixed(2)}s`,
        `repeat_score:${row.repeatScore}`,
        `filler_ratio:${row.fillerRatio}`,
        `speed:${row.charsPerSec}/s${row.speedAnomaly ? `(${row.speedAnomaly})` : ''}`,
        row.comparedWith ? `近似:${row.comparedWith}` : '',
        row.text,
      ].filter(Boolean).join(' '));
      const issues = report.issues.slice(0, 60).map(redundancyIssueLine);
      return {
        success: true,
        output: [
          report.summary,
          '逐行诊断:',
          diag.join('\n') || '无文稿行',
          issues.length > 0 ? '候选问题:' : '',
          issues.join('\n'),
        ].filter(Boolean).join('\n'),
      };
    }

    if (params.op === 'cut_rows') {
      const ids = (params.row_ids as string[] | undefined) ?? [];
      if (ids.length === 0) return { success: false, output: '', error: 'row_ids 不能为空' };
      captureEditorSnapshot();
      let removed = 0;
      let hit = 0;
      const rowsAll = ops.buildTranscriptTimelineRows();
      const rows = ids
        .map((id) => rowByIdOrLabel(rowsAll, id))
        .filter((row): row is NonNullable<typeof row> => Boolean(row))
        .sort((a, b) => b.timelineStart - a.timelineStart);
      for (const row of rows) {
        const r = ops.cutTranscriptTimelineRow(row);
        if (r.success) { hit += 1; removed += r.removedSec; }
      }
      const missed = ids.filter((id) => !rows.some((row) => row.id === id || row.label === id));
      return { success: true, output: `已删除 ${hit}/${ids.length} 个文稿行，剪除 ${removed.toFixed(1)} 秒，并生成对应剪辑点（可撤销）${missed.length ? `。未找到：${missed.join(', ')}` : ''}` };
    }

    if (params.op === 'mark') {
      const del = (params.deleted as boolean | undefined) ?? true;
      const rowIds = (params.row_ids as string[] | undefined) ?? [];
      if (rowIds.length > 0) {
        const rowsAll = ops.buildTranscriptTimelineRows();
        let hit = 0;
        for (const id of rowIds) {
          const row = rowByIdOrLabel(rowsAll, id);
          if (!row) continue;
          useEditorStore.getState().setTranscriptRowDeleted(row.id, del);
          hit += 1;
        }
        return { success: true, output: `已${del ? '标记删除' : '恢复'} ${hit}/${rowIds.length} 个文稿行（片段级，不影响同源重复片段）。确认后用 op=apply 执行真实裁剪。` };
      }
      const ids = (params.sentence_ids as string[] | undefined) ?? [];
      if (ids.length === 0) return { success: false, output: '', error: '需要 row_ids；旧流程才传 sentence_ids' };
      const all = useEditorStore.getState().transcripts;
      let hit = 0;
      for (const p of paths) {
        const tr = all[p];
        if (!tr) continue;
        for (const sen of tr.sentences) {
          if (ids.includes(sen.id)) {
            useEditorStore.getState().setSentenceDeleted(p, sen.id, del);
            hit += 1;
          }
        }
      }
      return { success: true, output: `已${del ? '标记删除' : '恢复'} ${hit}/${ids.length} 句（兼容旧 sentence_id 模式，会影响同源重复片段；新任务请用 row_ids）` };
    }

    if (params.op === 'detect_silence' || params.op === 'delete_silence') {
      let total = 0;
      const beforeRows = ops.buildTranscriptTimelineRows().length;
      const mode = (params.silence_mode as string | undefined) ?? 'transcript_gap';
      for (const p of paths) {
        const ranges = mode === 'low_audio'
          ? await ops.detectAudioSilences(p, (params.min_dur as number | undefined) ?? 0.8, (params.noise_db as number | undefined) ?? -35)
          : await ops.detectSpeechlessRanges(p, (params.min_dur as number | undefined) ?? 0.8);
        total += ops.injectSilenceSentences(p, ranges);
      }
      if (params.op === 'delete_silence') {
        captureEditorSnapshot();
        const rows = ops.buildTranscriptTimelineRows()
          .filter((row) => row.silence)
          .sort((a, b) => b.timelineStart - a.timelineStart);
        let removed = 0;
        let hit = 0;
        for (const row of rows) {
          const r = ops.cutTranscriptTimelineRow(row);
          if (r.success) { hit += 1; removed += r.removedSec; }
        }
        return { success: true, output: hit > 0 ? `已删除 ${hit} 个无人声/无字幕段，剪除 ${removed.toFixed(1)} 秒（检测前文稿行 ${beforeRows}，新增空白行 ${total}，模式 ${mode}）` : '未检测到可删除的无人声/无字幕段' };
      }
      return { success: true, output: total > 0 ? `检测到 ${total} 个无人声/无字幕段，已注入为预标记句（apply 后剪除，模式 ${mode}）` : '未检测到明显无人声/无字幕段' };
    }

    // apply
    captureEditorSnapshot();
    const r = ops.applyTranscriptCuts();
    if (r.removedSec <= 0) return { success: true, output: '没有已标记的句子，未做裁剪' };
    return { success: true, output: `已应用文稿裁剪：剪除 ${r.removedSec.toFixed(1)} 秒，主轨片段 ${r.clipsBefore} → ${r.clipsAfter}（可撤销）` };
  },
};

// ── 口播审片系统（speechAudit：证据链审片，取代文本相似度检测）────────────────

function findingLine(f: import('@/lib/editor/speechAudit/types').SpeechFinding): string {
  const evid = f.evidence.map((e) => e.detail).join('；');
  return [
    `[finding_id:${f.id}] [${f.category}] ${f.enabled ? '✓已勾选' : '✗未勾选'}`,
    `源${f.sourceStart.toFixed(2)}-${f.sourceEnd.toFixed(2)}s`,
    `置信度${(f.confidence * 100).toFixed(0)}%`,
    `「${f.text}」`,
    f.keptAlternativeText ? `保留遍:「${f.keptAlternativeText}」` : '',
    evid ? `证据: ${evid}` : '',
  ].filter(Boolean).join(' ');
}

const speechAuditTool: Tool = {
  definition: {
    name: 'timeline_speech_audit',
    description: '口播审片引擎（花钱：短窗原始重转写 + AI 语义判定）。这是“剪重复/废话/口误/剪流畅”的首选入口。流程：词级停顿模式 + 能量包络互相关找重录候选 → 可疑窗口关闭 ASR 语义规范化重转写（恢复被清洗的重复口误）→ AI 按信息增量判定并选保留讲得更顺的一遍。判断 repeat 不是文字相似，而是同一信息点重复；保留停顿少、语速均匀、句子完整的一遍。语气词/停顿本地免费秒出。结果写入剪口播面板，全部只标记不自动剪，必须用户复核后再 timeline_speech_apply。取代旧 timeline_detect_redundancy 的 deep 模式。',
    parameters: {
      type: 'object',
      properties: {
        start_sec: { type: 'number', description: '可选，只审时间轴这个起点之后' },
        end_sec: { type: 'number', description: '可选，只审时间轴这个终点之前' },
        max_windows: { type: 'number', description: '可疑窗口上限，默认 30' },
      },
      required: [],
    },
  },
  risk: 'ask',
  async execute(params) {
    const s = useEditorStore.getState();
    if (s.clips.length === 0) return { success: false, output: '', error: '时间轴为空' };
    const { runSpeechAudit, isAuditRunning } = await import('@/lib/editor/speechAudit/engine');
    if (isAuditRunning()) return { success: false, output: '', error: '审片正在进行中，请稍候' };
    const report = await runSpeechAudit({
      startSec: params.start_sec as number | undefined,
      endSec: params.end_sec as number | undefined,
      maxWindows: params.max_windows as number | undefined,
    });
    const byCat = new Map<string, number>();
    for (const f of report.findings) byCat.set(f.category, (byCat.get(f.category) ?? 0) + 1);
    const catSummary = [...byCat.entries()].map(([c, n]) => `${c}:${n}`).join(' ');
    const lines = report.findings.slice(0, 60).map(findingLine);
    return {
      success: true,
      output: [
        `审片完成：${report.findings.length} 个候选（${catSummary}）。窗口 ${report.stats.windows} 个 / ASR ${report.stats.asrCalls} 次 / AI ${report.stats.llmCalls} 次。`,
        '候选已写入「剪口播」面板（全部只标记）。用 timeline_speech_findings 调整勾选，用户复核后 timeline_speech_apply 应用。',
        ...lines,
        report.findings.length > lines.length ? `...还有 ${report.findings.length - lines.length} 条` : '',
      ].filter(Boolean).join('\n'),
    };
  },
};

const speechFindingsTool: Tool = {
  definition: {
    name: 'timeline_speech_findings',
    description: '读取/调整口播审片候选（不花钱不剪辑）。op=list 列出当前 findings（含勾选状态与证据），用于向用户解释“为什么建议删/保留”；op=set_enabled 按 finding_ids 或 category 切换勾选（enabled=false 即排除，用户在剪口播面板实时可见）。应用删除用 timeline_speech_apply。注意：标点和段落只是阅读辅助，不是删除证据。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['list', 'set_enabled'] },
        finding_ids: { type: 'array', items: { type: 'string' }, description: 'op=set_enabled：目标 finding id 列表' },
        category: { type: 'string', enum: ['filler', 'repeat', 'pause', 'stutter', 'rambling', 'manual'], description: 'op=set_enabled：按类别批量（与 finding_ids 二选一）' },
        enabled: { type: 'boolean', description: 'op=set_enabled：true=勾选，false=排除' },
      },
      required: ['op'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    const report = s.speechAudit;
    if (!report || report.findings.length === 0) {
      return { success: true, output: '当前没有审片候选。先跑 timeline_speech_audit。' };
    }
    if (params.op === 'list') {
      const lines = report.findings.map(findingLine);
      return { success: true, output: [`共 ${report.findings.length} 个候选（状态 ${report.status}）:`, ...lines].join('\n') };
    }
    // set_enabled
    const enabled = (params.enabled as boolean | undefined) ?? true;
    const ids = (params.finding_ids as string[] | undefined) ?? [];
    const category = params.category as string | undefined;
    let hit = 0;
    if (ids.length > 0) {
      for (const id of ids) {
        if (report.findings.some((f) => f.id === id)) {
          s.updateSpeechFinding(id, { enabled });
          hit += 1;
        }
      }
    } else if (category) {
      hit = report.findings.filter((f) => f.category === category).length;
      s.setSpeechFindingsEnabled(category as import('@/lib/editor/speechAudit/types').FindingCategory, enabled);
    } else {
      return { success: false, output: '', error: '需要 finding_ids 或 category' };
    }
    return { success: true, output: `已${enabled ? '勾选' : '排除'} ${hit} 个候选（面板同步更新）` };
  },
};

const speechApplyTool: Tool = {
  definition: {
    name: 'timeline_speech_apply',
    description: '把口播审片中已勾选（enabled）的候选应用为时间轴真实剪辑（与剪口播面板「删除」按钮同一管线，可撤销）。剪后自动做边界验证（抽查剪切点是否切到半个字）。务必先经用户确认候选；不要在刚跑完 timeline_speech_audit 后未经确认就调用。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'ask',
  async execute() {
    const s = useEditorStore.getState();
    const report = s.speechAudit;
    if (!report) return { success: false, output: '', error: '没有审片报告，先跑 timeline_speech_audit' };
    const { applySpeechFindings } = await import('@/lib/editor/speechAudit/apply');
    const { verifyCutBoundaries } = await import('@/lib/editor/speechAudit/verify');
    const minPause = s.speechMinPauseSec;
    const targets = report.findings.filter((f) => f.enabled && (f.category !== 'pause' || (f.pauseDur ?? 0) >= minPause));
    if (targets.length === 0) return { success: true, output: '没有已勾选的候选，未做剪辑' };
    captureEditorSnapshot();
    const r = applySpeechFindings(targets);
    let verifyNote = '';
    try {
      const v = await verifyCutBoundaries(r);
      verifyNote = v.issues.length > 0
        ? `边界验证：抽查 ${v.checked} 处，${v.issues.length} 处疑似切字——${v.issues.map((x) => `${x.timelineSec.toFixed(1)}s ${x.detail}`).join('；')}。建议提示用户到对应时间码试听。`
        : `边界验证：抽查 ${v.checked} 处剪切点，未发现切字问题。`;
    } catch { verifyNote = '边界验证跳过（ASR 不可用）'; }
    return {
      success: true,
      output: `已应用 ${r.appliedCount} 处删除，剪除 ${r.removedSec.toFixed(1)} 秒（片段 ${r.clipsBefore} → ${r.clipsAfter}，可撤销）。\n${verifyNote}`,
    };
  },
};

const transcriptReadTool: Tool = {
  definition: {
    name: 'timeline_transcript_read',
    description: '只读读取文稿行（按时间轴片段实例展开，含 row_id/label/时间区间）。素材未转写时会触发 ASR 转写（首次花钱，之后缓存）。写操作（cut_rows/mark/apply 等）用 timeline_transcript。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    const s = useEditorStore.getState();
    if (s.clips.length === 0) return { success: false, output: '', error: '时间轴为空' };
    const ops = await import('@/lib/editor/transcriptOps');
    const paths = [...new Set(s.clips.map((c) => c.path))];
    s.setTranscribing(true);
    try {
      for (const p of paths) await ops.ensureTranscript(p);
    } finally {
      useEditorStore.getState().setTranscribing(false);
    }
    const lines = ops.buildTranscriptTimelineRows().map(transcriptRowLine);
    return { success: true, output: lines.join('\n') || '转写为空' };
  },
};

// ── P5：AI 成片计划卡片流（OpenStoryline 式：提案 → 用户复核 → 应用）─────────

function renderMediaNote(path: string, note: { frames: [number, string][]; transcript?: string; duration?: number }): string {
  const lines = [`# ${path.split('/').pop()}（${note.duration ? `${note.duration.toFixed(0)}s` : '?'}）→ ${path}`];
  for (const [t, d] of note.frames) lines.push(`@${t}s ${d}`);
  if (note.transcript) lines.push(`语音：${note.transcript}`);
  return lines.join('\n');
}

const proposePlanTool: Tool = {
  definition: {
    name: 'timeline_propose_plan',
    description: '提出剪辑计划（卡片流提案，不动时间轴）。把成片方案写成镜头序列：每镜指定素材绝对路径、入出点（秒）、标签和选用理由。UI 自动弹出计划面板供用户逐卡复核/换素材/改时长，用户确认后再调 timeline_apply_plan 落轨。适用所有"先提案再执行"场景：逐字稿剪流畅、分镜脚本组装、高光切片等。理由务必具体（为什么选这段、对应脚本哪一镜）。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '计划标题，如「分镜脚本成片 v1」' },
        shots: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              label: { type: 'string', description: '镜头标签，如「开场 hook」' },
              source_path: { type: 'string', description: '素材绝对路径' },
              in_sec: { type: 'number' },
              out_sec: { type: 'number' },
              reason: { type: 'string', description: '选这段的理由（用户可见）' },
            },
            required: ['label', 'source_path', 'in_sec', 'out_sec', 'reason'],
          },
        },
      },
      required: ['title', 'shots'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const shotsIn = params.shots as { label: string; source_path: string; in_sec: number; out_sec: number; reason: string }[];
    if (!shotsIn?.length) return { success: false, output: '', error: 'shots 不能为空' };
    const { nanoid } = await import('nanoid');
    const plan = {
      id: `plan-${nanoid(6)}`,
      title: (params.title as string) || '剪辑计划',
      createdAt: Date.now(),
      shots: shotsIn.map((x) => ({
        id: `ps-${nanoid(6)}`,
        label: x.label,
        sourcePath: x.source_path,
        inSec: Math.max(0, x.in_sec),
        outSec: Math.max(x.in_sec + 0.2, x.out_sec),
        reason: x.reason,
        status: 'pending' as const,
      })),
    };
    useEditorStore.getState().setPlan(plan);
    const total = plan.shots.reduce((a, s) => a + (s.outSec - s.inSec), 0);
    return {
      success: true,
      output: `计划「${plan.title}」已提交（${plan.shots.length} 镜 · 约 ${total.toFixed(1)}s），计划面板已打开。等用户复核或按用户指令 timeline_update_plan_shot 调整；用户同意后 timeline_apply_plan。\n${plan.shots.map((s, i) => `${i + 1}. [${s.id}] ${s.label} ${s.inSec.toFixed(1)}-${s.outSec.toFixed(1)}s ← ${s.sourcePath.split('/').pop()}`).join('\n')}`,
    };
  },
};

const updatePlanShotTool: Tool = {
  definition: {
    name: 'timeline_update_plan_shot',
    description: '修改剪辑计划里的单个镜头卡：换素材 / 改入出点 / 改标签理由 / 拒绝（status=rejected）或恢复（status=pending）。',
    parameters: {
      type: 'object',
      properties: {
        shot_id: { type: 'string', description: '镜头卡 id（timeline_propose_plan 返回的 [ps-xxx]）' },
        source_path: { type: 'string' },
        in_sec: { type: 'number' },
        out_sec: { type: 'number' },
        label: { type: 'string' },
        reason: { type: 'string' },
        status: { type: 'string', enum: ['pending', 'rejected'] },
      },
      required: ['shot_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const s = useEditorStore.getState();
    if (!s.plan) return { success: false, output: '', error: '当前没有剪辑计划，先 timeline_propose_plan' };
    const shot = s.plan.shots.find((x) => x.id === params.shot_id);
    if (!shot) return { success: false, output: '', error: `镜头卡 ${params.shot_id} 不存在` };
    const patch: Record<string, unknown> = {};
    if (params.source_path != null) patch.sourcePath = params.source_path;
    if (params.in_sec != null) patch.inSec = params.in_sec;
    if (params.out_sec != null) patch.outSec = params.out_sec;
    if (params.label != null) patch.label = params.label;
    if (params.reason != null) patch.reason = params.reason;
    if (params.status != null) patch.status = params.status;
    s.updatePlanShot(shot.id, patch as never);
    return { success: true, output: `镜头卡「${shot.label}」已更新（面板实时同步）` };
  },
};

const applyPlanTool: Tool = {
  definition: {
    name: 'timeline_apply_plan',
    description: '把剪辑计划中所有 pending 镜头按序落到主轨（追加片段 + 按入出点裁剪）。会改动时间轴（可撤销）。务必在用户确认计划后调用。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'ask',
  async execute() {
    const s = useEditorStore.getState();
    if (!s.plan) return { success: false, output: '', error: '当前没有剪辑计划' };
    const pending = s.plan.shots.filter((x) => x.status === 'pending');
    if (pending.length === 0) return { success: false, output: '', error: '计划里没有待应用的镜头（全部已应用或被拒绝）' };
    captureEditorSnapshot();
    const { applyPendingPlanShots } = await import('@/lib/editor/planApply');
    const r = await applyPendingPlanShots();
    const failText = r.failures.map((f) => `${f.label}: ${f.reason}`).join('；');
    return {
      success: r.applied > 0,
      output: `计划已应用：${r.applied}/${r.total} 镜按序落主轨（可撤销）${failText ? `\n失败：${failText}` : ''}`,
      ...(r.applied === 0 ? { error: failText } : {}),
    };
  },
};

const analyzeMediaTool: Tool = {
  definition: {
    name: 'timeline_analyze_media',
    description: '按需分析视频素材内容（抽帧 AI 视觉描述 + 可选语音转写，花钱），结果缓存进项目防重复消费——已分析过的素材直接返回缓存。用于"分镜脚本挑素材组装"等需要了解素材画面的场景。每素材抽帧 ≤12 张（长视频每分钟 1 帧）。画布视频节点和产物库的本地路径都可以传。',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '素材绝对路径列表' },
        with_transcript: { type: 'boolean', description: '同时转写语音（额外花钱，口播素材建议开）' },
        force: { type: 'boolean', description: '忽略缓存重新分析' },
      },
      required: ['paths'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const paths = params.paths as string[];
    if (!paths?.length) return { success: false, output: '', error: 'paths 不能为空' };
    const { invoke } = await import('@tauri-apps/api/tauri');
    const { detectFfmpeg, probeDuration } = await import('@/lib/canvas/videoCompose');
    const { dmxVisionDescribe } = await import('./dmxClient');
    const ffmpeg = await detectFfmpeg();
    if (!ffmpeg) return { success: false, output: '', error: '未检测到 ffmpeg（macOS: brew install ffmpeg；Windows: winget install ffmpeg）' };
    const workspace = await invoke<string>('ensure_workspace');
    const outDir = `${workspace}/images`;
    const qq = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

    const reports: string[] = [];
    for (const path of paths) {
      const cached = useEditorStore.getState().mediaNotes[path];
      if (cached && !params.force) {
        reports.push(`（缓存）${renderMediaNote(path, cached)}`);
        continue;
      }
      const duration = await probeDuration(path);
      if (!duration) { reports.push(`# ${path.split('/').pop()}：无法读取时长，跳过`); continue; }
      // 采样：短视频 4-6 帧均匀，长视频每分钟 1 帧，上限 12
      const step = duration <= 60 ? Math.max(4, duration / 5) : Math.max(60, duration / 12);
      const times: number[] = [];
      for (let t = Math.min(1, duration / 2); t < duration && times.length < 12; t += step) times.push(t);
      const frames: [number, string][] = [];
      for (const t of times) {
        const out = `${outDir}/analyze_${Date.now()}_${Math.round(t)}.jpg`;
        const r = await invoke<{ stdout: string; stderr: string; exit_code: number }>('execute_command', {
          command: `${ffmpeg} -ss ${t.toFixed(1)} -i ${qq(path)} -frames:v 1 -vf "scale=480:-2" -q:v 4 ${qq(out)} -y`,
          timeoutMs: 60000,
        }).catch(() => ({ stdout: '', stderr: '', exit_code: 1 }));
        if (r.exit_code !== 0) continue;
        try {
          const desc = await dmxVisionDescribe(out, '一句话描述画面内容（主体/动作/场景/景别），直接输出，不要解释。');
          frames.push([Math.round(t), desc]);
        } catch { /* 单帧识别失败不阻塞 */ }
      }
      let transcript: string | undefined;
      if (params.with_transcript) {
        try {
          const ops = await import('@/lib/editor/transcriptOps');
          await ops.ensureTranscript(path);
          const tr = useEditorStore.getState().transcripts[path];
          transcript = tr?.sentences.map((x) => x.text).join(' ').slice(0, 1500) || undefined;
        } catch { /* 转写失败不阻塞视觉结果 */ }
      }
      const note = { frames, transcript, duration, analyzedAt: Date.now() };
      useEditorStore.getState().setMediaNote(path, note);
      reports.push(renderMediaNote(path, note));
    }
    return { success: true, output: reports.join('\n\n') || '没有可分析的素材' };
  },
};

function findReferenceNotes(referenceIds: string[]) {
  const notes = Object.values(useEditorStore.getState().mediaNotes);
  return referenceIds.map((id) =>
    notes.find((note) => note.referenceId === id || note.referenceProfile?.id === id),
  ).filter((note): note is NonNullable<typeof note> => Boolean(note));
}

const analyzeReferenceVideoTool: Tool = {
  definition: {
    name: 'timeline_analyze_reference_video',
    description: 'Kimi 剪辑 Agent 拉片分析参考视频：完整转写音频、ffmpeg 镜头切点检测、密集关键帧抽取、Kimi 生成 EditReferenceProfile，并缓存到项目内。适合让鲲鹏学习参考片节奏、运镜、字幕/HTML 动画和叙事结构。',
    parameters: {
      type: 'object',
      properties: {
        paths: { type: 'array', items: { type: 'string' }, description: '参考视频绝对路径列表' },
        force: { type: 'boolean', description: '忽略缓存重新分析' },
        native_first: { type: 'boolean', description: '优先上传到 Kimi 文件服务，让 Kimi 原生理解视频。默认 true；失败后自动抽帧降级' },
        mode: { type: 'string', enum: ['quick', 'full'], description: 'quick 更快；full 默认抽 120-180 帧级别的密集样本' },
      },
      required: ['paths'],
    },
  },
  risk: 'ask',
  async execute(params, signal) {
    const paths = params.paths as string[];
    if (!paths?.length) return { success: false, output: '', error: 'paths 不能为空' };
    const mode = (params.mode as 'quick' | 'full' | undefined) ?? 'full';
    const { analyzeReferenceVideo, getVideoSourceFingerprint } = await import('@/lib/editor/kimiEditAgent');
    const { useRunStepStore } = await import('@/stores/runStepStore');
    const progress = (message: string) => {
      useRunStepStore.getState().appendStepNote(message, 'timeline_analyze_reference_video');
    };
    const reports: string[] = [];
    for (const path of paths) {
      if (signal?.aborted) return { success: false, output: reports.join('\n\n'), error: '已停止参考视频分析' };
      const sourceHash = await getVideoSourceFingerprint(path);
      const cached = useEditorStore.getState().mediaNotes[path];
      if (cached?.referenceProfile && cached.sourceHash === sourceHash && !params.force) {
        reports.push(`（缓存）${cached.referenceId} · ${cached.referenceProfile.title} · ${cached.frameNotes?.length ?? cached.frames.length} 帧 · ${cached.transcriptSegments?.length ?? 0} 段转写`);
        continue;
      }
      const fileName = path.split('/').pop() ?? path;
      const updateProgress = (message: string) => {
        progress(message);
        useEditorStore.getState().setMediaNote(path, {
          frames: cached?.frames ?? [],
          analyzedAt: cached?.analyzedAt ?? Date.now(),
          sourceHash,
          analysisState: { status: 'running', stage: message.replace(/^Kimi 剪辑 Agent：/, ''), updatedAt: Date.now() },
        });
      };
      updateProgress(`Kimi 剪辑 Agent：开始分析 ${fileName}`);
      try {
        const note = await analyzeReferenceVideo(path, {
          mode,
          nativeFirst: params.native_first !== false,
          onProgress: updateProgress,
          signal,
        });
        useEditorStore.getState().setMediaNote(path, note);
        progress(`Kimi 剪辑 Agent：已缓存参考片档案 ${note.referenceId}`);
        const p = note.referenceProfile;
        const native = note.analysisMode === 'native';
        reports.push([
          `${note.referenceId} · ${p?.title ?? fileName} · ${native ? '原生视频理解' : '本地索引分析'}`,
          `时长 ${(note.duration ?? 0).toFixed(1)}s · 关键帧 ${note.frameNotes?.length ?? note.frames.length} · 转写 ${note.transcriptSegments?.length ?? 0} 段`,
          p?.narrativeStructure?.length ? `叙事：${p.narrativeStructure.slice(0, 3).join('；')}` : '',
          p?.rhythm?.length ? `节奏：${p.rhythm.slice(0, 3).join('；')}` : '',
          p?.reusablePrinciples?.length ? `原则：${p.reusablePrinciples.slice(0, 3).join('；')}` : '',
        ].filter(Boolean).join('\n'));
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        useEditorStore.getState().setMediaNote(path, {
          frames: useEditorStore.getState().mediaNotes[path]?.frames ?? [],
          analyzedAt: useEditorStore.getState().mediaNotes[path]?.analyzedAt ?? Date.now(),
          sourceHash,
          analysisState: { status: 'failed', stage: '分析未完成', error: reason, updatedAt: Date.now() },
        });
        return { success: false, output: reports.join('\n\n'), error: `${fileName} 分析失败：${reason}` };
      }
    }
    return { success: true, output: reports.join('\n\n') };
  },
};

const inspectVideoSegmentTool: Tool = {
  definition: {
    name: 'timeline_inspect_video_segment',
    description: '精看参考视频中的一个 1-30 秒片段。用于在全片索引定位后确认人物动作、表演、运镜、剪辑点或口播细节；只上传压缩后的小片段，不上传几个 GB 的原片。',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: '本地参考视频绝对路径' },
        start_sec: { type: 'number', description: '片段开始时间，秒' },
        end_sec: { type: 'number', description: '片段结束时间，秒；与开始时间相差最多 30 秒' },
        question: { type: 'string', description: '要确认的具体问题，例如人物动作变化、摄像机运动、剪辑点或准确口播' },
      },
      required: ['path', 'start_sec', 'end_sec', 'question'],
    },
  },
  risk: 'ask',
  async execute(params, signal) {
    const path = String(params.path ?? '');
    const start = Math.max(0, Number(params.start_sec ?? 0));
    const requestedEnd = Number(params.end_sec ?? start + 10);
    const end = Math.min(start + 30, Math.max(start + 1, requestedEnd));
    if (!path) return { success: false, output: '', error: 'path 不能为空' };
    if (signal?.aborted) return { success: false, output: '', error: '已停止片段精看' };

    const { invoke } = await import('@tauri-apps/api/tauri');
    const { removeFile } = await import('@tauri-apps/api/fs');
    const { detectFfmpeg } = await import('@/lib/canvas/videoCompose');
    const { uploadVideoToKimi } = await import('@/lib/agent/kimiFiles');
    const { kimiK3Chat } = await import('@/lib/agent/kimiClient');
    const { useRunStepStore } = await import('@/stores/runStepStore');
    const ffmpeg = await detectFfmpeg();
    if (!ffmpeg) return { success: false, output: '', error: '未检测到 ffmpeg，无法截取检查片段' };
    const workspace = await invoke<string>('ensure_workspace');
    const tempDir = `${workspace}/videos/.kimi-segments`;
    const tempPath = `${tempDir}/segment-${Date.now()}-${Math.round(start * 1000)}.mp4`;
    const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;
    const duration = end - start;
    // videotoolbox 仅 macOS 存在；其他平台回退 libx264（与 composeEngine 一致）。
    const { hasVideoToolbox } = await import('@/lib/editor/composeEngine');
    const clipEncoder = (await hasVideoToolbox(ffmpeg))
      ? '-c:v h264_videotoolbox -allow_sw 1 -b:v 2200k'
      : '-c:v libx264 -preset veryfast -b:v 2200k -pix_fmt yuv420p';
    const clipResult = await invoke<{ stdout: string; stderr: string; exit_code: number }>('execute_command', {
      command: `mkdir -p ${quote(tempDir)} && ${ffmpeg} -y -ss ${start.toFixed(3)} -i ${quote(path)} -t ${duration.toFixed(3)} -vf "scale='min(1280,iw)':-2" -r 24 ${clipEncoder} -c:a aac -b:a 96k -movflags +faststart ${quote(tempPath)}`,
      timeoutMs: 300000,
    });
    if (clipResult.exit_code !== 0) {
      return { success: false, output: '', error: `片段截取失败：${clipResult.stderr || clipResult.stdout}` };
    }

    try {
      const uploaded = await uploadVideoToKimi(tempPath, (progress) => {
        useRunStepStore.getState().appendStepNote(`正在上传精看片段 ${progress.percent}%`, 'timeline_inspect_video_segment');
      });
      if (signal?.aborted) return { success: false, output: '', error: '已停止片段精看' };
      const note = useEditorStore.getState().mediaNotes[path];
      const nearbyTranscript = (note?.transcriptSegments ?? [])
        .filter((segment) => segment.end >= start && segment.start <= end)
        .map((segment) => `[${segment.start.toFixed(1)}-${segment.end.toFixed(1)}] ${segment.text}`)
        .join('\n');
      const answer = await kimiK3Chat([
        {
          role: 'system',
          content: '你是专业电影剪辑师和视听分析师。只根据视频片段与给出的转写证据回答，明确区分画面可见事实和推断。',
        },
        {
          role: 'user',
          content: [
            { type: 'video_url', video_url: { url: uploaded.url } },
            { type: 'text', text: `原片时间范围：${start.toFixed(2)}-${end.toFixed(2)} 秒。\n问题：${String(params.question)}\n${nearbyTranscript ? `同期转写：\n${nearbyTranscript}` : '本段暂无可靠转写。'}\n请按“观察 / 时间点 / 结论”简洁回答。` },
          ],
        },
      ], { timeout: 600, signal });
      return { success: true, output: `精看片段 ${start.toFixed(2)}-${end.toFixed(2)}s\n${answer}` };
    } finally {
      void removeFile(tempPath).catch(() => {});
    }
  },
};

const kimiEditPlanTool: Tool = {
  definition: {
    name: 'timeline_kimi_edit_plan',
    description: '让 Kimi 剪辑 Agent 基于参考视频档案和当前鲲鹏时间线生成 JSON 剪辑计划，并打开计划卡片面板。不会直接落轨，用户确认后再调用 timeline_apply_plan。',
    parameters: {
      type: 'object',
      properties: {
        reference_ids: { type: 'array', items: { type: 'string' }, description: 'timeline_analyze_reference_video 返回的 reference_id' },
        goal: { type: 'string', description: '本次剪辑目标，例如“复刻参考片的节奏，用当前素材剪一条 30 秒产品片”' },
        duration: { type: 'number', description: '目标成片时长，秒' },
        aspect: { type: 'string', description: '目标画幅，如 16:9 / 9:16 / 1:1' },
      },
      required: ['reference_ids', 'goal'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const ids = params.reference_ids as string[];
    const refs = findReferenceNotes(ids);
    if (!refs.length) return { success: false, output: '', error: '没有找到 reference_ids 对应的参考视频档案，请先 timeline_analyze_reference_video' };
    const state = useEditorStore.getState();
    if (state.clips.length === 0) return { success: false, output: '', error: '当前时间轴没有素材。请先 timeline_add_clips 加入可剪辑素材' };
    const { kimiEditPlan } = await import('@/lib/editor/kimiEditAgent');
    const result = await kimiEditPlan({
      references: refs,
      timelineState: state.getStateSummary(),
      goal: String(params.goal ?? ''),
      duration: params.duration as number | undefined,
      aspect: params.aspect as string | undefined,
    });
    if (!result.shots?.length) return { success: false, output: '', error: `Kimi 没有返回可执行 shots。返回内容：${result.notes ?? JSON.stringify(result)}` };
    const knownPaths = new Set(state.clips.map((c) => c.path));
    const shotsIn = result.shots.filter((shot) => knownPaths.has(shot.source_path));
    if (!shotsIn.length) {
      return { success: false, output: '', error: `Kimi 返回的镜头没有引用当前时间轴素材，请重试或先补充素材。返回路径：${result.shots.map((s) => s.source_path).join('，')}` };
    }
    const { nanoid } = await import('nanoid');
    const plan = {
      id: `plan-${nanoid(6)}`,
      title: result.title || 'Kimi 剪辑计划',
      createdAt: Date.now(),
      shots: shotsIn.map((x) => ({
        id: `ps-${nanoid(6)}`,
        label: x.label,
        sourcePath: x.source_path,
        inSec: Math.max(0, x.in_sec),
        outSec: Math.max(x.in_sec + 0.2, x.out_sec),
        reason: x.reason,
        status: 'pending' as const,
      })),
    };
    state.setPlan(plan);
    const total = plan.shots.reduce((sum, shot) => sum + (shot.outSec - shot.inSec), 0);
    const extras = [
      result.text_overlays?.length ? `文字建议 ${result.text_overlays.length} 条` : '',
      result.fx_suggestions?.length ? `特效建议 ${result.fx_suggestions.length} 条` : '',
      result.free_pages?.length ? `自由网页建议 ${result.free_pages.length} 条（用 timeline_add_free_page 执行）` : '',
      result.notes ? `备注：${result.notes}` : '',
    ].filter(Boolean).join('\n');
    return {
      success: true,
      output: `Kimi 计划「${plan.title}」已提交（${plan.shots.length} 镜 · 约 ${total.toFixed(1)}s），计划面板已打开。\n${plan.shots.map((s, i) => `${i + 1}. [${s.id}] ${s.label} ${s.inSec.toFixed(1)}-${s.outSec.toFixed(1)}s ← ${s.sourcePath.split('/').pop()}`).join('\n')}${extras ? `\n${extras}` : ''}`,
    };
  },
};

const kimiReviewTool: Tool = {
  definition: {
    name: 'timeline_kimi_review',
    description: 'Kimi 剪辑 Agent 对比参考视频档案和导出的成片，输出下一轮可执行修改建议。用于“参考片 + 成片 + 差异复盘”的闭环。',
    parameters: {
      type: 'object',
      properties: {
        reference_id: { type: 'string', description: '参考视频档案 ID' },
        output_video_path: { type: 'string', description: '导出成片的绝对路径' },
      },
      required: ['reference_id', 'output_video_path'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const referenceId = params.reference_id as string;
    const [reference] = findReferenceNotes([referenceId]);
    if (!reference) return { success: false, output: '', error: `没有找到参考视频档案 ${referenceId}` };
    const { kimiReview } = await import('@/lib/editor/kimiEditAgent');
    const output = await kimiReview({
      reference,
      outputVideoPath: params.output_video_path as string,
      timelineState: useEditorStore.getState().getStateSummary(),
    });
    return { success: true, output };
  },
};

function parseMgVideoEngine(value: unknown): MgVideoEngine {
  if (value === 'omni' || value === 'seedance-mini') return value;
  return 'minimax-h3';
}

function mgEngineLabel(engine: MgVideoEngine): string {
  return engine === 'minimax-h3' ? 'MiniMax H3' : engine === 'omni' ? 'Omni' : 'Seedance Mini';
}

function normalizeMgDuration(engine: MgVideoEngine, value: unknown): number {
  if (engine === 'omni') return 10;
  const fallback = 10;
  const raw = Number(value ?? fallback);
  const finite = Number.isFinite(raw) ? Math.round(raw) : fallback;
  return engine === 'minimax-h3'
    ? Math.min(15, Math.max(5, finite))
    : Math.min(15, Math.max(4, finite));
}

const omniMgPlanTool: Tool = {
  definition: {
    name: 'timeline_omni_mg_plan',
    description: '剪辑付费MG动画方案工具（不花钱，保留旧 Omni 工具名用于兼容）。第一轮只问网页特效还是付费MG；选择付费MG后，第二轮必须询问引擎、精选风格、视频生MG/文字生MG。引擎默认推荐 MiniMax H3，也可选 Omni 或 Seedance Mini。每条方案必须按 MG 专属规范组织：核心概念、主视觉、至少两组辅助元素、前中后景、元素触发关系和分阶段动作，禁止退化成电影画面描述或单一元素循环。右键选中片段时必须传 clip_id，只规划该片段。',
    parameters: {
      type: 'object',
      properties: {
        requirement: { type: 'string', description: '用户的 MG 动画需求/风格/文案' },
        source: { type: 'string', enum: ['text', 'timeline_transcript'], description: 'text=无主视频/仅文案；timeline_transcript=基于当前时间轴视频转写切分' },
        clip_id: { type: 'string', description: '选中片段的主视频 clip id（时间轴右键提示词中“主视频 main:xxx”的 xxx）。传入后只规划该片段覆盖的口播句子；留空则按整条主视频轨规划' },
        style_id: { type: 'string', description: 'Omni MG 精选风格 ID，可留空。可选风格见工具返回中的 styles_hint' },
        engine: { type: 'string', enum: ['minimax-h3', 'omni', 'seedance-mini'], description: '用户确认的生成引擎。默认 minimax-h3；必须在第二轮向用户展示 H3（推荐）、Omni、Seedance Mini 三个选项' },
        generation_mode: { type: 'string', enum: ['video_to_mg', 'text_to_mg'], description: 'video_to_mg=花字类型/视频生MG，传入原视频做包装；text_to_mg=纯MG动画/文字生，不传入视频' },
      },
      required: ['requirement', 'source'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const requirement = String(params.requirement ?? '').trim();
    const source = String(params.source ?? 'text');
    const clipId = String(params.clip_id ?? '').trim();
    const engine = parseMgVideoEngine(params.engine);
    const generationMode = params.generation_mode === 'text_to_mg' ? 'text_to_mg' : 'video_to_mg';
    const state = useEditorStore.getState();
    let plans;
    if (source === 'timeline_transcript' && state.clips.length > 0) {
      if (clipId && !state.clips.some((c) => c.id === clipId)) {
        return { success: false, output: '', error: `clip_id "${clipId}" 不在主视频轨上，请先用 timeline_get_state 核对选中片段 id` };
      }
      // 句级时间戳是源媒体时间，buildTranscriptTimelineRows 已按 clip 入点/速度映射到时间轴时间；
      // 选中片段时只取该片段覆盖的句子，避免从整个视频第一句开始规划。
      const transcriptSegments = buildTranscriptTimelineRows()
        .filter((row) => (!clipId || row.clipId === clipId) && !row.deleted && !row.silence)
        .map((row) => ({ start: row.timelineStart, end: row.timelineEnd, text: row.text }));
      plans = transcriptSegments.length > 0
        ? planOmniSegmentsFromTranscript(transcriptSegments, requirement)
        : planOmniSegmentsFromEditorText(requirement);
    } else {
      plans = planOmniSegmentsFromEditorText(requirement);
    }
    const creditsGuess = plans.length * 6.5;
    const yuanPer10 = Number(useSettingsStore.getState().omniCreditPricePer10 || 0);
    const yuan = yuanPer10 > 0 ? creditsGuess * yuanPer10 / 10 : null;
    return {
      success: true,
      output: [
        `付费 MG 方案（未生成，等待用户确认）：共 ${plans.length} 条视频。`,
        `生成引擎：${mgEngineLabel(engine)}${params.engine ? '' : '（默认推荐）'}。`,
        clipId ? `规划范围：仅选中片段（clip_id=${clipId}）。` : '规划范围：整条主视频轨（未传 clip_id）。',
        `生成类型：${generationMode === 'text_to_mg' ? '纯 MG 动画 / 文字生（不传入原视频）' : '花字类型 / 视频生 MG（传入原视频做包装）'}。`,
        engine === 'omni'
          ? (yuan ? `粗略预算：约 ${creditsGuess.toFixed(1)} 积分，约 ${yuan.toFixed(2)} 元（实际以 API 回传为准）。` : `粗略预算：约 ${creditsGuess.toFixed(1)} Omni 积分（未设置积分价格）。`)
          : `费用：由 ${mgEngineLabel(engine)} 渠道按实际任务结算，生成前仍需用户确认。`,
        ...plans.map((p, i) => `${i + 1}. ${p.label}: ${p.startSec.toFixed(1)}s 开始，${p.duration}s，提示：${p.prompt.slice(0, 120)}`),
        `styles_hint:\n${omniMgStylesDoc()}`,
        `用户确认后，优先一次调用 timeline_omni_mg_generate_batch，并传 engine="${engine}" 与 segments 并行生成。每条 segment 传 generation_mode="${generationMode}"。若是视频生 MG，会作为覆盖层放到原视频上方同时间点；若是纯 MG，会生成独立视频素材并落到视频轨2。最终提交前统一 MG 编译器会生成母版概念图和 2-4 张同风格关键帧，并把提示词编译为“核心概念 + 主辅元素 + 空间层级 + 分阶段动作 + 主体保护”，不会直接把普通电影提示词交给模型。`,
      ].join('\n'),
    };
  },
};

const omniMgGenerateTool: Tool = {
  definition: {
    name: 'timeline_omni_mg_generate',
    description: '剪辑付费MG动画单条生成工具（花钱，保留旧 Omni 工具名用于兼容）。仅在用户确认方案和引擎后调用；默认 MiniMax H3，也可选 Omni 或 Seedance Mini。提交前自动执行 MG 专属编译和母版/关键帧工作流，不能把普通电影提示词原样提交。完成后插入视频轨2。多个片段必须改用 batch。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '本段 MG 动画提示词' },
        start_sec: { type: 'number', description: '插入到时间轴的开始秒数' },
        duration: { type: 'number', description: 'Omni 片段时长。正常路线传 10；4/6 仅备用路由失败后使用' },
        label: { type: 'string', description: '生成片段标签' },
        style_id: { type: 'string', description: 'Omni MG 精选风格 ID，可留空' },
        engine: { type: 'string', enum: ['minimax-h3', 'omni', 'seedance-mini'], description: '用户已确认的引擎；默认 minimax-h3' },
        generation_mode: { type: 'string', enum: ['video_to_mg', 'text_to_mg'], description: 'video_to_mg=传入原视频做花字/图形包装；text_to_mg=不传原视频，纯文字生 MG' },
      },
      required: ['prompt', 'start_sec', 'duration'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const engine = parseMgVideoEngine(params.engine);
    const duration = normalizeMgDuration(engine, params.duration);
    const result = await runMgForEditorSegment({
      label: String(params.label || `${mgEngineLabel(engine)} MG 动画`),
      startSec: Number(params.start_sec ?? 0),
      duration,
      prompt: String(params.prompt ?? ''),
      generationMode: params.generation_mode === 'text_to_mg' ? 'text_to_mg' : 'video_to_mg',
    }, params.style_id as string | undefined, engine);
    if (!result.success) {
      const error = result.error || '付费 MG 生成失败';
      return {
        success: false,
        output: '',
        error,
        ...(result.preventFallback ? { terminal: true, terminalMessage: error } : {}),
      };
    }
    await flushTimelineMutation();
    const mode = params.generation_mode === 'text_to_mg' ? '纯 MG / 文字生' : '视频生 MG / 覆盖包装';
    return {
      success: true,
      output: `${result.engineUsed || mgEngineLabel(engine)} MG 动画已生成并插入视频轨2（${mode}）：${result.resultPaths[0]}${result.creditsCost ? `\n消耗积分：${result.creditsCost}` : ''}${result.error ? `\n路由说明：${result.error}` : ''}`,
    };
  },
};

const omniMgGenerateBatchTool: Tool = {
  definition: {
    name: 'timeline_omni_mg_generate_batch',
    description: '剪辑付费MG批量并行生成工具（花钱，保留旧 Omni 工具名用于兼容）。默认 MiniMax H3，也可选 Omni 或 Seedance Mini；每条任务都先经过统一 MG 专属编译、母版概念图和关键帧工作流。用户确认多个片段后必须优先用本工具。',
    parameters: {
      type: 'object',
      properties: {
        style_id: { type: 'string', description: '默认 Omni MG 精选风格 ID；segment 内可覆盖' },
        engine: { type: 'string', enum: ['minimax-h3', 'omni', 'seedance-mini'], description: '默认引擎；省略时为 minimax-h3，segment 内可覆盖' },
        generation_mode: { type: 'string', enum: ['video_to_mg', 'text_to_mg'], description: '默认生成类型；segment 内可覆盖' },
        segments: {
          type: 'array',
          description: '要并行生成的 MG 片段',
          items: {
            type: 'object',
            properties: {
              prompt: { type: 'string', description: '本段 MG 动画提示词' },
              start_sec: { type: 'number', description: '插入到时间轴的开始秒数' },
              duration: { type: 'number', description: 'Omni 片段时长。正常路线固定 10' },
              label: { type: 'string', description: '生成片段标签' },
              style_id: { type: 'string', description: '本段风格 ID，可留空继承顶层 style_id' },
              engine: { type: 'string', enum: ['minimax-h3', 'omni', 'seedance-mini'], description: '本段引擎，可留空继承顶层 engine' },
              generation_mode: { type: 'string', enum: ['video_to_mg', 'text_to_mg'], description: '本段生成类型，可留空继承顶层 generation_mode' },
            },
            required: ['prompt', 'start_sec', 'duration'],
          },
        },
      },
      required: ['segments'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const segments = Array.isArray(params.segments) ? params.segments : [];
    if (segments.length === 0) {
      return { success: false, output: '', error: 'segments 不能为空' };
    }
    const defaultMode = params.generation_mode === 'text_to_mg' ? 'text_to_mg' : 'video_to_mg';
    const defaultStyleId = params.style_id as string | undefined;
    const defaultEngine = parseMgVideoEngine(params.engine);
    const started = Date.now();
    const jobs = segments.map((seg, index) => {
      const engine = seg.engine ? parseMgVideoEngine(seg.engine) : defaultEngine;
      const duration = normalizeMgDuration(engine, seg.duration);
      return runMgForEditorSegment({
        label: String(seg.label || `${mgEngineLabel(engine)} MG ${index + 1}`),
        startSec: Number(seg.start_sec ?? 0),
        duration,
        prompt: String(seg.prompt ?? ''),
        generationMode: seg.generation_mode === 'text_to_mg' ? 'text_to_mg' : defaultMode,
      }, (seg.style_id as string | undefined) || defaultStyleId, engine)
        .then((result) => ({ index, seg, engine, result }))
        .catch((err) => ({
          index,
          seg,
          engine,
          result: {
            success: false,
            resultUrls: [],
            resultPaths: [],
            error: err instanceof Error ? err.message : String(err),
          } as Awaited<ReturnType<typeof runMgForEditorSegment>>,
        }));
    });
    const settled = await Promise.all(jobs);
    await flushTimelineMutation();
    const ok = settled.filter((item) => item.result.success);
    const failed = settled.filter((item) => !item.result.success);
    const credits = ok.reduce((sum, item) => sum + Number(item.result.creditsCost || 0), 0);
    const hasTerminalFailure = failed.some((item) => item.result.preventFallback === true);
    const error = failed.length > 0 ? `${failed.length} 条生成失败` : undefined;
    return {
      success: failed.length === 0,
      ...(hasTerminalFailure && error ? { terminal: true, terminalMessage: error } : {}),
      output: [
        `付费 MG 并行生成完成：成功 ${ok.length}/${segments.length}，默认引擎 ${mgEngineLabel(defaultEngine)}，耗时 ${((Date.now() - started) / 1000).toFixed(1)}s。`,
        credits > 0 ? `消耗积分合计：${credits}` : '',
        ...ok.map((item) => `${item.index + 1}. ${item.result.engineUsed || mgEngineLabel(item.engine)} 已插入视频轨2：${item.result.resultPaths[0]}`),
        ...failed.map((item) => `${item.index + 1}. 失败：${item.result.error || '未知错误'}`),
      ].filter(Boolean).join('\n'),
      error,
    };
  },
};

const mgTextFallbackTool: Tool = {
  definition: {
    name: 'timeline_mg_text_fallback',
    description: 'MG文字二次兜底生成工具（花钱）：当用户对已生成的 MG/视频不满意，或明确说“文字还是错/有错字/乱码/字幕不对/字不对”等返工关键词时使用。流程固定为先用 GPT-Image-2 生成文字定版图，再用筷子丽帧 Seedance 2.0 Mini 图生视频，完成后插入视频轨2覆盖对应时间段。不要继续调用 Omni。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '需要锁定文字的最终文案/画面要求。必须包含用户想要准确出现的文字。' },
        start_sec: { type: 'number', description: '插入到时间轴的开始秒数' },
        duration: { type: 'number', description: '片段时长，只能 4/6/10，其他值会就近按 6 秒处理' },
        label: { type: 'string', description: '生成片段标签' },
        style_name: { type: 'string', description: '视觉风格描述，可传上一次 Omni/MG 风格名或用户要求' },
      },
      required: ['prompt', 'start_sec', 'duration'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const durationRaw = Number(params.duration ?? 6);
    const duration = (durationRaw === 4 || durationRaw === 10 ? durationRaw : 6) as 4 | 6 | 10;
    const result = await runMgTextFallbackForEditorSegment({
      label: String(params.label || 'MG文字兜底'),
      startSec: Number(params.start_sec ?? 0),
      duration,
      prompt: String(params.prompt ?? ''),
      generationMode: 'text_to_mg',
    }, params.style_name as string | undefined);
    if (!result.success) {
      const error = result.error || 'MG文字兜底生成失败';
      return {
        success: false,
        output: '',
        error,
        ...(result.preventFallback ? { terminal: true, terminalMessage: error } : {}),
      };
    }
    await flushTimelineMutation();
    return {
      success: true,
      output: [
        'MG文字兜底已完成并插入视频轨2。',
        `视频: ${result.resultPaths[0]}`,
        result.textPlatePath ? `文字定版图: ${result.textPlatePath}` : '',
      ].filter(Boolean).join('\n'),
    };
  },
};

const rawTimelineTools: Tool[] = [
  getStateTool, getFxDetailTool, renderFrameTool, motionGuideTool, seekPlayheadTool, addClipTool, addClipsTool, reorderTool, trimTool, splitTool, splitAtPlayheadTool, transitionTool, bgmTool,
  addAudioTool, transcribeTool, transcribeSegmentTool, subtitleEditTool, setAspectTool, setExportTool, removeClipTool,
  exportAnalyzeTool, renderGraphTool, exportPrepareTool, exportVideoTool, exportStatusTool, exportStopTool,
  exportRetryTool, renderCacheStatusTool, renderDebugTailTool, renderCacheClearTool, proxyPrepareTool, exportTool,
  addTextTool, addFxTool, addSceneTool, updateSceneTool, speechKeywordFxTool, addFreePageTool, uploadAssetsToCosTool, updateTextTool, updateFxTool, addOverlayTool, clipStyleTool, smartCutTool, detectRedundancyTool, previewClipTool, templateTool, markersTool, removeItemTool, removeFxTool, rippleDeleteTool, trackStateTool,
  transcriptTool, transcriptReadTool, speechAuditTool, speechFindingsTool, speechApplyTool,
  omniMgPlanTool, omniMgGenerateTool, omniMgGenerateBatchTool, mgTextFallbackTool,
  proposePlanTool, updatePlanShotTool, applyPlanTool, analyzeMediaTool,
  analyzeReferenceVideoTool, inspectVideoSegmentTool, kimiEditPlanTool, kimiReviewTool,
];

const HYDRATION_INDEPENDENT_TOOLS = new Set([
  'timeline_get_state',
  'timeline_motion_guide',
  'timeline_export_status',
  'timeline_render_debug_tail',
]);

/**
 * 所有依赖时间轴内存态的工具都共享同一道水合闸门。这样即使 Agent 跳过
 * get_state 直接 add/update/remove，也不会把项目加载前的假空 store 写回磁盘。
 */
export const allTimelineTools: Tool[] = rawTimelineTools.map((tool) => {
  if (HYDRATION_INDEPENDENT_TOOLS.has(tool.definition.name)) return tool;
  const execute = tool.execute.bind(tool);
  return {
    ...tool,
    async execute(params, signal) {
      const notReady = timelineNotReadyResult();
      if (notReady) return notReady;
      return execute(params, signal);
    },
  };
});
