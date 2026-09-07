import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { productionFileName } from '../workspace/productionSafety.ts';

// Evaluate only these two adapters. All native/client imports are fake ports.
function fixture(file, failWrite = false) {
  const requests = [], writes = [], reads = [];
  let closed = 0, uuid = 0;
  const ports = {
    './client': { generateSpeech: async (request) => { requests.push(request); return { duration: 4 }; },
      fetchSpeechAudioBytes: async () => new Uint8Array([1, 2]) },
    '@tauri-apps/api/path': { homeDir: async () => '/fake-home' },
    '@tauri-apps/api/fs': { BaseDirectory: { Home: 'fake-home' }, createDir: async () => {},
      readBinaryFile: async (path) => { reads.push(path); return new Uint8Array([1, 2, 3, 4]); },
      writeBinaryFile: async (path) => { if (failWrite) throw new Error('fake disk failure'); writes.push(path); } },
    '../workspace/productionSafety': { productionFileName },
  };
  const source = readFileSync(new URL(file, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 } }).outputText;
  const exported = {};
  class FakeAudioContext {
    async decodeAudioData() { return { sampleRate: 4, numberOfChannels: 1, duration: 4, getChannelData: () => new Float32Array(16) }; }
    async close() { closed++; }
  }
  new Function('require', 'exports', 'crypto', 'AudioContext', 'console', compiled)(
    (name) => { assert.ok(name in ports, `unexpected runtime import: ${name}`); return ports[name]; }, exported,
    { randomUUID: () => `fake-operation-${++uuid}` }, FakeAudioContext, { log() {}, warn() {}, error() {} },
  );
  return { api: exported, requests, reads, writes, get closed() { return closed; } };
}
const role = { id: 'a', name: 'Actor', voicePath: '/fake/voice.wav' };
const shot = { shotNo: '1', audioPrompts: [{ characterId: 'a', prompt: 'exact approved text' }] };

test('existing generateShotAudio uses approved frozen bytes without reading the changed reference file', async () => {
  const f = fixture('./generate.ts');
  const output = await f.api.generateShotAudio(shot, [role], 'project-a', undefined, {
    operationId: 'approved-1', frozenReferences: { a: 'FROZEN-BASE64' }, beforeSubmit: () => {},
  });
  assert.equal(f.reads.length, 0);
  assert.deepEqual(f.requests, [{ text_prompt: 'exact approved text', references: [{ audio_data: 'FROZEN-BASE64' }] }]);
  assert.match(output[0].path, /projects\/project-a\/dubbing\/1-Actor-approved-1-a.mp3$/);
});
test('legacy undefined enables references while explicit empty voice ids disable them', async () => {
  const f = fixture('./generate.ts');
  await f.api.generateShotAudio(shot, [role], 'a');
  await f.api.generateShotAudio({ ...shot, voiceCharacterIds: [] }, [role], 'a');
  assert.equal(f.reads.length, 1); assert.equal(f.requests[0].references.length, 1);
  assert.equal(f.requests[1].references, undefined); assert.notEqual(f.writes[0], f.writes[1]);
});
test('pre-submit CAS failure prevents client submission and output writes', async () => {
  const f = fixture('./generate.ts');
  await assert.rejects(f.api.generateShotAudio(shot, [role], 'a', undefined, {
    frozenReferences: {}, beforeSubmit: () => { throw new Error('fake stale scope'); },
  }), /stale scope/);
  assert.equal(f.requests.length, 0); assert.equal(f.writes.length, 0);
});
test('trim keeps original files, produces versioned outputs and always closes its audio context', async () => {
  const f = fixture('./trim.ts');
  const original = [{ characterId: 'a', characterName: 'Actor', path: '/fake/original.mp3', duration: 4 }];
  const first = await f.api.trimAudiosToFit(original, 2, 'a');
  const second = await f.api.trimAudiosToFit(original, 2, 'a');
  assert.equal(first[0].path, original[0].path); assert.notEqual(first[0].trimmedPath, second[0].trimmedPath);
  assert.equal(f.closed, 2); assert.ok(f.writes.every((path) => path !== original[0].path));
  const failed = fixture('./trim.ts', true);
  await assert.rejects(failed.api.trimAudiosToFit(original, 2, 'a'), /fake disk failure/);
  assert.equal(failed.closed, 1);
});
