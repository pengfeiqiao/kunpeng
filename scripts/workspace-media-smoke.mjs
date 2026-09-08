// Real workspace components and project commands; provider, disk and Agent are explicit in-memory mocks.
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'kunpeng-media-flow-'));
const evidence = path.join(root, 'docs/workspace-evidence');
const image = `data:image/jpeg;base64,${(await readFile(path.join(root, 'public/midjourney-styles/director/raw-flash-intimacy.jpg'))).toString('base64')}`;
const bundled = await build({ absWorkingDir: root, bundle: true, write: false, outfile: path.join(temp, 'fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, stdin: { resolveDir: root, loader: 'tsx', contents: `
import { useState, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspaceMediaPanel from './src/components/workspace/WorkspaceMediaPanel';
import ProjectWorkspaceLayout from './src/components/workspace/ProjectWorkspaceLayout';
import ProjectContentList from './src/components/workspace/ProjectContentList';
import { emptyWorkshopData } from './src/lib/workshop/types';
import { migrateWorkshopProjectObjects } from './src/lib/projectObjects/migrate';
import { registerCanvasGeneration } from './src/lib/projectObjects/selectors';
import { selectProjectVersionCommand } from './src/lib/projectObjects/projectCommands';
import { saveWorkspaceDraft } from './src/lib/workspace/drafts';
import { workspaceSelection, selectWorkspaceObject } from './src/lib/workspace/contentModel';
import { submitWorkspaceGeneration } from './src/lib/workspace/generationCommand';
import { ConfirmationQueue } from './src/lib/agent/confirmationQueue';
const engines = [{ engine: { id: 'mock-image', label: '测试图片模型', kind: 'image', endpoint: 'mock', mode: 'image-to-image', imageParam: { key: 'images', multiple: true }, params: [
  { key:'aspectRatio', label:'比例', type:'list', options:['16:9','9:16'], default:'16:9' }
] } }];
let seed = migrateWorkshopProjectObjects({ ...emptyWorkshopData('offline-workspace'), imageModel: 'mock-image',
  characters: [{ id:'driver', name:'司机', appearance:'', personality:'', assetImagePath:'/driver.jpg' }],
  scenes: [{ id:'road', name:'雨夜公路', description:'', assetImagePath:'/road.jpg' }],
  shots: [
    { id:'a', shotNo:'01', description:'司机察觉异响', characterIds:['driver'], sceneId:'road', imagePrompt:'A 原始提示词', durationSec:8 },
    { id:'b', shotNo:'02', description:'转头看向右侧', characterIds:['driver'], sceneId:'road', imagePrompt:'B 原始提示词', durationSec:5 }
  ], projectViewState: { workspaceObjectId:'shot:a', workspaceOutputType:'image', workspaceComposerOpen:false }
}, 1);
// 本脚本用图片流程验证确认/取消契约，钉为 always-confirm；默认偏好下图片直出由 generationCommand 单测覆盖
seed.projectSpec = { ...seed.projectSpec, generationConfirmation: 'always-confirm' };
const first = registerCanvasGeneration(seed, {nodeId:'', taskId:'fixture-existing', paths:['/existing.jpg'], mediaType:'image', ownerObjectId:'shot:a', engineId:'mock-image', prompt:'历史提示词'}, 2);
seed = selectProjectVersionCommand({workshop:first.data,canvas:{nodes:[],edges:[]}}, 'shot:a', first.versionIds[0], 3).workshop;
function Fixture() {
  const [data, setData] = useState(seed);
  const current = useRef(data); current.current = data;
  const [confirmation, setConfirmation] = useState(null);
  const queue = useRef(null); if (!queue.current) queue.current = new ConfirmationQueue(state => setConfirmation(state.pending[0] || null));
  const [surface,setSurface] = useState('media');
  const [assistantState,setAssistantState] = useState('expanded');
  const publish = next => { current.current = next; setData(next); };
  window.flowData = data; window.flowCalls ||= [];
  const setView = patch => publish({...current.current,projectViewState:{...current.current.projectViewState,...patch}});
  const save = draft => { const next = saveWorkspaceDraft(current.current,draft,draft.revision); if (!next) return null; publish(next); return next.workspaceDrafts[draft.id]; };
  const selection = workspaceSelection(data);
  const generate = draft => submitWorkspaceGeneration({
    readProject: id => id === current.current.projectId ? current.current : null,
    publish: (before,after) => { if (before !== current.current) return false; publish(after); return true; },
    persist: async () => {},
    confirm: (snapshot,id,signal) => queue.current.request(snapshot,{signal}),
    bindTask: () => {},
    runGeneration: request => {
      window.flowCalls.push(request);
      const taskId = 'mock-task-' + window.flowCalls.length;
      request.onTaskCreated(taskId);
      return new Promise(resolve => { window.flowComplete = () => resolve({success:true,taskId,resultPaths:['/generated-' + taskId + '.jpg']}); });
    }
  }, draft, 'submit-' + crypto.randomUUID(), 'ask');
  return <ProjectWorkspaceLayout projectName="雨夜归途 · 离线验收" specSummary="16:9 · 写实电影" surface={surface} onSurface={setSurface}
    assistantState={assistantState} onAssistantState={setAssistantState} onBack={() => {}} onExport={() => {}} onSpec={() => {}}
    content={<ProjectContentList groups={selection.groups} selectedId={selection.selected?.id} mediaSrc={() => ${JSON.stringify(image)}}
      onSelect={id => publish({...current.current,projectViewState:selectWorkspaceObject(current.current,id)})} onAddToChat={ids => {window.flowReferences=ids;}} />}
    inspector={<WorkspaceMediaPanel data={data} engines={engines} mediaSrc={() => ${JSON.stringify(image)}} onSaveDraft={save} onGenerate={generate}
      onProductionTools={objectId => { window.flowProductionObject = objectId; }}
      onOptimize={(draft,template,signal) => new Promise(resolve => {window.flowOptimize = {draft,template}; window.flowOptimized = prompt => resolve(prompt);})}
      onViewState={setView} onAdopt={id => { const version=current.current.projectObjects.versions.find(v=>v.id===id); const next=selectProjectVersionCommand({workshop:current.current,canvas:{nodes:[],edges:[]}},version.ownerObjectId,id); if(next) publish(next.workshop); }}
      onAddToChat={(objectId,mediaId)=>{window.flowReferences=[objectId,mediaId];}} />}
    assistant={<div style={{padding:12}}><textarea aria-label="助手输入" defaultValue="保留人物关系" />
      {confirmation && <section aria-label="模拟确认"><p>{confirmation.payload.prompt}</p><button onClick={()=>queue.current.decide(confirmation.id,false)}>取消测试生成</button><button onClick={()=>queue.current.decide(confirmation.id,true)}>确认测试生成</button></section>}
    </div>} />;
}
createRoot(document.getElementById('root')).render(<Fixture />);` },
  plugins: [{ name:'source-alias', setup(build) { build.onResolve({filter:/^@\//}, ({path:id}) => { const base = path.join(root,'src',id.slice(2)); if (existsSync(base+'.ts')) return {path: base+'.ts'}; if (existsSync(base+'.tsx')) return {path: base+'.tsx'}; return {path: base+'/index.ts'}; }); } }],
});
const js = bundled.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundled.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = `<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>html,body,#root{margin:0;height:100%;background:#111;color:#eee}${css}</style><div id="root"></div><script>${js}</script></html>`;
const server = createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end(html);});
let browser;
try {
  await mkdir(evidence,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({executablePath:process.env.SMOKE_BROWSER_PATH || path.join(process.env.HOME,'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true,userDataDir:temp});
  const page = await browser.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request',req=>req.url().startsWith(url)||req.url().startsWith('data:')?req.continue():req.abort());
  await page.setViewport({width:1440,height:900}); await page.goto(url);
  const expandAll = async () => { for (let i = 0; i < 6; i++) { const n = await page.evaluate(() => { const heads = [...document.querySelectorAll('.workspace-group-heading[aria-expanded="false"]')]; heads.forEach((el) => el.click()); return heads.length; }); if (!n) break; } };
  await new Promise(r=>setTimeout(r,400)); await expandAll();
  const clickText = async text => page.evaluate(text => {const button=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text);if(!button)throw new Error('Missing '+text);button.click();},text);
  const open = async shot => page.click(`[aria-label="打开镜头 ${shot}"]`);
  const write = async text => {await page.$eval('[aria-label="完整提示词"]',el=>{el.focus();const sel=window.getSelection();sel.selectAllChildren(el);});await page.type('[aria-label="完整提示词"]',text);};
  const readPrompt = () => page.$eval('[aria-label="完整提示词"]',el=>el.value ?? el.innerText);
  await page.waitForSelector('[aria-label="媒体预览器"]');
  await clickText('配音与配色');
  assert.equal(await page.evaluate(()=>window.flowProductionObject),'shot:a');
  assert.equal(await page.evaluate(()=>window.flowCalls.length),0,'opening production tools must not generate');
  await clickText('提示词'); await write('A 保存后的提示词');
  await open('02'); await write('B 保存后的提示词'); await open('01');
  assert.equal(await readPrompt(),'A 保存后的提示词');
  // 经典版/新版优化仅保留在视频提示词：切到视频 Tab 再测迟到结果归属与冲突保护
  await page.click('.workspace-output-tabs button:first-child');
  await page.waitForSelector('[aria-label="优化提示词"]');
  await page.select('[aria-label="优化提示词"]','universal');
  await page.waitForFunction(()=>window.flowOptimize?.draft.objectId==='shot:a');
  await open('02'); await page.evaluate(()=>window.flowOptimized('A 优化返回'));
  await page.waitForFunction(()=>window.flowData.workspaceDrafts['shot:a::video']?.prompt==='A 优化返回');
  assert.notEqual(await readPrompt(),'A 优化返回','late result must not land on shot B');
  await open('01'); await page.select('[aria-label="优化提示词"]','legacy'); await write('A 人工新改动');
  await page.evaluate(()=>window.flowOptimized('A 迟到旧结果'));
  await page.waitForFunction(()=>document.body.textContent.includes('未覆盖现有草稿'));
  assert.equal(await readPrompt(),'A 人工新改动');
  await page.click('.workspace-output-tabs button:nth-child(2)');
  await page.waitForFunction(()=>!document.querySelector('[aria-label="优化提示词"]'),{});
  assert.equal(await readPrompt(),'A 保存后的提示词');
  await write('A 最终生成提示词'); await clickText('生成');
  await page.waitForSelector('[aria-label="模拟确认"]');
  assert.equal(await page.evaluate(()=>window.flowCalls.length),0);
  await clickText('取消测试生成'); await page.waitForFunction(()=>!document.querySelector('[aria-label="模拟确认"]'));
  assert.equal(await page.evaluate(()=>window.flowCalls.length),0);
  await clickText('生成'); await page.waitForSelector('[aria-label="模拟确认"]'); await clickText('确认测试生成');
  await page.waitForFunction(()=>window.flowCalls.length===1); await open('02'); await page.evaluate(()=>window.flowComplete());
  await page.waitForFunction(()=>window.flowData.projectObjects.versions.some(v=>v.generationSnapshot));
  assert.equal(await readPrompt(),'B 保存后的提示词');
  const outcome = await page.evaluate(()=>{
    const v=window.flowData.projectObjects.versions.find(v=>v.generationSnapshot);
    return {owner:v.ownerObjectId,selected:v.selected,prompt:v.generationSnapshot.prompt,path:window.flowData.shots[0].imagePath,calls:window.flowCalls.length};
  });
  assert.deepEqual(outcome,{owner:'shot:a',selected:false,prompt:'A 最终生成提示词',path:'/existing.jpg',calls:1});
  await open('01'); await page.click('[aria-label="收起提示词"]'); await page.click('[aria-label="查看v2候选"]'); await clickText('采用此版');
  await page.waitForFunction(()=>window.flowData.shots[0].imagePath==='/generated-mock-task-1.jpg');
  assert.equal(await page.$$eval('.workspace-version-strip button',buttons=>buttons.length),2,'adoption and migration must not create duplicate versions');
  await page.screenshot({path:path.join(evidence,'phase1-media-flow-1440.png')});
  await clickText('提示词'); await page.click('[aria-label="添加参考素材"]'); await page.waitForSelector('[aria-label="选择本次参考素材"]');
  await page.click('[aria-label="关闭参考选择"]');
  await page.keyboard.down('Meta'); await page.click('[aria-label="打开镜头 01"]'); await page.click('[aria-label="打开镜头 02"]'); await page.keyboard.up('Meta');
  await page.click('[aria-label="批量添加到对话"]');
  assert.deepEqual(await page.evaluate(()=>window.flowReferences),['shot:a','shot:b']);
  assert.deepEqual(errors,[]);
  console.log('PASS: object draft switching, late optimization targeting/conflicts, confirmation cancellation, one mock submission, candidate return, adoption, reference picker, batch references. No provider or disk writes.');
} finally { if(browser)await browser.close(); await new Promise(resolve=>server.close(resolve)); await rm(temp,{recursive:true,force:true}); }
