/**
 * TodoPanel — renders the per-session todo list maintained by the `todo_write`
 * tool. Collapsed by default when empty; expands to show the agent's current
 * plan. Meant to sit in the chat side panel or above the input.
 *
 * Read-only surface: users don't edit todos from here — the agent writes
 * them. If the list is empty for the active session, renders nothing.
 */

import { Circle, CircleDot, CheckCircle2, X } from 'lucide-react';
import { useTodoStore, type TodoItem } from '@/stores/todoStore';
import { useChatStore } from '@/stores/chatStore';

function StatusIcon({ status }: { status: TodoItem['status'] }) {
  if (status === 'completed') return <CheckCircle2 size={14} className="text-emerald-400" />;
  if (status === 'in_progress') return <CircleDot size={14} className="text-indigo-400 animate-pulse" />;
  return <Circle size={14} className="text-gray-500" />;
}

export function TodoPanel() {
  const sessionId = useChatStore((s) => s.currentSessionId);
  const items = useTodoStore((s) => (sessionId ? s.todosBySession[sessionId] : undefined));
  const dismissed = useTodoStore((s) => sessionId ? s.dismissedSessions.has(sessionId) : false);
  const dismissSession = useTodoStore((s) => s.dismissSession);

  if (!sessionId || !items || items.length === 0 || dismissed) return null;

  const remaining = items.filter((t) => t.status !== 'completed').length;

  return (
    <div className="mx-3 my-2 rounded-xl border border-white/[0.06] bg-white/[0.02] overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-white/[0.04]">
        <span className="text-[11px] font-mono uppercase tracking-wide text-gray-400">任务清单</span>
        <span className="text-[11px] text-gray-500">
          {items.length - remaining}/{items.length}
        </span>
        {remaining === 0 && (
          <button
            onClick={() => dismissSession(sessionId)}
            className="ml-auto p-0.5 rounded hover:bg-white/[0.06] text-gray-500 hover:text-gray-300 transition-colors"
            title="隐藏任务清单"
          >
            <X size={12} />
          </button>
        )}
      </div>
      <ul className="py-1">
        {items.map((item) => (
          <li
            key={item.id}
            className="flex items-start gap-2 px-3 py-1.5 text-[12.5px]"
          >
            <span className="mt-0.5 flex-shrink-0"><StatusIcon status={item.status} /></span>
            <span
              className={
                item.status === 'completed'
                  ? 'text-gray-500 line-through'
                  : item.status === 'in_progress'
                  ? 'text-gray-100'
                  : 'text-gray-300'
              }
            >
              {item.status === 'in_progress' && item.activeForm ? item.activeForm : item.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
