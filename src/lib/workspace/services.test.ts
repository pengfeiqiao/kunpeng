import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateWorkspacePrice, workspacePriceKey, workspaceUnavailableReason, type WorkspaceCapabilities } from './services.ts';
import type { WorkspaceDraft } from './types.ts';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const caps: WorkspaceCapabilities = { gpt: false, apimart: false, runninghub: false, kuaizi: false, ark: false, seedanceChannel: 'kuaizi' };
const draft: WorkspaceDraft = { id: 'shot:a::video', objectId: 'shot:a', projectId: 'p', outputType: 'video',
  prompt: '私人剧情正文', engineId: 'minimax-hailuo-h3', references: [], params: { duration: '8', ratio: '16:9', resolution: '2K' }, revision: 0, updatedAt: 1 };

test('model availability follows configured executor channels, not presence of an unrelated key', () => {
  assert.ok(workspaceUnavailableReason('gpt-image-2', { ...caps, runninghub: true }));
  assert.equal(workspaceUnavailableReason('gpt-image-2', { ...caps, gpt: true }), undefined);
  assert.ok(workspaceUnavailableReason('midjourney-v8.2', { ...caps, runninghub: true }));
  assert.equal(workspaceUnavailableReason('midjourney-v8.2', { ...caps, apimart: true }), undefined);
  for (const channel of ['apimart', 'kuaizi', 'runninghub']) assert.equal(workspaceUnavailableReason('minimax-hailuo-h3', { ...caps, [channel]: true }), undefined);
  assert.ok(workspaceUnavailableReason('seedance-2.0', { ...caps, runninghub: true, seedanceChannel: 'ark' }));
  assert.equal(workspaceUnavailableReason('seedance-2.0', { ...caps, ark: true, seedanceChannel: 'ark' }), undefined);
  // CLI login is unknown, not false merely because no API key exists.
  assert.equal(workspaceUnavailableReason('dreamina-seedance-2.5', caps), undefined);
  assert.equal(workspaceUnavailableReason('seedream-v5-pro', caps), undefined);
});

test('price quote calls the existing endpoint using parameters, without prompt text or uploading media', async () => {
  let called = false;
  const result = await estimateWorkspacePrice(draft, true, async (endpoint, params) => {
    called = true; assert.equal(endpoint, 'minimax/hailuo-h3/multimodal-to-video');
    assert.equal(params.prompt, 'estimate'); assert.equal(params.duration, '8');
    return { estimatedPrice: 1.2, currency: 'CNY', isFreeThisCall: false };
  });
  assert.equal(called, true); assert.match(result.label, /RunningHub 预估 CNY 1.2/);
  assert.match(result.detail, /实际路由与计费可能不同/);
});

test('missing quote support never calls provider and is not labelled free', async () => {
  for (const [engineId, configured] of [['gpt-image-2', true], ['midjourney-v8.2', true], ['minimax-hailuo-h3', false]] as const) {
    const price = await estimateWorkspacePrice({ ...draft, engineId }, configured, async () => { throw new Error('must not call'); });
    assert.equal(price.label, '费用以渠道结算为准');
  }
});

test('failed/invalid quote stays unknown; explicit free quote does not alter draft or confirmation policy', async () => {
  for (const price of [null, { estimatedPrice: NaN, currency: 'CNY', isFreeThisCall: false }, { estimatedPrice: -1, currency: 'CNY', isFreeThisCall: false }]) {
    assert.equal((await estimateWorkspacePrice(draft, true, async () => price)).label, '暂时无法估价');
  }
  assert.equal((await estimateWorkspacePrice(draft, true, async () => { throw new Error('offline'); })).label, '暂时无法估价');
  const before = structuredClone(draft);
  const price = await estimateWorkspacePrice(draft, true, async () => ({ estimatedPrice: 0, currency: 'CNY', isFreeThisCall: true }));
  assert.match(price.label, /RunningHub 报价/); assert.deepEqual(draft, before);
});

test('price identity cannot cross object/type/parameter/reference changes', () => {
  const first = workspacePriceKey(draft);
  assert.notEqual(first, workspacePriceKey({ ...draft, objectId: 'shot:b' }));
  assert.notEqual(first, workspacePriceKey({ ...draft, params: { ...draft.params, duration: '15' } }));
  assert.equal(first, workspacePriceKey({ ...draft, prompt: '编辑提示词但规格不变' }));
});

test('real price-preview parser rejects empty success payloads and forwards cancellation (offline transport)', async () => {
  const original = globalThis.fetch;
  let payload: unknown = {};
  const controller = new AbortController();
  try {
    globalThis.fetch = async (_url, init) => {
      assert.equal(init?.signal, controller.signal);
      return new Response(JSON.stringify(payload), { status: 200 });
    };
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const output = await build({ absWorkingDir: root, entryPoints: ['src/lib/rhtv/pricePreview.ts'], bundle: true,
      write: false, format: 'esm', platform: 'node', plugins: [{ name: 'no-credentials', setup(b) {
        b.onResolve({ filter: /^\.\/client$/ }, () => ({ path: 'client', namespace: 'mock' }));
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const getRhtvApiKey=()=>"offline-placeholder"; export const rhtvBase=()=>"https://offline.invalid";' }));
      } }] });
    const module = await import(`data:text/javascript;base64,${Buffer.from(output.outputFiles[0].text).toString('base64')}`);
    assert.equal(await module.previewPrice('empty', {}, controller.signal), null);
    payload = { estimatedPrice: 1.2, currency: 'CNY', isFreeThisCall: 'true' };
    const quote = await module.previewPrice('valid', {}, controller.signal);
    assert.equal(quote.isFreeThisCall, false);
    assert.equal(quote.estimatedPrice, 1.2);
  } finally { globalThis.fetch = original; }
});
