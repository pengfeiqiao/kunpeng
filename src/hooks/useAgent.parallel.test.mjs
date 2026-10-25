import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { createRequire } from 'node:module';
import ts from 'typescript';
const require = createRequire(import.meta.url);
const transpile = file => ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return {promise, resolve}; };
async function until(predicate) { for(let i=0;i<50;i++){ if(predicate())return; await new Promise(r=>setTimeout(r,2)); } assert.fail('run did not start'); }
function fixture(provider = 'kimi') {
  const storeModule = {}; runInNewContext(transpile('../stores/chatStore.ts'), {exports:storeModule, require});
  const store = storeModule.useChatStore;
  const hook = state => { const fn = selector => selector(state); fn.getState=()=>state; fn.subscribe=()=>()=>{}; return fn; };
  const chat = selector => selector(store.getState()); Object.assign(chat, {getState:store.getState,setState:store.setState,subscribe:store.subscribe});
  const controls = { disposal: null };
  const refs = {}, runs = [], saved = [], confirms = [], finishes = [], started = []; let serial=0;
  const settings = {providerDefault:provider,agentMetas:{},workspaceAgentModels:{},providerApiKeys:{},glmApiKey:'test',maxTurns:30,deepseekEngine:provider === 'deepseek' ? 'harness' : 'builtin',providerModels:{deepseek:'deepseek-flash'},providerBaseUrls:{},notificationsEnabled:false};
  const noop = ()=>{};
  const steps = new Proxy({startRun: args=>{started.push(args);return `${args.sessionId}:${++serial}`;},finishRun:(status,id)=>finishes.push({status,id})},{get:(o,k)=>o[k]??noop});
  class Queue { schedule(){} async flush(){} }
  class Resume {
    contexts = new Map();
    stage(sid, context){this.contexts.set(sid, context);}
    consume(sid){const context=this.contexts.get(sid)??null;this.contexts.delete(sid);return context;}
    restore(sid, context){if(!this.contexts.has(sid)&&context)this.contexts.set(sid,context);}
  }
  class Bridge {
    running = false;
    closing = false;
    getIsRunning(){return this.running;}
    queueGuidance(){return this.running && !this.closing;}
    async abort(){this.running=false;}
    async run(options){this.running=true;const disposal=controls.disposal;const done=deferred();runs.push({sid:options.runId.split(':')[0],id:options.runId,callbacks:options.callbacks,complete:answer=>{this.running=false;this.closing=true;done.resolve({text:answer,thinking:''});},settle:()=>done.resolve({text:'late',thinking:''})});const result=await done.promise;if(disposal)await disposal.promise;return result;}
  }
  const deps = {
    react:{useCallback:f=>f,useRef:(value,name)=>refs[name]={current:value},useEffect:noop,useState:value=>[value,noop]},
    '@/stores/chatStore':{useChatStore:chat},
    '@/stores/settingsStore':{useSettingsStore:hook(settings)},
    '@/stores/unifiedProjectStore':{useUnifiedProjectStore:hook({activeId:null,projects:[]})},
    '@/stores/workshopStore':{useWorkshopStore:hook({data:null})},
    '@/stores/aigcProjectStore':{useAigcProjectStore:hook({projects:[],activeProjectId:null,getCurrent:()=>null})},
    '@/stores/todoStore':{useTodoStore:hook({todosBySession:{}})},
    '@/stores/runStepStore':{useRunStepStore:hook(steps)},
    '@/stores/toolConfirmStore':{useToolConfirmStore:hook({requestConfirm:(...args)=>{confirms.push(args);return Promise.resolve(true);},cancelScope:noop})},
    '@/lib/agent':{repairToolPairingSnapshot:m=>m},
    '@/lib/agent/interruptedTurn':{
      appendInterruptedTurnCheckpoint:(messages,checkpoint)=>{
        const next=[...messages];
        if(checkpoint.userRequest&&!next.some(message=>message.role==='user'&&message.content===checkpoint.userRequest))next.push({role:'user',content:checkpoint.userRequest});
        next.push({role:'assistant',content:`[中断任务恢复检查点]\n原始任务：${checkpoint.userRequest||'（未记录）'}`});
        return next;
      },
      buildInterruptedResumeContext:checkpoint=>`[中断任务恢复检查点]\n原始任务：${checkpoint.userRequest||'（未记录）'}\n已发起但结果未知的写操作必须先查状态。`,
    },
    '@/lib/agent/dsh':{DshBridge:Bridge,skillCatalogSignature:()=>'',diffSkillCatalog:()=>'',shouldFallbackHarnessToBuiltin:()=>false},
    '@/stores/deepseekHarnessStore':{useDeepseekHarnessStore:hook({startRun:noop,finishRun:noop})},
    '@/lib/credentials':{resolveApiKey:()=> 'test'},
    '@/lib/performance/memoizeLast':{memoizeLast:f=>f},
    '@/lib/performance/coalescedIdleWork':{CoalescedIdleWork:Queue},
    '@/lib/agent/resumeContext':{TaskResumeContextQueue:Resume,buildTaskResumeContext:()=>null},
    '@/lib/agent/logger':{agentLog:{info:noop,warn:noop,error:noop}},
    '@/lib/agent/modelCatalog':{inferAgentWorkspaceScope:()=>null},
    '@/lib/agent/routeStrategy':{buildChatRouteStrategy:settings=>({providerId:settings.providerDefault}),getPrimaryRouteSelection:route=>({providerId:route.providerId,modelId:route.providerId === 'deepseek' ? 'deepseek-flash' : route.providerId})},
    '@/lib/agent/subagentPolicy':{isOrdinarySubagentRun:()=>false},
    '@/lib/agent/projectMessages':{projectUIMessagesToAgentMessages:m=>m,recoverDegradedAgentHistory:m=>m},
    '@/lib/historyPersistence':{readAgentMessagesFromLocalStorage:()=>[],readMessagesFromLocalStorage:()=>[],compactAgentMessagesForStorage:m=>m,writeSessionToFile:async()=>{}},
    '@/lib/agent/workspaceDispatchRuntime':{bindWorkspaceRunDispatch:()=>noop},
    '@/lib/agent/harnessDisplay':{stripHarnessPrefix:s=>s},
    '@/lib/copywriting/learningRuntime':{captureWritingTurn:()=>null,learnWritingTurn:noop},
    '@/lib/agent/evolution':{recordTrajectory:()=>Promise.resolve(),maybeEvolve:async()=>{}},
    '@/lib/agent/evolutionPolicy':{detectNegativeFeedback:()=>false},
    '@/lib/projects/projectIntake':{buildProjectIntakeAgentContext:()=>undefined},
    '@/lib/projectObjects/generationDraft':{isGenerationToolName:()=>false},
    '@/lib/uuid':{randomUUID:()=>`id${++serial}`},
    '@tauri-apps/api/event':{emit:async()=>{}},
    './useSessions':{useSessions:()=>({persistMessages:sid=>saved.push({sid,messages:[...(store.getState().getSessionMessages(sid)??[])]})}),ensureSessionTitleRaw:noop},
  };
  const source=readFileSync(new URL('./useAgent.ts',import.meta.url),'utf8');
  // Name hook refs without depending on hook order; production bodies stay intact.
  const code=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},transformers:{before:[context=>root=>{
    const visit=node=>{
      if(ts.isVariableDeclaration(node)&&ts.isIdentifier(node.name)&&node.initializer&&ts.isCallExpression(node.initializer)&&node.initializer.expression.getText()==='useRef'){
        return context.factory.updateVariableDeclaration(node,node.name,node.exclamationToken,node.type,context.factory.updateCallExpression(node.initializer,node.initializer.expression,node.initializer.typeArguments,[...node.initializer.arguments,context.factory.createStringLiteral(node.name.text)]));
      }
      return ts.visitEachChild(node,visit,context);
    };return ts.visitNode(root,visit);
  }]}}).outputText;
  const exports={};
  runInNewContext(code,{exports,require:id=>deps[id]??{},console,setInterval:(...args)=>{const timer=setInterval(...args);timer.unref();return timer;},clearInterval,setTimeout,clearTimeout,window:{setTimeout,clearTimeout},requestAnimationFrame:fn=>setTimeout(fn,0),localStorage:{removeItem:noop}});
  const agent=exports.useAgent();
  refs.coordinatorFactoryRef.current=(_agent,sid)=>{
    let messages=[],running=false;
    const registry={setOriginView:noop,bindRunContext:noop,clearRunContext:noop,clearRunIdempotency:noop};
    const c={restoreMessages:async m=>{messages=[...m];},getMessages:()=>messages,getContextStats:()=>({estimatedTokens:1,maxTokens:100}),refreshSystemPrompt:noop,getIsRunning:()=>running,setTurnEnvironment:noop,setRouteStrategy:noop,getToolRegistry:()=>registry,queueGuidance:text=>{messages.push({role:'user',content:text});return true;},abort:()=>{running=false;},queueRunNotice:noop,queueTransientNotice:text=>messages.push({role:'system',content:text}),getCwd:()=>'/workspace',buildHarnessTurnContext:async()=>({systemPrompt:'persona',turnContext:''}),recordHarnessTurn:(input,answer)=>{messages.push({role:'user',content:input},{role:'assistant',content:answer});},
      run:async(text,callbacks,_media,id)=>{running=true;messages.push({role:'user',content:text});const done=deferred();runs.push({sid,id,callbacks,complete:answer=>{messages.push({role:'assistant',content:answer});callbacks.onComplete(answer);running=false;done.resolve();},settle:done.resolve});await done.promise;},
    };return c;
  };
  const select=sid=>{if(!store.getState().sessions.some(s=>s.id===sid))store.getState().addSession({id:sid,title:sid,createdAt:1,updatedAt:1});else store.getState().setCurrentSession(sid);};
  return {agent,store,runs,saved,select,confirms,finishes,refs,controls,started,settingsPort:deps['@/stores/settingsStore'].useSettingsStore,sessionPort:deps['./useSessions']};
}
test('actual useAgent runs two same-agent conversations concurrently and persists each reply to its origin',async()=>{
  const f=fixture();f.select('a');const a=f.agent.sendMessage('same request');await until(()=>f.runs.length===1);
  f.select('b');const b=f.agent.sendMessage('same request');await until(()=>f.runs.length===2);
  assert.equal(f.store.getState().streamingSessions.a,true);assert.equal(f.store.getState().streamingSessions.b,true);
  f.runs[0].callbacks.onTextDelta('A draft');f.runs[1].callbacks.onTextDelta('B draft');
  await f.runs[0].callbacks.onToolConfirm('bash',{},'a confirm');assert.equal(f.confirms[0][3].sourceLabel,'a');
  f.runs[0].complete('A answer');await a;
  f.runs[0].callbacks.onComplete('duplicate completion');
  assert.equal(f.store.getState().isStreaming,true);assert.equal(f.store.getState().messages.some(m=>m.content==='A answer'),false);
  f.runs[1].complete('B answer');await b;
  assert.deepEqual(Array.from(f.store.getState().getSessionMessages('a'),m=>m.content),['same request','A answer']);
  assert.deepEqual(Array.from(f.store.getState().getSessionMessages('b'),m=>m.content),['same request','B answer']);
  assert.equal(f.saved.some(s=>s.sid==='a'&&s.messages.at(-1)?.content==='A answer'),true);
});
test('stop, guidance and late callbacks target the selected session only',async()=>{
  const f=fixture();f.select('a');const a=f.agent.sendMessage('A');await until(()=>f.runs.length===1);
  f.select('b');const b=f.agent.sendMessage('B');await until(()=>f.runs.length===2);
  f.select('a');await f.agent.sendMessage('A guidance');assert.equal(f.store.getState().getSessionMessages('b').length,1);
  f.agent.abort();f.runs[0].callbacks.onTextDelta('late');f.runs[0].complete('late answer');await a;
  assert.equal(f.store.getState().getSessionMessages('a').some(m=>m.content==='late answer'),false);
  assert.equal(f.store.getState().streamingSessions.b,true);
  f.runs[1].complete('B survives');await b;
  assert.equal(f.store.getState().getSessionMessages('b').at(-1).content,'B survives');
});

for (const provider of ['deepseek', 'gpt']) test(`${provider}: background completion and selected cancellation stay isolated`, async()=>{
  const f=fixture(provider);f.select('a');const a=f.agent.sendMessage('A');await until(()=>f.runs.length===1);
  f.select('b');const b=f.agent.sendMessage('B');await until(()=>f.runs.length===2);
  f.agent.abort();f.runs[1].complete('cancelled late answer');await b;
  assert.equal(f.store.getState().getSessionMessages('b').some(m=>m.content==='cancelled late answer'),false);
  assert.equal(f.store.getState().streamingSessions.a,true);
  f.runs[0].complete('A remains');await a;
  assert.equal(f.store.getState().getSessionMessages('a').at(-1).content,'A remains');
});
test('old run finally cannot unlock a replacement run after cancellation', async()=>{
  const f=fixture();f.select('a');const old=f.agent.sendMessage('first');await until(()=>f.runs.length===1);
  f.agent.abort();const replacement=f.agent.sendMessage('second');await until(()=>f.runs.length===2);
  f.runs[0].complete('stale');await old;
  assert.equal(f.store.getState().isStreaming,true);
  await f.agent.sendMessage('follow up');assert.equal(f.runs.length,2);
  f.runs[1].complete('new answer');await replacement;
  assert.equal(f.store.getState().messages.at(-1).content,'new answer');
});

test('stop creates a durable checkpoint and stages immediate continue context',async()=>{
  const f=fixture();f.select('a');const stopped=f.agent.sendMessage('inspect the project');await until(()=>f.runs.length===1);
  f.runs[0].callbacks.onTextDelta('I found the first cause');
  f.agent.abort();f.runs[0].settle();await stopped;
  const checkpoint=f.refs.coordinatorsRef.current.get('a').getMessages();
  assert.equal(checkpoint.some(message=>message.role==='user'&&message.content==='inspect the project'),true);
  assert.match(checkpoint.at(-1).content,/中断任务恢复检查点/);
  const resume=f.refs.resumeContextQueueRef.current.consume('a');
  assert.match(resume,/inspect the project/);
  assert.match(resume,/已发起但结果未知/);
});

test('completed coordinator cache is bounded without evicting active conversations',async()=>{
 const f=fixture();f.select('active');const active=f.agent.sendMessage('keep running');await until(()=>f.runs.length===1);
 for(let i=0;i<15;i++){f.select(`idle${i}`);const run=f.agent.sendMessage(`request ${i}`);await until(()=>f.runs.length===i+2);f.runs.at(-1).complete(`answer ${i}`);await run;}
 await until(()=>f.refs.coordinatorsRef.current.size<=12);
 assert.ok(f.refs.coordinatorsRef.current.has('active'));
 assert.equal(f.store.getState().getSessionMessages('idle0').at(-1).content,'answer 0');
 f.runs[0].complete('done');await active;
});

for (const provider of ['kimi','deepseek','gpt']) test(`${provider}: rapid sends during startup become guidance without losing text or attachments`,async()=>{
 const f=fixture(provider);f.select('a');
 const first=f.agent.sendMessage('first');const second=f.agent.sendMessage('second',['/a.png']);
 f.select('b');const other=f.agent.sendMessage('other');
 await until(()=>f.runs.length===2);await second;
 assert.deepEqual(Array.from(f.store.getState().getSessionMessages('a'),m=>m.content),['first','second']);
 assert.deepEqual(Array.from(f.store.getState().getSessionMessages('a')[1].filePaths),['/a.png']);
 for(const run of f.runs)run.complete(`${run.sid} done`);await Promise.all([first,other]);
});
test('stopping during slow restore cannot launch or overwrite the replacement coordinator',async()=>{
 const f=fixture();f.select('a');const gate=deferred();const factory=f.refs.coordinatorFactoryRef.current;let count=0;
 f.refs.coordinatorFactoryRef.current=(...args)=>{const c=factory(...args);if(++count===1){const restore=c.restoreMessages;c.restoreMessages=async m=>{await gate.promise;await restore(m);};}return c;};
 const old=f.agent.sendMessage('same request');await until(()=>count===1);
 assert.equal(f.store.getState().isStreaming,true);f.agent.abort();
 const replacement=f.agent.sendMessage('same request');await until(()=>f.runs.length===1);
 const live=f.refs.coordinatorsRef.current.get('a');gate.resolve();await old;
 assert.equal(f.refs.coordinatorsRef.current.get('a'),live);assert.equal(f.runs.length,1);
 f.runs[0].complete('replacement');await replacement;
 assert.equal(f.store.getState().messages.at(-1).content,'replacement');
});
test('deletion during preparation never recreates a session or orphan stream',async()=>{
 const f=fixture();f.select('a');const gate=deferred();f.refs.skillLoaderRef.current={refreshIfDue:()=>gate.promise};
 const pending=f.agent.sendMessage('deleted');await until(()=>f.store.getState().isStreaming);
 f.store.getState().removeSession('a');gate.resolve();await pending;
 assert.equal(f.runs.length,0);assert.equal(f.store.getState().sessionViews.a,undefined);
});
test('preparation failure clears busy state and permits immediate identical retry',async()=>{
 const f=fixture();f.select('a');f.refs.skillLoaderRef.current={refreshIfDue:async()=>{throw new Error('catalog unavailable');}};
 await f.agent.sendMessage('retry');assert.equal(f.store.getState().isStreaming,false);assert.match(f.store.getState().error,/catalog/);
 f.refs.skillLoaderRef.current=null;const retry=f.agent.sendMessage('retry');await until(()=>f.runs.length===1);f.runs[0].complete('ok');await retry;
});

test('message arriving during DSH disposal waits and starts the next turn',async()=>{
 const f=fixture('deepseek');f.select('a');const disposal=deferred();f.controls.disposal=disposal;
 const first=f.agent.sendMessage('first');await until(()=>f.runs.length===1);f.runs[0].complete('first answer');
 f.controls.disposal=null;const next=f.agent.sendMessage('next request');await new Promise(r=>setTimeout(r,10));
 assert.equal(f.runs.length,1);disposal.resolve();await first;await until(()=>f.runs.length===2);
 f.runs[1].complete('next answer');await next;
 assert.deepEqual(Array.from(f.store.getState().messages,m=>m.content),['first','first answer','next request','next answer']);
 assert.equal(f.store.getState().error,null);
});

test('changing models in another conversation cannot reroute a preparing request',async()=>{
 const f=fixture();f.select('a');const gate=deferred();let waiting=false;
 f.refs.skillLoaderRef.current={refreshIfDue:()=>{waiting=true;return gate.promise;}};
 const a=f.agent.sendMessage('A');await until(()=>waiting);
 const original=f.settingsPort.getState();f.settingsPort.getState=()=>({...original,providerDefault:'gpt'});
 f.refs.skillLoaderRef.current=null;f.select('b');const b=f.agent.sendMessage('B');await until(()=>f.runs.length===1);
 gate.resolve();await until(()=>f.runs.length===2);
 assert.equal(f.started.find(x=>x.sessionId==='a').modelProvider,'kimi');assert.equal(f.started.find(x=>x.sessionId==='b').modelProvider,'gpt');
 f.runs.forEach(r=>r.complete('done'));await Promise.all([a,b]);
});
test('cache trimming never evicts a conversation waiting for preparation',async()=>{
 const f=fixture();f.select('a');const gate=deferred();let waiting=false;
 f.refs.skillLoaderRef.current={refreshIfDue:()=>{waiting=true;return gate.promise;}};
 const a=f.agent.sendMessage('A');await until(()=>waiting);const owner=f.refs.coordinatorsRef.current.get('a');
 for(let i=0;i<13;i++)f.refs.coordinatorsRef.current.set(`cache${i}`,f.refs.coordinatorFactoryRef.current('main',`cache${i}`));
 f.refs.skillLoaderRef.current=null;f.select('b');const b=f.agent.sendMessage('B');await until(()=>f.runs.length===1);f.runs[0].complete('B done');await b;
 assert.equal(f.refs.coordinatorsRef.current.get('a'),owner);gate.resolve();await until(()=>f.runs.length===2);f.runs[1].complete('A done');await a;
});
test('first message keeps its newly reserved session when navigation overtakes initial disk write',async()=>{
 const f=fixture();const gate=deferred();f.sessionPort.ensureActiveConversationSessionRaw=()=>{f.select('a');return gate.promise;};
 const a=f.agent.sendMessage('first');f.select('b');gate.resolve(null);await until(()=>f.runs.length===1);
 assert.equal(f.runs[0].sid,'a');assert.equal(f.store.getState().currentSessionId,'b');
 f.runs[0].complete('A done');await a;assert.equal(f.store.getState().getSessionMessages('a').at(-1).content,'A done');assert.equal(f.store.getState().messages.length,0);
});

test('32 concurrent conversations survive repeated navigation, selective cancellation and reverse completion',async()=>{
 const f=fixture('gpt');const pending=[];
 for(let i=0;i<32;i++){
  const sid=`stress${i}`;f.select(sid);f.store.getState().setDraftFiles(sid,[`/${sid}.png`]);
  pending.push(f.agent.sendMessage(`request ${i}`));
 }
 await until(()=>f.runs.length===32);
 for(let i=0;i<160;i++){f.select(`stress${i%32}`);f.runs[i%32].callbacks.onTextDelta(`delta ${i} `);}
 const stopped=new Set();
 for(let i=0;i<32;i+=4){f.select(`stress${i}`);f.agent.abort();stopped.add(`stress${i}`);}
 for(const run of [...f.runs].reverse())run.complete(`reply ${run.sid}`);
 await Promise.all(pending);
 for(let i=0;i<32;i++){
  const sid=`stress${i}`,messages=f.store.getState().getSessionMessages(sid);
  assert.equal(messages[0].content,`request ${i}`);
  assert.equal(messages.some(m=>m.content===`reply ${sid}`),!stopped.has(sid));
  assert.deepEqual(Array.from(f.store.getState().draftFiles[sid]),[`/${sid}.png`]);
 }
 assert.equal(Object.keys(f.store.getState().streamingSessions).length,0);
});
