export interface ProviderRouteAttempt {
  providerId: string;
  providerName: string;
  modelId?: string;
  status?: number;
  message: string;
}

function compactErrorMessage(message: string): string {
  const normalized = message.replace(/\s+/g, ' ').trim();
  return normalized.length > 240 ? `${normalized.slice(0, 237)}...` : normalized;
}

function attemptLabel(attempt: ProviderRouteAttempt): string {
  return attempt.modelId
    ? `${attempt.providerName}（${attempt.modelId}）`
    : attempt.providerName;
}

function attemptReason(attempt: ProviderRouteAttempt): string {
  return attempt.status !== undefined && attempt.status > 0
    ? `HTTP ${attempt.status}`
    : '网络连接失败';
}

export function formatProviderRouteFailure(attempts: ProviderRouteAttempt[]): string {
  if (attempts.length === 0) return '模型路由失败，未获得可用的错误信息。';
  if (attempts.length === 1) return attempts[0].message;

  const primary = attempts[0];
  const final = attempts[attempts.length - 1];
  const fallbackPath = attempts.slice(1).map((attempt) => attemptLabel(attempt)).join(' → ');
  return [
    `主路由 ${attemptLabel(primary)} 请求失败（${attemptReason(primary)}）`,
    `已按容灾设置切换至 ${fallbackPath}`,
    `备用路由仍失败（${attemptReason(final)}）：${compactErrorMessage(final.message)}`,
  ].join('；');
}

/** Error shown when the selected provider and one or more fallbacks all fail. */
export class ProviderRouteError extends Error {
  readonly attempts: ProviderRouteAttempt[];
  readonly status?: number;

  constructor(attempts: ProviderRouteAttempt[]) {
    super(formatProviderRouteFailure(attempts));
    this.name = 'ProviderRouteError';
    this.attempts = attempts;
    this.status = attempts[attempts.length - 1]?.status;
  }
}
