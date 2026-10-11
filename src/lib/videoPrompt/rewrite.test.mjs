import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { PERFORMANCE_GUIDE, AI_DRAMA_BAN, DIALOGUE_DIRECTION_GUIDE } from './performance.ts';
import * as template from './template.ts';

test('both rewrite formats receive shared dialogue direction, original dialogue and unchanged output constraints',async()=>{
  const calls=[]; const exports={};
  const modules={
    '../automotive/craft.ts':{buildAutomotiveContext:()=>''},
    '@/lib/agent/quickChat':{quickChat:async(messages,options)=>{calls.push({messages,options});return 'fixture output';}},
    './audit':{auditUniversalVideoPrompt:()=>({errors:[],warnings:[]})},
    './performance.ts':{PERFORMANCE_GUIDE,AI_DRAMA_BAN},
    '@/lib/workshop/directorReasoning':{HIDDEN_DIRECTOR_REASONING:''},
    './template.ts':template,
  };
  const js=ts.transpileModule(readFileSync(new URL('./prompt.ts',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  runInNewContext(js,{exports,require:id=>{assert.ok(id in modules,id);return modules[id];}});
  const input={prompt:'甲说“你还走吗？”乙说“等你说完。”，保持一镜到底。',references:[],duration:10,ratio:'9:16'};
  for(const format of ['universal','legacy']) {
    assert.equal(await exports.rewriteVideoPrompt(input,format),'fixture output');
    const call=calls.at(-1);assert.ok(call.messages[0].content.includes(DIALOGUE_DIRECTION_GUIDE));
    assert.ok(call.messages[1].content.includes(input.prompt));
    assert.ok(call.messages[1].content.includes('10 秒，9:16'));
  }
  assert.match(calls[0].messages[0].content,/【时间戳动作与机位】/);
  assert.match(calls[1].messages[0].content,/分镜场景设定在/);
});
