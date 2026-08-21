/**
 * Promise bridge between the agent and the decision-card UI.
 *
 * Requests are queued instead of overwriting the active question. Snoozing
 * keeps the tool promise alive so users can inspect the workspace and answer
 * later without losing the task.
 */

import { create } from 'zustand';
import type { ActiveView } from './chatStore';

export interface AskUserOption {
  id?: string;
  label: string;
  description?: string;
  recommended?: boolean;
  badge?: string;
  disabled?: boolean;
}

export interface AskUserQuestion {
  id?: string;
  question: string;
  header?: string;
  context?: string;
  options: AskUserOption[];
  multiSelect: boolean;
  allowCustom?: boolean;
  required?: boolean;
  defaultOptionId?: string;
  submitLabel?: string;
}

export interface AskUserAnswer {
  questionId?: string;
  selected: string[];
  selectedOptionIds?: string[];
  freeText?: string;
}

export interface AskUserRequest {
  id: string;
  questions: AskUserQuestion[];
  createdAt: number;
  sourceLabel?: string;
  sourceView: ActiveView;
  sourceSessionId: string | null;
}

interface PendingAsk extends AskUserRequest {
  resolve: (answers: AskUserAnswer[] | null) => void;
}

export interface AskUserRecord extends AskUserRequest {
  answers: AskUserAnswer[] | null;
  status: 'answered' | 'cancelled';
  resolvedAt: number;
}

interface AskMeta {
  sourceLabel?: string;
  sourceView: ActiveView;
  sourceSessionId: string | null;
}

interface AskUserState {
  pending: PendingAsk | null;
  queue: PendingAsk[];
  history: AskUserRecord[];
  snoozed: boolean;
  ask: (questions: AskUserQuestion[], meta: AskMeta) => Promise<AskUserAnswer[] | null>;
  submit: (answers: AskUserAnswer[] | null) => void;
  snooze: () => void;
  resume: () => void;
}

function requestId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `ask-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const useAskUserStore = create<AskUserState>((set, get) => ({
  pending: null,
  queue: [],
  history: [],
  snoozed: false,

  ask: (questions, meta) => new Promise<AskUserAnswer[] | null>((resolve) => {
    const request: PendingAsk = {
      id: requestId(),
      questions,
      resolve,
      createdAt: Date.now(),
      sourceLabel: meta.sourceLabel,
      sourceView: meta.sourceView,
      sourceSessionId: meta.sourceSessionId,
    };
    set((state) => state.pending
      ? { queue: [...state.queue, request] }
      : { pending: request, snoozed: false });
  }),

  submit: (answers) => {
    const { pending, queue, history } = get();
    if (!pending) return;
    pending.resolve(answers);
    const [next, ...rest] = queue;
    const { resolve: _resolve, ...request } = pending;
    const record: AskUserRecord = {
      ...request,
      answers,
      status: answers ? 'answered' : 'cancelled',
      resolvedAt: Date.now(),
    };
    set({
      pending: next ?? null,
      queue: rest,
      history: [...history, record].slice(-40),
      snoozed: false,
    });
  },

  snooze: () => {
    if (get().pending) set({ snoozed: true });
  },

  resume: () => {
    if (get().pending) set({ snoozed: false });
  },
}));
