const COPYWRITING_REQUEST_MARKER = '\n用户请求：\n';

const LEADING_HARNESS_BLOCK_RE = /^\s*\[(?:用户正在|用户附加了以下文件|你是一个有审美态度的视频特效设计师)[\s\S]*?\]\s*\n\n/;
const ATTACHMENT_PREFIX_RE = /^\s*\[用户附加了以下文件，请根据需要读取\]\n(?:- .+\n)+\n/;

export function stripHarnessPrefix(content: string): string {
  let next = content;

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
