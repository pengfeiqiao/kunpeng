#!/usr/bin/env node
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import puppeteer from 'puppeteer-core';

const jobPath = process.argv[2];
if (!jobPath) {
  console.error('Usage: node scripts/render-worker.mjs <job.json>');
  process.exit(2);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function log(event, data = {}) {
  console.log(JSON.stringify({ event, ...data }));
}

async function writeProgress(job, event, data = {}) {
  if (!job.progressPath) return;
  const payload = {
    event,
    time: Date.now(),
    ...data,
  };
  await fs.writeFile(job.progressPath, JSON.stringify(payload), 'utf8').catch(() => {});
}

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function findChrome() {
  const isWindows = process.platform === 'win32';
  const bundledRoot = path.resolve(__dirname, '..', '.local-browsers', 'chromium');
  const bundled = [];
  try {
    const platforms = await fs.readdir(bundledRoot);
    for (const platform of platforms) {
      bundled.push(
        // Playwright mac archives unpack to chrome-mac/Chromium.app; win64 to
        // chrome-win/chrome.exe. Probe both regardless of host platform.
        path.join(bundledRoot, platform, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(bundledRoot, platform, 'chrome-win', 'chrome.exe'),
      );
    }
  } catch {}
  const runtimeDownloaded = [];
  // 按需下载的内核（browser_install），公开构建不再打包 Chromium
  const home = os.homedir();
  const runtimeRoot = path.join(home, '.kunpeng', 'browsers', 'chromium');
  try {
    for (const platform of await fs.readdir(runtimeRoot)) {
      runtimeDownloaded.push(
        path.join(runtimeRoot, platform, 'chrome-mac', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'),
        path.join(runtimeRoot, platform, 'chrome-win', 'chrome.exe'),
      );
    }
  } catch {}
  const programFiles = process.env.ProgramFiles || 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local');
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PUPPETEER_EXECUTABLE_PATH,
    ...bundled,
    ...runtimeDownloaded,
    ...(isWindows
      ? [
          path.join(programFiles, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(programFilesX86, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(localAppData, 'Google', 'Chrome', 'Application', 'chrome.exe'),
          path.join(programFiles, 'Chromium', 'Application', 'chrome.exe'),
          // Edge 随 Windows 分发，同源 Chromium，作为兜底保证开箱可用
          path.join(programFilesX86, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
          path.join(programFiles, 'Microsoft', 'Edge', 'Application', 'msedge.exe'),
        ]
      : [
          '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
          '/Applications/Chromium.app/Contents/MacOS/Chromium',
          '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
          '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
          '/Applications/Arc.app/Contents/MacOS/Arc',
        ]),
  ].filter(Boolean);
  for (const p of candidates) {
    if (await exists(p)) return p;
  }
  throw new Error('未找到 Chrome/Chromium/Edge。请安装 Chrome，或设置 CHROME_PATH。');
}

function q(p) {
  return `'${String(p).replace(/'/g, `'\\''`)}'`;
}

async function run(cmd, args, timeoutMs = 600000) {
  await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '';
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`${cmd} 超时`));
    }, timeoutMs);
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve();
      else reject(new Error(`${cmd} 失败: ${stderr.slice(-1200)}`));
    });
  });
}

function buildHtml(job, motionRuntimeSrc) {
  const bg = job.opaqueBackground ? '#000' : 'transparent';
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<style>
html, body {
  margin: 0;
  width: ${job.stageWidth}px;
  height: ${job.stageHeight}px;
  overflow: hidden;
  background: ${bg};
}
*, *::before, *::after { box-sizing: border-box; }
#stage {
  position: relative;
  width: ${job.stageWidth}px;
  height: ${job.stageHeight}px;
  overflow: hidden;
  background: ${bg};
}
${job.css || ''}
</style>
${motionRuntimeSrc ? `<script>\n${motionRuntimeSrc}\n</script>` : ''}
</head>
<body>
<div id="stage">${job.html || ''}</div>
<script>
window.__seekKunpeng = async function(ms) {
  const stage = document.getElementById('stage');
  if (typeof window.__kunpengRenderFrame === 'function') {
    await window.__kunpengRenderFrame(Math.max(0, ms / 1000));
  }
  const layers = Array.from(stage.querySelectorAll('[data-kp-layer]'));
  if (layers.length > 0) {
    for (const layer of layers) {
      const start = Number(layer.dataset.start || 0);
      const end = Number(layer.dataset.end || 0);
      const visible = ms >= start && ms < end;
      layer.style.visibility = visible ? 'visible' : 'hidden';
      layer.style.pointerEvents = 'none';
      const local = Math.max(0, ms - start);
      if (visible && typeof window.__kunpengRenderLayerFrame === 'function') {
        await window.__kunpengRenderLayerFrame(layer, local / 1000, ms / 1000);
      }
      const animations = layer.getAnimations({ subtree: true });
      for (const anim of animations) {
        try {
          anim.pause();
          anim.currentTime = local;
        } catch {}
      }
    }
  } else {
    const animations = stage.getAnimations({ subtree: true });
    for (const anim of animations) {
      try {
        anim.pause();
        anim.currentTime = ms;
      } catch {}
    }
  }
  const videos = Array.from(stage.querySelectorAll('video'));
  for (const video of videos) {
    video.muted = true;
    video.pause();
    if (video.readyState < 1) {
      await new Promise((resolve) => {
        const done = () => resolve();
        video.addEventListener('loadedmetadata', done, { once: true });
        setTimeout(done, 2000);
      });
    }
    const offset = Number(video.dataset.kpOffsetSec || 0);
    const rate = Math.max(0.01, Number(video.dataset.kpRate || 1));
    let target = Math.max(0, ms / 1000 - offset) * rate;
    if (Number.isFinite(video.duration) && video.duration > 0) {
      target = video.dataset.kpLoop === 'false'
        ? Math.min(video.duration, target)
        : target % video.duration;
    }
    if (Number.isFinite(target) && Math.abs(video.currentTime - target) > 0.001) {
      await new Promise((resolve) => {
        const done = () => resolve();
        video.addEventListener('seeked', done, { once: true });
        try { video.currentTime = target; } catch { resolve(); }
        setTimeout(done, 2000);
      });
    }
  }
  stage.getBoundingClientRect();
};
</script>
</body>
</html>`;
}

function inferFreezeAfterSec(job) {
  if (job.freezeAfterSec === false || job.freezeAfterSec == null) return null;
  const configured = Number(job.freezeAfterSec);
  if (!Number.isFinite(configured) || configured <= 0) return null;
  const duration = Number(job.durationSec || 0);
  if (!Number.isFinite(duration) || duration <= configured + 0.5) return null;
  return Math.min(duration - 0.1, configured);
}

async function encodeAlphaMov(job, framesDir, outPath) {
  const ffmpeg = job.ffmpeg || 'ffmpeg';
  const input = path.join(framesDir, 'f%05d.png');
  await writeProgress(job, 'encode', { done: 0, total: 1, outputPath: outPath });
  if (job.opaqueBackground) {
    await run(ffmpeg, [
      '-y',
      '-framerate', String(job.fps),
      '-i', input,
      '-f', 'lavfi',
      '-t', String(Math.max(0.2, Number(job.durationSec || 0.2))),
      '-i', 'anullsrc=channel_layout=stereo:sample_rate=44100',
      '-map', '0:v',
      '-map', '1:a',
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-crf', '20',
      '-pix_fmt', 'yuv420p',
      '-c:a', 'aac',
      '-ar', '44100',
      '-ac', '2',
      '-shortest',
      outPath,
    ], job.timeoutMs || 900000);
    await writeProgress(job, 'encode', { done: 1, total: 1, outputPath: outPath });
    return;
  }
  if (job.alphaCodec === 'qtrle') {
    await run(ffmpeg, [
      '-y',
      '-framerate', String(job.fps),
      '-i', input,
      '-c:v', 'qtrle',
      '-pix_fmt', 'argb',
      '-an',
      outPath,
    ], job.timeoutMs || 900000);
    await writeProgress(job, 'encode', { done: 1, total: 1, outputPath: outPath });
    return;
  }
  try {
    await run(ffmpeg, [
      '-y',
      '-framerate', String(job.fps),
      '-i', input,
      '-c:v', 'prores_ks',
      '-profile:v', '4',
      '-pix_fmt', 'yuva444p10le',
      '-vendor', 'apl0',
      '-an',
      outPath,
    ], job.timeoutMs || 900000);
    await writeProgress(job, 'encode', { done: 1, total: 1, outputPath: outPath });
  } catch (err) {
    log('encode-fallback', { reason: String(err.message || err) });
    await writeProgress(job, 'encode-fallback', { done: 0, total: 1, reason: String(err.message || err).slice(0, 300) });
    await run(ffmpeg, [
      '-y',
      '-framerate', String(job.fps),
      '-i', input,
      '-c:v', 'qtrle',
      '-pix_fmt', 'argb',
      '-an',
      outPath,
    ], job.timeoutMs || 900000);
    await writeProgress(job, 'encode', { done: 1, total: 1, outputPath: outPath });
  }
}

async function main() {
  const job = JSON.parse(await fs.readFile(jobPath, 'utf8'));
  await fs.mkdir(job.outputDir, { recursive: true });
  const framesDir = path.join(job.outputDir, 'frames');
  const htmlPath = path.join(job.outputDir, 'stage.html');
  const donePath = path.join(job.outputDir, 'worker-done.json');
  const outPath = path.join(job.outputDir, job.opaqueBackground ? 'layer.mp4' : 'alpha.mov');

  if (await exists(outPath) && await exists(donePath)) {
    log('done', { outputPath: outPath, framesDir, cached: true });
    await writeProgress(job, 'done', { outputPath: outPath, framesDir, cached: true, done: 1, total: 1 });
    return;
  }

  await fs.mkdir(framesDir, { recursive: true });
  // KPMotion 运行时（与预览端同一份产物）：场景 clip 的确定性逐帧动画
  const motionRuntimeSrc = await fs.readFile(path.join(__dirname, 'motion-runtime.js'), 'utf8').catch(() => '');
  await fs.writeFile(htmlPath, buildHtml(job, motionRuntimeSrc), 'utf8');

  const chrome = await findChrome();
  log('browser', { chrome });
  await writeProgress(job, 'browser', { chrome });
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: 'new',
    args: [
      '--allow-file-access-from-files',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--no-sandbox',
      '--disable-background-timer-throttling',
      '--disable-backgrounding-occluded-windows',
      '--disable-renderer-backgrounding',
      '--hide-scrollbars',
      '--force-color-profile=srgb',
    ],
    defaultViewport: {
      width: job.stageWidth,
      height: job.stageHeight,
      deviceScaleFactor: job.outputWidth / job.stageWidth,
    },
  });

  try {
    const page = await browser.newPage();
    await writeProgress(job, 'load', { htmlPath });
    await page.goto(pathToFileURL(htmlPath).href, { waitUntil: 'networkidle0' });
    await page.evaluate(() => document.fonts?.ready).catch(() => {});
    const total = Math.max(1, Math.round(job.durationSec * job.fps));
    const offsetMs = Math.max(0, Number(job.timeOffsetSec || 0)) * 1000;
    const freezeAfterSec = inferFreezeAfterSec(job);
    const freezeFrom = freezeAfterSec == null
      ? null
      : Math.max(1, Math.min(total - 1, Math.ceil(freezeAfterSec * job.fps)));
    let frozenFramePath = null;
    await writeProgress(job, 'frames', { done: 0, total });
    for (let i = 0; i < total; i++) {
      const target = path.join(framesDir, `f${String(i).padStart(5, '0')}.png`);
      if (freezeFrom != null && i > freezeFrom && frozenFramePath) {
        await fs.copyFile(frozenFramePath, target);
      } else {
        const ms = offsetMs + (i / job.fps) * 1000;
        await page.evaluate((t) => window.__seekKunpeng?.(t), ms);
        await page.screenshot({
          path: target,
          type: 'png',
          omitBackground: !job.opaqueBackground,
          optimizeForSpeed: true,
        });
        if (freezeFrom != null && i === freezeFrom) frozenFramePath = target;
      }
      if (i === 0 || i === total - 1 || (i + 1) % Math.max(1, Math.round(total / 10)) === 0) {
        log('frame', { done: i + 1, total });
      }
      if (i === 0 || i === total - 1 || (i + 1) % Math.max(1, Math.round(total / 100)) === 0) {
        await writeProgress(job, 'frames', { done: i + 1, total });
      }
    }
  } finally {
    await browser.close().catch(() => {});
  }

  log('encode', { outputPath: outPath });
  await encodeAlphaMov(job, framesDir, outPath);
  await fs.writeFile(donePath, JSON.stringify({
    outputPath: outPath,
    framesDir,
    renderer: 'chromium-worker',
    completedAt: Date.now(),
  }), 'utf8');
  log('done', { outputPath: outPath, framesDir, cached: false });
  await writeProgress(job, 'done', { outputPath: outPath, framesDir, cached: false, done: 1, total: 1 });
}

main().catch(async (err) => {
  try {
    if (jobPath) {
      const job = JSON.parse(await fs.readFile(jobPath, 'utf8'));
      await writeProgress(job, 'error', { reason: String(err?.message || err).slice(0, 500) });
    }
  } catch {}
  console.error(err?.stack || err?.message || String(err));
  process.exit(1);
});
