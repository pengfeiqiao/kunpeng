// Production project container. Store persistence, Agent transport and canvasGen are offline ports.
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import { readFile, readdir, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const preview = process.argv.includes('--serve');
const temp = await mkdtemp(path.join(tmpdir(), 'kunpeng-workspace-project-'));
const evidence = path.join(root, 'docs/workspace-evidence');
const image = `data:image/jpeg;base64,${(await readFile(path.join(root, 'public/midjourney-styles/director/raw-flash-intimacy.jpg'))).toString('base64')}`;
const mocks = {
  '@/lib/workspace/useWorkspaceDocuments': 'export const useWorkspaceDocuments = () => null;',
  '@/lib/workspace/useWorkspaceTimelineSource': 'export const readWorkspaceTimelineSourceContext = () => null;',
  '@/lib/canvas/generationDraftPreview': 'export const buildCanvasGenerationDraft = () => null;',
  '@tauri-apps/api/dialog': 'export const open=async()=>[];export const confirm=async()=>false;export const message=async()=>{};export const ask=async()=>false;',
  '@tauri-apps/api/fs': 'export const BaseDirectory={Home:0};export const readTextFile=async()=>{throw Error("离线无文件")};export const writeTextFile=async()=>{};export const createDir=async()=>{};export const exists=async()=>false;export const readDir=async()=>[];export const renameFile=async()=>{};export const removeFile=async()=>{};export const removeDir=async()=>{};export const copyFile=async()=>{};export const writeBinaryFile=async()=>{};export const readBinaryFile=async()=>new Uint8Array();',
  '@tauri-apps/api/shell': 'export const open=async()=>{};export const Command=class{static create(){return {execute:async()=>({code:0,stdout:"",stderr:""})};}};',
  '@tauri-apps/api/http': 'export const fetch=async()=>{throw Error("离线无网络")};export const ResponseType={JSON:2,Text:1,Binary:3};export const Body={json:v=>({type:"Json",payload:v}),text:v=>({type:"Text",payload:v})};',
  '@tauri-apps/api/window': 'export const appWindow={listen:async()=>()=>{},emit:async()=>{}};export const getCurrent=()=>({listen:async()=>()=>{},emit:async()=>{}});',
  '@tauri-apps/api/event': 'export const listen=async()=>()=>{};export const emit=async()=>{};',
  '@/components/canvas/ArtifactPickerPanel': 'export default () => null;',
  '@/components/canvas/AssetLibraryPanel': 'export default () => null;',
  '@tauri-apps/api/path': 'export const homeDir=async()=>"/offline-demo/";',
  '@/components/workspace/WorkspaceEditorSurface': 'export default () => <div aria-label="剪辑工作面测试">剪辑</div>;',
  './WorkspaceScriptTools': 'export default ({onClose}) => <div aria-label="剧本工具测试"><button onClick={onClose}>关闭剧本工具</button></div>;',
  './WorkspaceProductionTools': 'export default ({onClose}) => <div aria-label="资产工具测试"><button onClick={onClose}>关闭资产工具</button></div>;',
  './WorkspaceCanvasSurface': 'export default () => <div aria-label="对象画布测试">画布</div>;',
  '@/lib/workspace/useWorkspaceCanvasLayout': `import { useState } from 'react'; export const useWorkspaceCanvasLayout = projectId => { const [layout,setLayout]=useState({schemaVersion:1,projectId,positions:{},nextSlot:0}); return {layout,save:next=>{window.projectCanvasLayout=next;setLayout(next);return true;}}; };`,
  '@/components/Settings': 'export default ({onClose}) => <div role="dialog" aria-label="渠道设置测试"><button onClick={onClose}>关闭渠道设置测试</button></div>;',
  '@/lib/workspace/useWorkspaceServices': 'export const useWorkspaceServices = () => ({capabilities:{gpt:window.projectGpt!==false,apimart:true,runninghub:true,kuaizi:true,ark:true,seedanceChannel:"kuaizi"},estimate:async draft=>{window.projectPriceDraft=draft;return {label:"RunningHub 预估 CNY 1.2",detail:"离线报价替身"};}});',
  '@/stores': 'export const useChatStore = window.projectPorts.chat;',
  '@/stores/workshopStore': 'export const useWorkshopStore = window.projectPorts.workshop;',
  '@/stores/unifiedProjectStore': 'export const useUnifiedProjectStore = window.projectPorts.unified;',
  '@/lib/workspace/runtime': 'export const updateWorkspaceDraft = (...args) => window.projectPorts.save(...args); export const generateWorkspaceDraft = (...args) => window.projectPorts.generate(...args); export const applyWorkspaceProjectCommand = (...args) => window.projectPorts.command(...args);',
  '@/lib/workspace/professionalCanvasRuntime': 'export const assignProfessionalCanvasMedia=(...args)=>window.projectPorts.assign(...args);',
  '@/lib/workspace/optimize': 'export const optimizeWorkspacePrompt = (...args) => window.projectPorts.optimize(...args); export const restyleWorkspacePrompt = (...args) => window.projectPorts.optimize(...args);',
  '@/components/projects/ProjectTopBar': 'export const SpecEditor = () => <div role="dialog" aria-label="规格测试">规格测试</div>;',
  '@/components/projects/ProjectSnapshotPanel': 'export default ({onClose}) => <div role="dialog" aria-label="快照测试"><button onClick={onClose}>关闭快照测试</button></div>;',
  '@/components/workshop/WorkshopChatPanel': 'export default () => <textarea aria-label="助手保留输入" defaultValue="保留上下文" />;',
  '@/components/editor/ExportDialog': 'export default () => <div role="dialog" aria-label="导出测试">导出测试</div>;',
  '@tauri-apps/api/tauri': `export const convertFileSrc = () => ${JSON.stringify(image)}; export const invoke = async () => { throw new Error('离线测试版不执行本机命令'); };`,
};
if (preview) {
  delete mocks['@/components/workshop/WorkshopChatPanel'];
  Object.assign(mocks, {
    '@/stores/chatStore': 'export const useChatStore = window.projectPorts.chat;',
    '@/stores/settingsStore': 'export const useSettingsStore = window.projectPorts.settings;',
    '@/stores/runStepStore': 'export const useRunStepStore = window.projectPorts.runs;',
    '@/stores/askUserStore': 'export const useAskUserStore = window.projectPorts.decisions;',
    '@/hooks/useSound': 'export const useSound = () => ({playNotification:()=>{}});',
    '@/lib/greeting': 'export const useHelloGreeting=()=>"继续创作";',
    '@/lib/projectSessions': 'export const ensureProjectSession=async()=>{};',
  });
}
const bundled = await build({ absWorkingDir: root, bundle: true, write: false, outfile: path.join(temp, 'fixture.js'), format: 'esm', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, stdin: { resolveDir: root, loader: 'tsx', contents: `
import { create } from 'zustand';
import { createRoot } from 'react-dom/client';
import { emptyWorkshopData } from './src/lib/workshop/types';
import { migrateWorkshopProjectObjects } from './src/lib/projectObjects/migrate';
import { registerCanvasGeneration } from './src/lib/projectObjects/selectors';
import { selectProjectVersionCommand, deleteProjectObjectCommand } from './src/lib/projectObjects/projectCommands';
import { saveWorkspaceDraft } from './src/lib/workspace/drafts';
import { editWorkspaceShot } from './src/lib/workspace/shotEdits';
import { editWorkspaceAssetPrompt } from './src/lib/workspace/assetEdits';
import { assignProfessionalCanvasMediaCommand } from './src/lib/workspace/professionalCanvasOwnership';
import { submitWorkspaceGeneration } from './src/lib/workspace/generationCommand';
const preview=${preview};
let data = migrateWorkshopProjectObjects({ ...emptyWorkshopData('production-fixture'), imageModel:'gpt-image-2',
  characters:[{id:'driver',name:'司机',appearance:'',personality:'',assetImagePath:'/driver.jpg',assetPrompt:'司机普通提示词',assetPromptMj:'cinematic driver'}],
  scenes:[{id:'road',name:'雨夜公路',description:'',assetImagePath:'/road.jpg'}],
  shots:[{id:'a',shotNo:'01',description:'司机察觉异响',characterIds:['driver'],sceneId:'road',imagePrompt:'A 原始提示词',durationSec:8},
    {id:'b',shotNo:'02',description:'转头',characterIds:['driver'],sceneId:'road',imagePrompt:'B 原始提示词',imagePath:'/legacy-b.jpg',durationSec:5}],
  projectViewState:{workspaceObjectId:'shot:a',workspaceOutputType:'image'}
},1);
const first = registerCanvasGeneration(data,{nodeId:'',taskId:'existing',paths:['/existing.jpg'],mediaType:'image',ownerObjectId:'shot:a',engineId:'gpt-image-2',prompt:'历史提示词'},2);
data = selectProjectVersionCommand({workshop:first.data,canvas:{nodes:[],edges:[]}},'shot:a',first.versionIds[0],3).workshop;
const workshop = create((set,get)=>({data,project:{id:data.projectId,name:'雨夜归途 · 真实容器离线验收'},
  updateProjectViewState:patch=>set({data:{...get().data,projectViewState:{...get().data.projectViewState,...patch}}}),
  updateProjectSpec:patch=>set({data:{...get().data,projectSpec:{...get().data.projectSpec,...patch}}})}));
const chat = create(set=>({sessions:[{id:'project-session',projectId:data.projectId}],messages:[],currentSessionId:'project-session',activeView:'workshop',streamingPhase:'idle',isStreaming:false,streamingContent:'',streamingThinkingContent:'',error:null,setActiveView:activeView=>set({activeView})}));
const unified = create((set,get)=>({activeId:data.projectId,recentChangeSets:[],pendingConflicts:[],closeUnified:async()=>set({activeId:null}),
  deleteProjectObject:owner=>{const next=deleteProjectObjectCommand({workshop:workshop.getState().data,canvas:{nodes:[],edges:[]}},owner);if(!next)return false;workshop.setState({data:next.workshop});return true;},
  selectProjectAssetVersion:(owner,id)=>{const next=selectProjectVersionCommand({workshop:workshop.getState().data,canvas:{nodes:[],edges:[]}},owner,id);if(!next)return false;workshop.setState({data:next.workshop});return true;}}));
const current = () => workshop.getState().data;
window.projectLegacyPromptEdit = (shotNo,prompt) => workshop.setState({data:editWorkspaceShot(current(),shotNo,{imagePrompt:prompt})});
window.projectLegacyVideoSettings = (shotNo,patch) => workshop.setState({data:editWorkspaceShot(current(),shotNo,patch)});
window.projectLegacyAssetEdit = prompt => workshop.setState({data:editWorkspaceAssetPrompt(current(),'character','driver',prompt,'mj')});
window.projectAddCharacter = () => workshop.setState({data:migrateWorkshopProjectObjects({...current(),characters:[...current().characters,{id:'new',name:'新角色',appearance:'演示角色',personality:''}]})});
window.projectScale = () => {
 const many = Array.from({length:100},(_,i)=>({id:'scale-'+i,shotNo:String(i+1).padStart(3,'0'),sceneId:'road',description:'司机观察路况 '+(i+1),characterIds:['driver'],durationSec:8,imagePath:'/scale-'+i+'.jpg'}));
 let next=migrateWorkshopProjectObjects({...current(),shots:many,projectViewState:{...current().projectViewState,workspaceObjectId:'shot:scale-0',workspaceOutputType:'image',workspaceMediaView:'list',workspaceComposerOpen:false}});
 for(let i=0;i<100;i++) next=registerCanvasGeneration(next,{nodeId:'',taskId:'scale-task-'+i,paths:Array.from({length:4},(_,v)=>'/scale-'+i+'-v'+v+'.jpg'),mediaType:'image',ownerObjectId:'shot:scale-'+i,engineId:'gpt-image-2',prompt:'离线多版本压力样本'},i+100).data;
 workshop.setState({data:next});
};
window.projectCalls=[];
window.projectPorts={workshop,chat,unified,
  assign:(projectId,input)=>{if(projectId!==current().projectId)throw new Error('项目已切换');const result=assignProfessionalCanvasMediaCommand({workshop:current(),canvas:{nodes:[],edges:[]}},input);workshop.setState({data:result.workshop});},
  settings:create(()=>({toolConfirmMode:'ask',setToolConfirmMode:()=>{}})),decisions:create(()=>({pending:null,history:[],queue:[]})),
  runs:create(()=>({runsById:{},runIdsBySession:{'project-session':[]},currentRunId:null})),
  command:(projectId,command)=>{if(current().projectId!==projectId)return false;const next=command(current());if(!next)return false;workshop.setState({data:next});return true;},
  save:draft=>{const next=saveWorkspaceDraft(current(),draft,draft.revision);if(!next)return null;workshop.setState({data:next});return next.workspaceDrafts[draft.id];},
  optimize:(draft,template,signal)=>new Promise(resolve=>{window.projectOptimize={draft,template};window.projectOptimized=resolve;if(preview)setTimeout(()=>resolve(draft.prompt),300);}),
  generate:draft=>submitWorkspaceGeneration({readProject:id=>id===current().projectId?current():null,
    publish:(before,after)=>{if(before!==current())return false;workshop.setState({data:after});return true;},persist:async()=>{},bindTask:()=>{},
    confirm:snapshot=>preview?window.previewConfirm(snapshot):new Promise(resolve=>{window.projectConfirmation={snapshot,resolve};}),
    runGeneration:request=>{window.projectCalls.push(request);const taskId='task-'+window.projectCalls.length;request.onTaskCreated(taskId);return new Promise(resolve=>{window.projectComplete=()=>resolve({success:true,taskId,resultPaths:[preview?'/demo-result-'+taskId+'.jpg':['/new.jpg','/constraint-new.jpg','/new-canvas.jpg','/unclassified.jpg'][window.projectCalls.length-1]],resultUrls:[]});if(preview)setTimeout(window.projectComplete,900);});}
  },draft,'submission-'+crypto.randomUUID(),'ask')};
window.addEventListener('kunpeng-project-agent-context',event=>{window.projectReferences=event.detail.references;});
const {default:ProjectWorkspace}=await import('./src/components/workspace/ProjectWorkspace');
let PreviewConfirmation=()=>null;
if(preview){
 const {useToolConfirmStore}=await import('./src/stores/toolConfirmStore');
 const {ToolConfirmDialog}=await import('./src/components/ToolConfirmDialog');PreviewConfirmation=ToolConfirmDialog;
 window.previewConfirm=snapshot=>useToolConfirmStore.getState().requestConfirm('image_generate',{prompt:snapshot.prompt,engine:snapshot.engineId,reference_urls:snapshot.references.map(r=>r.path),params:snapshot.params},'离线测试：确认后只返回本地样本，不联网、不扣费',{scope:'preview',risk:'ask'});
}
const send=async content=>{
 chat.setState(s=>({messages:[...s.messages,{id:crypto.randomUUID(),role:'user',content,timestamp:Date.now()}],isStreaming:true,streamingPhase:'thinking'}));
 await new Promise(resolve=>setTimeout(resolve,600));
 chat.setState(s=>({isStreaming:false,streamingPhase:'idle',messages:[...s.messages,{id:crypto.randomUUID(),role:'assistant',content:'这是离线界面测试，未调用模型、未修改项目内容。你可以继续切换镜头、编辑提示词、预览版本或测试生成确认。',timestamp:Date.now()}]}));
};
function Fixture(){return <><ProjectWorkspace onSendMessage={preview?send:()=>{}} onAbort={()=>chat.setState({isStreaming:false,streamingPhase:'idle'})} onLegacy={()=>{window.projectLegacy=true;}} /><PreviewConfirmation/></>}
createRoot(document.getElementById('root')).render(<Fixture />);
` }, plugins: [{ name: 'offline-ports', setup(b) {
    b.onResolve({ filter: /^(@\/|@tauri-apps\/)/ }, (args) => {
      if (mocks[args.path]) return { path: args.path, namespace: 'mock' };
      const base = path.join(root, 'src', args.path.slice(2));
      const file = ['.ts', '.tsx', '/index.ts', '/index.tsx'].map(ext=>base+ext).find(existsSync);
      if (!file) throw new Error('Unmocked dependency: '+args.path+' <- '+args.importer);
      return { path: file };
    });
    b.onLoad({ filter: /.*/, namespace: 'mock' }, args=>({ contents: mocks[args.path], loader:'tsx', resolveDir:root }));
    b.onResolve({ filter: /(?:ProjectSessionSwitcher|ArtifactPickerPanel|WorkspaceAgentModelPicker|AskUserDialog|ContextUsagePill|ProjectChangeReview|ProjectConversationContext)$/ }, args => preview ? ({path:args.path,namespace:'preview-child'}) : undefined);
    b.onResolve({ filter: /(?:WorkspaceScriptTools|WorkspaceProductionTools|WorkspaceCanvasSurface)$/ }, args => args.importer.includes('ProjectWorkspace') ? ({ path: args.path, namespace: 'mock' }) : undefined);
    b.onLoad({filter:/.*/,namespace:'preview-child'},args=>({contents:args.path.endsWith('WorkspaceAgentModelPicker')?'export default () => <button disabled>离线模型</button>;':args.path.endsWith('AskUserDialog')?'export const AskUserDecisionCard=()=>null;':'export default ()=>null;',loader:'tsx',resolveDir:root}));
  } }] }).catch(async error=>{await rm(temp,{recursive:true,force:true});throw error;});
const js = bundled.outputFiles.find(file=>file.path.endsWith('.js')).text;
const css = bundled.outputFiles.find(file=>file.path.endsWith('.css')).text;
const compiledCss = preview ? await readFile(path.join(root,'dist/assets',(await readdir(path.join(root,'dist/assets'))).find(name=>/^main-.*\.css$/.test(name))),'utf8') : '';
const html = `<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>鲲鹏 · 离线测试版</title><style>${compiledCss}html,body,#root{margin:0;height:100%;background:#111;color:#eee}${css}</style><div id="root"></div><script type="module">${js}</script></html>`;
const server = createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.setHeader('Content-Security-Policy',"default-src 'self' data: blob:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'none'");res.end(html);});
let browser;
try {
  await mkdir(evidence,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`http://127.0.0.1:${server.address().port}`;
  if (preview) {
    console.log('KUNPENG_OFFLINE_PREVIEW='+url);
    await new Promise(resolve=>{process.once('SIGTERM',resolve);process.once('SIGINT',resolve);});
  } else {
  browser=await puppeteer.launch({executablePath:process.env.SMOKE_BROWSER_PATH||path.join(process.env.HOME,'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true,userDataDir:temp});
  const page=await browser.newPage();const errors=[];page.on('pageerror',error=>errors.push(error.stack||error.message));
  await page.setRequestInterception(true);page.on('request',req=>req.url().startsWith(url)||req.url().startsWith('data:')?req.continue():req.abort());
  await page.setViewport({width:1440,height:900});await page.goto(url);
  const clickText=text=>page.evaluate(text=>{const el=[...document.querySelectorAll('button')].find(el=>el.textContent.trim()===text);if(!el)throw new Error(text);el.click();},text);
  const write=async text=>{await page.$eval('[aria-label="完整提示词"]',el=>{el.focus();el.select();});await page.type('[aria-label="完整提示词"]',text);};
  await page.waitForSelector('[aria-label="媒体预览器"]');
  await clickText('提示词');await write('A 新草稿');await page.click('[aria-label="打开镜头 02"]');await write('B 新草稿');await page.click('[aria-label="打开镜头 01"]');
  assert.equal(await page.$eval('[aria-label="完整提示词"]',el=>el.value),'A 新草稿');
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.shots[0].imagePrompt),'A 新草稿');
  await page.evaluate(()=>window.projectLegacyPromptEdit('01','A 兼容入口修改'));
  await page.waitForFunction(()=>document.querySelector('[aria-label="完整提示词"]').value==='A 兼容入口修改');
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.shots[0].description),'司机察觉异响');
  await write('A 新草稿');
  assert.equal(await page.$eval('[aria-label="生成模型"]',el=>el.value),'gpt-image-2');
  await page.click('[aria-label="查询费用预估"]');await page.waitForFunction(()=>document.body.textContent.includes('RunningHub 预估 CNY 1.2'));
  assert.equal(await page.evaluate(()=>window.projectPriceDraft.objectId),'shot:a');
  await page.evaluate(()=>{window.projectGpt=false;window.projectPorts.workshop.setState({data:{...window.projectPorts.workshop.getState().data}});});
  await clickText('配置模型渠道');await page.waitForSelector('[aria-label="渠道设置测试"]');await clickText('关闭渠道设置测试');
  assert.equal(await page.$eval('[aria-label="生成模型"] option[value="gpt-image-2"]',el=>el.disabled),true);
  await page.evaluate(()=>{window.projectGpt=true;window.projectPorts.workshop.setState({data:{...window.projectPorts.workshop.getState().data}});});
  await page.select('[aria-label="优化提示词"]','legacy');await page.waitForFunction(()=>window.projectOptimize);
  await page.click('[aria-label="打开镜头 02"]');await page.evaluate(()=>window.projectOptimized('A 优化草稿'));
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.workspaceDrafts['shot:a::image'].prompt==='A 优化草稿');
  assert.equal(await page.$eval('[aria-label="完整提示词"]',el=>el.value),'B 新草稿');
  await clickText('文档');await page.click('[aria-label="列表视图"]');assert.equal(await page.$eval('[aria-label="完整提示词"]',el=>el.value),'B 新草稿');
  assert.equal(await page.$eval('[aria-label="助手保留输入"]',el=>el.value),'保留上下文');
  await page.click('[aria-label="打开镜头 01"]');await clickText('生成');await page.waitForFunction(()=>window.projectConfirmation);
  assert.equal(await page.evaluate(()=>window.projectCalls.length),0);
  await page.evaluate(()=>{window.projectConfirmation.resolve(false);window.projectConfirmation=null;});
  await page.waitForFunction(()=>Object.values(window.projectPorts.workshop.getState().data.workspaceSubmissions).every(s=>s.status==='cancelled'));
  await page.waitForFunction(()=>[...document.querySelectorAll('button')].some(el=>el.textContent.trim()==='生成'&&!el.disabled));
  await clickText('生成');await page.waitForFunction(()=>window.projectConfirmation);await page.evaluate(()=>window.projectConfirmation.resolve(true));
  await page.waitForFunction(()=>window.projectCalls.length===1);await page.click('[aria-label="打开镜头 02"]');await page.evaluate(()=>window.projectComplete());
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.projectObjects.versions.some(v=>v.generationSnapshot));
  await page.click('[aria-label="打开镜头 01"]');await page.click('[aria-label="收起提示词"]');await page.click('[aria-label="查看v2候选"]');await clickText('采用此版');
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.shots[0].imagePath==='/new.jpg');
  await page.click('[aria-label="添加到对话"]');assert.ok(await page.evaluate(()=>window.projectReferences[0].objectId.includes('media')));
  assert.equal(await page.evaluate(()=>window.projectCalls[0].params.resolution),'2k');
  await page.click('[aria-label="项目菜单"]');await clickText('项目快照');await page.waitForSelector('[aria-label="快照测试"]');
  await clickText('关闭快照测试');
  await clickText('视频');await clickText('提示词');
  await write('司机停车，不增加对白');
  await page.evaluate(()=>window.projectLegacyVideoSettings('01',{videoModel:'seedance-2.5',videoRatio:'9:16',durationSec:15}));
  await page.waitForFunction(()=>document.querySelector('[aria-label="生成模型"]').value==='dreamina-seedance-2.5');
  assert.equal(await page.$eval('[aria-label="时长"]',el=>el.value),'15');
  assert.equal(await page.$eval('[aria-label="比例"]',el=>el.value),'9:16');
  assert.equal(await page.$eval('[aria-label="完整提示词"]',el=>el.value),'司机停车，不增加对白');
  await page.select('[aria-label="生成模型"]','minimax-hailuo-h3');
  await page.select('[aria-label="时长"]','7');
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.shots[0].durationSec===7);
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.shots[0].videoModel),'minimax-h3');
  assert.equal(await page.evaluate(()=>window.projectCalls.length),1);
  await page.screenshot({path:path.join(evidence,'phase2-shared-video-settings.png')});
  assert.equal(await page.$eval('.workspace-constraint-section',el=>el.open),false);
  await page.click('.workspace-constraint-section summary');await page.select('[aria-label="约束卡范围"]','scene');
  await clickText('建立场景约束卡');await page.waitForSelector('[aria-label="导演约束卡提示词"]');
  assert.equal(await page.$$eval('[aria-label="约束卡场景参考"] img',els=>els.length),1);
  const cardId=await page.evaluate(()=>window.projectPorts.workshop.getState().data.scenes[0].directorConstraintCard.id);
  await page.$eval('[aria-label="导演约束卡提示词"]',el=>{el.focus();el.select();});await page.type('[aria-label="导演约束卡提示词"]','司机握方向盘的透视素模与摄影机图标');
  await page.click('[aria-label="让助手修改约束卡提示词"]');
  assert.equal(await page.evaluate(()=>window.projectReferences[0].objectId),'director-constraint:'+cardId);
  await page.evaluate(()=>{window.projectConfirmation=null;});await clickText('生成约束卡');await page.waitForFunction(()=>window.projectConfirmation);
  assert.equal(await page.evaluate(()=>window.projectCalls.length),1);
  assert.deepEqual(await page.evaluate(()=>window.projectConfirmation.snapshot.references.map(ref=>ref.path)),['/road.jpg']);
  await page.evaluate(()=>window.projectConfirmation.resolve(true));await page.waitForFunction(()=>window.projectCalls.length===2);
  await page.evaluate(()=>window.projectComplete());await page.waitForSelector('[aria-label="约束卡候选版本"] button');
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.scenes[0].directorConstraintCard.imagePath),'');
  await page.click('[aria-label="约束卡候选版本"] button');
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.scenes[0].directorConstraintCard.imagePath==='/constraint-new.jpg');
  await page.click('.workspace-constraint-toggle input');
  assert.match(await page.$eval('[aria-label="完整提示词"]',el=>el.value),/@导演约束卡（对应 @图片三）/);
  assert.equal(await page.$eval('.workspace-constraint-section summary',el=>el.textContent.includes('继承 雨夜公路')),true);
  await page.screenshot({path:path.join(evidence,'phase1-director-constraint-expanded.png')});
  await page.click('[aria-label="打开镜头 02"]');
  assert.equal(await page.$eval('[aria-label="完整提示词"]',el=>el.value.includes('@导演约束卡')),false);
  await page.click('[aria-label="打开镜头 01"]');
  assert.match(await page.$eval('[aria-label="完整提示词"]',el=>el.value),/@导演约束卡/);
  await page.click('[aria-label="打开镜头 02"]');await clickText('图片');await page.click('[aria-label="收起提示词"]');
  await clickText('采用此版');
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.projectObjects.versions.some(v=>v.ownerObjectId==='shot:b'&&v.selected));
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.shots[1].imagePath),'/legacy-b.jpg');
  await page.click('[aria-label="画布视图"]');await page.waitForSelector('[aria-label="项目对象画布"] .react-flow__node');
  await page.waitForFunction(()=>window.projectCanvasLayout?.positions['shot:b']);
  assert.equal(await page.$eval('.workspace-shared-inspector',el=>el.hidden),true);
  await page.click('[aria-label="预览镜头 02图片v1"]');await page.waitForSelector('[aria-label="关闭媒体预览"]');
  assert.equal(await page.$eval('.workspace-shared-inspector',el=>el.hidden),false);
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.projectViewState.workspaceObjectId),'shot:b');
  await page.click('[aria-label="关闭媒体预览"]');
  const beforeDrag=await page.evaluate(()=>window.projectCanvasLayout.positions['shot:b']);
  const cardHeader=await page.$('[aria-label="画布对象 镜头 02"] header');const box=await cardHeader.boundingBox();
  await page.mouse.move(box.x+50,box.y+15);await page.mouse.down();await page.mouse.move(box.x+130,box.y+65,{steps:12});await page.mouse.up();
  await page.waitForFunction(()=>window.projectCanvasLayout.positions['shot:b'].pending===false);
  const afterDrag=await page.evaluate(()=>window.projectCanvasLayout.positions['shot:b']);assert.notDeepEqual(afterDrag,beforeDrag);
  await page.evaluate(()=>window.projectAddCharacter());await page.waitForFunction(()=>window.projectCanvasLayout.positions['character:new']);
  assert.deepEqual(await page.evaluate(()=>window.projectCanvasLayout.positions['shot:b']),afterDrag);
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.projectViewState.workspaceObjectId),'shot:b');
  await page.click('[aria-label="列表视图"]');
  assert.equal(await page.$eval('[aria-label="助手保留输入"]',el=>el.value),'保留上下文');
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.projectViewState.workspaceObjectId),'shot:b');
  await clickText('提示词');await write('B 列表画布共用草稿');
  await page.click('[aria-label="画布视图"]');await page.click('[aria-label="预览镜头 02图片v1"]');
  assert.equal(await page.$eval('[aria-label="完整提示词"]',el=>el.value),'B 列表画布共用草稿');
  assert.deepEqual(await page.evaluate(()=>window.projectCanvasLayout.positions['shot:b']),afterDrag);
  await page.screenshot({path:path.join(evidence,'phase2-canvas-shared-inspector.png')});
  const beforeCanvasReferences=await page.evaluate(()=>window.projectPorts.workshop.getState().data.workspaceDrafts['shot:b::image'].references);
  await page.evaluate(()=>{window.projectConfirmation=null;});await clickText('生成');await page.waitForFunction(()=>window.projectConfirmation);
  assert.equal(await page.evaluate(()=>window.projectConfirmation.snapshot.objectId),'shot:b');
  assert.equal(await page.evaluate(()=>window.projectCalls.length),2);
  await page.evaluate(()=>window.projectConfirmation.resolve(true));await page.waitForFunction(()=>window.projectCalls.length===3);
  await page.click('[aria-label="列表视图"]');await page.evaluate(()=>window.projectComplete());
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.projectObjects.media.some(m=>m.path==='/new-canvas.jpg'&&m.ownerObjectId==='shot:b'));
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.shots[1].imagePath),'/legacy-b.jpg');
  assert.deepEqual(await page.evaluate(()=>window.projectPorts.workshop.getState().data.workspaceDrafts['shot:b::image'].references),beforeCanvasReferences);
  await page.click('[aria-label="画布视图"]');
  for(const width of [1440,1280,1024,390]) {
    await page.setViewport({width,height:900});
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    assert.ok(await page.$eval('.workspace-generation-submit .workspace-primary',el=>{const r=el.getBoundingClientRect();return r.width>0&&r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}));
    await page.screenshot({path:path.join(evidence,'phase2-canvas-inspector-'+width+'.png')});
  }
  await page.setViewport({width:1440,height:900});
  await page.click('[aria-label="关闭媒体预览"]');await page.click('[aria-label="项目助手"]');
  await page.screenshot({path:path.join(evidence,'phase2-pure-object-canvas.png')});
  assert.equal(await page.$eval('[aria-label="项目助手列"]',el=>el.getAttribute('aria-hidden')),'true');
  await page.click('[aria-label="列表视图"]');
  for(const width of [1440,1280,1024,390]){await page.setViewport({width,height:900});await page.screenshot({path:path.join(evidence,'phase1-project-container-'+width+'.png')});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));}
  await page.setViewport({width:1440,height:900});
  await page.click('[aria-label="新建素材"]');await clickText('图片素材');
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.projectViewState.workspaceObjectId.startsWith('generation-task:workspace:'));
  const blankId=await page.evaluate(()=>window.projectPorts.workshop.getState().data.projectViewState.workspaceObjectId);
  assert.deepEqual(await page.evaluate(id=>window.projectPorts.workshop.getState().data.workspaceDrafts[id+'::image'].references,blankId),[]);
  await write('独立生成的道路素材，不沿用当前镜头');
  await page.evaluate(()=>{window.projectConfirmation=null;});await clickText('生成');await page.waitForFunction(()=>window.projectConfirmation);
  assert.equal(await page.evaluate(()=>window.projectCalls.length),3);
  assert.equal(await page.evaluate(()=>window.projectConfirmation.snapshot.objectId),blankId);
  assert.deepEqual(await page.evaluate(()=>window.projectConfirmation.snapshot.references),[]);
  await page.evaluate(()=>window.projectConfirmation.resolve(true));await page.waitForFunction(()=>window.projectCalls.length===4);
  await page.evaluate(()=>window.projectComplete());
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.projectObjects.media.some(m=>m.path==='/unclassified.jpg'));
  await page.click('[aria-label="收起提示词"]');
  await page.screenshot({path:path.join(evidence,'phase2-unclassified-generation.png')});
  const blankMedia=await page.evaluate(()=>window.projectPorts.workshop.getState().data.projectObjects.media.find(m=>m.path==='/unclassified.jpg'));
  assert.equal(blankMedia.purpose,'unclassified');assert.equal(blankMedia.ownerObjectId,blankId);
  const originalVersion=await page.evaluate(id=>window.projectPorts.workshop.getState().data.projectObjects.versions.find(v=>v.id===id),blankMedia.versionObjectId);
  await page.click('button[aria-label="归类素材"]');await page.waitForSelector('[role="dialog"][aria-label="归类素材"]');await clickText('取消');
  assert.equal(await page.evaluate(id=>window.projectPorts.workshop.getState().data.projectObjects.media.find(m=>m.id===id).ownerObjectId,blankMedia.id),blankId);
  await page.click('button[aria-label="归类素材"]');await page.select('[aria-label="素材所属对象"]','shot:b');
  await page.screenshot({path:path.join(evidence,'phase2-classify-material.png')});
  await page.setViewport({width:390,height:900});
  assert.ok(await page.$eval('.workspace-classify-dialog .workspace-primary',el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth+1&&r.bottom<=innerHeight+1;}));
  await clickText('归入候选组');
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.projectViewState.workspaceObjectId==='shot:b');
  assert.equal(await page.evaluate(id=>window.projectPorts.workshop.getState().data.projectObjects.media.find(m=>m.id===id).purpose,blankMedia.id),'candidate-version');
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.shots[1].imagePath),'/legacy-b.jpg');
  assert.deepEqual(await page.evaluate(()=>window.projectPorts.workshop.getState().data.workspaceDrafts['shot:b::image'].references),beforeCanvasReferences);
  assert.deepEqual(await page.evaluate(id=>window.projectPorts.workshop.getState().data.projectObjects.versions.find(v=>v.id===id).generationSnapshot,blankMedia.versionObjectId),originalVersion.generationSnapshot);
  await page.setViewport({width:1440,height:900});await page.screenshot({path:path.join(evidence,'phase2-classified-candidate.png')});
  await page.click('[aria-label="画布视图"]');await page.click('[aria-label="新建素材"]');await clickText('视频素材');
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.projectViewState.workspaceOutputType==='video');
  assert.deepEqual(await page.evaluate(()=>{const d=window.projectPorts.workshop.getState().data;return d.workspaceDrafts[d.projectViewState.workspaceObjectId+'::video'].references;}),[]);
  assert.equal(await page.evaluate(()=>window.projectCalls.length),4);
  await page.click('[aria-label="列表视图"]');
  await page.$eval('.workspace-content-scroll',el=>{el.scrollTop=0;});
  await page.waitForSelector('[aria-label="打开司机"]');await page.click('[aria-label="打开司机"]');
  if(!await page.$('[aria-label="完整提示词"]'))await clickText('提示词');
  assert.equal(await page.$eval('[aria-label="完整提示词"]',el=>el.value),'司机普通提示词');
  await page.select('[aria-label="生成模型"]','midjourney-v8.2');
  await page.waitForFunction(()=>document.querySelector('[aria-label="完整提示词"]').value==='cinematic driver');
  await page.select('[aria-label="生成模型"]','gpt-image-2');
  await page.waitForFunction(()=>document.querySelector('[aria-label="完整提示词"]').value==='司机普通提示词');
  await write('司机普通新词');await page.select('[aria-label="生成模型"]','midjourney-v8.2');
  await page.waitForFunction(()=>document.querySelector('[aria-label="完整提示词"]').value==='cinematic driver');
  await page.evaluate(()=>window.projectLegacyAssetEdit('MJ 兼容入口新词'));
  await page.waitForFunction(()=>document.querySelector('[aria-label="完整提示词"]').value==='MJ 兼容入口新词');
  await page.select('[aria-label="生成模型"]','gpt-image-2');
  await page.waitForFunction(()=>document.querySelector('[aria-label="完整提示词"]').value==='司机普通新词');
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.characters[0].assetImagePath),'/driver.jpg');
  assert.equal(await page.evaluate(()=>window.projectCalls.length),4);
  await page.evaluate(()=>window.projectScale());
  await page.waitForSelector('[aria-label="打开镜头 001"]');
  await page.waitForFunction(()=>document.querySelectorAll('.workspace-content-item').length<60);
  const mountedRows=await page.$$eval('.workspace-content-item',els=>els.length);
  assert.ok(mountedRows<60,'100 shots keep only the visible window mounted');
  await page.click('[aria-label="镜头 001操作"]');await clickText('从视图移除');
  await page.waitForSelector('[aria-label="打开镜头 001"]',{hidden:true});
  assert.equal(await page.evaluate(()=>window.projectPorts.workshop.getState().data.shots.length),100);
  await page.click('[aria-label="项目菜单"]');await clickText('显示已移除的工坊对象（1）');
  await page.waitForSelector('[aria-label="打开镜头 001"]');
  await page.$eval('.workspace-content-scroll',el=>{el.scrollTop=el.scrollHeight;});
  await page.waitForSelector('[aria-label="打开镜头 100"]');
  const started=Date.now();
  await page.click('[aria-label="打开镜头 100"]');
  await page.waitForFunction(()=>window.projectPorts.workshop.getState().data.projectViewState.workspaceObjectId==='shot:scale-99');
  console.log('100-shot / 500-media fixture: mounted rows='+mountedRows+', selection round-trip ms='+(Date.now()-started));
  await page.screenshot({path:path.join(evidence,'phase4-100-shots-visible-window.png')});
  assert.deepEqual(errors,[]);
  console.log('PASS: production ProjectWorkspace drafts, confirmation/candidate flow, director constraints, pricing/configuration and legacy versions; real ReactFlow list/canvas selection, shared composer, drag/new-object layout, canvas mock generation returning to list, blank generation and ownership-only classification, and responsive controls. Offline ports; no user data or providers touched.');
  }
} finally {if(browser){const timer=setTimeout(()=>browser.process()?.kill('SIGKILL'),5000);await browser.close().finally(()=>clearTimeout(timer));}await new Promise(resolve=>server.close(resolve));await rm(temp,{recursive:true,force:true});}
