import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { localMediaPath } from './mediaPath.ts';
const code = ts.transpileModule(readFileSync(new URL('./mediaImport.ts', import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function runtime(retain) {
  let project = 'original', id = 0, snapshots = 0;
  const nodes = [], exports = {};
  const modules = {
    './importedMedia': { retainImportedMedia: retain }, './mediaPath': { localMediaPath },
    '@/stores/projectStore': { useProjectStore: { getState: () => ({ activeProjectId: project }) } },
    '@tauri-apps/api/tauri': { convertFileSrc: path => `asset:${path}` },
    nanoid: { nanoid: () => String(++id) },
    '@/stores/canvasStore': { useCanvasStore: { getState: () => ({ addNode: n => nodes.push(n), setSelectedNodeId() {} }) } },
    '@/lib/canvas/history': { captureSnapshot: () => snapshots++ },
    '@/lib/canvas/layout': { defaultNodeStyle: () => ({ width: 200, height: 160 }) },
  };
  runInNewContext(code, { exports, require: name => { assert.ok(name in modules, name); return modules[name]; } });
  return { exports, nodes, snapshots: () => snapshots, switchProject: () => { project = 'other'; } };
}
test('imports publish retained paths and preserve original audio names with punctuation', async () => {
  const r = runtime(async path => `/retained/id-${path.split('/').pop()}`);
  await r.exports.createMediaNodesFromPaths(['/Downloads/voice#1.wav', '/Downloads/image.png'], { x: 0, y: 0 });
  assert.equal(r.nodes.length, 2);assert.equal(r.snapshots(), 1);
  assert.equal(r.nodes[0].data.fileName, 'voice#1.wav');
  assert.equal(r.nodes[0].data.localPath, '/retained/id-voice#1.wav');
  assert.equal(r.nodes[1].data.referenceImage, 'asset:/retained/id-image.png');
});
test('failed retention does not publish a partial canvas', async () => {
  const r = runtime(async path => { if (path.endsWith('bad.png')) throw Error('disk full');return '/retained/ok.png'; });
  await assert.rejects(r.exports.createMediaNodesFromPaths(['/ok.png', '/bad.png'], { x: 0, y: 0 }), /disk full/);
  assert.equal(r.nodes.length, 0);assert.equal(r.snapshots(), 0);
});
test('switching projects during retention never publishes into the new canvas', async () => {
  let release;const pending = new Promise(resolve => { release = resolve; });
  const r = runtime(() => pending);
  const importing = r.exports.createMediaNodesFromPaths(['/image.png'], { x: 0, y: 0 });
  r.switchProject();release('/retained/image.png');
  await assert.rejects(importing, /项目已切换/);assert.equal(r.nodes.length, 0);
});
