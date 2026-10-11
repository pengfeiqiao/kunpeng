import test from 'node:test';import assert from 'node:assert/strict';import {build} from 'esbuild';import {createServer} from 'node:http';import path from 'node:path';import puppeteer from 'puppeteer-core';
const root=path.resolve(import.meta.dirname,'../../..');
test('browser: mounted drawer isolates drafts, delayed attachments, sending and stopping across sessions',{timeout:60000},async()=>{
 const stubs={
 '@/stores':`export {useChatStore} from '${root}/src/stores/chatStore.ts';`,
 '@/stores/workshopStore':`export const useWorkshopStore=s=>s({data:null,updateProjectViewState(){}});`,
 '@/stores/askUserStore':`export const useAskUserStore=s=>s({pending:null,history:[],queue:[]});`,
 '@/hooks/useSound':`export const useSound=()=>({playNotification(){}});`,
 '@/lib/markdown':`import React from 'react';export const MarkdownRenderer=({content})=><p>{content}</p>;`,
 '@/lib/agent/harnessDisplay':`export const stripHarnessPrefix=x=>x;`,
 '@/lib/chat/streamingParts':`export const splitStreamingParts=x=>({stable:x,tail:''});`,
 '@/lib/performance/tailWindow':`export const tailWindow=items=>({items,startIndex:0});`,
 '@/lib/projectObjects/referenceTransfer':`export const PROJECT_REFERENCE_MIME='x-test';export const projectTransferReferences=()=>[];export const resolveReferenceTransfer=()=>[];`,
 '@/lib/projectObjects/conversationRefs':`export const mergeProjectConversationReferences=()=>[];`,
 '@tauri-apps/api/dialog':`export const open=async()=>null;`,
 };
 const result=await build({absWorkingDir:root,bundle:true,write:false,outfile:'/tmp/parallel-composer.js',format:'iife',platform:'browser',jsx:'automatic',alias:{'@':path.join(root,'src')},define:{'process.env.NODE_ENV':'"development"'},stdin:{resolveDir:root,loader:'tsx',contents:`
 import React from 'react';import {createRoot} from 'react-dom/client';import Drawer from './src/components/chat/AgentDrawer';import {useChatStore} from '@/stores';
 window.chat=useChatStore;window.sent=[];
 for(const id of ['b','a'])useChatStore.getState().addSession({id,title:id,createdAt:1,updatedAt:1});
 const pick=()=>new Promise(resolve=>{window.finishPick=resolve});
 createRoot(document.getElementById('root')).render(<Drawer open onOpenChange={()=>{}} title="助手" variant="light" suggestions={[]} greeting={{hello:'hello'}} onPickFiles={pick} onSend={(text,files)=>window.sent.push({sid:useChatStore.getState().currentSessionId,text,files})} onAbort={()=>useChatStore.getState().patchSessionView(useChatStore.getState().currentSessionId,{isStreaming:false,streamingPhase:'idle'})}/>);
 `},plugins:[{name:'ports',setup(b){b.onResolve({filter:/.*/},args=>{if(stubs[args.path])return {path:args.path,namespace:'stub'};if(args.importer.endsWith('/AgentDrawer.tsx')&&args.path.startsWith('.'))return {path:args.path,namespace:'child'};});b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'jsx',resolveDir:root}));b.onLoad({filter:/.*/,namespace:'child'},args=>({contents:args.path==='./ConversationAttachment'?`import React from 'react';export default ({path})=><span data-attachment={path}>{path}</span>;`:`export const AskUserDecisionCard=()=>null;export default ()=>null;`,loader:'jsx',resolveDir:root}));}}]});
 const js=result.outputFiles.find(f=>f.path.endsWith('.js')).text;const server=createServer((req,res)=>{res.end(req.url==='/app.js'?js:'<div id="root"></div><script src="/app.js"></script>');});await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
 try{
 browser=await puppeteer.launch({executablePath:process.env.BROWSER_BIN||path.join(root,'.local-browsers/chromium/mac_arm-1651413/chrome-mac/Chromium.app/Contents/MacOS/Chromium'),headless:true});const page=await browser.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.error('fixture browser:',e.message);});await page.goto(`http://127.0.0.1:${server.address().port}`);await page.waitForSelector('textarea',{timeout:5000});
 await page.type('textarea','draft A');await page.click('[title="上传文件"]');await page.waitForFunction(()=>typeof finishPick==='function');
 await page.evaluate(()=>chat.getState().setCurrentSession('b'));await page.waitForFunction(()=>document.querySelector('textarea').value==='');await page.type('textarea','draft B');
 await page.evaluate(()=>finishPick(['/a.png']));await page.waitForFunction(()=>chat.getState().draftFiles.a?.length===1);assert.equal(await page.$('[data-attachment="/a.png"]'),null);
 await page.evaluate(()=>chat.getState().setCurrentSession('a'));await page.waitForFunction(()=>document.querySelector('textarea').value==='draft A');await page.waitForSelector('[data-attachment="/a.png"]');await page.click('[title="发送（⌘ / Ctrl + Enter）"]');
 assert.deepEqual(await page.evaluate(()=>sent),[{sid:'a',text:'draft A',files:['/a.png']}]);
 await page.evaluate(()=>chat.getState().setCurrentSession('b'));await page.waitForFunction(()=>document.querySelector('textarea').value==='draft B');
 await page.evaluate(()=>{chat.getState().patchSessionView('a',{isStreaming:true,streamingPhase:'thinking'});chat.getState().patchSessionView('b',{isStreaming:true,streamingPhase:'thinking'});});await page.click('[title="停止"]');
 assert.equal(await page.evaluate(()=>Boolean(chat.getState().streamingSessions.a)),true);assert.equal(await page.evaluate(()=>Boolean(chat.getState().streamingSessions.b)),false);assert.deepEqual(errors,[]);
 }finally{await browser?.close();await new Promise(r=>server.close(r));}
});
