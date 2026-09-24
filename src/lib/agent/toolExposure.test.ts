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
