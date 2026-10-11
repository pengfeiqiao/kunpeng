import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import ts from 'typescript';
test('DSH refuses guidance once the last answer enters asynchronous disposal',async()=>{
 let finishDispose;const disposal=new Promise(r=>finishDispose=r);let disposing=false;
 class Client {constructor(_options,_id,update){this.update=update;}async start(){}async prompt(){this.update({update:{}});return {stopReason:'end_turn'};}async dispose(){disposing=true;await disposal;}}
 class Tools {async start(){}dispose(){}}
 const modules={'./acpClient':{DshAcpClient:Client},'./toolBridge':{DshToolBridge:Tools},'./streamUpdate':{parseDshStreamUpdate:()=>({type:'text',text:'answer'})},'../toolSummary':{sanitizeProgressText:x=>x}};
 const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('./DshBridge.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:id=>modules[id],DOMException});
 const bridge=new exports.DshBridge();const run=bridge.run({runId:'a',input:'question',toolRegistry:{releaseSoftware(){}},callbacks:{onTextDelta(){}}});
 for(let i=0;i<10&&!disposing;i++)await Promise.resolve();assert.equal(disposing,true);
 assert.equal(bridge.queueGuidance('too late'),false);finishDispose();assert.equal((await run).text,'answer');assert.equal(bridge.queueGuidance('also too late'),false);
});
