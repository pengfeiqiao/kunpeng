import test from 'node:test';
import assert from 'node:assert/strict';
import { auditCopywriting } from './qualityAudit.ts';

function reversalIssue(text: string) {
  return auditCopywriting(text).issues.find((i) => i.ruleId === 'syntax.forced-contrast');
}

test('「不是A，是B」（无"而"字直转）命中翻案腔且零容忍', () => {
  const hit = reversalIssue('他毕业后去了成都。那时候没人知道收入稳不稳定。他不是放弃了稳定，是选择了自由。后来他确实跑通了。');
  assert.ok(hit, '不是A，是B 必须被检出');
  assert.ok(hit); assert.equal(hit.severity, 'blocker');
});

test('不是…而是 / 并非…而是 / 看似…实则 / 你以为…其实 全部命中', () => {
  for (const text of [
    '这件事不是能力问题，而是态度问题。大家一起想办法解决了它，后来顺利上线。',
    '这并非偶然，而是长期积累的结果。团队连续三个月每天复盘，指标慢慢起来了。',
    '看似简单的操作，实则暗藏玄机。他反复试了七次才把参数调对，最后片子顺利交付。',
    '你以为他只是运气好，其实背后有方法论。他把每次失败都记了下来，逐条复盘改进。',
  ]) {
    const hit = reversalIssue(text);
    assert.ok(hit, `必须命中: ${text.slice(0, 12)}…`);
    assert.equal(hit.severity, 'blocker');
  }
});

test('「不只…还…」正常递进不误伤', () => {
  const hit = reversalIssue('他不只完成了拍摄，还顺手把灯光调好了。那天收工很早，大家去吃了一顿火锅，聊到半夜才散。');
  assert.equal(hit, undefined, '正常递进不得误伤');
});

test('干净文本零误伤', () => {
  const audit = auditCopywriting('他毕业后离开上海去了成都。那套量化程序跑过一段时间，他觉得可以全职试试。收入稳不稳定，当时没人知道。第一年很难，第三年开始盈利。');
  assert.equal(reversalIssue('他毕业后离开上海去了成都。那套量化程序跑过一段时间，他觉得可以全职试试。收入稳不稳定，当时没人知道。第一年很难，第三年开始盈利。'), undefined);
  assert.ok(audit.score >= 72);
});

test('提示语与洞察路标进入空泛词检测', () => {
  const audit = auditCopywriting('说白了，这件事很简单。先说结论，我们赢了。一句话总结，就是坚持。说穿了也没那么难。');
  assert.ok(audit.issues.some((i) => i.ruleId === 'wording.generic-abstraction'));
});
