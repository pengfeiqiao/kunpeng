// 顶栏遮挡探针：真实组件 + 真实 CSS，测量顶栏控件与下拉菜单的可见性。
// 不改业务代码，只输出证据截图与 elementFromPoint 报告。
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'kunpeng-topbar-probe-'));
const evidence = path.join(root, 'docs/workspace-evidence');
const image = `data:image/jpeg;base64,${(await readFile(path.join(root, 'public/midjourney-styles/director/raw-flash-intimacy.jpg'))).toString('base64')}`;
const bundled = await build({ absWorkingDir: root, bundle: true, write: false, outfile: path.join(temp, 'fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, stdin: { resolveDir: root, loader: 'tsx', contents: `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import WorkspaceMediaPanel from './src/components/workspace/WorkspaceMediaPanel';
import ProjectWorkspaceLayout from './src/components/workspace/ProjectWorkspaceLayout';
import ProjectContentList from './src/components/workspace/ProjectContentList';
import { emptyWorkshopData } from './src/lib/workshop/types';
import { migrateWorkshopProjectObjects } from './src/lib/projectObjects/migrate';
import { workspaceSelection, selectWorkspaceObject } from './src/lib/workspace/contentModel';
const engines = [{ engine: { id: 'mock-image', label: '测试图片模型', kind: 'image', endpoint: 'mock', mode: 'image-to-image', imageParam: { key: 'images', multiple: true }, params: [
  { key:'aspectRatio', label:'比例', type:'list', options:['16:9','9:16'], default:'16:9' }
] } }];
const seed = migrateWorkshopProjectObjects({ ...emptyWorkshopData('offline-workspace'), imageModel: 'mock-image',
  characters: [{ id:'driver', name:'司机', appearance:'', personality:'', assetImagePath:'/driver.jpg' }],
  scenes: [{ id:'road', name:'雨夜公路', description:'', assetImagePath:'/road.jpg' }],
  shots: [
    { id:'a', shotNo:'01', description:'司机察觉异响', characterIds:['driver'], sceneId:'road', imagePrompt:'A 原始提示词', durationSec:8 },
    { id:'b', shotNo:'02', description:'转头看向右侧', characterIds:['driver'], sceneId:'road', imagePrompt:'B 原始提示词', durationSec:5 }
  ], projectViewState: { workspaceObjectId:'shot:a', workspaceOutputType:'image', workspaceComposerOpen:false }
}, 1);
function Fixture() {
  const [data, setData] = useState(seed);
  const [surface, setSurface] = useState('media');
  const [view, setView] = useState('list');
  const [assistantState, setAssistantState] = useState('expanded');
  const [menuOpen, setMenuOpen] = useState(false);
  window.probeSet = { setSurface, setView, setAssistantState, setMenuOpen };
  const selection = workspaceSelection(data);
  return <ProjectWorkspaceLayout projectName="雨夜归途 · 离线验收" specSummary="16:9 · 写实电影 · 60s" surface={surface} onSurface={setSurface}
    mediaView={view} onMediaView={setView}
    assistantState={assistantState} onAssistantState={setAssistantState} onBack={() => {}} onExport={() => {}} onSpec={() => {}}
    onNewMaterial={() => {}}
    projectActions={<div className="workspace-project-menu">
      <button className="workspace-icon" aria-label="项目菜单" title="项目菜单" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>⋯</button>
      {menuOpen && <div role="menu"><button role="menuitem">一键全流程</button><button role="menuitem">导出飞书</button><button role="menuitem">项目快照</button><button role="menuitem">原有工坊工具</button></div>}
    </div>}
    content={<ProjectContentList groups={selection.groups} selectedId={selection.selected?.id} mediaSrc={() => ${JSON.stringify(image)}}
      onSelect={id => setData(current => ({...current, projectViewState: selectWorkspaceObject(current, id)}))} onAddToChat={() => {}} />}
    inspector={<WorkspaceMediaPanel data={data} engines={engines} mediaSrc={() => ${JSON.stringify(image)}} onSaveDraft={() => null} onGenerate={() => {}}
      onProductionTools={() => {}} onOptimize={() => Promise.resolve('')} onViewState={() => {}} onAdopt={() => {}} onAddToChat={() => {}} />}
    canvas={<div style={{height:'100%',background:'#22262b',display:'grid',placeItems:'center'}}>画布夹具</div>}
    assistant={<div style={{padding:12}}>助手夹具</div>} />;
}
createRoot(document.getElementById('root')).render(<Fixture />);
// 模拟正在运行的后台任务 toast（与 BackgroundTaskToast 相同定位：fixed top-16 right-4 z-9999）
const toast = document.createElement('div');
toast.id = 'toast-replica';
toast.style.cssText = 'position:fixed;top:64px;right:16px;z-index:35;width:340px;pointer-events:none';
toast.innerHTML = '<div style="pointer-events:auto;background:#1a1a2e;border:1px solid #333;border-radius:16px;padding:12px;color:#ccc;font-size:13px">1 个任务生成中…</div>';
document.body.appendChild(toast);
` },
  plugins: [{ name:'source-alias', setup(build) { build.onResolve({filter:/^@\//}, ({path:id}) => { const base = path.join(root,'src',id.slice(2)); if (existsSync(base+'.ts')) return {path: base+'.ts'}; if (existsSync(base+'.tsx')) return {path: base+'.tsx'}; return {path: base+'/index.ts'}; }); } }],
});
const js = bundled.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundled.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = `<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>html,body,#root{margin:0;height:100%;background:#111;color:#eee}${css}</style><div id="root"></div><script>${js}</script></html>`;
const server = createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end(html);});
let browser;
const findings = [];
try {
  await mkdir(evidence,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({executablePath:process.env.SMOKE_BROWSER_PATH || path.join(process.env.HOME,'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true,userDataDir:temp});
  const page = await browser.newPage();
  const errors=[];
  page.on('pageerror',error=>errors.push(error.message));
  await page.setRequestInterception(true);
  await page.on('request', () => {});
  page.on('request',req=>req.url().startsWith(url)||req.url().startsWith('data:')?req.continue():req.abort());
  const settle = () => page.evaluate(() => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))));
  const measure = (label) => page.evaluate((label) => {
    const bar = document.querySelector('.workspace-topbar');
    const barRect = bar.getBoundingClientRect();
    const controls = [...bar.querySelectorAll('button')].map(el => {
      const r = el.getBoundingClientRect();
      if (!r.width) return null;
      const cx = Math.min(r.left + r.width / 2, innerWidth - 1), cy = r.top + Math.min(r.height / 2, barRect.height - 1);
      const hit = document.elementFromPoint(cx, cy);
      const chain = [];
      let n = hit; while (n && n !== document.body && chain.length < 5) { chain.push(String(n.className).slice(0, 50) || n.tagName); n = n.parentElement; }
      return { label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 10),
        right: Math.round(r.right), top: Math.round(r.top), ok: hit === el || el.contains(hit),
        hit: chain.join(' < ') };
    }).filter(Boolean);
    // 打开的下拉菜单是否被顶栏裁掉
    const menu = bar.querySelector('[role="menu"]');
    const menuInfo = menu ? (() => { const r = menu.getBoundingClientRect();
      const firstItem = menu.querySelector('[role=menuitem]');
      const ir = firstItem?.getBoundingClientRect();
      const hit = ir ? document.elementFromPoint(ir.left + ir.width / 2, ir.top + ir.height / 2) : null;
      return { menuTop: Math.round(r.top), menuBottom: Math.round(r.bottom), menuHeight: Math.round(r.height),
        barBottom: Math.round(barRect.bottom), clippedByBar: r.bottom > barRect.bottom + 1,
        itemHit: hit ? (menu.contains(hit) ? 'menu' : String(hit.className).slice(0, 60)) : 'none' }; })() : null;
    return { label, vw: innerWidth, barHeight: Math.round(barRect.height), barOverflow: getComputedStyle(bar).overflow, controls, menu: menuInfo };
  }, label);
  const states = [
    { w: 1680, h: 1000, assistant: 'expanded', surface: 'media', view: 'list', menu: true },
    { w: 1440, h: 900, assistant: 'expanded', surface: 'media', view: 'list', menu: true },
    { w: 1280, h: 800, assistant: 'expanded', surface: 'media', view: 'list', menu: true },
    { w: 1280, h: 800, assistant: 'hidden', surface: 'media', view: 'list', menu: false },
    { w: 1440, h: 900, assistant: 'expanded', surface: 'media', view: 'canvas', menu: true },
    { w: 1199, h: 800, assistant: 'expanded', surface: 'media', view: 'list', menu: true },
    { w: 1024, h: 768, assistant: 'hidden', surface: 'media', view: 'list', menu: true },
  ];
  await page.setViewport({ width: 1680, height: 1000 });
  await page.goto(url);
  await page.waitForSelector('.workspace-topbar');
  await new Promise(r => setTimeout(r, 400));
  for (const s of states) {
    await page.setViewport({ width: s.w, height: s.h });
    await page.evaluate((s) => { window.probeSet.setSurface(s.surface); window.probeSet.setView(s.view); window.probeSet.setAssistantState(s.assistant); window.probeSet.setMenuOpen(false); }, s);
    await settle(); await settle();
    if (s.menu) { await page.evaluate(() => window.probeSet.setMenuOpen(true)); await settle(); }
    const report = await measure(`${s.w}x${s.h} ${s.surface}/${s.view} assistant=${s.assistant} menu=${s.menu}`);
    findings.push(report);
    await page.screenshot({ path: path.join(evidence, `topbar-probe-${s.w}-${s.view}-${s.menu ? 'menu' : 'plain'}.png`) });
  }
  console.log(JSON.stringify(findings, null, 1));
  if (errors.length) console.log('PAGE ERRORS:', errors);
} finally {
  await browser?.close();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
