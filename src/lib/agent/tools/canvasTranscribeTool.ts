/**
 * canvas_transcribe — 画布视图下的语音转写工具。
 *
 * 承载豆包录音文件识别（AUC）+ Whisper 降级链路（见 @/lib/editor/transcribe）。
 * 之所以单独建一个 canvas_* 工具而非复用 timeline_transcript：timeline_* 工具
 * 被 toolGating 限制为仅 editor 视图可见，画布 agent 看不到；canvas_* 前缀
 * 不被门控，画布/对话/剪辑所有视图都可见。
 *
 * 输入：画布上的视频/音频节点（node_id），或任意本地媒体路径（path）。
 * 输出：带毫秒级时间戳的分句转写文本，供 agent 做流畅剪辑/口癖删减/对照脚本。
 */
import type { Tool } from '../types';
import { useCanvasStore } from '@/stores/canvasStore';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import { doubaoAsrAvailable } from '@/lib/doubaoAsr/client';

/** 从画布节点解析出本地媒体文件路径 */
function resolveNodeMediaPath(nodeId: string): string | null {
  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  if (!node) return null;
  const data = (node.data ?? {}) as Record<string, unknown>;
  // 视频节点：localPath 优先，否则从 generatedVideoUrl 反解 asset://
  const raw = (data.localPath as string) || (data.generatedVideoUrl as string) || (data.audioUrl as string);
  if (!raw) return null;
  return assetUrlToLocalPath(raw);
}

export const canvasTranscribeTool: Tool = {
  definition: {
    name: 'canvas_transcribe',
    description: `语音转写（ASR，花钱）：把视频/音频里的人声转成带时间戳的分句文本。
- 优先用豆包录音文件识别（上限 512MB，长素材免分段，毫秒级时间戳）；未配置豆包 key/COS 时自动降级 Whisper（25MB 以上自动分段）。
- 输入：node_id（画布上的视频/音频节点）或 path（本地媒体文件路径，如 ~/Downloads/xxx.mp4）。两者都给以 path 为准。
- 输出：每句一行 [开始秒-结束秒] 文本，按时间排序。可用于：删口误/重复/跑题做流畅剪辑、对照脚本挑段落、生成字幕。
- 15 分钟以内的口播素材通常一次转写完成（豆包链路）；超长素材也无需手动分段。`,
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: '画布上要转写的视频/音频节点 id（与 path 二选一）' },
        path: { type: 'string', description: '本地媒体文件路径（与 node_id 二选一，优先级高于 node_id）' },
      },
      required: [],
    },
  },
  risk: 'ask',
  async execute(params) {
    let mediaPath = (params.path as string | undefined)?.trim() || '';
    if (!mediaPath && params.node_id) {
      mediaPath = resolveNodeMediaPath(params.node_id as string) || '';
    }
    if (!mediaPath) {
      return {
        success: false,
        output: '',
        error: '未找到可转写的媒体：请提供 path（本地文件路径）或 node_id（画布视频/音频节点）',
      };
    }

    const cap = doubaoAsrAvailable();
    const engine = cap.available ? '豆包 AUC' : 'Whisper（豆包未配置或 COS 未配置，已降级）';

    const { transcribeFile } = await import('@/lib/editor/transcribe');
    try {
      const cues = await transcribeFile(mediaPath);
      if (cues.length === 0) {
        return { success: true, output: `转写完成（${engine}）：未识别到人声（静音或无音轨）` };
      }
      const lines = cues.map((c) => `[${c.startSec.toFixed(2)}-${c.endSec.toFixed(2)}] ${c.text}`);
      const totalDur = cues[cues.length - 1].endSec;
      return {
        success: true,
        output: `转写完成（${engine}）：共 ${cues.length} 句，时长 ${totalDur.toFixed(1)}s\n\n${lines.join('\n')}`,
      };
    } catch (err) {
      return {
        success: false,
        output: '',
        error: `转写失败（${engine}）：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};
