import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const code = ts.transpileModule(readFileSync(new URL('./mcpToolAdapter.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
const exports = {};
runInNewContext(code, { exports, structuredClone, require: id => {
  assert.equal(id, '../logger'); return { agentLog: { info() {}, error() {} } };
} });
test('MCP desktop/Blender schemas retain nested actions, coordinates, nullable fields and numeric enums', () => {
  const inputSchema = { type: 'object', additionalProperties: false, properties: { actions: { type: 'array', items: { type: 'object', properties: {
    x: { type: 'number' }, mode: { enum: [1, 2] }, target: { type: ['string', 'null'] },
  }, required: ['x'] } } }, required: ['actions'] };
  const tool = exports.createMcpTool({ name: 'act', inputSchema }, 'desktop', {});
  assert.deepEqual(tool.definition.parameters, inputSchema);
  assert.notEqual(tool.definition.parameters, inputSchema);
});
test('MCP screenshots and rendered frames reach native model media with matching call args', async () => {
  let request;
  const tool = exports.createMcpTool({ name: 'render', inputSchema: { type: 'object' } }, 'blender', {
    request: async (...args) => { request = args; return { result: { content: [
      { type: 'text', text: 'saved scene.blend' }, { type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' },
    ] } }; },
  });
  const result = await tool.execute({ camera: 'Camera' });
  assert.equal(request[0], 'tools/call'); assert.equal(request[1].name, 'render'); assert.equal(request[1].arguments.camera, 'Camera');
  assert.equal(result.success, true); assert.equal(result.media[0].source.data, 'aGVsbG8=');
  assert.equal(result.media[0].source.media_type, 'image/png'); assert.ok(result.output.includes('scene.blend'));
  assert.ok(!result.output.includes('aGVsbG8='));
});

test('same MCP image and nested schema remain compatible with DeepSeek and Kimi Anthropic loops', async () => {
  const glmSource = readFileSync(new URL('../glmClient.ts', import.meta.url), 'utf8') + '\nexport { convertMessages, convertTools };';
  const glmCode = ts.transpileModule(glmSource, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const glm = {};
  runInNewContext(glmCode, { exports: glm, require: () => ({}) });
  const tool = exports.createMcpTool({ name: 'screenshot', inputSchema: { type: 'object', properties: {
    region: { type: 'object', properties: { x: { type: 'number' } }, required: ['x'] },
  } } }, 'desktop', { request: async () => ({ result: { content: [{ type: 'image', mimeType: 'image/png', data: 'aGVsbG8=' }] } }) });
  const result = await tool.execute({});
  for (const [base, model] of [['https://api.deepseek.com/anthropic', 'deepseek-flash'], ['https://api.kimi.com/coding/', 'k3']]) {
    assert.equal(glm.supportsNativeVision(base, model), true);
    const converted = glm.convertMessages([
      { role: 'assistant', content: null, tool_calls: [{ id: 'call', type: 'function', function: { name: tool.definition.name, arguments: '{}' } }], thinking_blocks: [{ type: 'thinking', thinking: 'inspect', signature: 'signature' }] },
      { role: 'tool', tool_call_id: 'call', content: result.output, media: result.media },
    ], { allowMedia: true, injectThinking: true });
    assert.equal(converted.messages[0].content[0].signature, 'signature');
    assert.equal(converted.messages[1].content[0].tool_use_id, 'call');
    assert.equal(converted.messages[1].content[0].content[1].source.data, 'aGVsbG8=');
    assert.deepEqual(glm.convertTools([tool.definition])[0].input_schema, tool.definition.parameters);
  }
});

test('MCP result traverses unchanged DSH tool RPC and preserves image budget/replay guard', async () => {
  const rpc = await import('../dsh/toolRpc.ts');
  const bridgeCode = ts.transpileModule(readFileSync(new URL('../dsh/toolBridge.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const bridgeModule = {}; let response, dispatched = false, executed = 0;
  runInNewContext(bridgeCode, { exports: bridgeModule, AbortController, require: id => {
    if (id === './toolRpc.ts') return rpc;
    if (id === '../hooks.ts') return { firePreToolUse: async () => ({}), firePostToolUse: async () => {} };
    if (id === '@tauri-apps/api/tauri') return { invoke: async (_name, args) => { response = args.response; } };
    if (id === '@tauri-apps/api/event') return {};
    throw Error(id);
  } });
  let data = 'aGVsbG8=';
  const tool = exports.createMcpTool({ name: 'render', inputSchema: { type: 'object', properties: { points: { type: 'array', items: { type: 'number' } } } } }, 'blender', {
    request: async () => { assert.equal(dispatched, true); executed++; return { result: { content: [{ type: 'text', text: 'render.png' }, { type: 'image', mimeType: 'image/png', data }] } }; },
  });
  const registry = { getDefinitions: () => [tool.definition], get: () => tool, execute: (_name, args) => tool.execute(args) };
  assert.deepEqual(rpc.serializeDshTools(registry)[0].inputSchema, tool.definition.parameters);
  const callbacks = { onToolStart() {}, onToolEnd() {}, onToolConfirm: async () => true };
  const bridge = new bridgeModule.DshToolBridge('run', 'instance', registry, callbacks, () => { dispatched = true; });
  const call = { runId: 'run', instanceId: 'instance', requestId: 'r1', name: tool.definition.name, arguments: {} };
  await bridge.execute(call);
  assert.equal(response.result.content[1].type, 'image'); assert.equal(response.result.content[1].data, data);
  assert.equal(response.result.isError, false); assert.equal(executed, 1);
  data = 'x'.repeat(7 * 1024 * 1024);
  await bridge.execute({ ...call, requestId: 'r2' });
  assert.equal(response.result.content.some(block => block.type === 'image'), false);
  assert.ok(response.result.content.some(block => block.text?.includes('传输安全上限')));
  bridge.abort(); await bridge.execute({ ...call, requestId: 'r3' }); assert.equal(executed, 2);
});

test('non-native image formats retain the legacy text result without breaking vision requests', async () => {
  const tool = exports.createMcpTool({ name: 'vector', inputSchema: { type: 'object' } }, 'preview', {
    request: async () => ({ result: { content: [{ type: 'image', mimeType: 'image/svg+xml', data: 'fake-svg' }] } }),
  });
  const result = await tool.execute({});
  assert.equal(result.success, true); assert.equal(result.media, undefined);
  assert.equal(result.output, '[image: image/svg+xml]');
});


test('Blender structured scene results remain available without text content', async () => {
  const tool = exports.createMcpTool({ name: 'scene', inputSchema: { type: 'object' } }, 'blender', {
    request: async () => ({ result: { structuredContent: { objects: ['Cube'], saved: true } } }),
  });
  const result = await tool.execute({});
  assert.equal(result.success, true);
  assert.deepEqual(JSON.parse(result.output), { objects: ['Cube'], saved: true });
});

test('cancelled MCP adapter never dispatches a mutation', async () => {
  let dispatched = false;
  const tool = exports.createMcpTool({ name: 'mutate', inputSchema: { type: 'object' } }, 'blender', {
    request: async () => { dispatched = true; },
  });
  const signal = new AbortController(); signal.abort();
  const result = await tool.execute({}, signal.signal);
  assert.equal(result.success, false); assert.equal(dispatched, false);
});
