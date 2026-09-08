// 引擎切换参考保留探针：真实 GenerationComposer + WorkspaceEngineMenu，2.5 带参考 → 点选 Seedance 2.0。
import { build } from 'esbuild';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const temp = await mkdtemp(path.join(tmpdir(), 'kunpeng-engine-probe-'));
const bundled = await build({ absWorkingDir: root, bundle: true, write: false, outfile: path.join(temp, 'fixture.js'), format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' }, stdin: { resolveDir: root, loader: 'tsx', contents: `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import GenerationComposer from './src/components/workspace/GenerationComposer';
import { WORKSPACE_ENGINES } from './src/lib/workspace/engineCatalog';
const refs = [
  { id: 'm1', type: 'image', path: '/a.png', label: '场景 雨夜街角' },
  { id: 'm2', type: 'image', path: '/b.png', label: '角色 Zenith' },
  { id: 'm3', type: 'video', path: '/c.mp4', label: '参考视频' },
];
function Fixture() {
  const [draft, setDraft] = useState({ id: 'shot:s::video', projectId: 'P', objectId: 'shot:s', outputType: 'video',
    prompt: '@图片一 A @图片二 B @视频一 C', engineId: 'dreamina-seedance-2.5',
    params: { ratio: '16:9', duration: '5', resolution: '720p' }, references: refs, revision: 0, updatedAt: 0 });
  window.__draft = draft;
  return <div style={{ width: 560, margin: '200px auto 0', background: '#1b1b1d', padding: 12 }}>
    <GenerationComposer draft={draft} engines={WORKSPACE_ENGINES.filter((e) => ['dreamina-seedance-2.5', 'seedance-2.0', 'seedance-2.0-t2v', 'seedance-2.0-fast', 'seedance-2.0-mini-i2v', 'seedance-2.0-mini-t2v', 'startend-v3.1-pro', 'wan-3.0', 'minimax-hailuo-h3'].includes(e.id)).map((engine) => ({ engine }))}
      mediaSrc={() => ''} onChange={(next) => { window.__changes = [...(window.__changes ?? []), next]; setDraft(next); }}
      onGenerate={() => {}} onClose={() => {}} onAddReference={() => {}} onOptimize={() => {}} />
  </div>;
}
createRoot(document.getElementById('root')).render(<Fixture />);
` },
  plugins: [{ name: 'alias', setup(b) { b.onResolve({ filter: /^@\// }, ({ path: id }) => ({ path: path.join(root, 'src', id.slice(2) + '.ts') })); } }],
});
const js = bundled.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = bundled.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';
const server = createServer((_q, res) => { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(`<meta charset="utf-8"><style>html,body,#root{margin:0;height:100%;background:#111}${css}</style><div id="root"></div><script>${js}</script>`); });
let browser;
try {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  browser = await puppeteer.launch({ executablePath: process.env.SMOKE_BROWSER_PATH || path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), headless: true, userDataDir: temp });
  const page = await browser.newPage();
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${server.address().port}`);
  await page.waitForSelector('.workspace-engine-trigger');
  // 打开模型菜单，点 Seedance 2.0
  await page.click('.workspace-engine-trigger');
  await page.waitForSelector('.workspace-engine-popover');
  const options = await page.$$eval('.workspace-engine-option', (els) => els.map((el) => el.textContent.trim()));
  console.log('MENU:', JSON.stringify(options));
  await page.$$eval('.workspace-engine-option', (els) => els.find((el) => el.textContent.includes('Seedance 2.0') && !el.textContent.includes('Mini') && !el.textContent.includes('Fast'))?.click());
  await new Promise((r) => setTimeout(r, 300));
  const after = await page.evaluate(() => ({ engineId: window.__draft.engineId, refs: window.__draft.references.map((r) => r.path), prompt: window.__draft.prompt,
    changes: (window.__changes ?? []).map((c) => ({ engineId: c.engineId, refs: c.references.map((r) => r.path) })) }));
  console.log('AFTER 2.5→2.0:', JSON.stringify(after, null, 1));
  // 再切到 Fast（fast 档同样支持 图≤9/视频≤3/音频≤3，应全保留）
  await page.click('.workspace-engine-trigger');
  await page.waitForSelector('.workspace-engine-popover');
  await page.$$eval('.workspace-engine-option', (els) => els.find((el) => el.textContent.includes('Fast'))?.click());
  await new Promise((r) => setTimeout(r, 300));
  console.log('AFTER →Fast:', JSON.stringify(await page.evaluate(() => ({ engineId: window.__draft.engineId, refs: window.__draft.references.map((r) => r.path) }))));
  // 切回 2.0 再开"视频参考模式"抽屉选首尾帧：应保留前 2 张图（首帧+尾帧），视频参考按不支持移除
  await page.click('.workspace-engine-trigger');
  await page.waitForSelector('.workspace-engine-popover');
  await page.$$eval('.workspace-engine-option', (els) => els.find((el) => el.textContent.trim().startsWith('Seedance 2.0') && !el.textContent.includes('Mini') && !el.textContent.includes('Fast'))?.click());
  await new Promise((r) => setTimeout(r, 200));
  await page.click('[aria-label="视频参考模式"]');
  await page.waitForSelector('[role="group"][aria-label="视频参考模式"]');
  console.log('MODES:', await page.$eval('[role="group"][aria-label="视频参考模式"]', (el) => el.textContent));
  await page.$$eval('[role="group"][aria-label="视频参考模式"] .workspace-engine-option', (els) => els.find((el) => el.textContent.includes('首尾帧'))?.click());
  await new Promise((r) => setTimeout(r, 300));
  console.log('AFTER →首尾帧:', JSON.stringify(await page.evaluate(() => ({ engineId: window.__draft.engineId, refs: window.__draft.references.map((r) => r.path) }))));
  if (errors.length) console.log('PAGE ERRORS:', errors);
} finally { await browser?.close(); server.close(); await rm(temp, { recursive: true, force: true }); }
