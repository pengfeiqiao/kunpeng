import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTimelinePresentationItems,
  createToolPresentation,
  normalizeRunPresentationEvent,
  normalizeRunProgress,
} from './runStepPresentation.ts';

test('ordinary long-form narration is excluded from the run timeline', () => {
  const narration = '代码层的处理已经完成一部分，我正在核对本地运行状态和实际返回结果。这里主要确认改动是否真的作用在用户当前使用的链路上，而不只是静态代码看起来正确。';
  assert.equal(normalizeRunProgress(narration), null);
});

test('bash keeps the full command and file writes show only the filename', () => {
  const command = 'source ~/.zshrc && npm run test:harness && node --test src/lib/agent/runStepPresentation.test.ts';
  assert.equal(createToolPresentation('bash', { command }).detail, command);
  assert.equal(createToolPresentation('write_file', { path: '/Users/qiao/project/src/components/Panel.tsx' }).detail, 'Panel.tsx');
});

test('completed groups are folded while active and failed groups are expanded', () => {
  const base = { id: 'step', source: 'tool', startedAt: 10, endedAt: 20 };
  const items = buildTimelinePresentationItems({
    steps: [
      { ...base, id: 'done', status: 'done' },
      { ...base, id: 'active', status: 'active' },
      { ...base, id: 'failed', status: 'failed' },
    ],
  });
  const expansion = Object.fromEntries(items.map((item) => [item.id, item.defaultExpanded]));
  assert.deepEqual(expansion, { done: false, active: true, failed: true });
});

test('Harness and built-in events normalize to the same presentation structure', () => {
  const params = { path: '/Users/qiao/project/README.md' };
  const harness = normalizeRunPresentationEvent({ engine: 'harness', type: 'tool-start', name: 'read_file', params });
  const builtin = normalizeRunPresentationEvent({ engine: 'builtin', type: 'tool-start', name: 'read_file', params });
  assert.deepEqual(harness, builtin);
});

test('context and user guidance remain as compact system events', () => {
  assert.deepEqual(normalizeRunProgress('正在整理较早的历史消息，避免重复内容拖慢后续操作。'), {
    kind: 'context',
    status: 'running',
    text: '正在整理上下文',
  });
  assert.deepEqual(normalizeRunProgress('收到你的补充：“不要改动现有数据”。'), {
    kind: 'guidance',
    status: 'info',
    text: '已收到补充：不要改动现有数据',
  });
});
