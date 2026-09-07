import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as creation from './projectCreation.ts';
import * as intakeApi from './projectIntake.ts';
import { captureProjectCreationLease, finishProjectCreation, openPendingProjectCreation,
  readPendingProjectCreation, PENDING_PROJECT_CREATION_KEY } from './projectCreation.ts';
import { enqueueProjectIntake, findProjectIntakeHandoff } from './projectIntakeHandoff.ts';
import { ProjectAssistantQueue } from '../workspace/projectAssistantQueue.ts';

const intake = { brief: 'original brief', createdAt: 10, mode: 'idea', automation: 'stage-confirm', attachments: [{ path: '/fake/ref.png', kind: 'image' }] };
const pending = { projectId: 'new', name: 'New project', intake };
function observable(initial) {
  let state = initial;
  const listeners = new Set();
  return { read: () => state, getState: () => state,
    set(next) { state = { ...state, ...next }; listeners.forEach((listener) => listener(state)); },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); } };
}
function flow() {
  const state = observable({ projectId: 'new', dataProjectId: 'new' });
  const queue = new ProjectAssistantQueue();
  const calls = [];
  const port = { ...state,
    writeIntake(value, check) { check(); state.set({ intake: value }); calls.push('write'); check(); },
    async commit() { calls.push('commit'); },
    async prepareAndOpen(check) { check(); calls.push('prepare'); return 'fresh'; },
    enqueue(sessionId, value) { calls.push('enqueue'); enqueueProjectIntake(queue, 'new', sessionId, value); },
    show() { calls.push('show'); } };
  return { state, queue, calls, port };
}

test('blank project creation freezes intake and uses the native handoff with a fresh session', async () => {
  const f = flow(); await finishProjectCreation(pending, f.port);
  assert.deepEqual(f.calls, ['write', 'commit', 'prepare', 'enqueue', 'show']);
  const item = f.queue.getSnapshot().items[0];
  assert.equal(item.target.sessionId, 'fresh'); assert.equal(item.target.projectId, 'new');
  assert.equal(item.prompt, intake.brief); assert.deepEqual(item.files, ['/fake/ref.png']);
});

for (const phase of ['before', 'commit', 'prepare']) test(`switching project ${phase} prevents handoff and foreign intake writes`, async () => {
  const f = flow();
  if (phase === 'before') f.state.set({ projectId: 'other', dataProjectId: 'other' });
  else f.port[phase === 'commit' ? 'commit' : 'prepareAndOpen'] = async () => {
    f.state.set({ projectId: 'other', dataProjectId: 'other', intake: undefined }); return 'foreign';
  };
  await assert.rejects(finishProjectCreation(pending, f.port));
  assert.equal(f.queue.getSnapshot().items.length, 0);
  assert.equal(f.state.read().intake, undefined);
});

test('switch-away/back and edit/revert invalidate the creation lease', () => {
  for (const change of ['project', 'intake']) {
    const f = flow(); f.state.set({ intake });
    const lease = captureProjectCreationLease('new', f.state); lease.freezeIntake(intake);
    if (change === 'project') { f.state.set({ projectId: 'other' }); f.state.set({ projectId: 'new' }); }
    else { f.state.set({ intake: { ...intake, brief: 'edited' } }); f.state.set({ intake }); }
    assert.throws(() => lease.assert()); lease.dispose();
  }
});

test('existing edited intake is never overwritten on manual recovery', async () => {
  const f = flow(); f.state.set({ intake: { ...intake, brief: 'user edit' } });
  await assert.rejects(finishProjectCreation(pending, f.port), /未覆盖/);
  assert.equal(f.state.read().intake.brief, 'user edit'); assert.deepEqual(f.calls, []);
});

test('preparation failure remains unsent; explicit continuation reuses saved intake without rewriting', async () => {
  const f = flow(); const prepare = f.port.prepareAndOpen;
  f.port.prepareAndOpen = async () => { throw new Error('busy'); };
  await assert.rejects(finishProjectCreation(pending, f.port));
  assert.equal(f.queue.getSnapshot().items.length, 0);
  f.port.prepareAndOpen = prepare; await finishProjectCreation(pending, f.port);
  assert.equal(f.calls.filter((call) => call === 'write').length, 1);
  assert.equal(f.queue.getSnapshot().items.length, 1);
});

test('manual recovery detects another project opened during its load', async () => {
  const state = observable({ projectId: 'old', dataProjectId: 'old' });
  await assert.rejects(openPendingProjectCreation('new', { ...state, async open() {
    state.set({ projectId: 'other', dataProjectId: 'other' });
    state.set({ projectId: 'new', dataProjectId: 'new' });
  } }));
  await openPendingProjectCreation('new', { ...state, async open() {} });
});

test('reading a persisted recovery is inert and a consumed handoff is found regardless of session/status', () => {
  const storage = { getItem(key) { assert.equal(key, PENDING_PROJECT_CREATION_KEY); return JSON.stringify(pending); } };
  assert.deepEqual(readPendingProjectCreation(storage), pending);
  const queue = new ProjectAssistantQueue(); const id = enqueueProjectIntake(queue, 'new', 'original', intake);
  assert.equal(findProjectIntakeHandoff(queue, 'new', intake).id, id);
  for (const status of ['queued', 'running', 'done', 'uncertain', 'failed']) {
    const restored = new ProjectAssistantQueue();
    restored.restore(JSON.stringify({ ...queue.getSnapshot(), items: queue.getSnapshot().items.map((item) => ({ ...item, status })) }));
    assert.ok(findProjectIntakeHandoff(restored, 'new', intake));
    assert.equal(enqueueProjectIntake(restored, 'new', 'different-session', intake), id);
    assert.equal(restored.getSnapshot().items.length, 1);
  }
});

function sessions() {
  const state = observable({ currentSessionId: 'old-session', sessions: [{ id: 'old-session', projectId: 'old' }],
    isStreaming: false, streamingPhase: 'idle' });
  const calls = []; let duringCreate = async () => {};
  const exports = {};
  const modules = { '@/stores': { useChatStore: state }, '@/hooks/useSessions': {
    bindSessionToProjectRaw(id, projectId) { calls.push('bind'); const session = { id, projectId }; state.set({ sessions: [session] }); return session; },
    async createSessionRaw(title, projectId) {
      calls.push('create'); const session = { id: 'fresh-session', title, projectId };
      state.set({ sessions: [...state.read().sessions, session], currentSessionId: session.id });
      await duringCreate(); return session;
    },
    loadSessionRaw() { throw new Error('creation must not load an old session'); },
  } };
  const source = readFileSync(new URL('../projectSessions.ts', import.meta.url), 'utf8');
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  runInNewContext(code, { exports, require: (id) => { assert.ok(modules[id], id); return modules[id]; } });
  return { state, calls, api: exports, setDuringCreate(fn) { duringCreate = fn; } };
}

test('explicit creation makes a fresh session without rebinding old history; legacy surface behavior remains', async () => {
  const f = sessions();
  const id = await f.api.prepareNewProjectSession('new', 'New', () => {}, async () => {
    assert.equal((await f.api.ensureProjectSession('new', 'New')).id, 'fresh-session');
  });
  assert.equal(id, 'fresh-session'); assert.deepEqual(f.calls, ['create']);
  assert.equal(f.state.read().sessions.find((item) => item.id === 'old-session').projectId, 'old');
  assert.equal((await f.api.ensureProjectSession('new', 'New')).id, id);
  await f.api.ensureProjectSession('other', 'Other'); assert.deepEqual(f.calls, ['create', 'bind']);
});

test('streaming refuses fresh session preparation without modifying old session', async () => {
  const f = sessions(); f.state.set({ isStreaming: true });
  await assert.rejects(f.api.prepareNewProjectSession('new', 'New', () => {}, async () => {}));
  assert.deepEqual(f.calls, []); assert.equal(f.state.read().currentSessionId, 'old-session');
});

test('session switch during open cannot pass the legacy rebind route, even after switching back', async () => {
  const f = sessions();
  await assert.rejects(f.api.prepareNewProjectSession('new', 'New', () => {}, async () => {
    f.state.set({ currentSessionId: 'old-session' });
    await assert.rejects(f.api.ensureProjectSession('new', 'New'));
    f.state.set({ currentSessionId: 'fresh-session' });
  }));
  assert.deepEqual(f.calls, ['create']);
  assert.equal(f.state.read().sessions[0].projectId, 'old');
});

test('project/session changes during asynchronous session creation stop before opening or sending', async () => {
  for (const change of ['project', 'session']) {
    const f = sessions(); let current = true; let opens = 0;
    f.setDuringCreate(async () => { if (change === 'project') current = false; else f.state.set({ currentSessionId: 'old-session' }); });
    await assert.rejects(f.api.prepareNewProjectSession('new', 'New', () => { if (!current) throw new Error('switched'); }, async () => { opens++; }));
    assert.equal(opens, 0); assert.deepEqual(f.calls, ['create']);
  }
});

function creationHandler(options = {}) {
  const f = sessions();
  const ws = observable({ project: { id: 'old' }, data: { projectId: 'old' } });
  const unified = observable({ activeId: 'old', opening: false });
  const storage = new Map(options.rawPending !== undefined ? [[PENDING_PROJECT_CREATION_KEY, options.rawPending]]
    : options.pending ? [[PENDING_PROJECT_CREATION_KEY, JSON.stringify(pending)]] : []);
  const queue = new ProjectAssistantQueue(); const calls = []; const messages = [];
  ws.set({
    setProjectIntake(value) { calls.push(`intake:${ws.read().project.id}`); ws.set({ data: { ...ws.read().data, projectIntake: value } }); },
    updateProjectSpec() { calls.push(`spec:${ws.read().project.id}`); },
    async commitNow(value) { assert.equal(value.requireSuccess, true); await options.commit?.(ws); },
    updateProjectViewState() {},
    async openProject(id) { calls.push(`open:${id}`); ws.set({ project: { id }, data: { projectId: id } }); },
  });
  const source = ts.createSourceFile('ProjectListView.tsx', readFileSync(new URL('../../components/projects/ProjectListView.tsx', import.meta.url), 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let handler;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(source) === 'handleCreate') handler = node.initializer.getText(source);
    ts.forEachChild(node, visit);
  }
  visit(source); assert.ok(handler);
  const exports = {};
  const context = {
    ...creation, ...intakeApi, exports, structuredClone,
    creatingRef: { current: false }, setCreating() {},
    brief: intake.brief, attachments: intake.attachments, automation: intake.automation,
    localStorage: { getItem: (key) => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: (key) => storage.delete(key) },
    useWorkshopStore: ws, useUnifiedProjectStore: unified, useChatStore: f.state,
    projectAssistantQueue: queue, enqueueProjectIntake, findProjectIntakeHandoff,
    prepareNewProjectSession: f.api.prepareNewProjectSession,
    async createAndOpen() { calls.push('create'); await options.create?.(); ws.set({ project: { id: 'new' }, data: { projectId: 'new' } }); return 'new'; },
    async openUnified(id) { calls.push(`unified:${id}`); await f.api.ensureProjectSession(id, 'New'); unified.set({ activeId: id }); },
    setActiveView(view) { calls.push(`view:${view}`); },
    async tauriConfirm() { calls.push('confirm'); return options.confirm ?? true; },
    async tauriMessage(message) { messages.push(message); },
  };
  runInNewContext(ts.transpileModule(`exports.handleCreate = ${handler}`, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
  }).outputText, context);
  return { ...f, ws, queue, calls, messages, storage, handle: exports.handleCreate };
}

test('real handleCreate sends the idea via native queue and never rebinds the old session', async () => {
  const f = creationHandler(); await f.handle(true);
  assert.equal(f.queue.getSnapshot().items.length, 1);
  assert.equal(f.queue.getSnapshot().items[0].target.sessionId, 'fresh-session');
  assert.equal(f.state.read().sessions[0].projectId, 'old');
  assert.ok(f.calls.includes('intake:new')); assert.ok(f.calls.includes('spec:new'));
  assert.ok(f.calls.includes('view:workshop')); assert.deepEqual(f.messages, []);
  assert.equal(f.storage.size, 0);
});

test('real handler detects switch during commit and retains a manual recovery without foreign writes', async () => {
  const f = creationHandler({ commit(ws) { ws.set({ project: { id: 'other' }, data: { projectId: 'other' } }); } });
  await f.handle(true);
  assert.equal(f.queue.getSnapshot().items.length, 0);
  assert.equal(f.ws.read().data.projectIntake, undefined);
  assert.equal(JSON.parse(f.storage.get(PENDING_PROJECT_CREATION_KEY)).projectId, 'new');
  assert.ok(f.messages.some((message) => message.includes('尚未发送') && message.includes('继续原项目')));
  assert.ok(!f.calls.includes('unified:new'));
});

test('real handler exposes native manual recovery: cancelling sends nothing, continuing does not create another project', async () => {
  const cancelled = creationHandler({ pending: true, confirm: false }); await cancelled.handle(true);
  assert.deepEqual(cancelled.calls, ['confirm']); assert.equal(cancelled.queue.getSnapshot().items.length, 0);
  assert.equal(cancelled.storage.size, 1);
  const resumed = creationHandler({ pending: true }); await resumed.handle(true);
  assert.ok(!resumed.calls.includes('create')); assert.ok(resumed.calls.includes('open:new'));
  assert.equal(resumed.queue.getSnapshot().items.length, 1); assert.equal(resumed.storage.size, 0);
});

test('real handler does not recreate or replay an already handed-off intake', async () => {
  const f = creationHandler({ pending: true });
  enqueueProjectIntake(f.queue, 'new', 'original-session', intake);
  await f.handle(true);
  assert.deepEqual(f.calls, []); assert.equal(f.queue.getSnapshot().items.length, 1);
  assert.ok(f.messages.some((message) => message.includes('没有重复发送')));
});

test('real handler prevents same-tick double creation while the first promise is pending', async () => {
  let release; const barrier = new Promise((resolve) => { release = resolve; });
  const f = creationHandler({ create: () => barrier });
  const first = f.handle(true); await f.handle(true);
  assert.equal(f.calls.filter((call) => call === 'create').length, 1);
  release(); await first; assert.equal(f.queue.getSnapshot().items.length, 1);
});

for (const rawPending of ['{broken', '{"projectId":42}', 'null']) {
  test(`invalid recovery can be manually cleared without creating or sending: ${rawPending}`, async () => {
    const f = creationHandler({ rawPending });
    await f.handle(true);
    assert.deepEqual(f.calls, ['confirm']); assert.equal(f.storage.size, 0);
    assert.equal(f.queue.getSnapshot().items.length, 0);
    assert.equal(f.ws.read().project.id, 'old'); assert.equal(f.state.read().currentSessionId, 'old-session');
    await f.handle(true);
    assert.equal(f.calls.filter((call) => call === 'create').length, 1);
    assert.equal(f.queue.getSnapshot().items.length, 1);
  });
}

test('cancelling corrupt recovery cleanup preserves the record and never submits', async () => {
  const f = creationHandler({ rawPending: '{broken', confirm: false });
  await f.handle(true);
  assert.deepEqual(f.calls, ['confirm']); assert.equal(f.storage.get(PENDING_PROJECT_CREATION_KEY), '{broken');
  assert.equal(f.queue.getSnapshot().items.length, 0);
});

test('storage access failure is not misclassified as a corrupt record eligible for cleanup', () => {
  const denied = new Error('fake access denied');
  assert.throws(() => readPendingProjectCreation({ getItem() { throw denied; } }), (error) => error === denied);
});
