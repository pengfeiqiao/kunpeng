import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function fixture(localStorage) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('./chatStore.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require, localStorage });
  return exports.useChatStore;
}
test('attachment drafts survive page switches, remain session scoped, and clear after sending', () => {
  const store = fixture(); const paths = ['/ref.png'];
  store.getState().setDraftFiles('s', paths); paths.push('/not-added.png');
  for (const view of ['chat', 'copywriting', 'canvas', 'editor', 'workshop']) {
    store.getState().setActiveView(view);
    assert.deepEqual(Array.from(store.getState().draftFiles.s), ['/ref.png']);
  }
  store.getState().setDraftFiles('other', ['/other.pdf']);
  store.getState().setDraftFiles('s', prior => [...prior, '/second.png']);
  assert.equal(store.getState().draftFiles.s.length, 2);
  store.getState().setDraftFiles('s', []);
  assert.equal(store.getState().draftFiles.s, undefined);
  assert.deepEqual(Array.from(store.getState().draftFiles.other), ['/other.pdf']);
});


test('long-lived native drop callback targets the session at drop time', () => {
  const store = fixture();
  store.setState({ currentSessionId: 'old' });
  const nativeDrop = paths => store.getState().appendCurrentDraftFiles(paths);
  store.setState({ currentSessionId: 'new' });
  nativeDrop(['/new.png', '/new.png']);
  assert.equal(store.getState().draftFiles.old, undefined);
  assert.deepEqual(Array.from(store.getState().draftFiles.new), ['/new.png']);
  store.setState({ currentSessionId: 'old' }); nativeDrop(['/old.pdf']);
  assert.deepEqual(Array.from(store.getState().draftFiles.new), ['/new.png']);
  assert.deepEqual(Array.from(store.getState().draftFiles.old), ['/old.pdf']);
});

test('actual MessageInput native listener routes a post-switch drop into the visible conversation', async () => {
  const store=fixture();store.setState({currentSessionId:'before'});
  const effects=[];const listeners=new Map();
  const skillState={skills:[],activeSkillId:null,fieldValues:{},getActiveSkill:()=>null,setActiveSkill(){},setFieldValue(){}};
  const skill=selector=>selector(skillState);skill.getState=()=>skillState;
  const code=ts.transpileModule(readFileSync(new URL('../components/MessageInput.tsx',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,jsx:ts.JsxEmit.ReactJSX}}).outputText;
  // Zustand's React hook is replaced only for render selection; actions remain real.
  const hook=selector=>selector(store.getState());hook.getState=store.getState;
  // Re-evaluate with a selector-only hook to avoid invoking React's hook dispatcher.
  const module2={};
  const deps={};
  runInNewContext(code,{exports:module2,document:{addEventListener(){},removeEventListener(){}},require:id=>{
    if(id==='react')return {useState:value=>[value,()=>{}],useRef:value=>({current:value}),useEffect:fn=>effects.push(fn)};
    if(id==='react/jsx-runtime')return {jsx:()=>null,jsxs:()=>null};
    if(id==='framer-motion')return {motion:{div:()=>null}};
    if(id==='@/stores')return {useChatStore:hook,useSkillStore:skill,useSettingsStore:selector=>selector({})};
    if(id==='@tauri-apps/api/window')return {appWindow:{listen:async(name,fn)=>{listeners.set(name,fn);return ()=>listeners.delete(name);}}};
    return deps;
  }});
  module2.default({onSend(){}});
  const cleanups=effects.map(fn=>fn());await Promise.resolve();
  store.setState({currentSessionId:'after'});
  listeners.get('tauri://file-drop')({payload:['/current.png']});
  assert.equal(store.getState().draftFiles.before,undefined);
  assert.deepEqual(Array.from(store.getState().draftFiles.after),['/current.png']);
  cleanups.forEach(cleanup=>cleanup?.());
});

function memoryStorage() {
  const values = new Map();
  return { writes: 0, getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, value); this.writes++; } };
}
test('unsent attachments survive a new renderer and retain per-session and welcome drafts', () => {
  const storage = memoryStorage(); const first = fixture(storage);
  first.getState().setDraftFiles('s1', ['/image.png', '/reference.pdf']);
  first.getState().setDraftFiles('s2', ['/second.mp4']);
  first.getState().setDraftFiles('new:main', ['/welcome.jpg']);
  const writes = storage.writes;
  first.getState().setActiveView('copywriting'); first.getState().setStreamingContent('token');
  assert.equal(storage.writes, writes);
  const restored = fixture(storage);
  assert.deepEqual(Array.from(restored.getState().draftFiles.s1), ['/image.png', '/reference.pdf']);
  assert.deepEqual(Array.from(restored.getState().draftFiles['new:main']), ['/welcome.jpg']);
  restored.getState().setDraftFiles('s1', []);
  restored.getState().removeSession('s2');
  const again = fixture(storage);
  assert.equal(again.getState().draftFiles.s1, undefined);
  assert.equal(again.getState().draftFiles.s2, undefined);
  assert.deepEqual(Array.from(again.getState().draftFiles['new:main']), ['/welcome.jpg']);
});
test('invalid cache and write failure cannot erase the live attachment draft', () => {
  const storage = memoryStorage(); storage.setItem('kunpeng-attachment-drafts-v1', '{bad');
  const store = fixture(storage);
  assert.equal(Object.keys(store.getState().draftFiles).length, 0);
  storage.setItem = () => { throw new Error('quota'); };
  store.getState().setDraftFiles('s1', ['/keep.png']);
  assert.deepEqual(Array.from(store.getState().draftFiles.s1), ['/keep.png']);
  assert.match(store.getState().error, /附件草稿暂时无法保存/);
});

test('async automatic history restore cannot hide attachments dropped while loading', async () => {
  const store = fixture();
  let finishRead;
  const diskRead = new Promise(resolve => { finishRead = resolve; });
  const hook = selector => selector(store.getState()); hook.getState = store.getState;
  const module = {};
  const code = ts.transpileModule(readFileSync(new URL('../hooks/useSessions.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports: module, require: id => {
    if (id === 'react') return { useCallback: fn => fn };
    if (id === '@/stores') return { useChatStore: hook, useSettingsStore: { getState: () => ({ markSessionRead() {} }) } };
    if (id === '@/lib/historyPersistence') return { readMessagesFromLocalStorage: () => null, readSessionFromFile: () => diskRead, hydrateLocalStorageSession() {} };
    return {};
  } });
  const { loadSession } = module.useSessions();
  const pending = loadSession('old-session', () => !store.getState().currentSessionId && !store.getState().draftFiles['new:main']?.length);
  store.getState().appendCurrentDraftFiles(['/just-dropped.png']);
  finishRead({ messages: [], agentMessages: [] });
  assert.equal((await pending).loaded, false);
  assert.equal(store.getState().currentSessionId, null);
  assert.deepEqual(Array.from(store.getState().draftFiles['new:main']), ['/just-dropped.png']);
});
