import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import ts from 'typescript';
import { withCancellation } from './cancellation.ts';
function load(file, dependencies) {
  const exports = {};
  const code = ts.transpileModule(readFileSync(new URL(file, import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  runInNewContext(code, { exports, crypto: { randomUUID: () => Math.random().toString() }, require: name => {
    if (name === '../logger') return { agentLog: { info(){}, debug(){}, warn(){}, error(){} } };
    if (name === './cancellation') return { withCancellation };
    if (name === './constants') return { MCP_PROTOCOL_VERSION: '2024-11-05' };
    if (name in dependencies) return dependencies[name];
    throw new Error(name);
  } });
  return exports;
}
function http(fetch) {
  return load('./httpTransport.ts', {'@tauri-apps/api/http': { fetch, Body: { json: x => x }, ResponseType: { Text: 2 } }}).HttpTransport;
}
const response = data => ({ok:true, status:200, headers:{}, data});
test('HTTP does not replay a tool call on Invalid Request', async () => {
  const requests=[];
  const H=http(async (_url, options) => {
    requests.push(options.body);
    return response({ jsonrpc:'2.0',id:options.body.id,...(options.body.method === 'tools/call' ? {error:{code:-32600,message:'invalid'}} : {result:{}}) });
  });
  const h=new H('http://localhost/mcp','');
  const result=await h.request('tools/call',{name:'render'});
  assert.equal(result.error.code,-32600);
  assert.equal(requests.filter(r=>r.method==='tools/call').length,1);
});
test('HTTP SSE ignores progress and unrelated response IDs', async () => {
  let auth;
  const H=http(async (_url, options) => {
    auth=options.headers.Authorization;
    if(options.body.method !== 'tools/call') return response({jsonrpc:'2.0',id:options.body.id,result:{}});
    return {...response(`data: {"jsonrpc":"2.0","method":"notifications/progress"}\n\ndata: {"jsonrpc":"2.0","id":900,"result":"wrong"}\n\ndata: {"jsonrpc":"2.0","id":${options.body.id},"result":"correct"}\n\n`),headers:{'content-type':'text/event-stream'}};
  });
  const result=await new H('http://localhost/mcp','').request('tools/call',{});
  assert.equal(result.result,'correct'); assert.equal(auth,undefined);
});
test('HTTP mismatched JSON response is an error, not another request result', async () => {
  const H=http(async()=>response({jsonrpc:'2.0',id:999,result:'wrong'}));
  await assert.rejects(new H('http://localhost/mcp','').request('tools/call'), /ID mismatch/);
});
test('stdio transports isolate spawn, request and close sessions', async () => {
  const calls=[];
  const S=load('./stdioTransport.ts', {'@tauri-apps/api/tauri':{invoke:async(command,args)=>{
    calls.push({command,args});
    if(command==='mcp_stdio_send') { const body=JSON.parse(args.message); return body.id ? JSON.stringify({jsonrpc:'2.0',id:body.id,result:{}}):''; }
  }}}).StdioTransport;
  const a=new S('desktop',[],{}),b=new S('blender',[],{});
  await Promise.all([a.connect(),b.connect()]);
  await a.close(); await b.request('tools/call',{name:'render'});
  const spawns=calls.filter(c=>c.command==='mcp_stdio_spawn');
  assert.notEqual(spawns[0].args.serverId,spawns[1].args.serverId);
  assert.equal(calls.find(c=>c.command==='mcp_stdio_kill').args.serverId,spawns[0].args.serverId);
  assert.equal(calls.at(-1).args.serverId,spawns[1].args.serverId);
});
test('pre-cancelled MCP call never dispatches, running call stops waiting and sends cancellation once', async()=>{
  let runs=0,cancels=0; const pre=new AbortController(); pre.abort();
  await assert.rejects(withCancellation(pre.signal,async()=>{runs++;},async()=>{cancels++;}),/before dispatch/);
  const active=new AbortController(); let finish;
  const pending=withCancellation(active.signal,()=>{runs++; return new Promise(r=>{finish=r;});},async()=>{cancels++;});
  await Promise.resolve(); active.abort();
  await assert.rejects(pending,/execution status unknown/); finish('late');
  assert.equal(runs,1); assert.equal(cancels,1);
});
test('manager handles pagination and closes failures without passing one provider key to every service', async()=>{
  const received=[];let closed=0;
  class Transport {
    constructor(url,key){this.url=url; received.push([url,key]);}
    async connect(){}
    async close(){closed++;}
    async request(_method,params){
      if(this.url==='fail') return {error:{message:'failure'}};
      return {result:{tools:[{name:params?'second':'first'}],...(params?{}:{nextCursor:'next'})}};
    }
  }
  const Manager=load('./index.ts',{'./httpTransport':{HttpTransport:Transport},'./stdioTransport':{},'./servers':{},'./mcpToolAdapter':{createMcpTool:s=>s}}).McpManager;
  const manager=new Manager([{id:'a',name:'a',prefix:'a',transport:'http',url:'ok',credentialId:'private-a'}, {id:'b',name:'b',prefix:'b',transport:'http',url:'fail'}]);
  const result=await manager.initialize({'private-a':'only-a','unrelated':'never-use'});
  assert.equal(result.tools.length,2);assert.equal(result.errors.length,1);assert.equal(closed,1);
  assert.deepEqual(received,[['ok','only-a'],['fail','']]);
  await manager.shutdown(); assert.equal(closed,2);
});
