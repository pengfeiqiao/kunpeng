import type { WsShot } from './types.ts';

/**
 * Internal-only directing protocol. It gives agents a compact decision order
 * without adding another concept or form to the workshop UI.
 */
export const HIDDEN_DIRECTOR_REASONING = `## 内部导演决策（只在内部完成，不向用户展示分析标签）

写分镜或提示词前，先用剧本原文、storyFacts 和已有分镜完成以下判断：
1. 事实边界：本镜允许出现的人物、关系、对白、事件结果和关键道具。未被原文或既有分镜支持的内容不得补写。
2. 接戏状态：人物进入本镜时的位置、朝向、视线、手中物、情绪和动作进度，必须承接上一关联镜头。
3. 信息推进：本镜只承担一个主要新增信息，例如事件发生、人物察觉、关系变化、关键线索或结果落定。不能重复上一镜已经交代的信息。
4. 观察距离：根据观众此刻必须看清的是空间、人物关系、完整动作、反应还是关键触点，选择景别和机位。不得机械套远中近特写。
5. 切点：明确因动作完成、视线转移、信息揭示、声音触发或情绪变化而切；没有新信息就合并镜头。
6. 出镜状态：记录镜尾人物位置、朝向、视线、道具和动作结果，作为下一镜起点。

内部只选择当前镜头真正需要的方法：空间建立、关系覆盖、动作连续、视线匹配、反应镜头、线索插入、声音先行/延后、遮挡揭示、焦点转移或节奏停顿。不要为了显得专业把所有方法堆进一镜。最终给用户只呈现自然的分镜、提示词或修改建议，不输出本段检查表。`;

export interface DirectorDecisionAuditResult {
  errors: string[];
  warnings: string[];
}

function normalizeDecisionText(value?: string): string {
  return (value ?? '')
    .replace(/[\s，。！？、；：,.!?;:'"“”‘’（）()\[\]【】]/gu, '')
    .trim();
}

function textOverlap(left?: string, right?: string): number {
  const a = normalizeDecisionText(left);
  const b = normalizeDecisionText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return Math.min(a.length, b.length) / Math.max(a.length, b.length);
  const pairs = (text: string) => new Set(Array.from({ length: Math.max(0, text.length - 1) }, (_, i) => text.slice(i, i + 2)));
  const pa = pairs(a);
  const pb = pairs(b);
  if (pa.size === 0 || pb.size === 0) return 0;
  let shared = 0;
  for (const pair of pa) if (pb.has(pair)) shared += 1;
  return (2 * shared) / (pa.size + pb.size);
}

/** Audits only decisions that exist, so old projects remain compatible. */
export function auditDirectorDecisionSequence(shots: Array<Partial<WsShot>>): DirectorDecisionAuditResult {
  const result: DirectorDecisionAuditResult = { errors: [], warnings: [] };

  for (const shot of shots) {
    const decision = shot.directorDecision;
    if (!decision) continue;
    const label = shot.shotNo || '未知镜号';
    const missing = [
      ['entryState', decision.entryState],
      ['newInformation', decision.newInformation],
      ['shotScaleReason', decision.shotScaleReason],
      ['cutTrigger', decision.cutTrigger],
      ['exitState', decision.exitState],
    ].filter(([, value]) => !String(value ?? '').trim()).map(([field]) => field);
    if (missing.length > 0) {
      result.errors.push(`${label}: 内部导演决策缺少 ${missing.join('、')}，无法校验接戏、信息推进和切点。`);
    }
  }

  for (let index = 1; index < shots.length; index += 1) {
    const previous = shots[index - 1];
    const current = shots[index];
    if (!previous.sceneId || previous.sceneId !== current.sceneId) continue;
    const previousDecision = previous.directorDecision;
    const currentDecision = current.directorDecision;
    if (!previousDecision || !currentDecision) continue;

    if (textOverlap(previousDecision.newInformation, currentDecision.newInformation) >= 0.88) {
      result.errors.push(`${previous.shotNo} → ${current.shotNo}: 两镜的主要新增信息高度重复。请合并镜头，或让后一镜承担新的动作、反应、线索或结果。`);
    }

    const continuity = textOverlap(previousDecision.exitState, currentDecision.entryState);
    if (continuity < 0.18) {
      result.warnings.push(`${previous.shotNo} → ${current.shotNo}: 前镜出镜状态与后镜入镜状态缺少明显承接。请核对人物位置、朝向、视线、手中物和动作进度，避免跳轴、换位或动作重置。`);
    }
  }

  return result;
}
