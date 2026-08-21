import { readTextFile, writeTextFile, exists, BaseDirectory } from '@tauri-apps/api/fs';
import { invoke } from '@tauri-apps/api/tauri';
import { homeDir } from '@tauri-apps/api/path';

export interface GenerationLogEntry {
  timestamp: string;
  director: string;
  taskType: 'text-to-image' | 'image-to-video' | 'text-to-video';
  engine: 'gpt-image-2' | 'seedance' | 'kling' | 'other';
  prompt: string;
  outputPath: string;
  outputPaths?: string[];
  skillId?: string;
  userFeedback?: 'good' | 'bad' | 'modified';
  model?: string;
  duration?: number;
  projectId?: string;
  shotNo?: string;
  taskId?: string;
  providerTaskId?: string;
  endpoint?: string;
  webappId?: string;
  params?: Record<string, unknown>;
  submittedParams?: Record<string, unknown>;
  nodeInfoList?: Array<{ nodeId: string; fieldName: string; fieldValue: string }>;
  refs?: Array<{ index: number; type: 'image' | 'audio' | 'video'; source: string }>;
  validation?: {
    passed: boolean;
    errors?: string[];
    warnings?: string[];
  };
  failureReason?: string;
}

function logFilePath(): string {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  return `.kunpeng/aigc-memory/generation-log/${ym}.jsonl`;
}

export async function appendGenerationLog(entry: GenerationLogEntry): Promise<void> {
  try {
    const path = logFilePath();
    const line = JSON.stringify(entry) + '\n';
    // True OS-level append via the Rust append_file command — the old
    // read-all + write-all pattern was O(n²) over a month of logs and lost
    // lines when two appends raced each other.
    const home = await homeDir();
    await invoke('append_file', { path: `${home}${path}`, content: line });
  } catch (err) {
    console.warn('[genLogger] Failed to append log:', err);
  }
}

export async function getRecentGenerations(limit = 20): Promise<GenerationLogEntry[]> {
  const results: GenerationLogEntry[] = [];
  const now = new Date();
  // Check current month and previous month
  for (let i = 0; i < 2; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    const path = `.kunpeng/aigc-memory/generation-log/${ym}.jsonl`;
    try {
      const fileExists = await exists(path, { dir: BaseDirectory.Home });
      if (!fileExists) continue;
      const content = await readTextFile(path, { dir: BaseDirectory.Home });
      const lines = content.trim().split('\n').filter(Boolean);
      for (const line of lines.reverse()) {
        try {
          results.push(JSON.parse(line) as GenerationLogEntry);
        } catch { /* skip malformed lines */ }
        if (results.length >= limit) return results;
      }
    } catch { /* skip unreadable */ }
  }
  return results;
}

export async function updateFeedback(timestamp: string, feedback: 'good' | 'bad' | 'modified'): Promise<void> {
  const date = new Date(timestamp);
  const ym = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
  const path = `.kunpeng/aigc-memory/generation-log/${ym}.jsonl`;
  try {
    const fileExists = await exists(path, { dir: BaseDirectory.Home });
    if (!fileExists) return;
    const content = await readTextFile(path, { dir: BaseDirectory.Home });
    const lines = content.split('\n');
    const updated = lines.map((line) => {
      if (!line.trim()) return line;
      try {
        const entry = JSON.parse(line) as GenerationLogEntry;
        if (entry.timestamp === timestamp) {
          entry.userFeedback = feedback;
          return JSON.stringify(entry);
        }
      } catch { /* skip */ }
      return line;
    });
    await writeTextFile(path, updated.join('\n'), { dir: BaseDirectory.Home });
  } catch (err) {
    console.warn('[genLogger] Failed to update feedback:', err);
  }
}

export async function getUnreviewedGenerations(): Promise<GenerationLogEntry[]> {
  const all = await getRecentGenerations(100);
  return all.filter((e) => !e.userFeedback);
}

// ── Active state (in-memory, session-only) ───────────────────────────────────

let _activeDirector = '';

export function setActiveDirector(name: string): void {
  _activeDirector = name;
}

export function getActiveDirector(): string {
  return _activeDirector;
}
