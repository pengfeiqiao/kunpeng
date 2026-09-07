import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as types from '../lib/workshop/types.ts';
import * as migration from '../lib/projectObjects/migrate.ts';
import * as shotEdits from '../lib/workspace/shotEdits.ts';
import * as assetEdits from '../lib/workspace/assetEdits.ts';
import * as shotReferences from '../lib/workspace/legacyShotReferences.ts';
import * as shotReplacement from '../lib/workspace/legacyShotReplacement.ts';
import { projectChangedProfessionalDrafts, professionalDraftFields } from '../lib/workspace/professionalDraftProjection.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from '../lib/workspace/drafts.ts';

function fixture() {
  let state; let activeId = 'p'; let reject = false; let publications = 0; let globalTemplateWrites = 0;
  let nodes = [];
  const set = (patch) => { state = { ...state, ...(typeof patch === 'function' ? patch(state) : patch) }; };
  const store = { getState: () => state, setState: set };
  const modules = {
    zustand: { create: (init) => { state = init(set, store.getState); return store; } },
    './unifiedProjectStore': { useUnifiedProjectStore: { getState: () => ({ activeId }) } },
    '@/lib/workspace/shotEdits': shotEdits,
    '@/lib/workspace/assetEdits': assetEdits,
    '@/lib/workspace/legacyShotReferences': shotReferences,
    '@/lib/workspace/legacyShotReplacement': shotReplacement,
    '@/lib/workshop/types': types,
    '@/lib/workspace/runtime': { applyWorkspaceProjectCommand: (id, command) => {
      if (reject || id !== state.data.projectId) return false;
      const before = state.data; const after = command(before);
      if (!after) return false;
      nodes = projectChangedProfessionalDrafts(before, after, nodes);
      set({ data: after }); publications++; return true;
    } },
    '@/lib/videoPrompt/prompt': { writeGlobalVideoPromptTemplate: () => { globalTemplateWrites++; } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL('./workshopStore.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  runInNewContext(compiled.outputText, { exports: {}, require: (id) => modules[id] ?? {}, crypto,
    setTimeout: () => { throw new Error('unexpected asynchronous side effect'); }, clearTimeout() {} });
  let data = migration.migrateWorkshopProjectObjects({ ...types.emptyWorkshopData('p'),
    characters: [{ id: 'c', name: '司机', appearance: '原外形', personality: '', assetPrompt: '原资产提示词' }],
    shots: [{ id: 's', shotNo: '01', description: '原事实', dialogue: '原对白', characterIds: ['c'], videoPrompt: '原视频词', imagePrompt: '原图片词' }],
  }, 1);
  for (const [ownerId, type] of [['shot:s', 'video'], ['shot:s', 'image'], ['character:c', 'image']]) {
    const draft = initialWorkspaceDraft(data, ownerId, type, 1);
    data = saveWorkspaceDraft(data, draft, 0, 1);
    const saved = data.workspaceDrafts[draft.id];
    nodes.push({ id: draft.id, type, position: { x: 1, y: 2 }, data: { ...professionalDraftFields(saved), projectObjectId: ownerId,
      workspaceDraftId: draft.id, workspaceProjection: { revision: saved.revision, prompt: saved.prompt } } });
  }
  set({ data, project: { id: 'p' }, scheduleSave() {} });
  return { store, get nodes() { return nodes; }, get publications() { return publications; }, get globalTemplateWrites() { return globalTemplateWrites; },
    active: (id) => { activeId = id; }, reject: () => { reject = true; } };
}

test('original workshop editing actions publish shared drafts and native projections, not independent copies', () => {
  const f = fixture();
  const actions = [
    () => f.store.getState().updateShot('01', { imagePrompt: '新图片词' }),
    () => f.store.getState().setShots([{ id: 's', shotNo: '01', imagePrompt: '批量新图片词' }], 'merge'),
    () => f.store.getState().setAssetPrompt('character', 'c', '新资产提示词'),
    () => f.store.getState().setAssetResolution('character', 'c', '4k'),
    () => f.store.getState().setAssetAspectRatio('character', 'c', '9:16'),
    () => f.store.getState().setAssetEngine('character', 'c', 'gpt-image-2'),
    () => f.store.getState().setVideoRatio('9:16'),
    () => f.store.getState().setVideoModel('seedance-2.5'),
    () => f.store.getState().setVideoPromptTemplate('universal'),
  ];
  for (const [i, action] of actions.entries()) { action(); assert.equal(f.publications, i + 1); }
  const data = f.store.getState().data;
  assert.equal(data.shots[0].description, '原事实'); assert.equal(data.shots[0].dialogue, '原对白');
  assert.equal(data.characters[0].appearance, '原外形');
  assert.equal(f.nodes.find((n) => n.id === 'shot:s::image').data.description, '批量新图片词');
  assert.equal(f.nodes.find((n) => n.id === 'character:c::image').data.description, '新资产提示词');
  assert.equal(f.nodes.find((n) => n.id === 'character:c::image').data.resolution, '4k');
  assert.equal(f.nodes.find((n) => n.id === 'shot:s::video').data.modelVersion, 'dreamina-seedance-2.5');
  assert.equal(f.globalTemplateWrites, 1);
});

test('failed shared publication never falls back to a local copy or mutates the global template', () => {
  const f = fixture(); const before = f.store.getState().data; const nodes = f.nodes;
  f.reject();
  assert.throws(() => f.store.getState().updateShot('01', { imagePrompt: '未批准覆盖' }), /未覆盖/);
  assert.throws(() => f.store.getState().setVideoPromptTemplate('universal'), /未覆盖/);
  assert.equal(f.store.getState().data, before); assert.equal(f.nodes, nodes);
  assert.equal(f.globalTemplateWrites, 0);
});

test('standalone legacy workshop keeps working, but another active project refuses a stale edit', () => {
  const f = fixture(); f.active(null);
  f.store.getState().updateShot('01', { imagePrompt: '独立工坊编辑' });
  assert.equal(f.publications, 0); assert.equal(f.store.getState().data.shots[0].imagePrompt, '独立工坊编辑');
  const before = f.store.getState().data;
  f.active('other');
  assert.throws(() => f.store.getState().updateShot('01', { imagePrompt: '跨项目编辑' }), /项目内容已改变/);
  assert.equal(f.store.getState().data, before);
});
