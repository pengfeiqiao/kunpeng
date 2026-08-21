import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveStepNoteTargetRunId, type RunLike } from './runTargeting.ts';

function runWithTool(id: string, status: string, toolName: string, toolStatus: string, startedAt: number): RunLike {
  return {
    id,
    status,
    steps: [{ toolCalls: [{ name: toolName, status: toolStatus, startedAt }] }],
  };
}

test('step note targets the run actually executing the tool, not the global currentRunId', () => {
  // A background run (lark/wechat) started after the UI run, so it owns the
  // global currentRunId slot. The note from the UI run's timeline tool must
  // still land on the UI run.
  const uiRun = runWithTool('run-ui', 'running', 'timeline_inspect_video_segment', 'running', 100);
  const bgRun = runWithTool('run-bg', 'running', 'web_search', 'running', 200);
  const target = resolveStepNoteTargetRunId(
    { 'run-ui': uiRun, 'run-bg': bgRun },
    'run-bg',
    'timeline_inspect_video_segment',
  );
  assert.equal(target, 'run-ui');
});

test('step note falls back to currentRunId when no toolName is given', () => {
  const target = resolveStepNoteTargetRunId({}, 'run-current');
  assert.equal(target, 'run-current');
});

test('step note falls back to currentRunId when the named tool is not running anywhere', () => {
  const done = runWithTool('run-old', 'running', 'timeline_inspect_video_segment', 'done', 100);
  const target = resolveStepNoteTargetRunId({ 'run-old': done }, 'run-current', 'timeline_inspect_video_segment');
  assert.equal(target, 'run-current');
});

test('step note ignores finished runs even if their tool call still shows running', () => {
  const finished = runWithTool('run-done', 'done', 'timeline_analyze_reference_video', 'running', 100);
  const active = runWithTool('run-live', 'running', 'timeline_analyze_reference_video', 'running', 50);
  const target = resolveStepNoteTargetRunId(
    { 'run-done': finished, 'run-live': active },
    'run-done',
    'timeline_analyze_reference_video',
  );
  assert.equal(target, 'run-live');
});

test('same tool running in two runs resolves to the most recently started call', () => {
  const older = runWithTool('run-older', 'running', 'timeline_inspect_video_segment', 'running', 100);
  const newer = runWithTool('run-newer', 'running', 'timeline_inspect_video_segment', 'running', 300);
  const target = resolveStepNoteTargetRunId(
    { 'run-older': older, 'run-newer': newer },
    'run-older',
    'timeline_inspect_video_segment',
  );
  assert.equal(target, 'run-newer');
});
