import type { AgentUserContentBlock } from '../types.ts';
import type { AcpContent } from './types.ts';

/**
 * Convert a Kunpeng user media block into an ACP prompt content block.
 *
 * The upstream dsh-acp bridge accepts only `text` and `resource_link` prompt
 * content — an `image` block is rejected with invalidParams
 * ("only text and resource_link prompt content is supported") BEFORE any
 * model call, which used to kill the whole Harness turn. Base64 media is
 * therefore dropped here and vision routes through tools (image_recognition)
 * for Harness turns. 带图轮次现在在上游（useAgent）直接改道内置通道的
 * DeepSeek 原生视觉（deepseek-v4-flash-vision-exp 起官方端点支持原生图片
 * 输入），本文件只服务留在 Harness 的非图片轮次。
 */
export function mediaToAcpContent(block: AgentUserContentBlock): AcpContent | null {
  if (block.type === 'text') return { type: 'text', text: block.text };
  const source = block.source;
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
