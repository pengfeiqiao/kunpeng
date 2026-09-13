import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function fixture() {
  let source = await readFile(new URL('./evolution.ts', import.meta.url), 'utf8');
  source = source.replace(/import[\s\S]*?from\s*'([^']+)';/g, (statement, path) => {
    if (path === './evolutionCursor' || path === './evolutionPolicy') return statement.replace(path, new URL(path + '.ts', import.meta.url).href);
    return '';
  });
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
  const mocks = `
    const files = new Map(); export const state = () => JSON.parse(files.get('.kunpeng/evolution/state.json') || '{}');
    let fail = false; export const setFail = (value) => { fail = value; };
    const BaseDirectory = { Home: 1 };
    const createDir = async () => {}; const readDir = async () => [];
    const readTextFile = async (path) => { if (!files.has(path)) throw new Error('missing'); return files.get(path); };
    const writeTextFile = async (path, value) => { files.set(path, value); };
    const copyFile = async () => {}; const removeDir = async () => {};
    const quickChat = async () => { if (fail) throw new Error('model unavailable'); return '{"memories":[],"skills":[]}'; };
    const invalidateMemoryIndex = () => {}; const loadMemoryIndex = async () => [];
    const agentLog = { debug() {}, info() {}, warn() {} };
  `;
  return import(`data:text/javascript;base64,${Buffer.from(mocks + js).toString('base64')}#${Math.random()}`);
}
async function records(module, count) {
 const start = (await module.getEvolutionStatus()).total;
 for (let i=0;i<count;i++) await module.recordTrajectory({ts:1000+start+i,req:'test task',tools:{},fail:{},secs:1,status:'done'});
}
test('automatic reflection exposes pending progress and persists completion', async () => {
 const module=await fixture();
 await records(module,11); await module.maybeEvolve();
 assert.equal((await module.getEvolutionStatus()).pending,11);
 assert.equal(module.state().reflections,0);
 await records(module,1); await module.maybeEvolve();
 assert.equal(module.state().reflections,1);
 assert.equal((await module.getEvolutionStatus()).pending,0);
 assert.match(module.state().lastSummary,/12/);
});
test('model failure remains visible and does not consume pending learning records', async () => {
 const module=await fixture(); await records(module,12); module.setFail(true);
 await module.maybeEvolve();
 assert.match(module.state().lastError,/model unavailable/);
 assert.equal((await module.getEvolutionStatus()).pending,12);
 module.setFail(false); await module.runEvolutionReflect(true);
 assert.equal(module.state().lastError,'');
 assert.equal(module.state().reflections,1);
});

test('a reflection batch preserves unprocessed backlog', async () => {
 const module=await fixture(); await records(module,45); await module.maybeEvolve();
 assert.equal((await module.getEvolutionStatus()).pending,5);
 assert.match(module.state().lastSummary,/40/);
});
