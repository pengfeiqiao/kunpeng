import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { initialWorkspaceDraft } from './drafts.ts';
import { submitWorkspaceGeneration, workspaceResultStatus, type WorkspaceGenerationPort } from './generationCommand.ts';
import type { CoreGenRequest, CoreGenResult } from '../canvasGen/index';
import type { WorkspaceTaskBinding } from './types.ts';
import type { GenerationConfirmationPreference } from '../projectObjects/types.ts';

function harness(preference: GenerationConfirmationPreference = 'paid-only-confirm') {
  let data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('workspace-test'),
    shots: [{ id: 's', shotNo: '01', description: '司机开车', characterIds: [], videoPrompt: '司机开车', durationSec: 8 }] }, 1);
  data = { ...data, projectSpec: { ...data.projectSpec!, generationConfirmation: preference } };
  let confirms = 0;
  let saves = 0;
  const calls: CoreGenRequest[] = [];
  const bindings = new Map<string, WorkspaceTaskBinding>();
  const port: WorkspaceGenerationPort = {
    readProject: (id) => data.projectId === id ? data : null,
    publish: (before, after) => { if (data !== before) return false; data = after; return true; },
    persist: async () => { saves++; },
    confirm: async () => { confirms++; return true; },
    bindTask: (id, binding) => { bindings.set(id, binding); },
    runGeneration: async (request) => {
      calls.push(request);
      request.onTaskCreated?.('task');
      return { success: true, taskId: 'task', resultPaths: ['/result.mp4'], resultUrls: [] };
    },
  };
  return { port, get data() { return data; }, set data(value) { data = value; }, calls, bindings,
    get confirms() { return confirms; }, get saves() { return saves; },
    draft: initialWorkspaceDraft(data, 'shot:s', 'video', 2)! };
}

for (const preference of ['always-confirm', 'paid-only-confirm', 'direct-execute'] as const) {
  for (const risk of ['safe', 'ask'] as const) {
    test(`workspace actual command: ${preference} / ${risk} uses the shared confirmation policy`, async () => {
      const h = harness(preference);
      const outcome = await submitWorkspaceGeneration(h.port, h.draft, 'submission', risk);
      assert.equal(outcome.status, 'succeeded');
      assert.equal(h.confirms, preference === 'always-confirm' || (preference === 'paid-only-confirm' && risk === 'ask') ? 1 : 0);
      assert.equal(h.calls.length, 1);
      assert.equal(h.saves, 2);
      assert.equal(h.bindings.get('task')!.snapshot.objectId, 'shot:s');
      assert.equal(h.data.projectObjects!.versions[0].selected, false);
    });
  }
}

test('image drafts generate directly under the default preference but still confirm under always-confirm', async () => {
  for (const [preference, expected] of [['always-confirm', 1], ['paid-only-confirm', 0], ['direct-execute', 0]] as const) {
    const h = harness(preference);
    const draft = initialWorkspaceDraft(h.data, 'shot:s', 'image', 2)!;
    draft.prompt = '司机开车的图片';
    const outcome = await submitWorkspaceGeneration(h.port, draft, 'submission', 'ask');
    assert.equal(outcome.status, 'succeeded');
    assert.equal(h.confirms, expected, `${preference} image confirm count`);
    assert.equal(h.calls.length, 1);
  }
});

test('video drafts keep a single confirmation under the default preference', async () => {
  const h = harness('paid-only-confirm');
  const outcome = await submitWorkspaceGeneration(h.port, h.draft, 'submission', 'ask');
  assert.equal(outcome.status, 'succeeded');
  assert.equal(h.confirms, 1);
  assert.equal(h.calls.length, 1);
});

test('cancel and abort while confirming never reach canvasGen and release only their reservation', async () => {
  for (const abort of [false, true]) {
    const h = harness();
    const controller = new AbortController();
    h.port.confirm = async () => { if (abort) controller.abort(); return abort; };
    const result = await submitWorkspaceGeneration(h.port, h.draft, 'submission', 'ask', controller.signal);
    assert.equal(result.status, 'cancelled');
    assert.equal(h.calls.length, 0);
    assert.equal(h.data.workspaceSubmissions!.submission.status, 'cancelled');
  }
});

test('confirmation uses an immutable copy and submission preserves original reference bytes/order', async () => {
  const h = harness();
  h.draft.prompt = '@图片一 司机看向 @图片二 公路';
  h.draft.references = [{ id: 'driver', type: 'image', label: '司机', path: '/original-driver.png' }, { id: 'road', type: 'image', label: '路', path: '/original-road.png' }];
  h.port.confirm = async (shown) => {
    shown.prompt = 'mutated dialog object';
    shown.references.reverse();
    h.draft.prompt = 'edited after confirmation opened';
    h.draft.params.duration = 15;
    return true;
  };
  await submitWorkspaceGeneration(h.port, h.draft, 'submission', 'ask');
  assert.equal(h.calls[0].prompt, '@图片一 司机看向 @图片二 公路');
  assert.equal(h.calls[0].params!.duration, 8);
  assert.deepEqual(h.calls[0].referenceUrls, ['/original-driver.png', '/original-road.png']);
  assert.equal(h.data.projectObjects!.versions[0].generationSnapshot!.params.duration, 8);
});

test('reservation persist failure and object locking during second persistence stop before paid boundary', async () => {
  const failed = harness();
  failed.port.persist = async () => { throw new Error('mock disk failure'); };
  assert.equal((await submitWorkspaceGeneration(failed.port, failed.draft, 'submission', 'ask')).status, 'cancelled');
  assert.equal(failed.calls.length, 0);
  const locked = harness();
  let n = 0;
  locked.port.persist = async () => { if (++n === 2) locked.data = { ...locked.data, projectObjects: {
    ...locked.data.projectObjects!, objects: locked.data.projectObjects!.objects.map((item) => item.id === 'shot:s' ? { ...item, locked: true } : item),
  } }; };
  assert.equal((await submitWorkspaceGeneration(locked.port, locked.draft, 'submission', 'ask')).status, 'cancelled');
  assert.equal(locked.calls.length, 0);
});

test('unexpected executor failure is uncertain and never replays the paid call', async () => {
  const h = harness();
  let calls = 0;
  h.port.runGeneration = async (request) => { calls++; request.onTaskCreated?.('task'); throw new Error('mock transport loss'); };
  assert.equal((await submitWorkspaceGeneration(h.port, h.draft, 'submission', 'ask')).status, 'uncertain');
  assert.equal((await submitWorkspaceGeneration(h.port, h.draft, 'duplicate', 'ask')).status, 'invalid');
  assert.equal(calls, 1);
  assert.equal(h.bindings.get('task')!.submissionId, 'submission');
});

test('switching project after submit does not write a result into the new project; task binding survives', async () => {
  const h = harness();
  h.port.runGeneration = async (request) => {
    request.onTaskCreated?.('task');
    h.data = migrateWorkshopProjectObjects(emptyWorkshopData('other-project'));
    return { success: true, taskId: 'task', resultPaths: ['/result.mp4'], resultUrls: [] };
  };
  const result = await submitWorkspaceGeneration(h.port, h.draft, 'submission', 'ask');
  assert.equal(result.status, 'succeeded');
  assert.equal(h.data.projectObjects!.media.length, 0);
  assert.equal(h.bindings.get('task')!.snapshot.projectId, 'workspace-test');
});

test('background/ambiguous/empty-success results do not become safely retryable failures', () => {
  const base: CoreGenResult = { success: false, taskId: 'task', resultPaths: [], resultUrls: [] };
  assert.equal(workspaceResultStatus({ ...base, submissionUncertain: true }), 'uncertain');
  assert.equal(workspaceResultStatus({ ...base, submissionCommitted: true }), 'uncertain');
  assert.equal(workspaceResultStatus({ ...base, automaticRetryBlocked: true }), 'uncertain');
  assert.equal(workspaceResultStatus({ ...base, backgroundPending: true }), 'running');
  assert.equal(workspaceResultStatus({ ...base, providerTaskId: 'remote' }), 'running');
  assert.equal(workspaceResultStatus({ ...base, providerTaskId: 'remote', providerFailed: true }), 'failed');
  assert.equal(workspaceResultStatus({ ...base, success: true }), 'uncertain');
});
