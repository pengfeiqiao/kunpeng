import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

test('workspace optimizer keeps reference identity, forwards cancellation, and rejects empty/dangling replies (offline)', async () => {
  const calls: any[] = [];
  let reply = '@图片一 保持司机身份，只调整光线';
  (globalThis as any).__workspaceOptimize = async (messages: unknown, options: unknown) => { calls.push({ messages, options }); return reply; };
  try {
    const root = fileURLToPath(new URL('../../../', import.meta.url));
    const bundle = await build({ absWorkingDir: root, entryPoints: ['src/lib/workspace/optimize.ts'], bundle: true, write: false, platform: 'node', format: 'esm',
      plugins: [{ name: 'offline', setup(b) {
        b.onResolve({ filter: /^@tauri-apps\/api\/(fs|path)$/ }, (args) => ({ path: args.path, namespace: 'no-io' }));
        b.onLoad({ filter: /.*/, namespace: 'no-io' }, () => ({ contents: 'export const BaseDirectory = {}; export function createDir() { throw Error("unexpected filesystem write"); } export const writeBinaryFile = createDir; export const homeDir = createDir;', loader: 'js' }));
        b.onResolve({ filter: /(?:^|\/)agent\/quickChat(?:\.ts)?$/ }, (args) => ({ path: args.path, namespace: 'mock' }));
        b.onResolve({ filter: /^@\// }, (args) => args.path === '@/lib/agent/quickChat'
          ? { path: args.path, namespace: 'mock' } : { path: `${root}src/${args.path.slice(2)}.ts` });
        b.onLoad({ filter: /.*/, namespace: 'mock' }, () => ({ contents: 'export const quickChat = globalThis.__workspaceOptimize;', loader: 'js' }));
      } }] });
    const { optimizeWorkspacePrompt, restyleWorkspacePrompt } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`);
    const draft = { id: 'shot:a::image', projectId: 'p', objectId: 'shot:a', outputType: 'image', engineId: 'gpt-image-2',
      prompt: '@图片一 司机', references: [{ id: 'r', type: 'image', label: '司机', path: '/private/original.jpg' }], params: { aspectRatio: '9:16' }, revision: 2, updatedAt: 1 };
    const original = JSON.stringify(draft);
    const controller = new AbortController();
    assert.equal(await optimizeWorkspacePrompt(draft, 'universal', controller.signal), reply);
    assert.equal(calls[0].options.signal, controller.signal);
    assert.equal(calls[0].options.continueOnTruncation, true);
    assert.match(calls[0].messages[1].content, /@图片一 司机/);
    assert.doesNotMatch(JSON.stringify(calls[0].messages), /private\/original/);
    await optimizeWorkspacePrompt({ ...draft, outputType: 'video', params: { duration: 8 } }, 'legacy', controller.signal);
    assert.equal(calls[1].options.signal, controller.signal);
    assert.match(calls[1].messages[0].content, /经典版/);
    assert.equal(JSON.stringify(draft), original);
    const style = { id: 'cinema', name: '电影风格', library: 'midjourney', visualDNA: 'soft rim lighting', cameraLanguage: 'eye level', promptTemplate: 'cinematic portrait' };
    reply = 'A driver in soft rim lighting --stylize 900';
    assert.equal(await restyleWorkspacePrompt({ ...draft, engineId: 'midjourney-v8.2' }, style, controller.signal), 'A driver in soft rim lighting');
    const styleCall = calls[calls.length - 1];
    assert.match(styleCall.messages[0].content, /事实锁/);
    assert.match(styleCall.messages[0].content, /soft rim lighting/);
    assert.equal(styleCall.options.signal, controller.signal);
    assert.equal(styleCall.options.directDeepseek, true);
    assert.equal(JSON.stringify(draft), original);
    await assert.rejects(restyleWorkspacePrompt(draft, style, controller.signal), /不匹配/);
    await assert.rejects(restyleWorkspacePrompt({ ...draft, prompt: '' }, style, controller.signal), /请先填写/);
    reply = '@图片九';
    await assert.rejects(optimizeWorkspacePrompt(draft, 'legacy', controller.signal), /没有对应参考/);
    reply = '';
    await assert.rejects(optimizeWorkspacePrompt(draft, 'legacy', controller.signal), /填写提示词/);
    controller.abort();
    const count = calls.length;
    await assert.rejects(optimizeWorkspacePrompt(draft, 'legacy', controller.signal), /已取消/);
    await assert.rejects(restyleWorkspacePrompt(draft, style, controller.signal), /已取消/);
    assert.equal(calls.length, count);
  } finally { delete (globalThis as any).__workspaceOptimize; }
});
