import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildProjectIntakeAgentContext,
  classifyProjectAttachment,
  deriveProjectName,
  inferProjectIntakeMode,
  projectSpecPatchFromIntake,
  type ProjectIntakeRecord,
} from './projectIntake.ts';

test('project intake classifies files and selects a workflow', () => {
  const video = { path: '/tmp/reference.MP4', kind: classifyProjectAttachment('/tmp/reference.MP4') };
  assert.equal(video.kind, 'video');
  assert.equal(inferProjectIntakeMode('拆解并复刻这条参考片', [video]), 'reference-video');
  assert.equal(inferProjectIntakeMode('按这份剧本做短片', [{ path: '/tmp/a.docx', kind: 'document' }]), 'script');
  assert.equal(inferProjectIntakeMode('', [{ path: '/tmp/a.png', kind: 'image' }]), 'materials');
  assert.equal(inferProjectIntakeMode('一个雨夜重逢的故事', []), 'idea');
});

test('project intake derives a concise name and conservative spec', () => {
  assert.equal(deriveProjectName('帮我做一个雨夜重逢的爱情短片，克制真实'), '雨夜重逢的爱情短片');
  const intake: ProjectIntakeRecord = {
    brief: '做一条 30 秒 9:16 的产品片',
    mode: 'idea',
    automation: 'continuous',
    attachments: [],
    createdAt: 1,
  };
  assert.deepEqual(projectSpecPatchFromIntake(intake), {
    targetDurationSec: 30,
    aspectRatio: '9:16',
    generationConfirmation: 'paid-only-confirm',
  });
  const context = buildProjectIntakeAgentContext(intake) || '';
  assert.match(context, /仅在付费生成前确认/);
  assert.match(context, /统一项目对象/);
});
