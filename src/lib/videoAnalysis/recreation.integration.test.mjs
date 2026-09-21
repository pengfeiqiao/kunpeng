import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
import * as recreation from './recreation.ts';
function fixture() {
  const calls=[];
  let response={title:'测试参考',shotTable:['0-2 主体入场'],visualDesign:['右侧比较板'],htmlCssPatterns:['跨镜保持比较板'],semanticEvents:['结论词触发数字'],recreationPlan:['换主题保留论证'],evidenceLimits:['无精确逐词对齐']};
  const source=readFileSync(new URL('../editor/kimiEditAgent.ts',import.meta.url),'utf8')+'\nexport {askKimiForNativeVideoProfile, askKimiForProfile};';
  const exports={};
  const modules={
    '../videoAnalysis/recreation':recreation,
    '@/lib/agent/kimiClient':{isKimiK3Configured:()=>true,kimiK3Chat:async messages=>{calls.push(messages);return JSON.stringify(response);}},
    '@/lib/agent/tools/dmxClient':{loadImageInput:async()=> 'data:image/png;base64,abc'},
  };
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(js,{exports,require:id=>modules[id]??{},console,setTimeout,clearTimeout,setInterval,clearInterval});
  return {api:exports,calls,setResponse:value=>{response=value;}};
}
test('native and indexed profile paths retain detailed evidence and feed existing edit planning',async()=>{
  const {api,calls,setResponse}=fixture();
  const native=await api.askKimiForNativeVideoProfile({path:'/a.mp4',duration:10,videoUrl:'ms://a'});
  const indexed=await api.askKimiForProfile({path:'/a.mp4',duration:10,frames:[{t:0,path:'/f.png',description:'人物入场',source:'scene'}],segments:[],videoUrl:null});
  for(const profile of [native,indexed]) {
    assert.equal(profile.shotTable[0],'0-2 主体入场');
    assert.equal(profile.semanticEvents[0],'结论词触发数字');
    assert.equal(profile.recreationPlan[0],'换主题保留论证');
  }
  setResponse({title:'计划',shots:[]});
  await api.kimiEditPlan({references:[{referenceProfile:native,frames:[],referenceId:native.id}],timelineState:'已有素材',goal:'换主题'});
  assert.ok(JSON.stringify(calls.at(-1)).includes('结论词触发数字'));
  assert.ok(JSON.stringify(calls.at(-1)).includes('跨镜保持比较板'));
});
test('text-only source is explicitly recorded instead of pretending native viewing',async()=>{
  const {api}=fixture();
  const profile=await api.askKimiForProfile({path:'/a.mp4',duration:10,frames:[],segments:[],videoUrl:null});
  assert.ok(profile.evidenceLimits.some(item=>item.includes('未直接观看')));
});

test('media endpoint rejection cannot silently turn native-video analysis into a text-only success',async()=>{
  const requests=[];
  const source=readFileSync(new URL('../editor/kimiEditAgent.ts',import.meta.url),'utf8')+'\nexport {askKimiForNativeVideoProfile};';
  const exports={};
  const modules={
    '../videoAnalysis/recreation':recreation,
    '@/lib/agent/kimiClient':{isKimiK3Configured:()=>false},
    '@/stores/settingsStore':{useSettingsStore:{getState:()=>({kimiEditModel:'mock'})}},
    '@/lib/agent/tools/dmxClient':{getDmxApiKey:()=> 'fake-test-key'},
    '@tauri-apps/api/http':{Body:{json:x=>x},ResponseType:{Text:'text'},fetch:async url=>{requests.push(url);return {ok:false,status:400,data:'unsupported media'};}},
  };
  const js=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  runInNewContext(js,{exports,require:id=>modules[id]??{},console});
  await assert.rejects(()=>exports.askKimiForNativeVideoProfile({path:'/a.mp4',duration:10,videoUrl:'ms://a'}),/unsupported media/);
  assert.equal(requests.length,1);
  assert.ok(requests[0].endsWith('/chat/completions'));
});
