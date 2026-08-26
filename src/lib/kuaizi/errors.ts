/**
 * 筷子（Kuaizi）OpenAPI 提交错误的付费安全分类（纯函数，便于单测）。
 *
 * 关键判断：HTTP 429 只在响应文本明确是「创建前拒绝」（余额门禁 /
 * 在途任务数上限）时才视为未扣费、允许渠道容灾；无法确认的 429 一律
 * 视为「可能已扣费」，停止自动重试（宁可不降级，也不重复扣费）。
 */
export type KuaiziSubmitErrorKind = 'rejected_safe' | 'ambiguous' | 'fatal';

/** 创建前拒绝（文档明确不扣费）的 429 文案特征 */
const SAFE_REJECTION_RE = /余额不足|insufficient|balance|超出最大任务数量|最大任务数量|在途任务|排队上限/i;

export function classifyKuaiziSubmitHttpError(status: number, detail: string): KuaiziSubmitErrorKind {
  if (status === 429) {
    return SAFE_REJECTION_RE.test(detail) ? 'rejected_safe' : 'ambiguous';
  }
  // 408/5xx 可能在上游已受理后返回（结果不明）
  if (status === 408 || status >= 500) return 'ambiguous';
  return 'fatal';
}
