import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function fixture() {
  const source = await readFile(new URL('./visionTool.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source.replace(/^import .*;$/gm, ''), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  return import(`data:text/javascript;base64,${Buffer.from(`let calls = 0; export const apiCalls = () => calls; const loadImageInput = async () => 'data:image/png;base64,aGVsbG8='; const visionWithFallback = async () => { calls++; return {text:'fallback',model:'test'}; };\n${js}`).toString('base64')}#${Math.random()}`);
}
test('autonomous native vision returns image evidence without a separate model request', async () => {
  const { visionTool, apiCalls } = await fixture();
  const result = await visionTool.execute({image:'/tmp/test.png',prompt:'read this'}, undefined, {nativeVision:true});
  assert.equal(result.success, true);
  assert.equal(apiCalls(), 0);
  assert.equal(result.media[0].source.data, 'aGVsbG8=');
  assert.match(result.output, /read this/);
});
test('text-only callers retain explicit vision service', async () => {
  const { visionTool, apiCalls } = await fixture();
  const result = await visionTool.execute({image:'/tmp/test.png'}, undefined, {nativeVision:false});
  assert.equal(result.success, true);
  assert.equal(apiCalls(), 1);
});
