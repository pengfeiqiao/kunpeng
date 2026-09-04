import type { ToolResult } from './types';

const PAID_TOOL_PATTERNS = [
  /^image_generate$/,
  /^video_generate$/,
  /^canvas_generate(?:_batch)?$/,
  /^workshop_generate(?:_audio)?$/,
  /(?:^|_)mg_/,
  /omni/i,
  /^doubao_speech_generate$/,
];

export interface PaidExecutionContext {
  runId?: string;
  idempotencyRunId?: string;
}

export type PaidSubmissionState = 'in_flight' | 'success' | 'submitted' | 'unknown' | 'not_submitted';

function cleanValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (Array.isArray(value)) return value.map((item) => cleanValue(item, seen));
  if (!value || typeof value !== 'object') return value;
  if (seen.has(value as object)) return '[circular]';
  seen.add(value as object);
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([key]) => key !== 'force')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => [key, cleanValue(item, seen)]),
  );
}

export function isPaidTool(name: string): boolean {
  return name.startsWith('custom-media:') || PAID_TOOL_PATTERNS.some((pattern) => pattern.test(name));
}

export function normalizedPaidCallKey(runId: string, name: string, params: Record<string, unknown>): string {
  return `${runId}\u0000${name}\u0000${JSON.stringify(cleanValue(params))}`;
}

export function classifyPaidSubmission(result: ToolResult): PaidSubmissionState {
  const text = `${result.error ?? ''}\n${result.output ?? ''}`;
  const hasConcreteTaskId = /task[_ -]?id["']?\s*[:=]\s*["']?[A-Za-z0-9_-]{4,}/i.test(text);
  const hasSubmittedStatus = /(?:status["']?\s*[:=]\s*["']?(?:submitted|processing|queued)|已提交|提交成功)/i.test(text);
  if (result.success) {
    return hasConcreteTaskId || hasSubmittedStatus
      ? 'submitted'
      : 'success';
  }
  if (hasConcreteTaskId || hasSubmittedStatus) return 'submitted';
  if (/validation|invalid|unauthorized|forbidden|余额不足|insufficient|before submission|提交前|missing required|required parameter/i.test(text)) {
    return 'not_submitted';
  }
  if (/timeout|timed out|network|connection reset|econnreset|状态不明|unknown|响应缺少.*(?:id|任务)/i.test(text)) {
    return 'unknown';
  }
  return 'not_submitted';
}

export class PaidToolIdempotencyGate {
  private readonly records = new Map<string, PaidSubmissionState>();

  /**
   * Atomically claim a paid call before execution. JavaScript is single
   * threaded between awaits, so recording the in-flight state here closes
   * the check-then-execute race between concurrent tool batches.
   */
  reserve(runId: string | undefined, name: string, params: Record<string, unknown>): string | null {
    if (!runId || !isPaidTool(name) || params.force === true) return null;
    const key = normalizedPaidCallKey(runId, name, params);
    const state = this.records.get(key);
    if (state && state !== 'not_submitted') return this.blockedMessage(name, state);
    this.records.set(key, 'in_flight');
    return null;
  }

  check(runId: string | undefined, name: string, params: Record<string, unknown>): string | null {
    if (!runId || !isPaidTool(name) || params.force === true) return null;
    const state = this.records.get(normalizedPaidCallKey(runId, name, params));
    if (!state || state === 'not_submitted') return null;
    return this.blockedMessage(name, state);
  }

  private blockedMessage(name: string, state: PaidSubmissionState): string {
    const status = state === 'in_flight'
      ? '正在执行'
      : state === 'unknown'
        ? '提交过但状态不明'
        : '提交成功';
    return `同参数的付费工具 ${name} 在本次任务中已经${status}，已阻止重复执行以避免重复扣费。如需重做，请说明修改点、改变参数，或显式传入 force:true。`;
  }

  record(runId: string | undefined, name: string, params: Record<string, unknown>, result: ToolResult): void {
    if (!runId || !isPaidTool(name) || params.force === true) return;
    const state = classifyPaidSubmission(result);
    const key = normalizedPaidCallKey(runId, name, params);
    if (state === 'not_submitted') this.records.delete(key);
    else this.records.set(key, state);
    if (this.records.size > 500) {
      for (const oldKey of [...this.records.keys()].slice(0, this.records.size - 400)) this.records.delete(oldKey);
    }
  }

  clearRun(runId: string): void {
    for (const key of this.records.keys()) {
      if (key.startsWith(`${runId}\u0000`)) this.records.delete(key);
    }
  }
}
