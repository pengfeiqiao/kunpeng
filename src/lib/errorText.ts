/**
 * errorText — 把任意 throw 值 / API 错误体格式化为可读文本。
 * 杜绝 UI 与日志出现 [object Object]：Error 取 message；对象递归提取
 * message/error/fail_reason/msg/reason/detail；其余 JSON.stringify 截断。
 */
export function errorText(value: unknown): string {
  if (value == null) return '';
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (typeof value === 'object') {
    const item = value as Record<string, unknown>;
    for (const key of ['message', 'error', 'fail_reason', 'msg', 'reason', 'detail', 'errorMessage']) {
      const nested = item[key];
      if (nested !== undefined && nested !== value) {
        const text = errorText(nested);
        if (text) return text;
      }
    }
    try {
      const json = JSON.stringify(value);
      return json && json !== '{}' ? json.slice(0, 300) : '';
    } catch { return ''; }
  }
  return String(value);
}
