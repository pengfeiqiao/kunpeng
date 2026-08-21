/**
 * findRelevantMemories — pull the top-N memories relevant to a user message
 * without dumping the entire memory index into every turn's system prompt.
 *
 * Two tiers of matching:
 *   1. Local keyword scoring — fast, no API call, handles the common case
 *      (user mentions "logging", memory title contains "logging").
 *   2. (Optional, disabled by default) LLM side-query — if keyword match is
 *      inconclusive (<2 hits), fire a background GLM-4-flash call to re-rank.
 *      Deferred: we don't want to burn tokens on every turn and the keyword
 *      path works well for kunpeng's small memory corpus (<50 entries).
 *
 * Memory entries live at `~/.claude/projects/<slug>/memory/*.md` with simple
 * frontmatter. We only need `name`, `description`, `type` — body is kept
 * on disk and loaded lazily when the coordinator decides to inject.
 */

import { readDir, readTextFile, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';

export interface MemoryIndexEntry {
  file: string;
  /** Directory (relative to home) this memory lives in. */
  dir: string;
  name: string;
  description: string;
  type: string;
}

export interface RankedMemory extends MemoryIndexEntry {
  score: number;
}

// Claude Code stores per-project memory under ~/.claude/projects/<slug>/memory,
// where <slug> is the project cwd with '/' replaced by '-'. Kunpeng sessions
// run against the home directory, so derive the slug from the actual home path
// instead of hardcoding a username.
//
// Kunpeng additionally maintains its OWN memory at ~/.kunpeng/memory (written
// by the memory_write tool). Both directories are scanned; kunpeng's own
// memories win on name ties because they reflect this product's interactions.
export const KUNPENG_MEMORY_DIR_REL = '.kunpeng/memory';

let claudeMemoryDirRelPromise: Promise<string> | null = null;

function getClaudeMemoryDirRel(): Promise<string> {
  if (!claudeMemoryDirRelPromise) {
    claudeMemoryDirRelPromise = homeDir().then((home) => {
      const slug = home.replace(/\/+$/, '').replace(/\//g, '-');
      return `.claude/projects/${slug}/memory`;
    });
  }
  return claudeMemoryDirRelPromise;
}

/** All memory dirs, kunpeng's own first (wins on name ties). */
async function getMemoryDirsRel(): Promise<string[]> {
  return [KUNPENG_MEMORY_DIR_REL, await getClaudeMemoryDirRel()];
}

/** Parse a memory file's frontmatter into an index entry. */
function parseFrontmatter(file: string, dir: string, raw: string): MemoryIndexEntry | null {
  const match = raw.match(/^---\s*\n([\s\S]*?)\n---/);
  if (!match) return null;
  const body = match[1];
  const get = (key: string) => {
    const re = new RegExp(`^${key}:\\s*(.+)$`, 'm');
    return re.exec(body)?.[1]?.trim().replace(/^['"]|['"]$/g, '') ?? '';
  };
  const name = get('name');
  const description = get('description');
  const type = get('type');
  if (!name) return null;
  return { file, dir, name, description, type };
}

let cachedIndex: MemoryIndexEntry[] | null = null;

export async function loadMemoryIndex(force = false): Promise<MemoryIndexEntry[]> {
  if (cachedIndex && !force) return cachedIndex;
  try {
    const dirs = await getMemoryDirsRel();
    const parsed: MemoryIndexEntry[] = [];
    const seenNames = new Set<string>();
    for (const memoryDir of dirs) {
      let entries;
      try {
        entries = await readDir(memoryDir, { dir: BaseDirectory.Home });
      } catch {
        continue; // dir doesn't exist yet — fine (no memories written so far)
      }
      for (const e of entries) {
        if (!e.name || !e.name.endsWith('.md') || e.name === 'MEMORY.md') continue;
        try {
          const raw = await readTextFile(`${memoryDir}/${e.name}`, {
            dir: BaseDirectory.Home,
          });
          const entry = parseFrontmatter(e.name, memoryDir, raw);
          // First dir wins on name ties (kunpeng's own memory has priority).
          if (entry && !seenNames.has(entry.name)) {
            seenNames.add(entry.name);
            parsed.push(entry);
          }
        } catch {
          /* skip unreadable file */
        }
      }
    }
    cachedIndex = parsed;
    return parsed;
  } catch {
    cachedIndex = [];
    return [];
  }
}

export function invalidateMemoryIndex(): void {
  cachedIndex = null;
}

/**
 * Score each memory against the user's query using bag-of-words overlap.
 * Description is weighted 2x name because it tends to contain the specific
 * hook ("user is a data scientist" is more selective than the name
 * "user_role").
 */
function scoreMemory(query: string, entry: MemoryIndexEntry): number {
  const q = query.toLowerCase();
  const tokens = q.split(/[\s，。！？,.!?;:\-/]+/).filter((t) => t.length >= 2);
  if (tokens.length === 0) return 0;

  let score = 0;
  const name = entry.name.toLowerCase();
  const desc = entry.description.toLowerCase();
  for (const tok of tokens) {
    if (name.includes(tok)) score += 1;
    if (desc.includes(tok)) score += 2;
  }
  // Feedback memories are higher-value when they match — they encode explicit
  // user corrections and should shape behavior aggressively.
  if (entry.type === 'feedback') score *= 1.3;
  return score;
}

export async function findRelevantMemories(
  query: string,
  limit = 4,
): Promise<RankedMemory[]> {
  const index = await loadMemoryIndex();
  if (index.length === 0) return [];

  const ranked: RankedMemory[] = index
    .map((m) => ({ ...m, score: scoreMemory(query, m) }))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked;
}

/**
 * Load full body (minus frontmatter) for the given entries. Used by the
 * coordinator to inject memory content into the system prompt.
 */
export async function loadMemoryBodies(entries: MemoryIndexEntry[]): Promise<string[]> {
  const out: string[] = [];
  for (const e of entries) {
    try {
      const raw = await readTextFile(`${e.dir}/${e.file}`, {
        dir: BaseDirectory.Home,
      });
      const body = raw.replace(/^---\s*\n[\s\S]*?\n---\s*\n?/, '').trim();
      if (body) out.push(`# ${e.name} (${e.type})\n${body}`);
    } catch {
      /* skip */
    }
  }
  return out;
}
