import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import { formatToolBatchLabel, formatToolSummary } from '@/lib/agent/toolSummary';
import {
  createToolPresentation,
  normalizeRunProgress,
  type RunProgressKind,
  type RunProgressStatus,
  type ToolActionPresentation,
} from '@/lib/agent/runStepPresentation';
import { resolveStepNoteTargetRunId } from './runTargeting';

export type RunStepStatus = 'pending' | 'active' | 'done' | 'failed' | 'skipped';
export type RunStatus = 'running' | 'done' | 'failed' | 'aborted';
export type RunToolStatus = 'running' | 'done' | 'failed';
export type SubAgentStatus = 'running' | 'completed' | 'failed';
export type SubTaskKind = 'context' | 'generation' | 'review';

export interface RunToolCall {
  id: string;
  name: string;
  summary: string;
  status: RunToolStatus;
  startedAt: number;
  endedAt?: number;
  resultSummary?: string;
  display?: ToolActionPresentation;
}

export interface RunSubAgent {
  id: string;
  taskId?: string;
  title: string;
  task: string;
  kind?: SubTaskKind;
  mode: 'sync' | 'async';
  status: SubAgentStatus;
  startedAt: number;
  endedAt?: number;
  outputSummary?: string;
  error?: string;
}

export interface RunStep {
  id: string;
  title: string;
  status: RunStepStatus;
  detail?: string;
  source: 'todo' | 'tool' | 'system' | 'subagent';
  startedAt?: number;
  endedAt?: number;
  toolCalls: RunToolCall[];
  subAgents: RunSubAgent[];
}

export interface RunProgressUpdate {
  id: string;
  text: string;
  createdAt: number;
  kind?: RunProgressKind;
  status?: RunProgressStatus;
}

export interface RunSession {
  id: string;
  sessionId: string;
  userRequest: string;
  modelProvider?: string;
  modelId?: string;
  status: RunStatus;
  steps: RunStep[];
  progressUpdates: RunProgressUpdate[];
  startedAt: number;
  endedAt?: number;
}

interface RunStepState {
  currentRunId: string | null;
  runsById: Record<string, RunSession>;
  runIdsBySession: Record<string, string[]>;
  startRun: (args: {
    sessionId: string;
    userRequest: string;
    modelProvider?: string;
    modelId?: string;
  }) => string;
  finishRun: (status: RunStatus, runId?: string) => void;
  addProgressUpdate: (text: string, runId?: string) => void;
  upsertProgressUpdate: (key: string, text: string, runId?: string) => void;
  beginToolBatch: (calls: Array<{ name: string; params: Record<string, unknown> }>, runId?: string) => string | null;
  finishToolBatch: (results: Array<{ name: string; success: boolean }>, runId?: string) => void;
  syncTodos: (sessionId: string, todos: Array<{ content: string; status: string; activeForm?: string }>) => void;
  ensureSystemStep: (title: string, detail?: string, runId?: string) => string | null;
  startTool: (name: string, params: Record<string, unknown>, runId?: string) => string | null;
  finishTool: (toolId: string | null, success: boolean, result?: { output?: string; error?: string }, runId?: string) => void;
  startSubAgent: (args: { taskId?: string; task: string; async?: boolean; kind?: SubTaskKind }) => string | null;
  finishSubAgent: (idOrTaskId: string, status: Exclude<SubAgentStatus, 'running'>, output?: string, error?: string) => void;
  appendStepNote: (detail: string, toolName?: string) => void;
  clearSession: (sessionId: string) => void;
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeJson(value: unknown, max = 140): string {
  try {
    const text = JSON.stringify(value);
    return text.length > max ? `${text.slice(0, max)}...` : text;
  } catch {
    return String(value).slice(0, max);
  }
}

function summarizeResult(result?: { output?: string; error?: string }, max = 220): string | undefined {
  const text = result?.error || result?.output;
  if (!text) return undefined;
  return text.length > max ? `${text.slice(0, max)}...` : text;
}

function inferSubTaskKind(task: string): SubTaskKind {
  const text = task.toLowerCase();
  if (/(检查|校验|验证|审查|质检|review|validate|lint|风险|问题|修正|红线)/i.test(text)) return 'review';
  if (/(读取|查找|搜索|整理|分析|归纳|上下文|资料|文件|memory|skill|context|inspect|summarize)/i.test(text)) return 'context';
  return 'generation';
}

function subTaskKindLabel(kind?: SubTaskKind): string {
  const map: Record<SubTaskKind, string> = {
    context: '整理上下文',
    generation: '生成草案',
    review: '检查修正',
  };
  return map[kind ?? 'generation'];
}

function friendlyToolStepTitle(name: string): string {
  const map: Record<string, string> = {
    bash: '执行命令',
    read_file: '读取文件',
    write_file: '写入文件',
    edit_file: '修改文件',
    grep_search: '搜索内容',
    glob_search: '查找文件',
    web_search: '联网搜索',
    web_fetch: '读取网页',
    browser_control: '操控浏览器',
    todo_write: '更新执行计划',
    canvas_get_state: '读取画布状态',
    canvas_add_node: '创建画布节点',
    canvas_update_node: '更新画布节点',
    canvas_generate: '生成画布资产',
    canvas_auto_layout: '整理画布布局',
    workshop_get_state: '读取工坊状态',
    workshop_read_source: '读取工坊源文件',
    workshop_set_breakdown: '写入剧本拆解',
    workshop_set_shots: '更新分镜表',
    workshop_set_prompts: '写入生成提示词',
    workshop_generate: '提交工坊生成',
    timeline_analyze_reference_video: 'Kimi 拉片分析',
    timeline_kimi_edit_plan: 'Kimi 生成剪辑计划',
    timeline_kimi_review: 'Kimi 复盘成片',
    timeline_export_analyze: '分析导出方式',
    timeline_render_graph: '诊断渲染图',
    timeline_export_prepare: '准备导出',
    timeline_export_video: '导出成片',
    timeline_export_status: '查看导出进度',
    timeline_export_stop: '停止导出',
    timeline_export_retry: '重试导出',
    timeline_render_cache_status: '检查渲染缓存',
    timeline_render_debug_tail: '查看渲染诊断',
    timeline_render_cache_clear: '清理渲染缓存',
    timeline_proxy_prepare: '准备代理文件',
  };
  return map[name] || `执行 ${name}`;
}

function updateCurrentRun(
  state: RunStepState,
  updater: (run: RunSession) => RunSession,
  targetRunId?: string,
): Partial<RunStepState> {
  const runId = targetRunId ?? state.currentRunId;
  if (!runId) return {};
  const run = state.runsById[runId];
  if (!run || run.status !== 'running') return {};
  return {
    runsById: {
      ...state.runsById,
      [runId]: updater(run),
    },
  };
}

function findActiveStepIndex(steps: RunStep[]): number {
  return steps.findIndex((s) => s.status === 'active');
}

function activateStep(step: RunStep): RunStep {
  return {
    ...step,
    status: 'active',
    startedAt: step.startedAt ?? Date.now(),
  };
}

type PersistedRunStepState = Pick<RunStepState, 'runsById' | 'runIdsBySession'>;

function compactPersistedRuns(state: PersistedRunStepState): PersistedRunStepState {
  const runIdsBySession: Record<string, string[]> = {};
  const retained = new Set<string>();

  for (const [sessionId, ids] of Object.entries(state.runIdsBySession)) {
    const limited = ids.slice(0, 6);
    if (limited.length) runIdsBySession[sessionId] = limited;
    limited.forEach((id) => retained.add(id));
  }

  const newestIds = [...retained]
    .sort((a, b) => (state.runsById[b]?.startedAt ?? 0) - (state.runsById[a]?.startedAt ?? 0))
    .slice(0, 60);
  const allowed = new Set(newestIds);
  const runsById: Record<string, RunSession> = {};

  for (const id of newestIds) {
    const run = state.runsById[id];
    if (!run) continue;
    runsById[id] = {
      ...run,
      userRequest: run.userRequest.slice(0, 2_000),
      progressUpdates: (run.progressUpdates ?? []).slice(-24),
      steps: run.steps.slice(-30).map((step) => ({
        ...step,
        detail: step.detail?.slice(0, 1_600),
        toolCalls: step.toolCalls.slice(-12),
        subAgents: step.subAgents.slice(-8).map((subAgent) => ({
          ...subAgent,
          task: subAgent.task.slice(0, 800),
          outputSummary: subAgent.outputSummary?.slice(0, 400),
          error: subAgent.error?.slice(0, 400),
        })),
      })),
    };
  }

  for (const [sessionId, ids] of Object.entries(runIdsBySession)) {
    runIdsBySession[sessionId] = ids.filter((id) => allowed.has(id) && Boolean(runsById[id]));
    if (!runIdsBySession[sessionId].length) delete runIdsBySession[sessionId];
  }

  return { runsById, runIdsBySession };
}

function revivePersistedRuns(persisted: unknown): PersistedRunStepState {
  const raw = persisted as Partial<PersistedRunStepState> | undefined;
  const runsById: Record<string, RunSession> = {};
  for (const [id, run] of Object.entries(raw?.runsById ?? {})) {
    runsById[id] = run.status === 'running'
      ? {
          ...run,
          progressUpdates: run.progressUpdates ?? [],
          status: 'aborted',
          endedAt: run.endedAt ?? Date.now(),
          steps: run.steps.map((step) =>
            step.status === 'active'
              ? { ...step, status: 'skipped', endedAt: step.endedAt ?? Date.now() }
              : step,
          ),
        }
      : { ...run, progressUpdates: run.progressUpdates ?? [] };
  }
  return {
    runsById,
    runIdsBySession: raw?.runIdsBySession ?? {},
  };
}

function createDeferredRunStorage(delayMs = 900): PersistStorage<PersistedRunStepState> {
  let pending: { name: string; value: StorageValue<PersistedRunStepState> } | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = () => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    const current = pending;
    pending = null;
    if (!current) return;
    const compacted: StorageValue<PersistedRunStepState> = {
      ...current.value,
      state: compactPersistedRuns(current.value.state),
    };
    safeLocalStorage.setItem(current.name, JSON.stringify(compacted));
  };

  if (typeof window !== 'undefined') {
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }

  return {
    getItem(name) {
      if (pending?.name === name) return pending.value;
      const raw = safeLocalStorage.getItem(name);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StorageValue<PersistedRunStepState>;
      } catch {
        safeLocalStorage.removeItem(name);
        return null;
      }
    },
    setItem(name, value) {
      pending = { name, value };
      if (timer) clearTimeout(timer);
      timer = setTimeout(flush, delayMs);
    },
    removeItem(name) {
      if (pending?.name === name) pending = null;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      safeLocalStorage.removeItem(name);
    },
  };
}

const deferredRunStorage = createDeferredRunStorage();

export const useRunStepStore = create<RunStepState>()(persist((set, get) => ({
  currentRunId: null,
  runsById: {},
  runIdsBySession: {},

  startRun: ({ sessionId, userRequest, modelProvider, modelId }) => {
    const id = makeId('run');
    const run: RunSession = {
      id,
      sessionId,
      userRequest,
      modelProvider,
      modelId,
      status: 'running',
      steps: [],
      progressUpdates: [],
      startedAt: Date.now(),
    };
    set((state) => ({
      currentRunId: id,
      runsById: { ...state.runsById, [id]: run },
      runIdsBySession: {
        ...state.runIdsBySession,
        [sessionId]: [id, ...(state.runIdsBySession[sessionId] ?? [])].slice(0, 20),
      },
    }));
    return id;
  },

  finishRun: (status, runId) =>
    set((state) => updateCurrentRun(state, (run) => ({
      ...run,
      status,
      endedAt: Date.now(),
      steps: run.steps.map((step) =>
        step.status === 'active'
          ? { ...step, status: status === 'failed' ? 'failed' : status === 'aborted' ? 'skipped' : 'done', endedAt: Date.now() }
          : step,
      ),
    }), runId)),

  addProgressUpdate: (text, runId) => {
    const normalized = normalizeRunProgress(text);
    if (!normalized) return;
    set((state) => updateCurrentRun(state, (run) => {
      const updates = run.progressUpdates ?? [];
      if (updates.slice(-8).some((update) => update.kind === normalized.kind && update.text === normalized.text)) return run;
      return {
        ...run,
        progressUpdates: [
          ...updates,
          { id: makeId('progress'), ...normalized, createdAt: Date.now() },
        ],
      };
    }, runId));
  },

  upsertProgressUpdate: (key, text, runId) => {
    const normalized = normalizeRunProgress(text);
    if (!normalized || !key.trim()) return;
    const id = `progress-live-${key.replace(/[^a-zA-Z0-9_-]/g, '-')}`;
    set((state) => updateCurrentRun(state, (run) => {
      const updates = run.progressUpdates ?? [];
      const index = updates.findIndex((update) => update.id === id);
      if (index < 0) {
        return {
          ...run,
          progressUpdates: [...updates, { id, ...normalized, createdAt: Date.now() }],
        };
      }
      if (updates[index].text === normalized.text && updates[index].status === normalized.status) return run;
      const next = [...updates];
      next[index] = { ...next[index], ...normalized, createdAt: Date.now() };
      return { ...run, progressUpdates: next };
    }, runId));
  },

  beginToolBatch: (calls, runId) => {
    if (!calls.length) return null;
    const id = makeId('step');
    set((state) => updateCurrentRun(state, (run) => {
      const activeIndex = findActiveStepIndex(run.steps);
      if (activeIndex >= 0 && run.steps[activeIndex].source === 'todo') return run;
      const steps = run.steps.map((step) => step.status === 'active'
        ? { ...step, status: 'done' as const, endedAt: Date.now() }
        : step);
      steps.push({
        id,
        title: formatToolBatchLabel(calls),
        status: 'active',
        source: 'tool',
        startedAt: Date.now(),
        toolCalls: [],
        subAgents: [],
      });
      return { ...run, steps };
    }, runId));
    return (runId ?? get().currentRunId) ? id : null;
  },

  finishToolBatch: (results, runId) => {
    if (!results.length) return;
    set((state) => updateCurrentRun(state, (run) => {
      const index = findActiveStepIndex(run.steps);
      if (index < 0) return run;
      const steps = [...run.steps];
      const step = steps[index];
      const failed = results.some((result) => !result.success);
      if (step.source === 'todo') {
        steps[index] = failed
          ? { ...step, detail: '有一步未完成，正在调整处理方式。' }
          : step;
      } else {
        steps[index] = {
          ...step,
          status: failed ? 'failed' : 'done',
          detail: failed ? '后续会根据错误信息调整处理方式。' : step.detail,
          endedAt: Date.now(),
        };
      }
      return { ...run, steps };
    }, runId));
  },

  syncTodos: (sessionId, todos) =>
    set((state) => updateCurrentRun(state, (run) => {
      if (run.sessionId !== sessionId) return run;
      const existing = new Map(run.steps.filter((s) => s.source === 'todo').map((s) => [s.title, s]));
      const todoSteps = todos.map((todo, index): RunStep => {
        const old = existing.get(todo.content);
        const status: RunStepStatus =
          todo.status === 'completed' ? 'done' :
          todo.status === 'in_progress' ? 'active' :
          'pending';
        return {
          id: old?.id ?? `todo-${index}-${Math.random().toString(36).slice(2, 7)}`,
          title: todo.content,
          status,
          detail: todo.activeForm,
          source: 'todo',
          startedAt: status === 'active' ? (old?.startedAt ?? Date.now()) : old?.startedAt,
          endedAt: status === 'done' ? (old?.endedAt ?? Date.now()) : undefined,
          toolCalls: old?.toolCalls ?? [],
          subAgents: old?.subAgents ?? [],
        };
      });
      const nonTodo = run.steps.filter((s) => s.source !== 'todo');
      return { ...run, steps: [...todoSteps, ...nonTodo] };
    })),

  ensureSystemStep: (title, detail, runId) => {
    const id = makeId('step');
    set((state) => updateCurrentRun(state, (run) => {
      const last = run.steps[run.steps.length - 1];
      if (last?.source === 'system' && last.title === title && last.status === 'active') {
        return { ...run, steps: run.steps.map((step) => step.id === last.id ? { ...step, detail: detail ?? step.detail } : step) };
      }
      return {
        ...run,
        steps: [
          ...run.steps.map((s) => s.status === 'active' ? { ...s, status: 'done' as const, endedAt: Date.now() } : s),
          {
            id,
            title,
            status: 'active' as const,
            detail,
            source: 'system' as const,
            startedAt: Date.now(),
            toolCalls: [],
            subAgents: [],
          },
        ],
      };
    }, runId));
    return (runId ?? get().currentRunId) ? id : null;
  },

  startTool: (name, params, runId) => {
    const toolId = makeId('tool');
    set((state) => updateCurrentRun(state, (run) => {
      let steps = [...run.steps];
      let idx = findActiveStepIndex(steps);
      if (idx < 0) {
        steps.push({
          id: makeId('step'),
          title: friendlyToolStepTitle(name),
          status: 'active',
          source: 'tool',
          startedAt: Date.now(),
          toolCalls: [],
          subAgents: [],
        });
        idx = steps.length - 1;
      } else if (steps[idx].source === 'todo' && name !== 'todo_write') {
        steps[idx] = activateStep(steps[idx]);
      }
      const call: RunToolCall = {
        id: toolId,
        name,
        summary: formatToolSummary(name, params),
        display: createToolPresentation(name, params),
        status: 'running',
        startedAt: Date.now(),
      };
      steps[idx] = { ...steps[idx], toolCalls: [...steps[idx].toolCalls, call] };
      return { ...run, steps };
    }, runId));
    return (runId ?? get().currentRunId) ? toolId : null;
  },

  finishTool: (toolId, success, result, runId) => {
    if (!toolId) return;
    set((state) => updateCurrentRun(state, (run) => ({
      ...run,
      steps: run.steps.map((step) => ({
        ...step,
        toolCalls: step.toolCalls.map((call) =>
          call.id === toolId
            ? {
                ...call,
                status: success ? 'done' : 'failed',
                endedAt: Date.now(),
                resultSummary: summarizeResult(result),
              }
            : call,
        ),
      })),
    }), runId));
  },

  startSubAgent: ({ taskId, task, async, kind }) => {
    const id = taskId || makeId('subagent');
    const subTaskKind = kind ?? inferSubTaskKind(task);
    set((state) => updateCurrentRun(state, (run) => {
      let steps = [...run.steps];
      let idx = findActiveStepIndex(steps);
      if (idx < 0) {
        steps.push({
          id: makeId('step'),
          title: subTaskKindLabel(subTaskKind),
          status: 'active',
          source: 'subagent',
          startedAt: Date.now(),
          toolCalls: [],
          subAgents: [],
        });
        idx = steps.length - 1;
      }
      const sub: RunSubAgent = {
        id,
        taskId,
        title: task.split('\n')[0].slice(0, 80) || subTaskKindLabel(subTaskKind),
        task,
        kind: subTaskKind,
        mode: async ? 'async' : 'sync',
        status: 'running',
        startedAt: Date.now(),
      };
      steps[idx] = { ...steps[idx], subAgents: [...steps[idx].subAgents, sub] };
      return { ...run, steps };
    }));
    return get().currentRunId ? id : null;
  },

  finishSubAgent: (idOrTaskId, status, output, error) =>
    set((state) => updateCurrentRun(state, (run) => ({
      ...run,
      steps: run.steps.map((step) => ({
        ...step,
        subAgents: step.subAgents.map((sub) =>
          sub.id === idOrTaskId || sub.taskId === idOrTaskId
            ? {
                ...sub,
                status,
                endedAt: Date.now(),
                outputSummary: output ? summarizeJson(output, 240) : undefined,
                error,
              }
            : sub,
        ),
      })),
    }))),

  appendStepNote: (detail, toolName) =>
    set((state) => {
      // Statically defined tools (e.g. timeline tools) don't know their run.
      // Resolve the target structurally by the running tool call when a
      // toolName is given; falling back to the global currentRunId would let
      // a concurrent background run steal the note.
      const targetRunId = resolveStepNoteTargetRunId(state.runsById, state.currentRunId, toolName);
      return updateCurrentRun(state, (run) => {
        const steps = [...run.steps];
        const idx = findActiveStepIndex(steps);
        if (idx < 0) return run;
        const prev = steps[idx].detail;
        steps[idx] = { ...steps[idx], detail: prev ? `${prev}\n${detail}` : detail };
        return { ...run, steps };
      }, targetRunId);
    }),

  clearSession: (sessionId) =>
    set((state) => {
      const runIds = state.runIdsBySession[sessionId] ?? [];
      const runsById = { ...state.runsById };
      for (const id of runIds) delete runsById[id];
      const runIdsBySession = { ...state.runIdsBySession };
      delete runIdsBySession[sessionId];
      return {
        runsById,
        runIdsBySession,
        currentRunId: runIds.includes(state.currentRunId || '') ? null : state.currentRunId,
      };
    }),
}), {
  name: 'kunpeng-run-steps',
  storage: deferredRunStorage,
  version: 1,
  partialize: (state) => ({
    runsById: state.runsById,
    runIdsBySession: state.runIdsBySession,
  }),
  merge: (persisted, current) => ({
    ...current,
    ...revivePersistedRuns(persisted),
    currentRunId: null,
  }),
}));
