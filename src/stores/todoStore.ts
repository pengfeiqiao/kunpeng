/**
 * Todo list store — per-session scratchpad for long-running tasks.
 *
 * The agent uses `todo_write` to create/update a plain checklist; the UI
 * renders it in a collapsed panel next to the chat. Designed so the agent
 * can maintain plan state across many turns without re-typing the full list
 * into every response.
 *
 * Persisted to localStorage (per session id) so an app restart or window
 * reload doesn't lose an in-flight plan; switching to a different chat
 * session still shows that session's own list. `dismissedSessions` stays
 * in-memory only — a dismissed panel reappearing after restart is harmless
 * (and it auto-redismisses on completion).
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type TodoStatus = 'pending' | 'in_progress' | 'completed';

export interface TodoItem {
  id: string;
  content: string;
  status: TodoStatus;
  activeForm?: string;
}

interface TodoState {
  // Keyed by session id so switching chats doesn't blow away active todos.
  todosBySession: Record<string, TodoItem[]>;
  /** Sessions the user has manually dismissed (all tasks completed). */
  dismissedSessions: Set<string>;
  setTodos: (sessionId: string, items: TodoItem[]) => void;
  clearSession: (sessionId: string) => void;
  dismissSession: (sessionId: string) => void;
}

export const useTodoStore = create<TodoState>()(
  persist(
    (set) => ({
      todosBySession: {},
      dismissedSessions: new Set(),
      setTodos: (sessionId, items) =>
        set((state) => {
          const dismissed = new Set(state.dismissedSessions);
          // Auto-undismiss when agent writes new todos
          dismissed.delete(sessionId);
          return {
            todosBySession: { ...state.todosBySession, [sessionId]: items },
            dismissedSessions: dismissed,
          };
        }),
      clearSession: (sessionId) =>
        set((state) => {
          const next = { ...state.todosBySession };
          delete next[sessionId];
          return { todosBySession: next };
        }),
      dismissSession: (sessionId) =>
        set((state) => {
          const dismissed = new Set(state.dismissedSessions);
          dismissed.add(sessionId);
          return { dismissedSessions: dismissed };
        }),
    }),
    {
      name: 'kunpeng.todos.v1',
      // Sets don't survive JSON serialization; only persist the todo lists.
      partialize: (state) => ({ todosBySession: state.todosBySession }),
    },
  ),
);
