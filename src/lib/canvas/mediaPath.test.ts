import test from 'node:test';
import assert from 'node:assert/strict';
import { localMediaPath } from './mediaPath.ts';
test('local paths preserve literal filename punctuation and URL paths decode exactly once', () => {
  assert.equal(localMediaPath('/Users/me/100% #图.png'), '/Users/me/100% #图.png');
  for (const prefix of ['asset://localhost/', 'https://asset.localhost/', 'http://asset.localhost/', 'file:///']) {
    assert.equal(localMediaPath(prefix + '%2FUsers%2Fme%2F100%25%20%23%E5%9B%BE.png'), '/Users/me/100% #图.png');
  }
  assert.equal(localMediaPath('asset://localhost/%2FC%3A%5Cimages%5Ca.png'), 'C:\\images\\a.png');
  assert.equal(localMediaPath('file:///C:/images/a%20b.png'), 'C:/images/a b.png');
  assert.equal(localMediaPath('https://cdn.example.com/a.png'), null);
  assert.equal(localMediaPath('asset://localhost/%broken'), null);
});
