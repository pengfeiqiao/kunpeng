import type { CopyComment } from './types';

const CONTEXT_LENGTH = 28;

export interface CopyCommentTarget {
  quote: string;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
}

function findAll(content: string, quote: string): number[] {
  const positions: number[] = [];
  if (!quote) return positions;
  let from = 0;
  while (from <= content.length - quote.length) {
    const index = content.indexOf(quote, from);
    if (index < 0) break;
    positions.push(index);
    from = index + Math.max(1, quote.length);
  }
  return positions;
}

function contextScore(content: string, index: number, quote: string, prefix: string, suffix: string): number {
  let score = 0;
  if (prefix) {
    const before = content.slice(Math.max(0, index - prefix.length), index);
    for (let length = Math.min(before.length, prefix.length); length >= 4; length -= 1) {
      if (before.endsWith(prefix.slice(-length))) {
        score += length;
        break;
      }
    }
  }
  if (suffix) {
    const after = content.slice(index + quote.length, index + quote.length + suffix.length);
    for (let length = Math.min(after.length, suffix.length); length >= 4; length -= 1) {
      if (after.startsWith(suffix.slice(0, length))) {
        score += length;
        break;
      }
    }
  }
  return score;
}

export function createCopyCommentTarget(content: string, start: number, end: number): CopyCommentTarget | null {
  const initialStart = Math.max(0, Math.min(start, content.length));
  const initialEnd = Math.max(initialStart, Math.min(end, content.length));
  const raw = content.slice(initialStart, initialEnd);
  const leading = raw.length - raw.trimStart().length;
  const trailing = raw.length - raw.trimEnd().length;
  const safeStart = initialStart + leading;
  const safeEnd = Math.max(safeStart, initialEnd - trailing);
  const quote = content.slice(safeStart, safeEnd);
  if (!quote) return null;
  return {
    quote,
    start: safeStart,
    end: safeEnd,
    prefix: content.slice(Math.max(0, safeStart - CONTEXT_LENGTH), safeStart),
    suffix: content.slice(safeEnd, safeEnd + CONTEXT_LENGTH),
  };
}

export function findCopyCommentTarget(content: string, quote: string, rangeStart = 0, rangeEnd = content.length): CopyCommentTarget | null {
  const sliceStart = Math.max(0, Math.min(rangeStart, content.length));
  const sliceEnd = Math.max(sliceStart, Math.min(rangeEnd, content.length));
  const scoped = content.slice(sliceStart, sliceEnd);
  const direct = scoped.indexOf(quote);
  if (direct >= 0) {
    return createCopyCommentTarget(content, sliceStart + direct, sliceStart + direct + quote.length);
  }

  const compactQuote = quote.replace(/\s+/g, ' ').trim();
  if (!compactQuote) return null;
  const ignored = /[\s*_~`>#|]/;
  let plain = '';
  const rawIndexes: number[] = [];
  let previousWasSpace = false;
  for (let index = sliceStart; index < sliceEnd; index += 1) {
    const char = content[index];
    if (/\s/.test(char)) {
      if (!previousWasSpace) {
        plain += ' ';
        rawIndexes.push(index);
      }
      previousWasSpace = true;
      continue;
    }
    previousWasSpace = false;
    if (ignored.test(char)) continue;
    plain += char;
    rawIndexes.push(index);
  }
  const plainIndex = plain.indexOf(compactQuote);
  if (plainIndex < 0) return null;
  const rawStart = rawIndexes[plainIndex];
  const rawEndIndex = rawIndexes[Math.min(rawIndexes.length - 1, plainIndex + compactQuote.length - 1)];
  if (rawStart == null || rawEndIndex == null) return null;
  return createCopyCommentTarget(content, rawStart, rawEndIndex + 1);
}

export function resolveCopyCommentTarget(content: string, comment: CopyComment): CopyCommentTarget | null {
  if (
    comment.start >= 0
    && comment.end <= content.length
    && content.slice(comment.start, comment.end) === comment.quote
  ) {
    return createCopyCommentTarget(content, comment.start, comment.end);
  }

  const positions = findAll(content, comment.quote);
  if (positions.length === 0) return null;
  if (positions.length === 1) {
    return createCopyCommentTarget(content, positions[0], positions[0] + comment.quote.length);
  }

  const ranked = positions
    .map((index) => ({
      index,
      score: contextScore(content, index, comment.quote, comment.prefix, comment.suffix),
    }))
    .sort((a, b) => b.score - a.score || Math.abs(a.index - comment.start) - Math.abs(b.index - comment.start));
  if (ranked.length > 1 && ranked[0].score === ranked[1].score && ranked[0].score === 0) return null;
  return createCopyCommentTarget(content, ranked[0].index, ranked[0].index + comment.quote.length);
}

export function reanchorCopyComments(content: string, comments: CopyComment[] = []): CopyComment[] {
  return comments.map((comment) => {
    const target = resolveCopyCommentTarget(content, comment);
    if (!target) return { ...comment, orphaned: true };
    return {
      ...comment,
      ...target,
      orphaned: false,
    };
  });
}
