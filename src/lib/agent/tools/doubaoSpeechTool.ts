import { createDir, readBinaryFile, writeBinaryFile } from '@tauri-apps/api/fs';
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { nanoid } from 'nanoid';
import type { Tool } from '../types';
import { fetchSpeechAudioBytes, generateSpeech, type DoubaoSpeechReference } from '@/lib/doubaoSpeech/client';
import { useCanvasStore } from '@/stores/canvasStore';
import { defaultNodeStyle } from '@/lib/canvas/layout';

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function safeFilePart(text: string): string {
  return text
    .slice(0, 18)
    .replace(/[^\w\u4e00-\u9fa5-]+/g, '_')
    .replace(/^_+|_+$/g, '') || 'doubao-voice';
}

async function buildReference(params: Record<string, unknown>): Promise<DoubaoSpeechReference[]> {
  const referenceAudioPath = String(params.reference_audio_path || '').trim();
  const referenceAudioUrl = String(params.reference_audio_url || '').trim();
  const speaker = String(params.speaker || '').trim();
  if (referenceAudioPath) {
    const raw = await readBinaryFile(referenceAudioPath);
    return [{ audio_data: bytesToBase64(new Uint8Array(raw)) }];
  }
  if (referenceAudioUrl) return [{ audio_url: referenceAudioUrl }];
  if (speaker) return [{ speaker }];
  return [];
}

export const doubaoSpeechGenerateTool: Tool = {
  definition: {
    name: 'doubao_speech_generate',
    description: `生成台词配音（Doubao Seed-Audio-1.0，花钱）。普通主对话、画布、工坊都可用。
- 默认走筷子丽帧通道；提交结果不确定时最多自动重提 1 次，仍失败再按配置回退豆包官方。音频 URL 下载重试不会重新提交生成任务。
- 输入 text_prompt 即要说的台词或自然语言配音提示，例如：（低声、克制、带一点疲惫）"我终于明白了。"
- 可选 reference_audio_path/reference_audio_url 作为参考音色；也可传 speaker 音色 ID。三者只选一种。
- 默认保存到当前 workspace/audio，并在画布创建一个可播放、可下载的音频节点。
- 如果用户把现有音频节点交给 Agent，传 target_node_id 可直接更新该节点，不会另建副本。
- 如果用户只是要生成配音，不要再用 canvas_add_node 建文本节点，直接调用本工具。`,
    parameters: {
      type: 'object',
      properties: {
        text_prompt: { type: 'string', description: '要生成的台词或配音提示词，最长 2048 字' },
        reference_audio_path: { type: 'string', description: '可选，本地参考音色路径，最长 30 秒、10MB 内' },
        reference_audio_url: { type: 'string', description: '可选，公网参考音色 URL' },
        speaker: { type: 'string', description: '可选，豆包音色 ID。与参考音频二选一' },
        format: { type: 'string', enum: ['mp3', 'wav', 'ogg_opus', 'pcm'], description: '输出格式，默认 mp3' },
        speech_rate: { type: 'number', description: '语速，-50 到 100，默认 0' },
        loudness_rate: { type: 'number', description: '音量，-50 到 100，默认 0' },
        pitch_rate: { type: 'number', description: '音调，-12 到 12，默认 0' },
        create_canvas_node: { type: 'boolean', description: '是否在画布创建音频节点，默认 true' },
        target_node_id: { type: 'string', description: '可选，直接更新已有 audio 节点；提供后不会新建节点' },
      },
      required: ['text_prompt'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const textPrompt = String(params.text_prompt || '').trim();
    if (!textPrompt) return { success: false, output: '', error: 'text_prompt 不能为空' };

    const targetNodeId = String(params.target_node_id || '').trim();
    if (targetNodeId) {
      const target = useCanvasStore.getState().nodes.find((node) => node.id === targetNodeId);
      if (!target) return { success: false, output: '', error: `画布音频节点不存在：${targetNodeId}` };
      if (target.type !== 'audio') return { success: false, output: '', error: `节点 ${targetNodeId} 不是音频节点` };
    }
    const format = (String(params.format || 'mp3') as 'mp3' | 'wav' | 'ogg_opus' | 'pcm');
    const references = await buildReference(params);
    const resp = await generateSpeech({
      text_prompt: textPrompt,
      references,
      audio_config: {
        format,
        sample_rate: 24000,
        speech_rate: params.speech_rate == null ? undefined : Number(params.speech_rate),
        loudness_rate: params.loudness_rate == null ? undefined : Number(params.loudness_rate),
        pitch_rate: params.pitch_rate == null ? undefined : Number(params.pitch_rate),
      },
    });
    const bytes = await fetchSpeechAudioBytes(resp);
    const workspace = await invoke<string>('ensure_workspace');
    const dir = `${workspace}/audio`;
    await createDir(dir, { recursive: true }).catch(() => {});
    const ext = format === 'ogg_opus' ? 'ogg' : format;
    const outputPath = `${dir}/${safeFilePart(textPrompt)}_${Date.now()}.${ext}`;
    await writeBinaryFile(outputPath, bytes);
    // 产物库记账（带 prompt/engine 元数据；不记的话只有扫描器兜底的裸文件）
    void import('@/lib/artifacts').then(({ appendArtifact }) =>
      appendArtifact({ path: outputPath, type: 'audio', engine: 'doubao-seed-audio', prompt: textPrompt }),
    ).catch(() => {});

    const shouldCreateNode = !targetNodeId && params.create_canvas_node !== false;
    let nodeId = '';
    if (targetNodeId) {
      const store = useCanvasStore.getState();
      store.updateNode(targetNodeId, {
        description: textPrompt,
        audioUrl: convertFileSrc(outputPath),
        localPath: outputPath,
        fileName: outputPath.split('/').pop(),
      });
      store.setSelectedNodeId(targetNodeId);
      nodeId = targetNodeId;
    } else if (shouldCreateNode) {
      nodeId = `node-${nanoid(8)}`;
      const store = useCanvasStore.getState();
      const maxX = store.nodes.length ? Math.max(...store.nodes.map((n) => n.position.x + (n.width || 280))) : 20;
      const avgY = store.nodes.length ? store.nodes.reduce((sum, n) => sum + n.position.y, 0) / store.nodes.length : 180;
      store.addNode({
        id: nodeId,
        type: 'audio',
        position: { x: maxX + 80, y: avgY },
        style: defaultNodeStyle('audio'),
        data: {
          description: textPrompt,
          audioUrl: convertFileSrc(outputPath),
          localPath: outputPath,
          fileName: outputPath.split('/').pop(),
        },
      });
      store.setSelectedNodeId(nodeId);
    }

    const lines = [
      `配音生成完成：${outputPath}`,
      `时长：${Number(resp.duration || resp.original_duration || 0).toFixed(1)}s`,
      targetNodeId ? `已更新画布音频节点：${nodeId}` : shouldCreateNode ? `已创建画布音频节点：${nodeId}` : '',
    ].filter(Boolean);
    return { success: true, output: lines.join('\n') };
  },
};
