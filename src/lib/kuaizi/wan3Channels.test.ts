import test from 'node:test';
import assert from 'node:assert/strict';
import { buildKuaiziWan3Payload } from './wan3Payload.ts';
import { buildKuaiziH3Payload } from './minimaxH3Payload.ts';

test('wan3 payload: t2v minimal', () => {
  const p = buildKuaiziWan3Payload({ prompt: '一只猫在屋顶奔跑' }) as {
    model: string;
    input: { prompt?: string; media?: unknown[] };
    parameters: Record<string, unknown>;
  };
  assert.equal(p.model, 'wan3.0-video');
  assert.equal(p.input.prompt, '一只猫在屋顶奔跑');
  assert.equal(p.input.media, undefined);
  assert.equal(p.parameters.resolution, '1080P');
  assert.equal(p.parameters.duration, 5);
  assert.equal(p.parameters.audio, true);
  assert.equal(p.parameters.watermark, false);
});

test('wan3 payload: reference media + file, no first/last frame roles', () => {
  const p = buildKuaiziWan3Payload({
    prompt: '视频1中的角色抱着图1中的物件',
    imageUrls: ['https://a/1.png'],
    videoUrls: ['https://a/2.mp4'],
    audioUrls: ['https://a/3.mp3'],
    documentUrl: 'https://a/doc.pdf',
    duration: '12',
    resolution: '480p',
    ratio: '9:16',
  }) as { input: { media: { type: string; url: string }[] }; parameters: Record<string, unknown> };
  assert.deepEqual(
    p.input.media.map((m) => m.type),
    ['reference_image', 'reference_video', 'reference_audio', 'file'],
  );
  assert.equal(p.parameters.resolution, '480P');
  assert.equal(p.parameters.duration, 12);
  assert.equal(p.parameters.ratio, '9:16');
});

test('wan3 payload: file and link are mutually exclusive', () => {
  assert.throws(
    () => buildKuaiziWan3Payload({ prompt: 'x', documentUrl: 'https://a/d.pdf', linkUrl: 'https://a/p' }),
    /互斥/,
  );
});

test('wan3 payload: prompt or media required, clamps and -1 duration', () => {
  assert.throws(() => buildKuaiziWan3Payload({ prompt: ' ' }), /至少提供其一/);
  const auto = buildKuaiziWan3Payload({ prompt: 'x', duration: -1 }) as { parameters: { duration: number } };
  assert.equal(auto.parameters.duration, -1);
  const clamped = buildKuaiziWan3Payload({ prompt: 'x', duration: 99 }) as { parameters: { duration: number } };
  assert.equal(clamped.parameters.duration, 30);
});

test('wan3 payload: media count limits', () => {
  const imgs = Array.from({ length: 11 }, (_, i) => `https://a/${i}.png`);
  assert.throws(() => buildKuaiziWan3Payload({ prompt: 'x', imageUrls: imgs }), /10 张参考图/);
  const vids = Array.from({ length: 6 }, (_, i) => `https://a/${i}.mp4`);
  assert.throws(() => buildKuaiziWan3Payload({ prompt: 'x', videoUrls: vids }), /5 段参考视频/);
});

test('h3 payload: content array uses reference roles only', () => {
  const p = buildKuaiziH3Payload({
    prompt: '图1的人转身微笑',
    imageUrls: ['https://a/1.png'],
    videoUrls: ['https://a/2.mp4'],
    audioUrls: ['https://a/3.mp3'],
    duration: '8',
  }) as { model: string; content: { type: string; role?: string }[]; resolution: string; duration: number; ratio: string };
  assert.equal(p.model, 'MiniMax-H3');
  assert.equal(p.content[0].type, 'text');
  assert.deepEqual(
    p.content.slice(1).map((c) => c.role),
    ['reference_image', 'reference_video', 'reference_audio'],
  );
  assert.equal(p.resolution, '2K');
  assert.equal(p.duration, 8);
  assert.equal(p.ratio, 'adaptive');
});

test('h3 payload: t2v ratio cannot stay adaptive', () => {
  const p = buildKuaiziH3Payload({ prompt: '烟花' }) as { ratio: string };
  assert.equal(p.ratio, '16:9');
  const explicit = buildKuaiziH3Payload({ prompt: '烟花', ratio: '9:16' }) as { ratio: string };
  assert.equal(explicit.ratio, '9:16');
});

test('h3 payload: clamps duration to 4-15 and resolution to 768P/2K', () => {
  const hi = buildKuaiziH3Payload({ prompt: 'x', duration: 99, resolution: '4K' }) as { duration: number; resolution: string };
  assert.equal(hi.duration, 15);
  assert.equal(hi.resolution, '2K');
  const low = buildKuaiziH3Payload({ prompt: 'x', duration: 1, resolution: '768P' }) as { duration: number; resolution: string };
  assert.equal(low.duration, 4);
  assert.equal(low.resolution, '768P');
});
