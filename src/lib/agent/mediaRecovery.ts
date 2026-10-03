import type { AgentMessage } from './types';

/** Rehydrate recent local image references without persisting base64 or guessing from prose. */
export async function recoverStoredImages(messages: AgentMessage[], load: (path: string) => Promise<string>): Promise<AgentMessage[]> {
  let remaining = 8;
  const result = [...messages];
  for (let i = result.length - 1; i >= 0; i--) {
    const message = result[i];
    if (message.role !== 'user' || !Array.isArray(message.content)) continue;
    const content = [];
    for (const block of message.content) {
      if (block.type !== 'image' || !block.sourcePath) { content.push(block); continue; }
      if (remaining-- <= 0) { content.push({ type: 'text' as const, text: `历史图片尚未重读：${block.sourcePath}。需要判断时调用 image_inspect 或 image_recognition，不能凭印象声称看过。` }); continue; }
      try {
        const input = await load(block.sourcePath);
        const source = input.startsWith('data:')
          ? { type: 'base64' as const, media_type: input.slice(5, input.indexOf(';')), data: input.slice(input.indexOf(',') + 1) }
          : { type: 'url' as const, url: input };
        content.push({ ...block, source });
      } catch {
        content.push({ type: 'text' as const, text: `图片重读失败：${block.sourcePath}。当前未看到像素，不能给出视觉结论；请核实原文件是否仍存在。` });
      }
    }
    result[i] = { ...message, content };
  }
  return result;
}
