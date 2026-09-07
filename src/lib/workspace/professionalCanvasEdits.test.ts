import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { saveWorkspaceDraft } from './drafts.ts';
import { legacyShotDraft } from './legacyShotReferences.ts';
import { editProfessionalCanvasCommand, isProfessionalCanvasEdit } from './professionalCanvasEdits.ts';
import { reserveWorkspaceSubmission } from './submissions.ts';
import type { ProjectCommandState } from '../projectObjects/projectCommands.ts';

function fixture(type: 'image' | 'video' = 'image'): ProjectCommandState {
  let workshop = migrateWorkshopProjectObjects({ ...emptyWorkshopData('professional'), canvasProjectId: 'canvas',
    shots: [{ id: 's', shotNo: '01', description: '事实', dialogue: '对白', characterIds: [], imagePrompt: '原图词', videoPrompt: '原视频词' }] }, 1);
  const draft = legacyShotDraft(workshop, workshop.shots[0], type, 2)!;
  workshop = saveWorkspaceDraft(workshop, draft, 0, 2)!;
  return { workshop, canvas: { nodes: [{ id: 'n', type, position: { x: 42, y: 17 }, data: {
    projectObjectId: 'shot:s', description: draft.prompt, workspaceDraftId: draft.id,
    workspaceProjection: { prompt: draft.prompt, revision: 1, referenceImages: [] }, referenceImages: [],
    generationHistory: [{ url: '/prior.png', timestamp: 1 }],
  } }], edges: [] } };
}

test('prompt, engine and native parameters save one shared draft and projection without changing facts, outputs or submitted snapshots', () => {
  const before = fixture(); const draft = before.workshop.workspaceDrafts!['shot:s::image'];
  before.workshop = reserveWorkspaceSubmission(before.workshop, draft, 'frozen', 3)!;
  const bytes = JSON.stringify(before);
  const after = editProfessionalCanvasCommand(before, 'n', { description: '编辑图词', aspectRatio: '9:16', resolution: '4k' }, 4);
  const saved = after.workshop.workspaceDrafts![draft.id];
  assert.equal(saved.prompt, '编辑图词'); assert.equal(saved.revision, 2);
  assert.deepEqual(saved.params, { aspectRatio: '9:16', resolution: '4k' });
  assert.equal(after.workshop.shots[0].description, '事实'); assert.equal(after.workshop.shots[0].dialogue, '对白');
  assert.equal(after.workshop.shots[0].imagePrompt, saved.prompt);
  assert.equal(after.canvas.nodes[0].data.description, saved.prompt);
  assert.equal(after.canvas.nodes[0].data.workspaceProjection.revision, 2);
  assert.equal(after.canvas.nodes[0].position, before.canvas.nodes[0].position);
  assert.equal(after.canvas.nodes[0].data.generationHistory, before.canvas.nodes[0].data.generationHistory);
  assert.equal(after.canvas.edges, before.canvas.edges);
  assert.equal(after.workshop.workspaceSubmissions, before.workshop.workspaceSubmissions);
  assert.equal(after.workshop.projectObjects!.media, before.workshop.projectObjects!.media);
  assert.equal(after.workshop.projectObjects!.versions, before.workshop.projectObjects!.versions);
  assert.equal(JSON.stringify(before), bytes);
  const switched = editProfessionalCanvasCommand(after, 'n', { imageModel: 'midjourney', modelVersion: 'v8.2', midjourneyStylize: 250 }, 5);
  assert.equal(switched.workshop.workspaceDrafts![draft.id].engineId, 'midjourney-v8.2');
  assert.equal(switched.workshop.workspaceDrafts![draft.id].params.stylize, 250);
  assert.equal(switched.canvas.nodes[0].data.imageModel, 'midjourney');
  assert.equal(switched.canvas.nodes[0].data.resolution, undefined);
  const second = editProfessionalCanvasCommand(switched, 'n', { midjourneyChaos: 10 }, 6);
  assert.equal(second.workshop.workspaceDrafts![draft.id].params.chaos, 10);
});

test('video slot, route alias and native ratio map to the same draft with explicit template changes', () => {
  const state = fixture('video');
  const after = editProfessionalCanvasCommand(state, 'n', { modelVersion: 'seedance-2.5', description: '新视频词',
    universalVideoPrompt: '新视频词', videoPromptTemplate: 'universal', aspectRatio: '9:16', duration: 6, resolution: '720p' });
  const draft = after.workshop.workspaceDrafts!['shot:s::video'];
  assert.equal(draft.engineId, 'dreamina-seedance-2.5'); assert.equal(draft.params.ratio, '9:16');
  assert.equal(draft.promptTemplate, 'universal'); assert.equal(draft.params.duration, 6);
  assert.equal(after.canvas.nodes[0].data.universalVideoPrompt, draft.prompt);
  assert.throws(() => editProfessionalCanvasCommand(after, 'n', { videoPromptTemplate: 'legacy' }), /同时提交/);
  assert.throws(() => editProfessionalCanvasCommand(after, 'n', { legacyVideoPrompt: '隐藏词' }), /非当前/);
});

test('free nodes and runtime-only output updates retain legacy behavior; identity removal cannot escape the command', () => {
  const node = fixture().canvas.nodes[0];
  assert.equal(isProfessionalCanvasEdit({ ...node, data: { description: '自由节点' } }, { description: '修改' }), false);
  assert.equal(isProfessionalCanvasEdit(node, { generatedImageUrl: '/result.png', isGenerating: false }), false);
  assert.equal(isProfessionalCanvasEdit(node, { description: node.data.description }), false);
  for (const patch of [{ projectObjectId: undefined, description: '逃逸' }, { mediaObjectId: 'other' }, { workspaceProjection: { revision: 99 } }]) {
    assert.throws(() => isProfessionalCanvasEdit(node, patch), /绑定元数据/);
  }
  assert.throws(() => isProfessionalCanvasEdit({ ...node, data: {} }, { projectObjectId: 'shot:s' }), /绑定元数据/);
});

test('stale revisions, dirty prompt/engine/params and references refuse any partial write', () => {
  for (const data of [{ workspaceProjection: { revision: 0 } }, { description: '另一词' }, { imageModel: 'midjourney' },
    { aspectRatio: '1:1' }, { referenceImages: [{ url: '/unknown.png' }] }, { params: { aspectRatio: '1:1' } },
    { engineId: 'gpt-image-2', imageModel: 'midjourney' }]) {
    const state = fixture(); state.canvas.nodes[0].data = { ...state.canvas.nodes[0].data, ...data };
    const bytes = JSON.stringify(state);
    assert.throws(() => editProfessionalCanvasCommand(state, 'n', { description: '覆盖' }), /冲突|已改变/);
    assert.equal(JSON.stringify(state), bytes);
  }
});

test('projectObjectId never falls back to legacy identity; locked, archived, active and candidate nodes stay protected', () => {
  for (const data of [{ projectObjectId: 'missing', workshopRef: { projectId: 'professional', objectId: 'shot:s' } },
    { workshopRef: { projectId: 'other' } }, { isGenerating: true }, { locked: true }, { archived: true }, { mediaPurpose: 'candidate-version' },
    { workshopRef: { projectId: 'professional', objectId: 'shot:s', shotId: 'other' } },
    { mediaObjectId: 'missing' }, { versionObjectId: 'missing' }, { workshopPromptRefTarget: 'other' }]) {
    const state = fixture(); state.canvas.nodes[0].data = { ...state.canvas.nodes[0].data, ...data };
    assert.throws(() => editProfessionalCanvasCommand(state, 'n', { description: '覆盖' }));
  }
  for (const key of ['locked', 'archived'] as const) {
    const state = fixture(); state.workshop.projectObjects!.objects.find((item) => item.id === 'shot:s')![key] = true;
    assert.throws(() => editProfessionalCanvasCommand(state, 'n', { description: '覆盖' }), /锁定/);
  }
});

test('unsupported specialized settings, invalid values, mixed output writes and conflicting aliases fail closed', () => {
  for (const patch of [{ midjourneyWeird: 10 }, { params: { unknown: true } }, { aspectRatio: 'wrong' },
    { description: 'a', imagePrompt: 'b' }, { description: 'a', generatedImageUrl: '/new.png' },
    { imageModel: 'custom-media:unknown' }, { imageModel: 'midjourney', engineId: 'gpt-image-2' },
    { params: { aspectRatio: '1:1' }, aspectRatio: '9:16' }, { midjourneyStyleId: 'style' }]) {
    const state = fixture(); const bytes = JSON.stringify(state);
    assert.throws(() => editProfessionalCanvasCommand(state, 'n', patch));
    assert.equal(JSON.stringify(state), bytes);
  }
});

test('changing model never silently removes existing multimodal references or substitutes a self output', () => {
  const state = fixture('video'); const draft = state.workshop.workspaceDrafts!['shot:s::video'];
  draft.engineId = 'dreamina-seedance-2.5';
  draft.references = [{ id: 'audio', type: 'audio', path: '/voice.wav', label: '声音' }];
  state.canvas.nodes.push({ id: 'audio', type: 'audio', position: { x: 0, y: 0 }, data: { audioUrl: '/voice.wav' } });
  state.canvas.edges.push({ id: 'ref', source: 'audio', target: 'n' });
  assert.throws(() => editProfessionalCanvasCommand(state, 'n', { modelVersion: 'wan-2.6' }), /模型|参考/);
  const changed = editProfessionalCanvasCommand(state, 'n', { description: '新词' });
  assert.deepEqual(changed.workshop.workspaceDrafts![draft.id].references, draft.references);
  assert.equal(changed.canvas.edges, state.canvas.edges);
});
