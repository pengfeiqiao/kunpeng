import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const compile = path => ts.transpileModule(readFileSync(new URL(path,import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
test('full local storage cannot prevent creating or completing a todo',()=>{
 const localStorage={length:0,key:()=>null,getItem:()=>null,removeItem:()=>{},setItem:()=>{throw new Error('The quota has been exceeded');}};
 const safe={};runInNewContext(compile('../lib/safeStorage.ts'),{exports:safe,localStorage,console:{warn(){},error(){}}});
 const exports={};runInNewContext(compile('./todoStore.ts'),{exports,require:id=>id==='@/lib/safeStorage'?safe:require(id),localStorage});
 const store=exports.useTodoStore;
 assert.doesNotThrow(()=>store.getState().setTodos('a',[{id:'1',content:'finish',status:'pending'}]));
 assert.doesNotThrow(()=>store.getState().setTodos('a',[{id:'1',content:'finish',status:'completed'}]));
 assert.equal(store.getState().todosBySession.a[0].status,'completed');
 assert.equal(store.getState().todosBySession.b,undefined);
});
