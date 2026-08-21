import test from 'node:test';
import assert from 'node:assert/strict';
import { auditUniversalVideoPrompt } from './audit.ts';

const validPrompt = `【素材身份】
@图片一为人物身份参考。
【空间与初始站位】
人物位于桌前，面向右侧。
【一句话概述】
人物走到桌边拿起道具。
【时间戳动作与机位】
0-4s：中景固定，人物走到桌边。
4-8s：近景缓推，人物拿起道具并停稳。
【物理与一致性】
人物身份、左右位置和道具结构保持一致。
【视觉与声音】
黄昏侧光，无对白、无字幕。`;

test('universal prompt audit accepts a complete timed prompt', () => {
  const audit = auditUniversalVideoPrompt(validPrompt, 8);
  assert.deepEqual(audit.errors, []);
  assert.deepEqual(audit.warnings, []);
});

test('universal prompt audit rejects internal asset identifiers', () => {
  const audit = auditUniversalVideoPrompt(`${validPrompt}\n参考 img_v3_02145_deadbeef。`, 8);
  assert.match(audit.errors[0] ?? '', /内部文件名或素材 ID/);
});

test('universal prompt audit flags missing timing and camera conflicts', () => {
  const audit = auditUniversalVideoPrompt(
    `${validPrompt.replace(/0-4s：[\s\S]*?4-8s：近景缓推，人物拿起道具并停稳。/, '固定全景，同时快速切镜并连续环绕。')}`,
    12,
  );
  assert.ok(audit.warnings.some((item) => item.includes('时间段')));
  assert.ok(audit.warnings.some((item) => item.includes('固定镜头')));
});

test('universal prompt audit flags film grain versus no-noise conflicts', () => {
  const audit = auditUniversalVideoPrompt(`${validPrompt}\n稳定胶片颗粒，禁止画面噪点。`, 8);
  assert.ok(audit.warnings.some((item) => item.includes('胶片颗粒')));
});
