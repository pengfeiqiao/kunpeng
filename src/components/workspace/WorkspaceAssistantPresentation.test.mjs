import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import * as React from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import * as icons from 'lucide-react';
import * as presentation from '../../lib/agent/runStepPresentation.ts';
import * as receipts from './assistantPresentation.ts';
import { stripHarnessPrefix } from '../../lib/agent/harnessDisplay.ts';
import { wrapWorkspaceContext } from '../../lib/agent/workspaceMessage.ts';
import { splitStreamingParts } from '../../lib/chat/streamingParts.ts';
import { tailWindow } from '../../lib/performance/tailWindow.ts';

const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const modules = {};
function load(relative) {
  const filename = fileURLToPath(new URL(relative, import.meta.url));
  const compiled = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename, reportDiagnostics: true,
    compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } });
  assert.deepEqual((compiled.diagnostics ?? []).filter((entry) => entry.category === ts.DiagnosticCategory.Error), []);
  const exports = {};
  runInNewContext(compiled.outputText, { exports, require: (id) => modules[id] ?? {}, setTimeout, clearTimeout });
  return exports;
}
const state = {};
const store = (key) => Object.assign((select) => select(state[key]), { getState: () => state[key], subscribe: () => () => {} });
const empty = () => null;
Object.assign(modules, {
  react: React, 'react/jsx-runtime': jsxRuntime, 'lucide-react': icons,
  '@/stores': { useChatStore: store('chat') }, '@/stores/chatStore': { useChatStore: store('chat') },
  '@/stores/workshopStore': { useWorkshopStore: store('workshop') },
  '@/stores/unifiedProjectStore': { useUnifiedProjectStore: store('unified') },
  '@/stores/runStepStore': { useRunStepStore: store('runs') },
  '@/stores/settingsStore': { useSettingsStore: store('settings') },
  '@/stores/askUserStore': { useAskUserStore: store('ask') },
  '@/hooks/useSound': { useSound: () => ({ playNotification() {} }) },
  '@/lib/markdown': { MarkdownRenderer: ({ content }) => React.createElement('div', { className: 'markdown-content' }, React.createElement('p', null, content)) },
  '@tauri-apps/api/tauri': { convertFileSrc: () => png },
  '@/lib/agent/runStepPresentation': presentation, './assistantPresentation': receipts,
  '@/lib/agent/harnessDisplay': { stripHarnessPrefix }, '@/lib/chat/streamingParts': { splitStreamingParts },
  '@/lib/performance/tailWindow': { tailWindow },
  'framer-motion': { AnimatePresence: ({ children }) => children, motion: { div: React.forwardRef(({ initial, animate, exit, transition, ...props }, ref) => React.createElement('div', { ...props, ref })) } },
  '../projects/ProjectSessionSwitcher': { default: () => React.createElement('span', null, 'session-switcher') },
  '../canvas/ArtifactPickerPanel': { default: empty }, './ContextUsagePill': { default: empty },
  './ProjectChangeReview': { default: empty },
  './WorkspaceAgentModelPicker': { default: ({ scope, disabled }) => React.createElement('button', { 'data-model-scope': scope, disabled }, '原模型选择') },
  '../AskUserDialog': { AskUserDecisionCard: ({ request }) => React.createElement('div', { role: 'alert' }, request.question) },
});
const timeline = load('../chat/RunStepTimeline.tsx');
modules['../chat/RunStepTimeline'] = { default: timeline.default };
modules['./RunStepTimeline'] = { default: timeline.default };
const Message = load('./WorkspaceAssistantMessage.tsx').default;
modules['../workspace/WorkspaceAssistantMessage'] = { default: Message };
const Drawer = load('../chat/AgentDrawer.tsx').default;
const element = (Component, props) => React.createElement(Component, props);
const render = (Component, props) => renderToStaticMarkup(element(Component, props));
const tool = (status = 'done', name = 'image_generate', detail = '实际输入') => ({ id: name, name, status, summary: '', startedAt: 1,
  display: { runningLabel: '正在准备素材', doneLabel: '已准备素材', failedLabel: '准备素材失败', icon: 'generate', detail, detailStyle: 'text' } });
const step = (status = 'done', tools = [tool()]) => ({ id: 'step', title: '素材准备', source: 'todo', status, startedAt: 1, toolCalls: tools, subAgents: [] });
const run = (steps = [step()], status = 'done') => ({ id: 'run', sessionId: 'session', status, steps, progressUpdates: [], startedAt: 1, userRequest: '原始创意' });
const message = (metadata = {}) => ({ id: 'reply', role: 'assistant', content: '已整理镜头草稿。请核对对白。', timestamp: 1, metadata });
function reset(currentRun = run()) {
  state.chat = { currentSessionId: 'session', activeView: 'workshop', messages: [], streamingPhase: 'idle', streamingContent: '', streamingThinkingContent: '' };
  state.workshop = { data: { projectId: 'p', projectViewState: { agentDrawerState: 'expanded' }, projectObjects: { projectId: 'p', objects: [], media: [], versions: [] } } };
  state.unified = { activeId: 'p', recentChangeSets: [] };
  state.runs = { currentRunId: currentRun?.id, runsById: currentRun ? { run: currentRun } : {}, runIdsBySession: { session: currentRun ? ['run'] : [] } };
  state.settings = { toolConfirmMode: 'ask' }; state.ask = { pending: null, queue: [], history: [] };
}
const drawerProps = { open: true, onOpenChange() {}, title: '旧版标题', greeting: { hello: '旧版问候', title: '旧版品牌空态' },
  suggestions: [], onSend() {}, onAbort() {}, stripPrefixRe: /^NEVER_MATCH/, embedded: true, variant: 'dark', modelScope: 'workshop' };

test('embedded reply has prose before actual stages, no author branding, and never cuts markdown mid-reply', () => {
  reset();
  const content = `${'长段正文'.repeat(160)}完整结尾`;
  const html = render(Message, { message: { ...message({ runId: 'run' }), content }, tone: 'dark' });
  assert.ok(html.indexOf('完整结尾') < html.indexOf('workspace-assistant-stage'));
  assert.doesNotMatch(html, /workspace-assistant-author|lucide-sparkles|鲲鹏|完整回复/);
  assert.doesNotMatch(html, /<details[^>]* open/);
});

test('actual failed, waiting, skipped and stopped data cannot be presented as completed', () => {
  for (const [input, expected] of [[run([step('done', [tool('failed')])]), 'failed'], [run([step('pending', [])]), 'failed'],
    [run([step('active', [tool('running')])]), 'failed'],
    [run([], 'aborted'), 'stopped'], [run([], 'running'), 'waiting']]) {
    reset(input);
    assert.equal(timeline.embeddedRunStatus(input), expected);
    const html = render(timeline.default, { embedded: true, runId: 'run', tone: 'dark' });
    assert.ok(html.includes(`data-status="${expected}"`));
    assert.doesNotMatch(html, /执行结束|\d+%|\d+\/\d+/);
  }
  assert.equal(timeline.embeddedStepStatus(step('skipped', [])), 'skipped');
  reset(run([step('skipped', [])]));
  assert.match(render(timeline.default, { embedded: true }), /已跳过/);
  reset(null); assert.equal(render(timeline.default, { embedded: true, runId: 'missing' }), '');
});

test('terminal runs never hang waiting and retries with historical failures remain explicitly running', () => {
  const retry = run([step('failed', [tool('failed')]), { ...step('active', [tool('running')]), id: 'retry' }], 'running');
  reset(retry);
  assert.equal(timeline.embeddedRunStatus(retry), 'running');
  assert.match(render(timeline.default, { embedded: true }), /执行中 · 有失败记录/);
  const failedProgress = { ...run([], 'running'), progressUpdates: [{ id: 'error', createdAt: 1, kind: 'error', status: 'failed', text: '重试前的错误' }] };
  assert.equal(timeline.embeddedRunStatus(failedProgress), 'running');
  for (const status of ['pending', 'active']) {
    reset(run([step(status, [])], 'done'));
    const html = render(timeline.default, { embedded: true });
    assert.match(html, /<strong role="status">未完成<\/strong>/);
    assert.doesNotMatch(html, /<strong role="status">等待执行回执/);
  }
  assert.equal(timeline.embeddedRunStatus({ ...retry, status: 'aborted' }), 'stopped');
  assert.equal(timeline.embeddedRunStatus({ ...retry, status: 'failed' }), 'failed');
});

test('skill evidence lives inside expandable real records, not generic badges or inferred prose', () => {
  reset(run([step('done', [tool('done', 'skill_invoke', '镜头连续性检查')])]));
  const html = render(timeline.default, { embedded: true });
  assert.match(html, /<summary>技能详情<\/summary><pre>镜头连续性检查<\/pre>/);
  assert.doesNotMatch(html, /workspace-assistant-skills|Skill ·/);
  reset(run([step('done', [tool('done', 'skill_invoke', undefined)])]));
  state.runs.runsById.run.steps[0].toolCalls[0].display.detail = undefined;
  assert.doesNotMatch(render(timeline.default, { embedded: true }), /技能详情/);
});

function resultFixture() {
  reset();
  state.workshop.data.projectObjects.media = [{ id: 'media', projectId: 'p', ownerObjectId: 'shot', label: '镜头素材', path: '/offline/result.png', mediaType: 'image', purpose: 'candidate-version' }];
  state.workshop.data.projectObjects.objects = [{ id: 'shot', label: '镜头一' }];
  state.workshop.data.projectObjects.versions = [{ id: 'v1', mediaObjectId: 'media', ordinal: 1 }];
  state.workshop.data.projectSnapshots = [{ id: 'snapshot', messageId: 'reply' }];
  state.unified.recentChangeSets = [{ id: 'change', objectId: 'shot', changes: [{ field: 'imagePrompt', before: '原词', after: '新词' }] }];
  return message({ runId: 'run', projectSnapshotId: 'snapshot', projectChangeSetIds: ['change'], workingContent: '实际记录', toolExecutions: [
    { status: 'completed', result: { success: true, output: '{"mediaId":"media"}' } },
    { toolName: 'project_update_generation_prompt', status: 'completed', result: { success: true,
      output: '{"projectId":"p","objectId":"shot","outputType":"image","revision":2,"changed":["prompt"]}' } },
  ] });
}

test('receipt thumbnails, shared preview, snapshot, field changes and prompt receipt remain present', () => {
  const m = resultFixture(); const html = render(Message, { message: m, tone: 'dark' });
  assert.match(html, /aria-label="1 个已返回媒体"/);
  assert.match(html, /打开镜头一/);
  for (const label of ['回到此项目快照', '查看本次字段改动', '提示词改动回执', '修订 2', '执行记录']) assert.ok(html.includes(label));
  const noReceipt = render(Message, { message: message({ runId: 'run' }), tone: 'dark' });
  assert.doesNotMatch(noReceipt, /已返回媒体|workspace-assistant-result-grid|已更新 .*提示词/);
  state.runs.runsById = {};
  assert.match(render(Message, { message: m, tone: 'dark' }), /已返回媒体/);
});

test('embedded drawer removes duplicate header/brand empty state, but keeps model scope, composer and pending decisions', () => {
  reset(null);
  const emptyHtml = render(Drawer, drawerProps);
  assert.match(emptyHtml, /还没有对话/); assert.doesNotMatch(emptyHtml, /旧版品牌空态|旧版标题|session-switcher/);
  assert.match(emptyHtml, /data-model-scope="workshop"/); assert.match(emptyHtml, /workspace-assistant-composer/);
  state.chat.messages = [{ id: 'u', role: 'user', content: wrapWorkspaceContext('workshop', 'PRIVATE_CONTEXT') + '用户正文', timestamp: 1 }];
  state.ask.pending = { id: 'decision', sourceView: 'workshop', sourceSessionId: 'session', question: '确认此次生成？' };
  const html = render(Drawer, drawerProps);
  assert.match(html, /workspace-assistant-user/); assert.match(html, /用户正文/);
  assert.doesNotMatch(html, /PRIVATE_CONTEXT/); assert.match(html, /确认此次生成？/);
});

test('streaming embedded prose stays first and thinking stays folded; nonembedded drawer remains unchanged', () => {
  reset(); state.chat.streamingPhase = 'thinking'; state.chat.streamingContent = '正在核对原对白。'; state.chat.streamingThinkingContent = 'PRIVATE_THINKING';
  const embedded = render(Drawer, drawerProps);
  assert.ok(embedded.indexOf('正在核对原对白') < embedded.indexOf('workspace-assistant-stage'));
  assert.doesNotMatch(embedded, /PRIVATE_THINKING/); assert.match(embedded, /title="停止"/);
  state.chat.streamingPhase = 'idle';
  const legacy = render(Drawer, { ...drawerProps, embedded: false });
  assert.match(legacy, /旧版标题|旧版品牌空态/); assert.match(legacy, /session-switcher/);
  assert.doesNotMatch(legacy, /workspace-assistant-composer|workspace-assistant-empty/);
  const oldTimeline = render(timeline.default, {});
  assert.match(oldTimeline, /执行完成/); assert.doesNotMatch(oldTimeline, /workspace-assistant-stage/);
});

test('optional offline component screenshots keep collapsed media, visible failure and fixed composer at narrow widths', { skip: process.env.WORKSPACE_ASSISTANT_VISUAL !== '1' }, async () => {
  const { default: puppeteer } = await import('puppeteer-core');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const browserPath = process.env.SMOKE_BROWSER_PATH || path.join(process.env.HOME, 'Library/Caches/ms-playwright/chromium-1223/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing');
  assert.ok(existsSync(browserPath), 'offline Chromium required');
  const profile = await mkdtemp(path.join(tmpdir(), 'assistant-presentation-'));
  const browser = await puppeteer.launch({ executablePath: browserPath, headless: true, userDataDir: profile });
  try {
    const page = await browser.newPage();
    await page.setRequestInterception(true); page.on('request', (request) => request.url().startsWith('data:') ? request.continue() : request.abort());
    const m = resultFixture();
    state.runs.runsById.run = run([step(), { ...step('failed', [tool('failed', 'video_generate')]), id: 'failed', title: '视频生成' }], 'failed');
    state.chat.messages = [{ id: 'user', role: 'user', content: '先保留原对白，准备镜头素材。', timestamp: 0 }, m];
    const css = readFileSync(new URL('./workspace-assistant.css', import.meta.url), 'utf8');
    const fixtureCss = 'html,body{margin:0;height:100%;background:#202124;color:#dedee2;font-family:Arial,sans-serif}*{box-sizing:border-box}button,textarea{font:inherit;color:inherit;background:transparent;border:0}button{cursor:pointer}p{margin:0}.fixture{height:100vh;margin-left:auto;width:min(100%,360px);display:flex}.workspace-embedded-agent{display:flex;flex-direction:column;flex:1;min-height:0;overflow:hidden}.flex{display:flex}.justify-end{justify-content:flex-end}.flex-1{flex:1}.shrink-0{flex-shrink:0}.overflow-y-auto{overflow-y:auto}.min-h-0{min-height:0}textarea{width:100%;resize:none}.workspace-assistant-scope{display:none}';
    const html = render(Drawer, drawerProps);
    const evidence = fileURLToPath(new URL('../../../docs/workspace-evidence/', import.meta.url)); mkdirSync(evidence, { recursive: true });
    for (const width of [1440, 1024, 390, 280]) {
      await page.setViewport({ width, height: 850 });
      await page.setContent(`<html lang="zh-CN"><meta charset="utf-8"><style>${fixtureCss}\n${css}</style><div class="fixture">${html}</div></html>`);
      assert.equal(await page.$eval('.workspace-assistant-stage', (el) => el.open), false);
      assert.equal(await page.$eval('.workspace-assistant-stage-previews img', (el) => el.getBoundingClientRect().width > 0), true);
      assert.equal(await page.$eval('.workspace-assistant-composer', (el) => el.getBoundingClientRect().bottom <= innerHeight), true);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.screenshot({ path: path.join(evidence, `assistant-refine-${width}.png`) });
      await page.click('.workspace-assistant-stage > summary');
      assert.equal(await page.$eval('.workspace-assistant-step-line', (el) => el.getBoundingClientRect().height > 0), true);
      await page.screenshot({ path: path.join(evidence, `assistant-refine-expanded-${width}.png`) });
    }
  } finally { await browser.close(); await rm(profile, { recursive: true, force: true }); }
});
