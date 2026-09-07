// Offline production components; never bootstrap App, real sessions, settings or executors.
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile, readdir, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { readWorkspaceMessage } from '../../lib/agent/workspaceMessage.ts';
function contextOf(content) { const message = readWorkspaceMessage(content); assert.equal(message.status, 'valid'); return message.context; }
const root = path.resolve(import.meta.dirname, '../../..');
const temp = await mkdtemp(path.join(tmpdir(), 'kunpeng-queue-offline-'));
const evidence = path.join(import.meta.dirname, 'assistant-evidence');
const stores = `
import {create} from 'zustand';
import {emptyWorkshopData} from '${root}/src/lib/workshop/types.ts';
import {migrateWorkshopProjectObjects} from '${root}/src/lib/projectObjects/migrate.ts';
const data=migrateWorkshopProjectObjects({...emptyWorkshopData('p'),shots:[{id:'a',shotNo:'01',description:'车内',characterIds:[]},{id:'b',shotNo:'02',description:'停车',characterIds:[]}],projectViewState:{workspaceObjectId:'shot:a',workspaceOutputType:'image',agentDrawerState:'expanded'}},1);
export const workshop=create(set=>({data,project:{id:'p',name:'离线项目'},updateProjectViewState:patch=>set(s=>({data:{...s.data,projectViewState:{...s.data.projectViewState,...patch}}}))}));
export const chat=create(()=>({sessions:[{id:'s',projectId:'p'}],messages:[],currentSessionId:'s',activeView:'workshop',streamingPhase:'idle',isStreaming:false,streamingContent:'',streamingThinkingContent:'',error:null}));
export const settings=create(()=>({toolConfirmMode:'ask',setToolConfirmMode:()=>{}}));
export const decisions=create(()=>({pending:null,history:[],queue:[]}));
export const confirms=create(()=>({pending:[]}));
export const runs=create(()=>({runsById:{},runIdsBySession:{s:[]},currentRunId:null}));
export const unified=create(()=>({activeId:'p',recentChangeSets:[],pendingConflicts:[],restoreProjectSnapshot:async id=>{window.restored=id;return {status:'restored'};},undoProjectChange:id=>{window.undone=id;}}));
export const canvas=create(()=>({nodes:[],edges:[],selectedNodeId:null}));
export const canvasProject=create(()=>({activeProjectId:null,switching:false,projects:[]}));
export const director=create(()=>({isOpen:false,projectId:null,activePlanId:null}));
window.stores={workshop,chat,runs,unified,confirms};`;
const mocks = {
  '@/stores': `export {chat as useChatStore} from 'mock-stores';`,
  '@/stores/chatStore': `export {chat as useChatStore} from 'mock-stores';`,
  '@/stores/workshopStore': `export {workshop as useWorkshopStore} from 'mock-stores';`,
  '@/stores/unifiedProjectStore': `export {unified as useUnifiedProjectStore} from 'mock-stores';`,
  '@/stores/settingsStore': `export {settings as useSettingsStore} from 'mock-stores';`,
  '@/stores/askUserStore': `export {decisions as useAskUserStore} from 'mock-stores';`,
  '@/stores/toolConfirmStore': `export {confirms as useToolConfirmStore} from 'mock-stores';`,
  '@/stores/runStepStore': `export {runs as useRunStepStore} from 'mock-stores';`,
  '@/stores/canvasStore': `export {canvas as useCanvasStore} from 'mock-stores';`,
  '@/stores/projectStore': `export {canvasProject as useProjectStore} from 'mock-stores';`,
  '@/stores/directorStore': `export {director as useDirectorStore} from 'mock-stores';`,
  '@/hooks/useCanvasMention': `export const useCanvasMention=()=>({extractMentionedUrls:()=>[]});`,
  '@/hooks/useSound': `export const useSound=()=>({playNotification:()=>{}});`,
  '@/lib/greeting': `export const useHelloGreeting=()=> '继续';`,
  '@/lib/projectSessions': `export const ensureProjectSession=async()=>{if(window.failPrepare)throw Error('offline preparation');};`,
  '@/lib/markdown': `import React from 'react';export const MarkdownRenderer=({content})=><div>{content}</div>;`,
  '@tauri-apps/api/dialog': `export const open=async()=>[];`,
  '@tauri-apps/api/tauri': `export const convertFileSrc=()=>window.offlineImage;`,
};
const children = /(?:ProjectSessionSwitcher|ArtifactPickerPanel|WorkspaceAgentModelPicker|AskUserDialog|ContextUsagePill|ProjectChangeReview|ProjectConversationContext)$/;
const bundle = await build({absWorkingDir:root,bundle:true,write:false,outfile:path.join(temp,'fixture.js'),format:'iife',platform:'browser',jsx:'automatic',define:{'process.env.NODE_ENV':'"production"'},
  stdin:{resolveDir:root,loader:'tsx',contents:`
import {useState} from 'react';import {createRoot} from 'react-dom/client';
import WorkshopChatPanel from './src/components/workshop/WorkshopChatPanel';
import {projectAssistantQueue as queue} from './src/stores/projectAssistantQueueStore';
import {chat,workshop,runs} from 'mock-stores';
window.queue=queue;window.sent=[];window.mode='success';
function send(content){
 const id='r'+(window.sent.length+1);window.sent.push(content);const before=chat.getState().messages;
 chat.setState({messages:[...before,{id:'u'+id,role:'user',content,timestamp:Date.now()}],streamingPhase:'thinking',streamingThinkingContent:'PRIVATE_THINKING_SENTINEL',isStreaming:true,error:null});
 runs.setState(s=>({currentRunId:id,runIdsBySession:{s:[id,...s.runIdsBySession.s]},runsById:{...s.runsById,[id]:{id,sessionId:'s',status:'running',steps:[],progressUpdates:[],startedAt:Date.now()}}}));
 return new Promise((resolve,reject)=>{window.finish=()=>{
  chat.setState({streamingPhase:'idle',isStreaming:false,streamingThinkingContent:''});
  runs.setState(s=>({runsById:{...s.runsById,[id]:{...s.runsById[id],status:window.mode==='success'?'done':'failed'}}}));
  if(window.mode==='reject'){reject(Error('offline failure'));return;}
  if(window.mode==='swallow'){chat.setState({error:'mock failed'});resolve();return;}
  chat.setState(s=>({messages:[...s.messages,{id:'m'+id,role:'assistant',content:'本次调整已结束。',timestamp:Date.now(),metadata:{runId:id}}]}));resolve();
 };});
}
function Fixture(){const [mounted,mount]=useState(true);window.mount=mount;return <div className="fixture"><main><h2>离线助手验收</h2><p>模型、项目、会话和持久化接口使用 mock。</p><div id="inspector">共享 Inspector 占位</div></main><aside>{mounted&&<WorkshopChatPanel embedded onSendMessage={send} onAbort={()=>window.finish?.()}/>}</aside></div>}
window.addEventListener('kunpeng-workspace-assistant-inspect',e=>{e.preventDefault();window.inspect=e.detail;document.getElementById('inspector').textContent='共享 Inspector：镜头01';});
createRoot(document.getElementById('root')).render(<Fixture/>);`},
  plugins:[{name:'offline',setup(b){
    b.onResolve({filter:/.*/},args=>{
      if(args.path==='mock-stores'||mocks[args.path])return {path:args.path,namespace:'mock'};
      if(children.test(args.path))return {path:args.path,namespace:'child'};
      if(args.path.startsWith('@/'))return {path:path.join(root,'src',args.path.slice(2)+'.ts')};
    });
    b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:args.path==='mock-stores'?stores:mocks[args.path],loader:'tsx',resolveDir:root}));
    b.onLoad({filter:/.*/,namespace:'child'},args=>({contents:args.path.endsWith('WorkspaceAgentModelPicker')?`import React from 'react';export default ()=> <button>DeepSeek</button>;`:args.path.endsWith('AskUserDialog')?`export const AskUserDecisionCard=()=>null;`:`export default ()=>null;`,loader:'tsx',resolveDir:root}));
  }}]});
const cssFile=(await readdir(path.join(root,'dist/assets'))).find(file=>/^main-.*\.css$/.test(file));
const css=await readFile(path.join(root,'dist/assets',cssFile),'utf8');
const html=`<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}\n${bundle.outputFiles.find(f=>f.path.endsWith('.css')).text}\nhtml,body,#root{height:100%;margin:0;background:#191a1c;color:#ddd}.fixture{display:grid;grid-template-columns:1fr 360px;height:100%}.fixture main{padding:30px}.fixture aside{min-height:0;display:flex;border-left:1px solid #444}@media(max-width:600px){.fixture{grid-template-columns:1fr}.fixture main{display:none}}</style><div id="root"></div><script>${bundle.outputFiles.find(f=>f.path.endsWith('.js')).text}</script></html>`;
const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});let browser;
try {
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url='http://127.0.0.1:'+server.address().port;
  browser=await puppeteer.launch({executablePath:process.env.SMOKE_BROWSER_PATH||path.join(process.env.HOME,'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true,userDataDir:temp});
  const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(url)||r.url().startsWith('data:')?r.continue():r.abort());
  await page.setViewport({width:1440,height:850});await page.goto(url);await page.waitForSelector('textarea');
  await page.type('textarea','冻结A的输入');
  await page.evaluate(()=>window.stores.workshop.getState().updateProjectViewState({workspaceObjectId:'shot:b'}));
  assert.match(await page.$eval('.workspace-assistant-scope',el=>el.textContent),/仍属于原对象/);
  await page.evaluate(()=>window.mount(false));await page.waitForFunction(()=>!document.querySelector('textarea'));
  await page.evaluate(()=>window.mount(true));await page.waitForSelector('textarea');assert.equal(await page.$eval('textarea',el=>el.value),'冻结A的输入');
  await page.click('[title="发送"]');await page.waitForFunction(()=>window.sent.length===1);
  assert.match(contextOf(await page.evaluate(()=>window.sent[0])),/"object_id":"shot:a"/);
  assert.equal(await page.$eval('textarea',el=>el.value),'');
  assert.equal(await page.evaluate(()=>[...document.querySelectorAll('pre')].some(el=>el.textContent.includes('PRIVATE_THINKING')&&el.getBoundingClientRect().height>0)),false);
  await page.type('textarea','A的第二项');await page.click('[title="补充当前任务"]');
  await page.click('[title="编辑消息"]');
  await page.$eval('.workspace-assistant-queue textarea',el=>{el.focus();el.select();});await page.keyboard.press('Backspace');await page.type('.workspace-assistant-queue textarea','A的第二项已编辑');
  assert.equal(await page.$eval('.workspace-assistant-queue textarea',el=>el.value),'A的第二项已编辑');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent.trim()==='保存并排队').click());
  await page.waitForFunction(()=>window.queue.getSnapshot().items.some(i=>i.prompt==='A的第二项已编辑'));
  assert.equal(await page.evaluate(()=>window.queue.getSnapshot().items.find(i=>i.prompt==='A的第二项已编辑').target.objectId),'shot:a');
  await page.evaluate(()=>window.mount(false));await page.waitForFunction(()=>!document.querySelector('textarea'));
  await page.evaluate(()=>window.mount(true));await page.waitForSelector('textarea');
  assert.equal(await page.evaluate(()=>window.sent.length),1);
  await page.evaluate(()=>window.finish());await page.waitForFunction(()=>window.sent.length===2);await page.evaluate(()=>window.finish());
  assert.match(await page.evaluate(()=>window.sent[1]),/A的第二项已编辑$/);
  await page.waitForFunction(()=>window.queue.getSnapshot().items.every(i=>i.status==='done'));
  await page.click('[aria-label="调整当前浏览对象"]');await page.type('textarea','B的草稿');
  assert.equal(await page.evaluate(()=>document.body.textContent.includes('本次调整已结束。')),false,'A history excluded from B thread');
  await page.evaluate(()=>window.stores.workshop.getState().updateProjectViewState({workspaceObjectId:'shot:a'}));
  await page.click('[aria-label="调整当前浏览对象"]');assert.equal(await page.$eval('textarea',el=>el.value),'');
  assert.equal(await page.evaluate(()=>document.body.textContent.includes('本次调整已结束。')),true);
  // Preparation failure is retriable, with no executor call.
  await page.evaluate(()=>window.failPrepare=true);await page.type('textarea','准备失败保留');await page.click('[title="发送"]');
  await page.waitForFunction(()=>window.queue.getSnapshot().items.some(i=>i.status==='failed'));
  assert.equal(await page.evaluate(()=>window.sent.length),2);await page.evaluate(()=>window.failPrepare=false);await page.click('[title="重试"]');
  await page.waitForFunction(()=>window.sent.length===3);await page.evaluate(()=>{window.mode='swallow';window.finish();});
  await page.waitForFunction(()=>window.queue.getSnapshot().items.some(i=>i.status==='uncertain'));
  assert.equal(await page.$('[title="重试"]'),null);
  // Structured media result, actual Skill trace and message-bound snapshot.
  await page.evaluate(()=>{
    const c=document.createElement('canvas');c.width=240;c.height=150;const x=c.getContext('2d');x.fillStyle='#66836f';x.fillRect(0,0,240,150);x.fillStyle='#ddd';x.fillRect(35,20,170,110);window.offlineImage=c.toDataURL();
    const w=window.stores.workshop;w.setState(s=>({data:{...s.data,projectSnapshots:[{id:'snap',messageId:'mr2'}],projectObjects:{...s.data.projectObjects,media:[{id:'media-a',projectId:'p',kind:'media-file',ownerObjectId:'shot:a',path:'/offline/result.png',mediaType:'image',purpose:'candidate-version',source:'generated',relationIds:[],updatedAt:1,version:1}],versions:[{id:'v1',mediaObjectId:'media-a',ordinal:1}]}}}));
    window.stores.chat.setState(s=>({messages:s.messages.map(m=>m.id==='mr2'?{...m,metadata:{...m.metadata,projectSnapshotId:'snap',toolExecutions:[{status:'completed',result:{success:true,output:'{"mediaId":"media-a"}'}}]}}:m)}));
    window.stores.runs.setState(s=>({runsById:{...s.runsById,r2:{...s.runsById.r2,steps:[{id:'step',title:'调用技能',source:'tool',status:'done',subAgents:[],toolCalls:[{id:'tool',name:'skill_invoke',status:'done',summary:'',startedAt:1,display:{action:'使用技能',icon:'default',detail:'镜头连续性检查',detailStyle:'text'}}]}]}}}));
  });
  await page.waitForSelector('.workspace-assistant-results');
  assert.equal(await page.$eval('.workspace-assistant-results',el=>el.open),false);
  await page.click('.workspace-assistant-results > summary');
  assert.equal(await page.$eval('.workspace-assistant-results',el=>el.open),true);
  await page.waitForSelector('.workspace-assistant-result',{visible:true});await page.click('.workspace-assistant-result');
  assert.equal(await page.evaluate(()=>window.inspect.mediaId),'media-a');assert.equal(await page.evaluate(()=>window.inspect.objectId),'shot:a');
  assert.equal(await page.$('[aria-label="实际 Skill 使用"]'),null);
  const resultStage='.workspace-assistant-message:has(.workspace-assistant-result) .workspace-assistant-stage';
  assert.equal(await page.$eval(resultStage,el=>el.open),false);
  await page.click(`${resultStage} > summary`);
  await page.click(`${resultStage} .workspace-assistant-step > details > summary`);
  await page.evaluate(()=>[...document.querySelectorAll('.workspace-assistant-step-record summary')].find(el=>el.textContent==='技能详情').click());
  assert.equal(await page.$eval(`${resultStage} .workspace-assistant-step-record pre`,el=>el.textContent==='镜头连续性检查'&&el.getBoundingClientRect().height>0),true);
  assert.equal(await page.evaluate(()=>document.body.textContent.includes('已同步时间线')),false);
  page.on('dialog',dialog=>dialog.accept());await page.click('[aria-label="消息菜单"]');
  await page.evaluate(()=>[...document.querySelectorAll('button')].find(el=>el.textContent==='回到此项目快照').click());await page.waitForFunction(()=>window.restored==='snap');
  await mkdir(evidence,{recursive:true});
  for (const width of [1440,1280,1024,390]) {
    await page.setViewport({width,height:850});
    assert.ok(await page.$eval('[title="发送"]',el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.bottom<=innerHeight;}));
    await page.screenshot({path:path.join(evidence,`assistant-${width}.png`)});
  }
  await page.type('textarea','媒体面保留文字');
  await page.evaluate(()=>{window.mode='success';window.stores.chat.setState({error:null});window.stores.workshop.getState().updateProjectViewState({workspaceSurface:'editor',agentDrawerState:'hidden'});});
  await page.waitForFunction(()=>document.querySelector('.workspace-assistant-scope').textContent.includes('剪辑对话'));
  assert.equal(await page.$eval('textarea',el=>el.value),'');
  const beforeOpen=await page.evaluate(()=>window.queue.getSnapshot().items.length);
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kunpeng-editor-drawer-open')));
  assert.equal(await page.evaluate(()=>window.queue.getSnapshot().items.length),beforeOpen);
  assert.equal(await page.evaluate(()=>window.stores.workshop.getState().data.projectViewState.agentDrawerState),'expanded');
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kunpeng-editor-prompt',{detail:{prompt:'离线整理剪辑'}})));
  await page.waitForFunction(()=>window.sent.length===4);assert.match(contextOf(await page.evaluate(()=>window.sent[3])),/timeline_get_state/);assert.match(contextOf(await page.evaluate(()=>window.sent[3])),/"surface":"editor"/);
  await page.evaluate(()=>window.stores.workshop.getState().updateProjectViewState({workspaceSurface:'documents'}));
  await page.waitForFunction(()=>document.querySelector('.workspace-assistant-scope').textContent.includes('文档 / 规格'));
  await page.type('textarea','只调整项目规格');await page.click('[title="补充当前任务"]');
  await page.evaluate(()=>window.finish());await page.waitForFunction(()=>window.sent.length===5);
  assert.match(contextOf(await page.evaluate(()=>window.sent[4])),/"surface":"documents"/);assert.doesNotMatch(contextOf(await page.evaluate(()=>window.sent[4])),/"object_id"/);
  await page.evaluate(()=>window.finish());await page.waitForFunction(()=>window.stores.chat.getState().streamingPhase==='idle');
  await page.evaluate(()=>window.stores.workshop.getState().updateProjectViewState({workspaceSurface:'media'}));
  await page.waitForFunction(()=>document.querySelector('textarea').value==='媒体面保留文字');
  const targeted=await page.evaluate(()=>{
    window.stores.workshop.getState().updateProjectViewState({agentDrawerState:'hidden'});
    const event=new CustomEvent('kunpeng-workspace-assistant-target',{cancelable:true,detail:{projectId:'p',objectId:'shot:b'}});
    window.dispatchEvent(event);
    // Parent sends the reference in the same turn, before React has rendered the target switch.
    window.dispatchEvent(new CustomEvent('kunpeng-project-agent-context',{detail:{references:[{id:'ref-b',objectId:'shot:b',kind:'shot',sourceView:'workshop',label:'镜头02引用',operationScope:'read',addedAt:1}]}}));
    const draft=window.queue.draft('p','s','media');
    return {accepted:event.defaultPrevented,objectId:draft.target.objectId,refs:draft.target.references.map(r=>r.objectId),text:draft.text,
      oldSaved:Object.values(window.queue.getSnapshot().drafts).some(d=>d.target.objectId==='shot:a'&&d.text==='媒体面保留文字'),
      state:window.stores.workshop.getState().data.projectViewState.agentDrawerState};
  });
  assert.deepEqual(targeted,{accepted:true,objectId:'shot:b',refs:['shot:b'],text:'B的草稿',oldSaved:true,state:'expanded'});
  await page.waitForFunction(()=>document.querySelector('.workspace-assistant-scope').textContent.includes('镜头 02'));
  await page.evaluate(()=>window.dispatchEvent(new CustomEvent('kunpeng-project-agent-context',{detail:{references:[{id:'ref-a',objectId:'shot:a',kind:'shot',sourceView:'workshop',label:'镜头01引用',operationScope:'read',addedAt:2}]}})));
  assert.equal(await page.evaluate(()=>window.queue.draft('p','s','media').target.objectId),'shot:b','reference-only event must not retarget');
  const rejected=await page.evaluate(()=>[{projectId:'other',objectId:'shot:a'},{projectId:'p',objectId:'missing'},{projectId:'p',objectId:'shot:b',mediaId:'media-a'}].map(detail=>{
    const event=new CustomEvent('kunpeng-workspace-assistant-target',{cancelable:true,detail});window.dispatchEvent(event);return event.defaultPrevented;
  }));assert.deepEqual(rejected,[false,false,false]);
  assert.equal(await page.evaluate(()=>window.queue.draft('p','s','media').target.objectId),'shot:b');
  const versionTarget=await page.evaluate(()=>{
    const event=new CustomEvent('kunpeng-workspace-assistant-target',{cancelable:true,detail:{projectId:'p',objectId:'shot:a',mediaId:'media-a'}});window.dispatchEvent(event);
    const target=window.queue.draft('p','s','media').target;
    return {accepted:event.defaultPrevented,objectId:target.objectId,mediaId:target.mediaId,versionId:target.versionId};
  });assert.deepEqual(versionTarget,{accepted:true,objectId:'shot:a',mediaId:'media-a',versionId:'v1'});
  await page.evaluate(()=>window.stores.workshop.setState(s=>({data:{...s.data,projectObjects:{...s.data.projectObjects,media:[...s.data.projectObjects.media,
    {id:'direct-audio',projectId:'p',kind:'media-file',ownerObjectId:'shot:a',path:'/offline/result.wav',label:'独立音频',mediaType:'audio',purpose:'candidate-version',source:'generated',relationIds:[],updatedAt:1,version:1},
    {id:'direct-loose',projectId:'p',kind:'media-file',ownerObjectId:'old-generation-group',path:'/offline/loose.png',label:'未归类图片',mediaType:'image',purpose:'unclassified',source:'generated',relationIds:[],updatedAt:1,version:1},
  ]}}})));
  for(const [index,id] of ['direct-audio','direct-loose'].entries()){
    assert.equal(await page.evaluate(id=>{
      const event=new CustomEvent('kunpeng-workspace-assistant-target',{cancelable:true,detail:{projectId:'p',objectId:id,mediaId:id}});window.dispatchEvent(event);return event.defaultPrevented;
    },id),true);
    await page.waitForFunction(id=>window.queue.draft('p','s','media').target.objectId===id,{},id);
    await page.type('textarea','只调整当前独立媒体');await page.click('[title="发送"]');
    await page.waitForFunction(count=>window.sent.length===count,{},6+index);
    assert.match(contextOf(await page.evaluate(()=>window.sent.at(-1))),new RegExp('"object_id":"'+id+'"'));
    assert.match(contextOf(await page.evaluate(()=>window.sent.at(-1))),new RegExp('"media_id":"'+id+'"'));
    await page.evaluate(()=>window.finish());await page.waitForFunction(()=>!window.queue.getSnapshot().items.some(i=>i.status==='running'));
  }
  // The event must use current registry data, not a previously accepted media identity.
  await page.evaluate(()=>window.stores.workshop.setState(s=>({data:{...s.data,projectObjects:{...s.data.projectObjects,media:s.data.projectObjects.media.map(m=>m.id==='direct-audio'?{...m,archived:true}:m)}}})));
  assert.equal(await page.evaluate(()=>{const e=new CustomEvent('kunpeng-workspace-assistant-target',{cancelable:true,detail:{projectId:'p',objectId:'direct-audio',mediaId:'direct-audio'}});window.dispatchEvent(e);return e.defaultPrevented;}),false);
  assert.deepEqual(errors,[]);console.log('PASS: queue editing/remounts, frozen scopes, editor/documents events, actual media/Skill cards, Inspector/snapshot, 4 widths; explicit target + immediate reference preserves old drafts, reference-only never retargets, invalid targets rejected, known direct audio/unclassified media send successfully. External requests blocked; model/session/storage ports mocked.');
} finally {
  server.closeAllConnections();
  if(browser) {
    let timer;
    await Promise.race([browser.close(),new Promise(resolve=>{timer=setTimeout(()=>{browser.process()?.kill('SIGKILL');resolve();},8000);})]);
    clearTimeout(timer);
  }
  await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});
}
