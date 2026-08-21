import { BaseDirectory, readDir, readTextFile } from '@tauri-apps/api/fs';

const AIGC_MEMORY_PATH = '.kunpeng/aigc-memory';

interface ParsedMarkdown {
  frontmatter: Record<string, unknown>;
  body: string;
}

export function parseFrontmatter(markdown: string): ParsedMarkdown {
  const match = markdown.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) return { frontmatter: {}, body: markdown };

  const frontmatter: Record<string, unknown> = {};
  const lines = match[1].split('\n');
  for (const line of lines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    if (value.startsWith('[') && value.endsWith(']')) {
      frontmatter[key] = value.slice(1, -1).split(',').map((s) => s.trim().replace(/^['"]|['"]$/g, ''));
    } else if (value === 'true') frontmatter[key] = true;
    else if (value === 'false') frontmatter[key] = false;
    else if (!isNaN(Number(value))) frontmatter[key] = Number(value);
    else frontmatter[key] = value.replace(/^['"]|['"]$/g, '');
  }

  return { frontmatter, body: match[2].trim() };
}

export async function scanMemoryDir(subpath: string): Promise<string[]> {
  try {
    const entries = await readDir(`${AIGC_MEMORY_PATH}/${subpath}`, { dir: BaseDirectory.Home, recursive: false });
    return entries
      .filter((e) => !!e.name && !e.children && e.name.endsWith('.md'))
      .map((e) => `${AIGC_MEMORY_PATH}/${subpath}/${e.name}`);
  } catch {
    return [];
  }
}

export async function readMemoryFile(relPath: string): Promise<ParsedMarkdown | null> {
  try {
    const content = await readTextFile(relPath, { dir: BaseDirectory.Home });
    return parseFrontmatter(content);
  } catch {
    return null;
  }
}

export async function listGenerationLogs(): Promise<{ path: string; name: string; timestamp: string }[]> {
  try {
    const entries = await readDir(`${AIGC_MEMORY_PATH}/generation-log`, {
      dir: BaseDirectory.Home,
      recursive: false,
    });
    return entries
      .filter((e) => !!e.name && !e.children && e.name.endsWith('.md'))
      .map((e) => {
        const name = e.name as string;
        const tsMatch = name.match(/^(\d{4}-\d{2}-\d{2}-\d{6})/);
        return {
          path: `${AIGC_MEMORY_PATH}/generation-log/${name}`,
          name,
          timestamp: tsMatch ? tsMatch[1] : name,
        };
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  } catch {
    return [];
  }
}
