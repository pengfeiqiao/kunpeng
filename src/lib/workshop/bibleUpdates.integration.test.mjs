import * as saveNormalizer from './saveNormalizer.ts';
import * as historyStorage from './historyStorage.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as types from './types.ts';
import * as updates from './bibleUpdates.ts';
const compile = relative => ts.transpileModule(readFileSync(new URL(relative,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;

test('actual tool/store persist merged bibles to every file and publish existing stale indicators', async () => {
  let state;
  const writes = new Map();
  const store = {getState:()=>state};
  const modules = {
    '@/lib/workshop/saveNormalizer': saveNormalizer,
    '@/lib/workshop/historyStorage': historyStorage,
    zustand:{create:init=>{state=init(patch=>{state={...state,...patch};},()=>state);return store;}},
    '@/lib/workshop/bibleUpdates':updates,
    '@/lib/workshop/types':types,
    '@/stores/workshopStore':{useWorkshopStore:store},
    '@/lib/aigc/projectStore':{writeProjectFile:async(id,path,content)=>writes.set(path,JSON.parse(content))},
  };
  runInNewContext(compile('../../stores/workshopStore.ts'),{exports:{},require:id=>modules[id]??{},crypto,structuredClone});
  const data=updates.patchWorkshopBibles(types.emptyWorkshopData('p'),{
    director:{styleIntent:'原风格',cameraRules:['规则']},character:{globalRules:['原人物']},scene:{globalRules:['原场景']},continuity:{lockedItems:['原连续性']}
  },1);
  data.steps.assets.status='done';data.steps.prompts.status='done';data.steps.generate.status='done';data.steps.handoff.status='done';
  state={...state,data,project:{id:'p'},scheduleSave(){},commitNow:async()=>{writes.set('workshop.json',structuredClone(state.data));}};
  const exports={};
  runInNewContext(compile('../agent/tools/workshopTools.ts'),{exports,require:id=>modules[id]??{},console,structuredClone});
  const tool=exports.allWorkshopTools.find(tool=>tool.definition.name==='workshop_set_bibles');
  const result=await tool.execute({bibles:{director:{styleIntent:'新风格'}}});
  assert.equal(result.success,true);
  assert.deepEqual(writes.get('bibles/index.json'),JSON.parse(JSON.stringify(state.data.bibles)));
  for(const category of ['director','character','scene','continuity']) {
    assert.deepEqual(writes.get(`bibles/${category}-bible.json`),JSON.parse(JSON.stringify(state.data.bibles[category])));
  }
  assert.deepEqual(state.data.bibles.character.globalRules,['原人物']);
  assert.deepEqual(state.data.bibles.director.cameraRules,['规则']);
  for(const step of ['assets','prompts','generate','handoff']) assert.equal(writes.get('workshop.json').steps[step].status,'stale');
  const previous=state.data;
  writes.clear();
  assert.equal((await tool.execute({bibles:{scene:null}})).success,false);
  assert.equal(state.data,previous);assert.equal(writes.size,0);
});
