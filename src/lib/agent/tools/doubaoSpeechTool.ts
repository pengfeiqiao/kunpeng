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

function stringList(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item).trim()).filter(Boolean) : [];
}

async function buildReferences(params: Record<string, unknown>): Promise<DoubaoSpeechReference[]> {
  const paths = [...new Set([String(params.reference_audio_path || '').trim(), ...stringList(params.reference_audio_paths)].filter(Boolean))];
  const urls = [...new Set([String(params.reference_audio_url || '').trim(), ...stringList(params.reference_audio_urls)].filter(Boolean))];
  const speaker = String(params.speaker || '').trim();
  if (speaker && (paths.length > 0 || urls.length > 0)) {
    throw new Error('speaker 音色 ID 与参考音频不能同时传入');
  }
  if (paths.length + urls.length > 10) {
    throw new Error(`参考音频最多 10 条（当前 ${paths.length + urls.length} 条）`);
  }
  const references: DoubaoSpeechReference[] = [];
  for (const path of paths) {
    const raw = await readBinaryFile(path);
    references.push({ audio_data: bytesToBase64(new Uint8Array(raw)) });
  }
  for (const url of urls) references.push({ audio_url: url });
  if (references.length > 0) return references;
  if (speaker) return [{ speaker }];
  return [];
}

export const doubaoSpeechGenerateTool: Tool = {
  definition: {
    name: 'doubao_speech_generate',
    description: `执行豆包配音 / Doubao Seed-Audio 语音合成（花钱）。用户说“用豆包配音”“Seed-Audio”“生成旁白”“朗读这段”时直接调用本工具。普通主对话、画布、工坊都可用。
- 自动通道：配置为筷子优先且已提供参考音频时，调用筷子 Seed-Audio；无参考音频或传 speaker 时直接调用豆包官方，不会先发一次必然失败的筷子请求。
- 筷子 Seed-Audio 强制要求 1-10 条参考音频，仅接受公网 HTTP(S) URL；本地路径会由工具上传为公网 URL。多人配音在 text_prompt 中按参考顺序写“参考录音1：……\n参考录音2：……”。
- 如果未配置豆包官方 Key 且用户未提供参考音频，先请用户上传一条参考音频，禁止编造 URL。
- 输入 text_prompt 即要说的台词或自然语言配音提示，例如：（低声、克制、带一点疲惫）"我终于明白了。"
- 可传单条 reference_audio_path/reference_audio_url，或传数组 reference_audio_paths/reference_audio_urls；本地路径、公网 URL 可合计 1-10 条。speaker 是豆包官方音色 ID，不能与参考音频同时传入。
- 默认保存到当前 workspace/audio。普通对话传 create_canvas_node=false；用户明确要放到画布时才传 true。
- 如果用户把现有音频节点交给 Agent，传 target_node_id 可直接更新该节点，不会另建副本。
- 如果用户只是要生成配音，不要再用 canvas_add_node 建文本节点，直接调用本工具。`,
    parameters: {
      type: 'object',
      properties: {
        text_prompt: { type: 'string', description: '要生成的台词或配音提示词；筷子通道加上“参考录音N：”后最长 4096 字' },
        reference_audio_path: { type: 'string', description: '单条本地参考音频绝对路径' },
        reference_audio_url: { type: 'string', description: '单条公开可访问的 HTTP(S) 参考音频 URL' },
        reference_audio_paths: { type: 'array', items: { type: 'string' }, description: '多条本地参考音频绝对路径，与 URL 合计最多 10 条' },
        reference_audio_urls: { type: 'array', items: { type: 'string' }, description: '多条公开可访问的 HTTP(S) 参考音频 URL，与本地路径合计最多 10 条' },
        speaker: { type: 'string', description: '可选，豆包音色 ID。与参考音频二选一' },
        format: { type: 'string', enum: ['mp3', 'wav', 'ogg_opus', 'pcm'], description: '输出格式，默认 mp3' },
        speech_rate: { type: 'number', description: '语速，-50 到 100，默认 0' },
        loudness_rate: { type: 'number', description: '音量，-50 到 100，默认 0' },
        pitch_rate: { type: 'number', description: '音调，-12 到 12，默认 0' },
        create_canvas_node: { type: 'boolean', description: '是否在画布创建音频节点；普通对话传 false，只有用户明确要放入画布时传 true' },
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
    const references = await buildReferences(params);
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

    const shouldCreateNode = !targetNodeId && params.create_canvas_node === true;
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
      `实际模型：${resp.model || 'Seed-Audio'}`,
      `实际通道：${resp.provider === 'kuaizi' ? '筷子丽帧 Seed-Audio API' : '豆包官方 Seed-Audio API'}`,
      `时长：${Number(resp.duration || resp.original_duration || 0).toFixed(1)}s`,
      targetNodeId ? `已更新画布音频节点：${nodeId}` : shouldCreateNode ? `已创建画布音频节点：${nodeId}` : '',
    ].filter(Boolean);
    return { success: true, output: lines.join('\n') };
  },
};
