import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { ConfirmationQueue } from '../agent/confirmationQueue.ts';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { initialWorkspaceDraft } from './drafts.ts';
import type { CoreGenRequest } from '../canvasGen/index';
import type { WorkshopData } from '../workshop/types.ts';

function mockStore(initial: Record<string, any>) {
  let state = initial;
  const listeners = new Set<(next: any, previous: any) => void>();
  return { getState: () => state, setState: (patch: Record<string, any>) => { const previous = state; state = { ...state, ...patch }; for (const listener of listeners) listener(state, previous); },
    subscribe: (listener: (next: any, previous: any) => void) => { listeners.add(listener); return () => listeners.delete(listener); },
    get listenerCount() { return listeners.size; } };
}

test('real runtime adapter: strict disk gate, shared FIFO confirm, frozen request, candidate recovery, project switch and cleanup (offline)', async () => {
  const initial = migrateWorkshopProjectObjects({ ...emptyWorkshopData('p'), shots: [{ id: 's', shotNo: '1', description: '司机行车', characterIds: [], videoPrompt: '司机听到异响', durationSec: 8 }] });
  initial.projectSpec = { ...initial.projectSpec!, generationConfirmation: 'always-confirm' };
  const queue = new ConfirmationQueue<Record<string, unknown>>();
  const calls: CoreGenRequest[] = [];
  const strictWrites: unknown[] = [];
  const workshop = mockStore({ project: { id: 'p', name: '本地测试' }, data: initial,
    scheduleSave: () => {}, commitNow: async (options: unknown) => { strictWrites.push(options); } });
  const unified = mockStore({ activeId: 'p' });
  const tasks = mockStore({ tasks: [] });
  const canvas = mockStore({ nodes: [], edges: [] });
  const project = mockStore({ activeProjectId: 'canvas', projects: [{ id: 'canvas', aigcProjectId: 'p' }] });
  tasks.setState({ updateTask: (id: string, patch: object) => tasks.setState({ tasks: tasks.getState().tasks.map((item: any) => item.id === id ? { ...item, ...patch } : item) }) });
  const confirmations = mockStore({ requestConfirm: (_name: string, params: Record<string, unknown>, _reason: unknown, options: any) => queue.request(params, options) });
  const runtimeMocks = { workshop, unified, tasks, confirmations, canvas, project,
    generate: async (request: CoreGenRequest) => {
      calls.push(request);
      tasks.setState({ tasks: [...tasks.getState().tasks, { id: `task-${calls.length}`, status: 'running', createdAt: Date.now(),
        resultPaths: [], workspaceBinding: request.workspaceBinding }] });
      request.onTaskCreated?.(`task-${calls.length}`);
      await Promise.resolve();
      const path = `/output-${calls.length}.${request.workspaceBinding?.snapshot.outputType === 'image' ? 'png' : 'mp4'}`;
      tasks.getState().updateTask(`task-${calls.length}`, { status: 'succeeded', resultPaths: [path] });
      return { success: true, taskId: `task-${calls.length}`, resultPaths: [path], resultUrls: [] };
    } };
  (globalThis as any).__workspaceRuntimeMocks = runtimeMocks;
  const root = fileURLToPath(new URL('../../../', import.meta.url));
  const bundle = await build({ absWorkingDir: root, entryPoints: ['src/lib/workspace/runtime.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
    plugins: [{ name: 'offline-runtime-ports', setup(build) {
      build.onResolve({ filter: /^@\/stores\/(workshopStore|unifiedProjectStore|canvasTaskStore|toolConfirmStore|canvasStore|projectStore)$/ }, ({ path }) => ({ path, namespace: 'offline' }));
      build.onResolve({ filter: /^@\/lib\/(canvasGen|agent\/tools\/canvasGenerateTool)$/ }, ({ path }) => ({ path, namespace: 'offline' }));
      build.onLoad({ filter: /.*/, namespace: 'offline' }, ({ path }) => {
        const mapped: Record<string, [string, string]> = {
          '@/stores/workshopStore': ['useWorkshopStore', 'workshop'], '@/stores/unifiedProjectStore': ['useUnifiedProjectStore', 'unified'],
          '@/stores/canvasTaskStore': ['useCanvasTaskStore', 'tasks'], '@/stores/toolConfirmStore': ['useToolConfirmStore', 'confirmations'],
          '@/stores/canvasStore': ['useCanvasStore', 'canvas'], '@/stores/projectStore': ['useProjectStore', 'project'],
        };
        const pair = mapped[path];
        return { contents: pair ? `export const ${pair[0]} = globalThis.__workspaceRuntimeMocks.${pair[1]};`
          : path.endsWith('canvasGen') ? 'export const runGeneration = request => globalThis.__workspaceRuntimeMocks.generate(request);'
            : 'export const canvasGenerateTool = { risk: "ask" };', loader: 'js' };
      });
    } }],
  });
  const runtime = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
  const unwatch = runtime.watchWorkspaceRuntime();
  try {
    await Promise.resolve();
    assert.equal(workshop.listenerCount, 1);
    const draft = initialWorkspaceDraft(initial, 'shot:s', 'video')!;
    const saved = runtime.updateWorkspaceDraft({ ...draft, prompt: '司机转头，保留原对白' });
    assert.equal(saved.revision, 1);
    assert.equal((workshop.getState().data as WorkshopData).shots[0].description, '司机行车');
    canvas.setState({ nodes: [{ id: 'native-video', type: 'video', position: { x: 7, y: 13 }, data: {
      projectObjectId: saved.objectId, description: saved.prompt, workspaceDraftId: saved.id,
      workspaceProjection: { revision: saved.revision, prompt: saved.prompt }, generatedVideoUrl: '/old-video.mp4',
    } }], edges: [{ id: 'order', source: 'a', target: 'native-video', data: { relation: 'sequence' } }] });
    const edited = runtime.updateWorkspaceDraft({ ...saved, prompt: '司机察觉异响，未改对白' });
    assert.equal(canvas.getState().nodes[0].data.description, edited.prompt);
    assert.equal(canvas.getState().nodes[0].data.workspaceProjection.revision, edited.revision);
    assert.equal(canvas.getState().nodes[0].data.generatedVideoUrl, '/old-video.mp4');
    assert.equal(canvas.getState().edges[0].id, 'order');
    project.setState({ activeProjectId: 'other-canvas' });
    const nativeNodes = canvas.getState().nodes;
    runtime.updateWorkspaceDraft({ ...edited, prompt: '仅写原项目草稿' });
    assert.equal(canvas.getState().nodes, nativeNodes);
    project.setState({ activeProjectId: 'canvas' });
    const generated = runtime.generateWorkspaceDraft(saved);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 0);
    assert.equal(queue.getSnapshot().pending.length, 1);
    assert.deepEqual(strictWrites, [{ requireSuccess: true }]);
    assert.equal(queue.getSnapshot().pending[0].payload.prompt, saved.prompt);
    queue.decide(queue.getSnapshot().pending[0].id, true);
    assert.equal((await generated).status, 'succeeded');
    assert.equal(calls.length, 1);
    assert.equal(calls[0].strictPaidSafety, true);
    assert.equal(calls[0].workspaceBinding!.snapshot.objectId, 'shot:s');
    assert.equal(workshop.getState().data.projectObjects.versions.length, 1);
    assert.equal(workshop.getState().data.projectObjects.versions[0].selected, false);
    const cancelled = runtime.generateWorkspaceDraft(saved);
    await new Promise(resolve => setImmediate(resolve));
    queue.decide(queue.getSnapshot().pending[0].id, false);
    assert.equal((await cancelled).status, 'cancelled');
    assert.equal(calls.length, 1);
    workshop.setState({ commitNow: async () => { throw new Error('mock full disk'); } });
    assert.equal((await runtime.generateWorkspaceDraft(saved)).status, 'cancelled');
    assert.equal(calls.length, 1);
    workshop.setState({ commitNow: async () => {} });
    const switching = runtime.generateWorkspaceDraft(saved);
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(queue.getSnapshot().pending.length, 1);
    unified.setState({ activeId: 'other' });
    assert.equal((await switching).status, 'cancelled');
    assert.equal(queue.getSnapshot().pending.length, 0);
    assert.equal(calls.length, 1);
    unified.setState({ activeId: 'p' });
    workshop.setState({ data: migrateWorkshopProjectObjects({ ...workshop.getState().data, characters: [
      { id: 'driver', name: '司机', appearance: '', personality: '', assetImagePath: '/adopted.png', assetPrompt: '只修改衣袖' },
    ] }) });
    const cancelledAsset = runtime.generateWorkspaceAsset('p', 'character', 'driver');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(calls.length, 1);
    assert.equal(queue.getSnapshot().pending[0].payload.prompt, '只修改衣袖');
    queue.decide(queue.getSnapshot().pending[0].id, false);
    assert.equal((await cancelledAsset).status, 'cancelled');
    const asset = runtime.generateWorkspaceAsset('p', 'character', 'driver');
    await new Promise(resolve => setImmediate(resolve));
    queue.decide(queue.getSnapshot().pending[0].id, true);
    assert.equal((await asset).status, 'succeeded');
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].referenceUrls, []);
    assert.equal(calls[1].workspaceBinding!.snapshot.objectId, 'character:driver');
    assert.equal(workshop.getState().data.characters[0].assetImagePath, '/adopted.png');
    assert.ok(workshop.getState().data.projectObjects.versions.some((v: any) => v.ownerObjectId === 'character:driver' && v.generationSnapshot && !v.selected));
    assert.equal((await runtime.generateWorkspaceAsset('other-project', 'character', 'driver')).status, 'invalid');
    assert.equal(calls.length, 2);
  } finally {
    unwatch();
    assert.equal(workshop.listenerCount + tasks.listenerCount + unified.listenerCount, 0);
    delete (globalThis as any).__workspaceRuntimeMocks;
  }
});
