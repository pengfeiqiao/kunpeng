import { useEffect, useRef } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { homeDir } from '@tauri-apps/api/path';
import { readDir } from '@tauri-apps/api/fs';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useBackgroundTaskStore, isTerminalTaskStatus } from '@/stores/backgroundTaskStore';
import { useCanvasStore } from '@/stores/canvasStore';

interface CommandResult {
  stdout: string;
  stderr: string;
  exit_code: number;
}

const POLL_INTERVAL = 30_000; // 30 seconds
const POLL_CONCURRENCY = 3;
const getDreaminaPath = async () => `${await homeDir()}.local/bin/dreamina`;

/**
 * Background poller for long-running tasks (e.g. Dreamina video generation).
 * Runs every 30s. Claims 'pending' tasks (→ 'running'), polls all
 * non-terminal tasks with bounded concurrency, updates the store on completion.
 */
export function useBackgroundPoller() {
  const pollingRef = useRef(false);

  useEffect(() => {
    const poll = async () => {
      if (pollingRef.current) return; // prevent overlap

      const { tasks, updateTask } = useBackgroundTaskStore.getState();
      const active = tasks.filter((t) => !isTerminalTaskStatus(t.status));
      if (active.length === 0) return;

      // Claim pending tasks so the UI can distinguish "queued" from "polling".
      for (const t of active) {
        if (t.status === 'pending') updateTask(t.id, { status: 'running' });
      }

      pollingRef.current = true;

      try {
        // Bounded-concurrency worker pool: one slow task (30s CLI timeout)
        // no longer stalls every other task's poll.
        const queue = [...active];
        const workers = Array.from(
          { length: Math.min(POLL_CONCURRENCY, queue.length) },
          async () => {
            for (let task = queue.shift(); task; task = queue.shift()) {
              await pollDreaminaTask(task.id, task.submitId);
            }
          },
        );
        await Promise.all(workers);
      } finally {
        pollingRef.current = false;
      }
    };

    // Poll immediately on mount (in case tasks are pending from a restart)
    poll();

    const timer = setInterval(poll, POLL_INTERVAL);
    return () => clearInterval(timer);
  }, []);
}

async function pollDreaminaTask(taskId: string, submitId: string) {
  const { tasks, updateTask } = useBackgroundTaskStore.getState();
  const task = tasks.find((t) => t.id === taskId);

  try {
    const dreaminaPath = await getDreaminaPath();
    const result = await invoke<CommandResult>('execute_command', {
      command: `source ~/.zshrc && ${dreaminaPath} query_result --submit_id=${submitId}`,
      timeoutMs: 30000,
    });

    const output = result.stdout || result.stderr || '';

    // Try to parse JSON from output
    const jsonMatch = output.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      // No JSON — might still be processing, skip this round
      return;
    }

    let data: Record<string, unknown>;
    try {
      data = JSON.parse(jsonMatch[0]);
    } catch {
      return; // Can't parse, try again next round
    }

    const genStatus = data.gen_status as string | undefined;

    if (genStatus === 'success') {
      // Download the result
      const downloadDir = await getDownloadDir();
      let resultPath: string | undefined;

      if (downloadDir) {
        // Snapshot existing files before download
        const existingFiles = new Set<string>();
        try {
          const entries = await readDir(downloadDir);
          for (const e of entries) if (e.name) existingFiles.add(e.name);
        } catch { /* dir may not exist yet */ }

        await invoke<CommandResult>('execute_command', {
          command: `source ~/.zshrc && ${dreaminaPath} query_result --submit_id=${submitId} --download_dir="${downloadDir}"`,
          timeoutMs: 60000,
        });

        // Find the newly created file
        try {
          const entries = await readDir(downloadDir);
          const newFiles = entries.filter((e) => e.name && !existingFiles.has(e.name));
          if (newFiles.length > 0) {
            resultPath = newFiles[0].path;
          }
        } catch { /* scan failed, resultPath stays undefined */ }
      }

      const resultUrl = resultPath ? convertFileSrc(resultPath) : (downloadDir || undefined);

      updateTask(taskId, {
        status: 'completed',
        completedAt: Date.now(),
        resultUrl,
        resultPath,
      });

      // Write back to canvas node if configured
      if (resultPath && task?.nodeId) {
        const canvasStore = useCanvasStore.getState();
        const node = canvasStore.nodes.find((n) => n.id === task.nodeId);
        if (node) {
          const assetUrl = convertFileSrc(resultPath);
          const kind = task.genKind ?? 'video';
          canvasStore.updateNode(task.nodeId, {
            isGenerating: false,
            justCompletedAt: Date.now(),
            ...(kind === 'image'
              ? { generatedImageUrl: assetUrl, localPath: resultPath }
              : { generatedVideoUrl: assetUrl, localPath: resultPath, mediaRole: 'output' }),
          });
        }
      }
    } else if (genStatus === 'fail') {
      const reason = (data.fail_reason as string) || '生成失败';
      updateTask(taskId, {
        status: 'failed',
        completedAt: Date.now(),
        error: reason,
      });

      // Clear generating state on node
      if (task?.nodeId) {
        const canvasStore = useCanvasStore.getState();
        canvasStore.updateNode(task.nodeId, { isGenerating: false });
      }
    }
    // genStatus === 'querying' — still running, do nothing
  } catch (err) {
    console.warn(`[BackgroundPoller] Failed to poll task ${taskId}:`, err);
  }
}

async function getDownloadDir(): Promise<string | null> {
  try {
    const workspace = await invoke<string>('ensure_workspace');
    return `${workspace}/videos`;
  } catch {
    try {
      const tmp = await invoke<string>('get_temp_dir');
      return `${tmp}/openclaw`;
    } catch {
      return null;
    }
  }
}
