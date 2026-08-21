import type { Node } from 'reactflow';

export const DEFAULT_NODE_SIZE = {
  text: { width: 300, height: 160 },
  image: { width: 280, height: 160 },
  video: { width: 320, height: 180 },
  audio: { width: 360, height: 120 },
  panorama: { width: 280, height: 250 },
  group: { width: 360, height: 260 },
  fallback: { width: 220, height: 150 },
} as const;

export function defaultNodeStyle(type: string | undefined): { width: number; height: number } | undefined {
  const size = DEFAULT_NODE_SIZE[type as keyof typeof DEFAULT_NODE_SIZE];
  return size ? { width: size.width, height: size.height } : undefined;
}

export function textNodeSize(text: string): { width: number; height: number } {
  const clean = text || '';
  const lines = clean.split('\n');
  const longest = lines.reduce((m, line) => Math.max(m, line.length), 0);
  const softLines = lines.reduce((sum, line) => sum + Math.max(1, Math.ceil(line.length / 34)), 0);
  const width = Math.max(260, Math.min(460, longest > 42 ? 380 : 300));
  const height = Math.max(130, Math.min(520, 74 + softLines * 22));
  return { width, height };
}

export function estimateNodeSize(node: Pick<Node, 'type' | 'width' | 'height' | 'style' | 'data'>): { width: number; height: number } {
  const style = (node.style ?? {}) as Record<string, unknown>;
  const styleWidth = typeof style.width === 'number' ? style.width : undefined;
  const styleHeight = typeof style.height === 'number' ? style.height : undefined;
  if (node.type === 'text') {
    const data = (node.data ?? {}) as Record<string, unknown>;
    const content = String(data.generatedContent || data.description || '');
    const size = textNodeSize(content);
    return {
      width: Math.max(node.width ?? styleWidth ?? 0, size.width),
      height: Math.max(node.height ?? styleHeight ?? 0, size.height),
    };
  }
  const fallback = DEFAULT_NODE_SIZE[(node.type as keyof typeof DEFAULT_NODE_SIZE) ?? 'fallback'] ?? DEFAULT_NODE_SIZE.fallback;
  return {
    width: node.width ?? styleWidth ?? fallback.width,
    height: node.height ?? styleHeight ?? fallback.height,
  };
}

function rectsOverlap(a: { x: number; y: number; width: number; height: number }, b: { x: number; y: number; width: number; height: number }, gap: number): boolean {
  return !(
    a.x + a.width + gap <= b.x ||
    b.x + b.width + gap <= a.x ||
    a.y + a.height + gap <= b.y ||
    b.y + b.height + gap <= a.y
  );
}

export function findNonOverlappingOffset(sourceNodes: Node[], existingNodes: Node[], preferredOffset = 40): { x: number; y: number } {
  if (sourceNodes.length === 0 || existingNodes.length === 0) return { x: preferredOffset, y: preferredOffset };
  const minX = Math.min(...sourceNodes.map((n) => n.position.x));
  const minY = Math.min(...sourceNodes.map((n) => n.position.y));
  const pastedRects = sourceNodes.map((n) => {
    const size = estimateNodeSize(n);
    return {
      x: n.position.x - minX,
      y: n.position.y - minY,
      width: size.width,
      height: size.height,
    };
  });
  const occupied = existingNodes.map((n) => {
    const size = estimateNodeSize(n);
    return { x: n.position.x, y: n.position.y, width: size.width, height: size.height };
  });

  const candidates: { x: number; y: number }[] = [];
  for (let step = 1; step <= 14; step++) {
    candidates.push({ x: preferredOffset * step, y: preferredOffset * step });
    candidates.push({ x: preferredOffset * step, y: 0 });
    candidates.push({ x: 0, y: preferredOffset * step });
    candidates.push({ x: preferredOffset * step, y: -preferredOffset * step });
  }

  for (const c of candidates) {
    const ok = pastedRects.every((r) => {
      const shifted = { ...r, x: minX + c.x + r.x, y: minY + c.y + r.y };
      return occupied.every((o) => !rectsOverlap(shifted, o, 18));
    });
    if (ok) return c;
  }
  return { x: preferredOffset * 2, y: preferredOffset * 2 };
}
