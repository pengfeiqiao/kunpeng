// Synthetic, credential-free CPU benchmark. No app/user files or paid APIs are touched.
import { performance } from 'node:perf_hooks';
import { projectAssistantHistory, assistantConversationKey, assistantHistoryTarget } from '../src/lib/workspace/assistantHistory.ts';
import { wrapWorkspaceContext } from '../src/lib/agent/workspaceMessage.ts';
import { EventFifo, StreamWorkBudget } from '../src/lib/performance/eventQueue.ts';
const serialize = (target, prompt) => wrapWorkspaceContext('workshop', target.context) + prompt;
function legacy(messages, items) {
  let target;
  const index = new Map();
  for (const message of messages) {
    if (message.role === 'user') target = items.find(item => item.messageIds?.includes(message.id)
      || message.content === serialize(item.target, item.prompt)
      || message.content === item.target.context + item.prompt
      || (message.content.endsWith(item.prompt) && message.content.includes(item.target.context.trim())))?.target
      ?? assistantHistoryTarget(message.content, 's');
    const owner = items.find(item => item.messageIds?.includes(message.id));
    const thread = owner?.target ?? target;
    index.set(message.id, thread ? assistantConversationKey(thread) : undefined);
  }
  return index;
}
function timed(run) {
  const values = [];
  for (let i = 0; i < 3; i++) { const start = performance.now(); run(); values.push(performance.now() - start); }
  return +values.sort((a, b) => a - b)[1].toFixed(2);
}
const history = [100, 500, 1000].map(turns => {
  const items = Array.from({ length: turns }, (_, i) => ({ id: `q${i}`, target: { projectId: 'p', sessionId: 's',
    objectId: `shot:${i % 10}`, outputType: 'image', context: `[媒体工作台上下文：{"project_id":"p","object_id":"shot:${i % 10}"}]\n${'创作约束。'.repeat(80)}\n\n`, label: '镜头' },
    prompt: `修改 ${i}`, messageIds: [`u${i}`, `a${i}`], status: 'done', files: [], enqueuedAt: i, threadKey: '' }));
  const messages = items.flatMap((item, i) => [{ id: `u${i}`, role: 'user', content: serialize(item.target, item.prompt) }, { id: `a${i}`, role: 'assistant', content: '完成修改' }]);
  return { turns, legacyMs: timed(() => legacy(messages, items)), indexedMs: timed(() => projectAssistantHistory(messages, items, 's', serialize)) };
});
const count = 100_000;
const queue = {
  events: count,
  arrayShiftMs: timed(() => { const q = Array.from({ length: count }, (_, i) => i); while (q.length) q.shift(); }),
  fifoMs: timed(() => { const q = new EventFifo(); for (let i = 0; i < count; i++) q.push(i); while (q.length) q.shift(); }),
};
let ticks = 0, maxSliceMs = 0, lastYield = performance.now();
const budget = new StreamWorkBudget(() => performance.now(), async () => {
  maxSliceMs = Math.max(maxSliceMs, performance.now() - lastYield);
  await new Promise(resolve => setTimeout(resolve, 0)); ticks++; lastYield = performance.now();
});
for (let i = 0; i < 100_000; i++) {
  JSON.parse('{"text":"合成流式事件","tool":{"args":"用于主线程负载测试"}}');
  const pause = budget.checkpoint(); if (pause) await pause;
}
console.log(JSON.stringify({ history, queue, cooperativeDrain: { events: 100_000, taskYields: ticks, maxSliceMs: +maxSliceMs.toFixed(2) } }, null, 2));
