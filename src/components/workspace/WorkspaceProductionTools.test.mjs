import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { runInNewContext } from 'node:vm';
import * as productionSafety from '../../lib/workspace/productionSafety.ts';
import * as queueModule from '../../lib/workspace/projectAssistantQueue.ts';
import * as assistantMessage from '../../lib/workspace/workspaceAssistantMessage.ts';
import * as workspaceMessage from '../../lib/agent/workspaceMessage.ts';
import * as assistantTarget from './assistantTarget.ts';

const source = (path) => readFileSync(new URL(path, import.meta.url), 'utf8');
const panel = source('./WorkspaceProductionTools.tsx');
const assets = source('../workshop/steps/StepAssets.tsx');
const prompts = source('../workshop/steps/StepPrompts.tsx');

test('focused exports parse without loading stores, native ports or credentials', () => {
  for (const [name, text] of [['WorkspaceProductionTools.tsx', panel], ['StepAssets.tsx', assets], ['StepPrompts.tsx', prompts],
    ['generate.ts', source('../../lib/doubaoSpeech/generate.ts')], ['trim.ts', source('../../lib/doubaoSpeech/trim.ts')]]) {
    const result = ts.transpileModule(text, { fileName: name, reportDiagnostics: true,
      compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.ESNext } });
    assert.deepEqual((result.diagnostics ?? []).filter((item) => item.category === ts.DiagnosticCategory.Error), [], name);
  }
});
test('public integration props and supported object kinds remain explicit', () => {
  assert.match(panel, /interface WorkspaceProductionToolsProps \{ projectId: string; objectId: string; onClose: \(\) => void \}/);
  assert.match(panel, /WORKSPACE_PRODUCTION_KINDS = \['character', 'shot', 'scene', 'prop', 'scene-asset'\]/);
  assert.match(assets, /export type AssetCardProps/);
  assert.match(assets, /imagePath && !focused/);
});
test('safe callbacks precede legacy credential and direct generation paths', () => {
  const voice = assets.slice(assets.indexOf('export function AiVoiceButton'), assets.indexOf('export function AssetCard'));
  const audio = prompts.slice(prompts.indexOf('export function AudioPromptsSection'), prompts.indexOf('export function LegacyStoryboardModal'));
  assert.ok(voice.indexOf('await actions.generate') < voice.indexOf("import('@/lib/credentials')"));
  assert.ok(audio.indexOf('await actions.generate') < audio.indexOf("import('@/lib/credentials')"));
  assert.match(audio, /if \(actions\) \{ await actions.trim\(\); return; \}/);
  assert.match(panel, /requestConfirm\('workspace_speech_generate'/);
  assert.match(panel, /signal: lease.signal, risk \}/);
  assert.match(panel, /const risk = doubaoSpeechGenerateTool.risk/);
  assert.match(panel, /executionPreference = frozenData.projectSpec\?\.generationConfirmation/);
  assert.doesNotMatch(panel, /resolveApiKey|useSettingsStore|dispatchWorkshopPrompt/);
});
test('palette controls preserve original sentinel/follow and shared store remapping', () => {
  assert.match(prompts, /export function PaletteMenu/);
  assert.match(prompts, /value === '__none__'/);
  assert.match(panel, /onChange=\{\(colorPaletteId\) => patchShot\(\{ colorPaletteId \}\)\}/);
  assert.match(panel, /getState\(\).updateShot\(shot.shotNo, patch\)/);
});
test('old prompts and speech APIs are reused with no provider routing changes', () => {
  assert.match(panel, /buildVoiceDescPrompt\(character.id\)/);
  assert.match(panel, /buildAudioPromptsPrompt\(shot.shotNo\)/);
  assert.match(panel, /generateSpeech\(\{ text_prompt: job.prompt \}\)/);
  assert.match(panel, /generateShotAudio\(/);
  assert.match(panel, /frozenReferences:/);
  assert.match(panel, /await retainReceipt\(base\)/);
  assert.doesNotMatch(panel, /channel:|fetch\(|apiKey|retry\(/);
});

function assistantRuntime(prepare) {
  const data = { projectId: 'P', projectViewState: { workspaceSurface: 'media', workspaceMediaView: 'list' },
    characters: [], shots: [{ id: 'stable', shotNo: '01-01', dialogue: '原对白' }],
    projectObjects: { projectId: 'P', objects: [{ id: 'O', projectId: 'P', kind: 'shot', sourceId: 'stable', version: 1 }], media: [], versions: [] } };
  const target = productionSafety.captureProductionAssistantTarget(data, 'O', 'S', 'sound context', '配音');
  const queue = new queueModule.ProjectAssistantQueue(undefined, 0);
  queue.select(target);
  const effects = [];
  const states = {
    workshop: { project: { id: 'P', name: 'fixture' }, data },
    unified: { activeId: 'P' },
    chat: { currentSessionId: 'S', sessions: [{ id: 'S', projectId: 'P' }], messages: [], isStreaming: false, streamingPhase: 'idle' },
    runs: { runsById: {} }, confirm: { pending: [] }, ask: { pending: null, queue: [] },
  };
  const hook = (key) => Object.assign((select) => select(states[key]), { getState: () => states[key], subscribe: () => () => {} });
  const jsx = (type, props) => ({ type, props });
  const modules = {
    react: { useEffect: (effect) => effects.push(effect), useRef: (current) => ({ current }), useSyncExternalStore: (_subscribe, read) => read() },
    'react/jsx-runtime': { jsx, jsxs: jsx },
    '@/stores': { useChatStore: hook('chat') }, '@/stores/workshopStore': { useWorkshopStore: hook('workshop') },
    '@/stores/unifiedProjectStore': { useUnifiedProjectStore: hook('unified') },
    '@/stores/runStepStore': { useRunStepStore: hook('runs') }, '@/stores/toolConfirmStore': { useToolConfirmStore: hook('confirm') },
    '@/stores/askUserStore': { useAskUserStore: hook('ask') },
    '@/hooks/useCanvasMention': { useCanvasMention: () => ({}) },
    '@/stores/projectAssistantQueueStore': { projectAssistantQueue: queue },
    '@/lib/workspace/projectAssistantQueue': queueModule,
    '@/lib/workspace/productionSafety': productionSafety,
    '@/lib/workspace/workspaceAssistantMessage': assistantMessage,
    '@/lib/agent/workspaceMessage': workspaceMessage,
    '@/lib/workspace/agentContext': { buildWorkspaceAgentContext: () => 'fixture context' },
    '@/lib/workspace/contentModel': { workspaceSelection: () => ({}) },
    '@/lib/projectObjects/conversationRefs': { buildProjectConversationReferenceContext: () => '' },
    '@/lib/projectSessions': { ensureProjectSession: async () => prepare(data) },
    './assistantTarget': assistantTarget,
    '../chat/AgentDrawer': { default: 'drawer' },
  };
  const exports = {};
  const compiled = ts.transpileModule(source('./WorkspaceAssistant.tsx'), { compilerOptions: {
    jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } });
  runInNewContext(compiled.outputText, { exports, require: (id) => modules[id] ?? {}, structuredClone });
  let sends = 0;
  exports.default({ onSendMessage: async () => { sends++; }, onAbort() {} });
  // Mount the real queue-dispatch effect; UI listeners and native ports are deliberately not mounted.
  const close = effects[1]();
  return { queue, target, close, get sends() { return sends; } };
}

test('real assistant sender rejects deleted, renumbered and revised sound targets after session preparation', async () => {
  for (const change of [
    (data) => { data.projectObjects.objects = []; },
    (data) => { data.shots[0].shotNo = '02-01'; data.shots.push({ id: 'replacement', shotNo: '01-01', dialogue: '原对白' }); },
    (data) => { data.projectObjects.objects[0].version++; },
    (data) => { data.shots[0].dialogue = '后续编辑'; },
  ]) {
    const runtime = assistantRuntime(change);
    try {
      const settled = new Promise((resolve) => {
        const off = runtime.queue.subscribe(() => {
          const item = runtime.queue.getSnapshot().items[0];
          if (item && ['failed', 'uncertain', 'done'].includes(item.status)) { off(); resolve(item); }
        });
      });
      runtime.queue.enqueue(runtime.target, '为原镜头编写配音提示词');
      const item = await settled;
      assert.equal(item.status, 'failed');
      assert.equal(runtime.sends, 0);
      assert.match(item.error, /声音助手/);
    } finally { runtime.close(); }
  }
});

test('real assistant sender still sends an unchanged frozen sound target once', async () => {
  const runtime = assistantRuntime(() => {});
  try {
    const settled = new Promise((resolve) => {
      const off = runtime.queue.subscribe(() => {
        const item = runtime.queue.getSnapshot().items[0];
        if (item && ['failed', 'uncertain', 'done'].includes(item.status)) { off(); resolve(item); }
      });
    });
    runtime.queue.enqueue(runtime.target, '为原镜头编写配音提示词');
    assert.equal((await settled).status, 'done');
    assert.equal(runtime.sends, 1);
  } finally { runtime.close(); }
});

async function productionRuntime({ preference, risk = 'ask', kind = 'character', confirm = () => true,
  beforeReceipt, afterSubmit, beforeArtifactCheck, failReceipt = false, failSpeech = false,
  missingArtifact = false, savedReceipts = [] } = {}) {
  const character = { id: 'actor', name: 'Actor', personality: '', appearance: '', voicePath: '/fake/reference.wav' };
  const shot = { id: 'shot', shotNo: '01', characterIds: ['actor'], voiceCharacterIds: ['actor'],
    audioPrompts: [{ characterId: 'actor', prompt: 'exact approved dialogue' }], audioInjected: true,
    generatedAudios: [{ characterId: 'actor', characterName: 'Actor', path: '/fake/old-dialogue.mp3', duration: 20 },
      { characterId: 'other', characterName: 'Other', path: '/fake/other-dialogue.mp3', duration: 4 }] };
  const objectId = `${kind}:${kind === 'shot' ? 'shot' : 'actor'}`;
  const data = { projectId: 'P', characters: [character], shots: [shot], props: [], scenes: [], colorPalettes: [],
    workspaceDrafts: { video: { prompt: 'unchanged @音频1', references: [{ type: 'audio', path: '/fake/old-dialogue.mp3' }] } },
    ...(preference ? { projectSpec: { generationConfirmation: preference } } : {}),
    projectObjects: { projectId: 'P', objects: [{ id: objectId, projectId: 'P', kind,
      sourceId: kind === 'shot' ? 'shot' : 'actor', version: 1 }], media: [], versions: [] } };
  const states = { workshop: { project: { id: 'P' }, data }, unified: { activeId: 'P' }, chat: {} };
  const subscribers = new Set();
  const notify = () => subscribers.forEach((listener) => listener());
  const effects = [], cleanups = [], hookStates = [], events = [], records = [], submissions = [], confirmations = [];
  const applied = [];
  let hookIndex = 0, uuid = 0;
  const runtime = {
    data, states, events, records, submissions, confirmations, applied,
    switchProject() { states.unified.activeId = 'OTHER'; notify(); },
    changePreference(value) { data.projectSpec = { generationConfirmation: value }; notify(); },
    editCharacter() { character.appearance = 'later edit'; notify(); },
    lockObject() { data.projectObjects.objects[0].locked = true; notify(); },
    deleteObject() { data.projectObjects.objects = []; notify(); },
  };
  states.workshop.setCharacterVoice = (...args) => {
    events.push('apply'); applied.push(args); character.voicePath = args[1]; character.voiceSource = args[2]; notify();
  };
  states.workshop.updateShot = (...args) => { events.push('apply'); applied.push(args); Object.assign(shot, args[1]); notify(); };
  const hook = (key) => Object.assign((select) => select(states[key]), {
    getState: () => states[key], subscribe: (listener) => { subscribers.add(listener); return () => subscribers.delete(listener); },
  });
  const jsx = (type, props) => ({ type, props });
  const nativeFs = {
    BaseDirectory: { Home: 'fake' }, exists: async (path) => {
      if (path.includes('/production-receipts/')) return savedReceipts.length > 0;
      await beforeArtifactCheck?.(runtime); return !missingArtifact;
    }, readDir: async () => savedReceipts.map((_, index) => ({ name: `${index}.json`, path: `/fake/${index}.json` })),
    readTextFile: async (path) => JSON.stringify(savedReceipts[Number(path.split('/').pop().split('.')[0])]), createDir: async () => {},
    readBinaryFile: async () => new Uint8Array([1, 2, 3]), copyFile: async () => {},
    writeTextFile: async (_path, text) => {
      const receipt = JSON.parse(text); events.push(`receipt:${receipt.status}`);
      if (failReceipt) throw new Error('fake receipt failure');
      records.push(receipt);
      if (receipt.status === 'started') await beforeReceipt?.(runtime);
    },
    writeBinaryFile: async () => { events.push('output'); },
  };
  const submitSpeech = async (request) => {
    events.push('submit'); submissions.push(structuredClone(request));
    if (failSpeech) throw new Error('fake uncertain speech');
    await afterSubmit?.(runtime);
    return { duration: 2 };
  };
  const modules = {
    react: {
      useState(initial) { const index = hookIndex++; if (!(index in hookStates)) hookStates[index] = initial;
        return [hookStates[index], (next) => { hookStates[index] = typeof next === 'function' ? next(hookStates[index]) : next; }]; },
      useRef(current) { const index = hookIndex++; return hookStates[index] ?? (hookStates[index] = { current }); },
      useEffect(effect) { const index = hookIndex++; if (!(index in hookStates)) { hookStates[index] = true; effects.push(effect); } },
      useSyncExternalStore: (_subscribe, read) => read(),
    },
    'react/jsx-runtime': { jsx, jsxs: jsx }, 'lucide-react': {},
    '@tauri-apps/api/fs': nativeFs, '@tauri-apps/api/path': { homeDir: async () => '/fake-home' },
    '@tauri-apps/api/tauri': { convertFileSrc: (path) => path }, '@tauri-apps/api/dialog': {}, '@tauri-apps/api/shell': {},
    '@/stores/workshopStore': { useWorkshopStore: hook('workshop') }, '@/stores/unifiedProjectStore': { useUnifiedProjectStore: hook('unified') },
    '@/stores': { useChatStore: hook('chat') }, '@/stores/projectAssistantQueueStore': {},
    '@/stores/toolConfirmStore': { useToolConfirmStore: { getState: () => ({ requestConfirm: async (...args) => {
      events.push('confirm'); confirmations.push(args); return confirm(runtime);
    } }) } },
    '@/components/workshop/steps/StepAssets': { AssetCard: 'AssetCard' },
    '@/components/workshop/steps/StepPrompts': { AudioPromptsSection: 'AudioPromptsSection', PaletteMenu: 'PaletteMenu' },
    '@/lib/workshop/workshopPrompts': {}, '@/lib/workspace/productionSafety': productionSafety,
    '@/lib/workspace/assetDraftModel': { workspaceAsset: () => kind === 'character' ? { kind, asset: character } : undefined },
    '@/lib/workspace/assetCandidates': { workspaceAssetCandidates: () => [] }, './workspaceProductionTools.css': {},
    '@/lib/agent/tools/doubaoSpeechTool': { doubaoSpeechGenerateTool: { risk } },
    '@/lib/doubaoSpeech/client': { generateSpeech: submitSpeech, fetchSpeechAudioBytes: async () => new Uint8Array([4, 5, 6]) },
    '@/lib/doubaoSpeech/generate': { generateShotAudio: async (snapshot, _characters, _project, _progress, options) => {
      options.beforeSubmit(); await submitSpeech({ snapshot, options: { ...options, beforeSubmit: undefined } });
      return [{ characterId: 'actor', characterName: 'Actor', path: '/fake/result.mp3', duration: 2 }];
    } },
    '@/lib/doubaoSpeech/trim': { trimAudiosToFit: async (audios, limit, _projectId, id) => audios.map((audio) => ({
      ...audio, trimmedPath: `/fake/trimmed-${id}.wav`, trimmedDuration: limit,
    })) },
  };
  const exported = {};
  const compiled = ts.transpileModule(panel, { compilerOptions: { jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.CommonJS } });
  runInNewContext(compiled.outputText, { exports: exported, require: (id) => {
    assert.ok(id in modules, `unexpected real module: ${id}`); return modules[id];
  }, structuredClone, Uint8Array, btoa, crypto: { randomUUID: () => `fake-run-${++uuid}`,
    subtle: { digest: async () => new Uint8Array([7, 8, 9]).buffer } } });
  const wrapper = exported.default({ projectId: 'P', objectId, onClose() {} });
  const find = (node, type, predicate = () => true) => {
    if (!node || typeof node !== 'object') return undefined;
    if (node.type === type && predicate(node.props)) return node;
    for (const child of [node.props?.children].flat(Infinity)) { const found = find(child, type, predicate); if (found) return found; }
  };
  const render = () => { hookIndex = 0; return wrapper.type(wrapper.props); };
  render(); for (const effect of effects.splice(0)) cleanups.push(effect());
  // Flush the fake receipt-directory existence check before invoking the real UI action.
  await new Promise((resolve) => setImmediate(resolve));
  runtime.generate = () => {
    const tree = render();
    return kind === 'shot' ? find(tree, 'AudioPromptsSection').props.actions.generate()
      : find(tree, 'AssetCard').props.voiceActions.generate('exact approved voice prompt');
  };
  runtime.trim = () => find(render(), 'AudioPromptsSection').props.actions.trim();
  runtime.preview = (id) => {
    const row = find(render(), 'div', (props) => props['data-production-receipt-id'] === id);
    return find(row, 'audio')?.props;
  };
  runtime.adopt = async (id) => {
    const row = find(render(), 'div', (props) => props['data-production-receipt-id'] === id);
    const button = find(row, 'button', (props) => props.title === '采用此产物');
    assert.ok(button, 'existing candidate adopt action'); assert.equal(button.props.disabled, false);
    button.props.onClick(); await new Promise((resolve) => setImmediate(resolve));
  };
  runtime.close = () => cleanups.forEach((close) => close?.());
  return runtime;
}

for (const kind of ['character', 'shot']) {
  for (const preference of [undefined, 'paid-only-confirm', 'always-confirm', 'direct-execute']) {
    for (const risk of ['ask', 'safe']) {
      test(`real ${kind} UI uses project ${preference ?? 'default'} preference and speech metadata ${risk}`, async () => {
        const runtime = await productionRuntime({ kind, preference, risk });
        try {
          const before = structuredClone(runtime.data);
          await runtime.generate();
          const mustConfirm = preference === 'always-confirm' || (preference !== 'direct-execute' && risk !== 'safe');
          assert.equal(runtime.confirmations.length, mustConfirm ? 1 : 0);
          assert.equal(runtime.submissions.length, 1); assert.equal(runtime.applied.length, 0);
          assert.deepEqual(runtime.data, before);
          assert.ok(runtime.events.indexOf('receipt:started') < runtime.events.indexOf('submit'));
          assert.ok(runtime.events.includes('receipt:completed')); assert.ok(!runtime.events.includes('apply'));
          if (mustConfirm) assert.equal(runtime.confirmations[0][3].risk, risk);
          if (kind === 'shot') {
            assert.equal(runtime.submissions[0].options.frozenReferences.actor, 'AQID');
            assert.equal(runtime.submissions[0].snapshot.audioPrompts[0].prompt, 'exact approved dialogue');
          }
          // A second real click must consult receipts even when confirmation is disabled.
          await runtime.generate(); assert.equal(runtime.submissions.length, 1);
        } finally { runtime.close(); }
      });
    }
  }
}

test('real UI confirmation rejection never writes a receipt or submits', async () => {
  const runtime = await productionRuntime({ confirm: () => false });
  try { await runtime.generate(); assert.equal(runtime.confirmations.length, 1); assert.equal(runtime.records.length, 0); assert.equal(runtime.submissions.length, 0); }
  finally { runtime.close(); }
});
test('real direct UI cancels after receipt persistence when project or preference changes', async () => {
  for (const beforeReceipt of [(runtime) => runtime.switchProject(), (runtime) => runtime.changePreference('always-confirm'), (runtime) => runtime.close()]) {
    const runtime = await productionRuntime({ preference: 'direct-execute', beforeReceipt });
    try {
      await runtime.generate(); assert.equal(runtime.confirmations.length, 0); assert.equal(runtime.submissions.length, 0);
      assert.equal(runtime.records.at(-1).status, 'cancelled');
    } finally { runtime.close(); }
  }
});
test('real direct UI is fail-closed on receipt persistence failure and deny metadata', async () => {
  for (const options of [{ failReceipt: true }, { risk: 'deny' }]) {
    const runtime = await productionRuntime({ preference: 'direct-execute', ...options });
    try { await runtime.generate(); assert.equal(runtime.submissions.length, 0); assert.equal(runtime.applied.length, 0); }
    finally { runtime.close(); }
  }
});
test('real direct UI retains late artifacts and does not repeat an uncertain paid job', async () => {
  const late = await productionRuntime({ preference: 'direct-execute', afterSubmit: (runtime) => runtime.editCharacter() });
  try { await late.generate(); assert.equal(late.records.at(-1).status, 'completed'); assert.equal(late.applied.length, 0); }
  finally { late.close(); }
  const uncertain = await productionRuntime({ preference: 'direct-execute', failSpeech: true });
  try {
    await uncertain.generate(); assert.equal(uncertain.records.at(-1).status, 'uncertain');
    await uncertain.generate(); assert.equal(uncertain.submissions.length, 1);
  } finally { uncertain.close(); }
});

test('generation code cannot call target writers; adoption stays a separate explicit action', () => {
  const generation = panel.slice(panel.indexOf('  const generate ='), panel.indexOf('  const upload ='));
  assert.doesNotMatch(generation, /setCharacterVoice|updateShot\(|apply:/);
  const helper = source('../../lib/workspace/productionSafety.ts').split('export async function runConfirmedProduction')[1];
  assert.doesNotMatch(helper, /input\.apply|apply:/);
  assert.match(panel, /receipt.status !== 'completed'/);
});

for (const kind of ['character', 'shot']) {
  test(`new ${kind} sound candidate is previewable and changes the selected version only on explicit adoption`, async () => {
    const runtime = await productionRuntime({ kind, preference: 'direct-execute' });
    try {
      const before = structuredClone(runtime.data);
      await runtime.generate();
      const receipt = runtime.records.find((item) => item.status === 'completed');
      assert.ok(receipt); assert.deepEqual(runtime.data, before); assert.equal(runtime.applied.length, 0);
      const preview = runtime.preview(receipt.id);
      assert.equal(preview.controls, true); assert.equal(preview.src, receipt.audio.path);
      assert.match(preview['aria-label'], /试听 Actor/);
      await runtime.adopt(receipt.id);
      assert.equal(runtime.applied.length, 1); assert.equal(runtime.submissions.length, 1);
      if (kind === 'character') {
        assert.equal(runtime.data.characters[0].voicePath, receipt.audio.path);
        assert.deepEqual(runtime.applied[0], ['actor', receipt.audio.path, 'tts']);
        assert.deepEqual(runtime.data.shots, before.shots);
      } else {
        assert.equal(runtime.data.shots[0].generatedAudios.find((item) => item.characterId === 'actor').path, receipt.audio.path);
        assert.deepEqual(runtime.data.shots[0].generatedAudios.find((item) => item.characterId === 'other'), before.shots[0].generatedAudios[1]);
        assert.equal(runtime.data.shots[0].audioInjected, false);
        assert.deepEqual(runtime.data.characters, before.characters);
      }
    } finally { runtime.close(); }
  });
  test(`persisted ${kind} candidate survives reopening without adoption and remains usable`, async () => {
    const first = await productionRuntime({ kind, preference: 'direct-execute' });
    let saved;
    try { await first.generate(); saved = structuredClone(first.records); } finally { first.close(); }
    const reopened = await productionRuntime({ kind, savedReceipts: saved });
    try {
      const receipt = saved.find((item) => item.status === 'completed');
      assert.equal(reopened.preview(receipt.id).src, receipt.audio.path);
      assert.equal(reopened.applied.length, 0); assert.equal(reopened.submissions.length, 0);
      await reopened.adopt(receipt.id); assert.equal(reopened.applied.length, 1);
    } finally { reopened.close(); }
  });
}

test('explicit adopt rejects a missing artifact and any target change during file validation', async () => {
  for (const options of [{ missingArtifact: true }, { beforeArtifactCheck: (runtime) => runtime.switchProject() },
    { beforeArtifactCheck: (runtime) => runtime.editCharacter() }, { beforeArtifactCheck: (runtime) => runtime.lockObject() },
    { beforeArtifactCheck: (runtime) => runtime.deleteObject() }]) {
    const runtime = await productionRuntime({ preference: 'direct-execute', ...options });
    try {
      await runtime.generate(); const receipt = runtime.records.find((item) => item.status === 'completed');
      await runtime.adopt(receipt.id);
      assert.equal(runtime.applied.length, 0); assert.equal(runtime.data.characters[0].voicePath, '/fake/reference.wav');
    } finally { runtime.close(); }
  }
});

test('trimmed audio is a separately previewable candidate and does not replace active audio or references', async () => {
  const runtime = await productionRuntime({ kind: 'shot' });
  try {
    const before = structuredClone(runtime.data);
    await runtime.trim();
    assert.deepEqual(runtime.data, before); assert.equal(runtime.applied.length, 0); assert.equal(runtime.submissions.length, 0);
    const receipt = runtime.records.find((item) => item.kind === 'trim' && item.job.characterId === 'actor');
    assert.ok(receipt.audio.trimmedPath); assert.equal(runtime.preview(receipt.id).src, receipt.audio.trimmedPath);
    await runtime.adopt(receipt.id);
    assert.equal(runtime.data.shots[0].generatedAudios.find((item) => item.characterId === 'actor').trimmedPath, receipt.audio.trimmedPath);
  } finally { runtime.close(); }
});
