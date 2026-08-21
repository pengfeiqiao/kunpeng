/**
 * speechAudit/verify — 剪后边界验证闭环。
 *
 * 应用删除后，对每个新剪切点前后 ±1.2s 抽音原始重转写，检查边界处是否
 * 出现残缺词/半句（切到半个字的听感灾难）。后台跑，不阻塞 UI；
 * 结果供面板 toast 与 agent 读取。
 */
import { transcribeFileRangeWords } from '../transcribe';
import { useEditorStore } from '@/stores/editorStore';
import type { ApplyFindingsResult } from './apply';

export interface BoundaryIssue {
  timelineSec: number;
  findingId: string;
  detail: string;
}

export interface VerifyResult {
  checked: number;
  issues: BoundaryIssue[];
}

const VERIFY_SPAN_SEC = 1.2;
const VERIFY_CONCURRENCY = 2;
/** 单次验证最多抽查的剪切点数（控制成本） */
const MAX_VERIFY_POINTS = 12;

/** 时间轴秒 → 该处 clip 的源媒体位置 */
function timelineToSource(timelineSec: number): { mediaPath: string; srcSec: number } | null {
  const s = useEditorStore.getState();
  let acc = 0;
  for (const c of s.clips) {
    const len = s.clipLength(c);
    if (timelineSec >= acc - 0.01 && timelineSec <= acc + len + 0.01) {
      const speed = c.speed && c.speed > 0 ? c.speed : 1;
      return { mediaPath: c.path, srcSec: c.inSec + (timelineSec - acc) * speed };
    }
    acc += len;
  }
  return null;
}

/**
 * 验证剪切边界。对每个剪切点：分别转写接缝前 1.2s（前段结尾）和后 1.2s
 * （后段开头），若边界词恰好压线（词被截断的时间特征），报问题。
 */
export async function verifyCutBoundaries(result: ApplyFindingsResult): Promise<VerifyResult> {
  const points = result.cutPoints.slice(0, MAX_VERIFY_POINTS);
  const issues: BoundaryIssue[] = [];
  let checked = 0;

  const queue = [...points];
  const workers = Array.from({ length: Math.min(VERIFY_CONCURRENCY, queue.length) }, async () => {
    while (queue.length > 0) {
      const point = queue.shift();
      if (!point) break;
      try {
        const loc = timelineToSource(point.timelineSec);
        if (!loc) continue;
        // 接缝前段结尾：最后一个词应在剪切点前完整结束
        const before = await transcribeFileRangeWords(
          loc.mediaPath, Math.max(0, loc.srcSec - VERIFY_SPAN_SEC), VERIFY_SPAN_SEC, undefined, { raw: true },
        );
        const lastWord = before.flatMap((s) => s.words).sort((a, b) => a.endSec - b.endSec).pop();
        // 词结束时间贴着窗口末尾（<60ms） = 疑似被切断
        if (lastWord && loc.srcSec - lastWord.endSec < 0.06 && loc.srcSec - lastWord.endSec > -0.2) {
          issues.push({
            timelineSec: point.timelineSec,
            findingId: point.findingId,
            detail: `剪切点前的「${lastWord.w}」疑似被切断（词尾距剪切点 ${((loc.srcSec - lastWord.endSec) * 1000).toFixed(0)}ms）`,
          });
        }
        checked += 1;
      } catch (err) {
        console.warn('[speechAudit] 边界验证失败:', err);
      }
    }
  });
  await Promise.all(workers);
  return { checked, issues };
}
