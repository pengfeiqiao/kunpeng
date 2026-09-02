import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '../../..');
const stylesSource = readFileSync(resolve(here, 'styles.ts'), 'utf8');

const directorStyleIds = [...stylesSource.matchAll(/\bstyle\(\s*'([^']+)'/g)]
  .map((match) => match[1]);

test('every director style has its own preview asset', () => {
  assert.equal(directorStyleIds.length, 24);
  assert.equal(new Set(directorStyleIds).size, directorStyleIds.length);

  for (const id of directorStyleIds) {
    const assetPath = resolve(repoRoot, `public/midjourney-styles/director/${id}.jpg`);
    assert.doesNotThrow(
      () => readFileSync(assetPath),
      `Missing dedicated Midjourney preview for ${id}`,
    );
  }
});

test('director style previews do not reuse identical image content', () => {
  const hashes = directorStyleIds.map((id) => {
    const bytes = readFileSync(resolve(repoRoot, `public/midjourney-styles/director/${id}.jpg`));
    return createHash('sha256').update(bytes).digest('hex');
  });

  assert.equal(new Set(hashes).size, hashes.length);
});

// styles.ts imports Tauri APIs and cannot be loaded in plain node tests;
// assert the lookup contract at source level instead.
test('getMidjourneyStyle tolerates Chinese names, not only ids', () => {
  assert.match(stylesSource, /item\.id === key \|\| item\.name === key/);
});
