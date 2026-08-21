import { safeLocalStorage } from '@/lib/safeStorage';
import { sanitizeSessionFileData, stripSessionMediaFromMessage } from '@/lib/sessionSanitize';
import {
  readTextFile,
  writeTextFile,
  renameFile,
  exists,
  createDir,
  readDir,
  removeFile,
  BaseDirectory,
} from '@tauri-apps/api/fs';
import type { Message, Session } from '@/types';
import type { AgentMessage } from '@/lib/agent';

// ─── Architecture ────────────────────────────────────────────────────────
// File-as-source-of-truth, one file per session.
//
//   ~/.kunpeng/chats/index.json                  → Session[] (list / titles)
//   ~/.kunpeng/chats/<safeSessionId>.json        → { messages, agentMessages }
//
// localStorage keeps the same keys (kunpeng-sessions, kunpeng-messages-*,
// kunpeng-agent-messages-*) as an in-memory cache so the UI stays fast; the
// disk is the durable copy. Every write writes BOTH places — caller may
// `void writeSessionToFile(...)` to fire-and-forget. On load, we prefer
// localStorage first, then fall back to disk and re-hydrate the cache.
// ──────────────────────────────────────────────────────────────────────────

const CHATS_DIR = '.kunpeng/chats';
const INDEX_REL_PATH = `${CHATS_DIR}/index.json`;
const INDEX_TMP_REL_PATH = `${CHATS_DIR}/index.json.tmp`;

// Legacy global-snapshot file (Phase 220-232). Kept here only so that
// migrateLocalStorageToFiles can read its contents if it exists.
const LEGACY_HISTORY_REL_PATH = '.kunpeng/chat-history.json';

const SESSIONS_LS_KEY = 'kunpeng-sessions';
const MESSAGES_LS_PREFIX = 'kunpeng-messages-';
const AGENT_MESSAGES_LS_PREFIX = 'kunpeng-agent-messages-';

export interface SessionFile {
  schemaVersion: 2;
  sessionId: string;
  updatedAt: number;
  messages: Message[];
  agentMessages: AgentMessage[];
}

// ── Legacy global-snapshot shape (read-only, for migration) ─────────────
export interface PersistedHistory {
  schemaVersion: 1;
  updatedAt: number;
  sessions: Session[];
  messagesBySession: Record<string, Message[]>;
  agentMessagesBySession: Record<string, AgentMessage[]>;
}

function safeParse<T>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

function compactStoredValue(value: unknown, maxChars: number): unknown {
  if (typeof value === 'string') {
    return value.length > maxChars
      ? `${value.slice(0, maxChars)}\n[内容已压缩，原始长度 ${value.length.toLocaleString()} 字符]`
      : value;
  }
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  try {
    const serialized = JSON.stringify(value);
    return serialized.length > maxChars
      ? `[结构化内容已压缩，原始长度 ${serialized.length.toLocaleString()} 字符]`
      : value;
  } catch {
    return '[无法序列化的工具参数]';
  }
}

/** Historical messages only need compact tool evidence for the work log. */
export function compactMessagesForStorage(messages: Message[]): Message[] {
  return messages.map((rawMessage) => {
    // Strip embedded base64 tool media FIRST (while result.output is still
    // complete enough to parse the artifact path from). Without this a single
    // image_generate result can pin ~5MB into the session file forever.
    const message = stripSessionMediaFromMessage(rawMessage);
    const executions = message.metadata?.toolExecutions;
    if (!Array.isArray(executions)) return message;
    const toolExecutions = executions.map((raw) => {
      if (!raw || typeof raw !== 'object') return raw;
      const execution = raw as Record<string, unknown>;
      const result = execution.result && typeof execution.result === 'object'
        ? execution.result as Record<string, unknown>
        : null;
      return {
        ...execution,
        params: compactStoredValue(execution.params, 1_500),
        result: result
          ? {
              ...result,
              output: compactStoredValue(result.output, 4_000),
              error: compactStoredValue(result.error, 4_000),
            }
          : execution.result,
      };
    });
    return {
      ...message,
      metadata: {
        ...message.metadata,
        toolExecutions,
      },
    };
  });
}

const MAX_CACHED_TOOL_RESULT_CHARS = 24_000;
const MAX_DISK_TOOL_RESULT_CHARS = 256_000;

function prepareAgentMessages(
  messages: AgentMessage[],
  maxToolResultChars: number,
  label: '缓存' | '磁盘持久化',
): AgentMessage[] {
  return messages.map((message): AgentMessage => {
    if (message.role === 'assistant') {
      let next = message;
      if (next.thinking_blocks?.length) {
        // Completed reasoning is useful for the live execution UI, but restoring
        // it on every later request wastes context and can trigger premature
        // compaction. The durable conversation keeps conclusions and tool calls.
        const { thinking_blocks: _thinkingBlocks, ...withoutHistoricalThinking } = next;
        next = withoutHistoricalThinking;
      }
      if (next.tool_calls?.length) {
        // Giant tool-call arguments (e.g. workshop_set_* specs) used to persist
        // verbatim and were echoed on every later request; give them the same
        // per-call budget as tool results.
        let changed = false;
        const toolCalls = next.tool_calls.map((call) => {
          const args = call.function?.arguments;
          if (typeof args !== 'string' || args.length <= maxToolResultChars) return call;
          changed = true;
          return {
            ...call,
            function: { ...call.function, arguments: compactStoredValue(args, maxToolResultChars) as string },
          };
        });
        if (changed) next = { ...next, tool_calls: toolCalls };
      }
      return next;
    }
    if (message.role === 'tool') {
      const headChars = Math.floor(maxToolResultChars * 0.78);
      const tailChars = Math.floor(maxToolResultChars * 0.16);
      const content = message.content.length > maxToolResultChars
        ? [
            message.content.slice(0, headChars),
            `\n\n[工具结果过大，${label}时已明确截断；原始长度 ${message.content.length.toLocaleString()} 字符]\n\n`,
            message.content.slice(-tailChars),
          ].join('')
        : message.content;
      return { ...message, content, media: undefined };
    }
    if (message.role === 'user' && Array.isArray(message.content)) {
      return {
        ...message,
        content: message.content.map((block) => {
          if (block.type === 'text' || block.source.type === 'url') return block;
          return {
            type: 'text' as const,
            text: `[${block.type === 'video' ? '视频' : '图片'}附件已在原始消息中传入，恢复会话时不重复保存 Base64 数据]`,
          };
        }),
      };
    }
    return message;
  });
}

/** Small browser cache used only for fast paint and quota safety. */
export function compactAgentMessagesForStorage(messages: AgentMessage[]): AgentMessage[] {
  return prepareAgentMessages(messages, MAX_CACHED_TOOL_RESULT_CHARS, '缓存');
}

/**
 * Durable session files are the source of truth. Keep substantially richer
 * tool evidence there so switching views or restarting the app does not turn
 * a 1M conversation into the 24K localStorage cache representation.
 */
export function prepareAgentMessagesForDisk(messages: AgentMessage[]): AgentMessage[] {
  return prepareAgentMessages(messages, MAX_DISK_TOOL_RESULT_CHARS, '磁盘持久化');
}

function sessionFileName(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_\-]/g, '_') + '.json';
}

function sessionRelPath(sessionId: string): string {
  return `${CHATS_DIR}/${sessionFileName(sessionId)}`;
}

async function ensureChatsDir(): Promise<void> {
  await createDir(CHATS_DIR, { dir: BaseDirectory.Home, recursive: true });
}

// ─── Per-session file: write ────────────────────────────────────────────
// Merge with the existing file. This is critical: two write paths run in
// parallel — persistMessages (which knows current UI messages but reads
// agentMessages from LS cache) and saveAgentMessages (vice versa). Without
// merging, whichever caller reads stale/empty data from LS clobbers the
// other side's good payload on disk.
//
// Rule: a non-empty incoming array overwrites disk; an empty incoming array
// preserves whatever is already on disk. This handles both initial writes
// (no existing file → empty preserved as []) and race-time partial writes.
//
// Fast path: when BOTH incoming arrays are non-empty they fully determine the
// file contents (a non-empty side always wins), so the read-back of the
// previous file is skipped. This matters because the hot paths call us every
// ~2s while the agent works — previously each write also read + parsed the
// whole previous file (tens of MB for media-heavy sessions).
//
// Concurrency: all writes to the same session file are serialized through a
// per-session promise chain. The merge strategy alone can't help when two
// read-merge-write cycles INTERLEAVE (both read v1, both write their own v2,
// last one wins and drops the other's payload). With the queue, each cycle
// reads the previous cycle's completed output.
const sessionWriteQueues = new Map<string, Promise<void>>();

function setSessionWriteQueue(sessionId: string, task: Promise<void>): void {
  const guarded = task.catch(() => {});
  sessionWriteQueues.set(sessionId, guarded);
  void guarded.then(() => {
    if (sessionWriteQueues.get(sessionId) === guarded) sessionWriteQueues.delete(sessionId);
  });
}

export async function writeSessionToFile(
  sessionId: string,
  payload: { messages: Message[]; agentMessages: AgentMessage[] },
): Promise<void> {
  const prev = sessionWriteQueues.get(sessionId) ?? Promise.resolve();
  const next = prev.then(() => writeSessionToFileInner(sessionId, payload));
  // Swallow errors in the chain link so one failed write doesn't poison the queue.
  setSessionWriteQueue(sessionId, next);
  return next;
}

async function writeSessionToFileInner(
  sessionId: string,
  payload: { messages: Message[]; agentMessages: AgentMessage[] },
): Promise<void> {
  try {
    await ensureChatsDir();
    const path = sessionRelPath(sessionId);
    const tmp = `${path}.tmp`;

    // Only read the previous file when an empty incoming side must preserve
    // the on-disk value; when both sides arrive non-empty they win outright.
    const needExisting = payload.messages.length === 0 || payload.agentMessages.length === 0;
    const existing = needExisting ? await readSessionFromFile(sessionId) : null;
    const merged: SessionFile = {
      schemaVersion: 2,
      sessionId,
      updatedAt: Date.now(),
      messages: payload.messages.length > 0
        ? compactMessagesForStorage(payload.messages)
        : (existing?.messages ?? []),
      agentMessages: payload.agentMessages.length > 0
        ? prepareAgentMessagesForDisk(payload.agentMessages)
        : (existing?.agentMessages ?? []),
    };

    await writeTextFile({ path: tmp, contents: JSON.stringify(merged) }, { dir: BaseDirectory.Home });
    await renameFile(tmp, path, { dir: BaseDirectory.Home });
  } catch (err) {
    console.warn('[historyPersistence] writeSessionToFile failed:', err);
  }
}

// ─── Per-session file: read ─────────────────────────────────────────────
export async function readSessionFromFile(
  sessionId: string,
): Promise<{ messages: Message[]; agentMessages: AgentMessage[] } | null> {
  try {
    const path = sessionRelPath(sessionId);
    if (!(await exists(path, { dir: BaseDirectory.Home }))) return null;
    const raw = await readTextFile(path, { dir: BaseDirectory.Home });
    const parsed = safeParse<SessionFile>(raw);
    if (!parsed || parsed.schemaVersion !== 2) return null;
    return {
      messages: Array.isArray(parsed.messages) ? compactMessagesForStorage(parsed.messages) : [],
      // Disk is the durable, richer source. Do not run it through the 24K
      // localStorage compressor again on every read.
      agentMessages: Array.isArray(parsed.agentMessages)
        ? prepareAgentMessagesForDisk(parsed.agentMessages)
        : [],
    };
  } catch (err) {
    console.warn('[historyPersistence] readSessionFromFile failed:', err);
    return null;
  }
}

// ─── Per-session file: delete ───────────────────────────────────────────
export async function deleteSessionFile(sessionId: string): Promise<void> {
  const prev = sessionWriteQueues.get(sessionId) ?? Promise.resolve();
  const next = prev.then(async () => {
    try {
    const path = sessionRelPath(sessionId);
    if (await exists(path, { dir: BaseDirectory.Home })) {
      await removeFile(path, { dir: BaseDirectory.Home });
    }
    } catch (err) {
      console.warn('[historyPersistence] deleteSessionFile failed:', err);
    }
  });
  setSessionWriteQueue(sessionId, next);
  return next;
}

// ─── Session index file ─────────────────────────────────────────────────
// Merge into the existing on-disk index instead of overwriting blindly.
// If the caller passes a stale list (e.g. UI cleanup hook on window close
// that reflects only the sessions UI loaded from localStorage), we must NOT
// drop the disk's other sessions. Strategy: union by id, prefer the newer
// updatedAt. The caller's entries also win for title/messageCount because
// they reflect the latest in-memory state.
let indexWriteQueue: Promise<void> = Promise.resolve();

export async function writeSessionIndex(sessions: Session[]): Promise<void> {
  const snapshot = sessions.map((session) => ({ ...session }));
  const next = indexWriteQueue.then(() => writeSessionIndexInner(snapshot));
  indexWriteQueue = next.catch(() => {});
  return next;
}

async function writeSessionIndexInner(sessions: Session[]): Promise<void> {
  try {
    await ensureChatsDir();
    const existing = (await readSessionIndex()) ?? [];
    const byId = new Map<string, Session>();
    for (const s of existing) byId.set(s.id, s);
    for (const s of sessions) {
      const prev = byId.get(s.id);
      if (!prev) {
        byId.set(s.id, s);
      } else {
        const newer = (s.updatedAt ?? 0) >= (prev.updatedAt ?? 0) ? s : prev;
        const older = newer === s ? prev : s;
        byId.set(s.id, {
          ...older,
          ...newer,
          updatedAt: Math.max(s.updatedAt ?? 0, prev.updatedAt ?? 0),
          messageCount: Math.max(s.messageCount ?? 0, prev.messageCount ?? 0),
        });
      }
    }
    const merged = Array.from(byId.values()).sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    await writeTextFile(
      { path: INDEX_TMP_REL_PATH, contents: JSON.stringify(merged) },
      { dir: BaseDirectory.Home },
    );
    await renameFile(INDEX_TMP_REL_PATH, INDEX_REL_PATH, { dir: BaseDirectory.Home });
  } catch (err) {
    console.warn('[historyPersistence] writeSessionIndex failed:', err);
  }
}

export async function readSessionIndex(): Promise<Session[] | null> {
  try {
    if (!(await exists(INDEX_REL_PATH, { dir: BaseDirectory.Home }))) return null;
    const raw = await readTextFile(INDEX_REL_PATH, { dir: BaseDirectory.Home });
    const parsed = safeParse<Session[]>(raw);
    return parsed && Array.isArray(parsed) ? parsed : null;
  } catch (err) {
    console.warn('[historyPersistence] readSessionIndex failed:', err);
    return null;
  }
}

// ─── localStorage readers (still used as cache) ─────────────────────────
// IMPORTANT: missing key returns null (not []) so callers can trigger file
// recovery instead of clobbering UI state with an empty array.
export function readSessionsFromLocalStorage(): Session[] | null {
  try {
    const raw = localStorage.getItem(SESSIONS_LS_KEY);
    if (!raw) return null;
    const parsed = safeParse<Session[]>(raw);
    return parsed && Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function readMessagesFromLocalStorage(sessionId: string): Message[] | null {
  try {
    const raw = localStorage.getItem(MESSAGES_LS_PREFIX + sessionId);
    if (!raw) return null;
    const parsed = safeParse<Message[]>(raw);
    return parsed && Array.isArray(parsed) ? compactMessagesForStorage(parsed) : null;
  } catch {
    return null;
  }
}

export function readAgentMessagesFromLocalStorage(sessionId: string): AgentMessage[] | null {
  try {
    const raw = localStorage.getItem(AGENT_MESSAGES_LS_PREFIX + sessionId);
    if (!raw) return null;
    const parsed = safeParse<AgentMessage[]>(raw);
    return parsed && Array.isArray(parsed) ? compactAgentMessagesForStorage(parsed) : null;
  } catch {
    return null;
  }
}

// ─── localStorage hydration from disk ───────────────────────────────────
export function hydrateLocalStorageSession(
  sessionId: string,
  data: { messages: Message[]; agentMessages: AgentMessage[] },
): void {
  try {
    safeLocalStorage.setItem(MESSAGES_LS_PREFIX + sessionId, JSON.stringify(compactMessagesForStorage(data.messages)));
    safeLocalStorage.setItem(
      AGENT_MESSAGES_LS_PREFIX + sessionId,
      JSON.stringify(compactAgentMessagesForStorage(data.agentMessages)),
    );
  } catch (err) {
    console.warn('[historyPersistence] hydrateLocalStorageSession failed:', err);
  }
}

export function hydrateLocalStorageSessions(sessions: Session[]): void {
  try {
    safeLocalStorage.setItem(SESSIONS_LS_KEY, JSON.stringify(sessions));
  } catch (err) {
    console.warn('[historyPersistence] hydrateLocalStorageSessions failed:', err);
  }
}

// ─── One-time migration: localStorage + legacy snapshot → per-session files
// Idempotent: only writes a session file if it doesn't already exist on disk.
// Safe to call on every boot.
export async function migrateLocalStorageToFiles(): Promise<{ migrated: number }> {
  let migrated = 0;
  try {
    await ensureChatsDir();

    // 1) Bootstrap index file from localStorage if absent
    let indexOnDisk = await readSessionIndex();
    if (indexOnDisk === null) {
      const fromLs = readSessionsFromLocalStorage();
      if (fromLs && fromLs.length > 0) {
        await writeSessionIndex(fromLs);
        indexOnDisk = fromLs;
      }
    }

    const sessions = indexOnDisk ?? readSessionsFromLocalStorage() ?? [];
    if (sessions.length === 0) return { migrated: 0 };

    // 2) For each session, write its per-session file if missing
    for (const s of sessions) {
      const path = sessionRelPath(s.id);
      if (await exists(path, { dir: BaseDirectory.Home })) continue;
      const messages = readMessagesFromLocalStorage(s.id) ?? [];
      const agentMessages = readAgentMessagesFromLocalStorage(s.id) ?? [];
      if (messages.length === 0 && agentMessages.length === 0) continue;
      await writeSessionToFile(s.id, { messages, agentMessages });
      migrated++;
    }

    // 3) Salvage from legacy chat-history.json if present (one-off)
    try {
      if (await exists(LEGACY_HISTORY_REL_PATH, { dir: BaseDirectory.Home })) {
        const raw = await readTextFile(LEGACY_HISTORY_REL_PATH, { dir: BaseDirectory.Home });
        const legacy = safeParse<PersistedHistory>(raw);
        if (legacy && legacy.schemaVersion === 1 && Array.isArray(legacy.sessions)) {
          for (const s of legacy.sessions) {
            const path = sessionRelPath(s.id);
            if (await exists(path, { dir: BaseDirectory.Home })) continue;
            const messages = legacy.messagesBySession?.[s.id] ?? [];
            const agentMessages = legacy.agentMessagesBySession?.[s.id] ?? [];
            if (messages.length === 0 && agentMessages.length === 0) continue;
            await writeSessionToFile(s.id, { messages, agentMessages });
            migrated++;
          }
        }
      }
    } catch (err) {
      console.warn('[historyPersistence] legacy migration failed:', err);
    }

    if (migrated > 0) {
      console.log(`[historyPersistence] migrated ${migrated} session(s) to per-file storage`);
    }
  } catch (err) {
    console.warn('[historyPersistence] migrateLocalStorageToFiles failed:', err);
  }
  return { migrated };
}

// ─── Discover sessions on disk (recovery: index lost but files survived)
export async function listSessionFiles(): Promise<string[]> {
  try {
    if (!(await exists(CHATS_DIR, { dir: BaseDirectory.Home }))) return [];
    const entries = await readDir(CHATS_DIR, { dir: BaseDirectory.Home });
    const ids: string[] = [];
    for (const e of entries) {
      if (!e.name) continue;
      if (e.name === 'index.json' || e.name.endsWith('.tmp')) continue;
      if (!e.name.endsWith('.json')) continue;
      // The filename is a safe-encoded sessionId; reading the file gives
      // the actual sessionId (round-trip safe).
      try {
        const raw = await readTextFile(`${CHATS_DIR}/${e.name}`, { dir: BaseDirectory.Home });
        const parsed = safeParse<SessionFile>(raw);
        if (parsed?.sessionId) ids.push(parsed.sessionId);
      } catch { /* skip */ }
    }
    return ids;
  } catch (err) {
    console.warn('[historyPersistence] listSessionFiles failed:', err);
    return [];
  }
}

// ─── One-time legacy cleanup: strip embedded base64 media from session files
// Sessions written before the compaction chain learned to strip base64 media
// keep multi-MB image payloads on disk forever (one observed file: 57MB for
// 52 messages). New writes are sanitized by compactMessagesForStorage; this
// pass rewrites the existing files once. Wired from App.tsx on a delayed
// timer; the localStorage marker makes it run only once per install.
const SESSION_MEDIA_CLEANUP_LS_KEY = 'kunpeng.sessionMediaCleanup.v1';

export async function cleanupLegacySessionMedia(): Promise<{ scanned: number; cleaned: number }> {
  let scanned = 0;
  let cleaned = 0;
  try {
    try {
      if (safeLocalStorage.getItem(SESSION_MEDIA_CLEANUP_LS_KEY) === 'done') {
        return { scanned, cleaned };
      }
    } catch { /* localStorage unavailable — still attempt the cleanup */ }

    if (await exists(CHATS_DIR, { dir: BaseDirectory.Home })) {
      const entries = await readDir(CHATS_DIR, { dir: BaseDirectory.Home });
      for (const e of entries) {
        if (!e.name) continue;
        if (e.name === 'index.json' || e.name.endsWith('.tmp')) continue;
        if (!e.name.endsWith('.json')) continue;
        // Per-file isolation: one unreadable/corrupt file must not abort the
        // rest of the pass or startup.
        try {
          const raw = await readTextFile(`${CHATS_DIR}/${e.name}`, { dir: BaseDirectory.Home });
          scanned++;
          // Cheap pre-filter: base64 sources serialize with this marker.
          if (!raw.includes('base64')) continue;
          const parsed = safeParse<SessionFile>(raw);
          if (!parsed || parsed.schemaVersion !== 2 || !parsed.sessionId) continue;
          const sanitized = sanitizeSessionFileData(parsed);
          if (sanitized === parsed) continue; // no base64 media after all
          // Route through the per-session write queue so the cleanup write is
          // serialized with any in-flight persist of the active session, and
          // lands atomically (tmp + rename).
          await writeSessionToFile(parsed.sessionId, {
            messages: Array.isArray(sanitized.messages) ? sanitized.messages : [],
            agentMessages: Array.isArray(sanitized.agentMessages) ? sanitized.agentMessages : [],
          });
          cleaned++;
        } catch (err) {
          console.warn(`[historyPersistence] session media cleanup skipped ${e.name}:`, err);
        }
      }
    }

    try {
      safeLocalStorage.setItem(SESSION_MEDIA_CLEANUP_LS_KEY, 'done');
    } catch { /* marker write failed — cleanup simply reruns next launch */ }
    if (cleaned > 0) {
      console.log(`[historyPersistence] stripped embedded base64 media from ${cleaned} session file(s)`);
    }
  } catch (err) {
    console.warn('[historyPersistence] cleanupLegacySessionMedia failed:', err);
  }
  return { scanned, cleaned };
}
