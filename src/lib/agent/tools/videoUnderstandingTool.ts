import { buildVideoAnalysisQuestion } from '../../videoAnalysis/recreation';
/**
 * video_understanding — 原生视频理解。
 *
 * 背景：用户在对话框拖入视频时，Kimi 路由会把视频作为原生内容块直传模型；
 * 但 agent 在任务中途想再次观看该视频（或分析任何本地视频）时，此前只能走
 * 抽帧/转写等外部工具，拿不到模型的原生视听理解。本工具补齐这一跳：
 *
 * - 主路由是 Kimi（context.nativeVideo）时，视频作为原生内容块随工具结果
 *   回灌本轮对话，由当前模型自己看画面、听声音并回答（与 image_recognition
 *   的 nativeVision 回灌同一机制）。
 * - 其他路由（GLM / DeepSeek Harness / 公网 URL 场景）且已配置 Kimi Key 时，
 *   直接调 Kimi K3 原生分析后返回结论文本。
 * - 超过 Kimi 单文件上限（100MB）时明确报错并指向本地索引工具链，
 *   不静默假装看过。
 */

import { invoke } from '@tauri-apps/api/tauri';
import type { AgentMediaSource, Tool } from '../types';
import { loadMediaInput, normalizeLocalMediaPath } from '../mediaInput';
import { KIMI_FILE_VIDEO_MAX_BYTES, KIMI_INLINE_VIDEO_MAX_BYTES, uploadVideoToKimi } from '../kimiFiles';
import { isKimiK3Configured, kimiK3Chat } from '../kimiClient';

const DEFAULT_PROMPT = '详细描述这段视频的内容：画面、人物动作、声音/口播、镜头运动与剪辑节奏。';

const LOCAL_ANALYSIS_GUIDANCE =
  '请改用 timeline_analyze_reference_video 建立本地索引（转写+镜头+关键帧），再用 timeline_inspect_video_segment 精看片段；不要声称已经直接观看原片。';

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export type VideoSourcePlan = 'inline' | 'upload' | 'too-large';

/** Size-tier decision for local files, shared by both execution paths. */
export function planLocalVideoSource(size: number): VideoSourcePlan {
  if (size > KIMI_FILE_VIDEO_MAX_BYTES) return 'too-large';
  return size > KIMI_INLINE_VIDEO_MAX_BYTES ? 'upload' : 'inline';
}

function base64FromDataUri(uri: string): AgentMediaSource | null {
  const comma = uri.indexOf(',');
  const semi = uri.indexOf(';');
  if (comma < 0 || semi < 0) return null;
  return { type: 'base64', media_type: uri.slice(5, semi), data: uri.slice(comma + 1) };
}

export const videoUnderstandingTool: Tool = {
  definition: {
    name: 'video_understanding',
    description:
      '原生视频理解：把视频交给模型直接观看（画面+声音）并回答问题。' +
      '用于：再次查看用户之前发过的视频、主动分析本地视频文件、以视频问答。' +
      'video 支持本地路径、ms:// 文件句柄或公网 URL；≤100MB 可直接分析。' +
      '更大的视频请改用 timeline_analyze_reference_video 建立索引后分段精看。',
    parameters: {
      type: 'object',
      properties: {
        video: { type: 'string', description: '视频的本地文件路径、ms:// 文件句柄或公网 URL' },
        prompt: { type: 'string', description: `针对视频的问题/指令，默认"${DEFAULT_PROMPT}"` },
      },
      required: ['video'],
    },
  },
  risk: 'safe',
  async execute(params, signal, context) {
    const video = String(params.video ?? '').trim();
    if (!video) return { success: false, output: '', error: 'video required' };
    const question = buildVideoAnalysisQuestion(String(params.prompt ?? '').trim() || DEFAULT_PROMPT);
    const progress = (message: string) => {
      void import('@/stores/runStepStore')
        .then(({ useRunStepStore }) => useRunStepStore.getState().appendStepNote(message, 'video_understanding'))
        .catch(() => {});
    };

    const isMs = /^ms:\/\//i.test(video);
    const isData = /^data:video\//i.test(video);
    const isRemote = /^https?:\/\//i.test(video);

    // Kimi 主路由：视频作为原生内容块回灌，由当前模型自己看。
    // 公网 URL 除外——Kimi Code 会话不接受任意外链视频块（glmClient 会降级
    // 为文字说明），这种场景走下方 K3 直连。
    if (context?.nativeVideo && !isRemote) {
      let source: AgentMediaSource | null = null;
      if (isMs) {
        source = { type: 'url', url: video };
      } else if (isData) {
        source = base64FromDataUri(video);
      } else {
        const localPath = normalizeLocalMediaPath(video);
        const fileName = localPath.split(/[\\/]/).pop() || 'video.mp4';
        let size = 0;
        try {
          size = await invoke<number>('get_file_size', { path: localPath });
        } catch {
          return { success: false, output: '', error: `读取视频失败：${localPath} 不存在或不可读` };
        }
        const plan = planLocalVideoSource(size);
        if (plan === 'too-large') {
          return {
            success: false,
            output: '',
            error: `视频“${fileName}”大小为 ${formatMegabytes(size)}，超过 Kimi 单文件 100 MB 上限。${LOCAL_ANALYSIS_GUIDANCE}`,
          };
        }
        if (plan === 'upload') {
          progress(`正在上传“${fileName}”到 Kimi 文件服务（${formatMegabytes(size)}）`);
          const uploaded = await uploadVideoToKimi(localPath, (p) => progress(`正在上传“${fileName}”到 Kimi：${p.percent}%`));
          if (signal?.aborted) return { success: false, output: '', error: '已停止视频上传' };
          source = { type: 'url', url: uploaded.url };
        } else {
          const { dataUrl } = await loadMediaInput(localPath);
          source = dataUrl.startsWith('data:') ? base64FromDataUri(dataUrl) : { type: 'url', url: dataUrl };
        }
      }
      if (!source) return { success: false, output: '', error: '视频源解析失败' };
      return {
        success: true,
        output: `视频已作为原生内容块传入，请直接用你的原生视频理解（画面与声音）回答：${question}`,
        media: [{ type: 'video', source }],
      };
    }

    // 非 Kimi 主路由或公网 URL：直接用 Kimi K3 原生分析，返回结论文本。
    if (!isKimiK3Configured()) {
      return {
        success: false,
        output: '',
        error: `当前路由不支持原生视频且未配置 Kimi API Key，无法直接观看视频。${LOCAL_ANALYSIS_GUIDANCE}`,
      };
    }
    let url = video;
    if (!isMs && !isRemote && !isData) {
      const localPath = normalizeLocalMediaPath(video);
      const fileName = localPath.split(/[\\/]/).pop() || 'video.mp4';
      let size = 0;
      try {
        size = await invoke<number>('get_file_size', { path: localPath });
      } catch {
        return { success: false, output: '', error: `读取视频失败：${localPath} 不存在或不可读` };
      }
      if (planLocalVideoSource(size) === 'too-large') {
        return {
          success: false,
          output: '',
          error: `视频“${fileName}”大小为 ${formatMegabytes(size)}，超过 Kimi 单文件 100 MB 上限。${LOCAL_ANALYSIS_GUIDANCE}`,
        };
      }
      progress(`正在上传“${fileName}”到 Kimi 文件服务（${formatMegabytes(size)}）`);
      const uploaded = await uploadVideoToKimi(localPath, (p) => progress(`正在上传“${fileName}”到 Kimi：${p.percent}%`));
      if (signal?.aborted) return { success: false, output: '', error: '已停止视频上传' };
      url = uploaded.url;
    }
    try {
      progress('正在用 Kimi K3 原生分析视频');
      const answer = await kimiK3Chat([
        {
          role: 'system',
          content: '你是专业视频分析师。只根据视频画面与声音回答，明确区分可见事实与推断。',
        },
        {
          role: 'user',
          content: [
            { type: 'video_url', video_url: { url } },
            { type: 'text', text: question },
          ],
        },
      ], { timeout: 600, signal });
      return { success: true, output: `${answer}\n\n（视频分析：Kimi K3 原生理解）` };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return { success: false, output: '', error: `视频分析失败：${msg}` };
    }
  },
};
