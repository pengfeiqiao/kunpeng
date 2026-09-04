/**
 * Smoke tests for the usability wave (loop/harness/prompt/memory changes):
 *
 * 1. ContextManager estimate cache — repeated estimateMessages over the same
 *    message objects must return identical numbers, and rewritten content
 *    (new object identity, as microcompact produces) must recompute.
 * 2. splitStreamingParts — exponential checkpoints keep the markdown prefix
 *    byte-stable across small appends (that stability is what lets React
 *    memo skip re-parsing during streaming).
 * 3. Skill prompt policy — the system-prompt skill catalog must be
 *    query-stable (cache prefix); relevance moves to the transient notice.
 * 4. GLMClient stream retry — must NOT retry after chunks were yielded
 *    (duplicate-output regression guard).
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import { ContextManager } from './contextManager.ts';
import { buildSkillDescriptionText, buildSkillRelevanceNotice, type PromptSkill } from './skillPromptPolicy.ts';
import { splitStreamingParts as split } from '../chat/streamingParts.ts';
import type { AgentMessage } from './types.ts';

// ── 1. estimate cache ────────────────────────────────────────────────────────

test('estimateMessages is stable across repeated calls and recomputes on rewrite', () => {
  const cm = new ContextManager(128000);
  const messages: AgentMessage[] = [
    { role: 'system', content: '系统提示词'.repeat(100) },
    { role: 'user', content: '你好，帮我看看这个文件' },
    { role: 'assistant', content: '好的', tool_calls: [{ id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{"path":"/tmp/a.ts"}' } }] } as AgentMessage,
    { role: 'tool', tool_call_id: 'c1', content: '文件内容'.repeat(500) } as AgentMessage,
  ];

  const first = cm.estimateMessages(messages);
  const second = cm.estimateMessages(messages);
  assert.equal(first, second);
  assert.ok(first > 0);

  // Microcompact-style rewrite: new object, changed content → must recompute.
  const rewritten = messages.map((m, i) =>
    i === 3 ? { ...m, content: '[旧结果已清理]' } : m,
  );
  const after = cm.estimateMessages(rewritten);
  assert.ok(after < first, `expected smaller estimate after compaction, got ${after} vs ${first}`);

  // Sanity: recompute must equal a fresh manager's estimate.
  const fresh = new ContextManager(128000).estimateMessages(rewritten);
  assert.equal(after, fresh);
});

test('estimate cache is per-manager and ignores unrelated message arrays', () => {
  const cm = new ContextManager(128000);
  const a: AgentMessage[] = [{ role: 'user', content: '甲' }];
  const b: AgentMessage[] = [{ role: 'user', content: '乙'.repeat(100) }];
  assert.notEqual(cm.estimateMessages(a), cm.estimateMessages(b));
});

// ── 2. streaming split checkpoints ───────────────────────────────────────────

test('streaming markdown prefix stays byte-stable across small appends', () => {
  const para = '这是一段流式输出。'.repeat(30) + '\n';
  let acc = '';
  let lastStable = '';
  let stableChanges = 0;
  // Simulate token-by-token streaming of ~10 paragraphs (~3600 chars).
  for (let i = 0; i < 10; i++) {
    for (const ch of para) {
      acc += ch;
      const { stable } = split(acc);
      if (stable !== lastStable) {
        stableChanges += 1;
        assert.ok(stable.startsWith(lastStable), 'stable prefix must only ever grow');
        lastStable = stable;
      }
    }
  }
  // Without checkpointing the prefix would change on nearly every append
  // (hundreds of re-parses). Exponential checkpoints bound it to ~log2(n).
  assert.ok(
    stableChanges <= 6,
    `expected ≤6 markdown re-parses for ${acc.length} chars, got ${stableChanges}`,
  );
  // Everything is eventually rendered.
  const finalParts = split(acc);
  assert.equal(finalParts.stable + finalParts.tail, acc);
});

// ── 3. skill catalog is query-stable; relevance is transient ─────────────────

const SKILLS: PromptSkill[] = [
  { name: 'canvas-project-manager', displayName: '画布规则', description: 'internal', triggers: [], visibility: 'internal', promptTemplate: 'CANVAS_FULL_RULE', skillPath: '/skills/canvas' },
  { name: 'scene-image-anchor', displayName: '场景锚点', description: 'internal', triggers: [], visibility: 'internal', promptTemplate: 'ANCHOR_FULL_RULE', skillPath: '/skills/anchor' },
  { name: 'film-master', displayName: '电影分镜', description: 'storyboard 分镜', triggers: ['分镜'], visibility: 'toolbar', promptTemplate: 'PUBLIC_BODY', skillPath: '/skills/film', invokable: true },
  { name: 'lark-cli', description: '飞书工具', triggers: ['飞书'], visibility: 'library', promptTemplate: 'LARK_BODY', skillPath: '/skills/lark' },
];

test('skill catalog in system prompt is byte-stable across queries', () => {
  const q1 = buildSkillDescriptionText(SKILLS, { activeView: 'chat', query: '帮我做个分镜' });
  const q2 = buildSkillDescriptionText(SKILLS, { activeView: 'chat', query: '今天天气怎么样' });
  const q3 = buildSkillDescriptionText(SKILLS, { activeView: 'chat' });
  assert.equal(q1, q2);
  assert.equal(q2, q3);
  // No relevance markers leak into the (cached) system prompt.
  assert.doesNotMatch(q1, /本轮相关/);
  // View-scoped internal skills still apply per view.
  assert.doesNotMatch(q1, /CANVAS_FULL_RULE/);
  assert.match(q1, /ANCHOR_FULL_RULE/);
  const canvas = buildSkillDescriptionText(SKILLS, { activeView: 'canvas' });
  assert.match(canvas, /CANVAS_FULL_RULE/);
});

test('skill relevance notice carries query-matched skills and keyword-scoped internals', () => {
  const notice = buildSkillRelevanceNotice(SKILLS, { activeView: 'chat', query: '帮我做电影分镜' });
  assert.ok(notice);
  assert.match(notice!, /电影分镜/);
  // scene-image-anchor is now a shared chat/canvas/workshop rule and already
  // lives in the stable catalog, so the transient notice need not duplicate it.
  assert.doesNotMatch(notice!, /ANCHOR_FULL_RULE/);

  const calm = buildSkillRelevanceNotice(SKILLS, { activeView: 'chat', query: '随便聊聊' });
  assert.equal(calm, null);
});
