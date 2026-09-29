import test from 'node:test';import assert from 'node:assert/strict';import {ToolExposure} from './toolExposure.ts';
const catalog=Array.from({length:60},(_,i)=>({name:`scene_${i}`,description:'场景操作',parameters:{type:'object' as const,properties:{value:{type:'string' as const,description:'x'.repeat(2000)}}}}));
test('large catalogs expose discovery, load exact schemas, and isolate conversations',()=>{
 const a=new ToolExposure(),b=new ToolExposure();const small=a.definitions(catalog);
 assert.equal(small.length,1);assert.equal(small[0].name,'tool_search');
 assert.ok(JSON.stringify(small).length<JSON.stringify(catalog).length/4);
 assert.equal(a.load(['scene_9']).success,true);
 assert.equal(a.definitions(catalog)[0],catalog[9]);assert.equal(b.definitions(catalog).length,1);
 assert.equal(a.load(['missing']).success,false);
 assert.equal(a.load(['scene_9'],catalog.filter(t=>t.name!=='scene_9')).success,false);
 a.clear();assert.equal(a.definitions(catalog).length,1);
});
test('small catalogs retain existing behavior and loaded names do not bypass disabled tools',()=>{
 const exposure=new ToolExposure();assert.equal(exposure.definitions(catalog.slice(0,3)).length,3);
 exposure.load(['scene_1']);assert.equal(exposure.definitions(catalog.filter(t=>t.name!=='scene_1')).some(t=>t.name==='scene_1'),false);
});

test('search discovers a video model from full parameters even when absent from the short directory', () => {
 const video={name:'video_generate',description:'直接生成视频。'+'说明'.repeat(80),parameters:{type:'object' as const,properties:{engine:{type:'string' as const,description:'支持 wan-3.0、seedance-2.0'}}}};
 const all=[...catalog,video]; const exposure=new ToolExposure();
 assert.equal(exposure.definitions(all).some(t=>t.name==='video_generate'),false);
 const result=exposure.load(undefined,all,'wan3.0');
 assert.equal(result.success,true);
 assert.deepEqual(JSON.parse(result.output).loaded,['video_generate']);
 assert.equal(exposure.definitions(all).find(t=>t.name==='video_generate'),video);
 assert.match(result.output,/没有执行生成/);
 const another=new ToolExposure();
 assert.deepEqual(JSON.parse(another.load(undefined,all,'视频生成').output).loaded,['video_generate']);
 assert.equal(another.load([],all,'wan3.0').success,true);
 assert.equal(another.load(null,all,'wan3.0').success,true);
 assert.equal(another.load(undefined,catalog,'wan3.0').output.includes('不代表全产品不支持'),true);
});
test('capability entry stays visible and discovery never re-enables a disabled tool', () => {
 const entry={name:'view_capabilities',description:'能力入口',parameters:{type:'object' as const,properties:{}}};
 const exposure=new ToolExposure();
 assert.ok(exposure.definitions([...catalog,entry]).some(t=>t.name===entry.name));
 assert.equal(exposure.load(undefined, catalog, '').success,false);
 exposure.load(undefined,catalog,'scene_9');
 assert.equal(exposure.definitions(catalog.filter(t=>t.name!=='scene_9')).some(t=>t.name==='scene_9'),false);
});
