import { wrapWorkspaceContext } from '../agent/workspaceMessage.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { CRAFT_SOURCES, CRAFT_LESSONS, selectReferenceLessons, buildReferenceCraftContext, REFERENCE_CRAFT_HARNESS, buildReferenceCraftTurnContext } from './referenceCraft.ts';
import { buildCopywritingTaskHarness } from './antiAiStyle.ts';
import { getStaticPrompt } from '../agent/systemPrompt.ts';

test('each method has independent text and award provenance and a precise reading location', () => {
  assert.equal(new Set(CRAFT_SOURCES.map(s => s.id)).size, CRAFT_SOURCES.length);
  assert.equal(new Set(CRAFT_LESSONS.map(l => l.id)).size, CRAFT_LESSONS.length);
  for (const l of CRAFT_LESSONS) {
    const s = CRAFT_SOURCES.find(s => s.id === l.sourceId);
    assert.ok(s, l.id);
    assert.equal(new URL(s.textUrl).protocol, 'https:');
    assert.equal(new URL(s.awardUrl).protocol, 'https:');
    assert.notEqual(new URL(s.textUrl).hostname, new URL(s.awardUrl).hostname);
    assert.ok(s.edition && s.authors && l.location && l.observation && l.avoid);
    if (l.medium === 'ad') assert.ok(['ad-transcript', 'brand-copy-excerpt'].includes(s.textKind));
  }
});
test('advertising scripts retrieve advertising evidence rather than treating every script as a film', () => {
  for (const query of ['写汽车广告剧本', 'TVC screenplay', '品牌口播', '广告对白']) {
    const lessons = selectReferenceLessons(query);
    assert.ok(lessons.length > 0 && lessons.length <= 3);
    assert.ok(lessons.every(l => l.medium === 'ad'));
  }
  assert.equal(selectReferenceLessons('写现实生活电影开场')[0].id, 'material-pressure');
  assert.equal(selectReferenceLessons('优化武侠对白和潜台词')[0].id, 'dialogue-probe');
  assert.equal(selectReferenceLessons('电影节奏需要留白静场')[0].id, 'quiet-contrast');
});
test('unrelated requests and pure model prompts receive no case packet', () => {
  for (const q of ['修复剧本编辑器 bug', '修复广告接口代码 bug', '汽车广告生图提示词', '翻译文档', '天气如何', '写一首诗', '品牌视频生成 prompt']) {
    assert.equal(buildReferenceCraftContext(q), '', q);
  }
  assert.ok(buildReferenceCraftContext('先改广告剧本再写提示词'));
});
test('case packet preserves source type and complete JSON within bounded context', () => {
  for (const q of ['电影剧本', '广告剧本', '对白'.repeat(10000)]) {
    const packet = buildReferenceCraftContext(q);
    assert.ok(packet.length < 2400);
    const records = JSON.parse(packet.slice(packet.indexOf('\n[') + 1));
    assert.ok(records.length <= 3);
    assert.ok(records.every((r: {textKind: string; textUrl: string}) => r.textKind && r.textUrl));
  }
  assert.ok(REFERENCE_CRAFT_HARNESS.length < 1500);
});
test('shared agent and writing entrypoints both receive craft without network, provider or persistence coupling', () => {
  assert.ok(getStaticPrompt().includes(REFERENCE_CRAFT_HARNESS));
  const ad = buildCopywritingTaskHarness('写产品广告剧本');
  assert.match(ad, /product|可见结果/);
  assert.match(ad, /ad-transcript/);
  assert.doesNotMatch(ad, /前 3 秒：必须|完播结构：起钩子|自媒体口播优先采用/);
  assert.match(buildCopywritingTaskHarness('写一场人物对白'), /本次可参考的真实文本证据/);
});

test('mainland evidence stays distinct from foreign Chinese-language works and interviews stay labelled', () => {
  const mainland = CRAFT_SOURCES.filter(source => source.collection === 'mainland-film');
  assert.equal(mainland.length, 9);
  for (const title of ['爱情神话', '我不是药神', '钢的琴', '气球', '心迷宫', '白日焰火', '地久天长', '不成问题的问题', '流浪地球']) {
    const source = mainland.find(s => s.title === title)!;
    assert.ok(source, title);
    const packet = buildReferenceCraftContext(`借鉴《${title}》的剧本写作方法`);
    assert.match(packet, new RegExp(source.id));
    const records = JSON.parse(packet.slice(packet.indexOf('\n[') + 1));
    assert.ok(records.every((record: {sourceId:string}) => record.sourceId === source.id));
  }
  assert.equal(mainland.find(s => s.title === '我不是药神')?.textKind, 'author-outline');
  assert.equal(mainland.find(s => s.title === '爱情神话')?.textKind, 'author-craft-essay');
  assert.ok(mainland.find(s => s.title === '白日焰火')?.verificationUrl);
  assert.ok(!mainland.some(s => ['别告诉她', '卧虎藏龙'].includes(s.title)));
});

test('mainland tasks prefer diverse relevant mainland cases and short film titles do not hijack pronouns', () => {
  for (const query of ['写国产电影剧本', '改中文电影对白与方言', '大陆乡土悬疑剧本', '本土科幻电影世界观规则']) {
    const lessons = selectReferenceLessons(query);
    assert.ok(lessons.length > 0 && lessons.length <= 3);
    assert.equal(new Set(lessons.map(l => l.sourceId)).size, lessons.length);
    assert.ok(lessons.every(l => CRAFT_SOURCES.find(s => s.id === l.sourceId)?.collection === 'mainland-film'));
  }
  assert.equal(selectReferenceLessons('本土科幻电影世界观规则')[0].id, 'world-rules-bound-action');
  assert.equal(selectReferenceLessons('改大陆剧本人物动机与尊严，转变和人物弧光')[0].id, 'desire-relay');
  assert.ok(!selectReferenceLessons('修改她的乡村电影剧本对白').every(l => l.sourceId === 'her-2013'));
  assert.ok(selectReferenceLessons('借鉴《她》的剧本').every(l => l.sourceId === 'her-2013'));
});

test('every source is reachable and every evidence packet keeps complete provenance within the hard budget', () => {
  assert.ok(CRAFT_SOURCES.length >= 40);
  assert.ok(CRAFT_LESSONS.length >= 70);
  for (const source of CRAFT_SOURCES) {
    const medium = CRAFT_LESSONS.find(l => l.sourceId === source.id)!.medium;
    const packet = buildReferenceCraftContext(`分析《${source.title}》的${medium === 'ad' ? '广告' : '电影'}剧本`);
    assert.ok(packet.length > 0 && packet.length < 2400, source.id);
    const records = JSON.parse(packet.slice(packet.indexOf('\n[') + 1));
    assert.ok(records.some((record: {sourceId:string}) => record.sourceId === source.id), source.id);
    assert.ok(records.every((record: {edition:string; location:string; avoid:string}) => record.edition && record.location && record.avoid));
  }
  for (const lesson of CRAFT_LESSONS) {
    const packet = buildReferenceCraftContext(`${lesson.medium === 'ad' ? '广告' : '电影'}剧本 ${lesson.tags.join(' ')}`);
    assert.ok(packet.length > 0 && packet.length < 2400, lesson.id);
    assert.ok(JSON.parse(packet.slice(packet.indexOf('\n[') + 1)).length > 0);
  }
  assert.ok(CRAFT_LESSONS.every(lesson => !REFERENCE_CRAFT_HARNESS.includes(lesson.id)));
  assert.ok(selectReferenceLessons('借鉴《Guinness — Surfer》的剧本').every(lesson => lesson.medium === 'ad'));
  assert.ok(REFERENCE_CRAFT_HARNESS.length < 1500);
});

test('workspace context cannot turn a film request into an ad and embedded packets do not duplicate', () => {
  const request = '写大陆乡村悬疑剧本';
  assert.equal(buildReferenceCraftTurnContext(wrapWorkspaceContext('workshop', '广告品牌接口，修复 bug，《她》') + request), buildReferenceCraftContext(request));
  assert.equal(buildReferenceCraftTurnContext(wrapWorkspaceContext('canvas', '电影剧本台词') + '只改视频生成提示词'), '');
  assert.equal(buildReferenceCraftTurnContext('[用户正在鲲鹏文案工作室]\n' + buildCopywritingTaskHarness(request) + '\n用户请求：\n' + request), '');
  assert.equal(buildReferenceCraftTurnContext('[鲲鹏工作面上下文:bad]\n\n电影剧本'), '');
});

test('specific genre matches do not fill remaining slots with unrelated generic methods', () => {
  const sciFi = selectReferenceLessons('本土科幻电影世界观规则');
  assert.ok(sciFi.some(l => l.id === 'world-rules-bound-action'));
  assert.ok(!sciFi.some(l => l.id === 'voice-before-dialect' || l.id === 'desire-relay'));
  const suspense = selectReferenceLessons('大陆乡村悬疑剧本');
  assert.ok(!suspense.some(l => l.sourceId === 'myth-of-love-essay'));
  const car = selectReferenceLessons('写汽车产品广告剧本');
  assert.ok(car.length > 0 && car.length < 3);
  assert.ok(car.every(l => l.tags.some(tag => ['汽车', '产品'].includes(tag))));
});
