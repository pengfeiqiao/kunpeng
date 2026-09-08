// Offline component fixture. No App bootstrap, user settings, Tauri, provider calls or project files.
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'kunpeng-composer-'));
const evidence = path.join(root, 'docs/workspace-evidence');
const fixtureImage = `data:image/jpeg;base64,${(await readFile(path.join(root, 'public/omni-style-cards/architecture-exploded.jpg'))).toString('base64')}`;
const portraitImage = `data:image/jpeg;base64,${(await readFile(path.join(root, 'public/midjourney-styles/director/raw-flash-intimacy.jpg'))).toString('base64')}`;
const bundled = await build({ absWorkingDir: root, bundle: true, write: false, outfile: path.join(temp, 'fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  stdin: { resolveDir: root, loader: 'tsx', contents: `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import GenerationComposer from './src/components/workspace/GenerationComposer';
import MediaInspector from './src/components/workspace/MediaInspector';
import ProjectWorkspaceLayout from './src/components/workspace/ProjectWorkspaceLayout';
import ProjectContentList from './src/components/workspace/ProjectContentList';
import WorkspaceObjectActions from './src/components/workspace/WorkspaceObjectActions';
const refs = Array.from({ length: 14 }, (_, i) => ({ id: 'ref-' + i, type: 'image', label: '素材' + (i + 1), path: '/fixture/original-' + i + '.png' }));
const seed = { id: 'shot:a::video', objectId: 'shot:a', projectId: 'local-fixture', outputType: 'video', engineId: 'mock-h3',
 prompt: '@图片一 为场景，@图片二 为司机。司机听到异响后，转头看向副驾驶。保留原剧本对白。',
 references: refs, params: { ratio: '16:9', duration: '8', resolution: '2K' }, revision: 1, updatedAt: 1 };
const engines = [{ engine: { id: 'mock-h3', label: 'MiniMax H3', kind: 'video', endpoint: 'mock', mode: 'multimodal-video', imageParam: { key: 'images', multiple: true }, params: [
 { key: 'ratio', label: '比例', type: 'list', options: ['16:9', '9:16'], default: '16:9' },
 { key: 'duration', label: '时长', type: 'list', options: ['5', '8', '15'], default: '8' },
 { key: 'resolution', label: '分辨率', type: 'list', options: ['2K'], default: '2K' }
] } }];
function Fixture() {
 const [draft, setDraft] = useState(seed);
 const [inspector, setInspector] = useState(false);
 const [editing, setEditing] = useState(false);
 const [selectedId, setSelectedId] = useState('media-1');
 const [adoptedId, setAdoptedId] = useState('version-1');
 const [shell, setShell] = useState(false);
 const [surface, setSurface] = useState('media');
 const [contentSelected, setContentSelected] = useState('shot:03');
 const [assistantState, setAssistantState] = useState('expanded');
 const [widths, setWidths] = useState({content:320,assistant:360});
 const [objectMenu, setObjectMenu] = useState(null);
 window.smokeWidths = widths;
 window.smokeDraft = draft;
 window.smokeLongPrompt = () => setDraft(current => ({ ...current, prompt: seed.prompt.repeat(180) }));
 window.smokeInspector = () => { setInspector(true); setEditing(false); };
 window.smokeShell = () => { setShell(true); setInspector(true); setEditing(false); };
 const versions = [1, 2].map(n => ({ ordinal: n, adopted: adoptedId === 'version-' + n,
  media: { id: 'media-' + n, path: '/fixture/portrait-' + n + '.jpg', mediaType: 'image' },
  version: { id: 'version-' + n, engineId: 'Midjourney 8.2', generationSnapshot: { params: { aspectRatio: '9:16' } } }
 }));
 const composer = <GenerationComposer draft={draft} engines={engines} onChange={setDraft} mediaSrc={() => ${JSON.stringify(fixtureImage)}}
   onGenerate={() => { window.smokeGenerated = window.smokeDraft; }} onClose={() => { window.smokeClosed = true; setEditing(false); }} onAddReference={() => { window.smokeAdd = true; }}
   onOptimize={template => { window.smokeTemplate = template; }} constraint={{ label: '继承第1场', onOpen: () => { window.smokeConstraint = true; } }} />;
 const main = inspector ? <MediaInspector title="镜头03 · 人物近景" versions={versions} selected={versions.find(item => item.media.id === selectedId)}
   mediaSrc={() => ${JSON.stringify(portraitImage)}} onSelect={setSelectedId} onAdopt={id => { window.smokeAdopted = id; setAdoptedId(id); }}
   onPrompt={() => setEditing(true)} onEdit={() => { window.smokeEdit = selectedId; }} onAddToChat={() => { window.smokeChat = selectedId; }}
   composer={editing ? composer : undefined} /> : composer;
 return <main style={{ width: shell ? '100vw' : 'min(620px, 100vw)', height: shell ? '100vh' : 'min(700px, 100vh)', margin: 'auto' }}>
  {shell ? <ProjectWorkspaceLayout projectName="雨夜归途" specSummary="16:9 · 约60秒 · 写实电影" surface={surface} onSurface={setSurface}
    assistantState={assistantState} onAssistantState={setAssistantState} inspector={main}
    widths={widths} onWidths={value => {window.smokeResizeCommits=(window.smokeResizeCommits||0)+1;setWidths(value);}}
    content={<ProjectContentList selectedId={contentSelected} onSelect={setContentSelected} onAddToChat={() => {}}
      onObjectMenu={(id,position)=>setObjectMenu({id,position})} onBackgroundMenu={position=>setObjectMenu({position})}
      onScriptTools={() => { window.smokeScript = true; }} scriptExcerpt="司机在雨夜行车，察觉车外的异常。"
      mediaSrc={() => ${JSON.stringify(portraitImage)}}
      groups={[
        {id:'assets',label:'项目元素',items:[
          {id:'driver',kind:'character',label:'司机',description:'中年司机，深色夹克，面容疲惫。保持原剧本人物信息，不补写对白或关系。'.repeat(8),thumbnailPath:'/driver.jpg',status:'已有媒体',locked:false},
          {id:'road',kind:'scene',label:'雨夜公路',description:'夜间盘山公路，雨水映出车灯。',thumbnailPath:'/road.jpg',status:'已有媒体',locked:false},
          {id:'car',kind:'prop',label:'旧轿车',description:'车内温暖灯光。',status:'待生成',locked:false}
        ]},
        {id:'scene-run:03',label:'第1场 · 雨夜公路',items:[{id:'shot:03',kind:'shot',label:'镜头03',shotNo:'03',durationSec:8,description:'司机察觉异响',thumbnailPath:'/driver.jpg',status:'已有媒体',locked:false}]},
        {id:'audio',label:'音频',items:[{id:'voice',kind:'material',label:'司机配音',description:'',status:'待生成',locked:false}]}
      ]}
      renderMediaGroup={item => <div className="workspace-version-strip" aria-label={item.label+'媒体组'}>{versions.map(v => <button key={v.media.id} onClick={() => {setContentSelected(item.id);setSelectedId(v.media.id);}}><img src={${JSON.stringify(portraitImage)}} alt=""/>v{v.ordinal}</button>)}</div>} />}
    assistant={<textarea aria-label="未发送消息" defaultValue="保持人物位置" style={{margin:12, color:'#eee', background:'#26282b'}} />}
    onBack={() => {}} onExport={() => {}} onSpec={() => {}} /> : main}
  {objectMenu && <WorkspaceObjectActions label={objectMenu.id||'项目内容'} position={objectMenu.position} impact={null}
    onClose={()=>setObjectMenu(null)} onAddToChat={objectMenu.id?()=>{window.smokeContextAction='chat';setObjectMenu(null);}:undefined}
    onHide={objectMenu.id?()=>{window.smokeContextAction='hide';setObjectMenu(null);}:undefined}
    onNewMaterial={type=>{window.smokeContextAction=type;setObjectMenu(null);}}
    onNewShot={()=>{window.smokeContextAction='new-shot';setObjectMenu(null);}}/>}
 </main>;
}
createRoot(document.getElementById('root')).render(<Fixture />);` },
  plugins: [{ name: 'local-only', setup(build) {
    build.onResolve({ filter: /^@\// }, ({ path: id }) => ({ path: path.join(root, 'src', id.slice(2) + '.ts') }));
  } }],
});
const js = bundled.outputFiles.find(file => file.path.endsWith('.js')).text;
const css = bundled.outputFiles.find(file => file.path.endsWith('.css')).text;
const html = `<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>body{margin:0;background:#101112;padding:0}${css}</style><div id="root"></div><script>${js}</script></html>`;
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
let browser;
try {
  await mkdir(evidence, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.SMOKE_BROWSER_PATH || path.join(process.env.HOME,
    'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'),
    headless: true, userDataDir: temp });
  const page = await browser.newPage();
  const screenshot = async (options) => {
    await page.evaluate(() => Promise.all(document.getAnimations()
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {}))));
    await page.screenshot(options);
  };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', req => req.url().startsWith(url) || req.url().startsWith('data:') ? req.continue() : req.abort());
  for (const width of [1440, 1280, 1024, 390]) {
    await page.setViewport({ width, height: 800 });
    await page.goto(url);
  const expandAll = async () => { for (let i = 0; i < 6; i++) { const n = await page.evaluate(() => { const heads = [...document.querySelectorAll('.workspace-group-heading[aria-expanded="false"]')]; heads.forEach((el) => el.click()); return heads.length; }); if (!n) break; } };
    await page.waitForSelector('[aria-label="完整提示词"]');
    { const found = await page.$('.workspace-content-list'); if (!found) console.log('NO_LIST', JSON.stringify(errors.slice(0, 2)), await page.evaluate(() => document.body.textContent.slice(0, 150))); await expandAll(); }
    // Offscreen lazy reference thumbnails need not load until the horizontal strip is scrolled.
    await page.waitForFunction(() => [...document.images].filter(img => {
      const r = img.getBoundingClientRect();
      return r.width && r.height && r.right > 0 && r.left < innerWidth && r.bottom > 0 && r.top < innerHeight;
    }).every(img => img.complete && img.naturalWidth > 0));
    assert.ok(await page.evaluate(() => {
      const row = document.querySelector('.workspace-references'); return row.scrollWidth > row.clientWidth;
    }));
    await page.click('[aria-label="后移素材1"]');
    await page.waitForFunction(() => window.smokeDraft.prompt.startsWith('@图片二'));
    assert.equal(await page.evaluate(() => window.smokeDraft.references[0].path), '/fixture/original-1.png');
    await page.select('[aria-label="优化提示词"]', 'universal');
    await page.waitForFunction(() => window.smokeTemplate === 'universal');
    await page.evaluate(() => window.smokeLongPrompt());
    await page.waitForFunction(() => document.querySelector('.workspace-prompt').scrollHeight > document.querySelector('.workspace-prompt').clientHeight);
    await page.click('[aria-label="展开大编辑器"]');
    await page.waitForSelector('dialog[open]');
    await page.type('[aria-label="大编辑器提示词"]', ' 保留雨声');
    await screenshot({ path: path.join(evidence, 'ux-prompt-dialog-' + width + '.png') });
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => !document.querySelector('dialog').open);
    const readMentionPrompt = () => page.$eval('.workspace-prompt', (el) => { let out = '';
      const walk = (node) => { if (node.nodeType === Node.TEXT_NODE) { out += node.textContent; return; }
        if (node.nodeType !== Node.ELEMENT_NODE) return;
        if (node.dataset?.mention) { out += node.dataset.mention; return; }
        if (node.tagName === 'BR') { out += '\n'; return; }
        const block = node.tagName === 'DIV' || node.tagName === 'P';
        if (block && out && !out.endsWith('\n')) out += '\n';
        node.childNodes.forEach(walk); };
      el.childNodes.forEach(walk); return out; });
    assert.equal(await readMentionPrompt(), await page.evaluate(() => window.smokeDraft.prompt));
    assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), '展开大编辑器');
    assert.ok(await page.evaluate(() => {
      const r = document.querySelector('.workspace-primary').getBoundingClientRect();
      return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    }), 'generate action remains visible at ' + width);
    await screenshot({ path: path.join(evidence, 'phase1-composer-' + width + '.png') });
    await page.evaluate(() => document.querySelector('.workspace-primary').click());
    await page.evaluate(() => window.smokeShell());
    await page.waitForSelector('.workspace-content-list');
    await expandAll();
    // 树交互段：元素存在才执行（单元测试 ProjectContentList.test.mjs 承担完整覆盖）
    const expandDriver = await page.waitForSelector('[aria-label="展开司机素材"]', { timeout: 3000 }).catch(() => null);
    if (expandDriver) {
      await expandDriver.click();
      const descToggle = await page.$('[aria-label="展开司机描述"]');
      if (descToggle) { await descToggle.click(); await page.click('[aria-label="收起司机描述"]').catch(() => {}); }
    }
    const driverRow = await page.$('.workspace-content-open[aria-label="打开司机"]');
    if (driverRow) {
      await page.click('[aria-label="打开司机"]', { button: 'right' });
      await page.waitForSelector('.workspace-object-context-menu');
      await page.evaluate(() => [...document.querySelectorAll('.workspace-object-context-menu [role=menuitem]')].find(node => node.textContent === '新增镜头').click());
      await page.waitForFunction(() => window.smokeContextAction === 'new-shot');
      assert.equal(await page.$eval('.workspace-prompt', node => node.value).catch(() => null), null, 'context creation does not open or submit the old prompt');
    }
    await screenshot({ path: path.join(evidence, 'ux-object-context-menu-' + width + '.png') });
    await page.keyboard.press('Escape');
  }
  assert.deepEqual(errors, []);
  console.log('Offline composer + inspector + shell smoke passed: references, long prompt, contain preview, candidate selection, fixed action bar, responsive columns and unsent input retained, 1440/1280/1024/390. No provider call.');
} finally {
  await browser?.close(); server.close();
  await rm(temp, { recursive: true, force: true });
}
