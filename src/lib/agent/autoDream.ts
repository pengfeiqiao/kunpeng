import type { GenerationLogEntry } from '../aigc/genLogger';
import { getRecentGenerations } from '../aigc/genLogger';
import { readTextFile, writeTextFile, BaseDirectory } from '@tauri-apps/api/fs';

export interface ConsolidationResult {
  analyzedCount: number;
  templatesImproved: number;
  templatesDeprecated: number;
  patternsExtracted: string[];
  timestamp: string;
}

/**
 * Run consolidation analysis on recent generation logs.
 * Groups by (director × engine), extracts high/low patterns.
 */
export async function runConsolidation(): Promise<ConsolidationResult> {
  const result: ConsolidationResult = {
    analyzedCount: 0,
    templatesImproved: 0,
    templatesDeprecated: 0,
    patternsExtracted: [],
    timestamp: new Date().toISOString(),
  };

  try {
    const logs = await getRecentGenerations(50);
    const reviewed = logs.filter((l) => l.userFeedback);
    const failed = logs.filter((l) => l.failureReason || l.validation?.passed === false);
    result.analyzedCount = reviewed.length + failed.length;

    if (reviewed.length < 3 && failed.length < 3) {
      result.patternsExtracted.push('Not enough data (need 3+ reviewed or failed generations)');
      return result;
    }

    // Group by (director × engine)
    const groups = new Map<string, GenerationLogEntry[]>();
    for (const entry of reviewed) {
      const key = `${entry.director}|${entry.engine}`;
      const group = groups.get(key) || [];
      group.push(entry);
      groups.set(key, group);
    }

    for (const [key, group] of groups) {
      const goodCount = group.filter((g) => g.userFeedback === 'good').length;
      const badCount = group.filter((g) => g.userFeedback === 'bad').length;
      const total = group.length;

      if (goodCount / total >= 0.6 && total >= 3) {
        result.templatesImproved++;
        result.patternsExtracted.push(`${key}: high-score pattern (${goodCount}/${total} good)`);
      }
      if (badCount / total >= 0.5 && total >= 3) {
        result.templatesDeprecated++;
        result.patternsExtracted.push(`${key}: low-score pattern (${badCount}/${total} bad — consider deprecating)`);
      }
    }

    const validationFailures = failed.filter((entry) => entry.validation?.passed === false);
    if (validationFailures.length > 0) {
      result.patternsExtracted.push(`quality-gate: ${validationFailures.length} generation(s) blocked by validation`);
      const reasonCounts = new Map<string, number>();
      for (const entry of validationFailures) {
        for (const err of entry.validation?.errors ?? []) {
          const count = reasonCounts.get(err) ?? 0;
          reasonCounts.set(err, count + 1);
        }
      }
      for (const [reason, count] of [...reasonCounts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)) {
        result.patternsExtracted.push(`quality-gate top issue (${count}): ${reason}`);
      }
    }

    const runtimeFailures = failed.filter((entry) => entry.failureReason && entry.validation?.passed !== false);
    if (runtimeFailures.length > 0) {
      result.patternsExtracted.push(`runtime-failure: ${runtimeFailures.length} generation(s) failed after submission`);
    }

    // Write consolidation report to generation-log/
    const ym = new Date().toISOString().slice(0, 7);
    const reportPath = `.kunpeng/aigc-memory/generation-log/consolidation-${ym}.jsonl`;
    const line = JSON.stringify(result) + '\n';
    let existing = '';
    try {
      existing = await readTextFile(reportPath, { dir: BaseDirectory.Home });
    } catch { /* new file */ }
    await writeTextFile(reportPath, existing + line, { dir: BaseDirectory.Home });

  } catch (err) {
    console.warn('[autoDream] Consolidation failed:', err);
  }

  return result;
}

/**
 * Check whether consolidation should run.
 * Returns true when: idle time > 5min AND unreviewed log count > 20
 */
export function shouldRunConsolidation(lastActiveTime: number): boolean {
  const idleMs = Date.now() - lastActiveTime;
  const idleMinutes = idleMs / 60000;
  return idleMinutes > 5;
}
