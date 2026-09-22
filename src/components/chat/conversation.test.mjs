import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
const require = createRequire(import.meta.url);
const empty = () => null;
function render(file, props, { messages = [], phase = 'idle', thinking = '', data = null } = {}) {
  const chat = { messages, currentSessionId: 's', activeView: 'copywriting', streamingPhase: phase,
    streamingContent: '', streamingThinkingContent: thinking, streamingSessions: {}, error: null };
  const store = Object.assign(selector => selector(chat), { getState: () => chat, subscribe: () => () => {} });
  const modules = {
    react: React, 'react/jsx-runtime': require('react/jsx-runtime'), 'lucide-react': require('lucide-react'),
    'framer-motion': { AnimatePresence: ({ children }) => children, motion: new Proxy({}, {get: (_, tag) => ({children, initial, animate, exit, transition, whileHover, whileTap, ...rest}) => React.createElement(tag, rest, children)}) },
    '@/stores': { useChatStore: store }, '@/stores/chatStore': { useChatStore: store },
    '@/stores/workshopStore': { useWorkshopStore: Object.assign(selector => selector({ data, updateProjectViewState: empty }), { getState: () => ({ data }) }) },
    '@/stores/unifiedProjectStore': { useUnifiedProjectStore: Object.assign(selector => selector({ recentChangeSets: [] }), { getState: () => ({ activeId: 'p' }) }) },
    '@/stores/askUserStore': { useAskUserStore: selector => selector({ pending: null, history: [], queue: [] }) },
    '@/hooks/useSound': { useSound: () => ({ playNotification: empty }) },
    '@/lib/markdown': { MarkdownRenderer: ({ content }) => React.createElement('p', null, content) },
    '@/lib/agent/harnessDisplay': { stripHarnessPrefix: value => value },
    '@/lib/chat/streamingParts': { splitStreamingParts: content => ({ stable: content, tail: '' }) },
    '@/lib/performance/tailWindow': { tailWindow: items => ({ items, startIndex: 0 }) },
    '@/lib/agent/runStepPresentation': require('../../lib/agent/runStepPresentation.ts'),
    '@/lib/canvas/imageSource': { toCanvasDisplayUrl: path => path, assetUrlToLocalPath: path => path },
    '@/lib/chat/artifacts': { artifactsFromMessage: () => [] },
    '@/lib/chat/formatElapsedDuration': { formatElapsedDuration: n => `${n}s` },
    '@/lib/projectObjects/referenceTransfer': {}, '@/lib/projectObjects/conversationRefs': {},
    '@tauri-apps/api/dialog': {}, '@tauri-apps/api/tauri': { convertFileSrc: path => path },
    '../AskUserDialog': { AskUserDecisionCard: empty }, './AskUserDialog': { AskUserDecisionCard: empty },
    './chat/ArtifactPreview': { ArtifactGrid: empty },
  };
  const exports = {};
  runInNewContext(ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
  }).outputText, { exports, require: name => {
    if (name in modules) return modules[name];
    if (name === './assistantPresentation') return require('../workspace/assistantPresentation.ts');
    if (name.endsWith('.css')) return {};
    if (/^\.\.?\//.test(name)) return { default: empty, __esModule: true };
    throw Error(`Missing test dependency: ${name}`);
  }, console, setTimeout, clearTimeout, requestAnimationFrame: empty, cancelAnimationFrame: empty });
  return renderToStaticMarkup(React.createElement(exports.default, props));
}
const drawerProps = { open: true, onOpenChange: empty, title: '文案对话', variant: 'light', stripPrefixRe: /^none/,
  greeting: { hello: '', title: '从哪一段开始？' }, suggestions: [], onSend: empty, onAbort: empty };
test('drawer keeps historical thought folded and streaming thought out of the default view', () => {
  const completed = render('./AgentDrawer.tsx', drawerProps, { messages: [{ id: 'm', role: 'assistant', content: '完成的正文', thinkingContent: '内部推导', timestamp: 1 }] });
  assert.match(completed, /完成的正文/);
  assert.match(completed, /<details class="conversation-thinking"><summary>思考过程/);
  assert.doesNotMatch(completed, /<details[^>]*\sopen/);
  const streaming = render('./AgentDrawer.tsx', drawerProps, { phase: 'thinking', thinking: '不应默认展示的内部推导' });
  assert.match(streaming, /思考过程/);assert.doesNotMatch(streaming, /不应默认展示的内部推导/);
  assert.match(streaming, /title="停止"/);assert.match(streaming, /aria-label="对话消息"/);
});
test('returned media is visible by default and does not duplicate preview decoders', () => {
  const message = { id: 'm', role: 'assistant', content: '已返回图片', metadata: { toolExecutions: [{ status: 'completed', result: { success: true, output: '{"mediaId":"image"}' } }] } };
  const data = { projectId: 'p', projectObjects: { projectId: 'p', objects: [], versions: [], media: [{ id: 'image', projectId: 'p', path: '/picture.png', mediaType: 'image', purpose: 'candidate-version' }] } };
  const html = render('../workspace/WorkspaceAssistantMessage.tsx', { message, tone: 'dark' }, { data });
  assert.match(html, /<details class="workspace-assistant-results" open=""/);
  assert.equal((html.match(/<img /g) ?? []).length, 1);
  assert.ok(html.indexOf('workspace-assistant-result-grid') < html.indexOf('workspace-assistant-prose'));
  message.metadata.toolExecutions[0].result.success = false;
  assert.doesNotMatch(render('../workspace/WorkspaceAssistantMessage.tsx', { message, tone: 'dark' }, { data }), /workspace-assistant-result-grid/);
});
test('failed operations are never presented as completed edits in main chat', () => {
  const message = { id: 'failed', role: 'assistant', content: '写入失败，请检查文件权限。', timestamp: 1, metadata: { toolExecutions: [{ toolName: 'write_file', status: 'failed', result: { success: false } }] } };
  const html = render('../MessageList.tsx', { messages: [message], isStreaming: false, streamingPhase: 'idle', streamingSentAt: null });
  assert.match(html, /1 项操作未完成/);assert.doesNotMatch(html, /已编辑|完成任务/);
  assert.match(html, /aria-expanded="false"/);
});


test('reference attachments remain in sent drawer messages and history has no remove action', () => {
  const html = render('./AgentDrawer.tsx', drawerProps, { messages: [{ id: 'u', role: 'user', content: '参考这张图', filePaths: ['/reference.jpg'], timestamp: 1 }] });
  assert.match(html, /本条消息的参考附件/);
  const attachment = render('./ConversationAttachment.tsx', { path: '/素材/参考图.jpg' });
  assert.match(attachment, /参考图.jpg/);
  assert.match(attachment, /<img /);
  assert.doesNotMatch(attachment, /<button/);
  assert.match(render('./ConversationAttachment.tsx', { path: '/素材/参考图.jpg', onRemove: empty }), /移除附件 参考图.jpg/);
});


test('removing a legacy display prefix cannot leave blank lines above the user message', () => {
  const html = render('./AgentDrawer.tsx', { ...drawerProps, stripPrefixRe: /^\[display-header\]/ }, {
    messages: [{ id: 'u', role: 'user', content: '[display-header]\n\n\n用户正文\n', timestamp: 1 }],
  });
  assert.match(html, />用户正文<\/div>/);
  assert.doesNotMatch(html, /display-header/);
});
