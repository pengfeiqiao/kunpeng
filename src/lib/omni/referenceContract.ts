export interface MgReferenceGuideBoard {
  kind: 'master' | 'frame';
  label: string;
  stage?: string;
}

export function mgChineseIndex(value: number): string {
  const digits = ['零', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
  if (value <= 10) return value === 10 ? '十' : digits[value] || String(value);
  if (value < 20) return `十${digits[value - 10]}`;
  return String(value);
}

export function buildMgReferenceGuide(
  boards: MgReferenceGuideBoard[],
  submittedSourceCount: number,
): string {
  const boardMentions = boards.map((board, index) =>
    `- @图片${mgChineseIndex(index + 1)}: ${
      board.kind === 'master'
        ? 'MG 母版概念图，锁定全部元素与视觉系统'
        : `${board.label}，同一设计系统的 ${board.stage || 'develop'} 阶段参考帧`
    }`,
  );
  const sourceMentions = Array.from({ length: submittedSourceCount }, (_, index) =>
    `- @图片${mgChineseIndex(boards.length + index + 1)}: 用户原始主体参考，锁定人物、文物或产品的身份与细节`,
  );
  return [
    'REFERENCE DESIGN SYSTEM:',
    ...boardMentions,
    ...sourceMentions,
    '- Animate between these compositions with coherent MG motion. Do not redesign the style or introduce unrelated visual elements.',
    '- User original references have higher identity priority than generated design boards. Preserve the person or object exactly.',
    '- Keep visible text minimal. Never invent, redraw or expand text from the reference boards.',
  ].join('\n');
}

export function composeMgSubmittedImageRefs(
  boardPaths: string[],
  submittedSourceRefs: string[],
  limit: number,
): string[] {
  return [...new Set([...boardPaths, ...submittedSourceRefs])].slice(0, limit);
}
