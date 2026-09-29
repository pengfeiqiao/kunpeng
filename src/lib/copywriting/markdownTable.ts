import { Lexer, type Tokens } from 'marked';

/** GFM parsing preserves empty cells, escaped pipes, and optional outer pipes. */
export function parseTableCells(markdown: string) {
  const token = Lexer.lex(markdown.trim(), { gfm: true })[0];
  if (token?.type !== 'table') return null;
  const table = token as Tokens.Table;
  return {
    headers: table.header.map(cell => cell.text),
    rows: table.rows.map(row => row.map(cell => cell.text)),
  };
}

export function parseMarkdownTable(markdown: string) {
  const table = parseTableCells(markdown);
  if (!table) return null;
  return { headers: table.headers, rows: table.rows.map(cells =>
    Object.fromEntries(table.headers.map((header, index) => [header, cells[index] ?? '']))) };
}

/** Keep Markdown block boundaries when an edited table replaces its source. */
export function replaceCopyContentRange(content: string, start: number, end: number, replacement: string): string {
  const suffix = content.slice(end);
  return content.slice(0, start) + replacement + (suffix.trim() ? '\n\n' + suffix.replace(/^(?:\r?\n)*/, '') : suffix);
}

/** Locate top-level tables without mistaking fenced examples for editable tables. */
export function copyTableRanges(content: string) {
  const normalized = content.replace(/\r\n?/g, '\n');
  const offsets: number[] | undefined = content.includes('\r') ? [] : undefined;
  if (offsets) {
    for (let i = 0; i < content.length; i++) {
      offsets.push(i);
      if (content[i] === '\r' && content[i + 1] === '\n') i++;
    }
    offsets.push(content.length);
  }
  const original = (offset: number) => offsets?.[offset] ?? offset;
  const ranges: { start: number; end: number; raw: string }[] = [];
  let offset = 0;
  for (const token of Lexer.lex(normalized, { gfm: true })) {
    if (token.type === 'table') {
      const start = original(offset);
      const end = original(offset + token.raw.trimEnd().length);
      ranges.push({ start, end, raw: content.slice(start, end) });
    }
    offset += token.raw.length;
  }
  return ranges;
}
