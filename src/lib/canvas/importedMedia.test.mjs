import test from 'node:test';import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';import {runInNewContext} from 'node:vm';import ts from 'typescript';
import {localMediaPath} from './mediaPath.ts';
test('import retains independent bytes and does not duplicate already retained files', async()=>{
 const files=new Map([['/home/Downloads/a.png','original-image']]);let copies=0;
 const modules={'@tauri-apps/api/fs':{createDir:async()=>{},copyFile:async(a,b)=>{if(!files.has(a))throw Error('missing');files.set(b,files.get(a));copies++;}},'@tauri-apps/api/path':{homeDir:async()=>'/home/'},nanoid:{nanoid:()=> 'unique'},'./mediaPath':{localMediaPath}};
 const exports={};runInNewContext(ts.transpileModule(readFileSync(new URL('./importedMedia.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2021}}).outputText,{exports,require:id=>modules[id]});
 const saved=await exports.retainImportedMedia('/home/Downloads/a.png');files.delete('/home/Downloads/a.png');
 assert.equal(files.get(saved),'original-image');assert.equal(await exports.retainImportedMedia(saved),saved);assert.equal(copies,1);
 await assert.rejects(exports.retainImportedMedia('/home/Downloads/missing.png'),/missing/);
});
