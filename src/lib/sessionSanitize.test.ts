import assert from 'node:assert/strict';
import test from 'node:test';
import {
  BASE64_STRIP_NOTE,
  extractMediaPathFromOutput,
  sanitizeSessionFileData,
  stripSessionMedia,
  stripSessionMediaFromMessage,
} from './sessionSanitize.ts';

const BASE64_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk';

function makeImageGenerateMessage() {
  return {
    id: 'm1',
    role: 'assistant',
    content: '图片已生成',
    metadata: {
      toolExecutions: [
        {
          id: 't1',
          toolName: 'image_generate',
          params: { prompt: '一只猫' },
          status: 'completed',
          startTime: 1,
          result: {
            success: true,
            output: '图片生成完成。\n模型：gpt-image-2\n画幅：16:9\n通道：dmx\n文件：/Users/test/Desktop/cat.png',
            media: [
              { type: 'image', source: { type: 'base64', media_type: 'image/png', data: BASE64_DATA } },
            ],
          },
        },
      ],
    },
  };
}

test('strips base64 media and replaces it with a parsed path placeholder', () => {
  const [stripped] = stripSessionMedia([makeImageGenerateMessage()]);
  const execution = (stripped.metadata.toolExecutions as Array<Record<string, unknown>>)[0];
  const result = execution.result as Record<string, unknown>;
  const media = result.media as Array<Record<string, unknown>>;
  assert.equal(media.length, 1);
  assert.equal(media[0].type, 'image');
  assert.deepEqual(media[0].source, { type: 'path', path: '/Users/test/Desktop/cat.png' });
  assert.equal(media[0].note, BASE64_STRIP_NOTE);
  // base64 数据被彻底移除，其余字段（params / output）原样保留
  assert.doesNotMatch(JSON.stringify(stripped), new RegExp(BASE64_DATA.slice(0, 24)));
  assert.deepEqual(execution.params, { prompt: '一只猫' });
  assert.match(result.output as string, /文件：\/Users\/test\/Desktop\/cat\.png/);
});

test('omits source when the output has no parseable path', () => {
  const message = makeImageGenerateMessage();
  const execution = message.metadata.toolExecutions[0];
  execution.result.output = '截图完成，但未记录路径';
  const [stripped] = stripSessionMedia([message]);
  const media = ((stripped.metadata.toolExecutions as Array<Record<string, unknown>>)[0]
    .result as Record<string, unknown>).media as Array<Record<string, unknown>>;
  assert.equal(media[0].type, 'image');
  assert.equal(media[0].source, undefined);
  assert.equal(media[0].note, BASE64_STRIP_NOTE);
});

test('messages without base64 media keep their reference and shape', () => {
  const plain = { id: 'm2', role: 'user', content: '你好' };
  const urlMedia = {
    id: 'm3',
    role: 'assistant',
    metadata: {
      toolExecutions: [
        {
          id: 't2',
          result: {
            success: true,
            output: 'ok',
            media: [{ type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } }],
          },
        },
      ],
    },
  };
  const input = [plain, urlMedia];
  const stripped = stripSessionMedia(input);
  assert.equal(stripped, input);
  assert.equal(stripped[0], plain);
  assert.equal(stripped[1], urlMedia);
});

test('stripping does not mutate the input message', () => {
  const message = makeImageGenerateMessage();
  stripSessionMedia([message]);
  const media = message.metadata.toolExecutions[0].result.media;
  assert.equal((media[0].source as Record<string, unknown>).data, BASE64_DATA);
  assert.equal((media[0] as Record<string, unknown>).note, undefined);
});

test('extractMediaPathFromOutput parses the producer output formats', () => {
  assert.equal(extractMediaPathFromOutput('文件：/tmp/a.png'), '/tmp/a.png');
  assert.equal(extractMediaPathFromOutput('文件:/tmp/a.png'), '/tmp/a.png');
  assert.equal(extractMediaPathFromOutput('文件：/tmp/含 空格 的图.png'), '/tmp/含 空格 的图.png');
  assert.equal(extractMediaPathFromOutput('节点 n1 已更新，主产物: /tmp/b.png'), '/tmp/b.png');
  assert.equal(extractMediaPathFromOutput('母版概念图：/tmp/c.png\n视频：/tmp/c.mp4'), '/tmp/c.png');
  assert.equal(extractMediaPathFromOutput('{\n  "path": "/tmp/d.png",\n  "sec": 1\n}'), '/tmp/d.png');
  assert.equal(extractMediaPathFromOutput('没有路径'), undefined);
  assert.equal(extractMediaPathFromOutput('文件：relative/not-absolute.png'), undefined);
  assert.equal(extractMediaPathFromOutput(undefined), undefined);
  assert.equal(extractMediaPathFromOutput(42), undefined);
});

test('stripSessionMediaFromMessage strips top-level tool-message media using content as path hint', () => {
  const toolMessage = {
    role: 'tool',
    tool_call_id: 'call-1',
    content: '图片生成完成。\n文件：/tmp/tool-out.png',
    media: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: BASE64_DATA } }],
  };
  const stripped = stripSessionMediaFromMessage(toolMessage);
  assert.notEqual(stripped, toolMessage);
  assert.deepEqual(stripped.media, [
    { type: 'image', source: { type: 'path', path: '/tmp/tool-out.png' }, note: BASE64_STRIP_NOTE },
  ]);
  // 原对象未被改动
  assert.equal(toolMessage.media[0].source.type, 'base64');
});

test('sanitizeSessionFileData strips both messages and agentMessages', () => {
  const fileData = {
    schemaVersion: 2,
    sessionId: 's1',
    updatedAt: 123,
    messages: [makeImageGenerateMessage()],
    agentMessages: [
      { role: 'system', content: 'sys' },
      {
        role: 'tool',
        tool_call_id: 'call-9',
        content: '无路径输出',
        media: [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: BASE64_DATA } }],
      },
    ],
  };
  const sanitized = sanitizeSessionFileData(fileData);
  assert.notEqual(sanitized, fileData);
  assert.equal(sanitized.schemaVersion, 2);
  assert.equal(sanitized.sessionId, 's1');
  assert.equal(sanitized.updatedAt, 123);
  assert.doesNotMatch(JSON.stringify(sanitized), new RegExp(BASE64_DATA.slice(0, 24)));
  const agentTool = sanitized.agentMessages[1] as Record<string, unknown>;
  assert.deepEqual(agentTool.media, [{ type: 'image', note: BASE64_STRIP_NOTE }]);
  // 不携带媒体的 system 消息保持原引用
  assert.equal(sanitized.agentMessages[0], fileData.agentMessages[0]);
});

test('sanitizeSessionFileData returns the same object when nothing needs stripping', () => {
  const fileData = {
    schemaVersion: 2,
    sessionId: 's2',
    updatedAt: 1,
    messages: [{ id: 'm', role: 'user', content: '纯文本' }],
    agentMessages: [{ role: 'user', content: '纯文本' }],
  };
  assert.equal(sanitizeSessionFileData(fileData), fileData);
});
