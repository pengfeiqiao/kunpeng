import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { emptyWorkshopData } from '../workshop/types.ts';
import { migrateWorkshopProjectObjects } from '../projectObjects/migrate.ts';
import { saveWorkspaceDraft } from './drafts.ts';
import { buildWorkspaceAgentContext } from './agentContext.ts';

const fixture = () => migrateWorkshopProjectObjects({ ...emptyWorkshopData('agent-project'),
  shots: [{ id: 'a', shotNo: '01', description: '司机转头', dialogue: '等一下', characterIds: [], imagePrompt: '司机转头' },
    { id: 'b', shotNo: '02', description: '停车', characterIds: [] }],
  projectViewState: { workspaceObjectId: 'shot:a', workspaceOutputType: 'image' },
}, 1);

test('workspace Agent context freezes explicit object/output identity and directs writes to revisioned drafts', () => {
  const data = fixture();
  const first = buildWorkspaceAgentContext(data);
  data.projectViewState!.workspaceObjectId = 'shot:b';
  assert.match(first, /"object_id":"shot:a"/);
  assert.match(first, /"output_type":"image"/);
  assert.match(first, /project_get_generation_draft/);
  assert.match(first, /project_update_generation_prompt/);
  assert.match(first, /不自动开始付费生成/);
  assert.match(buildWorkspaceAgentContext(data), /"object_id":"shot:b"/);
});

test('real Agent draft tools guard project/revision/abort/locks and only update the target prompt', async () => {
  let data = fixture();
  let activeId = data.projectId;
  const before = structuredClone(data.shots);
  const key = '__kunpengWorkspaceAgentMock';
  (globalThis as any)[key] = {
    workshop: { getState: () => ({ data }) }, unified: { getState: () => ({ activeId }) },
    save: (draft: any) => {
      const next = saveWorkspaceDraft(data, draft, draft.revision);
      if (!next) return null;
      data = next; return next.workspaceDrafts![draft.id];
    },
  };
  try {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const result = await build({ absWorkingDir: root, entryPoints: ['src/lib/agent/tools/workspaceDraftTools.ts'], bundle: true,
      write: false, format: 'esm', platform: 'node', plugins: [{ name: 'mock-ports', setup(b) {
        b.onResolve({ filter: /^@\// }, (args) => {
          if (['@/stores/workshopStore', '@/stores/unifiedProjectStore', '@/lib/workspace/runtime'].includes(args.path)) return { path: args.path, namespace: 'mock' };
          return { path: `${root}src/${args.path.slice(2)}.ts` };
        });
        b.onLoad({ filter: /.*/, namespace: 'mock' }, (args) => ({ contents: args.path.endsWith('workshopStore')
          ? `export const useWorkshopStore=globalThis.${key}.workshop;`
          : args.path.endsWith('unifiedProjectStore') ? `export const useUnifiedProjectStore=globalThis.${key}.unified;`
            : `export const updateWorkspaceDraft=globalThis.${key}.save;`, loader: 'js' }));
      } }] });
    const module = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
    const target = { project_id: activeId, object_id: 'shot:a', output_type: 'image' };
    const read = await module.getWorkspaceDraftTool.execute(target);
    assert.equal(read.success, true);
    assert.equal(JSON.parse(read.output).revision, 0);
    data = { ...data, projectViewState: { ...data.projectViewState, workspaceObjectId: 'shot:b' } };
    const update = (extra: object = {}, signal?: AbortSignal) => module.updateWorkspaceDraftTool.execute({ ...target, expected_revision: 0, prompt: '仅调整光线', ...extra }, signal);
    assert.equal((await update()).success, true);
    assert.equal(data.workspaceDrafts!['shot:a::image'].prompt, '仅调整光线');
    assert.equal(data.workspaceDrafts!['shot:b::image'], undefined);
    assert.deepEqual(data.shots.map(({ imagePrompt: _prompt, workspaceReferenceProjection: _projection, ...facts }) => facts),
      before.map(({ imagePrompt: _prompt, workspaceReferenceProjection: _projection, ...facts }) => facts));
    assert.equal(data.shots[0].imagePrompt, '仅调整光线');
    assert.deepEqual(data.shots[0].workspaceReferenceProjection?.image, data.workspaceDrafts!['shot:a::image'].references);
    assert.deepEqual(data.shots[1], before[1]);
    assert.equal((await update({ prompt: '过期回复' })).success, false);
    assert.equal((await update({ expected_revision: 1, prompt: '@图片九' })).success, false);
    const controller = new AbortController(); controller.abort();
    assert.equal((await update({ expected_revision: 1 }, controller.signal)).success, false);
    data.projectObjects!.objects = data.projectObjects!.objects.map((item) => item.id === 'shot:a' ? { ...item, locked: true } : item);
    assert.equal((await update({ expected_revision: 1 })).success, false);
    activeId = 'another-project';
    assert.equal((await update({ expected_revision: 1 })).success, false);
    assert.equal((await module.getWorkspaceDraftTool.execute(target)).success, false);
    assert.equal(module.updateWorkspaceDraftTool.risk, 'ask');
  } finally { delete (globalThis as any)[key]; }
});

test('workspace draft tools are in the shared registry used by built-in and DSH execution', async () => {
  const source = await readFile(new URL('../agent/tools/projectTools.ts', import.meta.url), 'utf8');
  assert.match(source, /\.\.\.workspaceDraftTools/);
  const registry = await readFile(new URL('../agent/toolRegistry.ts', import.meta.url), 'utf8');
  assert.match(registry, /allProjectTools/);
});
