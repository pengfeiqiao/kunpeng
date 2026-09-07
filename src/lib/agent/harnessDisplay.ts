import { readWorkspaceMessage } from './workspaceMessage.ts';

const COPYWRITING_REQUEST_MARKER = '\n用户请求：\n';

const LEADING_HARNESS_BLOCK_RE = /^\s*\[(?:用户正在|用户附加了以下文件|你是一个有审美态度的视频特效设计师)[\s\S]*?\]\s*\n\n/;
const ATTACHMENT_PREFIX_RE = /^\s*\[用户附加了以下文件，请根据需要读取\]\n(?:- .+\n)+\n/;

export function stripHarnessPrefix(content: string): string {
  // Attachments may surround the transport block, but are never authorization.
  let next = content.trimStart();
  while (ATTACHMENT_PREFIX_RE.test(next)) next = next.replace(ATTACHMENT_PREFIX_RE, '');
  const envelope = readWorkspaceMessage(next);
  if (envelope.status === 'valid') return envelope.request.trimStart();
  if (envelope.status === 'invalid') return '';
  // These internal legacy workspace formats have no unambiguous context boundary.
  // New sends must use the envelope; do not guess authorization from a cached raw block.
  if (/^\[(?:媒体工作台上下文|画布上下文)[:：]/.test(next)) return '';

  if (/^\s*\[用户正在鲲鹏文案工作室\]/.test(next) && next.includes(COPYWRITING_REQUEST_MARKER)) {
    next = next.slice(next.indexOf(COPYWRITING_REQUEST_MARKER) + COPYWRITING_REQUEST_MARKER.length);
  }

  while (LEADING_HARNESS_BLOCK_RE.test(next) || ATTACHMENT_PREFIX_RE.test(next)) {
    next = next
      .replace(ATTACHMENT_PREFIX_RE, '')
      .replace(LEADING_HARNESS_BLOCK_RE, '');
  }

  return next.trimStart();
}
