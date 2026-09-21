import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { buildVideoAnalysisQuestion } from '../../videoAnalysis/recreation.ts';

// Mirror visionTool.test.mjs: strip single-line imports, inject stubs, execute.
async function fixture(options = {}) {
  const { kimiConfigured = true } = options;
  const source = await readFile(new URL('./videoUnderstandingTool.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source.replace(/^import .*;$/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 },
  }).outputText;
  const stubs = `
    const buildVideoAnalysisQuestion = ${buildVideoAnalysisQuestion.toString()};
    const VIDEO_RECREATION_GUIDANCE = ${JSON.stringify((await import('../../videoAnalysis/recreation.ts')).VIDEO_RECREATION_GUIDANCE)};
    let k3Calls = []; let uploads = []; let sizes = {};
    export const stats = () => ({ k3Calls, uploads });
    export const setSize = (p, s) => { sizes[p] = s; };
    const invoke = async (cmd, args) => {
      if (cmd === 'get_file_size') return sizes[args.path] ?? 1024;
      throw new Error('unexpected invoke ' + cmd);
    };
    const normalizeLocalMediaPath = (p) => p;
    const loadMediaInput = async () => ({ dataUrl: 'data:video/mp4;base64,aGVsbG8=', mediaType: 'video/mp4' });
    const KIMI_INLINE_VIDEO_MAX_BYTES = 12 * 1024 * 1024;
    const KIMI_FILE_VIDEO_MAX_BYTES = 100 * 1024 * 1024;
    const uploadVideoToKimi = async (path) => { uploads.push(path); return { fileId: 'f1', url: 'ms://f1' }; };
    const isKimiK3Configured = () => ${kimiConfigured};
    const kimiK3Chat = async (messages) => { k3Calls.push(messages); return 'K3 分析结论'; };
  `;
  return import(`data:text/javascript;base64,${Buffer.from(`${stubs}\n${js}`).toString('base64')}#${Math.random()}`);
}

test('planLocalVideoSource tiers by Kimi inline/file limits', async () => {
  const { planLocalVideoSource } = await fixture();
  assert.equal(planLocalVideoSource(1024), 'inline');
  assert.equal(planLocalVideoSource(50 * 1024 * 1024), 'upload');
  assert.equal(planLocalVideoSource(200 * 1024 * 1024), 'too-large');
});

test('Kimi route re-watches an uploaded video natively without any extra API call', async () => {
  const { videoUnderstandingTool, stats } = await fixture();
  const result = await videoUnderstandingTool.execute(
    { video: 'ms://existing', prompt: '再看一遍开头' },
    undefined,
    { nativeVideo: true },
  );
  assert.equal(result.success, true);
  assert.equal(result.media[0].type, 'video');
  assert.equal(result.media[0].source.url, 'ms://existing');
  assert.match(result.output, /再看一遍/);
  assert.equal(stats().k3Calls.length, 0);
  assert.equal(stats().uploads.length, 0);
});

test('Kimi route inlines small local videos and uploads large ones', async () => {
  const { videoUnderstandingTool, setSize, stats } = await fixture();
  setSize('/tmp/small.mp4', 1024);
  const small = await videoUnderstandingTool.execute({ video: '/tmp/small.mp4' }, undefined, { nativeVideo: true });
  assert.equal(small.media[0].source.type, 'base64');
  assert.equal(small.media[0].source.data, 'aGVsbG8=');

  setSize('/tmp/big.mp4', 50 * 1024 * 1024);
  const big = await videoUnderstandingTool.execute({ video: '/tmp/big.mp4' }, undefined, { nativeVideo: true });
  assert.equal(big.media[0].source.url, 'ms://f1');
  assert.deepEqual(stats().uploads, ['/tmp/big.mp4']);
  assert.equal(stats().k3Calls.length, 0);
});

test('oversized local video fails loudly with local-index guidance instead of pretending', async () => {
  const { videoUnderstandingTool, setSize, stats } = await fixture();
  setSize('/tmp/huge.mp4', 200 * 1024 * 1024);
  const result = await videoUnderstandingTool.execute({ video: '/tmp/huge.mp4' }, undefined, { nativeVideo: true });
  assert.equal(result.success, false);
  assert.match(result.error, /100 MB/);
  assert.match(result.error, /timeline_analyze_reference_video/);
  assert.equal(stats().uploads.length, 0);
});

test('public URLs bypass the session echo and go straight to Kimi K3', async () => {
  const { videoUnderstandingTool, stats } = await fixture();
  const result = await videoUnderstandingTool.execute(
    { video: 'https://example.com/a.mp4', prompt: '总结' },
    undefined,
    { nativeVideo: true },
  );
  assert.equal(result.success, true);
  assert.equal(result.media, undefined);
  assert.equal(stats().k3Calls.length, 1);
  assert.match(result.output, /K3 分析结论/);
});

test('non-Kimi route uses Kimi K3 directly when configured', async () => {
  const { videoUnderstandingTool, setSize, stats } = await fixture();
  setSize('/tmp/clip.mp4', 30 * 1024 * 1024);
  const result = await videoUnderstandingTool.execute({ video: '/tmp/clip.mp4' }, undefined, { nativeVideo: false });
  assert.equal(result.success, true);
  assert.deepEqual(stats().uploads, ['/tmp/clip.mp4']);
  assert.equal(stats().k3Calls.length, 1);
  assert.match(result.output, /Kimi K3 原生理解/);
});

test('non-Kimi route without a Kimi key fails with guidance, never silently pretends', async () => {
  const { videoUnderstandingTool, stats } = await fixture({ kimiConfigured: false });
  const result = await videoUnderstandingTool.execute({ video: '/tmp/clip.mp4' }, undefined, { nativeVideo: false });
  assert.equal(result.success, false);
  assert.match(result.error, /timeline_analyze_reference_video/);
  assert.equal(stats().k3Calls.length, 0);
});

test('detailed analysis protocol reaches both native feedback and direct K3 without extra calls', async () => {
  const { videoUnderstandingTool, stats } = await fixture();
  const prompt = '分析这段视频，换主题复刻';
  const expected = buildVideoAnalysisQuestion(prompt);
  const native = await videoUnderstandingTool.execute({video:'ms://existing',prompt},undefined,{nativeVideo:true});
  assert.ok(native.output.endsWith(expected));
  assert.equal(stats().k3Calls.length,0);
  await videoUnderstandingTool.execute({video:'https://example.com/ref.mp4',prompt});
  assert.equal(stats().k3Calls.length,1);
  assert.equal(stats().k3Calls[0][1].content[1].text,expected);
});
