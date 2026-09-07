import type { AssistantQueueItem } from '../workspace/projectAssistantQueue.ts';
import type { WorkshopData } from '../workshop/types.ts';
import { serializeWorkspaceAssistantMessage } from '../workspace/workspaceAssistantMessage.ts';
import { readWorkspaceMessage } from './workspaceMessage.ts';
import { authorizeWorkspaceDispatch, captureWorkspaceAuthority, workspaceAuthorityCurrent } from './workspaceDispatchPolicy.ts';
import { bindWorkspaceDispatchGuard } from './workspaceToolScope.ts';

export interface WorkspaceDispatchPort {
  read: () => { data: WorkshopData | null; activeProjectId: string | null; sessionId: string | null; items: readonly AssistantQueueItem[] };
  subscribe: (listener: () => void) => () => void;
}

/** The queue, not envelope prose, is the authority source. The binding lasts for exactly one run. */
export function bindWorkspaceDispatchSession(runId: string, content: string, port: WorkspaceDispatchPort): () => void {
  const envelope = readWorkspaceMessage(content);
  if (envelope.status === 'none') return () => {};
  const invalid = () => bindWorkspaceDispatchGuard(runId, () => '工作台请求缺少有效的冻结目标，工具未执行。');
  if (envelope.status !== 'valid') return invalid();
  const initial = port.read();
  const matches = initial.items.filter((item) => item.status === 'running'
    && serializeWorkspaceAssistantMessage(item.target, item.prompt) === content);
  const target = matches[0]?.target;
  if (matches.length !== 1 || !target || !initial.data || initial.activeProjectId !== target.projectId
    || (target.sessionId !== null && target.sessionId !== initial.sessionId)) return invalid();
  try {
    const authority = captureWorkspaceAuthority(target, initial.data, envelope.request);
    let valid = true;
    const current = () => {
      const state = port.read();
      return state.activeProjectId === authority.projectId && state.sessionId === initial.sessionId
        && workspaceAuthorityCurrent(authority, state.data);
    };
    const off = port.subscribe(() => { if (!current()) valid = false; });
    const release = bindWorkspaceDispatchGuard(runId, (name, params) => {
      if (!valid || !current()) return '工作台冻结目标或项目已变化，工具未执行；请重新发起任务。';
      return authorizeWorkspaceDispatch(authority, name, params, port.read().data!);
    });
    return () => { valid = false; off(); release(); };
  } catch { return invalid(); }
}
