import test from 'node:test';
import assert from 'node:assert/strict';
import { SoftwareLease, usesSharedSoftware } from './softwareLease.ts';
test('software ownership protects screenshot/action sequences across conversations', async () => {
 const lease = new SoftwareLease();
 const first = await lease.acquire('A'); let bStarted=false;
 const b = lease.acquire('B').then(release=>{bStarted=true;return release;});
 first();
 const action = await lease.acquire('A'); assert.equal(bStarted,false);
 action(); lease.endRun('A'); const releaseB=await b;
 assert.equal(bStarted,true);releaseB();lease.endRun('B');
});
test('queued cancellation never executes and an active abort retains the lease until settlement', async () => {
 const lease = new SoftwareLease(); const releaseA=await lease.acquire('A');
 const controller = new AbortController();
 const waiting=lease.acquire('B',controller.signal); controller.abort(); await assert.rejects(waiting,/中止/);
 let started=false; const c=lease.acquire('C').then(release=>{started=true;return release;});
 lease.endRun('A'); await Promise.resolve(); assert.equal(started,false);
 releaseA(); const releaseC=await c;releaseC();lease.endRun('C');
});
test('software admission leaves independent image/model work concurrent',()=>{
 for(const name of ['browser_control','mcp_blender_execute','mcp_desktop_click','mcp_computer_screenshot']) assert.ok(usesSharedSoftware(name));
 for(const name of ['image_generate','video_generate','read_file']) assert.equal(usesSharedSoftware(name),false);
});

test('ending a run rejects its queued calls even without a cancellation signal',async()=>{
 const lease=new SoftwareLease();const active=await lease.acquire('a');
 const queued=lease.acquire('a');const rejected=assert.rejects(queued,/任务已结束/);
 const other=lease.acquire('b');lease.endRun('a');await rejected;active();
 const release=await other;release();lease.endRun('b');
});
