// Offline compatibility modal: registry reads and shared version command, no app bootstrap.
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'kunpeng-asset-candidates-'));
const evidence = path.join(root, 'docs/workspace-evidence');
const image = `data:image/jpeg;base64,${(await readFile(path.join(root, 'public/midjourney-styles/director/raw-flash-intimacy.jpg'))).toString('base64')}`;
const mocks = {
  '@/stores/workshopStore': 'export const useWorkshopStore=window.assetStore;',
  '@tauri-apps/api/tauri': `export const convertFileSrc=()=>${JSON.stringify(image)};`,
  '@tauri-apps/api/dialog': 'export const open=async()=>{throw Error("Upload is not allowed in this test");};',
  '@tauri-apps/api/fs': 'export const copyFile=async()=>{throw Error("Disk writes not allowed");};export const BaseDirectory={Home:0};',
  '@tauri-apps/api/path': 'export const homeDir=async()=>{throw Error("Home reads not allowed");};',
  viewer: 'export default ()=>null;', picker: 'export default ()=>null;',
};
let browser; let server;
try {
  const bundled = await build({ absWorkingDir:root,bundle:true,write:false,format:'esm',platform:'browser',jsx:'automatic',
    define:{'process.env.NODE_ENV':'"production"'},stdin:{resolveDir:root,loader:'tsx',contents:`
import {create} from 'zustand';
import {createRoot} from 'react-dom/client';
import {emptyWorkshopData} from './src/lib/workshop/types';
import {migrateWorkshopProjectObjects} from './src/lib/projectObjects/migrate';
import {initialWorkspaceDraft} from './src/lib/workspace/drafts';
import {receiveWorkspaceResult} from './src/lib/workspace/submissions';
import {selectProjectVersionCommand} from './src/lib/projectObjects/projectCommands';
let data=migrateWorkshopProjectObjects({...emptyWorkshopData('modal-fixture'),characters:[{id:'driver',name:'司机',appearance:'灰衣',personality:'',assetPrompt:'只改衣袖',assetImagePath:'/old.png'}]});
data=receiveWorkspaceResult(data,{submissionId:'mock',snapshot:initialWorkspaceDraft(data,'character:driver','image')},'mock-task',['/new.png']);
window.assetStore=create((set,get)=>({data,generateAsset:async()=>{throw Error('草稿缺少提示词，未提交生成');},
  selectAssetCandidate:(kind,id,path)=>{const current=get().data;const version=current.projectObjects.versions.find(v=>v.ownerObjectId==='character:'+id&&current.projectObjects.media.some(m=>m.id===v.mediaObjectId&&m.path===path));
    const next=selectProjectVersionCommand({workshop:current,canvas:{nodes:[],edges:[]}},'character:'+id,version.id);if(!next)throw Error('对象已锁定');set({data:next.workshop});},
  addAssetCandidate:()=>{throw Error('Uploads disabled');},setSceneSelectedImages:()=>{throw Error('Scene refs disabled');}}));
const {default:Modal}=await import('./src/components/workshop/AssetCandidatesModal');
createRoot(document.getElementById('root')).render(<Modal kind="character" id="driver" onClose={()=>{window.closedModal=true;}}/>);
`},plugins:[{name:'offline-modal',setup(b){
      b.onResolve({filter:/ImageFullscreenViewer$/},()=>({path:'viewer',namespace:'mock'}));
      b.onResolve({filter:/ArtifactPickerPanel$/},()=>({path:'picker',namespace:'mock'}));
      b.onResolve({filter:/^(@\/|@tauri-apps\/)/},args=>{
        if(mocks[args.path])return {path:args.path,namespace:'mock'};
        const base=path.join(root,'src',args.path.slice(2));
        const file=['.ts','.tsx','/index.ts','/index.tsx'].map(ext=>base+ext).find(existsSync);
        if(!file)throw Error('Unmocked import: '+args.path);return {path:file};
      });
      b.onLoad({filter:/.*/,namespace:'mock'},args=>({contents:mocks[args.path],loader:'tsx',resolveDir:root}));
    }}]});
  const cssFiles=(await readdir(path.join(root,'dist/assets'))).filter(name=>name.endsWith('.css'));
  let css='';for(const name of cssFiles)css+=await readFile(path.join(root,'dist/assets',name),'utf8');
  const html=`<html lang="zh-CN"><meta charset="utf-8"><style>${css}html,body,#root{margin:0;height:100%;background:#111;color:#eee}</style><div id="root"></div><script type="module">${bundled.outputFiles[0].text}</script></html>`;
  server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(html);});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  browser=await puppeteer.launch({executablePath:process.env.SMOKE_BROWSER_PATH||path.join(process.env.HOME,'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true,userDataDir:temp});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);page.on('request',req=>req.url().startsWith(url)||req.url().startsWith('data:')?req.continue():req.abort());
  await page.setViewport({width:1280,height:900});await page.goto(url);
  await page.waitForSelector('button[title^="generate"]', {visible:true});
  await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'phase2-legacy-asset-before-adopt.png')});
  assert.equal(await page.evaluate(()=>window.assetStore.getState().data.characters[0].candidates),undefined);
  assert.equal(await page.evaluate(()=>window.assetStore.getState().data.characters[0].assetImagePath),'/old.png');
  const candidateBounds=await page.$eval('button[title^="generate"]',el=>{const r=el.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height};});
  assert.ok(candidateBounds.width>0 && candidateBounds.height>0 && candidateBounds.y+candidateBounds.height<=900);
  await page.mouse.click(candidateBounds.x+candidateBounds.width/2,candidateBounds.y+candidateBounds.height/2);
  const clickText=text=>page.evaluate(text=>{const button=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text);if(!button)throw Error(text);button.click();},text);
  await clickText('设为最终图');await page.waitForFunction(()=>window.assetStore.getState().data.characters[0].assetImagePath==='/new.png');
  assert.equal(await page.evaluate(()=>window.assetStore.getState().data.projectObjects.versions.filter(v=>v.selected).length),1);
  await mkdir(evidence,{recursive:true});await page.screenshot({path:path.join(evidence,'phase2-legacy-asset-candidates.png')});
  await clickText('再生成候选');await page.waitForSelector('[role="alert"]');
  assert.match(await page.$eval('[role="alert"]',el=>el.textContent),/未提交生成/);
  assert.deepEqual(errors,[]);
  console.log('PASS: actual legacy asset modal reads registry-only candidates, shared adoption preserves prior version, regeneration errors remain visible. Offline, no provider or user data.');
} finally {
  await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});
}
