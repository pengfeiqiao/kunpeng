import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const code=ts.transpileModule(readFileSync(new URL('./browserTool.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
function browser(){const exports={};let reads=0;runInNewContext(code,{exports,require:id=>id==='@tauri-apps/api/tauri'?{invoke:async()=>'/tmp/screenshot.png'}:{loadImageInput:async()=>{reads++;return 'data:image/png;base64,aGVsbG8=';}}});return {tool:exports.browserControlTool,reads:()=>reads};}
test('native visual models receive screenshot bytes directly; nonvisual models retain file workflow',async()=>{
 const {tool,reads}=browser();
 for(const model of ['gpt','deepseek','kimi']){
  const result=await tool.execute({action:'screenshot'},undefined,{nativeVision:true,model});
  assert.equal(result.success,true);assert.equal(result.media[0].source.data,'aGVsbG8=');
 }
 const legacy=await tool.execute({action:'screenshot'},undefined,{nativeVision:false});
 assert.equal(legacy.media,undefined);assert.match(legacy.output,/image_recognition/);assert.equal(reads(),3);
});
test('cancelled screenshot is not loaded into model history',async()=>{
 const {tool,reads}=browser();const controller=new AbortController();controller.abort();
 const result=await tool.execute({action:'screenshot'},controller.signal,{nativeVision:true});
 assert.equal(result.success,false);assert.equal(reads(),0);
});
