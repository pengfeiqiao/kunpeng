import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { initialWorkspaceDraft, saveWorkspaceDraft } from './drafts.ts';
import { editWorkspaceProjectVideoSettings, editWorkspaceShot, mergeWorkspaceShots } from './shotEdits.ts';
import { receiveWorkspaceResult } from './submissions.ts';

function fixture() {
  let data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('shot-settings'), videoModel: 'seedance-2.5', videoRatio: '16:9',
    shots: [
      { id: 'a', shotNo: '01', description: '司机停车', dialogue: '到了', characterIds: [], videoPrompt: '停车', durationSec: 12 },
      { id: 'b', shotNo: '02', description: '乘客下车', characterIds: [], videoPrompt: '下车', videoModel: 'minimax-h3', videoRatio: '9:16', durationSec: 8 },
    ],
  }, 1);
  for (const id of ['shot:a', 'shot:b']) data = saveWorkspaceDraft(data, initialWorkspaceDraft(data, id, 'video', 2)!, 0, 2)!;
  return data;
}

test('compatibility shot parameters update the materialized draft and preserve prompt, explicit references and historical versions', () => {
  const data = fixture(); const original = initialWorkspaceDraft(data, 'shot:a', 'video')!;
  const ready = saveWorkspaceDraft(data, { ...original, prompt: '@图片一 司机停车', references: [{ id: 'driver', type: 'image', path: '/driver.png', label: '司机' }] }, 1, 3)!;
  const done = receiveWorkspaceResult(ready, { submissionId: 'history', snapshot: ready.workspaceDrafts![original.id] }, 'task', ['/out.mp4'], 4);
  const history = JSON.stringify([done.workspaceSubmissions, done.projectObjects!.versions]);
  const updated = editWorkspaceShot(done, '01', { videoModel: 'minimax-h3', videoRatio: '9:16', durationSec: 15 }, 5);
  const draft = updated.workspaceDrafts![original.id];
  assert.equal(draft.engineId, 'minimax-hailuo-h3');
  assert.equal(String(draft.params.duration), '15');
  assert.equal(draft.params.ratio, '9:16');
  assert.equal(draft.params.resolution, '2K');
  assert.equal(draft.prompt, '@图片一 司机停车');
  assert.deepEqual(draft.references, ready.workspaceDrafts![original.id].references);
  assert.equal(draft.revision, 3);
  assert.equal(saveWorkspaceDraft(updated, original, original.revision), null);
  assert.equal(JSON.stringify([updated.workspaceSubmissions, updated.projectObjects!.versions]), history);
  assert.equal(updated.shots[0].dialogue, '到了');
  assert.deepEqual(updated.shots[1], done.shots[1]);
});

test('workspace video parameter saves project legacy aliases without pinning unchanged inherited model or ratio', () => {
  const data = fixture(); const draft = initialWorkspaceDraft(data, 'shot:a', 'video')!;
  assert.equal(data.shots[0].videoModel, undefined);
  assert.equal(data.shots[0].videoRatio, undefined);
  const alias = saveWorkspaceDraft(data, { ...draft, engineId: 'seedance-2.5' }, 1, 3)!;
  assert.equal(alias.shots[0].videoModel, undefined);
  const saved = saveWorkspaceDraft(data, { ...draft, engineId: 'minimax-hailuo-h3', params: { duration: '7', ratio: '9:16', resolution: '2K' } }, 1, 3)!;
  assert.equal(saved.shots[0].videoModel, 'minimax-h3');
  assert.equal(saved.shots[0].videoRatio, '9:16');
  assert.equal(saved.shots[0].durationSec, 7);
  const reset = editWorkspaceShot(saved, '01', { videoModel: undefined, videoRatio: undefined }, 4);
  assert.equal(reset.workspaceDrafts![draft.id].engineId, 'dreamina-seedance-2.5');
  assert.equal(reset.workspaceDrafts![draft.id].params.ratio, '16:9');
  assert.equal(reset.shots[0].videoModel, undefined);
  assert.equal(reset.shots[0].videoRatio, undefined);
  const again = migrateWorkshopProjectObjects(reset, 5);
  assert.equal(again.shots[0].videoModel, undefined);
  assert.equal(again.workspaceDrafts![draft.id].engineId, 'dreamina-seedance-2.5');
});

test('project settings update only inherited fields; locked inheriting shots reject the whole edit and no-op settings stay no-ops', () => {
  const data = fixture(); const independent = data.workspaceDrafts!['shot:b::video'];
  const next = editWorkspaceProjectVideoSettings(data, { videoModel: 'minimax-h3', videoRatio: '1:1' }, 3);
  assert.equal(next.workspaceDrafts!['shot:a::video'].engineId, 'minimax-hailuo-h3');
  assert.equal(next.workspaceDrafts!['shot:a::video'].params.ratio, '1:1');
  assert.equal(next.workspaceDrafts!['shot:b::video'], independent);
  assert.equal(next.shots[0].videoModel, undefined);
  assert.equal(next.shots[0].videoRatio, undefined);
  assert.equal(editWorkspaceProjectVideoSettings(next, { videoModel: 'minimax-h3' }), next);
  const locked = { ...data, projectObjects: { ...data.projectObjects!, objects: data.projectObjects!.objects.map((o) => o.id === 'shot:a' ? { ...o, locked: true } : o) } };
  const bytes = JSON.stringify(locked);
  assert.throws(() => editWorkspaceProjectVideoSettings(locked, { videoModel: 'minimax-h3' }), /已锁定/);
  assert.equal(JSON.stringify(locked), bytes);
  assert.equal(editWorkspaceShot(locked, '01', { durationSec: 7 }), locked);
});

test('batch model changes share calibration, keep separate prompt templates and never renumber removed references silently', () => {
  const data = fixture(); const original = initialWorkspaceDraft(data, 'shot:a', 'video')!;
  const references = Array.from({ length: 12 }, (_, i) => ({ id: `ref-${i}`, path: `/${i}.png`, type: 'image' as const, label: `参考${i}` }));
  const ready = saveWorkspaceDraft(data, { ...original, references, prompt: '@图片十二 中的物品', params: { ...original.params, duration: 30 } }, 1)!;
  const next = mergeWorkspaceShots(ready, [{ shotNo: '01', videoModel: 'minimax-h3', universalVideoPrompt: '保留新版词' }] as typeof data.shots, () => 'new');
  const draft = next.workspaceDrafts![original.id];
  assert.equal(draft.references.length, 9);
  assert.match(draft.prompt, /参考已移除/);
  assert.equal(next.shots[0].universalVideoPrompt, '保留新版词');
  assert.equal(Number(draft.params.duration), next.shots[0].durationSec);
  assert.ok(Number(draft.params.duration) >= 5 && Number(draft.params.duration) <= 15);
  assert.equal(draft.engineId, 'minimax-hailuo-h3');
});

test('old project video setters use the shared command and parameter projection does not change image drafts', () => {
  const data = fixture(); const image = initialWorkspaceDraft(data, 'shot:a', 'image')!;
  const saved = saveWorkspaceDraft(data, { ...image, prompt: '司机肖像' }, 0)!;
  const next = editWorkspaceShot(saved, '01', { durationSec: 7 });
  assert.equal(next.workspaceDrafts![image.id], saved.workspaceDrafts![image.id]);
  const source = readFileSync(new URL('../../stores/workshopStore.ts', import.meta.url), 'utf8');
  for (const [method, field] of [['setVideoModel', 'videoModel'], ['setVideoRatio', 'videoRatio']]) {
    const body = source.slice(source.lastIndexOf(`  ${method}: (`)).split('\n  },')[0];
    assert.match(body, new RegExp(`editWorkspaceProjectVideoSettings\\(data, \\{ ${field}:`));
    assert.doesNotMatch(body, /data: \{ \.\.\.data/);
  }
});
