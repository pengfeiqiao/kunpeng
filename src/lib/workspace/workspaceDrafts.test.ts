import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft, changeWorkspaceReferences, referenceMention, workspaceDraftErrors, calibrateWorkspaceDraft } from './drafts.ts';
import { reserveWorkspaceSubmission, transitionWorkspaceSubmission, receiveWorkspaceResult, pendingWorkspaceSubmission } from './submissions.ts';

function fixture() {
  return migrateWorkshopProjectObjects({ ...emptyWorkshopData('workspace-fixture'),
    characters: [{ id: 'driver', name: '司机', appearance: '', personality: '', assetImagePath: '/driver.png' }],
    scenes: [{ id: 'road', name: '公路', description: '', assetImagePath: '/road.png' }],
    shots: [
      { id: 'a', shotNo: '01', description: '司机听到异响', characterIds: ['driver'], sceneId: 'road', imagePrompt: '@图片一 公路上的 @图片二 司机', videoPrompt: '司机听到异响', durationSec: 8 },
      { id: 'b', shotNo: '02', description: '司机转头', characterIds: ['driver'], imagePrompt: '司机转头', videoPrompt: '司机转头', durationSec: 5 },
    ],
  }, 1);
}

test('workspace drafts are keyed by stable object and output type and reject stale async saves', () => {
  const data = fixture();
  const a = initialWorkspaceDraft(data, 'shot:a', 'image', 1)!;
  assert.equal(a.revision, 0);
  const saved = saveWorkspaceDraft(data, { ...a, prompt: 'edited A' }, 0, 2)!;
  assert.equal(saved.workspaceDrafts![a.id].revision, 1);
  assert.equal(saveWorkspaceDraft(saved, { ...a, prompt: 'late A' }, 0), null);
  const b = initialWorkspaceDraft(saved, 'shot:b', 'image')!;
  const next = saveWorkspaceDraft(saved, { ...b, prompt: 'edited B' }, 0)!;
  assert.equal(initialWorkspaceDraft(next, 'shot:a', 'image')!.prompt, 'edited A');
  assert.equal(initialWorkspaceDraft(next, 'shot:a', 'video')!.prompt.includes('edited A'), false);
  assert.equal(next.shots[0].description, data.shots[0].description);
  assert.equal(saveWorkspaceDraft({ ...next, projectId: 'other' }, a), null);
  const retrieved = initialWorkspaceDraft(next, 'shot:a', 'image')!;
  retrieved.references[0].path = '/changed.png';
  assert.equal(next.workspaceDrafts![a.id].references[0].path, '/road.png');
});

test('workspace reference order, rendered mentions and remapped prompt share original media paths', () => {
  const draft = initialWorkspaceDraft(fixture(), 'shot:a', 'image')!;
  assert.deepEqual(draft.references.map((ref) => ref.path), ['/road.png', '/driver.png']);
  const reversed = changeWorkspaceReferences(draft, [...draft.references].reverse());
  assert.equal(reversed.prompt, '@图片二 公路上的 @图片一 司机');
  assert.equal(referenceMention(reversed.references[0], reversed.references), '@图片一');
  assert.deepEqual(workspaceDraftErrors(reversed), []);
  const removed = changeWorkspaceReferences(reversed, reversed.references.slice(1));
  assert.ok(workspaceDraftErrors(removed).some((error) => error.includes('已移除')));
  assert.ok(removed.prompt.includes('@图片一 公路'));
  assert.ok(workspaceDraftErrors({ ...draft, prompt: '@图片三' }).length);
});

test('video and audio mentions number independently; reference remapping never cascades substitutions', () => {
  const draft = initialWorkspaceDraft(fixture(), 'shot:a', 'image')!;
  draft.references.push({ id: 'video', type: 'video', path: '/ref.mp4', label: '视频' }, { id: 'audio', type: 'audio', path: '/ref.wav', label: '声音' });
  draft.prompt = '@图片1 @图片2 @视频一 @音频1';
  const changed = changeWorkspaceReferences(draft, [draft.references[1], draft.references[3], draft.references[0], draft.references[2]]);
  assert.equal(changed.prompt, '@图片二 @图片一 @视频一 @音频一');
  assert.deepEqual(workspaceDraftErrors(changed), []);
});

test('submission reservation prevents duplicate clicks and uncertainty blocks resubmit without blocking other objects', () => {
  const data = fixture();
  const a = initialWorkspaceDraft(data, 'shot:a', 'image')!;
  const reserved = reserveWorkspaceSubmission(data, a, 'submit-a', 2)!;
  a.references[0].path = '/edited-after-click.png';
  assert.equal(reserved.workspaceSubmissions!['submit-a'].draft.references[0].path, '/road.png');
  assert.equal(reserveWorkspaceSubmission(reserved, a, 'duplicate'), null);
  const active = transitionWorkspaceSubmission(transitionWorkspaceSubmission(reserved, 'submit-a', 'submitting'), 'submit-a', 'uncertain');
  assert.equal(pendingWorkspaceSubmission(active, 'shot:a', 'image')!.status, 'uncertain');
  assert.equal(reserveWorkspaceSubmission(active, a, 'duplicate'), null);
  assert.ok(reserveWorkspaceSubmission(active, initialWorkspaceDraft(active, 'shot:b', 'video')!, 'b'));
  assert.equal(transitionWorkspaceSubmission(active, 'submit-a', 'cancelled'), active);
});

test('late result creates candidate on original object with immutable historical parameters; duplicate receipt is idempotent', () => {
  const data = fixture();
  const a = initialWorkspaceDraft(data, 'shot:a', 'video', 2)!;
  const reserved = reserveWorkspaceSubmission(data, a, 'submit-a')!;
  const binding = { submissionId: 'submit-a', snapshot: a };
  const next = receiveWorkspaceResult({ ...reserved, projectViewState: { workspaceObjectId: 'shot:b' } }, binding, 'task-a', ['/a.mp4'], 3);
  const version = next.projectObjects!.versions.find((item) => item.ownerObjectId === 'shot:a')!;
  assert.equal(version.selected, false);
  assert.equal(version.generationSnapshot!.params.duration, 8);
  a.params.duration = 15;
  assert.equal(version.generationSnapshot!.params.duration, 8);
  assert.equal(next.shots[0].videoPath, undefined);
  assert.equal(next.shots[1].videoPath, undefined);
  assert.equal(next.projectObjects!.media.find((item) => item.id === version.mediaObjectId)!.purpose, 'candidate-version');
  assert.equal(receiveWorkspaceResult(next, binding, 'task-a', ['/a.mp4']), next);
  assert.equal(receiveWorkspaceResult({ ...next, projectId: 'another' }, binding, 'task-a', ['/a.mp4']).projectId, 'another');
});

test('late paid result for a deleted owner enters inbox without recreating owner; cancelled confirmation has no result', () => {
  const data = fixture();
  const snapshot = initialWorkspaceDraft(data, 'shot:a', 'video')!;
  const reserved = reserveWorkspaceSubmission(data, snapshot, 'submit-a')!;
  const binding = { submissionId: 'submit-a', snapshot };
  const deleted = { ...reserved, shots: reserved.shots.slice(1), projectObjects: { ...reserved.projectObjects!, objects: reserved.projectObjects!.objects.filter((item) => item.id !== 'shot:a') } };
  const received = receiveWorkspaceResult(deleted, binding, 'task-a', ['/a.mp4']);
  assert.equal(received.projectObjects!.objects.some((item) => item.id === 'shot:a'), false);
  const media = received.projectObjects!.media.find((item) => item.path === '/a.mp4')!;
  assert.equal(media.purpose, 'unclassified');
  assert.equal(media.ownerObjectId, undefined);
  const cancelled = transitionWorkspaceSubmission(reserved, 'submit-a', 'cancelled');
  assert.equal(receiveWorkspaceResult(cancelled, binding, 'task-a', ['/a.mp4']), cancelled);
});

test('model calibration removes stale parameter keys, preserves ratio aliases and remaps reduced references', () => {
  const draft = initialWorkspaceDraft(fixture(), 'shot:a', 'image')!;
  draft.params = { aspectRatio: '9:16', duration: 30, oldModelOnly: true };
  const changed = calibrateWorkspaceDraft(draft, { id: 'mock-video', label: '测试模型', kind: 'video', mode: 'image-to-image', endpoint: 'mock',
    imageParam: { key: 'image', multiple: false }, params: [
      { key: 'ratio', label: '比例', type: 'list', options: ['16:9', '9:16'], default: '16:9' },
      { key: 'duration', label: '时长', type: 'list', options: ['5', '10'], default: '5' },
    ] });
  assert.deepEqual(changed.draft.params, { ratio: '9:16', duration: '5' });
  assert.equal(changed.draft.references.length, 1);
  assert.ok(changed.adjustments.some((message) => message.includes('时长')));
  assert.ok(workspaceDraftErrors(changed.draft).some((message) => message.includes('已移除')));
  assert.equal(draft.references.length, 2);
});

test('repeated source paths do not bypass a single-reference model limit', () => {
  const draft = initialWorkspaceDraft(fixture(), 'shot:a', 'image')!;
  draft.references[1].path = draft.references[0].path;
  const changed = calibrateWorkspaceDraft(draft, { id: 'single', label: '单参考', kind: 'image', mode: 'image-to-image', endpoint: 'mock',
    params: [], imageParam: { key: 'image', multiple: false } });
  assert.equal(changed.draft.references.length, 1);
});
