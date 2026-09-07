/**
 * projectSessions — 项目对话隔离。
 *
 * 每个 AIGC 项目有自己的会话集（Session.projectId），三个抽屉
 * （工坊/画布/剪辑）发消息前确保切到项目会话，避免上下文污染；
 * 同一项目的对话跨视图共享。
 */
import { useChatStore } from '@/stores';
import { bindSessionToProjectRaw, createSessionRaw, loadSessionRaw } from '@/hooks/useSessions';
import type { Session } from '@/types';

const newProjectSessionGuards = new Map<string, () => Session>();

/** Explicit project creation only. Never reparent an existing conversation. */
export async function prepareNewProjectSession(
  projectId: string, projectName: string, assertCurrent: () => void, open: () => Promise<void>,
): Promise<string> {
  assertCurrent();
  const initial = useChatStore.getState();
  if (initial.isStreaming || initial.streamingPhase !== 'idle') {
    throw new Error('当前对话尚未空闲，创意尚未发送。请空闲后手动继续。');
  }
  if (newProjectSessionGuards.has(projectId)) throw new Error('此项目正在准备对话。');
  let sessionId: string | undefined;
  let valid = true;
  const checkSession = () => {
    const state = useChatStore.getState();
    const current = state.sessions.find((item) => item.id === state.currentSessionId);
    // createSessionRaw publishes its new session synchronously before its first await.
    if (!sessionId && current?.projectId === projectId && current.id !== initial.currentSessionId) sessionId = current.id;
    else if (state.currentSessionId !== (sessionId ?? initial.currentSessionId)) valid = false;
  };
  const verify = () => {
    assertCurrent();
    checkSession();
    const state = useChatStore.getState();
    const session = state.sessions.find((item) => item.id === sessionId);
    if (!valid || !session || state.currentSessionId !== sessionId || session.projectId !== projectId
      || state.isStreaming || state.streamingPhase !== 'idle') {
      throw new Error('项目会话已变化，创意尚未发送。请手动继续。');
    }
    return session;
  };
  const unsubscribe = useChatStore.subscribe(checkSession);
  newProjectSessionGuards.set(projectId, verify);
  try {
    const session = await createSessionRaw(`${projectName} · 对话1`, projectId);
    if (!session || session.id !== verify().id) throw new Error('项目对话尚未准备好，创意尚未发送。');
    await open();
    return verify().id;
  } finally {
    unsubscribe();
    newProjectSessionGuards.delete(projectId);
  }
}

/** 项目的所有会话，新→旧排序 */
export function listProjectSessions(projectId: string): Session[] {
  return useChatStore.getState().sessions
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt);
}

/**
 * 确保当前会话属于该项目：
 * - 已经属于当前项目：原样沿用；
 * - 当前已有任意对话：原地归入项目，保留全部上下文，不切换、不新建；
 * - 当前完全没有会话：才新建「项目名 · 对话1」。
 *
 * 流式中不切换项目会话；普通对话的原地归属不会打断流式状态。
 */
export async function ensureProjectSession(projectId: string, projectName: string): Promise<Session | null> {
  const creationGuard = newProjectSessionGuards.get(projectId);
  if (creationGuard) return creationGuard();
  const store = useChatStore.getState();
  const current = store.sessions.find((s) => s.id === store.currentSessionId);
  if (current?.projectId === projectId) return current;

  // 切换工作表面不是切换对话。即使当前会话原先属于另一个项目，
  // 也继续沿用并更新组织归属；真正切换项目对话只能由用户在抽屉
  // 的会话切换器中明确执行。
  if (current) {
    return bindSessionToProjectRaw(current.id, projectId);
  }

  if (store.isStreaming) return null;

  const existing = listProjectSessions(projectId);
  if (existing.length > 0) {
    const ok = await loadSessionRaw(existing[0].id);
    return ok ? existing[0] : null;
  }
  return createSessionRaw(`${projectName} · 对话1`, projectId);
}

/** 在项目下新建一个编号递增的对话并切换过去。 */
export async function createProjectSession(projectId: string, projectName: string): Promise<Session | null> {
  if (useChatStore.getState().isStreaming) return null;
  const n = listProjectSessions(projectId).length + 1;
  return createSessionRaw(`${projectName} · 对话${n}`, projectId);
}
