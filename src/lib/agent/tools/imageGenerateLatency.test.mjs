import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function load(path, modules, globals = {}) {
  const exports = {};
  const js = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX } }).outputText;
  runInNewContext(js, { exports, require: id => { if (!(id in modules)) throw Error(id); return modules[id]; }, ...globals });
  return exports;
}
function fixture({ inspectFail = false, copyFail = false, fail = false } = {}) {
  let inspections = 0; const requests = [], copies = [], aborts = [];
  const modules = {
    '@tauri-apps/api/fs': { copyFile: async (...args) => { copies.push(args); if (copyFail) throw Error('disk'); } },
    '@/lib/agent/mediaInput': { loadMediaInput: async () => { inspections++; if (inspectFail) throw Error('decode'); return { dataUrl: 'data:image/png;base64,AAAA', mediaType: 'image/png' }; } },
    '@/stores/settingsStore': { useSettingsStore: { getState: () => ({ chatImageModel: 'gpt-image-2.5' }) } },
    '@/lib/canvasGen': { runGeneration: async req => { requests.push(req); req.onTaskCreated('task'); return { success: !fail, taskId: 'task', resultPaths: fail ? [] : ['/tmp/image.png'], error: fail ? 'pending' : undefined }; }, abortCanvasTask: id => aborts.push(id) },
    '@/lib/customMedia/runner': { findCustomMediaApi: () => ({label:'custom'}) },
    '@/lib/midjourney/styles': { MIDJOURNEY_STYLE_CATEGORIES: [], MIDJOURNEY_STYLE_PRESETS: [], getMidjourneyStyle: () => null, resolveMidjourneyStyleParameters: () => ({}), ensureMidjourneyStyleReference: async () => '', applyMidjourneyStylePrompt: p => p },
    '@/lib/midjourney/prompt': { normalizeMidjourneyVersion: v => v },
  };
  return { tool: load('./imageGenerateTool.ts', modules).imageGenerateTool, requests, copies, aborts, inspections: () => inspections };
}
test('all chat models use shared orchestration and return local previews without reading/uploading results', async () => {
  const f = fixture();
  for (const model of ['gpt-image-2.5','seedream-v5-pro','midjourney-v82','custom-media:test']) {
    const r = await f.tool.execute({model, prompt:'test', aspect_ratio:'9:16', reference_urls:['/tmp/ref.png']});
    assert.equal(r.success, true); assert.equal(r.media.length,0); assert.equal(r.generatedImages[0],'/tmp/image.png');
    const req=f.requests.at(-1); assert.equal(req.engineId,model); assert.equal(req.params.aspectRatio,'9:16'); assert.equal(req.referenceUrls[0],'/tmp/ref.png'); assert.equal(req.nodeId,undefined);
  }
  assert.equal(f.inspections(),0);
});
test('explicit native inspection is available; failed inspection never retries paid generation',async()=>{
  for(const inspectFail of [false,true]) {
    const f=fixture({inspectFail}); const r=await f.tool.execute({prompt:'test',inspect_result:true});
    assert.equal(r.success,true); assert.equal(r.media.length,inspectFail?0:1); assert.equal(f.requests.length,1);
  }
});
test('output copy failure preserves original paid result; pre-aborted requests submit nothing',async()=>{
  const f=fixture({copyFail:true}); const r=await f.tool.execute({prompt:'test',output_path:'/tmp/copy.png'});
  assert.equal(r.success,true); assert.match(r.output,/不要重新生成/); assert.equal(r.generatedImages[0],'/tmp/image.png'); assert.equal(f.requests.length,1);
  const ac=new AbortController(); ac.abort(); assert.equal((await f.tool.execute({prompt:'test'},ac.signal)).success,false); assert.equal(f.requests.length,1);
});
test('shared GPT router uses latency policy, excludes unhealthy routes, never randomly explores paid routes',()=>{
  const data=new Map();
  const router=load('../../imageRouter/metrics.ts',{
    '@/stores/settingsStore':{useSettingsStore:{getState:()=>({})}},
    '@/lib/credentials':{resolveApiKey:()=>''},
    '@/lib/apimart/contracts':{},
    './configuredChannels.ts':{discoverConfiguredImageSlots:()=>[{id:'slow',provider:'dmxapi'},{id:'fast',provider:'dmxapi'}],resolveConfiguredApimartApiKey:()=>''},
  },{localStorage:{getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)},Math:Object.assign(Object.create(Math),{random:()=>{throw Error('paid exploration');}})});
  router.setImageRouteSortMode('speed-first');
  const metric=(slot,tier,success,ms)=>router.recordImageRouteMetric({routeId:`api:${slot}:${tier}:text-to-image`,engineId:'gpt-image-2.5',mode:'text-to-image',startedAt:new Date().toISOString(),totalMs:ms,success});
  for(const tier of ['cheap','standard']) { metric('slow',tier,true,250000); metric('fast',tier,true,12000); }
  assert.match(router.chooseGptImageChannel('gpt-image-2.5',false),/^api:fast:/);
  for(const tier of ['cheap','standard']) {metric('fast',tier,false,100);metric('fast',tier,false,100);}
  assert.match(router.chooseGptImageChannel('gpt-image-2.5',false),/^api:slow:/);
  assert.equal(router.chooseGptImageChannel('api:explicit',false),'api:explicit');
});
test('local previews render outside collapsed execution details, including partial batch successes',()=>{
  const run={status:'running',steps:[{status:'active',toolCalls:[{status:'failed',generatedImages:['/tmp/a.png','/tmp/b.png','/tmp/a.png']}]}],progressUpdates:[]};
  const jsx=(type,props)=>({type,props});
  const modules={
    '@tauri-apps/api/tauri':{convertFileSrc:p=>`asset://${p}`},
    react:{useMemo:fn=>fn()},'react/jsx-runtime':{jsx,jsxs:jsx},'lucide-react':{},
    '@/stores/chatStore':{useChatStore:select=>select({currentSessionId:'s'})},
    '@/stores/runStepStore':{useRunStepStore:select=>select({runsById:{r:run}})},
    '@/lib/agent/runStepPresentation':{buildTimelinePresentationItems:()=>[]},
  };
  const Timeline=load('../../../components/chat/RunStepTimeline.tsx',modules).default;
  const tree=Timeline({runId:'r',embedded:true});
  const children=tree.props.children;
  assert.equal(children[0].type,'details');
  assert.equal(children[1].props['aria-label'],'生成图片');
  const images=children[1].props.children;
  assert.equal(images.length,2); assert.equal(images[0].props.src,'asset:///tmp/a.png');
});
