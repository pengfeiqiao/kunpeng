import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAutomotiveContext, AUTOMOTIVE_SHOT_POLICY } from './craft.ts';
import { buildCopywritingTaskHarness } from '../copywriting/antiAiStyle.ts';
import { buildReferenceCraftTurnContext } from '../copywriting/referenceCraft.ts';
import { wrapWorkspaceContext } from '../agent/workspaceMessage.ts';

test('vehicle writing, image prompts and previs receive bounded task guidance', () => {
  for (const q of ['汽车家庭广告剧本','汽车夜景提示词','SUV Blender白模运镜','car commercial','写蔚来品牌片文案']) {
    const ctx=buildAutomotiveContext(q);
    assert.match(ctx,/安全带/);assert.match(ctx,/车辆|车的路径/);
    assert.ok(ctx.length<1800,q);
  }
});
test('unrelated tasks and automotive bugs do not receive creative guidance', () => {
  for(const q of ['今天的天气','汽车保养周期','修复汽车广告编辑器bug','写家庭故事','购物车接口报错']) assert.equal(buildAutomotiveContext(q),'');
});
test('writing and shared harness paths carry the same automotive guidance', () => {
  const q='写汽车家庭广告剧本';const packet=buildAutomotiveContext(q);
  assert.ok(buildCopywritingTaskHarness(q).includes(packet));
  assert.ok(buildReferenceCraftTurnContext(q).includes(packet));
  for(const scope of ['canvas','workshop','editor'] as const) {
    const message=wrapWorkspaceContext(scope, '')+q;
    assert.ok(buildReferenceCraftTurnContext(message).includes(packet));
  }
});
test('workspace metadata alone does not trigger automotive retrieval', () => {
  assert.equal(buildReferenceCraftTurnContext(wrapWorkspaceContext('canvas','汽车广告')+'今天天气如何'), '');
});

test('road-running and storyboard guidance is task-scoped and reaches workspace turns', () => {
  for (const q of ['汽车分镜怎么写', '优化路跑提示词', '侧前领拍运镜', '汽车弯道跟拍', '汽车路跑拉片，分镜剧本广告写得更具体', '汽车镜头怎样写']) {
    const packet = buildAutomotiveContext(q);
    assert.match(packet, /road-running-shots/);
    assert.match(packet, /road-running-case-lessons/);
    assert.match(packet, /road-running-close-reads/);
    assert.match(packet, /固定机位允许车辆进出画/);
    assert.ok(packet.length < 1800, `${q}: ${packet.length}`);
    assert.ok(buildReferenceCraftTurnContext(wrapWorkspaceContext('workshop', '') + q).includes(packet));
  }
  assert.doesNotMatch(buildAutomotiveContext('写汽车家庭故事'), /road-running-shots/);
  assert.equal(buildAutomotiveContext('人物跟拍分镜'), '');
});


test('whole TVC scripts receive sequence decisions across writing and workspace adapters without requiring the word storyboard', () => {
  for (const request of ['写汽车TVC脚本', '汽车广告剧本，太常规，重写', 'car commercial']) {
    const packet = buildAutomotiveContext(request);
    assert.ok(packet.includes(AUTOMOTIVE_SHOT_POLICY));
    assert.ok(packet.length < 1800, `${request}: ${packet.length}`);
    assert.ok(buildCopywritingTaskHarness(request).includes(packet));
    assert.ok(buildReferenceCraftTurnContext(request).includes(packet));
    for (const scope of ['canvas', 'workshop', 'editor'] as const) {
      assert.ok(buildReferenceCraftTurnContext(wrapWorkspaceContext(scope, '') + request).includes(packet));
    }
  }
  for (const request of ['车辆三视图资产', '汽车维修手册', '修改购物车接口', '今天的天气']) {
    assert.ok(!buildAutomotiveContext(request).includes(AUTOMOTIVE_SHOT_POLICY));
  }
});
