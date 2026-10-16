import test from 'node:test';
import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { createServer } from 'node:http';
import path from 'node:path';
import puppeteer from 'puppeteer-core';

const root = path.resolve(import.meta.dirname, '../../..');

test('browser: long copy document keeps a bounded viewport and coalesces React writeback', { timeout: 60_000 }, async () => {
  const result = await build({
    absWorkingDir: root,
    bundle: true,
    write: false,
    outfile: '/tmp/kunpeng-long-document-editor.js',
    format: 'iife',
    platform: 'browser',
    jsx: 'automatic',
    alias: { '@': path.join(root, 'src') },
    define: { 'process.env.NODE_ENV': '"development"' },
    stdin: {
      resolveDir: root,
      loader: 'tsx',
      contents: `
        import React from 'react';
        import { createRoot } from 'react-dom/client';
        import Editor from './src/components/copywriting/LongDocumentEditor';
        const content = Array.from({ length: 20000 }, (_, i) => '## 第 ' + i + ' 段\\n这是一段用于验证长文稿可视区渲染的正文。').join('\\n');
        window.originalContent = content;
        window.changes = [];
        const root = createRoot(document.getElementById('root'));
        window.setExternal = value => root.render(
          <div style={{height:'720px'}}><Editor value={value} onChange={next => changes.push(next)} onSelectionChange={() => {}} /></div>
        );
        setExternal(content);
      `,
    },
  });
  const js = result.outputFiles.find(file => file.path.endsWith('.js')).text;
  const server = createServer((request, response) => {
    response.end(request.url === '/app.js'
      ? js
      : '<style>html,body,#root{height:100%;margin:0}</style><div id="root"></div><script src="/app.js"></script>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: process.env.BROWSER_BIN || path.join(root, '.local-browsers/chromium/mac_arm-1651413/chrome-mac/Chromium.app/Contents/MacOS/Chromium'),
      headless: true,
    });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForSelector('.cm-content', { timeout: 5000 });

    const initial = await page.evaluate(() => ({
      renderedLines: document.querySelectorAll('.cm-line').length,
      scrollHeight: document.querySelector('.cm-scroller').scrollHeight,
      clientHeight: document.querySelector('.cm-scroller').clientHeight,
    }));
    assert.ok(initial.renderedLines < 500, `rendered ${initial.renderedLines} lines`);
    assert.ok(initial.scrollHeight > initial.clientHeight * 100);

    await page.evaluate(() => {
      const scroller = document.querySelector('.cm-scroller');
      scroller.scrollTop = scroller.scrollHeight;
      scroller.dispatchEvent(new Event('scroll'));
    });
    await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(await page.evaluate(() => document.querySelectorAll('.cm-line').length < 500));

    await page.evaluate(() => setExternal(originalContent + '\nAI 外部写入'));
    await new Promise(resolve => setTimeout(resolve, 450));
    assert.equal(await page.evaluate(() => changes.length), 0);

    await page.focus('.cm-content');
    await page.keyboard.type('连续输入不会逐字触发 React');
    await new Promise(resolve => setTimeout(resolve, 550));
    assert.equal(await page.evaluate(() => changes.length), 1);
    assert.deepEqual(errors, []);
  } finally {
    await browser?.close();
    await new Promise(resolve => server.close(resolve));
  }
});
