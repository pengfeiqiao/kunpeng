import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as canvasAgent from '../../lib/workspace/workspaceCanvasAgent.ts';
import * as assistantMessage from '../../lib/workspace/workspaceAssistantMessage.ts';
import * as canvasPrompt from '../../lib/canvas/canvasAgentPrompt.ts';
import * as contentModel from '../../lib/workspace/contentModel.ts';
import * as mediaView from '../../lib/workspace/mediaView.ts';
import * as agentContext from '../../lib/workspace/agentContext.ts';
import * as conversationRefs from '../../lib/projectObjects/conversationRefs.ts';
import { ProjectAssistantQueue } from '../../lib/workspace/projectAssistantQueue.ts';

const source = (name) => readFileSync(new URL(name, import.meta.url), 'utf8');
const surfaceSource = source('./WorkspaceCanvasSurface.tsx');
const jsx = (type, props) => ({ type, props });

function loadSurface(overrides = {}, resolveMedia = async (url) => url) {
  const queue = new ProjectAssistantQueue(undefined, 0);
  const effects = [];
  const listeners = {};
  const notices = [];
  const window = new EventTarget();
  const state = {
    unified: { activeId: 'project' },
    project: { activeProjectId: 'canvas', switching: false, projects: [{ id: 'canvas', aigcProjectId: 'project' }] },
    workshop: { project: { id: 'project' }, data: { projectId: 'project', canvasProjectId: 'canvas', shots: [] } },
    canvas: { nodes: [{ id: 'A', type: 'image', selected: true, data: { description: 'original' } },
      { id: 'B', type: 'video', data: { description: 'video', modelVersion: 'minimax-h3' } }], edges: [], selectedNodeId: 'A' },
    chat: { currentSessionId: 'session', activeView: 'workshop' },
    director: { isOpen: true, projectId: 'director-project', activePlanId: 'plan' },
    ...overrides,
  };
  const set = (key, patch) => {
    const previous = state[key]; state[key] = { ...previous, ...patch };
    for (const callback of listeners[key] ?? []) callback(state[key], previous);
  };
  const hook = (key) => Object.assign((selector) => selector(state[key]), { getState: () => state[key],
    setState: (patch) => set(key, patch), subscribe: (callback) => {
      (listeners[key] ??= new Set()).add(callback); return () => listeners[key].delete(callback);
    } });
  state.canvas.clearPendingAction = () => set('canvas', { pendingAgentAction: null });
  state.workshop.updateProjectViewState = (patch) => set('workshop', { data: { ...state.workshop.data,
    projectViewState: { ...state.workshop.data.projectViewState, ...patch } } });
  state.chat.setActiveView = (activeView) => set('chat', { activeView });
  const modules = {
    'react/jsx-runtime': { jsx, jsxs: jsx },
    react: { useEffect: (effect) => effects.push(effect), useCallback: (callback) => callback, useState: (value) => [value, (value) => notices.push(value)] },
    '@/components/canvas/CanvasView': { default: function OriginalCanvas() {} },
    '@/stores/projectStore': { useProjectStore: hook('project') },
    '@/stores/workshopStore': { useWorkshopStore: hook('workshop') },
    '@/stores/unifiedProjectStore': { useUnifiedProjectStore: hook('unified') },
    '@/stores/canvasStore': { useCanvasStore: hook('canvas') },
    '@/stores': { useChatStore: hook('chat') },
    '@/stores/directorStore': { useDirectorStore: hook('director') },
    '@/stores/projectAssistantQueueStore': { projectAssistantQueue: queue },
    '@/lib/workspace/workspaceCanvasAgent': canvasAgent,
    '@/lib/workspace/workspaceAssistantMessage': assistantMessage,
    '@/lib/canvas/canvasAgentPrompt': canvasPrompt,
    '@/lib/canvas/canvasAgentMedia': { resolveCanvasAgentMediaUrl: resolveMedia },
    '@/lib/workspace/contentModel': contentModel,
    '@/lib/workspace/mediaView': mediaView,
    '@/lib/workspace/agentContext': agentContext,
    '@/lib/projectObjects/conversationRefs': conversationRefs,
  };
  const exports = {};
  const result = ts.transpileModule(surfaceSource, { compilerOptions: { module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }, reportDiagnostics: true });
  assert.equal(result.diagnostics?.length ?? 0, 0);
  runInNewContext(result.outputText, { exports, require: (id) => modules[id] ?? {}, structuredClone, window, CustomEvent });
  return { ...exports, state, queue, set, notices, mount() {
    const outer = exports.default({ projectId: 'project', onAbort() {} });
    const tree = outer.type(outer.props);
    const cleanups = effects.map((effect) => effect());
    return { tree, close: () => cleanups.forEach((close) => close?.()) };
  } };
}

function findCanvas(tree) {
  if (!tree || typeof tree !== 'object') return null;
  if (tree.props?.embedded && tree.props?.onSelectNode) return tree;
  return [tree.props?.children].flat(Infinity).map(findCanvas).find(Boolean);
}

test('only a ready, aligned existing project mounts the original canvas surface', () => {
  const ready = loadSurface().default({ projectId: 'project', onAbort() {} });
  assert.equal(typeof ready.type, 'function');
  assert.equal(ready.props.canvasProjectId, 'canvas');
  for (const override of [
    { unified: { activeId: 'other' } },
    { project: { activeProjectId: 'canvas', switching: true, projects: [] } },
    { project: { activeProjectId: null, switching: false, projects: [] } },
    { project: { activeProjectId: 'other', switching: false, projects: [] } },
    { workshop: { project: { id: 'other' }, data: { projectId: 'project', canvasProjectId: 'canvas' } } },
  ]) assert.equal(loadSurface(override).default({ projectId: 'project', onAbort() {} }).props.role, 'status');
});

test('selection binding verifies explicit project, owner, media and immutable version identities', () => {
  const { workspaceBindingForNode: bind } = loadSurface();
  const data = { projectId: 'project', shots: [], projectObjects: {
    objects: [{ id: 'owner', projectId: 'project', kind: 'character', sourceId: 'character' }],
    media: [{ id: 'media', projectId: 'project', ownerObjectId: 'owner', mediaType: 'image' }],
    versions: [{ id: 'version', projectId: 'project', ownerObjectId: 'owner', mediaObjectId: 'media' }],
  } };
  const node = { id: 'node', type: 'image', data: { projectObjectId: 'owner', mediaObjectId: 'media', versionObjectId: 'version' } };
  assert.equal(bind(node, data).objectId, 'owner');
  assert.equal(bind(node, data).media.id, 'media');
  for (const patch of [{ projectObjectId: 'missing' }, { mediaObjectId: 'missing' }, { versionObjectId: 'missing' },
    { workshopRef: { projectId: 'other' } }, { workshopRef: { objectId: 'other' } }, { workshopPromptRefTarget: 'other' }]) {
    assert.equal(bind({ ...node, data: { ...node.data, ...patch } }, data), null);
  }
  assert.equal(bind({ ...node, type: 'video' }, data), null);
  assert.equal(bind({ ...node, data: { localPath: '/same-file.png' } }, data), null);
  assert.equal(bind({ ...node, data: { workshopRef: { projectId: 'project', kind: 'character', id: 'character' } } }, data).objectId, 'owner');
});

test('CanvasView retains all original node renderers and professional panels', () => {
  const canvas = source('../canvas/CanvasView.tsx');
  assert.match(canvas, /embedded = false/);
  for (const name of ['TextNode', 'ImageNode', 'VideoNode', 'AudioNode', 'GroupNode', 'PanoramaNode']) {
    assert.match(canvas, new RegExp(`: ${name}\\b`));
  }
  for (const name of ['NodeInfoBar', 'CanvasToolbar', 'NodePalette', 'TaskQueuePanel', 'SelectionToolbar',
    'ArtifactPickerPanel', 'AssetLibraryPanel', 'MaskPaintEditor', 'DirectorStage', 'MultiImageMarker',
    'VideoFrameCapture', 'TimelinePanel', 'CanvasContextMenu', 'FloatingMenu', 'ImageFullscreenViewer',
    'HelperLines', 'MiniMap', 'AiBoxOverlay', 'ProjectDeleteUndoToast', 'NodeAgentTransferEffect']) {
    assert.match(canvas, new RegExp(`<${name}\\b`));
    assert.doesNotMatch(canvas, new RegExp(`!embedded && <${name}\\b`));
  }
  assert.match(canvas, /useCanvasShortcuts\(\)/);
  assert.match(canvas, /!embedded && <ProjectSwitcher/);
  assert.match(canvas, /!embedded && <CanvasChatBubble/);
});

test('original CanvasView region callback queues its exact region, not the ordinary selection', () => {
  const runtime = loadSurface(); const mounted = runtime.mount(); const canvas = findCanvas(mounted.tree);
  assert.equal(canvas.type.name, 'OriginalCanvas');
  canvas.props.onSendMessage('[画布 AI 区域操作]\n用户在画布上框选了 1 个节点：B(video)。\n指令：只调整B');
  const item = runtime.queue.getSnapshot().items[0];
  assert.deepEqual(item.target.canvasTarget.nodes.map((node) => node.id), ['B']);
  assert.equal(item.prompt, '只调整B');
  assert.equal(runtime.state.workshop.data.projectViewState.agentDrawerState, 'expanded');
  canvas.props.onSelectNode('A');
  assert.equal(runtime.queue.draft('project', 'session', 'media').target.canvasTarget.nodes[0].id, 'A');
  runtime.set('unified', { activeId: 'other' }); canvas.props.onSendMessage('must not send');
  assert.equal(runtime.queue.getSnapshot().items.length, 1);
  mounted.close();
});

test('pending node action keeps original engine and full prompt, but not quoted authorization', async () => {
  const runtime = loadSurface(); const mounted = runtime.mount();
  runtime.set('canvas', { pendingAgentAction: { action: 'ai-generate-video', nodeId: 'B', prompt: '原prompt：保持对白\n修改剧本中的人物关系（只读引用）' } });
  await Promise.resolve(); await Promise.resolve();
  const item = runtime.queue.getSnapshot().items[0];
  assert.ok(item.target.context.includes('engine="minimax-hailuo-h3"'));
  assert.ok(item.target.context.includes('原prompt：保持对白\n修改剧本中的人物关系（只读引用）'));
  assert.equal(item.prompt, '执行画布节点操作 ai-generate-video，目标节点 B。');
  assert.equal(runtime.state.canvas.pendingAgentAction, null);
  mounted.close();
});

test('pre-mount actions and async action results from a switched project never enqueue', async () => {
  let finish;
  const runtime = loadSurface({}, () => new Promise((resolve) => { finish = resolve; }));
  runtime.state.canvas.pendingAgentAction = { action: 'ai-generate-image', nodeId: 'A', prompt: 'stale' };
  const mounted = runtime.mount();
  assert.equal(runtime.queue.getSnapshot().items.length, 0);
  runtime.set('canvas', { nodes: [{ ...runtime.state.canvas.nodes[0], data: { generatedImageUrl: '/local.png' } }],
    pendingAgentAction: { action: 'ai-3d-camera', nodeId: 'A', prompt: '俯角' } });
  runtime.set('unified', { activeId: 'other' }); finish('https://example.invalid/image');
  await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
  assert.equal(runtime.queue.getSnapshot().items.length, 0);
  mounted.close();
});

test('changed TSX files parse without invoking a project typecheck or build', () => {
  for (const file of ['./ProjectWorkspace.tsx', './ProjectWorkspaceLayout.tsx', './WorkspaceCanvasSurface.tsx', '../canvas/CanvasView.tsx']) {
    const parsed = ts.createSourceFile(file, source(file), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    assert.equal(parsed.parseDiagnostics.length, 0, file);
  }
});
