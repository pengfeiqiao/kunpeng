import test from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyWan3LinkUrl,
  selectWan3Channel,
  wan3FallbackOrder,
  WAN3_CHANNEL_PREFERENCE,
  type Wan3Metric,
} from './wan3.ts';

test('wan3 prefers kuaizi as the primary channel', () => {
  assert.deepEqual(WAN3_CHANNEL_PREFERENCE, ['kuaizi', 'runninghub', 'apimart']);
  const selected = selectWan3Channel({ available: ['apimart', 'runninghub', 'kuaizi'], metrics: [] });
  assert.equal(selected, 'kuaizi');
});

test('wan3 falls back to next preference when kuaizi is not configured', () => {
  assert.equal(selectWan3Channel({ available: ['runninghub', 'apimart'], metrics: [] }), 'runninghub');
  assert.equal(selectWan3Channel({ available: ['apimart'], metrics: [] }), 'apimart');
  assert.equal(selectWan3Channel({ available: [], metrics: [] }), null);
});

test('wan3 skips an unhealthy channel but keeps it as last resort', () => {
  const now = Date.now();
  const failing: Wan3Metric[] = [0, 1].map((i) => ({
    channel: 'kuaizi',
    startedAt: now - i * 1000,
    totalMs: 1000,
    success: false,
    error: 'boom',
  }));
  assert.equal(selectWan3Channel({ available: ['kuaizi', 'apimart'], metrics: failing, now }), 'apimart');
  // 全部不健康时仍返回偏好序第一个，让它失败并触发后续容灾
  const allFailing: Wan3Metric[] = [
    ...failing,
    ...[0, 1].map((i): Wan3Metric => ({ channel: 'apimart', startedAt: now - i * 1000, totalMs: 1000, success: false })),
  ];
  assert.equal(selectWan3Channel({ available: ['kuaizi', 'apimart'], metrics: allFailing, now }), 'kuaizi');
});

test('wan3FallbackOrder removes tried channels and keeps preference order', () => {
  assert.deepEqual(wan3FallbackOrder(['kuaizi', 'runninghub', 'apimart'], ['kuaizi']), ['runninghub', 'apimart']);
  assert.deepEqual(wan3FallbackOrder(['apimart', 'kuaizi'], []), ['kuaizi', 'apimart']);
  assert.deepEqual(wan3FallbackOrder(['kuaizi'], ['kuaizi']), []);
});

test('classifyWan3LinkUrl: doc extensions -> document, everything else -> link', () => {
  for (const url of ['https://a.com/x.pdf', 'https://a.com/x.docx', 'https://a.com/x.md?dl=1', 'https://a.com/x.PPTX']) {
    assert.equal(classifyWan3LinkUrl(url), 'document', url);
  }
  for (const url of ['https://a.com/article/123', 'https://a.com/x.png', 'https://mp.weixin.qq.com/s/abc']) {
    assert.equal(classifyWan3LinkUrl(url), 'link', url);
  }
});
