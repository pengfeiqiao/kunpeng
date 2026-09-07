// 舞台"更多工具"菜单截断探针：测量菜单相对胶囊/舞台/列的几何位置。
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'kunpeng-tools-probe-'));
const evidence = path.join(root, 'docs/workspace-evidence');
const image = `data:image/jpeg;base64,${(await readFile(path.join(root, 'public/midjourney-styles/director/raw-flash-intimacy.jpg'))).toString('base64')}`;
const bundled = await build({ absWorkingDir: root, bundle: true, write: false, outfile: path.join(temp, 'fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, stdin: { resolveDir: root, loader: 'tsx', contents: `
import { createRoot } from 'react-dom/client';
import MediaInspector from './src/components/workspace/MediaInspector';
import { workspaceMediaTools } from './src/lib/workspace/mediaTools';
const versions = [{ media: { id:'m1', path:'/x.jpg', mediaType:'image', purpose:'current-version', label:'定版' }, ordinal: 1, adopted: true }];
createRoot(document.getElementById('root')).render(
  <div style={{display:'flex',flexDirection:'column',height:'100vh',background:'#08080a'}}>
    <div style={{width:760,margin:'58px auto 0',flex:1,display:'flex',minHeight:0,border:'1px solid #333'}}>
      <MediaInspector title="定版 角色" versions={versions} selected={versions[0]} mediaSrc={() => ${JSON.stringify(image)}} onSelect={()=>{}} onAdopt={()=>{}}
        canGenerate={false} onPrompt={()=>{}} onEdit={()=>{}} onAddToChat={()=>{}}
        tools={workspaceMediaTools('image')} onTool={(id)=>{window.picked=id}} />
    </div>
  </div>);
` },
  plugins: [{ name:'source-alias', setup(build) { build.onResolve({filter:/^@\//}, ({path:id}) => { const base = path.join(root,'src',id.slice(2)); if (existsSync(base+'.ts')) return {path: base+'.ts'}; if (existsSync(base+'.tsx')) return {path: base+'.tsx'}; return {path: base+'/index.ts'}; }); } }],
});
const js = bundled.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundled.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = `<html lang="zh-CN"><meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;background:#111;color:#eee}${css}</style><div id="root"></div><script>${js}</script></html>`;
const server = createServer((_req,res) => {res.setHeader('Content-Type','text/html');res.end(html);});
let browser;
try {
  await mkdir(evidence,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({executablePath:process.env.SMOKE_BROWSER_PATH || path.join(process.env.HOME,'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),headless:true,userDataDir:temp});
  const page = await browser.newPage();
  page.on('pageerror',e=>console.log('PAGEERR',e.message));
  await page.setRequestInterception(true);
  page.on('request',req=>req.url().startsWith(url)||req.url().startsWith('data:')?req.continue():req.abort());
  await page.setViewport({width:900,height:800});
  await page.goto(url);
  await page.waitForSelector('[aria-label="更多工具"]');
  await page.click('[aria-label="更多工具"]');
  await page.waitForSelector('.workspace-stage-tools-menu');
  const report = await page.evaluate(() => {
    const r = (sel) => { const el = document.querySelector(sel); if (!el) return null; const b = el.getBoundingClientRect();
      return { left: Math.round(b.left), right: Math.round(b.right), top: Math.round(b.top), bottom: Math.round(b.bottom), w: Math.round(b.width) }; };
    const menu = document.querySelector('.workspace-stage-tools-menu');
    const items = [...menu.querySelectorAll('[role=menuitem]')].map((el) => {
      const b = el.getBoundingClientRect();
      const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
      return { text: el.textContent, right: Math.round(b.right), bottom: Math.round(b.bottom), hitSelf: hit === el || el.contains(hit),
        hit: hit ? String(hit.className).slice(0, 40) : 'none' };
    });
    return {
      vw: innerWidth,
      pill: r('.workspace-stage-tools'), menu: r('.workspace-stage-tools-menu'),
      stage: r('.workspace-media-stage'), inspector: r('.workspace-inspector'),
      menuPosition: getComputedStyle(menu).position, menuRight: getComputedStyle(menu).right,
      offsetParentChain: (() => { const chain = []; let n = menu.offsetParent; while (n && chain.length < 4) { chain.push(String(n.className).slice(0, 40)); n = n.offsetParent; } return chain; })(),
      items,
    };
  });
  console.log(JSON.stringify(report, null, 1));
  await page.screenshot({ path: path.join(evidence, 'stage-tools-menu-probe.png') });
} finally {
  await browser?.close();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
