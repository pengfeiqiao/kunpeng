import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { registerCanvasGeneration } from '../projectObjects/selectors.ts';

test('explicit professional data command publishes synchronously without global ingress; free/runtime store paths remain local (offline)', async () => {
  let workshop = migrateWorkshopProjectObjects({ ...emptyWorkshopData('professional-runtime'), canvasProjectId: 'canvas',
    shots: [{ id: 's', shotNo: '01', description: '事实', characterIds: [], imagePrompt: '原词' }] }, 1);
  let activeProjectId = 'canvas'; let writes = 0; let reject = false;
  const ports = { workshop: { getState: () => ({ project: { id: workshop.projectId }, data: workshop }) },
    project: { getState: () => ({ activeProjectId, projects: [], switching: false }) },
    apply: (_id: string, command: (data: typeof workshop) => typeof workshop | null) => {
      if (reject) return false;
      const next = command(workshop); if (!next) return false; workshop = next; writes++; return true;
    } };
  (globalThis as any).__professionalPorts = ports;
  const oldWindow = (globalThis as any).window;
  (globalThis as any).window = { addEventListener() {} };
  try {
    const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../../../', import.meta.url)),
      stdin: { contents: "export {useCanvasStore} from './src/stores/canvasStore'; export {assignProfessionalCanvasMedia, updateProfessionalCanvasNode} from './src/lib/workspace/professionalCanvasRuntime';", resolveDir: fileURLToPath(new URL('../../../', import.meta.url)), loader: 'ts' },
      bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'offline-professional-store', setup(b) {
        const mocks: Record<string, string> = {
          zustand: `export const create=()=>init=>{let state;const store=f=>f(state);store.getState=()=>state;store.setState=patch=>{const next=typeof patch==='function'?patch(state):patch;state={...state,...next}};store.subscribe=()=>()=>{};state=init(store.setState,store.getState,store);return store;};`,
          'zustand/middleware': 'export const persist=(init)=>init;',
          reactflow: 'export const applyNodeChanges=(_,nodes)=>nodes;export const applyEdgeChanges=(_,edges)=>edges;export const addEdge=(edge,edges)=>[...edges,edge];',
          nanoid: "export const nanoid=()=> 'offline-id';",
          '@/lib/canvas/assetPersist': 'export const migrateNodeImages=async()=>null;',
          '@/lib/safeStorage': 'export const safeLocalStorage={getItem:()=>null,setItem:()=>{}};',
          '@/lib/performance/coalescedIdleWork': 'export class CoalescedIdleWork {schedule(){} cancel(){} flush(){}}',
          '@/stores/workshopStore': 'export const useWorkshopStore=globalThis.__professionalPorts.workshop;',
          '@/stores/projectStore': 'export const useProjectStore=globalThis.__professionalPorts.project;',
          '@/lib/workspace/runtime': 'export const applyWorkspaceProjectCommand=globalThis.__professionalPorts.apply;',
          '../canvas/imageSource': 'export const assetUrlToLocalPath=()=>null;',
        };
        b.onResolve({ filter: /.*/ }, ({ path }) => path in mocks ? { path, namespace: 'offline' } : undefined);
        b.onLoad({ filter: /.*/, namespace: 'offline' }, ({ path }) => ({ contents: mocks[path], loader: 'js' }));
      } }] });
    const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    const store = module.useCanvasStore;
    const explicitEdit = (id: string, patch: Record<string, unknown>) => module.updateProfessionalCanvasNode(
      store.getState().nodes.find((node: { id: string }) => node.id === id), patch,
    );
    store.setState({ nodes: [{ id: 'bound', type: 'image', position: { x: 0, y: 0 }, data: { projectObjectId: 'shot:s', description: '原词' } },
      { id: 'free', type: 'image', position: { x: 0, y: 0 }, data: { description: '自由', generatedImageUrl: '/old.png' } }], edges: [] });
    assert.equal(explicitEdit('bound', { description: '共享词' }), true);
    assert.equal(writes, 1); assert.equal(workshop.workspaceDrafts!['shot:s::image'].prompt, '共享词');
    assert.equal(store.getState().nodes[0].data.description, '共享词');
    const freeBefore = store.getState().nodes;
    assert.equal(explicitEdit('free', { description: '自由新词', generatedImageUrl: '/new.png' }), false);
    assert.equal(store.getState().nodes, freeBefore);
    store.getState().updateNode('free', { description: '自由新词', generatedImageUrl: '/new.png' });
    assert.equal(writes, 1); assert.equal(store.getState().nodes[1].data.generationHistory[0].url, '/old.png');
    assert.equal(store.getState().nodes[1].data.description, '自由新词');
    const runtimeBefore = store.getState().nodes;
    assert.equal(explicitEdit('bound', { isGenerating: true }), false);
    assert.equal(store.getState().nodes, runtimeBefore);
    store.getState().updateNode('bound', { isGenerating: true }); assert.equal(writes, 1);
    assert.equal(store.getState().nodes[0].data.isGenerating, true);
    assert.throws(() => explicitEdit('bound', { description: '覆盖' }), /生成中/);
    assert.equal(store.getState().nodes[0].data.description, '共享词');
    store.getState().updateNode('bound', { isGenerating: false });
    const previous = store.getState().nodes;
    reject = true;
    assert.throws(() => explicitEdit('bound', { description: '失败覆盖' }), /已改变/);
    assert.equal(store.getState().nodes, previous); assert.equal(writes, 1);
    reject = false; activeProjectId = 'other';
    assert.throws(() => explicitEdit('bound', { description: '跨项目覆盖' }), /不属于/);
    assert.equal(store.getState().nodes, previous);
    assert.throws(() => explicitEdit('bound', { projectObjectId: undefined, description: '绕过' }), /绑定元数据/);
    assert.equal(store.getState().nodes, previous); assert.equal(writes, 1);
    activeProjectId = 'canvas';
    // The explicit data interface is not a global updateNode guard: normal metadata receipts remain writable.
    const receipt = { projectId: workshop.projectId, objectId: 'shot:s' };
    store.getState().updateNode('bound', { workshopRef: receipt });
    assert.equal(store.getState().nodes[0].data.workshopRef, receipt); assert.equal(writes, 1);
    workshop = registerCanvasGeneration(workshop, { nodeId: 'candidate', taskId: 'old-task', mediaType: 'image', paths: ['/candidate.png'] }, 3).data;
    const media = workshop.projectObjects!.media.find((item) => item.path === '/candidate.png')!;
    const owner = workshop.projectObjects!.objects.find((item) => item.id === 'shot:s')!;
    store.setState({ nodes: [...store.getState().nodes, { id: 'candidate', type: 'image', position: { x: 1, y: 2 }, data: { generatedImageUrl: media.path } }] });
    const input = { mediaId: media.id, ownerId: owner.id, expectedMediaVersion: media.version, expectedOwnerVersion: owner.version };
    assert.throws(() => module.assignProfessionalCanvasMedia('other', input), /项目已切换/);
    assert.equal(writes, 1);
    module.assignProfessionalCanvasMedia(workshop.projectId, input);
    assert.equal(writes, 2); assert.equal(store.getState().nodes[2].data.projectObjectId, 'shot:s');
    assert.equal(store.getState().nodes[2].data.mediaPurpose, 'candidate-version');
    assert.throws(() => module.assignProfessionalCanvasMedia(workshop.projectId, input), /已改变/);
    assert.equal(writes, 2);
  } finally {
    delete (globalThis as any).__professionalPorts;
    if (oldWindow === undefined) delete (globalThis as any).window; else (globalThis as any).window = oldWindow;
  }
});
