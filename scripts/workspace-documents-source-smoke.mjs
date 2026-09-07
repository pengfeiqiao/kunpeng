// Isolated production components + local document adapter; all filesystem/dialog/store ports are fixtures.
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const profile = await mkdtemp(path.join(tmpdir(), 'kunpeng-documents-fixture-'));
const evidence = path.join(root, 'docs/workspace-evidence');
const mocks = {
  '@tauri-apps/api/fs': `export const BaseDirectory={Home:0};export const readTextFile=async p=>{if(!(p in window.files))throw Error('fixture file missing');return window.files[p];};export const writeTextFile=async(p,b)=>{window.writes.push([p,b]);if(window.writeGate)await window.writeGate;window.files[p]=b;};export const createDir=async()=>{};export const renameFile=async()=>{};export const removeFile=async p=>{delete window.files[p];};export const removeDir=async()=>{};export const exists=async p=>{const s=String(p);const d=s.endsWith('/')?s:s+'/';return p in window.files||Object.keys(window.files).some(k=>k.startsWith(d));};export const readDir=async p=>{const s=String(p);const prefix=s.endsWith('/')?s:s+'/';return Object.keys(window.files).filter(k=>k.startsWith(prefix)&&!k.slice(prefix.length).includes('/')).map(k=>({name:k.slice(prefix.length)}));};`,
  '@tauri-apps/api/path': `export const homeDir=async()=>'/fixture/';`,
  '@tauri-apps/api/dialog': `export const open=async()=>'/fixture/import.md';export const save=async()=>'/fixture/export.md';`,
  '@tauri-apps/api/shell': `export const open=async p=>{window.opened=p;};`,
  workshop: `export const useWorkshopStore=s=>window.workshopFixture(s);useWorkshopStore.getState=()=>window.workshopFixture.getState();`,
  skills: `export const useSkillStore=s=>window.skillFixture(s);useSkillStore.getState=()=>window.skillFixture.getState();`,
  editor: `export const useEditorStore=s=>window.editorFixture(s);useEditorStore.getState=()=>window.editorFixture.getState();`,
  hydration: `export const getEditorHydrationState=()=>({status:window.hydrationReady?'ready':'loading',projectId:window.active,activeProjectId:window.active});`,
};
let browser; let server;
try {
  const bundle = await build({ absWorkingDir: root, bundle: true, write: false, outdir: 'fixture', format: 'esm', platform: 'browser', jsx: 'automatic',
    define: { 'process.env.NODE_ENV': '"production"' }, stdin: { loader: 'tsx', resolveDir: root, contents: `
import React, {useState} from 'react';
import {createRoot} from 'react-dom/client';
import {create} from 'zustand';
import Documents from './src/components/workspace/WorkspaceDocuments';
import Source from './src/components/workspace/WorkspaceTimelineSource';
import {WorkspaceDocumentDrafts} from './src/lib/workspace/documents';
import {useWorkspaceDocuments} from './src/lib/workspace/useWorkspaceDocuments';
import {useWorkspaceTimelineSource,readWorkspaceTimelineSourceContext} from './src/lib/workspace/useWorkspaceTimelineSource';
import {validateTimelineInspectorRequest} from './src/lib/workspace/timelineSource';
import {patchProjectSpec} from './src/lib/projectObjects/projectSpec';
import {emptyWorkshopData} from './src/lib/workshop/types';
import {migrateWorkshopProjectObjects} from './src/lib/projectObjects/migrate';
window.files={'.kunpeng/aigc-memory/projects/a/sources/original.md':'原剧本逐字内容：司机停下车。','.kunpeng/aigc-memory/projects/a/docs/讨论纪要.md':'# 讨论纪要\\n保持写实。',
  '.kunpeng/aigc-memory/projects/b/sources/original.md':'B项目原剧本。','/fixture/skill/SKILL.md':'---\\nname: fixture\\n---\\n\\n保持人物关系。','/fixture/import.md':'# 导入规则\\n不改变对白。'};
window.writes=[];window.requests=[];window.accepted=[];window.active='a';window.specCommits=0;window.hydrationReady=true;
const source={name:'original.md',type:'md',size:0,uploadedAt:1};
window.skills=[{id:'fixture',name:'连续性 Skill',description:'规则',version:'1',icon:'file-text',hasPanel:false,promptTemplate:'保持人物关系。',source:'user',skillPath:'/fixture/skill',visibility:'library'}];
window.specs={a:{revision:1,updatedAt:1,aspectRatio:'16:9',generationConfirmation:'paid-only-confirm'},b:{revision:1,updatedAt:1,aspectRatio:'9:16',generationConfirmation:'paid-only-confirm'}};
const drafts=new WorkspaceDocumentDrafts();
const data=migrateWorkshopProjectObjects({...emptyWorkshopData('a'),shots:[{id:'one',shotNo:'01',description:'原镜头',characterIds:[],videoPath:'/original-v1.mp4'}]},1);
const media=data.projectObjects.media.find(m=>m.path==='/original-v1.mp4');const old=data.projectObjects.versions.find(v=>v.mediaObjectId===media.id);old.selected=false;
data.projectObjects.media.push({...media,id:'new',path:'/new-v2.mp4'});data.projectObjects.versions.push({...old,id:'v2',mediaObjectId:'new',ordinal:2,selected:true});data.shots[0].videoPath='/new-v2.mp4';
window.data=data;window.clip={id:'clip',path:'/original-v1.mp4'};
window.workshopFixture=create((set,get)=>({project:{id:'a',sources:[source]},data:{...data,projectSpec:window.specs.a},
  updateProjectSpec:patch=>{const pid=get().project.id;const saved=patchProjectSpec(get().data.projectSpec,patch);window.specs[pid]=saved;set({data:{...get().data,projectSpec:saved}});},
  commitNow:async options=>{if(!options.requireSuccess)throw Error('missing strict save');window.specCommits++;}}));
window.skillFixture=create((set)=>({skills:window.skills,loaded:true,loadAllSkills:async()=>{
  for(const [p,body]of Object.entries(window.files))if(p.endsWith('/skill.json')){const m=JSON.parse(body);if(!window.skills.some(s=>s.id===m.id))window.skills.push({...m,source:'user',skillPath:p.slice(0,-11),promptTemplate:window.files[p.slice(0,-10)+'SKILL.md']});}
  set({skills:[...window.skills],loaded:true});}}));
window.editorFixture=create(()=>({clips:[window.clip],overlayClips:[],audioClips:[],selectedClipId:'clip',selectedOverlayId:null,selectedAudioClipId:null}));
window.readLiveSource=()=>readWorkspaceTimelineSourceContext('a','main','clip');
window.addEventListener('kunpeng:workspace-inspector-request',e=>{window.requests.push(e.detail);const c=readWorkspaceTimelineSourceContext(window.active,e.detail.clipKind,e.detail.clipId);if(c)window.accepted.push(validateTimelineInspectorRequest(c.data,c.editorProjectId,c.clip,e.detail));});
function Fixture(){const[pid,setPid]=useState('a');const[shown,setShown]=useState(true);const documentProps=useWorkspaceDocuments(pid);const sourceProps=useWorkspaceTimelineSource(pid);
  window.switchProject=p=>{window.active=p;window.workshopFixture.setState({project:{id:p,sources:[source]},data:{...(p==='a'?data:emptyWorkshopData('b')),projectSpec:window.specs[p]}});setPid(p);};window.toggle=()=>setShown(v=>!v);
  return <div style={{height:'100vh',display:'grid',gridTemplateRows:'minmax(0,1fr) auto'}}>{shown&&documentProps?<Documents {...documentProps} drafts={drafts}/>:<div>其他工作面</div>}
  {sourceProps&&<Source {...sourceProps}/>}</div>;}
createRoot(document.getElementById('root')).render(<Fixture/>);
` }, plugins: [{ name: 'offline', setup(build) {
      build.onResolve({ filter: /^@tauri-apps\/api\// }, (args) => ({ path: args.path, namespace: 'fixture' }));
      build.onResolve({ filter: /stores\/workshopStore$/ }, () => ({ path: 'workshop', namespace: 'fixture' }));
      build.onResolve({ filter: /stores\/skillStore$/ }, () => ({ path: 'skills', namespace: 'fixture' }));
      build.onResolve({ filter: /stores\/editorStore$/ }, () => ({ path: 'editor', namespace: 'fixture' }));
      build.onResolve({ filter: /editor\/editorPersist$/ }, () => ({ path: 'hydration', namespace: 'fixture' }));
      build.onLoad({ filter: /.*/, namespace: 'fixture' }, (args) => ({ contents: mocks[args.path] || 'throw Error("unmocked port")', loader: 'js' }));
    } }] });
  const js = bundle.outputFiles.find((file) => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).text;
  server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(`<html lang="zh-CN"><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;background:#202224;color:#eee}${css}</style><div id="root"></div><script type="module">${js}</script></html>`); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.SMOKE_BROWSER_PATH || path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), headless: true, userDataDir: profile });
  const page = await browser.newPage(); const errors = [];
  page.on('pageerror', (error) => errors.push(error.message)); page.on('dialog', (dialog) => dialog.accept());
  await page.setRequestInterception(true);
  page.on('request', (request) => request.url().startsWith(url) ? request.continue() : request.abort());
  await page.setViewport({ width: 1280, height: 900 }); await page.goto(url);
  const click = (label) => page.evaluate((label) => {
    const button = [...document.querySelectorAll('button')].find((el) => el.getAttribute('aria-label') === label || el.textContent.trim() === label);
    if (!button) throw Error(`missing button: ${label}`); button.click();
  }, label);
  const fill = async (selector, value) => {
    await page.waitForSelector(selector); await page.$eval(selector, (el, value) => {
      const prototype = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(prototype, 'value').set.call(el, value); el.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  };
  await page.waitForFunction(() => document.querySelector('.workspace-document-reader')?.textContent.includes('司机停下车'));
  await click('编辑'); await fill('[aria-label="文档正文"]', 'A 未保存原稿');
  await page.evaluate(() => window.switchProject('b'));
  await page.waitForFunction(() => document.querySelector('.workspace-document-reader')?.textContent === 'B项目原剧本。');
  await page.evaluate(() => window.switchProject('a'));
  await page.waitForFunction(() => document.querySelector('[aria-label="文档正文"]')?.value === 'A 未保存原稿');
  await page.evaluate(() => window.toggle()); await page.waitForSelector('.workspace-documents', { hidden: true });
  await page.evaluate(() => window.toggle()); await page.waitForFunction(() => document.querySelector('[aria-label="文档正文"]')?.value === 'A 未保存原稿');
  await page.evaluate(() => { window.writeGate = new Promise(resolve => { window.finishWrite = resolve; }); });
  await click('保存原文'); await page.waitForFunction(() => window.writes.length === 1);
  await fill('[aria-label="文档正文"]', 'A 保存中继续输入');
  await page.evaluate(() => window.switchProject('b'));
  await page.evaluate(() => { window.finishWrite(); window.writeGate = null; });
  await page.waitForFunction(() => window.files['.kunpeng/aigc-memory/projects/a/sources/original.md'] === 'A 未保存原稿');
  assert.equal(await page.evaluate(() => window.files['.kunpeng/aigc-memory/projects/b/sources/original.md']), 'B项目原剧本。');
  await page.evaluate(() => window.switchProject('a'));
  await page.waitForFunction(() => document.querySelector('[aria-label="文档正文"]')?.value === 'A 保存中继续输入');
  await click('规格与创作规则'); await page.waitForSelector('.workspace-document-spec'); await click('编辑');
  await fill('#document-spec-forbidden', '禁止改写对白'); await click('保存原文');
  await page.waitForFunction(() => window.specCommits === 1 && !document.querySelector('.workspace-document-dirty'));
  assert.deepEqual(await page.evaluate(() => window.specs.a.forbidden), ['禁止改写对白']);
  // 文档页只承载项目内容：Skill 区已移除，项目文档（docs/*.md）可读可写
  assert.equal(await page.evaluate(() => document.querySelectorAll('.workspace-document-skill').length), 0);
  await click('讨论纪要.md'); await page.waitForFunction(() => document.querySelector('.workspace-document-reader')?.textContent.includes('保持写实'));
  await click('编辑'); await fill('[aria-label="文档正文"]', '# 讨论纪要\\n改用手持。'); await click('保存原文');
  await page.waitForFunction(() => window.files['.kunpeng/aigc-memory/projects/a/docs/讨论纪要.md'] === '# 讨论纪要\\n改用手持。');
  await click('去修改素材'); await page.waitForFunction(() => window.requests.length === 1);
  assert.equal(await page.evaluate(() => window.accepted[0]?.mediaId === window.requests[0].mediaId), true);
  assert.equal(await page.evaluate(() => {window.hydrationReady=false;const result=window.readLiveSource();window.hydrationReady=true;return result;}), null);
  assert.equal(await page.evaluate(() => window.requests[0].path), '/original-v1.mp4');
  assert.equal(await page.evaluate(() => window.clip.path), '/original-v1.mp4');
  await mkdir(evidence, { recursive: true });
  for (const width of [1440, 1280, 1024, 390]) {
    await page.setViewport({ width, height: 900 });
    await page.screenshot({ path: path.join(evidence, `phase3-documents-source-${width}.png`) });
    const overflow = await page.evaluate(() => [...document.querySelectorAll('.workspace-document-actions button,.workspace-timeline-source button')].some(el => { const r=el.getBoundingClientRect();return r.left<0||r.right>innerWidth; }));
    assert.equal(overflow, false, `toolbar overflow at ${width}`);
    assert.equal(await page.$eval('.workspace-documents', el => getComputedStyle(el).fontSize), '13px');
  }
  assert.deepEqual(errors, []);
  console.log('PASS: actual production hooks + document store adapter + local adapter; original file read/write; A/B + unmount draft retention; delayed save isolation; updateProjectSpec + strict commit; project docs read/write; no Skill section; v1 source live-read validation + hydration gate; 1440/1280/1024/390. Stores/filesystem/dialogs are offline fixtures.');
} finally {
  if (browser) {
    const forceClose = setTimeout(() => browser.process()?.kill('SIGKILL'), 10_000);
    try { await browser.close(); } finally { clearTimeout(forceClose); }
  }
  if (server) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
  await rm(profile, { recursive: true, force: true });
}
