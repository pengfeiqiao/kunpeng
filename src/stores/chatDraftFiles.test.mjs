import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
function fixture() {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL('./chatStore.ts', import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  runInNewContext(code, { exports, require });
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
