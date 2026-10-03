import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLearning, selectWritingLessons, writingLearningContext } from './learningPolicy.ts';
import type { WritingExperience } from './types.ts';
const source = { request:'不要用抽象评价，写出具体动作', before:'她很悲伤。', after:'她把那只杯子收进柜底。' };
const lesson = {dimension:'文笔',situation:'表现人物情绪时',guidance:'用具体动作承载情绪，保留读者推断空间',avoid:'直接贴情绪标签',evidence:'不要用抽象评价',before:'她很悲伤。',after:'她把那只杯子收进柜底。'};
function exp(id: string, genre: string, overrides: Partial<WritingExperience> = {}): WritingExperience {
 return {id,timestamp:1,docId:'doc',docTitle:'旧稿',styleNotes:[],vocabularyHits:[],tonePreference:'',structurePattern:'',whatWorked:'',whatToImprove:'',genres:[genre],styles:['克制'],...normalizeLearning({genres:[genre],styles:['克制'],lessons:[lesson]},source),...overrides};
}
test('evidence must exist; model praise cannot become user endorsement',()=>{
 const good=normalizeLearning({lessons:[lesson]},source).lessons!;
 assert.equal(good[0].basis,'user_feedback');
 assert.equal(normalizeLearning({lessons:[{...lesson,evidence:'用户说非常喜欢'}]},source).lessons!.length,0);
 assert.equal(normalizeLearning({lessons:[{...lesson,after:'她哭了'}]},source).lessons!.length,0);
 assert.equal(normalizeLearning({lessons:[{...lesson,evidence:'她很悲伤。'}]},source).lessons![0].basis,'revision');
 assert.equal(normalizeLearning({lessons:[{...lesson,evidence:'她很悲伤。',before:'',after:''}]},source).lessons![0].basis,'reflection');
});
test('genre recall excludes unrelated formats even in the same document',()=>{
 const fiction=exp('a','小说'), ad=exp('b','广告');
 assert.equal(selectWritingLessons([fiction],'写一个广告','doc').length,0);
 assert.equal(selectWritingLessons([fiction,ad],'品牌广告','doc')[0].experience.id,'b');
 assert.equal(selectWritingLessons([fiction],'写首诗歌').length,0);
 assert.equal(selectWritingLessons([fiction],'写小说')[0].experience.id,'a');
});
test('disabled lessons are excluded, duplicates deduplicate, context has a budget',()=>{
 assert.equal(selectWritingLessons([exp('a','小说',{disabled:true})],'小说').length,0);
 const records=Array.from({length:30},(_,i)=>exp(String(i),'小说',{timestamp:i}));
 assert.equal(selectWritingLessons(records,'小说').length,1);
 assert.equal(selectWritingLessons(records,'小说')[0].experience.id,'29');
 assert.ok(writingLearningContext(records,'小说').length<4500);
 assert.match(writingLearningContext(records,'小说'),/模型复盘不是用户认可/);
});
test('malformed and empty reflections do not manufacture lessons',()=>{
 assert.throws(()=>normalizeLearning(null,source));
 assert.deepEqual(normalizeLearning({lessons:[null,{},'bad'],genres:123},source).lessons,[]);
});
