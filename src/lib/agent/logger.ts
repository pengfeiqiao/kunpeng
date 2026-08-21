/**
 * Agent 日志服务
 * 内存环形缓冲，最多 500 条，支持 subscribe 实时更新 UI
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  ts: number;
  level: LogLevel;
  tag: string;
  message: string;
  data?: unknown;
}

const MAX_ENTRIES = 500;
let entries: LogEntry[] = [];
const listeners = new Set<() => void>();

function append(level: LogLevel, tag: string, message: string, data?: unknown) {
  entries.push({ ts: Date.now(), level, tag, message, data });
  if (entries.length > MAX_ENTRIES) {
    entries = entries.slice(-MAX_ENTRIES);
  }
  // Mirror to console for DevTools
  const fn = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  fn(`[${tag}] ${message}`, ...(data !== undefined ? [data] : []));
  listeners.forEach((fn) => fn());
}

export const agentLog = {
  debug: (tag: string, msg: string, data?: unknown) => append('debug', tag, msg, data),
  info:  (tag: string, msg: string, data?: unknown) => append('info', tag, msg, data),
  warn:  (tag: string, msg: string, data?: unknown) => append('warn', tag, msg, data),
  error: (tag: string, msg: string, data?: unknown) => append('error', tag, msg, data),

  getEntries: (): readonly LogEntry[] => entries,
  subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; },
  clear: () => { entries = []; listeners.forEach((fn) => fn()); },
};
