import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { ProjectWriteQueue } from './projectWriteQueue.ts';

test('project payload replacement preserves the original on failed rename and supports retry', async () => {
  const files = new Map([['.kunpeng/aigc-memory/projects/p/workshop.json', 'old']]);
  let fail = true;
  const modules = {
    './projectWriteQueue': { ProjectWriteQueue },
    '@tauri-apps/api/fs': { BaseDirectory: { Home: 'home' }, createDir: async () => {},
      writeTextFile: async ({ path, contents }) => files.set(path, contents),
      renameFile: async (from, to) => { if (fail) throw Error('disk'); files.set(to, files.get(from)); files.delete(from); },
    },
  };
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('./projectStore.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require: id => { assert.ok(id in modules, id); return modules[id]; }, console });
  await assert.rejects(exports.writeProjectFile('p', 'workshop.json', 'new', { requireSuccess: true }));
  assert.equal(files.get('.kunpeng/aigc-memory/projects/p/workshop.json'), 'old');
  fail = false;
  await exports.writeProjectFile('p', 'workshop.json', 'new', { requireSuccess: true });
  assert.equal(files.get('.kunpeng/aigc-memory/projects/p/workshop.json'), 'new');
});
