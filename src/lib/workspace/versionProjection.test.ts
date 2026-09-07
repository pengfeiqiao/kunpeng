import test from 'node:test';
import assert from 'node:assert/strict';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { registerCanvasGeneration, selectAssetVersion } from '../projectObjects/selectors.ts';
import { initialWorkspaceDraft } from './drafts.ts';

for (const kind of ['shot', 'character'] as const) {
  test(`${kind} adopted generated version survives repeated migration without duplicated media or lost history`, () => {
    const original = migrateWorkshopProjectObjects({ ...emptyWorkshopData(`history-${kind}`),
      shots: [{ id: 'a', shotNo: '01', description: '司机', characterIds: [] }],
      characters: [{ id: 'a', name: '司机', appearance: '', personality: '' }],
    }, 1);
    const ownerId = `${kind}:a`;
    const snapshot = { ...initialWorkspaceDraft(original, ownerId, 'image', 2)!, prompt: '原始生成提示词', params: { aspectRatio: '9:16' } };
    const result = registerCanvasGeneration(original, { nodeId: '', taskId: 'original-task', paths: ['/one.png'],
      mediaType: 'image', ownerObjectId: ownerId, prompt: snapshot.prompt, engineId: 'original-engine', generationSnapshot: snapshot }, 3);
    const adopted = selectAssetVersion(result.data, ownerId, result.versionIds[0]!, 4);
    const once = migrateWorkshopProjectObjects(adopted, 5);
    const twice = migrateWorkshopProjectObjects(once, 6);
    assert.deepEqual(twice, once);
    assert.equal(twice.projectObjects!.media.filter((item) => item.path === '/one.png').length, 1);
    assert.equal(twice.projectObjects!.versions.filter((item) => item.ownerObjectId === ownerId).length, 1);
    const media = twice.projectObjects!.media.find((item) => item.id === result.mediaIds[0])!;
    const version = twice.projectObjects!.versions.find((item) => item.id === result.versionIds[0])!;
    assert.equal(media.generationTaskId, 'original-task');
    assert.equal(media.purpose, 'current-version');
    assert.equal(version.selected, true);
    assert.deepEqual(version.generationSnapshot, snapshot);
    const next = registerCanvasGeneration(twice, { nodeId: '', taskId: 'second-task', paths: ['/two.png'], mediaType: 'image', ownerObjectId: ownerId }, 7);
    assert.deepEqual(next.data.projectObjects!.versions.filter((item) => item.ownerObjectId === ownerId).map((item) => item.ordinal), [1, 2]);
    assert.equal(next.data.projectObjects!.versions.find((item) => item.id === result.versionIds[0])!.selected, true);
  });
}
