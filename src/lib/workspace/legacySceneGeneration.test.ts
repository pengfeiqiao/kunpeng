import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { generateLegacySceneVariants } from './legacySceneGeneration.ts';
import { submitWorkspaceGeneration, type WorkspaceGenerationPort } from './generationCommand.ts';
import { saveWorkspaceDraft } from './drafts.ts';

function fixture() {
  const migrated = migrateWorkshopProjectObjects({ ...emptyWorkshopData('variants'), scenes: [{ id: 'scene', name: 'S', description: '场景事实',
    assetImagePath: '/base.png', assetPrompt: '同一间办公室', assetEngine: 'gpt-image-2', assetAspectRatio: '9:16' }] }, 1);
  migrated.projectSpec = { ...migrated.projectSpec!, generationConfirmation: 'always-confirm' };
  return migrated;
}

test('four scene variants each use visible shared draft/confirmation and original reference; all outputs remain candidates', async () => {
  let data = fixture(); let calls = 0; let confirmations = 0; let id = 0;
  const port: WorkspaceGenerationPort = { readProject: () => data, publish: (_before, next) => { data = next; return true; },
    persist: async () => {}, confirm: async (draft) => { confirmations++;
      assert.deepEqual(draft, data.workspaceDrafts![draft.id]); assert.match(draft.prompt, /迭代图/);
      assert.deepEqual(draft.references.map((ref) => ref.path), ['/base.png']); return true;
    }, bindTask: () => {}, runGeneration: async (request) => {
      calls++; assert.equal(request.strictPaidSafety, true); assert.equal(request.params?.aspectRatio, '9:16');
      assert.deepEqual(request.referenceUrls, ['/base.png']);
      return { success: true, taskId: `native-${calls}`, resultPaths: [`/variant-${calls}.png`], resultUrls: [] };
    } };
  await generateLegacySceneVariants({ apply: (_project, command) => { data = command(data)!; return true; },
    generate: (draft) => submitWorkspaceGeneration(port, draft, `submission-${++id}`, 'ask') }, data.projectId, 'scene');
  assert.equal(calls, 4); assert.equal(confirmations, 4); assert.equal(data.scenes[0].assetImagePath, '/base.png');
  assert.equal(data.scenes[0].description, '场景事实');
  assert.equal(data.projectObjects!.media.filter((media) => media.purpose === 'candidate-version').length, 4);
  assert.equal(data.projectObjects!.versions.filter((version) => !version.selected).length, 4);
  assert.deepEqual(Object.values(data.workspaceSubmissions!).map((item) => item.draft.references[0].path), Array(4).fill('/base.png'));
});

test('cancel, background-running or uncertain scene result stops remaining variants; uncertain state forbids rerun', async () => {
  for (const mode of ['cancelled', 'running', 'uncertain'] as const) {
    let data = fixture(); let calls = 0;
    const port: WorkspaceGenerationPort = { readProject: () => data, publish: (_before, next) => { data = next; return true; },
      persist: async () => {}, confirm: async () => mode !== 'cancelled', bindTask: () => {}, runGeneration: async () => {
        calls++; return { success: false, taskId: 'native', resultPaths: [], resultUrls: [],
          ...(mode === 'uncertain' ? { submissionUncertain: true } : { backgroundPending: true }) };
      } };
    const run = () => generateLegacySceneVariants({ apply: (_project, command) => { data = command(data)!; return true; },
      generate: (draft) => submitWorkspaceGeneration(port, draft, 'submission', 'ask') }, data.projectId, 'scene');
    if (mode === 'cancelled') await run(); else await assert.rejects(run(), /核对原任务/);
    assert.equal(calls, mode === 'cancelled' ? 0 : 1);
    if (mode !== 'cancelled') {
      const before = data;
      await assert.rejects(run(), /勿重复提交/); assert.equal(data, before); assert.equal(calls, 1);
    }
  }
});

test('concurrent visible draft edits stop subsequent variants without overwriting user changes', async () => {
  let data = fixture(); let calls = 0;
  await assert.rejects(generateLegacySceneVariants({ apply: (_project, command) => { data = command(data)!; return true; },
    generate: async (draft) => { calls++; data = saveWorkspaceDraft(data, { ...draft, prompt: '用户新稿' }, draft.revision)!;
      return { submissionId: 'done', status: 'succeeded' }; } }, data.projectId, 'scene'), /草稿已被修改/);
  assert.equal(calls, 1); assert.equal(data.workspaceDrafts!['scene:scene::image'].prompt, '用户新稿');
});

test('no remaining store paid executor, copy helper or hidden style-library generation; invalid scene stops before submission', async () => {
  const source = readFileSync(new URL('../../stores/workshopStore.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /runGeneration\(|copyIntoProject|loadStyleLibrary|trimAudioPathsToFit/);
  assert.match(source, /generateLegacySceneVariants/);
  let data = fixture(); data.scenes[0].assetImagePath = undefined;
  await assert.rejects(generateLegacySceneVariants({ apply: (_project, command) => { data = command(data)!; return true; },
    generate: async () => { throw new Error('must not submit'); } }, data.projectId, 'scene'), /先选择一张场景图/);
});
