import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as scopeLease from './workspaceToolScope.ts';
import { workspaceExecutionTarget, assistantTargetScope, serializeWorkspaceAssistantMessage } from '../workspace/workspaceAssistantMessage.ts';
import { ProjectAssistantQueue } from '../workspace/projectAssistantQueue.ts';
import { inferAgentWorkspaceScope } from './modelCatalog.ts';

const source = readFileSync(new URL('./toolGating.ts', import.meta.url), 'utf8');
const exports = {};
let activeView = 'workshop';
const modules = {
  '@/stores/chatStore': { useChatStore: { getState: () => ({ activeView }) } },
  '@/stores/settingsStore': { useSettingsStore: { getState: () => ({ webSearchEnabled: false }) } },
  '@/stores/directorStore': { useDirectorStore: { getState: () => ({ isOpen: false }) } },
  './subagentPolicy': { isSubagentEntryView: () => false },
  './workspaceToolScope': scopeLease,
};
runInNewContext(ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText,
  { exports, require: (id) => modules[id] });
const { isToolEnabled } = exports;
const target = (scope) => ({ projectId: 'P', sessionId: 'S', label: scope,
  surface: scope === 'editor' ? 'editor' : 'media',
  context: scope === 'canvas' ? '[用户正在画布视图中操作。]\n\n' : '[媒体工作台上下文：{"project_id":"P"}]\ncontext\n\n' });
const tick = () => new Promise((resolve) => setTimeout(resolve, 15));

test('running and queued dispatch own model/tool scope across canvas -> workshop -> editor browsing', async () => {
  const queue = new ProjectAssistantQueue(undefined, 0);
  let frozen = target('canvas');
  let browsing = 'canvas';
  let finish;
  const seen = [];
  const release = scopeLease.registerWorkspaceToolScope(() => {
    const owner = workspaceExecutionTarget(queue.getSnapshot().items, frozen);
    return owner ? assistantTargetScope(owner) : null;
  });
  const detach = queue.attach({ projectId: 'P', safe: () => true, send: async (item) => {
    seen.push({ model: inferAgentWorkspaceScope(serializeWorkspaceAssistantMessage(item.target, item.prompt)),
      tools: scopeLease.effectiveToolView(activeView), browsing });
    await new Promise((resolve) => { finish = resolve; });
  } });
  try {
    queue.enqueue(frozen, 'first'); await tick();
    for (const surface of ['workshop', 'editor']) {
      browsing = surface; frozen = target(surface);
      assert.equal(scopeLease.effectiveToolView(activeView), 'canvas');
      assert.equal(isToolEnabled('workshop_update_shot'), false);
      assert.equal(isToolEnabled('timeline_split_clip'), false);
    }
    queue.enqueue(target('canvas'), 'queued canvas');
    finish(); await tick();
    assert.equal(seen.length, 2);
    assert.deepEqual(seen[1], { model: 'canvas', tools: 'canvas', browsing: 'editor' });
    assert.equal(isToolEnabled('workshop_update_shot'), false);
    finish(); await tick();
    assert.equal(scopeLease.effectiveToolView(activeView), 'editor');
    assert.equal(isToolEnabled('timeline_split_clip'), true);
    assert.equal(isToolEnabled('workshop_update_shot'), false);
    frozen = target('workshop');
    assert.equal(isToolEnabled('workshop_update_shot'), true);
  } finally { finish?.(); detach(); release(); }
});

test('without embedded lease legacy gating and global timeline tools stay unchanged', () => {
  activeView = 'workshop'; assert.equal(isToolEnabled('workshop_update_shot'), true);
  assert.equal(isToolEnabled('timeline_split_clip'), false);
  assert.equal(isToolEnabled('timeline_get_state'), true);
  activeView = 'editor'; assert.equal(isToolEnabled('timeline_split_clip'), true);
  assert.equal(isToolEnabled('web_search'), false);
  activeView = 'workshop';
});
