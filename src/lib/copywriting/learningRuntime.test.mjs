import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
import * as policy from './learningPolicy.ts';
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
async function fixture(complete) {
 const state = { activeDocId:'a', docs:[{id:'a',title:'悬疑小说',content:'她很悲伤。',contentRevision:1}],experiences:[],
  appendExperience:async e=>{state.experiences.push(e);} };
 const exports={};
 const source=await readFile(new URL('./learningRuntime.ts',import.meta.url),'utf8');
 let calls=0;
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{
  exports, require: name=>name.includes('quickChat')?{quickChat:async (...args)=>{calls++;return complete(...args);}}:name.includes('copywritingStore')?{useCopywritingStore:{getState:()=>state,setState:p=>Object.assign(state,p)}}:policy,
  setTimeout,clearTimeout,AbortController,console,
 });
 return { ...exports,state,calls:()=>calls };
}
const payload=JSON.stringify({genres:['小说'],styles:['克制'],lessons:[{dimension:'文笔',situation:'写悲伤时',guidance:'用具体动作表现情绪，不直接贴标签',evidence:'不要直接写悲伤',before:'',after:''}]});
test('learns without JSON in assistant output, keeps original document, deduplicates repeated completion',async()=>{
 const f=await fixture(async()=>payload);
 const turn=f.captureWritingTurn('[用户正在鲲鹏文案工作室]\n用户请求：\n不要直接写悲伤，改用动作');
 f.state.activeDocId='b'; f.state.docs.push({id:'b',title:'广告',content:'不相关文档'});
 f.learnWritingTurn(turn,'她把杯子藏在柜底。'.repeat(20),'session-a','run-a');
 await tick(); await tick();
 assert.equal(f.state.experiences.length,1);
 assert.equal(f.state.experiences[0].docId,'a');
 assert.equal(f.state.experiences[0].sourceSessionId,'session-a');
 f.learnWritingTurn(turn,'她把杯子藏在柜底。'.repeat(20),'session-a','run-a');
 await tick();assert.equal(f.calls(),1);
 assert.equal(f.captureWritingTurn('普通对话'),null);
});
test('reset discards in-flight reflection and errors remain visible',async()=>{
 let resolve;
 const f=await fixture(()=>new Promise(r=>{resolve=r;}));
 const turn=f.captureWritingTurn('[用户正在鲲鹏文案工作室]\n用户请求：\n不要直接写悲伤');
 f.learnWritingTurn(turn,'改稿内容'.repeat(30),'s','r');await tick();
 f.invalidateWritingLearning();resolve(payload);await tick();await tick();
 assert.equal(f.state.experiences.length,0);
 const broken=await fixture(async()=>{throw Error('网络失败');});
 const b=broken.captureWritingTurn('[用户正在鲲鹏文案工作室]\n用户请求：\n修改文笔');
 broken.learnWritingTurn(b,'改稿内容'.repeat(30),'s','r');await tick();await tick();
 assert.equal(broken.state.learningStatus,'error');assert.match(broken.state.learningMessage,/网络失败/);
});
test('new document binds to successful write receipt and short feedback still learns',async()=>{
 const f=await fixture(async()=>payload);f.state.activeDocId=null;
 const turn=f.captureWritingTurn('[用户正在鲲鹏文案工作室]\n用户请求：\n以后不要直接写悲伤，记住这个写法');
 f.state.docs.push({id:'new',title:'新小说',content:'她把杯子藏好。'.repeat(20),contentRevision:1});
 f.bindWritingToolResult(turn,'copywriting_set_doc',{success:true,output:JSON.stringify({doc:{id:'new'}})});
 f.state.activeDocId='a';
 f.learnWritingTurn(turn,'好的','s','new-run');await tick();await tick();
 assert.equal(f.state.experiences[0].docId,'new');
 assert.equal(f.state.experiences[0].docTitle,'新小说');
});
