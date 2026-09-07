import { mustNotAutoResubmit, PaidSubmissionUnknownError, shouldStopAutomaticPaidFallback } from '../billingSafety.ts';

/** New workspace requests opt out of the legacy image availability/retry trade-off. */
export function imageAttemptStopError(error: unknown, strict = false): unknown | null {
  if (strict) {
    if (error instanceof DOMException && error.name === 'AbortError') return error;
    if (mustNotAutoResubmit(error)) return error;
    // Some synchronous image channels do not expose their paid-boundary receipt.
    // Never guess that a generic error means the provider did not accept it.
    return new PaidSubmissionUnknownError('生图渠道', '本次请求未完成，需先确认原任务状态');
  }
  return shouldStopAutomaticPaidFallback(error, 'image') ? error : null;
}
