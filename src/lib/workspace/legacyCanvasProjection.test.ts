import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { saveWorkspaceDraft } from './drafts.ts';
import { legacyShotDraft } from './legacyShotReferences.ts';
import { projectLegacyCanvas } from './legacyCanvasProjection.ts';
import { collectReferencesFromSnapshot } from '../canvas/collectRefsModel.ts';
import type { ProjectCommandState } from '../projectObjects/projectCommands.ts';
import { selectProjectVersionCommand } from '../projectObjects/projectCommands.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

function fixture(): ProjectCommandState {
  return { workshop: migrateWorkshopProjectObjects({ ...emptyWorkshopData('projection'), canvasProjectId: 'canvas', characters: [
    { id: 'a', name: 'A', appearance: '', personality: '', assetImagePath: '/a.png', voicePath: '/a.wav', assetPrompt: '资产词' },
  ], shots: [{ id: 's', shotNo: '1', description: '事实', characterIds: ['a'], voiceCharacterIds: ['a'], directorPrevisVideoPaths: ['/previs.mp4'],
    videoPrompt: '@图片一 人物 @视频一 调度 @音频一 台词', videoPath: '/adopted.mp4' }] }, 1), canvas: { nodes: [], edges: [] } };
}

test('one pure canvas projection materializes visible draft with collector-exact multimodal references; no adoption or file operations', () => {
  const before = fixture(); const bytes = JSON.stringify(before);
  const next = projectLegacyCanvas(before, 'shots', undefined, 2);
  assert.equal(next.created, 1); assert.equal(next.conflicts, 0);
  const target = next.canvas.nodes.find((node) => node.data.projectObjectId === 'shot:s')!;
  const collected = collectReferencesFromSnapshot(target.id, next.canvas);
  assert.deepEqual([...collected.images, ...collected.videos, ...collected.audios].map((ref) => ref.submitUrl), ['/a.png', '/previs.mp4', '/a.wav']);
  assert.equal(target.data.description, next.workshop.workspaceDrafts!['shot:s::video'].prompt);
  assert.equal(next.workshop.shots[0].videoPath, '/adopted.mp4'); assert.equal(next.workshop.shots[0].canvasNodeId, undefined);
  assert.equal(JSON.stringify(before), bytes);
  const replay = projectLegacyCanvas(next, 'shots', undefined, 3);
  assert.equal(replay.created, 0); assert.equal(replay.updated, 1);
  assert.deepEqual(replay.canvas, next.canvas);
  assert.equal(replay.workshop.workspaceDrafts, next.workshop.workspaceDrafts);
});

test('shot projection adds cast relation edges to existing asset nodes; edges are non-reference and idempotent', () => {
  const withAssets = projectLegacyCanvas(fixture(), 'assets', undefined, 2);
  const assetNode = withAssets.canvas.nodes.find((node) => node.data.projectObjectId === 'character:a')!;
  assert.ok(assetNode, 'asset node projected');
  const next = projectLegacyCanvas(withAssets, 'shots', undefined, 3);
  const shotNode = next.canvas.nodes.find((node) => node.data.projectObjectId === 'shot:s')!;
  const castEdges = next.canvas.edges.filter((edge) => (edge.data as { relation?: string })?.relation === 'workshop-cast');
  assert.equal(castEdges.length, 1);
  assert.equal(castEdges[0].source, assetNode.id); assert.equal(castEdges[0].target, shotNode.id);
  // 关系连线不参与参考收集：镜头节点收集到的参考与无连线时完全一致
  const collected = collectReferencesFromSnapshot(shotNode.id, next.canvas);
  assert.deepEqual([...collected.images, ...collected.videos, ...collected.audios].map((ref) => ref.submitUrl), ['/a.png', '/previs.mp4', '/a.wav']);
  // 幂等：重复投影不重复加线
  const replay = projectLegacyCanvas(next, 'shots', undefined, 4);
  assert.equal(replay.canvas.edges.filter((edge) => (edge.data as { relation?: string })?.relation === 'workshop-cast').length, 1);
  // 换角后旧线被重建替换，不留过时关系
  replay.workshop.shots[0] = { ...replay.workshop.shots[0], characterIds: [] };
  const recast = projectLegacyCanvas(replay, 'shots', undefined, 5);
  assert.equal(recast.canvas.edges.filter((edge) => (edge.data as { relation?: string })?.relation === 'workshop-cast').length, 0);
});

test('renumbering reuses stable node identity and layout; new draft projects without altering media/task history', () => {
  const initial = projectLegacyCanvas(fixture(), 'shots', undefined, 2);
  const target = initial.canvas.nodes.find((node) => node.data.projectObjectId === 'shot:s')!;
  target.position = { x: -40, y: 90 };
  initial.workshop.shots[0].shotNo = '99';
  const draft = legacyShotDraft(initial.workshop, initial.workshop.shots[0], 'video')!;
  const workshop = saveWorkspaceDraft(initial.workshop, { ...draft, prompt: '新可见草稿', references: [] }, draft.revision, 3)!;
  const next = projectLegacyCanvas({ ...initial, workshop }, 'shots', undefined, 4);
  assert.equal(next.created, 0); assert.equal(next.updated, 1);
  const node = next.canvas.nodes.find((item) => item.id === target.id)!;
  assert.equal(node.data.workshopRef.shotNoSnapshot, '99'); assert.deepEqual(node.position, target.position);
  assert.equal(node.data.description, '新可见草稿'); assert.equal(next.canvas.edges.length, 0);
  assert.deepEqual(next.workshop.projectObjects?.media, workshop.projectObjects?.media);
});

test('professional edits, unmanaged references, active tasks and unknown outputs remain conflicts, not overwritten', () => {
  const initial = projectLegacyCanvas(fixture(), 'shots', undefined, 2);
  for (const field of [{ description: '专业编辑未保存' }, { isGenerating: true }, { localPath: '/unimported.mp4' },
    { referenceImages: [{ url: '/manual.png' }] }]) {
    const state = { ...initial, canvas: { ...initial.canvas, nodes: initial.canvas.nodes.map((node) => node.data.projectObjectId === 'shot:s'
      ? { ...node, data: { ...node.data, ...field } } : node) } };
    const next = projectLegacyCanvas(state, 'shots');
    assert.equal(next.conflicts, 1); assert.equal(next.canvas, state.canvas);
  }
  const target = initial.canvas.nodes.find((node) => node.data.projectObjectId === 'shot:s')!;
  const withEdge = { ...initial, canvas: { ...initial.canvas, edges: [...initial.canvas.edges, { id: 'manual', source: 'external', target: target.id }] } };
  assert.equal(projectLegacyCanvas(withEdge, 'shots').conflicts, 1);
});

test('assets only project the selected image media and current draft; candidates stay separate', () => {
  const initial = fixture(); const result = projectLegacyCanvas(initial, 'assets');
  assert.equal(result.created, 1); const node = result.canvas.nodes[0];
  assert.equal(node.data.localPath, '/a.png'); assert.equal(node.data.description, '资产词');
  assert.equal(node.data.mediaPurpose, 'current-version');
  const candidate = { ...node, data: { ...node.data, mediaPurpose: 'candidate-version' } };
  const conflict = projectLegacyCanvas({ ...result, canvas: { nodes: [candidate], edges: [] } }, 'assets');
  assert.equal(conflict.conflicts, 1); assert.equal(conflict.canvas.nodes[0], candidate);
});

test('projection refuses collector-incompatible self-output references instead of silently dropping them', () => {
  const before = fixture();
  const version = before.workshop.projectObjects!.versions.find((item) => item.ownerObjectId === 'shot:s')!;
  const initial = selectProjectVersionCommand(before, 'shot:s', version.id)!;
  const draft = legacyShotDraft(initial.workshop, initial.workshop.shots[0], 'video')!;
  const workshop = saveWorkspaceDraft(initial.workshop, { ...draft, prompt: '@视频一 明确引用',
    references: [{ id: 'self', type: 'video', path: '/adopted.mp4', label: '自身版本' }] }, 0)!;
  const result = projectLegacyCanvas({ ...initial, workshop }, 'shots');
  assert.equal(result.conflicts, 1); assert.equal(result.created, 0); assert.equal(result.canvas.nodes.length, 0);
  assert.deepEqual(result.workshop.workspaceDrafts, workshop.workspaceDrafts);
});

test('production projection publishes one guarded business command and one synchronous canvas snapshot (offline)', async () => {
  const initial = fixture(); let data = initial.workshop; let canvas = { ...initial.canvas, selectedNodeId: null }; let writes = 0; let canvasWrites = 0;
  let activeProjectId = 'canvas'; let flushes = 0;
  const ports = { workshop: { getState: () => ({ project: { id: data.projectId }, data }) },
    canvas: { getState: () => canvas, setState: (next: typeof canvas) => { canvas = { ...canvas, ...next }; canvasWrites++; } },
    project: { getState: () => ({ activeProjectId, projects: [], flushActiveCanvas: async () => { flushes++; } }) },
    apply: (_id: string, command: (current: typeof data) => typeof data | null) => { const next = command(data); if (!next) return false; data = next; writes++; return true; } };
  (globalThis as any).__legacyProjectionPorts = ports;
  try {
    const bundle = await build({ absWorkingDir: fileURLToPath(new URL('../../../', import.meta.url)), entryPoints: ['src/lib/workshop/canvasSync.ts'],
      bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'offline-projection', setup(b) {
        b.onResolve({ filter: /^(@\/stores\/|@tauri-apps\/api\/|@\/lib\/(canvas\/collectRefs|canvas\/imageSource|workspace\/runtime)$)/ }, ({ path }) => ({ path, namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
          const map: Record<string, string> = { '@/stores/workshopStore': 'export const useWorkshopStore=p.workshop;',
            '@/stores/canvasStore': 'export const useCanvasStore=p.canvas;', '@/stores/projectStore': 'export const useProjectStore=p.project;',
            '@/lib/workspace/runtime': 'export const applyWorkspaceProjectCommand=p.apply;', '@tauri-apps/api/tauri': 'export const convertFileSrc=s=>s;',
            '@/lib/canvas/collectRefs': 'export const collectNodeReferences=()=>({images:[],videos:[],audios:[]});',
            '@/lib/canvas/imageSource': 'export const assetUrlToLocalPath=()=>null;' };
          assert.ok(map[path], path); return { contents: `const p=globalThis.__legacyProjectionPorts; ${map[path]}`, loader: 'js' };
        });
      } }] });
    const module = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    assert.match(await module.syncShotPromptsToCanvas(), /新建 1 个/);
    assert.equal(writes, 1); assert.equal(canvasWrites, 1); assert.equal(flushes, 1);
    activeProjectId = 'other'; assert.match(await module.syncAssetsToCanvas(), /不属于此项目/);
    assert.equal(writes, 1); assert.equal(canvasWrites, 1);
  } finally { delete (globalThis as any).__legacyProjectionPorts; }
});
