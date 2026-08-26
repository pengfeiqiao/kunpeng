import test from 'node:test';
import assert from 'node:assert/strict';
import type { AgentUserContentBlock } from '../types.ts';
import { buildAcpPromptContent, mediaToAcpContent } from './mediaFilter.ts';

const base64Image: AgentUserContentBlock = {
  type: 'image',
  source: { type: 'base64', media_type: 'image/png', data: 'aGVsbG8=' },
};
const base64Video: AgentUserContentBlock = {
  type: 'video',
  source: { type: 'base64', media_type: 'video/mp4', data: 'aGVsbG8=' },
};
const urlImage: AgentUserContentBlock = {
  type: 'image',
  source: { type: 'url', url: 'https://example.com/pic.png' },
};

test('text blocks pass through unchanged', () => {
  assert.deepEqual(
    mediaToAcpContent({ type: 'text', text: 'hello' }),
    { type: 'text', text: 'hello' },
  );
});

test('base64 image blocks become ACP image blocks (fork bridge + attachment store)', () => {
  // kunpeng-acp.mjs fork 接受 image 块并经 attachment store 持久化，
  // pi-ai 视觉路由（模型声明 input:[text,image]）原生看图。
  assert.deepEqual(mediaToAcpContent(base64Image), {
    type: 'image',
    data: 'aGVsbG8=',
    mimeType: 'image/png',
  });
});

test('base64 video blocks are still dropped (vision models only accept images)', () => {
  assert.equal(mediaToAcpContent(base64Video), null);
});

test('remote media becomes a resource_link, which ACP accepts', () => {
  assert.deepEqual(mediaToAcpContent(urlImage), {
    type: 'resource_link',
    uri: 'https://example.com/pic.png',
    name: 'pic.png',
  });
});

test('buildAcpPromptContent reports every dropped media block', () => {
  const dropped: string[] = [];
  const out = buildAcpPromptContent(
    [{ type: 'text', text: 't' }, base64Image, urlImage, base64Video],
    (block) => dropped.push(block.type),
  );
  assert.equal(out.length, 3);
  assert.equal(out[0].type, 'text');
  assert.equal(out[1].type, 'image');
  assert.equal(out[2].type, 'resource_link');
  assert.deepEqual(dropped, ['video']);
});
