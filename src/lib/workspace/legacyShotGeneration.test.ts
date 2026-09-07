import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { saveWorkspaceDraft } from './drafts.ts';
import { generateLegacyShots, prepareLegacyShotGeneration } from './legacyShotGeneration.ts';
import { submitWorkspaceGeneration, type WorkspaceGenerationPort } from './generationCommand.ts';
import { projectWorkspaceTasks } from './taskProjection.ts';
import { ConfirmationQueue } from '../agent/confirmationQueue.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

function fixture() {
  const migrated = migrateWorkshopProjectObjects({ ...emptyWorkshopData('legacy-shots'), characters: [
    { id: 'a', name: 'A', appearance: '', personality: '', assetImagePath: '/a.png', voicePath: '/voice.wav' },
  ], shots: ['a', 'b'].map((id, index) => ({ id, shotNo: String(index + 1), description: '事实', dialogue: '原对白',
    characterIds: ['a'], voiceCharacterIds: ['a'], imagePrompt: '@图片一 人物', videoPrompt: '@图片一 人物 @视频一 动作 @音频一 台词',
    imagePath: `/adopted-${id}.png`, videoPath: `/adopted-${id}.mp4`, directorPrevisVideoPaths: ['/previs.mp4'],
  })) }, 1);
  migrated.projectSpec = { ...migrated.projectSpec!, generationConfirmation: 'always-confirm' };
  return migrated;
}

test('legacy shot preparation saves exact visible multimodal draft, excludes own outputs, preserves subsequent edits', () => {
  const before = fixture();
  const prepared = prepareLegacyShotGeneration(before, ['a'], 'video', 2);
  assert.equal(before.workspaceDrafts, undefined);
  assert.equal(prepared.drafts[0].prompt, before.shots[0].videoPrompt);
  assert.deepEqual(prepared.drafts[0].references.map((ref) => ref.path), ['/a.png', '/previs.mp4', '/voice.wav']);
  const edited = saveWorkspaceDraft(prepared.data, { ...prepared.drafts[0], prompt: '明确无参考', references: [], params: { ratio: '9:16', duration: 8 } }, 1, 3)!;
  const repeated = prepareLegacyShotGeneration(edited, ['a'], 'video', 4);
  assert.equal(repeated.data, edited);
  assert.deepEqual(repeated.drafts[0], edited.workspaceDrafts![prepared.drafts[0].id]);
  assert.equal(repeated.data.shots[0].videoPath, '/adopted-a.mp4');
  assert.deepEqual(prepareLegacyShotGeneration(before, ['a'], 'image').drafts[0].references.map((ref) => ref.path), ['/a.png']);
});

test('whole batch validates before publishing; stable IDs do not fall back to reused shot numbers', async () => {
  let data = fixture(); let writes = 0; let calls = 0;
  data.shots[1].videoPrompt = '';
  await assert.rejects(generateLegacyShots({ apply: (_id, command) => { const next = command(data); if (!next) return false; data = next; writes++; return true; },
    generate: async () => { calls++; return { submissionId: '', status: 'succeeded' }; } }, data.projectId, ['a', 'b'], 'video'), /提示词/);
  assert.equal(writes, 0); assert.equal(calls, 0);
  assert.throws(() => prepareLegacyShotGeneration(data, ['a', 'a'], 'image'), /重复/);
  assert.throws(() => prepareLegacyShotGeneration(data, ['1'], 'image'), /不存在/);
  data.shots[0].shotNo = '99';
  assert.equal(prepareLegacyShotGeneration(data, ['a'], 'image').drafts[0].objectId, 'shot:a');
  data.projectObjects!.objects.find((o) => o.id === 'shot:a')!.locked = true;
  assert.throws(() => prepareLegacyShotGeneration(data, ['a'], 'image'), /锁定/);
});

test('shared command cancellation does not execute; confirmed outputs are candidates with frozen task binding; recovery is idempotent', async () => {
  for (const approve of [false, true]) {
    const prepared = prepareLegacyShotGeneration(fixture(), ['a'], 'video', 2);
    let data = prepared.data; let calls = 0; let confirms = 0; let binding: any;
    const port: WorkspaceGenerationPort = { readProject: () => data, publish: (before, after) => {
      assert.equal(before, data); data = after; return true;
    }, persist: async () => {}, confirm: async (draft) => { confirms++; assert.deepEqual(draft, prepared.drafts[0]); return approve; },
    bindTask: (_id, value) => { binding = value; }, runGeneration: async (request) => {
      calls++; assert.equal(request.strictPaidSafety, true); assert.equal(request.workshopShotNo, undefined);
      assert.deepEqual(request.audioUrls, ['/voice.wav']); request.onTaskCreated?.('native-1');
      assert.deepEqual(request.workspaceBinding, binding);
      return { success: true, taskId: 'native-1', resultPaths: ['/result.mp4', '/result2.mp4'], resultUrls: [] };
    } };
    const outcome = await submitWorkspaceGeneration(port, prepared.drafts[0], 'submission', 'ask');
    assert.equal(confirms, 1); assert.equal(calls, approve ? 1 : 0);
    assert.equal(outcome.status, approve ? 'succeeded' : 'cancelled');
    assert.equal(data.shots[0].videoPath, '/adopted-a.mp4');
    assert.equal(data.shots[0].dialogue, '原对白');
    assert.deepEqual(data.workspaceDrafts, prepared.data.workspaceDrafts);
    if (approve) {
      const count = data.projectObjects!.versions.length;
      const task = { id: 'native-1', status: 'succeeded', resultPaths: ['/result.mp4', '/result2.mp4'], workspaceBinding: binding, createdAt: 2 } as any;
      data = projectWorkspaceTasks(data, [task], new Set());
      assert.equal(data.projectObjects!.versions.length, count);
      assert.equal(data.projectObjects!.media.filter((v) => v.generationTaskId === 'native-1').length, 2);
      assert.ok(data.projectObjects!.media.filter((m) => m.path.startsWith('/result')).every((m) => m.purpose === 'candidate-version'));
    }
  }
});

test('uncertain submission blocks a new single or batch attempt, without retries or adopting results', async () => {
  const prepared = prepareLegacyShotGeneration(fixture(), ['a'], 'image'); let data = prepared.data; let calls = 0;
  const port: WorkspaceGenerationPort = { readProject: () => data, publish: (_b, next) => { data = next; return true; },
    persist: async () => {}, confirm: async () => true, bindTask: () => {}, runGeneration: async () => {
      calls++; return { success: false, taskId: 'native-unknown', resultPaths: [], resultUrls: [], submissionUncertain: true };
    } };
  assert.equal((await submitWorkspaceGeneration(port, prepared.drafts[0], 'unknown', 'ask')).status, 'uncertain');
  assert.throws(() => prepareLegacyShotGeneration(data, ['a'], 'image'), /勿重复提交/);
  assert.throws(() => prepareLegacyShotGeneration(data, ['b', 'a'], 'image'), /勿重复提交/);
  assert.equal(calls, 1);
});

test('old generateShot/generateAll are adapters only, not independent execution or output-copy paths', () => {
  const source = readFileSync(new URL('../../stores/workshopStore.ts', import.meta.url), 'utf8');
  const start = source.indexOf('  generateShot: async');
  const section = source.slice(start, source.indexOf('  cancelShot:', start));
  assert.match(section, /generateLegacyShots/); assert.match(section, /generateWorkspaceDraft/);
  assert.doesNotMatch(section, /runGeneration\(|copyIntoProject|trimAudioPathsToFit|skipPromptValidation|imagePath:|videoPath:/);
});

test('batch joins shared FIFO in stable target order, rejects stale clicks, and reports only completed outcomes', async () => {
  let data = fixture(); let generated = 0; let id = 0;
  const queue = new ConfirmationQueue<string>();
  const port: WorkspaceGenerationPort = { readProject: () => data, publish: (_b, next) => { data = next; return true; },
    persist: async () => {}, confirm: (snapshot) => queue.request(snapshot.objectId), bindTask: () => {},
    runGeneration: async () => ({ success: true, taskId: `t-${++generated}`, resultPaths: [`/candidate-${generated}.png`], resultUrls: [] }) };
  const batch = generateLegacyShots({ apply: (_projectId, command) => { data = command(data)!; return true; },
    generate: (draft) => submitWorkspaceGeneration(port, draft, `s-${++id}`, 'ask') }, data.projectId, ['b', 'a'], 'image');
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(queue.getSnapshot().pending.map((item) => item.payload), ['shot:b', 'shot:a']);
  assert.equal(generated, 0);
  const [first, second] = queue.getSnapshot().pending;
  queue.decide(second.id, true); assert.equal(queue.getSnapshot().pending.length, 2);
  queue.decide(first.id, false); queue.decide(first.id, true);
  assert.equal(generated, 0); queue.decide(second.id, true);
  await batch; assert.equal(generated, 1);
  assert.equal(data.workspaceSubmissions!['s-1'].status, 'cancelled');
  assert.equal(data.workspaceSubmissions!['s-2'].draft.objectId, 'shot:a');
});

test('production store buttons use real shared runtime/FIFO: cancellation, stable batch binding, candidates and uncertain duplicate guard (offline)', async () => {
  const queue = new ConfirmationQueue<any>(); let calls = 0; let saves = 0; let uncertain = false; let activeId = 'legacy-shots';
  let canvas: any = { nodes: [], edges: [], selectedNodeId: null };
  let taskList: any[] = [];
  const p = { unified: { getState: () => ({ activeId }) },
    canvas: { getState: () => canvas, setState: (patch: object) => { canvas = { ...canvas, ...patch }; } },
    project: { getState: () => ({ activeProjectId: 'canvas', projects: [] }) },
    tasks: { getState: () => ({ tasks: taskList, updateTask: (id: string, patch: object) => { taskList = taskList.map((task) => task.id === id ? { ...task, ...patch } : task); } }) },
    confirm: { getState: () => ({ requestConfirm: (_name: string, params: any, _reason: any, options: any) => queue.request(params, options) }) },
    generate: async (request: any) => {
      calls++; const id = `native-${calls}`; assert.equal(request.strictPaidSafety, true); assert.equal(request.workshopShotNo, undefined);
      taskList.push({ id, status: 'running', resultPaths: [], workspaceBinding: request.workspaceBinding }); request.onTaskCreated(id);
      return { success: !uncertain, taskId: id, resultPaths: uncertain ? [] : [`/new-${calls}.png`], resultUrls: [], submissionUncertain: uncertain };
    } };
  (globalThis as any).__legacyStorePorts = p;
  try {
    const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../../../', import.meta.url)), entryPoints: ['src/stores/workshopStore.ts'],
      bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'offline-legacy-store', setup(b) {
        const map: Record<string, string> = {
          zustand: `export const create=init=>{let state;const store=f=>f(state);store.getState=()=>state;store.setState=patch=>{state={...state,...patch}};store.subscribe=()=>()=>{};state=init(store.setState,store.getState);return store;};`,
          './unifiedProjectStore': 'export const useUnifiedProjectStore=p.unified;',
          '@/stores/unifiedProjectStore': 'export const useUnifiedProjectStore=p.unified;',
          '@/stores/canvasStore': 'export const useCanvasStore=p.canvas;', '@/stores/projectStore': 'export const useProjectStore=p.project;',
          '@/stores/canvasTaskStore': 'export const useCanvasTaskStore=p.tasks;', '@/stores/toolConfirmStore': 'export const useToolConfirmStore=p.confirm;',
          '@/lib/canvasGen': 'export const runGeneration=p.generate; export const abortCanvasTask=()=>{throw Error("unexpected abort")};',
          '@/lib/agent/tools/canvasGenerateTool': 'export const canvasGenerateTool={risk:"ask"};',
          '@/lib/styleLibrary': 'export const loadStyleLibrary=()=>{throw Error("unexpected style read")};',
          '@/lib/videoPrompt/prompt': 'export const writeGlobalVideoPromptTemplate=()=>{};',
          '@tauri-apps/api/fs': 'const fail=()=>{throw Error("filesystem access forbidden")};export const copyFile=fail,createDir=fail,exists=fail,readBinaryFile=fail; export const BaseDirectory={Home:0};',
          '@tauri-apps/api/path': 'export const homeDir=()=>{throw Error("home access forbidden")};',
          '@tauri-apps/api/tauri': 'export const convertFileSrc=s=>s; export const invoke=()=>{throw Error("native access forbidden")};',
          '@tauri-apps/api/http': 'export const ResponseType={Binary:0}; export const fetch=()=>{throw Error("network access forbidden")};',
          '@/lib/aigc/projectStore': 'const fail=()=>{throw Error("project filesystem forbidden")}; export const createProject=fail,readProject=fail,readProjectFile=fail,writeProject=fail,writeProjectFile=fail;',
        };
        b.onResolve({ filter: /.*/ }, ({ path }) => map[path] ? { path, namespace: 'mock' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => ({ contents: `const p=globalThis.__legacyStorePorts; ${map[path]}`, loader: 'js' }));
      } }] });
    const { useWorkshopStore: store } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    store.setState({ project: { id: activeId }, data: { ...fixture(), canvasProjectId: 'canvas' }, scheduleSave: () => {}, commitNow: async (options: any) => {
      assert.equal(options?.requireSuccess, true); saves++;
    } });
    const cancel = store.getState().generateShot('1', 'image');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(calls, 0); assert.equal(queue.getSnapshot().pending.length, 1);
    queue.decide(queue.getSnapshot().pending[0].id, false); await cancel; assert.equal(calls, 0);
    const batch = store.getState().generateAll('image', false);
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(queue.getSnapshot().pending.length, 2); assert.equal(calls, 0);
    const [first, second] = queue.getSnapshot().pending;
    queue.decide(first.id, false); queue.decide(second.id, true); await batch;
    assert.equal(calls, 1); assert.ok(saves >= 3);
    assert.equal(taskList[0].workspaceBinding.snapshot.objectId, 'shot:b');
    assert.equal(store.getState().data.shots[1].imagePath, '/adopted-b.png');
    assert.equal(store.getState().data.projectObjects.media.find((media: any) => media.path === '/new-1.png').purpose, 'candidate-version');
    uncertain = true;
    const unknown = store.getState().generateShot('1', 'image');
    const rejected = assert.rejects(unknown, /生成未完成|原任务/);
    await new Promise((resolve) => setImmediate(resolve));
    queue.decide(queue.getSnapshot().pending[0].id, true); await rejected;
    await assert.rejects(store.getState().generateShot('1', 'image'), /勿重复提交/); assert.equal(calls, 2);
    activeId = 'other'; await assert.rejects(store.getState().generateAll('image', false), /项目已经切换/); assert.equal(calls, 2);
    activeId = 'legacy-shots';
    store.getState().removeShot('1');
    assert.deepEqual(store.getState().data.shots.map((shot: any) => shot.id), ['b']);
    assert.equal(store.getState().data.projectSnapshots.length, 1);
  } finally { delete (globalThis as any).__legacyStorePorts; }
});
