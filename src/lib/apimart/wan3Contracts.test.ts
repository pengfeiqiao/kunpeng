import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApimartWan3Payload } from './contracts.ts';

test('apimart wan3 payload: t2v defaults', () => {
  const p = buildApimartWan3Payload({ prompt: '一只猫在屋顶奔跑' });
  assert.equal(p.model, 'wan3.0-video');
  assert.equal(p.resolution, '1080P');
  assert.equal(p.size, 'adaptive');
  assert.equal(p.duration, 5);
  assert.equal(p.audio, true);
  assert.equal(p.generation_type, undefined);
});

test('apimart wan3 payload: media forces generation_type=reference (never first/last frame family)', () => {
  const p = buildApimartWan3Payload({
    prompt: '图1的人抱起吉他',
    imageUrls: ['https://a/1.png', 'https://a/2.png'],
  });
  assert.equal(p.generation_type, 'reference');
  assert.deepEqual(p.image_urls, ['https://a/1.png', 'https://a/2.png']);
});

test('apimart wan3 payload: file_url / link_url pass-through and mutual exclusion', () => {
  const withFile = buildApimartWan3Payload({ prompt: '把文档做成短片', fileUrl: 'https://a/doc.pdf' });
  assert.equal(withFile.file_url, 'https://a/doc.pdf');
  assert.equal(withFile.generation_type, 'reference');
  const withLink = buildApimartWan3Payload({ prompt: '把这篇文章做成科普短片', linkUrl: 'https://a/article' });
  assert.equal(withLink.link_url, 'https://a/article');
  assert.throws(
    () => buildApimartWan3Payload({ prompt: 'x', fileUrl: 'https://a/d.pdf', linkUrl: 'https://a/p' }),
    /互斥/,
  );
});

test('apimart wan3 payload: clamps, -1 duration, prompt-or-media required', () => {
  assert.throws(() => buildApimartWan3Payload({ prompt: '' }), /至少提供其一/);
  const auto = buildApimartWan3Payload({ prompt: 'x', duration: -1 });
  assert.equal(auto.duration, -1);
  const clamped = buildApimartWan3Payload({ prompt: 'x', duration: 99, resolution: '4k', aspectRatio: '21:9' });
  assert.equal(clamped.duration, 30);
  assert.equal(clamped.resolution, '1080P');
  assert.equal(clamped.size, 'adaptive');
});

test('apimart wan3 payload: media count limits', () => {
  const imgs = Array.from({ length: 11 }, (_, i) => `https://a/${i}.png`);
  assert.throws(() => buildApimartWan3Payload({ prompt: 'x', imageUrls: imgs }), /10 张参考图/);
});
