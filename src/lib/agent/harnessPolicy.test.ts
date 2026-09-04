import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeCustomRules } from './rulePolicy.ts';
import { buildToolEvidenceSummary } from './toolEvidence.ts';
import { buildSkillDescriptionText, compactSkillDescription, shouldIncludeInternalSkill, type PromptSkill } from './skillPromptPolicy.ts';
import { SCOPED_INTERNAL_SKILLS } from './skillPromptPolicy.ts';
import { buildSystemPrompt } from './systemPrompt.ts';
import { readFileSync } from 'node:fs';
import {
  buildTemporalTurnContext,
  getAgentTemporalContext,
  isTimeSensitiveQuery,
  needsLiveClockRefresh,
  prepareTemporalSearchQuery,
} from './temporalContext.ts';

test('tool evidence keeps file provenance but removes body', () => {
  const summary = buildToolEvidenceSummary('read_file', `[实时磁盘读取]\n路径: /tmp/A.swift\n大小: 123 bytes\n修改时间: 2026-07-19T10:00:00Z\n内容指纹: abcdef123456\n\n1\tsecret body\n[已读完: 共 1 行。]`);
  assert.match(summary, /\/tmp\/A\.swift/);
  assert.match(summary, /abcdef123456/);
  assert.doesNotMatch(summary, /secret body/);
});

test('tool evidence keeps bash paging credential', () => {
  const summary = buildToolEvidenceSummary('bash', `preview\n\n[命令输出凭证]\noutput_id: bash-123\nstdout: 8000/12000 字符\n有效期: 1 小时`);
  assert.match(summary, /bash-123/);
  assert.match(summary, /8000\/12000/);
});

test('tool evidence keeps a short verifiable conclusion', () => {
  const summary = buildToolEvidenceSummary('timeline_render_frame', JSON.stringify({
    path: '/tmp/frame.png',
    status: 'succeeded',
    last_render_error: null,
    noisyPayload: 'x'.repeat(4000),
  }));
  assert.match(summary, /关键结论/);
  assert.match(summary, /\/tmp\/frame\.png/);
  assert.match(summary, /last_render_error/);
  assert.doesNotMatch(summary, /x{100}/);
});

test('custom hidden-reasoning request becomes observable rationale rule', () => {
  const result = normalizeCustomRules('- 回答时请展示你的思考过程\n- 不要展示隐藏思考过程');
  assert.equal(result.notices.length, 1);
  assert.match(result.rules, /可复核的判断依据/);
  assert.match(result.rules, /不要展示隐藏思考过程/);
});

test('internal skill scoping is conservative', () => {
  const canvas: PromptSkill = { name: 'canvas-project-manager', description: '', triggers: [], promptTemplate: '', skillPath: '' };
  const anchor: PromptSkill = { name: 'scene-image-anchor', description: '', triggers: [], promptTemplate: '', skillPath: '' };
  const future: PromptSkill = { name: 'future-internal', description: '', triggers: [], promptTemplate: '', skillPath: '' };
  assert.equal(shouldIncludeInternalSkill(canvas, 'chat', '修复 Swift 文件'), false);
  assert.equal(shouldIncludeInternalSkill(canvas, 'canvas', ''), true);
  assert.equal(shouldIncludeInternalSkill(anchor, 'chat', ''), true);
  assert.equal(shouldIncludeInternalSkill(anchor, 'canvas', ''), true);
  assert.equal(shouldIncludeInternalSkill(anchor, 'workshop', ''), true);
  assert.equal(shouldIncludeInternalSkill(future, 'chat', ''), true);
  assert.equal(compactSkillDescription('a'.repeat(240)).length <= 181, true);
});

test('skill prompt keeps the complete catalog while scoping known internal rules', () => {
  const skills: PromptSkill[] = [
    { name: 'canvas-project-manager', displayName: '画布规则', description: 'internal', triggers: [], visibility: 'internal', promptTemplate: 'CANVAS_FULL_RULE', skillPath: '/skills/canvas' },
    { name: 'film-master', displayName: '电影分镜', description: 'storyboard '.repeat(40), triggers: ['分镜'], visibility: 'toolbar', promptTemplate: 'PUBLIC_BODY', skillPath: '/skills/film', invokable: true },
    { name: 'lark-cli', description: '飞书工具', triggers: ['飞书'], visibility: 'library', promptTemplate: 'LARK_BODY', skillPath: '/skills/lark' },
  ];
  const chat = buildSkillDescriptionText(skills, { activeView: 'chat', query: '修复 Swift 文件' });
  assert.match(chat, /电影分镜/);
  assert.match(chat, /lark-cli/);
  assert.doesNotMatch(chat, /CANVAS_FULL_RULE/);
  assert.doesNotMatch(chat, /PUBLIC_BODY|LARK_BODY/);
  const canvas = buildSkillDescriptionText(skills, { activeView: 'canvas', query: '调整节点' });
  assert.match(canvas, /CANVAS_FULL_RULE/);
});

test('internal skill scope matches each SKILL.md self-description', () => {
  const anchor = readFileSync(new URL('../../../skills/scene-image-anchor/SKILL.md', import.meta.url), 'utf8');
  const canvas = readFileSync(new URL('../../../skills/canvas-project-manager/SKILL.md', import.meta.url), 'utf8');
  assert.deepEqual(SCOPED_INTERNAL_SKILLS['scene-image-anchor'].views, ['chat', 'canvas', 'workshop']);
  assert.match(anchor, /工坊、画布和普通对话/);
  assert.deepEqual(SCOPED_INTERNAL_SKILLS['canvas-project-manager'].views, ['canvas']);
  assert.match(canvas, /画布/);
});

test('planning discipline is present for every provider, not only DeepSeek or Kimi', () => {
  for (const primaryProviderId of ['glm', 'anthropic', 'openai', 'deepseek', 'kimi']) {
    const prompt = buildSystemPrompt({
      cwd: '/tmp/project',
      os: 'macOS',
      shell: 'zsh',
      primaryProviderId,
    });
    assert.match(prompt, /复杂任务开始前先调用 todo_write/, primaryProviderId);
    assert.match(prompt, /跨越剧本、分镜、生图、生视频、剪辑、配音中两个及以上阶段/, primaryProviderId);
  }
});

test('runtime date is formatted in Asia Shanghai instead of inferred from paths', () => {
  const context = getAgentTemporalContext(new Date('2026-07-25T04:30:00.000Z'));
  assert.equal(context.isoDate, '2026-07-25');
  assert.equal(context.localTime, '12:30');
  assert.equal(context.year, 2026);
});

test('today query repairs an invented stale date', () => {
  const prepared = prepareTemporalSearchQuery(
    '武汉今天天气 2025年7月18日',
    new Date('2026-07-25T04:30:00.000Z'),
  );
  assert.equal(prepared.query, '武汉今天天气 2026年07月25日');
  assert.match(prepared.prompt, /当前日期是 2026年07月25日/);
  assert.equal(prepared.correctedFrom, '武汉今天天气 2025年7月18日');
});

test('historical comparison keeps the user supplied date', () => {
  const prepared = prepareTemporalSearchQuery(
    '比较今天和2025年7月18日的武汉天气',
    new Date('2026-07-25T04:30:00.000Z'),
  );
  assert.equal(prepared.query, '比较今天和2025年7月18日的武汉天气');
  assert.equal(prepared.correctedFrom, undefined);
});

test('only explicit clock questions require a same-day temporal refresh', () => {
  assert.equal(needsLiveClockRefresh('现在几点了？'), true);
  assert.equal(needsLiveClockRefresh('帮我查一下最新的模型'), false);
  assert.equal(needsLiveClockRefresh('继续处理刚才的任务'), false);
});

test('temporal context is injected only for time-sensitive turns', () => {
  assert.equal(isTimeSensitiveQuery('查一下今天武汉的天气'), true);
  assert.equal(isTimeSensitiveQuery('比较一下最新模型'), true);
  assert.equal(isTimeSensitiveQuery('继续修改画布节点'), false);
  assert.match(
    buildTemporalTurnContext(new Date('2026-07-25T04:30:00.000Z')),
    /2026年07月25日/,
  );
});

test('latest query without a date receives a verified date anchor', () => {
  const prepared = prepareTemporalSearchQuery(
    'Kimi K3 最新模型能力',
    new Date('2026-07-25T04:30:00.000Z'),
  );
  assert.equal(prepared.query, 'Kimi K3 最新模型能力（截至 2026-07-25）');
  assert.match(prepared.prompt, /不要使用训练数据截止时间推测当前日期/);
});
