import test from 'node:test';
import assert from 'node:assert/strict';
import { WORKSPACE_ENGINES, workspaceEngine, materializeWorkspaceDefaults } from './engineCatalog.ts';
import { initialWorkspaceDraft } from './drafts.ts';
import { workspaceGenerationRequest } from './generationCommand.ts';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';

test('workspace exposes dedicated GPT/MJ/Seedance25 routes without adding them to RH or losing aliases', () => {
  assert.equal(new Set(WORKSPACE_ENGINES.map((engine) => engine.id)).size, WORKSPACE_ENGINES.length);
  for (const id of ['gpt-image-2', 'midjourney-v8.2', 'midjourney-v82', 'dreamina-seedance-2.5', 'minimax-h3']) {
    assert.equal(workspaceEngine(id)?.id, id);
  }
  assert.equal(workspaceEngine('unregistered'), undefined);
  const seedance = workspaceEngine('dreamina-seedance-2.5')!;
  assert.equal(seedance.params.find((param) => param.key === 'duration')!.options!.length, 27);
  assert.deepEqual(seedance.params.find((param) => param.key === 'resolution')!.options, ['480p', '720p']);
});

test('workspace displayed defaults are frozen in drafts and requests without overwriting explicit parameters or stored history', () => {
  const data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('defaults'),
    shots: [{ id: 'a', shotNo: '01', characterIds: [], description: '司机转头', videoModel: 'minimax-h3', durationSec: 8 }],
  }, 1);
  const draft = initialWorkspaceDraft(data, 'shot:a', 'video')!;
  assert.equal(draft.params.resolution, '2K');
  assert.equal(draft.params.duration, 8);
  assert.deepEqual(workspaceGenerationRequest(draft).params, draft.params);
  const old = { ...draft, params: { duration: 12, resolution: 'historical-value' } };
  const completed = materializeWorkspaceDefaults(old);
  assert.equal(completed.params.resolution, 'historical-value');
  assert.equal(completed.params.duration, 12);
  assert.equal(completed.params.ratio, 'adaptive');
  assert.deepEqual(old.params, { duration: 12, resolution: 'historical-value' });
  assert.deepEqual(materializeWorkspaceDefaults(completed), completed);
});
