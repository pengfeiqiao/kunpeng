import test from 'node:test';
import assert from 'node:assert/strict';
import { buildApimartSunoPayload } from '../apimart/contracts.ts';
import { parseSunoRewrite } from './promptTemplate.ts';

test('suno custom payload keeps custom-only fields and always sends version', () => {
  const payload = buildApimartSunoPayload({
    prompt: '[Verse]\n雨夜霓虹',
    custom: true,
    version: 'v5',
    title: '深夜驾驶',
    style: 'synthwave, female vocal',
    negativeTags: 'metal',
    vocalGender: 'Female',
  });
  assert.equal(payload.model, 'suno');
  assert.equal(payload.custom, true);
  assert.equal(payload.version, 'v5');
  assert.equal(payload.title, '深夜驾驶');
  assert.equal(payload.style, 'synthwave, female vocal');
  assert.equal(payload.negative_tags, 'metal');
  assert.equal(payload.vocal_gender, 'Female');
});

test('suno inspiration mode drops custom-only fields; unknown version falls back to v5', () => {
  const payload = buildApimartSunoPayload({
    prompt: '深夜城市 lo-fi 钢琴配雨声',
    custom: false,
    version: 'v9',
    title: '被忽略',
    style: '被忽略',
  });
  assert.equal(payload.custom, false);
  assert.equal(payload.version, 'v5');
  assert.equal(payload.title, undefined);
  assert.equal(payload.style, undefined);
});

test('suno payload requires a prompt unless instrumental custom', () => {
  assert.throws(() => buildApimartSunoPayload({ prompt: ' ', custom: true, instrumental: false }));
  assert.doesNotThrow(() => buildApimartSunoPayload({ prompt: '', custom: true, instrumental: true }));
});

test('parseSunoRewrite splits style and lyrics', () => {
  const draft = parseSunoRewrite('风格：cinematic pop, 史诗感, 弦乐, 女声, 92 BPM\n歌词：[Verse]\n夜色落下\n[Chorus]\n我们一起');
  assert.deepEqual(draft, {
    style: 'cinematic pop, 史诗感, 弦乐, 女声, 92 BPM',
    lyrics: '[Verse]\n夜色落下\n[Chorus]\n我们一起',
  });
  assert.equal(parseSunoRewrite('没有结构的回答'), null);
});
