/**
 * mdRender — 文本节点的轻量 markdown 渲染（marked + 暗色样式 + 转义防护）。
 */
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

/** 渲染 markdown 为带暗色样式 class 的 HTML（内容来自本地/LLM，做基础转义防护） */
export function renderMarkdown(md: string): string {
  // marked 自身不 sanitize——先转义裸 HTML 标签（保留 markdown 语法生成的标签）
  const escaped = md.replace(/</g, '&lt;').replace(/>/g, '&gt;');
  return marked.parse(escaped, { async: false }) as string;
}

/** 选区包裹 markdown 符号（textarea 格式工具条用） */
export function wrapSelection(
  value: string,
  start: number,
  end: number,
  before: string,
  after = before,
): { next: string; selStart: number; selEnd: number } {
  const selected = value.slice(start, end);
  const next = value.slice(0, start) + before + selected + after + value.slice(end);
  return { next, selStart: start + before.length, selEnd: end + before.length };
}

/** 行首插入前缀（标题/列表） */
export function prefixLines(
  value: string,
  start: number,
  end: number,
  prefix: string,
): { next: string; selStart: number; selEnd: number } {
  const lineStart = value.lastIndexOf('\n', start - 1) + 1;
  const segment = value.slice(lineStart, end);
  const prefixed = segment.split('\n').map((l) => (l.startsWith(prefix) ? l : prefix + l)).join('\n');
  const next = value.slice(0, lineStart) + prefixed + value.slice(end);
  return { next, selStart: lineStart, selEnd: lineStart + prefixed.length };
}
