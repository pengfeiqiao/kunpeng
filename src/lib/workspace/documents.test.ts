import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WorkspaceDocumentDrafts, createDocumentCommands, documentKey, isEditableScript, parseSpecProjection,
  projectSpecProjection, sourceRelativePath, setProjectSkillEnabled, projectSkillState,
  type DocumentTarget, type WorkspaceDocument, type WorkspaceDocumentPort,
} from './documents.ts';
import { patchProjectSpec } from '../projectObjects/projectSpec.ts';
import { readSkillPreference, writeSkillPreference } from '../skills/skillPreferences.ts';

const script: DocumentTarget = { kind: 'script', sourceName: 'original.md' };
const snapshot = (projectId = 'a', body = '原剧本', version = '1'): WorkspaceDocument =>
  ({ projectId, target: script, title: '原剧本', body, version, editable: true });
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

test('registered original sources resolve exact file paths; synopsis is not accepted as script', () => {
  const source = { name: 'original.txt', type: 'md' as const, uploadedAt: 1, size: 4 };
  assert.equal(sourceRelativePath('p1', source), '.kunpeng/aigc-memory/projects/p1/sources/original.txt');
  assert.equal(isEditableScript(source), true);
  assert.equal(isEditableScript({ ...source, name: 'original.pdf', type: 'pdf' }), false);
  for (const name of ['../original.md', 'a\\b.md', '..', 'x\u0000.md']) assert.throws(() => sourceRelativePath('p1', { ...source, name }));
  assert.throws(() => sourceRelativePath('../p1', source));
  assert.throws(() => sourceRelativePath('p1', { ...source, type: 'link' }));
});

test('spec/rules projection roundtrips all fields through the existing patch command', () => {
  const spec = { revision: 7, updatedAt: 1, generationConfirmation: 'paid-only-confirm' as const,
    aspectRatio: '16:9', targetDurationSec: 30, language: '中文', styleTone: '克制', worldAndCharacters: '雨夜',
    continuityFacts: ['灰色外套'], forbidden: ['改变对白'], delivery: '成片', defaultImageModel: 'image', defaultVideoModel: 'video' };
  const input = { ...parseSpecProjection(projectSpecProjection(spec)), forbidden: ['改变人物关系'], targetDurationSec: 40 };
  const updated = patchProjectSpec(spec, input, 2);
  assert.equal(updated.revision, 8);
  assert.equal(updated.targetDurationSec, 40);
  assert.deepEqual(updated.forbidden, ['改变人物关系']);
  assert.deepEqual(spec.forbidden, ['改变对白']);
  assert.equal('revision' in parseSpecProjection(projectSpecProjection(updated)), false);
});

test('invalid spec values, unknown fields and generation policy are rejected', () => {
  for (const value of [{ generationConfirmation: 'free' }, { generationConfirmation: 'paid-only-confirm', revision: 99 },
    { generationConfirmation: 'paid-only-confirm', forbidden: 'x' }, { generationConfirmation: 'paid-only-confirm', targetDurationSec: -1 }]) {
    assert.throws(() => parseSpecProjection(JSON.stringify(value)));
  }
});

test('A/B drafts, work-surface remount and incoming updates preserve unsaved text', () => {
  const drafts = new WorkspaceDocumentDrafts();
  drafts.accept(snapshot()); drafts.edit('a', script, 'A 未保存');
  drafts.accept(snapshot('b')); drafts.edit('b', script, 'B 未保存');
  drafts.setEditing('a', script, false);
  drafts.accept(snapshot('a', '其他人修改', '2'));
  assert.equal(drafts.get('a', script)?.body, 'A 未保存');
  assert.equal(drafts.get('b', script)?.body, 'B 未保存');
  assert.equal(drafts.get('a', script)?.source.version, '1');
  assert.equal(drafts.get('a', script)?.incoming?.version, '2');
  drafts.rebase('a', script);
  assert.equal(drafts.get('a', script)?.body, 'A 未保存');
  assert.equal(drafts.get('a', script)?.source.version, '2');
});

test('delayed save captures A and submitted revision, preserving edits made during save', async () => {
  const drafts = new WorkspaceDocumentDrafts(); const gate = deferred<WorkspaceDocument>();
  drafts.accept(snapshot()); drafts.edit('a', script, '提交稿');
  const requests: unknown[] = [];
  const port: WorkspaceDocumentPort = { read: async () => snapshot(), save: (request) => { requests.push(request); return gate.promise; } };
  const pending = drafts.save('a', script, port);
  await drafts.save('a', script, port);
  drafts.edit('a', script, '保存中继续输入'); drafts.accept(snapshot('b'));
  gate.resolve(snapshot('a', '提交稿', '2')); await pending;
  assert.equal(requests.length, 1);
  assert.deepEqual(requests[0], { projectId: 'a', target: script, body: '提交稿', expectedVersion: '1' });
  assert.equal(drafts.get('a', script)?.body, '保存中继续输入');
  assert.equal(drafts.get('a', script)?.source.body, '提交稿');
  assert.equal(drafts.get('b', script)?.source.version, '1');
});

test('save failure and wrong-project receipt retain drafts without overwriting another project', async () => {
  for (const save of [async () => { throw new Error('磁盘失败'); }, async () => snapshot('b', '稿', '2')]) {
    const drafts = new WorkspaceDocumentDrafts(); drafts.accept(snapshot()); drafts.edit('a', script, '稿');
    await drafts.save('a', script, { read: async () => snapshot(), save });
    assert.equal(drafts.get('a', script)?.body, '稿');
    assert.equal(drafts.get('a', script)?.source.version, '1');
    assert.ok(drafts.get('a', script)?.error);
    assert.equal(drafts.get('b', script), undefined);
  }
});

test('command rechecks project after async read and performs zero writes after switching', async () => {
  let active = 'a'; let writes = 0; const gate = deferred<WorkspaceDocument>();
  const port = createDocumentCommands({ activeProjectId: () => active, lockKey: documentKey,
    read: () => gate.promise, write: async () => { writes += 1; return snapshot(); } });
  const pending = port.save({ projectId: 'a', target: script, expectedVersion: '1', body: '稿' });
  await Promise.resolve(); active = 'b'; gate.resolve(snapshot());
  await assert.rejects(pending, /切换/); assert.equal(writes, 0);
});

test('source revision conflict and readonly documents never write', async () => {
  let writes = 0;
  for (const current of [snapshot('a', 'new', '2'), { ...snapshot(), editable: false }]) {
    const port = createDocumentCommands({ activeProjectId: () => 'a', lockKey: documentKey,
      read: async () => current, write: async () => { writes += 1; return current; } });
    await assert.rejects(port.save({ projectId: 'a', target: script, expectedVersion: '1', body: '稿' }));
  }
  assert.equal(writes, 0);
});

test('concurrent commands serialize by source and reject stale second save', async () => {
  let current = snapshot(); let writes = 0;
  const port = createDocumentCommands({ activeProjectId: () => 'a', lockKey: () => 'shared-source',
    read: async () => current, write: async (request) => { writes += 1; current = snapshot('a', request.body, '2'); return current; } });
  const request = { projectId: 'a', target: script, expectedVersion: '1', body: '第一稿' };
  const results = await Promise.allSettled([port.save(request), port.save({ ...request, body: '第二稿' })]);
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected']);
  assert.equal(writes, 1); assert.equal(current.body, '第一稿');
});

test('project Skill enable/disable uses existing preferences and will not steal other project scopes', () => {
  const oldWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
  const values = new Map<string, string>();
  Object.defineProperty(globalThis, 'window', { configurable: true, value: {
    localStorage: { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) }, dispatchEvent: () => true,
  } });
  try {
    setProjectSkillEnabled('fixture-skill', 'a', true);
    assert.deepEqual(readSkillPreference('fixture-skill'), { enabled: true, scope: 'project', projectId: 'a' });
    assert.equal(projectSkillState('fixture-skill', 'b').active, false);
    assert.throws(() => setProjectSkillEnabled('fixture-skill', 'b', true), /其他项目/);
    setProjectSkillEnabled('fixture-skill', 'a', false);
    assert.equal(projectSkillState('fixture-skill', 'a').active, false);
    writeSkillPreference('another', { enabled: true, scope: 'global' });
    assert.equal(projectSkillState('another', 'a').active, true);
    assert.deepEqual([...values.keys()], ['kunpeng:skill-preferences:v1']);
  } finally {
    if (oldWindow) Object.defineProperty(globalThis, 'window', oldWindow); else Reflect.deleteProperty(globalThis, 'window');
  }
});
