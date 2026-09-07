import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

test('offline layout browser: pointer, keyboard, project widths, breakpoint and chrome geometry', {
  skip: process.env.WORKSPACE_LAYOUT_BROWSER_TEST !== '1', timeout: 60000,
}, async () => {
  const { build } = await import('esbuild');
  const { default: puppeteer } = await import('puppeteer-core');
  const root = path.resolve(import.meta.dirname, '../../..');
  const evidence = await mkdtemp(path.join(tmpdir(), 'workspace-layout-evidence-'));
  const bundle = await build({ absWorkingDir: root, bundle: true, write: false, outfile: '/tmp/layout-fixture.js',
    format: 'iife', platform: 'browser', jsx: 'automatic', define: { 'process.env.NODE_ENV': '"production"' },
    stdin: { resolveDir: root, loader: 'tsx', contents: `
import {useState} from 'react'; import {createRoot} from 'react-dom/client';
import Layout from './src/components/workspace/ProjectWorkspaceLayout';
import Composer from './src/components/workspace/GenerationComposer';
import Inspector from './src/components/workspace/MediaInspector';
const seed={id:'a::video',objectId:'a',projectId:'P',outputType:'video',engineId:'fixture',prompt:'人物听到异响后，转头看向窗外。保持对白和镜头运动。'.repeat(50),params:{ratio:'16:9',duration:'8'},references:[],revision:0,updatedAt:0};
const engines=[{engine:{id:'fixture',label:'本地测试模型',kind:'video',params:[{key:'ratio',label:'比例',type:'list',options:['16:9','9:16']},{key:'duration',label:'时长',type:'list',options:['5','8','15']},{key:'other',label:'其他设置',type:'boolean',default:false}]}}];
function Fixture(){const [p,setP]=useState('A'),[saved,setSaved]=useState({A:{content:320,assistant:360},B:{content:250,assistant:300}}),[surface,setSurface]=useState('media'),[view,setView]=useState('list'),[assistant,setAssistant]=useState('expanded'),[draft,setDraft]=useState(seed);
window.fixture={saved,p,setP,setSurface,setView,setAssistant,setWidths:(value)=>setSaved(old=>({...old,[p]:value}))}; window.widthWrites??=[];
return <Layout key={p} projectName="雨夜归途" specSummary="16:9 · 写实电影 · 本地夹具" surface={surface} mediaView={view} onMediaView={setView} onSurface={setSurface} assistantState={assistant} onAssistantState={setAssistant} widths={saved[p]} onWidths={value=>{window.widthWrites.push({p,value});setSaved(old=>({...old,[p]:value}));}} onBack={()=>{}} onExport={()=>{}} onSpec={()=>{}} onNewMaterial={()=>{}}
content={<div style={{padding:12}}><h2 style={{fontSize:14}}>项目内容</h2>{Array.from({length:6},(_,i)=><details key={i} open><summary>镜头 {i+1}</summary><p>雨声里，人物转身。</p></details>)}</div>}
inspector={<Inspector title="镜头 03 · 人物近景" versions={[]} mediaSrc={()=>''} onSelect={()=>{}} onAdopt={()=>{}} onPrompt={()=>{}} onEdit={()=>{}} onAddToChat={()=>{}} composer={<Composer draft={draft} engines={engines} mediaSrc={()=>''} onChange={setDraft} onGenerate={()=>{}} onClose={()=>{}} onAddReference={()=>{}} onOptimize={()=>{}}/>}/>}
canvas={<div style={{height:'100%',background:'#22262b',display:'grid',placeItems:'center'}}>画布夹具</div>}
assistant={<div style={{height:'100%',display:'flex',flexDirection:'column',padding:12}}><p>仅本地测试，无业务调用。</p><textarea aria-label="助手未发送输入" defaultValue="保留人物位置" style={{marginTop:'auto',background:'#242629',color:'#eee'}} /></div>}/>;
}createRoot(document.getElementById('root')).render(<Fixture/>);` },
    plugins: [{ name: 'aliases', setup(b) { b.onResolve({ filter: /^@\// }, ({ path: id }) => ({ path: path.join(root, 'src', id.slice(2) + '.ts') })); } }],
  });
  const js = bundle.outputFiles.find((file) => file.path.endsWith('.js')).text;
  const css = bundle.outputFiles.find((file) => file.path.endsWith('.css')).text;
  const browser = await puppeteer.launch({ executablePath: process.env.SMOKE_BROWSER_PATH || path.join(process.env.HOME,
    'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), headless: true });
  const page = await browser.newPage();
  try {
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.setRequestInterception(true);
    page.on('request', (request) => request.abort());
    const rect = (selector) => page.$eval(selector, (element) => { const r = element.getBoundingClientRect();
      return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right, bottom: r.bottom }; });
    const settle = () => page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await page.setViewport({ width: 1440, height: 900 });
    await page.setContent('<meta name="viewport" content="width=device-width"><style>html,body,#root{margin:0;width:100%;height:100%;background:#111214}' + css + '</style><div id="root"></div><script>' + js + '</script>');
    await page.waitForSelector('[role="separator"]');
    const left = '[aria-label="调整目录宽度"]'; const right = '[aria-label="调整助手宽度"]';
    const leftHandle = await page.$(left);
    await page.evaluate(() => {
      window.resizeDoubleClicks = 0;
      document.querySelector('[aria-label="调整目录宽度"]').addEventListener('dblclick', () => window.resizeDoubleClicks++);
    });
    const handle = await rect(left);
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 100); await page.mouse.down();
    const writes = await page.evaluate(() => widthWrites.length);
    await page.mouse.move(handle.x + handle.width / 2 + 50, handle.y + 100, { steps: 8 });
    assert.equal(await page.evaluate(() => widthWrites.length), writes);
    await page.mouse.up(); await settle();
    assert.equal(await page.evaluate(() => widthWrites.length), writes + 1);
    assert.equal(await page.evaluate(() => fixture.saved.A.content), 370);
    await leftHandle.focus(); await page.keyboard.press('ArrowLeft'); await settle();
    assert.equal(await page.evaluate(() => fixture.saved.A.content), 360);
    assert.equal(await page.evaluate(() => widthWrites.length), 2);
    await leftHandle.click({ count: 2 }); await settle();
    assert.equal(await page.evaluate(() => resizeDoubleClicks), 1, 'the browser delivered a native dblclick');
    assert.equal(await page.evaluate(() => fixture.saved.A.content), 320, 'double click after drag restores default');
    assert.equal(await page.evaluate(() => widthWrites.length), 3, 'reset commits exactly once');
    console.log('ElementHandle native dblclick: content 320 -> drag 370 -> ArrowLeft 360 -> reset 320; commits 0 -> 1 -> 2 -> 3.');
    await page.focus(right); await page.keyboard.press('End'); await settle();
    await page.evaluate(() => fixture.setP('B')); await settle();
    assert.equal(Math.round((await rect('.workspace-content-column')).width), 250);
    await page.evaluate(() => fixture.setP('A')); await settle();
    assert.equal(Math.round((await rect('.workspace-content-column')).width), 320);
    await page.screenshot({ path: path.join(evidence, 'layout-desktop-resized.png') });
    for (const width of [1440, 1280, 1200, 1199, 1024, 390]) {
      await page.setViewport({ width, height: 900 }); await settle();
      await page.evaluate(() => fixture.setWidths({ content: 480, assistant: 560 })); await settle();
      const center = await rect('.workspace-inspector-column');
      assert.ok(center.right <= width, 'center overflow ' + width);
      if (width >= 1200) {
        assert.ok(center.width >= 420, JSON.stringify({ width, center }));
        assert.equal(await page.$$eval('[role="separator"]', (nodes) => nodes.length), 2);
      } else {
        assert.equal(await page.$$eval('[role="separator"]', (nodes) => nodes.length), 0);
        assert.equal(await page.$eval('.workspace-assistant-column', (e) => getComputedStyle(e).display), 'none');
      }
      assert.ok(await page.$$eval('.workspace-topbar button', (nodes) => nodes.every((e) => {
        const r = e.getBoundingClientRect(); return !r.width || (r.left >= 0 && r.right <= innerWidth && r.bottom <= innerHeight);
      })), 'topbar buttons fit ' + width);
      const generate = await rect('.workspace-generation-bar .workspace-primary');
      assert.ok(generate.bottom <= 900 && generate.right <= width, 'generate fits ' + width);
      // 毛玻璃主题：列带 backdrop blur（沉浸黑 + 毛玻璃视觉基调）
      assert.notEqual(await page.$eval('.workspace-inspector-column', (e) => getComputedStyle(e).backdropFilter), 'none');
      if (width < 1200) {
        await page.click('[aria-label="项目助手"]');
        await page.waitForSelector('.workspace-assistant-visible', { visible: true });
        await page.type('[aria-label="助手未发送输入"]', '保留');
        const unsent = await page.$eval('[aria-label="助手未发送输入"]', (e) => e.value);
        await page.click('[aria-label="隐藏助手"]');
        await page.click('[aria-label="项目助手"]');
        assert.equal(await page.$eval('[aria-label="助手未发送输入"]', (e) => e.value), unsent);
        await page.click('[aria-label="隐藏助手"]');
        await page.click('[aria-label="项目目录"]');
        assert.equal(await page.$eval('.workspace-content-column', (e) => getComputedStyle(e).display), 'block');
        await page.click('[aria-label="关闭目录"]');
        await page.evaluate(() => fixture.setAssistant('expanded')); await settle();
      }
      if ([1280, 390].includes(width)) await page.screenshot({ path: path.join(evidence, `layout-${width}.png`) });
      console.log(JSON.stringify({ viewport: width, centerWidth: center.width, centerRight: center.right, generateBottom: generate.bottom }));
    }
    await page.setViewport({ width: 1440, height: 900 }); await settle();
    for (const mode of ['canvas', 'editor']) {
      await page.evaluate((mode) => { fixture.setSurface(mode === 'canvas' ? 'media' : 'editor');
        fixture.setView(mode === 'canvas' ? 'canvas' : 'list'); fixture.setAssistant('hidden'); }, mode); await settle();
      assert.equal(await page.$$eval('[role="separator"]', (nodes) => nodes.length), 0);
      assert.equal(Math.round((await rect('.workspace-inspector-column')).width), 1424);
      await page.click('[aria-label="项目助手"]'); await settle();
      // 画布/剪辑工作面：助手为悬浮式浮层，不产生分隔条、不挤压主区
      assert.equal(await page.$$eval('[role="separator"]', (nodes) => nodes.length), 0, 'assistant floats over ' + mode);
      assert.equal(await page.$eval('.workspace-assistant-column', (e) => getComputedStyle(e).position), 'absolute');
      assert.equal(Math.round((await rect('.workspace-inspector-column')).width), 1424);
      await page.click('[aria-label="放大助手"]'); await settle();
      assert.equal(Math.round((await rect('.workspace-inspector-column')).width), 1424);
      await page.click('[aria-label="还原助手"]'); await settle();
    }
    await page.evaluate(() => { fixture.setSurface('media'); fixture.setView('list'); fixture.setAssistant('expanded'); }); await settle();
    await page.emulateMediaFeatures([{ name: 'prefers-reduced-motion', value: 'reduce' }]);
    assert.equal(await page.$eval('[role="separator"]', (e) => getComputedStyle(e, '::after').transitionDuration), '0s');
    assert.deepEqual(errors, []);
    console.log('Offline browser evidence: ' + evidence);
  } catch (error) {
    await page.screenshot({ path: path.join(evidence, 'failure.png') });
    console.log('Failure evidence: ' + evidence);
    throw error;
  } finally { await browser.close(); }
});
