import assert from 'node:assert/strict';
import test from 'node:test';
import { PaidToolIdempotencyGate } from './paidToolIdempotency.ts';
import { buildPipelineStagePrefix, detectPipelineStage } from './pipelineStages.ts';
import { buildTaskResumeContext } from './resumeContext.ts';

test('ordinary chat long-run smoke keeps order, artifacts, and paid-call idempotency', () => {
  const request = '写一个30秒短片剧本，再出分镜，并生成1张分镜图';
  const completedTools: string[] = [];

  const script = detectPipelineStage(request, { completedTools });
  assert.equal(script?.id, 'script');
  assert.match(buildPipelineStagePrefix(request, { completedTools }) ?? '', /todo_write/);
  completedTools.push(...(script?.entryTools ?? []));

  const storyboard = detectPipelineStage(request, { completedTools });
  assert.equal(storyboard?.id, 'storyboard');
  completedTools.push(...(storyboard?.entryTools ?? []));

  const image = detectPipelineStage(request, { completedTools });
  assert.equal(image?.id, 'image');

  const gate = new PaidToolIdempotencyGate();
  const params = {
    prompt: '雨夜车站，人物在站台相遇，电影分镜图',
    aspect_ratio: '16:9',
  };
  assert.equal(gate.reserve('ordinary-smoke', 'image_generate', params), null);
  gate.record('ordinary-smoke', 'image_generate', params, {
    success: true,
    output: '生成完成：/tmp/ordinary-smoke/storyboard-01.png',
  });
  assert.match(gate.reserve('ordinary-smoke', 'image_generate', params) ?? '', /阻止重复执行/);

  const resumed = buildTaskResumeContext({
    todos: [{ content: '确认分镜图构图', status: 'pending' }],
    agentMessages: [{ output: '生成完成：/tmp/ordinary-smoke/storyboard-01.png' }],
  });
  assert.match(resumed ?? '', /确认分镜图构图/);
  assert.match(resumed ?? '', /\/tmp\/ordinary-smoke\/storyboard-01\.png/);
});
