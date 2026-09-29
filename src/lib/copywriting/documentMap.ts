import { Lexer } from 'marked';
import { parseTableCells } from './markdownTable.ts';

export type CopyBlockKind = 'heading' | 'paragraph' | 'list' | 'quote' | 'code' | 'table';

export interface CopyBlock {
  id: string;
  kind: CopyBlockKind;
  start: number;
  end: number;
  startLine: number;
  endLine: number;
  hash: string;
  text: string;
  preview: string;
}

export interface CopyPatch {
  op?: 'replace_block' | 'replace_text' | 'insert_before' | 'insert_after';
  blockId?: string;
  selector?: string;
  hash?: string;
  find?: string;
  replace?: string;
  text?: string;
}

interface LineInfo {
  text: string;
  raw: string;
  start: number;
  end: number;
  lineNo: number;
}

const KIND_LABEL: Record<CopyBlockKind, string> = {
  heading: '标题',
  paragraph: '段落',
  list: '列表',
  quote: '引用',
  code: '代码',
  table: '表格',
};

function splitLines(content: string): LineInfo[] {
  const parts = content.match(/[^\n]*(?:\n|$)/g) ?? [];
  const lines: LineInfo[] = [];
  let start = 0;
  for (const raw of parts) {
    if (!raw && start >= content.length) continue;
    const text = raw.replace(/\r?\n$/, '');
    lines.push({
      text,
      raw,
      start,
      end: start + raw.length,
      lineNo: lines.length + 1,
    });
    start += raw.length;
  }
  return lines;
}

function stableHash(input: string): string {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).padStart(6, '0').slice(0, 6);
}

function compactPreview(text: string, max = 180): string {
  const value = text.replace(/\s+/g, ' ').trim();
  return value.length > max ? `${value.slice(0, max)}...` : value;
}

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownBlockToHtml(block: CopyBlock, includeFullText = false): string {
  const source = includeFullText ? block.text : block.preview;
  const escapedText = escapeHtml(source);
  if (block.kind === 'heading') {
    const level = block.text.match(/^(#{1,6})\s+/)?.[1].length ?? 2;
    const body = escapeHtml(source.replace(/^#{1,6}\s+/, ''));
    return `<h${level}>${body}</h${level}>`;
  }
  if (block.kind === 'list') {
    const items = source
      .split('\n')
      .map(line => line.replace(/^\s*(?:[-*+]|\d+\.)\s+/, '').trim())
      .filter(Boolean)
      .map(item => `<li>${escapeHtml(item)}</li>`)
      .join('');
    const tag = /^\s*\d+\./.test(block.text) ? 'ol' : 'ul';
    return `<${tag}>${items}</${tag}>`;
  }
  if (block.kind === 'quote') {
    const body = source
      .split('\n')
      .map(line => line.replace(/^>\s?/, ''))
      .join('\n');
    return `<blockquote>${escapeHtml(body)}</blockquote>`;
  }
  if (block.kind === 'code') {
    return `<pre><code>${escapedText}</code></pre>`;
  }
  if (block.kind === 'table') {
    const table = parseTableCells(block.text);
    if (table) {
      const rows = includeFullText ? table.rows : table.rows.slice(0, 3);
      const cells = (row: string[], tag: string) => row.map(cell => `<${tag}${cell ? '' : ' data-empty="true"'}>${escapeHtml(cell)}</${tag}>`).join('');
      return `<table><thead><tr>${cells(table.headers, 'th')}</tr></thead><tbody>${rows.map(row => `<tr>${cells(row, 'td')}</tr>`).join('')}</tbody></table>${rows.length < table.rows.length ? '<!-- remaining rows omitted -->' : ''}`;
    }
    return `<pre>${escapedText}</pre>`;
  }
  return `<p>${escapedText}</p>`;
}

function isBlank(text: string): boolean {
  return text.trim().length === 0;
}

function lineKind(text: string): CopyBlockKind {
  if (/^#{1,6}\s+/.test(text)) return 'heading';
  if (/^>\s?/.test(text)) return 'quote';
  if (/^\s*(?:[-*+]|\d+\.)\s+/.test(text)) return 'list';
  if (/^\|.+\|$/.test(text.trim())) return 'table';
  return 'paragraph';
}

function makeBlock(lines: LineInfo[], from: number, toExclusive: number, idIndex: number, kind: CopyBlockKind): CopyBlock | null {
  const first = lines[from];
  const last = lines[toExclusive - 1];
  if (!first || !last) return null;
  const raw = lines
    .slice(from, toExclusive)
    .map(line => line.raw)
    .join('')
    .replace(/(?:\r?\n)+$/g, '');
  if (!raw.trim()) return null;
  const start = first.start;
  const end = start + raw.length;
  return {
    id: `B${String(idIndex).padStart(4, '0')}`,
    kind,
    start,
    end,
    startLine: first.lineNo,
    endLine: last.lineNo,
    hash: stableHash(raw),
    text: raw,
    preview: compactPreview(raw),
  };
}

export function buildCopyDocMap(content: string): CopyBlock[] {
  const lines = splitLines(content);
  const blocks: CopyBlock[] = [];
  let i = 0;
  let idIndex = 1;

  const push = (from: number, toExclusive: number, kind: CopyBlockKind) => {
    const block = makeBlock(lines, from, toExclusive, idIndex, kind);
    if (!block) return;
    blocks.push(block);
    idIndex += 1;
  };

  while (i < lines.length) {
    if (isBlank(lines[i].text)) {
      i += 1;
      continue;
    }

    if (/^```/.test(lines[i].text)) {
      const from = i;
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].text)) i += 1;
      if (i < lines.length) i += 1;
      push(from, i, 'code');
      continue;
    }

    // Detect GFM tables with or without outer pipes; stop before a following heading.
    if (i + 1 < lines.length && lines[i].text.includes('|') && /^\s*\|?\s*:?-+/.test(lines[i + 1].text)) {
      const token = Lexer.lex(content.slice(lines[i].start), { gfm: true })[0];
      if (token?.type === 'table') {
        const from = i;
        i += token.raw.trimEnd().split('\n').length;
        push(from, i, 'table');
        continue;
      }
    }

    const kind = lineKind(lines[i].text);
    const from = i;
    i += 1;

    if (kind === 'heading') {
      push(from, i, kind);
      continue;
    }

    while (i < lines.length && !isBlank(lines[i].text)) {
      const nextKind = lineKind(lines[i].text);
      if (nextKind === 'heading' || nextKind !== kind) break;
      i += 1;
    }
    push(from, i, kind);
  }

  return blocks;
}

export function findBlockBySelection(content: string, selectedText: string): CopyBlock | null {
  if (!selectedText.trim()) return null;
  const blocks = buildCopyDocMap(content);
  const exactIndex = content.indexOf(selectedText);
  if (exactIndex >= 0) {
    return blocks.find(block => exactIndex >= block.start && exactIndex < block.end) ?? null;
  }
  const normalized = selectedText.replace(/\s+/g, ' ').trim();
  return blocks.find(block => block.text.replace(/\s+/g, ' ').includes(normalized)) ?? null;
}

export function formatCopyDocMap(content: string, maxBlocks = 160): string {
  const blocks = buildCopyDocMap(content);
  if (blocks.length === 0) return '（当前文档为空）';
  const visible = blocks.slice(0, maxBlocks);
  const lines = visible.map(block => {
    const range = block.startLine === block.endLine ? `L${block.startLine}` : `L${block.startLine}-L${block.endLine}`;
    return `${block.id} | ${KIND_LABEL[block.kind]} | ${range} | h=${block.hash} | ${block.preview}`;
  });
  if (blocks.length > visible.length) {
    lines.push(`（还有 ${blocks.length - visible.length} 个块未显示。需要修改未显示块时，请先说明需要定位的关键词。）`);
  }
  return lines.join('\n');
}

export function formatCopyDocHtml(
  content: string,
  options: { maxBlocks?: number; fullBlockIds?: string[]; includeAllText?: boolean } = {},
): string {
  const maxBlocks = options.maxBlocks ?? 120;
  const fullBlockIds = new Set((options.fullBlockIds ?? []).map(id => id.toLowerCase()));
  const blocks = buildCopyDocMap(content);
  if (blocks.length === 0) return '<article data-doc-empty="true"></article>';
  const visible = blocks.slice(0, maxBlocks);
  const html = visible.map(block => {
    const lineRange = block.startLine === block.endLine ? `${block.startLine}` : `${block.startLine}-${block.endLine}`;
    const full = options.includeAllText || fullBlockIds.has(block.id.toLowerCase());
    const mode = full ? 'full' : 'preview';
    return [
      `<section data-block-id="${block.id}" data-kind="${block.kind}" data-lines="${lineRange}" data-hash="${block.hash}" data-content="${mode}">`,
      `  ${markdownBlockToHtml(block, full)}`,
      `</section>`,
    ].join('\n');
  });
  if (blocks.length > visible.length) {
    html.push(`<!-- ${blocks.length - visible.length} more blocks omitted. Ask for keywords before editing omitted blocks. -->`);
  }
  return `<article data-format="markdown-html">\n${html.join('\n')}\n</article>`;
}

export function formatSelectedCopyContext(content: string, selectedText?: string): string {
  if (!selectedText?.trim()) return '';
  const block = findBlockBySelection(content, selectedText);
  if (!block) {
    return `\n\n用户当前选中的文字：\n${selectedText}\n`;
  }
  return `\n\n用户当前选中的文字位于 ${block.id}（L${block.startLine}-L${block.endLine}, h=${block.hash}）：\n选中文本：\n${selectedText}\n\n所在块完整内容：\n${block.text}\n`;
}

function canonicalChar(char: string): string {
  const map: Record<string, string> = {
    '，': ',',
    '。': '.',
    '！': '!',
    '？': '?',
    '：': ':',
    '；': ';',
    '“': '"',
    '”': '"',
    '‘': "'",
    '’': "'",
    '（': '(',
    '）': ')',
    '【': '[',
    '】': ']',
    '《': '<',
    '》': '>',
    '、': ',',
    '—': '-',
    '–': '-',
  };
  return map[char] ?? char.toLowerCase();
}

function normalize(input: string): { value: string; map: number[] } {
  let value = '';
  const map: number[] = [];
  let lastWasSpace = false;
  for (let i = 0; i < input.length; i += 1) {
    const char = input[i];
    if (/\s/.test(char)) {
      if (!lastWasSpace) {
        value += ' ';
        map.push(i);
        lastWasSpace = true;
      }
      continue;
    }
    value += canonicalChar(char);
    map.push(i);
    lastWasSpace = false;
  }
  const first = value.search(/\S/);
  if (first < 0) return { value: '', map: [] };
  let last = value.length - 1;
  while (last > first && /\s/.test(value[last])) last -= 1;
  return { value: value.slice(first, last + 1), map: map.slice(first, last + 1) };
}

function findNormalizedRange(source: string, target: string): { start: number; end: number } | null {
  const left = normalize(source);
  const right = normalize(target);
  if (!right.value) return null;
  const start = left.value.indexOf(right.value);
  if (start < 0) return null;
  const endIndex = start + right.value.length - 1;
  return {
    start: left.map[start] ?? 0,
    end: (left.map[endIndex] ?? source.length - 1) + 1,
  };
}

function resolvePatchText(patch: CopyPatch): string {
  if (typeof patch.text === 'string') return patch.text;
  if (typeof patch.replace === 'string') return patch.replace;
  return '';
}

function blockIdFromSelector(selector?: string): string | undefined {
  if (!selector) return undefined;
  return selector.match(/data-block-id=['"]?(B\d{4,})['"]?/i)?.[1]
    ?? selector.match(/#(B\d{4,})/i)?.[1]
    ?? undefined;
}

export function applyCopyPatchesDetailed(content: string, patches: CopyPatch[]) {
  const blocks = buildCopyDocMap(content);
  const edits: { start: number; end: number; text: string; index: number }[] = [];
  const conflicts: { index: number; reason: string }[] = [];
  const fail = (index: number, reason: string) => conflicts.push({ index, reason });
  patches.forEach((patch, index) => {
    const id = patch.blockId ?? blockIdFromSelector(patch.selector);
    let block = id ? blocks.find(item => item.id.toLowerCase() === id.toLowerCase()) : undefined;
    const op = patch.op ?? (patch.find ? 'replace_text' : 'replace_block');
    const text = resolvePatchText(patch);
    if (typeof patch.text !== 'string' && typeof patch.replace !== 'string') {
      fail(index, '缺少 text 或 replace'); return;
    }
    if (patch.hash && block?.hash !== patch.hash) {
      const matches = blocks.filter(item => item.hash === patch.hash);
      if (matches.length === 1) block = matches[0];
      else { fail(index, '目标块已改变或无法唯一定位，请使用返回的最新块信息'); return; }
    }
    if (id && !block) { fail(index, '目标块不存在'); return; }
    if (op === 'replace_text') {
      if (!patch.find) { fail(index, 'replace_text 缺少 find'); return; }
      const source = block?.text ?? content;
      const exact = source.indexOf(patch.find);
      let range: { start: number; end: number } | null = null;
      if (exact >= 0) {
        if (source.indexOf(patch.find, exact + 1) >= 0) { fail(index, 'find 匹配多处，请缩小范围'); return; }
        range = { start: exact, end: exact + patch.find.length };
      } else {
        const normalizedSource = normalize(source).value;
        const target = normalize(patch.find).value;
        const first = normalizedSource.indexOf(target);
        if (target && first >= 0 && normalizedSource.indexOf(target, first + 1) >= 0) {
          fail(index, 'find 匹配多处，请缩小范围'); return;
        }
        range = findNormalizedRange(source, patch.find);
      }
      if (!range) { fail(index, '目标范围内没有找到 find'); return; }
      edits.push({ start: (block?.start ?? 0) + range.start, end: (block?.start ?? 0) + range.end, text, index });
      return;
    }
    if (!block) { fail(index, '此操作需要有效的 blockId'); return; }
    if (op === 'replace_block') edits.push({ start: block.start, end: block.end, text, index });
    else if (op === 'insert_before') edits.push({ start: block.start, end: block.start, text: text.replace(/\n*$/, '') + '\n\n', index });
    else if (op === 'insert_after') edits.push({ start: block.end, end: block.end, text: '\n\n' + text.replace(/^\n*/, ''), index });
    else fail(index, '未知 patch 操作');
  });
  edits.sort((a, b) => a.start - b.start || a.end - b.end);
  for (let i = 1; i < edits.length; i++) {
    if (edits[i].start < edits[i - 1].end || edits[i].start === edits[i - 1].start) {
      fail(edits[i].index, '补丁范围重叠，请合并为一个补丁');
    }
  }
  // Every patch in a batch refers to the same original snapshot. Never partially commit.
  if (conflicts.length) return { content, conflicts, applied: 0 };
  let result = content;
  for (const edit of edits.reverse()) result = result.slice(0, edit.start) + edit.text + result.slice(edit.end);
  return { content: result, conflicts, applied: edits.length };
}

export function applyCopyPatches(content: string, patches: CopyPatch[]): string {
  return applyCopyPatchesDetailed(content, patches).content;
}
