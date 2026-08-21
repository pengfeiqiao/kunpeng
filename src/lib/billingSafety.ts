/**
 * Signals that a paid submission may already exist remotely.
 *
 * A create request can reach the provider even when the client never receives
 * its response. Retrying that POST, compressing inputs and trying again, or
 * switching providers can therefore charge for multiple tasks. The product
 * policy below decides which workloads accept that risk and which must stop.
 */
export class PaidSubmissionUnknownError extends Error {
  readonly provider: string;

  constructor(provider: string, detail: string) {
    super(`${provider} 提交结果未知，可能已创建任务或产生扣费：${detail}`);
    this.name = 'PaidSubmissionUnknownError';
    this.provider = provider;
  }
}

/** A remote paid task exists; failures after this point must resume/query it. */
export class PaidTaskCreatedError extends Error {
  readonly provider: string;
  readonly taskId: string;

  constructor(
    provider: string,
    taskId: string,
    detail: string,
  ) {
    super(`${provider} 已创建任务 ${taskId}，但后续处理失败：${detail}`);
    this.name = 'PaidTaskCreatedError';
    this.provider = provider;
    this.taskId = taskId;
  }
}

export function mustNotAutoResubmit(error: unknown): boolean {
  if (error instanceof PaidSubmissionUnknownError || error instanceof PaidTaskCreatedError) return true;
  if (!(error instanceof Error)) return false;
  // RHTV keeps its provider-specific class to avoid a breaking public API.
  return error.name === 'RhtvSubmissionUnknownError'
    || error.name === 'PaidSubmissionUnknownError'
    || error.name === 'PaidTaskCreatedError';
}

export type PaidRetryWorkload = 'image' | 'omni' | 'kuaizi-speech' | 'kuaizi-video' | 'other';

/**
 * Product retry policy layered on top of the technical ambiguity signal.
 * Image generation, Omni and Kuaizi speech are intentionally allowed to trade
 * a small duplicate-charge risk for availability. Kuaizi Seedance video and
 * other paid video jobs remain conservative.
 */
export function shouldStopAutomaticPaidFallback(
  error: unknown,
  workload: PaidRetryWorkload,
): boolean {
  if (!mustNotAutoResubmit(error)) return false;
  return workload !== 'image' && workload !== 'omni' && workload !== 'kuaizi-speech';
}

/** User-facing explanation for expensive providers that must not be replayed. */
export function paidRetryStoppedMessage(error: unknown, provider = '该付费渠道'): string {
  const detail = error instanceof Error ? error.message : String(error);
  return `${detail}。为避免重复扣费，已停止自动重试；请先到${provider}后台核对原任务，再手动决定是否重试。`;
}

export function paidTaskId(error: unknown): string | undefined {
  return error instanceof PaidTaskCreatedError ? error.taskId : undefined;
}

/** 408/5xx can be emitted after an upstream accepted the create request. */
export function isAmbiguousPaidSubmitStatus(status: number): boolean {
  return status === 408 || status >= 500;
}
