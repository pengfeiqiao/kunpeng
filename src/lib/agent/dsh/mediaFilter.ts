import type { AgentUserContentBlock } from '../types.ts';
import type { AcpContent } from './types.ts';

/**
 * Convert a Kunpeng user media block into an ACP prompt content block.
 *
 * Kunpeng 的 fork 桥（dsh-runtime/kunpeng-acp.mjs）接受 image 块并经
 * attachment store 持久化，供声明了 input:[text,image] 的 pi-ai 视觉模型
 * 路由原生看图。base64 图片 → ACP image 块；公网 URL 媒体仍转
 * resource_link（运行时不解引用，仅作文本引用）；视频保持
 * resource_link（视觉模型只收图片，视频走分析/转写工具）。
 */
export function mediaToAcpContent(block: AgentUserContentBlock): AcpContent | null {
  if (block.type === 'text') return { type: 'text', text: block.text };
  const source = block.source;
  if (block.type === 'image' && source.type === 'base64') {
    return { type: 'image', data: source.data, mimeType: source.media_type || 'image/png' };
  }
  if (source.type === 'base64') return null;
  return {
    type: 'resource_link',
    uri: source.url,
    name: source.url.split('/').pop() || `${block.type}-attachment`,
  };
}

/** Map Kunpeng media blocks to ACP-legal prompt content, dropping nothing silently. */
export function buildAcpPromptContent(
  blocks: AgentUserContentBlock[] | undefined,
  onDropped?: (block: AgentUserContentBlock) => void,
): AcpContent[] {
  const out: AcpContent[] = [];
  for (const block of blocks ?? []) {
    const converted = mediaToAcpContent(block);
    if (converted) out.push(converted);
    else if (block.type !== 'text') onDropped?.(block);
  }
  return out;
}
