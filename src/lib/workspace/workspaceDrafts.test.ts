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

test('video model switch preserves references across seedance/wan/minimax; start-end keeps first two frames', async () => {
  const { WORKSPACE_ENGINES } = await import('./engineCatalog.ts');
  const engine = (id: string) => WORKSPACE_ENGINES.find((item) => item.id === id)!;
  const base = {
    id: 'shot:s::video', projectId: 'P', objectId: 'shot:s', outputType: 'video' as const,
    prompt: '@图片一 A @图片二 B @视频一 C @音频一 D', engineId: 'dreamina-seedance-2.5',
    params: { ratio: '16:9', duration: '5', resolution: '720p' }, revision: 0, updatedAt: 0,
    references: [
      { id: 'i1', type: 'image' as const, path: '/a.png', label: '场景' },
      { id: 'i2', type: 'image' as const, path: '/b.png', label: '角色' },
      { id: 'v1', type: 'video' as const, path: '/c.mp4', label: '参考视频' },
      { id: 'a1', type: 'audio' as const, path: '/d.wav', label: '参考音频' },
    ],
  };
  // 2.5 → 2.0 多模态：全保留（用户报告的"切换丢参考"不得再发生）
  assert.deepEqual(calibrateWorkspaceDraft(base, engine('seedance-2.0')).draft.references.map((ref) => ref.path),
    ['/a.png', '/b.png', '/c.mp4', '/d.wav']);
  // 2.5 → 万相 3.0 / MiniMax H3：全保留
  for (const id of ['wan-3.0', 'minimax-hailuo-h3']) {
    assert.deepEqual(calibrateWorkspaceDraft(base, engine(id)).draft.references.map((ref) => ref.path),
      ['/a.png', '/b.png', '/c.mp4', '/d.wav'], id);
  }
  // 首尾帧/Mini 图生（start-end-video）：schema 无 imageParam 但支持 ≤2 张图，不得剥光；视频/音频按不支持移除
  for (const id of ['startend-v3.1-pro', 'seedance-2.0-mini-i2v']) {
    const changed = calibrateWorkspaceDraft(base, engine(id));
    assert.deepEqual(changed.draft.references.map((ref) => ref.path), ['/a.png', '/b.png'], id);
    assert.ok(changed.adjustments.some((message) => message.includes('不支持参考视频')), id);
  }
  // Fast：fast 档与 pro 同为 图≤9/视频≤3/音频≤3（筷子 OpenAPI 分档矩阵 v1.1），全保留
  const fast = calibrateWorkspaceDraft(base, engine('seedance-2.0-fast'));
  assert.deepEqual(fast.draft.references.map((ref) => ref.path), ['/a.png', '/b.png', '/c.mp4', '/d.wav']);
  // 2.0 家族上限对齐 API 矩阵：图≤9 / 视频≤3 / 音频≤3
  const many = { ...base, references: Array.from({ length: 12 }, (_, index) => (
    { id: `i${index}`, type: 'image' as const, path: `/img-${index}.png`, label: `图${index}` })) };
  const clamped = calibrateWorkspaceDraft(many, engine('seedance-2.0'));
  assert.equal(clamped.draft.references.length, 9);
  assert.ok(clamped.adjustments.some((message) => message.includes('9 个')));
  // 首尾帧超过 2 张图时裁到 2 张并明示；Mini 图生（全能参考）按筷子 mini 档放宽到 9 张
  const three = { ...base, references: base.references.filter((ref) => ref.type === 'image')
    .concat([{ id: 'i3', type: 'image' as const, path: '/e.png', label: '道具' }]) };
  const startend = calibrateWorkspaceDraft(three, engine('startend-v3.1-pro'));
  assert.deepEqual(startend.draft.references.map((ref) => ref.path), ['/a.png', '/b.png']);
  assert.ok(startend.adjustments.some((message) => message.includes('2 个')));
  const miniKept = calibrateWorkspaceDraft(three, engine('seedance-2.0-mini-i2v'));
  assert.deepEqual(miniKept.draft.references.map((ref) => ref.path), ['/a.png', '/b.png', '/e.png']);
  const miniClamped = calibrateWorkspaceDraft(many, engine('seedance-2.0-mini-i2v'));
  assert.equal(miniClamped.draft.references.length, 9);
});

test('saving non-empty references clears the stale explicit-empty mark; empty save with productive cast marks explicit empty', () => {
  const data = fixture();
  // 自相矛盾状态：投影有真实引用，却仍标着 explicitEmpty.image=true
  const marked = { ...data, shots: data.shots.map((s) => (s.shotNo === '01'
    ? { ...s, workspaceReferenceProjection: {
        image: [{ id: 'r1', type: 'image' as const, path: '/road.png', label: '场景 公路' }],
        explicitEmpty: { image: true } } }
    : s)) };
  const draft = initialWorkspaceDraft(marked, 'shot:a', 'image', 1)!;
  assert.ok(draft.references.length > 0);
  const saved = saveWorkspaceDraft(marked, draft, 0, 2)!;
  assert.equal(saved.shots[0].workspaceReferenceProjection?.explicitEmpty, undefined, '有引用时旧清空标记必须清除');
  assert.ok((saved.shots[0].workspaceReferenceProjection?.image ?? []).length > 0);
  // references 为空 + 选角可产出 → 打标（既有行为不回归）
  const stored = initialWorkspaceDraft(saved, 'shot:a', 'image', 3)!;
  const emptied = saveWorkspaceDraft(saved, { ...stored, references: [] }, stored.revision, 4)!;
  assert.equal(emptied.shots[0].workspaceReferenceProjection?.explicitEmpty?.image, true);
});
