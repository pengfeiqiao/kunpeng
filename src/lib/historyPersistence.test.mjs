import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
function fixture(){
 const files=new Map();let fail=true,attempts=0;
 const fs={BaseDirectory:{Home:1},createDir:async()=>{},exists:async path=>files.has(path),
 readTextFile:async path=>files.get(typeof path==='string'?path:path.path),
 writeTextFile:async({path,contents})=>{attempts++;if(fail)throw Error('disk full');files.set(path,contents);},
 renameFile:async(a,b)=>{files.set(b,files.get(a));files.delete(a);},removeFile:async path=>files.delete(path)};
 const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('./historyPersistence.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,console:{warn(){}},setTimeout:fn=>{queueMicrotask(fn);return 1;},require:id=>{
 if(id==='@tauri-apps/api/fs')return fs;
 if(id==='@/lib/safeStorage')return {safeLocalStorage:{getItem:()=>null,setItem(){}}};
 if(id==='@/lib/sessionSanitize')return {sanitizeSessionFileData:x=>x,stripSessionMediaFromMessage:x=>x};
 throw Error(id);
 }});
 return {api:exports,files,recover:()=>{fail=false;},attempts:()=>attempts};
}
test('failed disk writes reject after bounded retries and recovery preserves both history sides',async()=>{
 const {api,files,recover,attempts}=fixture();
 await assert.rejects(api.writeSessionToFile('s',{messages:[{id:'u',role:'user',content:'UI'}],agentMessages:[]}),/disk full/);
 assert.equal(attempts(),3);assert.equal(api.sessionSaveFailed('s'),true);
 recover();await api.writeSessionToFile('s',{messages:[],agentMessages:[{role:'user',content:'agent'}]});
 const data=JSON.parse(files.get('.kunpeng/chats/s.json'));
 assert.equal(data.messages[0].content,'UI');assert.equal(data.agentMessages[0].content,'agent');
 assert.equal(api.sessionSaveFailed('s'),false);
});
test('newer queued snapshot wins after a failure and deletion does not resurrect failed history',async()=>{
 const {api,files,recover}=fixture();
 await assert.rejects(api.writeSessionToFile('s',{messages:[{id:'old',content:'old'}],agentMessages:[]}),/disk full/);
 await api.deleteSessionFile('s');recover();api.retryFailedSessionWrites();await new Promise(r=>setTimeout(r,5));
 assert.equal(files.has('.kunpeng/chats/s.json'),false);
 await Promise.all([api.writeSessionToFile('s',{messages:[{id:'one',content:'one'}],agentMessages:[]}),api.writeSessionToFile('s',{messages:[{id:'two',content:'two'}],agentMessages:[]})]);
 assert.equal(JSON.parse(files.get('.kunpeng/chats/s.json')).messages[0].content,'two');
});
