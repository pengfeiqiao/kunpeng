import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ARK_MODELS,
  DEFAULT_ARK_IMAGE_MODEL,
  DEFAULT_ARK_VIDEO_MODEL,
  arkModelsByModality,
  defaultArkModel,
  getArkModel,
  isArkCatalogModelId,
  mergeArkModels,
} from './arkModels.ts';

test('注册表无重复 id', () => {
  const ids = ARK_MODELS.map((m) => m.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('每个条目的 status/modality/tier 合法且 id 形式正确', () => {
  for (const m of ARK_MODELS) {
    assert.match(m.id, /^doubao-(seedance|seedream)-[a-z0-9-]+$/);
    assert.ok(m.status === 'published' || m.status === 'retiring');
    assert.ok(m.modality === 'video' || m.modality === 'image');
    assert.ok(m.label.length > 0);
    // id 前缀与 modality 一致
    assert.equal(m.modality, m.id.startsWith('doubao-seedance-') ? 'video' : 'image');
  }
});

test('retiring 标记存在且符合预期', () => {
  const retiring = ARK_MODELS.filter((m) => m.status === 'retiring').map((m) => m.id);
  assert.ok(retiring.includes('doubao-seedance-1-0-lite-t2v-250428'));
  assert.ok(retiring.includes('doubao-seedance-1-0-lite-i2v-250428'));
  assert.ok(retiring.includes('doubao-seedream-3-0-t2i-250415'));
  // retiring 模型保留在表里，但默认过滤掉
  assert.ok(arkModelsByModality('video').every((m) => m.status === 'published'));
  assert.ok(arkModelsByModality('video', { includeRetiring: true }).some((m) => m.status === 'retiring'));
});

test('按 modality 过滤正确', () => {
  const videos = arkModelsByModality('video');
  const images = arkModelsByModality('image');
  assert.ok(videos.length > 0 && videos.every((m) => m.modality === 'video'));
  assert.ok(images.length > 0 && images.every((m) => m.modality === 'image'));
  // Seedance 2.5 与 Seedream 5.0 必须在册
  assert.ok(videos.some((m) => m.id === 'doubao-seedance-2-5-260628'));
  assert.ok(images.some((m) => m.id === 'doubao-seedream-5-0-260128'));
});

test('默认模型存在、已发布且为官方目录 ID', () => {
  assert.equal(DEFAULT_ARK_VIDEO_MODEL, 'doubao-seedance-2-5-260628');
  assert.equal(DEFAULT_ARK_IMAGE_MODEL, 'doubao-seedream-5-0-260128');
  assert.equal(defaultArkModel('video').status, 'published');
  assert.equal(defaultArkModel('image').status, 'published');
  // 历史别名 doubao-seedream-5-0-pro-260628 不再是默认值
  assert.notEqual(DEFAULT_ARK_IMAGE_MODEL, 'doubao-seedream-5-0-pro-260628');
  assert.ok(getArkModel(DEFAULT_ARK_VIDEO_MODEL));
  assert.ok(getArkModel(DEFAULT_ARK_IMAGE_MODEL));
});

test('isArkCatalogModelId 只认 seedance/seedream 族目录 ID', () => {
  assert.ok(isArkCatalogModelId('doubao-seedance-2-0-260128'));
  assert.ok(isArkCatalogModelId('doubao-seedream-5-0-260128'));
  assert.ok(!isArkCatalogModelId('ep-20260101-xxxxx')); // 用户自建接入点不属于目录同步范围
  assert.ok(!isArkCatalogModelId('gpt-image-2'));
});

test('mergeArkModels：缓存在前、静态注册表去重补后', () => {
  const merged = mergeArkModels({
    models: [
      { id: 'doubao-seedance-9-9-990101', label: '未来的模型' },
      { id: 'doubao-seedream-5-0-260128' }, // 与静态注册表重复
    ],
    syncedAt: 1,
  });
  assert.equal(merged[0].id, 'doubao-seedance-9-9-990101');
  assert.equal(merged[0].source, 'cache');
  assert.equal(merged[0].modality, 'video'); // 按 id 前缀推断
  // 重复的 id 只出现一次，且以缓存为准
  assert.equal(merged.filter((m) => m.id === 'doubao-seedream-5-0-260128').length, 1);
  assert.equal(merged.find((m) => m.id === 'doubao-seedream-5-0-260128')?.source, 'cache');
  // 静态注册表其余条目补在后面（含 retiring）
  assert.ok(merged.some((m) => m.source === 'static' && m.status === 'retiring'));
  // 缓存里的重复 id 也被去掉
  const dup = mergeArkModels({ models: [{ id: 'doubao-seedance-2-0-260128' }, { id: 'doubao-seedance-2-0-260128' }], syncedAt: 1 });
  assert.equal(dup.filter((m) => m.id === 'doubao-seedance-2-0-260128').length, 1);
});

test('mergeArkModels：无缓存时回退静态注册表', () => {
  const merged = mergeArkModels(null);
  assert.equal(merged.length, ARK_MODELS.length);
  assert.ok(merged.every((m) => m.source === 'static'));
});
