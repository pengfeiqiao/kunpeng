import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import * as scope from './workspaceToolScope.ts';
import * as projectGeneration from './workspaceProjectGeneration.ts';
import { PaidToolIdempotencyGate } from './paidToolIdempotency.ts';
import { checkBashSecurity } from './tools/bashSecurity.ts';
import { shouldOfferToolConfirmation } from '../projectObjects/generationDraft.ts';
import { bindWorkspaceDispatchSession } from './workspaceDispatchSession.ts';
import { captureWorkspaceAuthority, authorizeWorkspaceDispatch } from './workspaceDispatchPolicy.ts';
import { serializeWorkspaceAssistantMessage } from '../workspace/workspaceAssistantMessage.ts';
import { assistantThreadKey, ProjectAssistantQueue } from '../workspace/projectAssistantQueue.ts';
import { enqueueProjectIntake } from '../projects/projectIntakeHandoff.ts';
import { executeDshToolCall } from './dsh/toolRpc.ts';

const log = { info() {}, warn() {}, error() {}, debug() {} };
const load = (name, modules) => {
  const exports = {};
  const source = readFileSync(new URL(name, import.meta.url), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } });
  runInNewContext(compiled.outputText, { exports, require: (id) => modules[id] ?? {}, AbortController, DOMException, setTimeout, clearTimeout });
  return exports;
};
const { ToolRegistry } = load('./toolRegistry.ts', {
  './logger': { agentLog: log }, './toolGating': { isToolEnabled: () => true },
  '@/stores/chatStore': { useChatStore: { getState: () => ({ activeView: 'workshop' }) } },
  './evolutionPolicy': { summarizeTrajectoryValue: (value) => String(value) }, './workspaceToolScope': scope,
  './workspaceProjectGeneration': projectGeneration,
  './paidToolIdempotency': { PaidToolIdempotencyGate },
});

function registry() {
  const writes = [];
  const reserves = [];
  const r = new ToolRegistry({ reserve: (...args) => { reserves.push(args); return null; }, record() {}, clearRun() {} });
  for (const name of ['project_update_generation_prompt', 'workshop_update_shot', 'workshop_set_prompts', 'workshop_add_candidate',
    'workshop_set_breakdown', 'project_update_object', 'workshop_generate', 'canvas_generate', 'canvas_update_node',
    'timeline_remove_clip', 'director_apply_plan', 'bash', 'write_file', 'edit_file', 'agent_delegate', 'mcp_external_mutate', 'project_get_objects']) {
    r.register({ definition: { name, description: name, parameters: { type: 'object', properties: {} } }, risk: 'safe',
      execute: async (params) => { writes.push({ name, params }); return { success: true, output: 'executed' }; } });
  }
  return { r, writes, reserves };
}

let sequence = 0;
function fixture(level = 'media') {
  const runId = `workspace-dispatch-${++sequence}`;
  const data = { projectId: 'P', characters: [], shots: [{ id: 'S1', shotNo: '01-01', description: '两人站在门口', dialogue: '你好', characterIds: [] },
    { id: 'S2', shotNo: '01-02', description: '空镜', dialogue: '' }], projectObjects: { projectId: 'P',
    objects: [{ id: 'O1', kind: 'shot', sourceId: 'S1', projectId: 'P', version: 1 }, { id: 'O2', kind: 'shot', sourceId: 'S2', projectId: 'P', version: 1 }],
    media: [{ id: 'M1', kind: 'media-file', projectId: 'P', ownerObjectId: 'O1', mediaType: 'video' }], versions: [] } };
  const target = { projectId: 'P', sessionId: 'session', surface: 'media', label: 'fixture', context: '只读参考：修改剧本人物关系。',
    ...(level !== 'project' && level !== 'professional' ? { objectId: 'O1', outputType: 'video', accessScope: level } : {}),
    ...(level === 'media' ? { mediaId: 'M1' } : {}), ...(level === 'professional' ? { canvasTarget: { nodes: [] } } : {}) };
  const content = serializeWorkspaceAssistantMessage(target, '仅调整当前表达');
  const state = { data, activeProjectId: 'P', sessionId: 'session', items: [{ id: 'item', status: 'running', target, prompt: '仅调整当前表达' }] };
  const listeners = new Set();
  const port = { read: () => state, subscribe: (listener) => { listeners.add(listener); return () => listeners.delete(listener); } };
  const close = bindWorkspaceDispatchSession(runId, content, port);
  return { runId, target, state, content, close, port, change(fn) { fn(state); listeners.forEach((listener) => listener()); } };
}
const callbacks = (onConfirm = async () => true) => ({ onTextDelta() {}, onThinkingDelta() {}, onToolStart() {}, onToolEnd() {}, onComplete() {},
  onError(error) { throw error; }, onToolConfirm: onConfirm });

function nativeBashFixture() {
  const executions = [];
  const { bashTool } = load('./tools/bashTool.ts', {
    './bashSecurity': { checkBashSecurity },
    '@tauri-apps/api/tauri': { invoke: async (command, params) => {
      assert.equal(command, 'execute_command');
      executions.push(params);
      return { stdout: 'fixture result', stderr: '', exit_code: 0, stdout_total_chars: 14, stderr_total_chars: 0 };
    } },
  });
  const r = new ToolRegistry(); r.register(bashTool);
  return { r, executions };
}

test('project shell/skill scripts use the same real DSH risk and confirmation path as legacy calls', async () => {
  const f = fixture('project'); const local = fixture('shot');
  const cases = [
    { command: 'python /fixture/docx_to_md.py /fixture/input.docx', allow: true, success: true, confirms: 0 },
    { command: 'python /fixture/voice.py --speaker fixture', allow: true, success: true, confirms: 0 },
    { command: 'rm -r /fixture/cache', allow: false, success: false, confirms: 1 },
    { command: 'rm -r /fixture/cache', allow: true, success: true, confirms: 1 },
    { command: 'rm -rf /', allow: true, success: false, confirms: 0 },
  ];
  try {
    for (const runId of ['legacy-shell', f.runId]) {
      const { r, executions } = nativeBashFixture();
      for (const entry of cases) {
        let confirms = 0;
        const before = executions.length;
        const result = await executeDshToolCall({ name: 'bash', runId, instanceId: 'fixture', requestId: `${before}`, arguments: { command: entry.command } },
          r, callbacks(async () => { confirms++; return entry.allow; }), new AbortController().signal);
        assert.equal(result.success, entry.success, `${runId}: ${entry.command}`);
        assert.equal(confirms, entry.confirms);
        assert.equal(executions.length - before, entry.success ? 1 : 0);
      }
    }
    const { r, executions } = nativeBashFixture();
    const call = { name: 'bash', runId: local.runId, instanceId: 'fixture', requestId: 'local', arguments: { command: cases[0].command } };
    // 对象级运行与项目级同等放行 bash；项目切换仍在确认期失效
    assert.equal((await executeDshToolCall(call, r, callbacks(), new AbortController().signal)).success, true);
    const switched = { ...call, runId: f.runId, arguments: { command: 'rm -r /fixture/cache' } };
    assert.equal((await executeDshToolCall(switched, r, callbacks(async () => {
      f.change((state) => { state.activeProjectId = 'other'; }); return true;
    }), new AbortController().signal)).success, false);
    assert.equal(executions.length, 1);
  } finally { f.close(); local.close(); }
});

function nativeGenerationFixture() {
  const submissions = [], files = [], canvasWrites = [];
  const modules = {
    '@/stores/settingsStore': { useSettingsStore: { getState: () => ({ chatImageModel: 'gpt-image-2', chatVideoModel: 'seedance-2.0' }) } },
    '@/lib/imageGen/client': { generateImage: async (args) => { submissions.push({ type: 'image', args }); return { success: true, imagePath: '/fixture/image.png' }; } },
    '@/lib/agent/mediaInput': { loadMediaInput: async () => ({ dataUrl: 'data:image/png;base64,ZmFrZQ==', mediaType: 'image/png' }) },
    '@/lib/canvasGen': { runGeneration: async (args) => { submissions.push({ type: 'generation', args }); return { success: true, resultPaths: ['/fixture/output.mp4'] }; } },
    '@/lib/customMedia/runner': { findCustomMediaApi: () => ({ kind: 'video', label: 'fixture plugin' }) },
    '@/lib/midjourney/styles': { MIDJOURNEY_STYLE_CATEGORIES: [], MIDJOURNEY_STYLE_PRESETS: [],
      getMidjourneyStyle: () => ({ name: 'fixture style', recommendedVersion: '8.2' }),
      resolveMidjourneyStyleParameters: () => ({ stylize: 125, chaos: 0, raw: true }),
      ensureMidjourneyStyleReference: async () => '/fixture/style.png', applyMidjourneyStylePrompt: (prompt) => `${prompt} style` },
    '@/lib/midjourney/prompt': { normalizeMidjourneyVersion: (version) => version },
    '@/lib/dreamina/video': { DREAMINA_SEEDANCE_25_ENGINE_ID: 'seedance-2.5' },
    '@/lib/videoPrompt/performance': { PERFORMANCE_BRIEF: 'fixture' },
    '@/lib/doubaoSpeech/client': { generateSpeech: async (args) => { submissions.push({ type: 'speech', args }); return { model: 'Seed-Audio', duration: 1 }; },
      fetchSpeechAudioBytes: async () => new Uint8Array([1, 2]) },
    '@tauri-apps/api/fs': { createDir: async () => {}, writeBinaryFile: async (path) => { files.push(path); } },
    '@tauri-apps/api/tauri': { invoke: async () => '/fixture/workspace', convertFileSrc: (path) => path },
    '@/stores/canvasStore': { useCanvasStore: { getState: () => ({ nodes: [], addNode: (...args) => canvasWrites.push(args), updateNode: (...args) => canvasWrites.push(args) }) } },
    '@/lib/artifacts': { appendArtifact: async () => {} },
  };
  const native = [load('./tools/imageGenerateTool.ts', modules).imageGenerateTool,
    load('./tools/videoGenerateTool.ts', modules).videoGenerateTool,
    load('./tools/doubaoSpeechTool.ts', modules).doubaoSpeechGenerateTool];
  const r = new ToolRegistry();
  native.forEach((tool) => r.register(tool));
  return { r, native, submissions, files, canvasWrites };
}

test('bound project generation retains native schemas, style/reference/model semantics and standalone speech', async () => {
  const f = fixture('project'); const { r, native, submissions, files, canvasWrites } = nativeGenerationFixture();
  try {
    for (const tool of native) {
      const registered = r.get(tool.definition.name);
      assert.equal(registered.execute, tool.execute);
      assert.equal(registered.risk, 'ask');
      assert.equal(tool.definition.parameters.properties.project_id, undefined);
      assert.equal(registered.definition.parameters.properties.project_id.type, 'string');
      assert.equal(registered.definition.parameters.required.includes('project_id'), false);
    }
    const invoke = (name, params) => r.execute(name, { project_id: 'P', ...params }, undefined, { runId: f.runId });
    assert.equal((await invoke('image_generate', { prompt: '镜头草图', aspect_ratio: '9:16', reference_urls: ['/fixture/ref.png'] })).success, true);
    assert.equal(submissions[0].args.aspectRatio, '9:16');
    assert.equal(submissions[0].args.referenceImageUrls[0], '/fixture/ref.png');
    assert.equal((await invoke('image_generate', { prompt: '风格草图', model: 'midjourney-v82', midjourney_style_id: 'fixture' })).success, true);
    assert.equal(submissions[1].args.prompt, '风格草图 style');
    assert.equal(submissions[1].args.styleReferenceUrls[0], '/fixture/style.png');
    assert.equal(submissions[1].args.params.stylize, 125);
    assert.equal((await invoke('video_generate', { prompt: '远景缓推', engine: 'minimax-h3', duration: 6, ratio: '16:9' })).success, true);
    assert.equal(submissions[2].args.engineId, 'minimax-hailuo-h3');
    assert.equal((await invoke('video_generate', { prompt: '云朵', engine: 'custom-media:fixture' })).success, true);
    assert.equal(submissions[3].args.engineId, 'custom-media:fixture');
    assert.equal((await invoke('doubao_speech_generate', { text_prompt: '你好', speaker: 'fixture-speaker', create_canvas_node: false })).success, true);
    assert.equal(submissions[4].args.references[0].speaker, 'fixture-speaker');
    assert.equal(submissions[4].args.text_prompt, '你好');
    assert.equal(files.length, 1); assert.equal(canvasWrites.length, 0);
  } finally { f.close(); }
});

test('project generic generation cannot overwrite, adopt, mutate a canvas or borrow an absent/foreign binding', async () => {
  const f = fixture('project'); const { r, submissions } = nativeGenerationFixture();
  try {
    for (const name of ['image_generate', 'video_generate', 'doubao_speech_generate']) {
      const base = { prompt: 'fixture', text_prompt: 'fixture', project_id: 'P' };
      for (const patch of [{ project_id: undefined }, { project_id: 'other' }, { projectId: 'other' },
        { output_path: '/fixture/overwrite.png' }, { target_node_id: 'other' }, { create_canvas_node: true }, { object_id: 'O1' }]) {
        assert.equal((await r.execute(name, { ...base, ...patch }, undefined, { runId: f.runId })).success, false);
      }
    }
    assert.equal(submissions.length, 0);
    // No failed binding reserved a paid call; a corrected call still succeeds.
    assert.equal((await r.execute('image_generate', { project_id: 'P', prompt: 'fixture' }, undefined, { runId: f.runId })).success, true);
  } finally { f.close(); }
});

test('real DSH confirmations and paid idempotency still protect each admitted project generator', async () => {
  const f = fixture('project'); const { r, submissions } = nativeGenerationFixture();
  let confirmations = 0;
  try {
    for (const name of ['image_generate', 'video_generate', 'doubao_speech_generate']) {
      const call = { name, runId: f.runId, instanceId: 'fixture', requestId: name,
        arguments: { project_id: 'P', prompt: 'fixture', text_prompt: '你好', speaker: 'fixture-speaker' } };
      const before = submissions.length;
      assert.equal((await executeDshToolCall(call, r, callbacks(async () => { confirmations++; return false; }), new AbortController().signal)).success, false);
      assert.equal(submissions.length, before);
      assert.equal((await executeDshToolCall(call, r, callbacks(async () => { confirmations++; return true; }), new AbortController().signal)).success, true);
      const duplicate = await executeDshToolCall(call, r, callbacks(), new AbortController().signal);
      assert.equal(duplicate.success, false); assert.match(duplicate.error, /重复执行/);
      assert.equal(submissions.length, before + 1);
    }
    assert.equal(confirmations, 6);
  } finally { f.close(); }
});

test('native video ambiguity guard survives project admission; ordinary calls remain unbound and local scopes generate with project binding', async () => {
  const f = fixture('project'); const local = fixture('media'); const { r, submissions } = nativeGenerationFixture();
  try {
    const ambiguous = await r.execute('video_generate', { project_id: 'P', prompt: '延长这段视频', video_urls: ['/fixture/ref.mp4'] }, undefined, { runId: f.runId });
    assert.equal(ambiguous.success, false); assert.match(ambiguous.error, /video_edit/);
    // 对象级运行不再是围栏：带 project_id 的独立生成放行（付费确认链独立把关）
    for (const name of ['image_generate', 'video_generate', 'doubao_speech_generate']) {
      assert.equal((await r.execute(name, { project_id: 'P', prompt: 'fixture', text_prompt: 'fixture', speaker: 'fixture-speaker' }, undefined, { runId: local.runId })).success, true, name);
    }
    assert.equal(submissions.length, 3);
    assert.equal((await r.execute('image_generate', { prompt: 'ordinary', output_path: '/fixture/ordinary.png' }, undefined, { runId: 'ordinary-generation' })).success, true);
    assert.equal(submissions[3].args.outputPath, '/fixture/ordinary.png');
    const call = { name: 'video_generate', runId: f.runId, instanceId: 'fixture', requestId: 'switch', arguments: { project_id: 'P', prompt: 'fixture' } };
    const switched = await executeDshToolCall(call, r, callbacks(async () => { f.change((state) => { state.activeProjectId = 'other'; }); return true; }), new AbortController().signal);
    assert.equal(switched.success, false); assert.equal(submissions.length, 4);
  } finally { f.close(); local.close(); }
});

test('project workflow keeps skill templates and planning; native configuration approval remains authoritative', async () => {
  const f = fixture('project'); const { r, submissions } = nativeGenerationFixture();
  const todos = [], usedSkills = [], settingsWrites = [];
  const settings = { customMediaApis: [{ id: 'fixture', label: 'fixture model', kind: 'image', modelId: 'fixture', protocol: 'openai-images', enabled: true }],
    setCustomMediaApis: (value) => settingsWrites.push(value) };
  const modules = {
    '@/stores/settingsStore': { useSettingsStore: { getState: () => settings, setState: (value) => settingsWrites.push(value) } },
    '@/stores/workshopStore': { useWorkshopStore: { getState: () => ({ project: { id: 'P' } }) } },
    '@/stores/todoStore': { useTodoStore: { getState: () => ({ setTodos: (session, items) => todos.push({ session, items }) }) } },
    '@/stores/runStepStore': { useRunStepStore: { getState: () => ({ syncTodos() {} }) } },
    '../skillLoader': { getSharedSkillLoader: async () => ({ refreshIfDue: async () => [{ id: 'fixture', invokable: true }], renderPrompt: (_skill, values) => `原模板:${values.userContent}` }) },
    '@/lib/skillLoader': { getBuiltinSkills: () => [] },
    '@/lib/skills/skillPreferences': { isSkillEnabled: () => true, markSkillUsed: (id) => usedSkills.push(id) },
  };
  r.register(load('./tools/skillInvokeTool.ts', modules).skillInvokeTool);
  r.register(load('./tools/todoWriteTool.ts', modules).createTodoWriteTool(() => 'session'));
  r.register(load('./tools/mediaApiPluginTool.ts', modules).mediaApiPluginTool);
  r.register(load('./tools/capabilityApiConfigTool.ts', modules).capabilityApiConfigTool);
  try {
    const invoke = (name, params) => r.execute(name, params, undefined, { runId: f.runId });
    assert.equal((await invoke('todo_write', { todos: [{ content: '生成草图', status: 'in_progress' }] })).success, true);
    assert.equal(todos[0].session, 'session');
    const template = await invoke('skill_invoke', { skillId: 'fixture', userContent: '雨夜' });
    assert.equal(template.output, '原模板:雨夜'); assert.deepEqual(usedSkills, ['fixture']);
    assert.equal((await invoke('image_generate', { project_id: 'P', prompt: template.output })).success, true);
    assert.equal(submissions[0].args.prompt, template.output);
    assert.equal((await invoke('media_api_plugin', { op: 'list' })).success, true);
    assert.equal((await invoke('capability_api_config', { op: 'get' })).success, true);
    const configCall = (name, params, confirm) => executeDshToolCall({ name, runId: f.runId, instanceId: 'fixture', requestId: name, arguments: params },
      r, callbacks(confirm), new AbortController().signal);
    for (const op of ['add', 'update', 'remove', 'toggle']) {
      assert.equal((await configCall('media_api_plugin', { op, id: 'fixture' }, async () => false)).success, false);
    }
    assert.equal((await configCall('capability_api_config', { op: 'set', module: 'vision', mode: 'auto' }, async () => false)).success, false);
    assert.deepEqual(settingsWrites, []);
    assert.equal((await configCall('media_api_plugin', { op: 'update', id: 'fixture', label: 'new label' }, async () => true)).success, true);
    assert.equal((await configCall('capability_api_config', { op: 'set', module: 'vision', mode: 'auto' }, async () => true)).success, true);
    assert.equal(settingsWrites.length, 2);
  } finally { f.close(); }
});

test('local scope is a viewing hint, not a fence: same-project cross-object writes are admitted', async () => {
  const f = fixture(); const { r, writes, reserves } = registry();
  try {
    for (const [name, params] of [
      ['project_update_generation_prompt', { project_id: 'P', object_id: 'O2', output_type: 'video', prompt: 'new' }],
      ['project_update_generation_prompt', { project_id: 'P', object_id: 'O1', output_type: 'image', prompt: 'new' }],
      ['workshop_update_shot', { shot_no: '01-02', patch: { description: 'rewrite' } }],
      ['workshop_generate', { kind: 'video', targets: '01-01' }],
      ['canvas_generate', { node_id: 'any', force: true }], ['canvas_update_node', { node_id: 'any', data: {} }],
      ['project_update_object', { object_id: 'O1', patch: { archived: true } }],
      ['timeline_remove_clip', {}], ['director_apply_plan', {}], ['bash', { command: 'write' }], ['write_file', {}], ['edit_file', {}],
      ['agent_delegate', {}], ['mcp_external_mutate', {}],
    ]) assert.equal((await r.execute(name, params, undefined, { runId: f.runId })).success, true, name);
    assert.equal(writes.length, 14);
    // 跨项目参数仍是硬围栏；生成类仍需 project_id 绑定
    assert.equal((await r.execute('workshop_update_shot', { project_id: 'other', shot_no: '01-01', patch: {} }, undefined, { runId: f.runId })).success, false);
    assert.equal((await r.execute('image_generate', { prompt: 'fixture' }, undefined, { runId: f.runId })).success, false);
    assert.equal(reserves.length, 14, '被分发层拒绝的调用不产生付费占用');
    assert.equal((await r.execute('project_update_generation_prompt', { project_id: 'P', object_id: 'O1', output_type: 'video',
      expected_revision: 1, prompt: '慢推镜头' }, undefined, { runId: f.runId })).success, true);
  } finally { f.close(); }
});

test('real DSH frontend dispatch admits same-project writes beyond the viewed object', async () => {
  const f = fixture('shot'); const { r, writes } = registry();
  const call = (name, params) => ({ runId: f.runId, instanceId: 'mock', requestId: `rpc-${name}`, name, arguments: params });
  try {
    const valid = { shot_no: '01-01', expected_version: 1, patch: { camera: '缓慢推进' } };
    assert.equal((await executeDshToolCall(call('workshop_update_shot', valid), r, callbacks(), new AbortController().signal)).success, true);
    // 正在看的对象不再是围栏：同项目其他镜头可写
    assert.equal((await executeDshToolCall(call('workshop_update_shot', { ...valid, shot_no: '01-02' }), r, callbacks(), new AbortController().signal)).success, true);
    r.get('workshop_update_shot').risk = 'ask';
    // 确认回调中对象被锁定：分发层不再整轮失效（锁定由工具自身拦截）
    const result = await executeDshToolCall(call('workshop_update_shot', valid), r, callbacks(async () => {
      f.change((state) => { state.data.projectObjects.objects[0].locked = true; }); return true;
    }), new AbortController().signal);
    assert.equal(result.success, true); assert.equal(writes.length, 3);
  } finally { f.close(); }
});

test('batch prompt writes are admitted within the project; relation structure edits still need story scope', async () => {
  const f = fixture('shot'); const { r, writes } = registry();
  try {
    const dispatch = (name, params) => r.execute(name, params, undefined, { runId: f.runId });
    // 同项目批量/跨镜头提示词写入放行（内容合法性由工具与叙事审计层把关，不再由范围围栏拦截）
    assert.equal((await dispatch('workshop_set_prompts', { items: JSON.stringify([{ shotNo: '01-01', videoPrompt: '推进' }, { shotNo: '01-02', videoPrompt: '推进' }]) })).success, true);
    assert.equal(writes.length, 1);
    // 非剧情/分镜类任务的关系结构改写仍被拒绝（项目级唯一保留的内容围栏）
    const authority = captureWorkspaceAuthority(f.target, f.state.data, '仅调整当前表达');
    assert.ok(authorizeWorkspaceDispatch(authority, 'project_update_object', { object_id: 'O1', patch: { relationIds: ['x'] } }, f.state.data));
  } finally { f.close(); }
});

test('candidate registration is admitted within the project', async () => {
  const f = fixture(); f.close();
  f.state.data.projectObjects.objects[0] = { id: 'O1', kind: 'character', sourceId: 'role', projectId: 'P' };
  f.state.data.projectObjects.media[0].mediaType = 'image'; f.target.outputType = 'image';
  const close = bindWorkspaceDispatchSession(`${f.runId}-asset`, serializeWorkspaceAssistantMessage(f.target, '仅调整当前表达'), f.port);
  const { r, writes } = registry();
  try {
    // 候选注册在同项目内放行（是否采用/选择由工具自身语义把关）
    for (const params of [{ kind: 'character', id: 'role' }, { kind: 'character', id: 'role', select: true }, { kind: 'character', id: 'other', select: false }]) {
      assert.equal((await r.execute('workshop_add_candidate', params, undefined, { runId: `${f.runId}-asset` })).success, true);
    }
    assert.equal(writes.length, 3);
  } finally { close(); }
});

test('scope is run-bound: browsing cannot break the project fence; switch-away/back and late calls fail closed', async () => {
  const f = fixture('shot'); const { r, writes } = registry();
  const params = { shot_no: '01-01', patch: { camera: '推进' } };
  f.change((state) => { state.data.projectViewState = { workspaceSurface: 'editor', workspaceObjectId: 'O2' }; });
  assert.equal((await r.execute('workshop_update_shot', params, undefined, { runId: f.runId })).success, true);
  // 子运行沿用父授权：同项目内 bash 放行
  assert.equal((await r.execute('bash', {}, undefined, { runId: `${f.runId}/child`, idempotencyRunId: f.runId })).success, true);
  f.change((state) => { state.activeProjectId = 'other'; }); f.change((state) => { state.activeProjectId = 'P'; });
  assert.equal((await r.execute('workshop_update_shot', params, undefined, { runId: f.runId })).success, false);
  f.close();
  assert.equal((await r.execute('workshop_update_shot', params, undefined, { runId: f.runId })).success, false);
  assert.equal(writes.length, 2);
});

test('unbound/malformed envelopes cannot authorize; ordinary and native professional calls retain existing defaults', async () => {
  const f = fixture(); f.close(); const { r } = registry();
  for (const content of ['[鲲鹏工作面上下文:bad]\n\nrequest', f.content]) {
    const id = `untrusted-${++sequence}`;
    const close = bindWorkspaceDispatchSession(id, content, { read: () => ({ ...f.state, items: [] }), subscribe: () => () => {} });
    assert.equal((await r.execute('bash', {}, undefined, { runId: id })).success, false); close();
  }
  assert.equal((await r.execute('bash', {}, undefined, { runId: 'ordinary' })).success, true);
  const professional = fixture('professional');
  try { assert.equal((await r.execute('canvas_update_node', {}, undefined, { runId: professional.runId })).success, true); }
  finally { professional.close(); }
  assert.notEqual(assistantThreadKey(f.target), assistantThreadKey({ ...f.target, accessScope: 'shot' }));
});

test('project scope preserves legacy tool admission while rejecting foreign project parameters and implicit relationship edits', async () => {
  const f = fixture('project'); const { r } = registry();
  try {
    assert.equal((await r.execute('workshop_set_breakdown', {}, undefined, { runId: f.runId })).success, true);
    assert.equal((await r.execute('write_file', {}, undefined, { runId: f.runId })).success, true);
    assert.equal((await r.execute('write_file', { project_id: 'other' }, undefined, { runId: f.runId })).success, false);
    assert.equal((await r.execute('bash', { projectId: 'other' }, undefined, { runId: f.runId })).success, false);
    assert.equal((await r.execute('project_update_object', { patch: { relationIds: ['other'] } }, undefined, { runId: f.runId })).success, false);
  } finally { f.close(); }
});

test('real intake queue dispatch permits initial script breakdown without an object registry', async () => {
  const queue = new ProjectAssistantQueue(undefined, 0);
  const intake = { brief: '请把雨夜司机的创意写成剧本并拆解镜头', mode: 'idea', automation: 'stage-confirm', createdAt: 123, attachments: [] };
  enqueueProjectIntake(queue, 'P', 'session', intake);
  const data = { projectId: 'P', characters: [], scenes: [], props: [], shots: [] };
  const { r, writes } = registry();
  const runId = `intake-${++sequence}`;
  const port = { read: () => ({ data, activeProjectId: 'P', sessionId: 'session', items: queue.getSnapshot().items }), subscribe: () => () => {} };
  let resolveSent, rejectSent;
  const sent = new Promise((resolve, reject) => { resolveSent = resolve; rejectSent = reject; });
  const detach = queue.attach({ projectId: 'P', safe: () => true, send: async (item) => {
    const close = bindWorkspaceDispatchSession(runId, serializeWorkspaceAssistantMessage(item.target, item.prompt), port);
    try {
      assert.equal(item.target.objectId, undefined);
      const authority = captureWorkspaceAuthority(item.target, data, item.prompt);
      assert.equal(authority.level, 'project');
      assert.equal(authority.request, intake.brief);
      assert.equal((await r.execute('workshop_set_breakdown', { project_id: 'P', shots: [] }, undefined, { runId })).success, true);
      assert.equal((await r.execute('workshop_set_breakdown', { project_id: 'other', shots: [] }, undefined, { runId })).success, false);
      // Context facts/discipline do not supply user authorization to rewrite relationships.
      assert.equal((await r.execute('project_update_object', { patch: { relationIds: ['other'] } }, undefined, { runId })).success, false);
      assert.equal(writes.length, 1);
      resolveSent();
    } catch (error) { rejectSent(error); }
    finally { close(); }
  } });
  try { await sent; } finally { detach(); }
});

test('missing registry degrades object targets to project level; only foreign project/registry is refused', () => {
  const data = { projectId: 'P', shots: [] };
  const target = { projectId: 'P', sessionId: 'session', accessScope: 'project', surface: 'media', label: 'project', context: '' };
  assert.equal(captureWorkspaceAuthority(target, data, '拆解剧本').level, 'project');
  // 空项目/未选中对象时 captureTarget 会带默认 outputType（无媒体含义）：降级为项目级目标，不得锁死整轮
  assert.equal(captureWorkspaceAuthority({ ...target, outputType: 'image' }, data, '写入剧本').level, 'project');
  // 注册表未就绪时对象目标降级为项目级，不再整轮拒绝
  assert.equal(captureWorkspaceAuthority({ ...target, objectId: 'O1' }, data, '调整镜头').level, 'project');
  // 悬空的 mediaId/versionId 或局部 accessScope 仍是非法目标
  for (const patch of [{ mediaId: 'M1' }, { versionId: 'V1' },
    { accessScope: 'media' }, { accessScope: 'shot' }, { projectId: 'other' }]) {
    assert.throws(() => captureWorkspaceAuthority({ ...target, ...patch }, data, '拆解剧本'));
  }
  assert.throws(() => captureWorkspaceAuthority(target, { ...data, projectObjects: { projectId: 'other' } }, '拆解剧本'));
});

test('empty project with selection-less media target (captureTarget shape) binds and runs reads/writes', () => {
  // 回归：空项目未选中对象时 captureTarget 产出 { outputType, objectId: undefined } 的目标，
  // 旧实现把整轮工具（含只读）全部锁死为"缺少有效的冻结目标"。
  const data = { projectId: 'P', characters: [], shots: [], projectObjects: { projectId: 'P', objects: [], media: [], versions: [] } };
  const target = { projectId: 'P', sessionId: 'session', surface: 'media', label: '项目对话', context: '', outputType: 'video' };
  const content = serializeWorkspaceAssistantMessage(target, '写入剧本正文并拆解');
  const state = { data, activeProjectId: 'P', sessionId: 'session', items: [{ id: 'item', status: 'running', target, prompt: '写入剧本正文并拆解' }] };
  const port = { read: () => state, subscribe: () => () => {} };
  const close = bindWorkspaceDispatchSession('empty-project-run', content, port);
  return (async () => {
    const { r, writes } = registry();
    try {
      assert.equal((await r.execute('project_get_objects', {}, undefined, { runId: 'empty-project-run' })).success, true, '只读项目读取必须可用');
      assert.equal((await r.execute('workshop_set_breakdown', {}, undefined, { runId: 'empty-project-run' })).success, true, '项目级拆解必须可用');
      assert.equal(writes.length, 2);
    } finally { close(); }
  })();
});

test('queued project authority binds only after dequeue; admitted runs share project-wide admission', async () => {
  const f = fixture(); const { r } = registry();
  const queuedTarget = { projectId: 'P', sessionId: 'session', surface: 'media', label: 'project', context: '项目上下文' };
  const queued = { id: 'next', status: 'queued', target: queuedTarget, prompt: '整理项目' };
  f.state.items.push(queued);
  const content = serializeWorkspaceAssistantMessage(queued.target, queued.prompt);
  const earlyId = `${f.runId}-early`;
  const earlyClose = bindWorkspaceDispatchSession(earlyId, content, f.port);
  try {
    // 未出队的 queued 项不能授权（提前绑定失败）；运行中的媒体级任务同项目内可做项目级拆解
    assert.equal((await r.execute('workshop_set_breakdown', {}, undefined, { runId: f.runId })).success, true);
    assert.equal((await r.execute('workshop_set_breakdown', {}, undefined, { runId: earlyId })).success, false);
    f.close();
    f.state.items[0].status = 'completed';
    queued.status = 'running';
    const nextId = `${f.runId}-next`;
    const nextClose = bindWorkspaceDispatchSession(nextId, content, f.port);
    try {
      assert.equal((await r.execute('workshop_set_breakdown', {}, undefined, { runId: nextId })).success, true);
      assert.equal((await r.execute('workshop_set_breakdown', {}, undefined, { runId: f.runId })).success, false);
    } finally { nextClose(); }
  } finally { earlyClose(); f.close(); }
});

const { AgentCoordinator } = load('./coordinator.ts', {
  './contextManager': { ContextManager: class { updateMaxTokens() {} microcompact(value) { return value; } estimateMessages() { return 0; } } },
  './logger': { agentLog: log }, './abortController': { createAbortController: () => new AbortController() },
  './findRelevantMemories': { findRelevantMemories: async () => [] },
  './autoCompact': { shouldAutoCompact: () => ({ compact: false }) },
  './temporalContext': { isTimeSensitiveQuery: () => false },
  './speechIntent': { buildDoubaoSpeechRoutingNotice: () => '', shouldRequireDoubaoSpeechToolCall: () => false },
  './hooks': { firePreToolUse: async () => ({}), firePostToolUse: async () => {} },
  './toolSummary': { sanitizeProgressText: (text) => text },
  './completionGuard': { terminalToolResults: () => [] },
  '../projectObjects/generationDraft': { shouldOfferToolConfirmation },
  './transientNoticeQueue': { TransientNoticeQueue: class { addOnce() {} endRun() {} } },
});

test('real coordinator tool-call loop routes every call through the same enforced registry', async () => {
  const f = fixture('shot'); const { r, writes } = registry();
  const proto = AgentCoordinator.prototype;
  proto.resolveModelAndWindow = () => ({ modelId: 'fixture', effectiveWindow: 100000 });
  proto.buildPrompt = () => 'fixture'; proto.refreshScopedSkills = () => {};
  proto.enforceHardContextBudget = () => {}; proto.hardContextBudget = () => 100000;
  const coordinator = new AgentCoordinator({ glmClient: {}, toolRegistry: r, cwd: '/fixture', maxTurns: 3 });
  let turns = 0;
  coordinator.streamToCompletion = async () => (++turns === 1 ? {
    text: '', finishReason: 'tool_calls', thinkingBlocks: [], toolCalls: [
      { id: 'allowed', function: { name: 'workshop_update_shot', arguments: JSON.stringify({ shot_no: '01-01', patch: { camera: '推进' } }) } },
      { id: 'other', function: { name: 'workshop_update_shot', arguments: JSON.stringify({ shot_no: '01-02', patch: { camera: '推进' } }) } },
      { id: 'escape', function: { name: 'bash', arguments: '{}' } },
    ],
  } : { text: 'done', finishReason: 'stop', thinkingBlocks: [], toolCalls: [] });
  const errors = [];
  try {
    await coordinator.run(f.content, { ...callbacks(), onError: (error) => errors.push(error.message) }, [], f.runId);
    assert.deepEqual(errors, []); assert.equal(turns, 2);
    // 冻结对象只是"正在看"的提示：同项目其他镜头与 bash 一律放行，不再被范围围栏拦截
    assert.equal(writes.length, 3);
    const results = coordinator.getMessages().filter((message) => message.role === 'tool');
    assert.equal(results.length, 3); assert.ok(!results.some((message) => message.content.includes('工作台范围保护')));
  } finally { f.close(); }
});

test('real project coordinator preserves native shell approvals and deny verdicts', async () => {
  const f = fixture('project'); const { r, executions } = nativeBashFixture();
  const proto = AgentCoordinator.prototype;
  proto.resolveModelAndWindow = () => ({ modelId: 'fixture', effectiveWindow: 100000 });
  proto.buildPrompt = () => 'fixture'; proto.refreshScopedSkills = () => {};
  proto.enforceHardContextBudget = () => {}; proto.hardContextBudget = () => 100000;
  const coordinator = new AgentCoordinator({ glmClient: {}, toolRegistry: r, cwd: '/fixture', maxTurns: 3 });
  let turns = 0;
  const commands = ['python /fixture/voice.py --speaker fixture', 'rm -r /fixture/rejected', 'rm -r /fixture/approved', 'rm -rf /'];
  coordinator.streamToCompletion = async () => (++turns === 1 ? {
    text: '', finishReason: 'tool_calls', thinkingBlocks: [], toolCalls: commands.map((command, index) => ({
      id: `shell-${index}`, function: { name: 'bash', arguments: JSON.stringify({ command }) },
    })),
  } : { text: 'done', finishReason: 'stop', thinkingBlocks: [], toolCalls: [] });
  const approvals = [], errors = [];
  try {
    await coordinator.run(f.content, { ...callbacks(async (_name, params) => {
      approvals.push(params.command); return params.command.endsWith('/approved');
    }), onError: (error) => errors.push(error.message) }, [], f.runId);
    assert.deepEqual(errors, []);
    assert.deepEqual(approvals, commands.slice(1, 3));
    assert.deepEqual(executions.map((entry) => entry.command), [commands[0], commands[2]]);
    const results = coordinator.getMessages().filter((message) => message.role === 'tool');
    assert.equal(results.length, 4);
    assert.match(results[1].content, /rejected/); assert.match(results[3].content, /denied/);
  } finally { f.close(); }
});
