import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { buildSkillDescriptionText, buildSkillRelevanceNotice } from '../agent/skillPromptPolicy.ts';
import { resolveSkillCatalogId, SkillLoader } from '../agent/skillLoader.ts';
import { normalizeRecreationDetails, formatRecreationDetails, buildVideoAnalysisQuestion } from './recreation.ts';

test('bundled skill is loaded without a new UI entry, and only injected on video work', async () => {
  const md=readFileSync(new URL('../../../skills/hypit-video-analysis/SKILL.md',import.meta.url),'utf8');
  const manifest=readFileSync(new URL('../../../skills/hypit-video-analysis/skill.json',import.meta.url),'utf8');
  const loader=new SkillLoader(['/skills'],{scan:async()=>['hypit-video-analysis'],read:async path=>path.endsWith('skill.json')?manifest:md});
  const skills=await loader.loadAll();
  assert.equal(skills.length,1); assert.equal(resolveSkillCatalogId(skills[0]),null);
  assert.equal(buildSkillDescriptionText(skills,{activeView:'chat'}),'');
  for(const query of ['分析这段视频','复刻这段视频，换产品','帮我看看 /tmp/source.mp4','hypit 拉片']) {
    assert.ok(buildSkillRelevanceNotice(skills,{query}),query);
  }
  for(const query of ['帮我写首诗','复刻这张图片','压缩 /tmp/source.mp4','只转写这段视频','']) {
    assert.equal(buildSkillRelevanceNotice(skills,{query}),null,query);
  }
});
test('profile details survive persistence and reach planners; legacy/malformed fields stay safe', () => {
  const parsed={shotTable:['0-2: 人物入镜'],semanticEvents:['2秒：结论词触发数字出现'],recreationPlan:['替换数字，保留揭示关系'],evidenceLimits:['时间近似'],visualDesign:'wrong',htmlCssPatterns:[null,7,'图层持续']};
  const stored=JSON.parse(JSON.stringify(normalizeRecreationDetails(parsed)));
  assert.deepEqual(stored.shotTable,parsed.shotTable);
  assert.deepEqual(stored.htmlCssPatterns,['图层持续']);
  assert.equal(stored.visualDesign,undefined);
  assert.ok(formatRecreationDetails(stored).includes(parsed.semanticEvents[0]));
  assert.ok(formatRecreationDetails(stored).includes(parsed.recreationPlan[0]));
  assert.equal(formatRecreationDetails({title:'old profile'}),'');
  assert.deepEqual(normalizeRecreationDetails(null),{});
});
test('single-question native video calls stay scoped; detailed analysis gains the protocol', () => {
  assert.equal(buildVideoAnalysisQuestion('衣服是什么颜色？'),'衣服是什么颜色？');
  assert.ok(buildVideoAnalysisQuestion('分析视频并复刻动作').length > 200);
});
