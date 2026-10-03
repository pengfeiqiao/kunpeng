import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recoverStoredImages } from './mediaRecovery.ts';
import type { AgentMessage } from './types.ts';
const message = (path: string): AgentMessage => ({ role: 'user', content: [{ type:'image', sourcePath:path, source:{type:'url',url:path} }] });
test('restores actual bytes from saved image paths without mutating saved messages', async () => {
 const original=message('/tmp/a.png');
 const restored=await recoverStoredImages([original],async ()=>'data:image/png;base64,abcd');
 assert.equal((restored[0].content as any)[0].source.data,'abcd');
 assert.equal((original.content as any)[0].source.type,'url');
});
test('bounds image reloads and reports unreadable images honestly', async () => {
 let count=0;
 const restored=await recoverStoredImages(Array.from({length:10},(_,i)=>message(`/tmp/${i}.png`)),async()=>{count++;throw Error('missing');});
 assert.equal(count,8);
 assert.match((restored[0].content as any)[0].text,/尚未重读/);
 assert.match((restored[9].content as any)[0].text,/当前未看到像素/);
});
