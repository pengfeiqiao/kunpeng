import test from 'node:test';
import assert from 'node:assert/strict';
import { SummaryCircuit } from './summaryCircuit.ts';
import { ContextManager } from './contextManager.ts';
test('summary failures isolate conversations and models and recover after cooldown',async()=>{
 let time=1;const first=new SummaryCircuit(()=>time,100),other=new SummaryCircuit(()=>time,100);
 for(let n=0;n<3;n++)await assert.rejects(first.run('gpt',async()=>{throw Error('offline');}));
 assert.equal(first.available('gpt'),false);assert.equal(first.available('kimi'),true);assert.equal(other.available('gpt'),true);
 time=102;assert.equal(first.available('gpt'),true);await first.run('gpt',async()=> 'ok');assert.equal(first.available('gpt'),true);
});
test('cancelled summaries neither count as provider failure nor return fallback as success',async()=>{
 const circuit=new SummaryCircuit();
 for(let i=0;i<4;i++){const controller=new AbortController();controller.abort();await assert.rejects(circuit.run('gpt',async()=> 'late',controller.signal),{name:'AbortError'});}
 assert.equal(circuit.available('gpt'),true);
 const cm=new ContextManager(8_000);
 const messages=Array.from({length:30},(_,i)=>({role:i%2?'assistant':'user',content:'long conversation '.repeat(600)}));
 await assert.rejects(cm.compact(messages as never,{chat:async()=>{const e=new Error('cancel');e.name='AbortError';throw e;}},true),{name:'AbortError'});
});


test('abort releases a summary wait even if the transport returns late', async () => {
  const circuit = new SummaryCircuit(); const controller = new AbortController();
  let finish!: (value: string) => void;
  const pending = circuit.run('gpt', () => new Promise<string>(resolve => { finish = resolve; }), controller.signal);
  await Promise.resolve(); controller.abort();
  await assert.rejects(pending, { name: 'AbortError' });
  finish('late result'); assert.equal(circuit.available('gpt'), true);
});
