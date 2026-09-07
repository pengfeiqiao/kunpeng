import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from 'reactflow';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { collectReferencesFromSnapshot } from '../canvas/collectRefsModel.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { importLegacyCanvasObjects } from './legacyCanvasImport.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const fixture = () => migrateWorkshopProjectObjects({ ...emptyWorkshopData('legacy-import'), characters: [
  { id: 'driver', name: '司机', appearance: '', personality: '', assetImagePath: '/driver.png', voicePath: '/voice.wav' },
], shots: [{ id: 'original', shotNo: '01', description: '司机开车', dialogue: '停车', characterIds: ['driver'], videoPath: '/adopted.mp4', imagePath: '/adopted.png', videoPrompt: '原视频词' }] }, 1);
const node = (data: Record<string, unknown> = {}, type = 'video'): Node => ({ id: 'node', type, position: { x: 10, y: 20 },
  data: { localPath: '/candidate.mp4', description: '', workshopRef: { projectId: 'legacy-import', kind: 'shot', role: 'shot-video', id: '01', shotId: 'original' }, ...data } });

test('legacy canvas import produces stable candidates without changing adopted paths, dialogue, references or node bytes', () => {
  const before = fixture(); const nodes = [node(), { ...node({ localPath: '/candidate.png' }, 'image'), id: 'image' }];
  const bytes = JSON.stringify(nodes);
  const result = importLegacyCanvasObjects(before, nodes, {}, 2);
  assert.equal(result.candidates, 2); assert.deepEqual(result.data.shots, before.shots);
  assert.deepEqual(result.data.characters, before.characters); assert.equal(JSON.stringify(nodes), bytes);
  const candidates = result.data.projectObjects!.media.filter((item) => item.path.startsWith('/candidate'));
  assert.ok(candidates.every((item) => item.purpose === 'candidate-version' && item.ownerObjectId === 'shot:original'));
  assert.ok(result.data.projectObjects!.versions.filter((item) => candidates.some((m) => m.id === item.mediaObjectId)).every((item) => !item.selected && !item.generationSnapshot));
  const replay = importLegacyCanvasObjects(result.data, nodes, {}, 3);
  assert.equal(replay.candidates, 0); assert.equal(replay.data.projectObjects!.media.length, result.data.projectObjects!.media.length);
});

test('legacy prompt imports use collector order, not asset ownership or narrative edges; never change script fields', () => {
  const before = fixture(); const target = node({ description: '@图片一 对应公路，@图片二 对应司机' });
  const nodes = [target, { ...node({ generatedImageUrl: '/road.png' }, 'image'), id: 'road' }, { ...node({ generatedImageUrl: '/driver.png' }, 'image'), id: 'driver' }];
  const refs = collectReferencesFromSnapshot('node', { nodes, edges: [
    { id: 'ownership', source: 'driver', target: 'node', data: { relation: 'ownership' } },
    { id: 'order', source: 'driver', target: 'node', data: { relation: 'narrative-order' } },
    { id: 'r1', source: 'road', target: 'node', data: { relation: 'reference' } },
    { id: 'r2', source: 'driver', target: 'node' },
  ] });
  const result = importLegacyCanvasObjects(before, [target], { node: refs.images.map((r, i) => ({ id: String(i), type: 'image', path: r.submitUrl, label: r.url })) }, 2);
  assert.equal(result.prompts, 1);
  assert.deepEqual(result.data.workspaceDrafts!['shot:original::video'].references.map((r) => r.path), ['/road.png', '/driver.png']);
  assert.equal(result.data.workspaceDrafts!['shot:original::video'].prompt, target.data.description);
  assert.deepEqual(result.data.shots.map(({ videoPrompt: _prompt, workspaceReferenceProjection: _refs, ...facts }) => facts),
    before.shots.map(({ videoPrompt: _prompt, workspaceReferenceProjection: _refs, ...facts }) => facts));
  assert.equal(result.data.shots[0].videoPrompt, target.data.description);
  assert.deepEqual(result.data.shots[0].workspaceReferenceProjection?.video, result.data.workspaceDrafts!['shot:original::video'].references);
});

test('existing draft and submitted snapshot survive differing legacy prompt import; missing mentions are not silently renumbered', () => {
  const before = fixture(); const initial = initialWorkspaceDraft(before, 'shot:original', 'video')!;
  const saved = saveWorkspaceDraft(before, { ...initial, prompt: '用户最新草稿' }, 0)!;
  const result = importLegacyCanvasObjects(saved, [node({ description: '画布旧稿' })], {}, 3);
  assert.equal(result.conflicts, 1); assert.equal(result.prompts, 0);
  assert.equal(result.data.workspaceDrafts, saved.workspaceDrafts);
  assert.equal(result.data.workspaceSubmissions, saved.workspaceSubmissions);
  const invalid = importLegacyCanvasObjects(before, [node({ description: '@图片五 不存在' })], {}, 3);
  assert.equal(invalid.conflicts, 1); assert.equal(invalid.prompts, 0);
});

test('stable shot identity survives renumbering; missing/deleted IDs never attach output to a reused shot number', () => {
  const before = fixture(); before.shots[0].shotNo = '99';
  const result = importLegacyCanvasObjects(before, [node()], {}, 2);
  assert.equal(result.candidates, 1);
  for (const bad of [node({ projectObjectId: 'shot:deleted' }), node({ workshopRef: { projectId: 'legacy-import', kind: 'shot', role: 'shot-video', id: '99', shotId: 'deleted' } }),
    node({ workshopRef: { projectId: 'other', kind: 'shot', role: 'shot-video', id: '99', shotId: 'original' } })]) {
    assert.equal(importLegacyCanvasObjects(before, [bad], {}, 2).candidates, 0);
  }
  const locked = { ...before, projectObjects: { ...before.projectObjects!, objects: before.projectObjects!.objects.map((item) => ({ ...item, locked: true })) } };
  assert.equal(importLegacyCanvasObjects(locked, [node()], {}, 2).candidates, 0);
});

test('reference-only nodes and audio adjacency cannot become owned outputs or overwrite a character voice', () => {
  const before = fixture();
  const result = importLegacyCanvasObjects(before, [node({ workshopPromptRefTarget: 'other' }, 'image'),
    node({ workshopRef: { projectId: 'legacy-import', kind: 'character', role: 'prompt-reference', id: 'driver' } }, 'image'),
    node({ workshopRef: undefined, localPath: '/new-voice.wav' }, 'audio')], {}, 2);
  assert.equal(result.candidates, 0); assert.equal(result.data.characters[0].voicePath, '/voice.wav');
});

test('production pull adapter uses one guarded command, never copies files or infers voice ownership; wrong canvas is rejected (offline)', async () => {
  let data = { ...fixture(), canvasProjectId: 'canvas' };
  let activeCanvas = 'canvas'; let writes = 0; let collections = 0;
  const nodes = [node({ description: '司机保持原动作' })];
  const ports = {
    workshop: { getState: () => ({ project: { id: data.projectId }, data }) },
    canvas: { getState: () => ({ nodes, edges: [] }) },
    project: { getState: () => ({ activeProjectId: activeCanvas, projects: [] }) },
    collect: () => { collections++; return { images: [], videos: [], audios: [] }; },
    apply: (id: string, command: (current: typeof data) => typeof data | null) => {
      assert.equal(id, data.projectId); const next = command(data); if (!next) return false; writes++; data = next; return true;
    },
  };
  (globalThis as any).__canvasImportPorts = ports;
  try {
    const output = await build({ absWorkingDir: fileURLToPath(new URL('../../../', import.meta.url)), entryPoints: ['src/lib/workshop/canvasSync.ts'],
      bundle: true, write: false, platform: 'node', format: 'esm', plugins: [{ name: 'offline-import-ports', setup(b) {
        b.onResolve({ filter: /^(@\/stores\/|@tauri-apps\/api\/|@\/lib\/(canvas\/layout|canvas\/collectRefs|canvas\/imageSource|workspace\/runtime)$)/ }, ({ path }) => ({ path, namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, ({ path }) => {
          const mappings: Record<string, string> = { '@/stores/workshopStore': 'export const useWorkshopStore=p.workshop;',
            '@/stores/canvasStore': 'export const useCanvasStore=p.canvas;', '@/stores/projectStore': 'export const useProjectStore=p.project;',
            '@/lib/canvas/collectRefs': 'export const collectNodeReferences=p.collect;', '@/lib/canvas/imageSource': 'export const assetUrlToLocalPath=()=>null;',
            '@/lib/workspace/runtime': 'export const applyWorkspaceProjectCommand=p.apply;', '@/lib/canvas/layout': 'export const defaultNodeStyle=()=>({});',
            '@tauri-apps/api/tauri': 'export const convertFileSrc=s=>s;' };
          assert.ok(mappings[path], `Unexpected filesystem/platform import: ${path}`);
          return { contents: `const p=globalThis.__canvasImportPorts; ${mappings[path]}`, loader: 'js' };
        });
      } }] });
    const module = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
    assert.match(await module.pullFromCanvas(), /1 个候选版本、1 份工作台草稿/);
    assert.equal(writes, 1); assert.equal(collections, 1); assert.equal(data.shots[0].videoPath, '/adopted.mp4');
    assert.equal(data.workspaceDrafts!['shot:original::video'].prompt, '司机保持原动作');
    activeCanvas = 'other';
    assert.match(await module.pullFromCanvas(), /不属于此项目/);
    assert.equal(writes, 1); assert.equal(collections, 1);
  } finally { delete (globalThis as any).__canvasImportPorts; }
});
