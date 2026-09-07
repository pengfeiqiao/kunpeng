import test from 'node:test';
import assert from 'node:assert/strict';
import { isSkillPreferenceActive } from './skillPreferences.ts';

test('skill preference defaults to available and respects disable', () => {
  assert.equal(isSkillPreferenceActive(undefined, 'p1'), true);
  assert.equal(isSkillPreferenceActive({ enabled: false, scope: 'global' }, 'p1'), false);
});

test('project scoped skill is only active in its owning project', () => {
  const pref = { enabled: true, scope: 'project' as const, projectId: 'p1' };
  assert.equal(isSkillPreferenceActive(pref, 'p1'), true);
  assert.equal(isSkillPreferenceActive(pref, 'p2'), false);
  assert.equal(isSkillPreferenceActive(pref), false);
});
