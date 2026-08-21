/**
 * schedule_cron / sleep — lightweight scheduling primitives.
 *
 * `sleep(ms)` is literally setTimeout — cheap, useful when the model needs
 * to pace polling or wait between steps. Capped at 10 min to prevent the
 * agent from hanging the user's session indefinitely.
 *
 * `schedule_cron(cron, prompt)` queues a prompt to be re-fed into the
 * current session at a future time. Implementation is intentionally minimal:
 * we store cron entries in a zustand store; a separate scheduler hook runs
 * in the background (see `useCronScheduler`) and checks once a minute whether
 * any entries are due. 7-day auto-expiry matches Claude Code's behavior.
 *
 * We don't persist across sessions — these are ephemeral. For durable
 * scheduled tasks, the user should configure a system cron or a background
 * task in Tauri's tray.
 */

import type { Tool } from '../types';
import { useCronStore } from '@/stores/cronStore';
import { useChatStore } from '@/stores/chatStore';

const MAX_SLEEP_MS = 10 * 60 * 1000;
const MAX_EXPIRY_DAYS = 7;

export const sleepTool: Tool = {
  definition: {
    name: 'sleep',
    description:
      '暂停执行指定毫秒数后继续。上限 10 分钟。' +
      '用于：轮询前等一会儿、给异步任务留时间完成。',
    parameters: {
      type: 'object',
      properties: {
        ms: { type: 'number', description: '暂停毫秒数（1-600000）' },
      },
      required: ['ms'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const raw = (params as { ms?: number }).ms;
    if (typeof raw !== 'number' || raw <= 0) {
      return { success: false, output: '', error: 'ms must be positive' };
    }
    const ms = Math.min(raw, MAX_SLEEP_MS);
    await new Promise((r) => setTimeout(r, ms));
    return { success: true, output: `slept ${ms}ms` };
  },
};

export const scheduleCronTool: Tool = {
  definition: {
    name: 'schedule_cron',
    description:
      '排程一个在未来时间点再次触发的 prompt（5 字段 cron，本地时区）。' +
      '支持 recurring=false 作为一次性提醒。自动 7 天后过期。' +
      '只在本次会话内生效 —— 重启鲲鹏后不再触发。',
    parameters: {
      type: 'object',
      properties: {
        cron: {
          type: 'string',
          description: '5 字段 cron 表达式 "分 时 日 月 周"。例: "0 9 * * *" 每天 9 点',
        },
        prompt: {
          type: 'string',
          description: '到点时送入当前会话的 prompt',
        },
        recurring: {
          type: 'boolean',
          description: 'true=周期触发, false=一次后自毁，默认 true',
        },
        reason: {
          type: 'string',
          description: '任务描述，显示给用户',
        },
      },
      required: ['cron', 'prompt'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const { cron, prompt, recurring, reason } = params as {
      cron?: string;
      prompt?: string;
      recurring?: boolean;
      reason?: string;
    };
    if (!cron || !/^(\S+\s+){4}\S+$/.test(cron.trim())) {
      return {
        success: false,
        output: '',
        error: 'cron must be 5 whitespace-separated fields',
      };
    }
    if (!prompt) {
      return { success: false, output: '', error: 'prompt required' };
    }
    const id = useCronStore.getState().add({
      cron: cron.trim(),
      prompt,
      recurring: recurring !== false,
      reason: reason ?? '',
      expiresAt: Date.now() + MAX_EXPIRY_DAYS * 24 * 3600 * 1000,
      // Bind to the session that scheduled it — the scheduler skips firing
      // while a different session is active, so the prompt never lands in an
      // unrelated conversation.
      sessionId: useChatStore.getState().currentSessionId || undefined,
    });
    return {
      success: true,
      output: `scheduled (id=${id}, recurring=${recurring !== false}, 7d expiry)`,
    };
  },
};
