import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';

function fixture() {
  const source = readFileSync(new URL('./deepseekWebApi.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const exports = {};
  runInNewContext(js, {
    exports,
    require: id => id === '@tauri-apps/api/http'
      ? { Body: { json: value => value }, fetch: async () => { throw new Error('not used'); }, ResponseType: { Text: 2 } }
      : { getWebFetchTimeoutMs: () => 30_000 },
  });
  return exports;
}

test('DeepSeek Search API response keeps citeable source metadata', () => {
  const { parseDeepSeekSearchResponse } = fixture();
  assert.deepEqual(
    JSON.parse(JSON.stringify(parseDeepSeekSearchResponse({ results: [
      { url: 'https://example.com/a', title: 'A', snippet: 'summary', date: '2026-10-17' },
      { url: 'https://example.com/b', title: '', snippet: '', date: null },
    ] }))),
    [
      { url: 'https://example.com/a', title: 'A', snippet: 'summary', publishedAt: '2026-10-17' },
      { url: 'https://example.com/b' },
    ],
  );
});

test('DeepSeek Search API rejects malformed untrusted payloads', () => {
  const { parseDeepSeekSearchResponse } = fixture();
  assert.throws(() => parseDeepSeekSearchResponse({ results: [{ url: 'https://example.com' }] }), /结构无效/);
  assert.throws(() => parseDeepSeekSearchResponse({ results: 'wrong' }), /结构无效/);
});
