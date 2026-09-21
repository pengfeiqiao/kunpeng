import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';
const root = path.resolve(import.meta.dirname, '../..');
test('real UI: native download/cancel/failure and returning to the mounted large chat', {timeout:60000}, async () => {
  const stubs = {
    '@/stores': `import {create} from 'zustand'; export const useChatStore=create(()=>({messages:[{id:'one',role:'user',content:'test'}],currentSessionId:'s',sessions:[{id:'s',title:'test'}],activeView:'workshop',streamingPhase:'idle'}));window.chat=useChatStore; export const useSettingsStore=()=>({sidebarCollapsed:false,sessionTitles:{}});`,
    '@/hooks': `export const useSound=()=>({playNotification:()=>{}});`,
    '@/lib/chat/artifacts': `export const collectChatArtifacts=()=>[];export const isPresentableOutputArtifact=()=>false;`,
    '@/lib/credentials': `export const hasAnyChatProviderKey=()=>true;`,
    '@/types/agent': `export const DEFAULT_AGENT_METAS=[];`,
    '@/lib/workspace/engineCatalog': `export const workspaceEngine=()=>null;`,
    '@/stores/askUserStore': `export const useAskUserStore=selector=>selector({pending:null,history:[],queue:[]});`,
    '@tauri-apps/api/tauri': `export const convertFileSrc=p=>'asset://localhost/'+encodeURIComponent(p);export async function invoke(command,args){window.downloadCalls.push({command,args});if(window.failDownload)throw Error('disk full');return null;}`,
  };
  const bundle = await build({absWorkingDir:root, bundle:true, write:false, outfile:'/tmp/media-chat.js', platform:'browser', format:'iife', jsx:'automatic',
    alias:{'@':path.join(root,'src')}, define:{'process.env.NODE_ENV':'"development"'},
    stdin:{resolveDir:root,loader:'tsx',contents:`
import React from 'react';import {createRoot} from 'react-dom/client';import Chat from './src/components/ChatArea';import Inspector from './src/components/workspace/MediaInspector';import {useChatStore} from '@/stores';
window.downloadCalls=[];const media={media:{id:'m',path:'asset://localhost/%2Ftmp%2F%E5%9B%BE%20a.webp',mediaType:'image'},ordinal:1,adopted:false};
function App(){const view=useChatStore(s=>s.activeView);return <><div id="chat" style={{display:view==='chat'?'block':'none',height:420}}><Chat isConnected onSendMessage={async()=>{}}/></div><Inspector title="图" selected={media} versions={[media]} mediaSrc={()=>''} onSelect={()=>{}} onAdopt={()=>{}} onPrompt={()=>{}} onEdit={()=>{}} onAddToChat={()=>{}}/></>};createRoot(document.getElementById('root')).render(<App/>);`},
    plugins:[{name:'test-ports',setup(b){
      b.onResolve({filter:/.*/},args=>{
        if(stubs[args.path])return {path:args.path,namespace:'stub'};
        if(args.importer.endsWith('/ChatArea.tsx') && /^\.\//.test(args.path))return {path:args.path,namespace:'chat-child'};
      });
      b.onLoad({filter:/.*/,namespace:'stub'},args=>({contents:stubs[args.path],loader:'js',resolveDir:root}));
      b.onLoad({filter:/.*/,namespace:'chat-child'},args=>({contents:args.path==='./MessageList'?`import React from 'react';export default ()=> <div style={{height:2400}}>消息历史</div>;`:`export default ()=>null;`,loader:'jsx',resolveDir:root}));
    }}]});
  const js=bundle.outputFiles.find(f=>f.path.endsWith('.js')).text;
  const css=`#chat>div{height:100%;display:flex;flex-direction:column}#chat .flex{display:flex}#chat .flex-col{flex-direction:column}#chat .flex-1{flex:1}#chat .min-h-0{min-height:0}#chat .overflow-y-auto{overflow-y:auto}`;
  const server=createServer((req,res)=>{res.end(req.url==='/test.js'?js:`<style>${css}</style><div id="root"></div><script src="/test.js"></script>`);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));let browser;
  try {
    browser=await puppeteer.launch({executablePath:process.env.BROWSER_BIN||path.join(root,'.local-browsers/chromium/mac_arm-1651413/chrome-mac/Chromium.app/Contents/MacOS/Chromium'),headless:true});
    const page=await browser.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.click('[aria-label="下载原文件"]');await page.waitForFunction(()=>downloadCalls.length===1);
    assert.deepEqual(await page.evaluate(()=>downloadCalls[0]),{command:'save_file_dialog',args:{sourcePath:'/tmp/图 a.webp',defaultName:'图 a.webp'}});
    assert.equal(await page.$('[role="alert"]'),null,'cancel does not report failure');
    await page.evaluate(()=>{window.failDownload=true;});await page.click('[aria-label="下载原文件"]');await page.waitForSelector('[role="alert"]');
    const bottom=()=>page.evaluate(()=>{const e=document.querySelector('#chat .overflow-y-auto');return e.scrollHeight-e.scrollTop-e.clientHeight<2;});
    await page.evaluate(()=>chat.setState({activeView:'chat'}));await page.waitForFunction(()=>{const e=document.querySelector('#chat .overflow-y-auto');return e.scrollTop>0;});assert.ok(await bottom());
    await page.$eval('#chat .overflow-y-auto',e=>{e.firstElementChild.style.height='2800px';});
    await page.waitForFunction(()=>{const e=document.querySelector('#chat .overflow-y-auto');return e.scrollHeight-e.scrollTop-e.clientHeight<2;});
    await page.$eval('#chat .overflow-y-auto',e=>{e.scrollTop=0;e.dispatchEvent(new Event('scroll',{bubbles:true}));});
    await page.$eval('#chat .overflow-y-auto',e=>{e.firstElementChild.style.height='3200px';});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    assert.equal(await page.$eval('#chat .overflow-y-auto',e=>e.scrollTop),0,'late media must not pull a reader away from older messages');
    await page.evaluate(()=>chat.setState({activeView:'workshop'}));
    await page.evaluate(()=>chat.setState({activeView:'chat'}));await page.waitForFunction(()=>{const e=document.querySelector('#chat .overflow-y-auto');return e.scrollTop>0;});assert.ok(await bottom());
    assert.deepEqual(errors,[]);
  } finally {await browser?.close();await new Promise(r=>server.close(r));}
});
