import { readTextFile, BaseDirectory } from '@tauri-apps/api/fs';

export interface DirectorDNA {
  id: string;
  name: string;
  description: string;
  tags: string[];
  content: string;
}

function parseFrontmatter(raw: string): { attrs: Record<string, unknown>; body: string } {
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { attrs: {}, body: raw };

  const attrs: Record<string, unknown> = {};
  for (const line of match[1].split('\n')) {
    const kv = line.match(/^(\w+):\s*(.+)$/);
    if (kv) {
      let val: unknown = kv[2].trim();
      // Parse arrays
      if (typeof val === 'string' && val.startsWith('[') && val.endsWith(']')) {
        val = val.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
      }
      // Parse numbers
      const num = Number(val);
      if (!isNaN(num) && typeof val === 'string') val = num;
      attrs[kv[1]] = val;
    }
  }
  return { attrs, body: match[2].trim() };
}

const DIRECTOR_DIR = '.kunpeng/aigc-memory/director-dna';

/** Load all director DNA files from disk */
export async function loadAllDirectors(): Promise<DirectorDNA[]> {
  try {
    const { readDir } = await import('@tauri-apps/api/fs');
    const entries = await readDir(DIRECTOR_DIR, { dir: BaseDirectory.Home });
    const directors: DirectorDNA[] = [];
    for (const entry of entries) {
      if (!entry.path || !entry.name?.endsWith('.md')) continue;
      try {
        const raw = await readTextFile(`${DIRECTOR_DIR}/${entry.name}`, { dir: BaseDirectory.Home });
        const { attrs, body } = parseFrontmatter(raw);
        if (!attrs.id) continue;
        directors.push({
          id: attrs.id as string,
          name: (attrs.name as string) || (attrs.id as string),
          description: (attrs.description as string) || '',
          tags: (attrs.tags as string[]) || [],
          content: body,
        });
      } catch { /* skip */ }
    }
    return directors;
  } catch {
    return [];
  }
}

/** Load a single director by ID */
export async function loadDirector(id: string): Promise<DirectorDNA | null> {
  try {
    const raw = await readTextFile(`${DIRECTOR_DIR}/${id}.md`, { dir: BaseDirectory.Home });
    const { attrs, body } = parseFrontmatter(raw);
    if (!attrs.id) return null;
    return {
      id: attrs.id as string,
      name: (attrs.name as string) || id,
      description: (attrs.description as string) || '',
      tags: (attrs.tags as string[]) || [],
      content: body,
    };
  } catch {
    return null;
  }
}

/** Fuzzy match a query against known directors */
export function matchDirector(query: string, directors: DirectorDNA[]): DirectorDNA | null {
  const q = query.toLowerCase().replace(/[《》''""]/g, '');

  // Exact match first
  for (const d of directors) {
    if (d.id.toLowerCase() === q || d.name.toLowerCase() === q) return d;
  }

  // Partial match on name/description/tags
  let best: DirectorDNA | null = null;
  let bestScore = 0;
  for (const d of directors) {
    let score = 0;
    if (d.name.toLowerCase().includes(q)) score += 2;
    if (d.description.toLowerCase().includes(q)) score += 1;
    if (d.tags.some((t) => t.toLowerCase().includes(q))) score += 1.5;
    // Also check if query contains the director name
    if (q.includes(d.name.toLowerCase())) score += 2;
    if (score > bestScore) {
      bestScore = score;
      best = d;
    }
  }
  return bestScore >= 1 ? best : null;
}

/**
 * Build hot-memory context text for system prompt injection.
 *
 * - Empty directorName → undefined (no injection)
 * - Matches seed data → returns full DNA markdown
 * - No match → returns format framework for AI self-expansion
 */
export async function buildDirectorContext(directorName?: string): Promise<string | undefined> {
  if (!directorName || !directorName.trim()) return undefined;

  const trimmed = directorName.trim();
  const directors = await loadAllDirectors();
  const matched = matchDirector(trimmed, directors);

  if (matched) {
    return `## 当前导演档案
导演：${matched.name}
${matched.description}

${matched.content}`;
  }

  // AI self-expansion mode
  return `## 用户指定风格参考
用户要求风格：${trimmed}

以上导演/电影不在种子风格库中。请利用你的知识，按以下结构自动应用该风格到所有后续生成：

## 视觉基因
（色调、光影、构图、场景特征）

## 镜头语言
（景别偏好、运动方式、焦距选择、转场手法）

## 镜头节奏
（节奏类型、剪辑速度、镜头时长）

## 叙事手法
（结构风格、主题母题、特色手法）

## 常用参数
（针对 GPT-Image-2 / Seedance / Kling 的推荐参数）

请确保所有生成输出严格遵循上述风格特征。`;
}
