import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCanvasActionPrompt, buildCanvasContext, appendCanvasMentionUrls } from './canvasAgentPrompt.ts';

const node = (data = {}, type = 'image') => ({ id: 'N', type, position: { x: 0, y: 0 }, data });

test('legacy canvas context retains focused nodes, edges, media tools and MG fallback instructions', () => {
  const context = buildCanvasContext({ nodes: [node({ description: '原始主体' }), { ...node(), id: 'M' }],
    edges: [{ id: 'E', source: 'M', target: 'N' }] }, ['N']);
  assert.ok(context.startsWith('[用户正在画布视图中操作。'));
  for (const instruction of ['原始主体', '"target":"N"', 'mg_text_fallback_generate', 'canvas_transcribe',
    'doubao_speech_generate(target_node_id)', 'canvas_capture_node', 'canvas_set_node_size', '不要另建无关替代节点']) assert.ok(context.includes(instruction));
});

test('image actions preserve explicit legacy engine, MJ parameters, and original action prompt', async () => {
  const prompt = await buildCanvasActionPrompt(node({ imageModel: 'midjourney', modelVersion: 'v8.1', aspectRatio: '3:2',
    midjourneyStylize: 200, midjourneyChaos: 12, midjourneyRaw: true, midjourneyWeird: 30 }),
  { action: 'ai-generate-image', nodeId: 'N', prompt: '保留主体和九宫格\n参考图片: /reference.png' });
  assert.ok(prompt.includes('保留主体和九宫格\n参考图片: /reference.png'));
  for (const param of ['engine="midjourney-v81"', '"aspectRatio":"3:2"', '"stylize":200', '"chaos":12', '"raw":true', '"weird":30']) assert.ok(prompt.includes(param));
  const variant = await buildCanvasActionPrompt(node({ referenceImage: 'asset://source.png', imageModel: 'midjourney' }), { action: 'ai-image-to-image', nodeId: 'N' });
  assert.ok(variant.includes('engine="gpt-image-2"'));
  assert.ok(variant.includes('reference_urls=["asset://source.png"]'));
});

test('video and Dreamina actions retain original routing instructions and source text', async () => {
  const prompt = await buildCanvasActionPrompt(node({ modelVersion: 'minimax-h3', duration: 8, aspectRatio: '9:16', resolution: '1080p' }, 'video'),
    { action: 'ai-generate-video', nodeId: 'N', prompt: '不改变对白\n参考视频: /take.mp4' });
  for (const part of ['engine="minimax-hailuo-h3"', '"duration":"8"', '"ratio":"9:16"', '不改变对白\n参考视频: /take.mp4']) assert.ok(prompt.includes(part));
  const image = await buildCanvasActionPrompt(node({ imageModel: 'dreamina', resolution: '2k', aspectRatio: '4:3' }),
    { action: 'ai-generate-image', nodeId: 'N', prompt: '主体' });
  assert.equal(image, '请为节点 N 使用即梦生成一张图片。描述："主体"。参数：模型版本 5.0，比例 4:3，分辨率 2k。');
});

test('3D camera and reverse-prompt reuse injected media resolution; lip-sync keeps the complete tool instruction', async () => {
  const calls: string[] = [];
  const resolve = async (url: string) => { calls.push(url); return 'https://example.invalid/ref.png'; };
  const result = await buildCanvasActionPrompt(node({ generatedImageUrl: '/local.png' }),
    { action: 'ai-3d-camera', nodeId: 'N', prompt: '俯角30度，保持人物关系' }, resolve);
  assert.deepEqual(calls, ['/local.png']);
  assert.ok(result.includes('图片 URL: https://example.invalid/ref.png'));
  assert.ok(result.endsWith('俯角30度，保持人物关系'));
  assert.equal(await buildCanvasActionPrompt(node(), { action: 'ai-lip-sync', nodeId: 'N', prompt: 'original\nidentify-face → tts → lip-sync-video' }),
    'original\nidentify-face → tts → lip-sync-video');
});

test('mention URLs retain all three media kinds without changing the user text', () => {
  assert.equal(appendCanvasMentionUrls('原要求', { imageUrls: ['I'], videoUrls: ['V'], audioUrls: ['A'] }),
    '原要求\n\n参考图片: I\n参考视频: V\n参考音频: A');
});
