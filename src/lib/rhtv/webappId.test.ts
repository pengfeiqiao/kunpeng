import test from 'node:test';
import assert from 'node:assert/strict';
import { extractRhtvWebappId } from './webappId.ts';

test('extractRhtvWebappId accepts a plain 19-digit id', () => {
  assert.equal(extractRhtvWebappId('2007765513115537410'), '2007765513115537410');
  assert.equal(extractRhtvWebappId('  2007765513115537410  '), '2007765513115537410');
});

test('extractRhtvWebappId parses app links from both sites', () => {
  assert.equal(
    extractRhtvWebappId('https://www.runninghub.cn/app/2007765513115537410'),
    '2007765513115537410',
  );
  assert.equal(
    extractRhtvWebappId('https://www.runninghub.ai/app/detail/2007765513115537410?source=share'),
    '2007765513115537410',
  );
});

test('extractRhtvWebappId rejects garbage', () => {
  assert.equal(extractRhtvWebappId(''), '');
  assert.equal(extractRhtvWebappId('abc'), '');
  assert.equal(extractRhtvWebappId('12345'), '');
});
