import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import ts from 'typescript';
async function fixture() {
 const files=new Map(); let fail=false;
 const exports={};
 const api={BaseDirectory:{Home:1},createDir:async()=>{},exists:async p=>files.has(p),readTextFile:async p=>files.get(p),
 writeTextFile:async({path,contents})=>{await new Promise(r=>setTimeout(r,1));if(fail)throw Error('disk full');files.set(path,contents);},
 renameFile:async(a,b)=>{files.set(b,files.get(a));files.delete(a);}};
 const source=await readFile(new URL('./persist.ts',import.meta.url),'utf8');
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText,{exports,require:()=>api,console,Date});
 return {...exports,files,fail:()=>{fail=true;}};
}
test('concurrent appends persist all rows atomically; duplicate run is idempotent',async()=>{
 const f=await fixture();
 await Promise.all(Array.from({length:8},(_,i)=>f.appendExperienceLog({id:String(i),docId:'doc',sourceRunId:'r'+i})));
 assert.equal((await f.readExperienceLog()).length,8);
 await f.appendExperienceLog({id:'other',docId:'doc',sourceRunId:'r0'});
 assert.equal((await f.readExperienceLog()).length,8);
 await f.replaceExperienceLog([]);
 assert.equal((await f.readExperienceLog()).length,0);
 assert.ok([...f.files.keys()].some(k=>k.includes('backup-')));
});
test('disk failure rejects and leaves committed history intact',async()=>{
 const f=await fixture();await f.appendExperienceLog({id:'a',docId:'doc'});
 f.fail();await assert.rejects(f.appendExperienceLog({id:'b',docId:'doc'}),/disk full/);
 assert.equal((await f.readExperienceLog()).length,1);
});
