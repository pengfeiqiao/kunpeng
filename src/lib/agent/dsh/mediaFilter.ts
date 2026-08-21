import type { AgentUserContentBlock } from '../types.ts';
import type { AcpContent } from './types.ts';

/**
 * Convert a Kunpeng user media block into an ACP prompt content block.
 *
 * The upstream dsh-acp bridge accepts only `text` and `resource_link` prompt
 * content — an `image` block is rejected with invalidParams
 * ("only text and resource_link prompt content is supported") BEFORE any
 * model call, which used to kill the whole Harness turn. DeepSeek's official
 * endpoints do not accept native image input either (they substitute an
 * "[Unsupported Image]" placeholder), so base64 media is dropped here and
 * callers must route vision through tools (image_recognition) instead —
 * mirroring the built-in DeepSeek path in glmClient.convertMessages.
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
