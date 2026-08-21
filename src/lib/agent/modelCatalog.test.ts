import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHAT_MODELS,
  CHAT_PROVIDER_LABELS,
  decodeChatModel,
  encodeChatModel,
  getDefaultModelId,
} from './modelCatalog.ts';

test('every catalog provider has a display label', () => {
  for (const providerId of Object.keys(CHAT_MODELS)) {
    assert.ok(CHAT_PROVIDER_LABELS[providerId], `missing label for ${providerId}`);
  }
});

test('every model option is complete and unique within its provider', () => {
  for (const [providerId, models] of Object.entries(CHAT_MODELS)) {
    assert.ok(models.length > 0, `${providerId} has no models`);
    const seen = new Set<string>();
    for (const model of models) {
      assert.ok(model.value && model.label && model.detail, `incomplete option in ${providerId}`);
      assert.ok(!seen.has(model.value), `duplicate model ${model.value} in ${providerId}`);
      seen.add(model.value);
    }
    // The default must be a real catalog entry.
    assert.equal(getDefaultModelId(providerId), models[0].value);
  }
});

test('encode/decode round-trips and rejects malformed values', () => {
  assert.deepEqual(decodeChatModel(encodeChatModel('minimax', 'MiniMax-M3')), {
    providerId: 'minimax',
    modelId: 'MiniMax-M3',
  });
  assert.equal(decodeChatModel('global'), null);
  assert.equal(decodeChatModel(''), null);
  assert.equal(decodeChatModel('nomodel'), null);
});
