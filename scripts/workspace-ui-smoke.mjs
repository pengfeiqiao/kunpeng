// Offline component smoke: real components/confirmation store, in-memory project
// persistence, no application bootstrap, no provider or Tauri invocation.
import { build } from 'esbuild';
import postcss from 'postcss';
import tailwind from 'tailwindcss';
import puppeteer from 'puppeteer-core';
import { createServer } from 'node:http';
import { readFile, mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = path.resolve(import.meta.dirname, '..');
const evidence = path.join(root, 'docs/workspace-evidence');
const temp = await mkdtemp(path.join(tmpdir(), 'kunpeng-ui-smoke-'));
const mockStores = `
import { create } from 'zustand';
export const useWorkshopStore = create(() => ({ data: { projectId: 'smoke-only', projectSnapshots: [
 { id: 'delete', label: '删除前 · 镜头03', createdAt: 1788570497912 },
 { id: 'message', label: '修改前 · 提示词', messageId: 'm', createdAt: 1788570400000 }
] } }));
export const useUnifiedProjectStore = create(() => ({ activeId: 'smoke-only', restoreProjectSnapshot: async (id) => {
 window.smokeRestored = id; return { status: 'restored' };
} }));
`;
const bundle = await build({
  absWorkingDir: root, bundle: true, write: false, format: 'iife', platform: 'browser', jsx: 'automatic',
  define: { 'process.env.NODE_ENV': '"production"' },
  stdin: { resolveDir: root, loader: 'tsx', contents: `
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ToolConfirmDialog } from './src/components/ToolConfirmDialog';
import ProjectSnapshotPanel from './src/components/projects/ProjectSnapshotPanel';
import ProjectReferenceSource from './src/components/chat/ProjectReferenceSource';
import { useToolConfirmStore } from './src/stores/toolConfirmStore';
import { createProjectConversationReference, PROJECT_AGENT_CONTEXT_EVENT } from './src/lib/projectObjects/conversationRefs';
window.smokeDecisions = [];
window.addEventListener(PROJECT_AGENT_CONTEXT_EVENT, e => { window.smokeQuote = e.detail.references[0]; });
window.startConfirmations = () => {
 for (let n = 1; n <= 3; n++) useToolConfirmStore.getState().requestConfirm('image_generate', {
  prompt: '镜头' + n + '：司机听到异响，保持原剧本对白与人物关系。', engine: 'gpt-image-2',
  reference_urls: ['/fixture/original.png'], params: { aspect_ratio: '16:9' }
 }, undefined, { scope: 'smoke', risk: 'ask' }).then(allowed => window.smokeDecisions.push([n, allowed]));
};
function App() {
 const [snapshots, setSnapshots] = useState(false);
 return <main className="canvas-dark" style={{ padding: 32, background: '#121214', color: '#eee', height: '100vh' }}>
  <button id="snapshots" onClick={() => setSnapshots(true)}>项目快照</button>
  <div style={{ marginTop: 40, width: 'min(600px, 100%)' }}>
   <ProjectReferenceSource projectId="smoke-only" reference={createProjectConversationReference({ objectId: 'shot:s', kind: 'shot', label: '镜头03', sourceView: 'workshop' })}>
    <textarea id="quote" defaultValue="以 @图片一 为参考，司机转头看向右侧。保留原对白。" style={{ width: '100%', height: 120, color: '#eee', background: '#222' }} />
   </ProjectReferenceSource>
  </div>
  <ToolConfirmDialog />
  {snapshots && <ProjectSnapshotPanel onClose={() => setSnapshots(false)} />}
 </main>;
}
createRoot(document.getElementById('root')).render(<App />);
` },
  plugins: [{ name: 'offline-project', setup(build) {
    build.onResolve({ filter: /^@\/stores\/(workshopStore|unifiedProjectStore)$/ }, () => ({ path: 'stores', namespace: 'offline' }));
    build.onResolve({ filter: /^@\/lib\/canvas\/generationDraftPreview$/ }, () => ({ path: 'preview', namespace: 'offline' }));
    build.onResolve({ filter: /^@tauri-apps\/api\/dialog$/ }, () => ({ path: 'dialog', namespace: 'offline' }));
    build.onLoad({ filter: /.*/, namespace: 'offline' }, ({ path: id }) => ({ contents: id === 'stores' ? mockStores
      : id === 'preview' ? 'export const buildCanvasGenerationDraft = () => null;'
      : 'export const confirm = async () => false;', loader: 'js', resolveDir: root }));
    build.onResolve({ filter: /^@\// }, ({ path: id }) => ({ path: path.join(root, 'src', id.slice(2) + (path.extname(id) ? '' : '.ts')) }));
  } }],
});
const css = (await postcss([tailwind({ content: [path.join(root, 'src/**/*.{ts,tsx}')], theme: { extend: {} } })])
  .process(await readFile(path.join(root, 'src/index.css'), 'utf8'), { from: path.join(root, 'src/index.css') })).css;
const html = `<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><style>${css}</style><div id="root"></div><script>${bundle.outputFiles[0].text}</script></html>`;
const server = createServer((_req, res) => { res.setHeader('Content-Type', 'text/html'); res.end(html); });
let browser;
try {
  await mkdir(evidence, { recursive: true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  browser = await puppeteer.launch({ executablePath: process.env.SMOKE_BROWSER_PATH
    || path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing'), headless: true, userDataDir: temp });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.setRequestInterception(true);
  page.on('request', req => req.url().startsWith(url) || req.url().startsWith('data:') ? req.continue() : req.abort());
  await page.setViewport({ width: 1280, height: 800 });
  await page.goto(url);
  await page.waitForSelector('#quote');
  await page.evaluate(() => window.startConfirmations());
  await page.waitForFunction(() => document.body.innerText.includes('第 1/3 条'));
  await page.screenshot({ path: path.join(evidence, 'a1-confirmation-queue.png') });
  const clickText = async (text) => {
    const found = await page.evaluate(text => {
      const button = [...document.querySelectorAll('button')].find(button => button.textContent.trim() === text);
      button?.click(); return Boolean(button);
    }, text);
    assert.ok(found, text);
  };
  await clickText('确认本项');
  await page.waitForFunction(() => document.body.innerText.includes('第 2/3 条'));
  await clickText('拒绝');
  await page.waitForFunction(() => document.body.innerText.includes('第 3/3 条'));
  await clickText('允许');
  await page.waitForFunction(() => window.smokeDecisions.length === 3);
  assert.deepEqual(await page.evaluate(() => window.smokeDecisions), [[1, true], [2, false], [3, true]]);
  await page.evaluate(() => { window.smokeDecisions = []; window.startConfirmations(); });
  await page.waitForFunction(() => document.body.innerText.includes('全部确认（3）'));
  await clickText('全部确认（3）');
  await page.waitForFunction(() => window.smokeDecisions.length === 3);
  assert.deepEqual(await page.evaluate(() => window.smokeDecisions), [[1, true], [2, true], [3, true]]);
  await page.waitForSelector('.pointer-events-auto', { hidden: true });
  await page.click('#snapshots');
  await page.waitForSelector('[aria-label="项目快照"]');
  await page.screenshot({ path: path.join(evidence, 'a5-snapshots.png') });
  await page.click('[title="回到此刻"]');
  await page.waitForFunction(() => window.smokeRestored === 'delete');
  await page.focus('#quote');
  await page.evaluate(() => { const input = document.querySelector('#quote'); input.setSelectionRange(0, 10); input.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 130 })); });
  await page.waitForFunction(() => document.body.innerText.includes('添加到对话'));
  await page.screenshot({ path: path.join(evidence, 'a6-selection.png') });
  await clickText('添加到对话');
  await page.waitForFunction(() => window.smokeQuote?.kind === 'text-selection');
  assert.match(await page.evaluate(() => window.smokeQuote.quotedText), /@图片一/);
  assert.equal(await page.evaluate(() => window.smokeQuote.operationScope), 'read');
  for (const width of [1440, 1024, 390]) {
    await page.setViewport({ width, height: 800 });
    await page.evaluate(() => window.startConfirmations());
    await page.waitForFunction(() => document.body.innerText.includes('全部确认（3）'));
    assert.ok(await page.evaluate(() => [...document.querySelectorAll('button')].filter(button => /确认|拒绝/.test(button.textContent)).every(button => {
      const r = button.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight;
    })), 'confirmation actions fit ' + width);
    await page.screenshot({ path: path.join(evidence, `a1-confirmation-${width}.png`) });
    await clickText('全部确认（3）');
  }
  assert.deepEqual(errors, []);
  console.log('Offline UI smoke passed: FIFO/cancel/all-confirm, snapshots, text selection, 1440/1280/1024/390 action bounds.');
} finally {
  await browser?.close();
  server.close();
  await rm(temp, { recursive: true, force: true });
}
