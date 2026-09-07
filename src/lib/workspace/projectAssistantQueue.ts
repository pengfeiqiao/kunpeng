import type { ProjectConversationReference } from '../projectObjects/types.ts';

export interface AssistantTarget {
  accessScope?: 'media' | 'shot' | 'project';
  surface?: 'media' | 'editor' | 'documents';
  projectId: string;
  sessionId: string | null;
  objectId?: string;
  mediaId?: string;
  versionId?: string;
  outputType?: 'image' | 'video' | 'audio';
  label: string;
  context: string;
  contextBase?: string;
  references?: ProjectConversationReference[];
}

export interface AssistantDraft {
  target: AssistantTarget;
  text: string;
  files: string[];
}

export interface AssistantReceipt {
  messageIds?: string[];
  runIds?: string[];
  mediaIds?: string[];
  changeIds?: string[];
}

export interface AssistantQueueItem extends AssistantReceipt {
  id: string;
  target: AssistantTarget;
  threadKey: string;
  prompt: string;
  files: string[];
  status: 'queued' | 'running' | 'failed' | 'uncertain' | 'done';
  error?: string;
  enqueuedAt: number;
}

interface QueueState {
  items: AssistantQueueItem[];
  drafts: Record<string, AssistantDraft>;
  active: Record<string, string>;
}

export function assistantThreadKey(target: AssistantTarget): string {
  // accessScope 参与线程身份：只读引用线程与可编辑线程的授权边界不同，不能合并（run 级权限绑定依赖它）
  return JSON.stringify([target.projectId, target.sessionId, target.surface ?? 'media', target.objectId ?? null,
    target.mediaId ?? null, target.versionId ?? null, target.outputType ?? null, target.context,
    ...(target.accessScope ? [target.accessScope] : [])]);
}

export function assistantSessionKey(projectId: string, sessionId: string | null, surface = 'media'): string {
  return JSON.stringify([projectId, sessionId, surface]);
}

export class AssistantQueueFailure extends Error {
  readonly retrySafe: boolean;
  constructor(message: string, retrySafe = false) { super(message); this.retrySafe = retrySafe; }
}

interface QueuePort {
  projectId: string;
  safe: (item: AssistantQueueItem) => boolean;
  send: (item: AssistantQueueItem, attached: () => boolean) => Promise<AssistantReceipt | void>;
}

/** Owns dispatch promises, not views. A timer never owns a running item. */
export class ProjectAssistantQueue {
  private state: QueueState = { items: [], drafts: {}, active: {} };
  private listeners = new Set<() => void>();
  private ports = new Map<symbol, QueuePort>();
  private scheduled?: ReturnType<typeof setTimeout>;
  private lease?: symbol;
  private sequence = 0;
  private persist?: (value: string) => void;
  private delayMs: number;
  constructor(persist?: (value: string) => void, delayMs = 250) { this.persist = persist; this.delayMs = delayMs; }
  getSnapshot = () => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  private publish(next: QueueState) {
    this.state = next;
    try { this.persist?.(JSON.stringify(next)); } catch { /* Memory remains authoritative for this app lifetime. */ }
    this.listeners.forEach((listener) => listener());
    this.kick();
  }
  restore(raw: string | null) {
    if (!raw || this.state.items.length || Object.keys(this.state.drafts).length) return;
    try {
      const parsed = JSON.parse(raw) as QueueState;
      if (!Array.isArray(parsed.items) || !parsed.drafts || !parsed.active) return;
      const validTarget = (t: AssistantTarget) => t && typeof t.projectId === 'string' && typeof t.context === 'string'
        && typeof t.label === 'string' && (t.sessionId === null || typeof t.sessionId === 'string');
      if (parsed.items.some((i) => !validTarget(i.target) || !Array.isArray(i.files) || typeof i.prompt !== 'string'
        || !['queued', 'running', 'failed', 'uncertain', 'done'].includes(i.status))) return;
      if (Object.values(parsed.drafts).some((d) => !validTarget(d.target) || typeof d.text !== 'string' || !Array.isArray(d.files))) return;
      this.publish({ ...parsed, items: parsed.items.map((item) => item.status === 'running'
        ? { ...item, status: 'uncertain', error: '运行已中断，提交状态待核实；不会重放整轮。' } : item) });
    } catch { /* An unreadable cache cannot authorize a send. */ }
  }
  draft(projectId: string, sessionId: string | null, surface = 'media'): AssistantDraft | undefined {
    return this.state.drafts[this.state.active[assistantSessionKey(projectId, sessionId, surface)]];
  }
  select(target: AssistantTarget) {
    const key = assistantThreadKey(target);
    // 同一对象仅权限范围不同的线程：新建时继承无 scope 兄弟线程的输入草稿，避免用户已输入文字在目标切换后丢失
    const siblingKey = target.accessScope ? assistantThreadKey({ ...target, accessScope: undefined }) : key;
    const sibling = siblingKey !== key ? this.state.drafts[siblingKey] : undefined;
    this.publish({ ...this.state, active: { ...this.state.active, [assistantSessionKey(target.projectId, target.sessionId, target.surface)]: key },
      drafts: { ...this.state.drafts, [key]: this.state.drafts[key]
        ?? { target: { ...target }, text: sibling?.text ?? '', files: sibling ? [...sibling.files] : [] } } });
  }
  writeDraft(target: AssistantTarget, text: string, files: string[]) {
    const key = assistantThreadKey(target);
    this.publish({ ...this.state, active: { ...this.state.active, [assistantSessionKey(target.projectId, target.sessionId, target.surface)]: key },
      drafts: { ...this.state.drafts, [key]: { target: { ...target }, text, files: [...files] } } });
  }
  bindPreparedSession(projectId: string, sessionId: string) {
    const drafts = { ...this.state.drafts };
    const active = { ...this.state.active };
    for (const [key, draft] of Object.entries(drafts)) {
      if (draft.target.projectId !== projectId || draft.target.sessionId !== null) continue;
      const target = { ...draft.target, sessionId };
      const nextKey = assistantThreadKey(target);
      drafts[nextKey] = { ...draft, target }; delete drafts[key];
      const oldSessionKey = assistantSessionKey(projectId, null, target.surface);
      if (key === active[oldSessionKey]) {
        active[assistantSessionKey(projectId, sessionId, target.surface)] = nextKey;
        delete active[oldSessionKey];
      }
    }
    this.publish({ ...this.state, drafts, active, items: this.state.items.map((item) => {
      if (item.target.projectId !== projectId || item.target.sessionId !== null) return item;
      const target = { ...item.target, sessionId };
      return { ...item, target, threadKey: assistantThreadKey(target) };
    }) });
  }
  enqueue(target: AssistantTarget, prompt: string, files: string[] = []) {
    if (!prompt.trim()) return;
    const threadKey = assistantThreadKey(target);
    const duplicate = this.state.items.find((item) => item.threadKey === threadKey && item.prompt === prompt.trim()
      && item.status !== 'done' && JSON.stringify(item.files) === JSON.stringify(files));
    if (duplicate) return duplicate.id;
    const item: AssistantQueueItem = { id: `assistant-${Date.now()}-${++this.sequence}-${Math.random().toString(36).slice(2, 8)}`,
      target: structuredClone(target), threadKey, prompt: prompt.trim(), files: [...files], status: 'queued', enqueuedAt: Date.now() };
    this.publish({ ...this.state, items: [...this.state.items, item] });
    return item.id;
  }
  update(id: string, action: 'delete' | 'retry' | 'prioritize' | 'edit', prompt?: string) {
    const item = this.state.items.find((entry) => entry.id === id);
    if (!item || item.status === 'running' || item.status === 'done') return;
    if (action === 'delete') { this.publish({ ...this.state, items: this.state.items.filter((entry) => entry.id !== id) }); return; }
    // Editing or promoting an unknown submission must not bypass replay protection.
    if (item.status === 'uncertain' || (action === 'edit' && !prompt?.trim())) return;
    const next = { ...item, status: 'queued' as const, error: undefined, prompt: action === 'edit' ? prompt!.trim() : item.prompt };
    const rest = this.state.items.filter((entry) => entry.id !== id);
    this.publish({ ...this.state, items: action === 'prioritize' ? [next, ...rest]
      : this.state.items.map((entry) => entry.id === id ? next : entry) });
  }
  attach(port: QueuePort) {
    const token = Symbol('assistant-view');
    this.ports.set(token, port); this.kick();
    return () => { this.ports.delete(token); this.cancelTimer(); this.kick(); };
  }
  private cancelTimer() { if (this.scheduled) clearTimeout(this.scheduled); this.scheduled = undefined; }
  kick = () => {
    this.cancelTimer();
    if (this.lease || this.state.items.some((item) => item.status === 'running')) return;
    for (const [token, port] of this.ports) {
      const head = this.state.items.find((item) => item.target.projectId === port.projectId && item.status === 'queued' && port.safe(item));
      if (!head) continue;
      this.scheduled = setTimeout(() => {
        this.scheduled = undefined;
        if (!this.ports.has(token) || this.lease || !port.safe(head)) return;
        this.lease = token;
        this.publish({ ...this.state, items: this.state.items.map((item) => item.id === head.id ? { ...item, status: 'running' } : item) });
        const attached = () => this.ports.has(token);
        // Settlement updates the store even if every view has unmounted.
        Promise.resolve().then(() => port.send(head, attached)).then(
          (receipt) => this.settle(head.id, 'done', undefined, receipt ?? {}),
          (error: unknown) => this.settle(head.id, error instanceof AssistantQueueFailure && error.retrySafe ? 'failed' : 'uncertain',
            error instanceof AssistantQueueFailure ? error.message : '发送未完成，提交状态待核实；不会重放整轮。'),
        );
      }, this.delayMs);
      return;
    }
  };
  private settle(id: string, status: AssistantQueueItem['status'], error?: string, receipt: AssistantReceipt = {}) {
    this.lease = undefined;
    this.publish({ ...this.state, items: this.state.items.map((item) => item.id === id ? { ...item, ...receipt, status, error } : item) });
  }
}
