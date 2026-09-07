import test from 'node:test';
import assert from 'node:assert/strict';
import type { Node } from 'reactflow';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { professionalDraftFields, professionalDraftRequest, projectChangedProfessionalDrafts } from './professionalDraftProjection.ts';

function fixture() {
  let before = migrateWorkshopProjectObjects({ ...emptyWorkshopData('p'), shots: [{ id: 's', shotNo: '01', characterIds: [],
    description: '原事实', dialogue: '原对白', videoPrompt: '原提示词' }] }, 1);
  const draft = initialWorkspaceDraft(before, 'shot:s', 'video', 1)!;
  before = saveWorkspaceDraft(before, draft, 0, 1)!;
  const saved = before.workspaceDrafts![draft.id];
  const after = saveWorkspaceDraft(before, { ...saved, prompt: '表达调整', params: { ...saved.params, duration: 12 } }, saved.revision, 2)!;
  const nodes: Node[] = [{ id: 'n', type: 'video', position: { x: 42, y: 80 }, data: {
    ...professionalDraftFields(saved), projectObjectId: 'shot:s', workspaceDraftId: draft.id,
    workspaceProjection: { revision: saved.revision, prompt: saved.prompt },
    generatedVideoUrl: '/adopted.mp4', localPath: '/adopted.mp4', generationHistory: [{ url: '/prior.mp4' }],
    workshopRef: { projectId: 'p', objectId: 'shot:s' }, customLayout: { folded: true },
  } }];
  return { before, after, nodes, saved };
}

test('one publication projects prompt and native parameters to all clean bound nodes; facts/media/layout stay untouched', () => {
  const { before, after, nodes } = fixture();
  const second = { ...nodes[0], id: 'second', position: { x: 999, y: 123 } };
  nodes.push(second);
  const bytes = JSON.stringify({ before, after, nodes });
  const projected = projectChangedProfessionalDrafts(before, after, nodes);
  for (const [i, node] of projected.entries()) {
    assert.equal(node.data.description, '表达调整'); assert.equal(node.data.duration, 12);
    assert.equal(node.data.workspaceProjection.revision, 2);
    assert.equal(node.position, nodes[i].position);
    assert.equal(node.data.generatedVideoUrl, '/adopted.mp4');
    assert.equal(node.data.generationHistory, nodes[i].data.generationHistory);
    assert.equal(node.data.customLayout, nodes[i].data.customLayout);
    assert.equal(node.data.workshopRef, nodes[i].data.workshopRef);
  }
  assert.equal(after.shots[0].description, '原事实'); assert.equal(after.shots[0].dialogue, '原对白');
  assert.equal(JSON.stringify({ before, after, nodes }), bytes);
  assert.equal(projectChangedProfessionalDrafts(before, after, projected), projected);
  assert.equal(projectChangedProfessionalDrafts(after, after, projected), projected);
});

test('dirty parameter/prompt, pending task, specialized settings and changed references produce explicit conflicts without overwrite', () => {
  for (const patch of [{ description: '用户刚编辑' }, { params: { duration: 25 } }, { duration: 25 },
    { isGenerating: true }, { isMgAnimationNode: true, mgRecipe: { easing: 'linear' } }]) {
    const { before, after, nodes } = fixture();
    nodes[0].data = { ...nodes[0].data, ...patch };
    const next = projectChangedProfessionalDrafts(before, after, nodes)[0];
    const { workspaceDraftConflict: conflict, ...preserved } = next.data;
    assert.equal(conflict.revision, 2); assert.ok(conflict.reason);
    assert.deepEqual(preserved, nodes[0].data);
  }
  const { before, after, nodes, saved } = fixture();
  after.workspaceDrafts![saved.id].references = [{ id: 'new', path: '/reference.png', type: 'image', label: '参考' }];
  assert.match(projectChangedProfessionalDrafts(before, after, nodes)[0].data.workspaceDraftConflict.reason, /参考/);
});

test('unbound, historical, foreign-project and locked nodes never adopt another editor projection', () => {
  for (const patch of [{ workspaceDraftId: undefined }, { mediaPurpose: 'historical' }, { projectObjectId: 'other' },
    { workshopRef: { projectId: 'foreign' } }, { locked: true }, { workshopPromptRefTarget: 'elsewhere' }]) {
    const { before, after, nodes } = fixture(); nodes[0].data = { ...nodes[0].data, ...patch };
    assert.equal(projectChangedProfessionalDrafts(before, after, nodes), nodes);
  }
  const { before, after, nodes } = fixture();
  after.projectObjects!.objects.find((item) => item.id === 'shot:s')!.locked = true;
  assert.equal(projectChangedProfessionalDrafts(before, after, nodes), nodes);
  assert.equal(projectChangedProfessionalDrafts(before, { ...after, projectId: 'other' }, nodes), nodes);
});

test('view shared draft revalidates current stable owner and preserves locked read-only behavior', () => {
  const { after, nodes } = fixture();
  assert.deepEqual(professionalDraftRequest(after, nodes, 'n'), { objectId: 'shot:s', outputType: 'video', edit: true });
  assert.equal(professionalDraftRequest(after, nodes, 'missing'), null);
  assert.equal(professionalDraftRequest(after, nodes, {}), null);
  nodes[0].data.workshopRef.projectId = 'other';
  assert.equal(professionalDraftRequest(after, nodes, 'n'), null);
  nodes[0].data.workshopRef.projectId = 'p';
  const owner = after.projectObjects!.objects.find((item) => item.id === 'shot:s')!;
  owner.locked = true;
  assert.equal(professionalDraftRequest(after, nodes, 'n')!.edit, false);
  owner.archived = true;
  assert.equal(professionalDraftRequest(after, nodes, 'n'), null);
});
