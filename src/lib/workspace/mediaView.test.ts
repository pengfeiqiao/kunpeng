import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { registerCanvasGeneration } from '../projectObjects/selectors.ts';
import { initialWorkspaceDraft } from './drafts.ts';
import { workspaceHistoricalParameters, workspaceMediaVersions, selectWorkspaceMedia } from './mediaView.ts';

test('inspector reads original historical settings, excludes references/storyboards, and never invents old parameters', () => {
  let data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('p'), shots: [{ id: 's', shotNo: '1', description: '场景', characterIds: [],
    imagePath: '/legacy.png', videoPrompt: '司机开车', extraRefImages: ['/reference.png'],
    storyboardBoards: [{ id: 'board', frameIds: [], imagePath: '/board.png', createdAt: 1 }],
  }] });
  assert.deepEqual(workspaceMediaVersions(data, 'shot:s', 'image').map((item) => item.media.path), ['/legacy.png']);
  assert.equal(workspaceHistoricalParameters(), '历史参数未记录');
  const snapshot = initialWorkspaceDraft(data, 'shot:s', 'video')!;
  snapshot.params = { duration: 8, ratio: '9:16', resolution: '2K' };
  data = registerCanvasGeneration(data, { nodeId: '', taskId: 'task', paths: ['/new.mp4'], mediaType: 'video', ownerObjectId: 'shot:s', generationSnapshot: snapshot }).data;
  snapshot.params.duration = 15;
  const list = workspaceMediaVersions(data, 'shot:s', 'video');
  assert.equal(workspaceHistoricalParameters(list[0].version), '9:16 · 8秒 · 2K');
  assert.equal(selectWorkspaceMedia(list, 'wrong-object')?.media.path, '/new.mp4');
  assert.equal(list[0].adopted, false);
});
