/**
 * Agent lifecycle hooks.
 *
 * Borrowed shape from CC-Study's `SessionStart/SubagentStop/PreToolUse/
 * PostToolUse`. Hooks are plain async functions registered at app startup;
 * the coordinator fires them at well-defined points.
 *
 * Why this matters for kunpeng:
 *   - PreToolUse is a natural home for toolConfirmStore prompts (replacing
 *     ad-hoc confirms scattered across tools).
 *   - PostToolUse lets us auto-format / lint / send notifications without
 *     hard-coding those side effects into each tool.
 *   - SessionStart is where we'd eventually load `.kunpeng/hooks/*.sh`
 *     user scripts (deferred; the bus is in place so we can wire shell
 *     execution later without touching the coordinator).
 *   - SubagentStop fires when agentTool's sub-coordinator finishes, useful
 *     for OS notification ("子 agent 完成: 3 files edited").
 *
 * Hooks are best-effort: an individual hook throwing must not crash the
 * coordinator. We log and continue. PreToolUse is the one exception — if
 * it returns `{cancel: true}`, the tool call is aborted (for user confirms).
 */

import { agentLog } from './logger.ts';

export interface PreToolUseEvent {
  toolName: string;
  params: Record<string, unknown>;
  sessionId?: string;
}

export interface PostToolUseEvent {
  toolName: string;
  params: Record<string, unknown>;
  result: unknown;
  durationMs: number;
  sessionId?: string;
}

export interface SessionStartEvent {
  sessionId: string;
  cwd: string;
  agentId?: string;
}

export interface SubagentStopEvent {
  agentId: string;
  parentSessionId?: string;
  durationMs: number;
  summary?: string;
}

export type PreToolUseHook = (ev: PreToolUseEvent) => Promise<{ cancel?: boolean; reason?: string } | void>;
export type PostToolUseHook = (ev: PostToolUseEvent) => Promise<void>;
export type SessionStartHook = (ev: SessionStartEvent) => Promise<void>;
export type SubagentStopHook = (ev: SubagentStopEvent) => Promise<void>;

interface Registry {
  preToolUse: PreToolUseHook[];
  postToolUse: PostToolUseHook[];
  sessionStart: SessionStartHook[];
  subagentStop: SubagentStopHook[];
}

const registry: Registry = {
  preToolUse: [],
  postToolUse: [],
  sessionStart: [],
  subagentStop: [],
};

export function registerHook<K extends keyof Registry>(
  event: K,
  hook: Registry[K][number],
): () => void {
  (registry[event] as unknown[]).push(hook);
  return () => {
    const arr = registry[event] as unknown[];
    const idx = arr.indexOf(hook);
    if (idx >= 0) arr.splice(idx, 1);
  };
}

/** Clear all hooks — for tests and hot-reload. */
export function _clearHooksForTests(): void {
  registry.preToolUse = [];
  registry.postToolUse = [];
  registry.sessionStart = [];
  registry.subagentStop = [];
}

/**
 * Fire PreToolUse. If any hook returns `{cancel: true}` we short-circuit and
 * return `{cancel: true, reason}` so the coordinator can skip the tool call.
 */
export async function firePreToolUse(ev: PreToolUseEvent): Promise<{ cancel: boolean; reason?: string }> {
  for (const hook of registry.preToolUse) {
    try {
      const res = await hook(ev);
      if (res?.cancel) return { cancel: true, reason: res.reason };
    } catch (err) {
      agentLog.warn('hooks', `preToolUse hook threw (continuing)`, err);
    }
  }
  return { cancel: false };
}

export async function firePostToolUse(ev: PostToolUseEvent): Promise<void> {
  for (const hook of registry.postToolUse) {
    try {
      await hook(ev);
    } catch (err) {
      agentLog.warn('hooks', `postToolUse hook threw (continuing)`, err);
    }
  }
}

export async function fireSessionStart(ev: SessionStartEvent): Promise<void> {
  for (const hook of registry.sessionStart) {
    try {
      await hook(ev);
    } catch (err) {
      agentLog.warn('hooks', `sessionStart hook threw (continuing)`, err);
    }
  }
}

export async function fireSubagentStop(ev: SubagentStopEvent): Promise<void> {
  for (const hook of registry.subagentStop) {
    try {
      await hook(ev);
    } catch (err) {
      agentLog.warn('hooks', `subagentStop hook threw (continuing)`, err);
    }
  }
}
