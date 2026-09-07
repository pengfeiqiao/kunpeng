import test from 'node:test';
import assert from 'node:assert/strict';
import type { AigcProject } from '../aigc/projectStore.ts';
import { captureScriptOperation, commitScriptSources, enqueueScriptBreakdown, scriptBreakdownTarget,
  scriptProjectMatches, type ScriptContext } from './scriptTools.ts';

function fixture() {
  const project: AigcProject = { id: 'a', name: 'Project A', slug: 'a', createdAt: 1, updatedAt: 1,
    status: 'draft', videoEngine: 'rhtv', stats: { shots: 0, scenes: 0, assets: 0, videosCompleted: 0 },
    sources: [{ name: 'script.md', type: 'md', size: 1, uploadedAt: 1 }] };
  let context: ScriptContext = { project, dataProjectId: 'a', activeProjectId: 'a', sessionId: 'session-a',
    style: { keywords: ['original-style'], styleLibraryRef: 'existing-library' } };
  let disk = structuredClone(project);
  const listeners = new Set<() => void>();
  const writes: AigcProject[] = [];
  let published = 0;
  const update = (patch: Partial<ScriptContext>) => { context = { ...context, ...patch }; listeners.forEach((listener) => listener()); };
  const port = { read: () => context, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; } };
  const persistence = {
    readProject: async (id: string) => { assert.equal(id, 'a'); return structuredClone(disk); },
    writeProject: async (next: AigcProject) => { writes.push(structuredClone(next)); disk = structuredClone(next); },
    publish: (expected: AigcProject, next: AigcProject) => {
      if (!scriptProjectMatches(expected, context.project)) return false;
      published++; update({ project: next }); return true;
    },
  };
  return { project, port, persistence, update, writes, listeners, get published() { return published; },
    get disk() { return disk; }, setDisk: (value: AigcProject) => { disk = value; } };
}

const link = { name: 'https://example.test/script', url: 'https://example.test/script', type: 'link' as const, size: 0, uploadedAt: 2 };

test('source commit checks disk receipt, publishes once, and preserves metadata', async () => {
  const f = fixture(); const operation = captureScriptOperation('a', f.port);
  const next = await commitScriptSources(operation, [...f.project.sources, link], f.persistence);
  assert.equal(f.published, 1); assert.equal(f.writes.length, 1);
  assert.equal(next.sources.length, 2); assert.equal(next.name, f.project.name);
  assert.equal(f.project.sources.length, 1);
  operation.assertPublished(next);
  operation.close(); assert.equal(f.listeners.size, 0);
});

test('requires matching hydrated identities; legacy null active project remains supported', () => {
  const f = fixture();
  f.update({ dataProjectId: 'b' }); assert.throws(() => captureScriptOperation('a', f.port), /项目/);
  f.update({ dataProjectId: 'a', activeProjectId: null });
  const legacy = captureScriptOperation('a', f.port); legacy.close();
  assert.throws(() => captureScriptOperation('a', f.port, true), /项目/);
});

test('switch away and back invalidates in-flight work permanently', async () => {
  const f = fixture(); const operation = captureScriptOperation('a', f.port);
  f.update({ activeProjectId: 'b' }); f.update({ activeProjectId: 'a' });
  await assert.rejects(commitScriptSources(operation, [link], f.persistence), /变化/);
  assert.equal(f.writes.length, 0); assert.equal(f.published, 0); operation.close();
});

test('source edits after capture fail CAS before filesystem writes', async () => {
  const f = fixture(); const operation = captureScriptOperation('a', f.port);
  f.update({ project: { ...f.project, sources: [...f.project.sources, link] } });
  await assert.rejects(commitScriptSources(operation, [], f.persistence), /变化/);
  assert.equal(f.writes.length, 0); operation.close();
});

test('concurrent source commits serialize and reject the stale second snapshot', async () => {
  const f = fixture(); const first = captureScriptOperation('a', f.port); const second = captureScriptOperation('a', f.port);
  const results = await Promise.allSettled([
    commitScriptSources(first, [...f.project.sources, link], f.persistence),
    commitScriptSources(second, [], f.persistence),
  ]);
  assert.deepEqual(results.map((result) => result.status), ['fulfilled', 'rejected']);
  assert.equal(f.writes.length, 1); assert.equal(f.disk.sources.length, 2);
  first.close(); second.close();
});

test('different disk source or metadata revision is never overwritten', async () => {
  for (const patch of [{ sources: [link] }, { name: 'Newer name' }]) {
    const f = fixture(); const operation = captureScriptOperation('a', f.port);
    f.setDisk({ ...f.disk, ...patch });
    await assert.rejects(commitScriptSources(operation, [], f.persistence), /项目文件已有更新/);
    assert.equal(f.writes.length, 0); operation.close();
  }
});

test('updatedAt-only differences from writeProject do not cause false conflicts', async () => {
  const f = fixture(); const operation = captureScriptOperation('a', f.port);
  f.setDisk({ ...f.disk, updatedAt: 999 });
  await commitScriptSources(operation, [link], f.persistence);
  assert.equal(f.published, 1); operation.close();
});

test('switch during initial disk read prevents the write', async () => {
  const f = fixture(); const operation = captureScriptOperation('a', f.port);
  await assert.rejects(commitScriptSources(operation, [link], { ...f.persistence,
    readProject: async () => { f.update({ dataProjectId: 'b' }); return f.disk; },
  }), /变化/);
  assert.equal(f.writes.length, 0); operation.close();
});

test('switch during write cannot publish into the newly active project', async () => {
  const f = fixture(); const operation = captureScriptOperation('a', f.port);
  await assert.rejects(commitScriptSources(operation, [link], { ...f.persistence,
    writeProject: async (next) => { await f.persistence.writeProject(next); f.update({ activeProjectId: 'b' }); },
  }), /变化/);
  assert.equal(f.writes[0].id, 'a'); assert.equal(f.published, 0); operation.close();
});

test('swallowed disk failures and explicit errors never publish success', async () => {
  const f = fixture(); const operation = captureScriptOperation('a', f.port);
  await assert.rejects(commitScriptSources(operation, [link], { ...f.persistence, writeProject: async () => {} }), /未确认/);
  await assert.rejects(commitScriptSources(operation, [link], { ...f.persistence,
    writeProject: async () => { throw new Error('disk failure'); },
  }), /disk failure/);
  assert.equal(f.published, 0); operation.close();
});

test('switch during readback and CAS publication conflict do not publish', async () => {
  const f = fixture(); const operation = captureScriptOperation('a', f.port); let reads = 0;
  await assert.rejects(commitScriptSources(operation, [link], { ...f.persistence,
    readProject: async () => { if (++reads === 2) f.update({ activeProjectId: 'b' }); return f.disk; },
  }), /变化/);
  assert.equal(f.published, 0); operation.close();
  const g = fixture(); const other = captureScriptOperation('a', g.port);
  await assert.rejects(commitScriptSources(other, [link], { ...g.persistence, publish: () => false }), /未覆盖/);
  assert.equal(g.published, 0); other.close();
});

test('post-commit status cannot be applied after switching away and back', async () => {
  const f = fixture(); const operation = captureScriptOperation('a', f.port);
  const receipt = await commitScriptSources(operation, [link], f.persistence);
  f.update({ activeProjectId: 'b' }); f.update({ activeProjectId: 'a' });
  assert.throws(() => operation.assertPublished(receipt), /迟到/); operation.close();
});

test('breakdown target is frozen at project scope without object/media references', async () => {
  const f = fixture(); const operation = captureScriptOperation('a', f.port, true);
  const target = scriptBreakdownTarget(operation);
  assert.equal(target.projectId, 'a'); assert.equal(target.sessionId, 'session-a');
  assert.equal(target.objectId, undefined); assert.equal(target.mediaId, undefined);
  assert.deepEqual(target.references, []); assert.match(target.context, /不执行生图/);
  let queued = 0;
  await enqueueScriptBreakdown(operation, { buildStyle: async () => 'original style section',
    buildPrompt: (style) => { assert.equal(style, 'original style section'); return 'original breakdown prompt'; },
    enqueue: (frozen, prompt) => { queued++; assert.deepEqual(frozen, target); assert.equal(prompt, 'original breakdown prompt'); },
  });
  assert.equal(queued, 1); operation.close();
});

test('style, source, session or project changes while loading style prevent enqueue', async () => {
  for (const patch of [{ style: { keywords: ['new-style'] } }, { sessionId: 'other' },
    { activeProjectId: 'b' }, { project: { ...fixture().project, sources: [link] } }]) {
    const f = fixture(); const operation = captureScriptOperation('a', f.port, true); let queued = false;
    await assert.rejects(enqueueScriptBreakdown(operation, { buildStyle: async () => { f.update(patch); return 'style'; },
      buildPrompt: () => 'prompt', enqueue: () => { queued = true; },
    }), /变化/);
    assert.equal(queued, false); operation.close();
  }
});

test('no sources and unmounted operations cannot enqueue or persist', async () => {
  const f = fixture(); f.update({ project: { ...f.project, sources: [] } });
  const operation = captureScriptOperation('a', f.port, true);
  const port = { buildStyle: async () => { assert.fail('must not load'); }, buildPrompt: () => '', enqueue: () => assert.fail('must not enqueue') };
  await assert.rejects(enqueueScriptBreakdown(operation, port), /添加剧本来源/);
  operation.close();
  await assert.rejects(commitScriptSources(operation, [], f.persistence), /变化/);
  assert.equal(f.writes.length, 0); assert.equal(f.listeners.size, 0);
});
