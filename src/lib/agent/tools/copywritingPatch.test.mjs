import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function fixture() {
  const source = await readFile(new URL('./copywritingTools.ts', import.meta.url), 'utf8');
  const js = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText.replace(/^import[\s\S]*?;\n/gm, '');
  const url = name => JSON.stringify(new URL(`../../copywriting/${name}.ts`, import.meta.url).href);
  const setup = `import {applyCopyPatchesDetailed, buildCopyDocMap, formatCopyDocHtml, formatCopyDocMap} from ${url('documentMap')};
    import {auditCopywriting,formatWritingAuditForAgent} from ${url('qualityAudit')};
    export let doc={id:'d1',title:'表格',content:'第一段\\n\\n第二段',contentRevision:7};
    export let writes=0;
    export let duringBackup=()=>{};
    export const setBackupHook=fn=>{duringBackup=fn};
    export const changeContent=content=>{doc={...doc,content,contentRevision:doc.contentRevision+1}};
    const backupDoc=async()=>{duringBackup()};
    const writeDoc=async()=>{writes++}; const writeDocsIndex=async()=>{};
    const useCopywritingStore={getState:()=>({activeDocId:'d1',docs:[doc],updateDoc:(_,patch)=>{doc={...doc,...patch,contentRevision:doc.contentRevision+1}}})};`;
  return import(`data:text/javascript;base64,${Buffer.from(setup + js).toString('base64')}#${Math.random()}`);
}

test('连续 patch 用上次返回的 docMap，无需读取全文；冲突返回最新定位且不写盘', async () => {
  const f = await fixture();
  const first = await f.copywritingPatchDocTool.execute({ patches: [{ blockId: 'B0002', text: '备注内容' }] });
  assert.equal(first.success, true);
  const map = JSON.parse(first.output).docMap;
  const hash = map.match(/B0002[^\n]*h=(\w+)/)[1];
  assert.equal((await f.copywritingPatchDocTool.execute({ patches: [{ blockId: 'B0002', hash, text: '' }] })).success, true);
  assert.equal(f.doc.content, '第一段\n\n');
  const failed = await f.copywritingPatchDocTool.execute({ patches: [{ blockId: 'B0001', hash, text: '不该写入' }] });
  assert.equal(failed.success, false);
  assert.equal(JSON.parse(failed.output).conflicts.length, 1);
  assert.ok(JSON.parse(failed.output).docMap.includes('第一段'));
  assert.equal(f.writes, 2);
});
test('备份期间用户编辑，patch 不覆盖用户内容', async () => {
  const f = await fixture();
  f.setBackupHook(() => f.changeContent('用户正在修改的版本'));
  const result = await f.copywritingPatchDocTool.execute({ patches: [{ blockId: 'B0001', text: 'Agent 的修改' }] });
  assert.equal(result.success, false);
  assert.equal(f.doc.content, '用户正在修改的版本');
  assert.equal(f.writes, 0);
});
