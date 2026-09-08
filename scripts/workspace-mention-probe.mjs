// @ 引用增强视觉探针：芯片高亮、悬停缩略图、@ 选择器。
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'kunpeng-mention-probe-'));
const evidence = path.join(root, 'docs/workspace-evidence');
const image = `data:image/jpeg;base64,${(await readFile(path.join(root, 'public/midjourney-styles/director/raw-flash-intimacy.jpg'))).toString('base64')}`;
const bundled = await build({ absWorkingDir: root, bundle: true, write: false, outfile: path.join(temp, 'fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, stdin: { resolveDir: root, loader: 'tsx', contents: `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import MentionPromptInput from './src/components/workspace/MentionPromptInput';
const refs = [
  { id: 'r1', type: 'image', path: '/a.png', label: '雨夜公路 · 场景定版' },
  { id: 'r2', type: 'image', path: '/b.png', label: '司机 · 角色定版' },
];
function Fixture() {
  const [draft, setDraft] = useState({ id: 'd', projectId: 'P', objectId: 'O', outputType: 'video',
    prompt: '@图片一 深夜便利店冷白灯光，@图片二 林风站在货架前。中景，电影感构图。\\n动作推进，镜头缓慢推近。',
    engineId: 'fixture', params: {}, references: refs, revision: 0, updatedAt: 0 });
  return <div style={{ width: 520, margin: '330px auto 0', height: 200, display: 'flex', background: '#1b1b1d', padding: 12 }}>
    <MentionPromptInput draft={draft} onChange={setDraft} mediaSrc={() => ${JSON.stringify(image)}}
      candidates={[...refs, { id: 'r3', path: '/c.png', label: '便利店外景' }]} ariaLabel="完整提示词" />
  </div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
` },
  plugins: [{ name: 'alias', setup(b) { b.onResolve({ filter: /^@\// }, ({ path: id }) => ({ path: path.join(root, 'src', id.slice(2) + '.ts') })); } }],
});
const js = bundled.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = bundled.outputFiles.find((f) => f.path.endsWith('.css')).text;
const server = createServer((_q, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;background:#111}${css}</style><div id="root"></div><script>${js}</script>`); });
let browser;
try {
  await mkdir(evidence, { recursive: true });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.SMOKE_BROWSER_PATH || path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), headless: true, userDataDir: temp });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.text().includes('mention-debug')) console.log('PAGELOG', m.text()); });
  await page.evaluateOnNewDocument(() => { window.__mentionDebug = true; });
  await page.setRequestInterception(true);
  page.on('request', (req) => req.url().startsWith(url) || req.url().startsWith('data:') ? req.continue() : req.abort());
  await page.setViewport({ width: 900, height: 600 });
  await page.goto(url);
  await new Promise((r) => setTimeout(r, 500));
  if (errors.length) { console.log('EARLY PAGE ERRORS:', errors); }
  console.log('BODY:', await page.evaluate(() => document.body.textContent.slice(0, 200)));
  console.log('DOM:', await page.evaluate(() => document.querySelector('.workspace-mention-root')?.outerHTML.slice(0, 500) ?? 'NO ROOT'));
  console.log('REGEX-IN-PAGE:', await page.evaluate(() => {
    const value = document.querySelector('textarea')?.value ?? '';
    return JSON.stringify({ value: value.slice(0, 40), matches: [...value.matchAll(/@图片[一二三四五六七八九十百零]+/g)].map((m) => m[0]) });
  }));
  await page.waitForSelector('.workspace-mention-chip');
  await page.screenshot({ path: path.join(evidence, 'mention-1-chips.png') });
  // 悬停芯片 → 缩略图浮层
  await page.hover('.workspace-mention-chip');
  await new Promise((r) => setTimeout(r, 250));
  await page.screenshot({ path: path.join(evidence, 'mention-2-hover.png') });
  // 输入 @ → 选择器
  await page.click('.workspace-mention-editor');
  await page.keyboard.press('End');
  await page.keyboard.type('@');
  await new Promise((r) => setTimeout(r, 300));
  console.log('DEBUG after-at:', await page.evaluate(() => ({
    text: document.querySelector('.workspace-mention-editor').innerText.slice(-20),
    hasPicker: Boolean(document.querySelector('.workspace-mention-picker')),
    active: document.activeElement?.className,
  })));
  await page.waitForSelector('.workspace-mention-picker');
  await page.screenshot({ path: path.join(evidence, 'mention-3-picker.png') });
  // 点击候选 → 插入引用 + 参考入列
  await page.click('.workspace-mention-picker .workspace-mention-menu-item:last-of-type');
  await new Promise((r) => setTimeout(r, 200));
  const result = await page.evaluate(() => ({ prompt: document.querySelector('.workspace-mention-editor').innerText,
    refs: window.__lastDraft?.references?.length }));
  console.log('AFTER-PICK', JSON.stringify(result));
  await page.screenshot({ path: path.join(evidence, 'mention-4-inserted.png') });
  if (errors.length) console.log('PAGE ERRORS:', errors);
  console.log('mention probe done');
} finally { await browser?.close(); server.close(); await rm(temp, { recursive: true, force: true }); }
