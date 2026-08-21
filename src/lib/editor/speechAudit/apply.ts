/**
 * speechAudit/apply — 把 enabled findings 应用为时间轴真实剪辑。
 *
 * 复用 transcriptOps.cutTranscriptTimelineRow 同款管线（clip 拆分 + 绝对轨波纹），
 * 但按 finding 的源区间直接切（不依赖文稿行）。面板「删除」按钮与
 * agent timeline_speech_findings(op:apply) 走同一入口。
 * 调用方负责 captureEditorSnapshot()。
 */
import { nanoid } from 'nanoid';
import { useEditorStore } from '@/stores/editorStore';
import { cutTranscriptTimelineRow } from '../transcriptOps';
import type { SpeechFinding } from './types';

export interface ApplyFindingsResult {
  appliedCount: number;
  removedSec: number;
  clipsBefore: number;
  clipsAfter: number;
  /** 应用的剪切点（时间轴秒，剪后坐标），供剪后验证 */
  cutPoints: { timelineSec: number; findingId: string }[];
}

/** 找到覆盖某源区间的主轨 clip（可能因裁剪多段命中，逐段切） */
function clipsCoveringSourceRange(mediaPath: string, start: number, end: number) {
  const s = useEditorStore.getState();
  return s.clips.filter((c) => c.path === mediaPath && c.outSec > start && c.inSec < end);
}

/**
 * 应用 findings（按源时间倒序切，避免前面的切割改变后面 clip 的映射）。
 * 只处理 enabled 的；pause 类由调用方按最短停顿阈值预过滤。
 */
export function applySpeechFindings(findings: SpeechFinding[]): ApplyFindingsResult {
  const s = useEditorStore.getState();
  const clipsBefore = s.clips.length;
  const targets = findings
    .filter((f) => f.enabled)
    .sort((a, b) => b.sourceStart - a.sourceStart);

  let removedSec = 0;
  let appliedCount = 0;
  const cutPoints: ApplyFindingsResult['cutPoints'] = [];

  for (const f of targets) {
    // 同一 finding 的源区间可能落在多个 clip 实例上（素材被复用/切段）——逐个切
    const covering = clipsCoveringSourceRange(f.mediaPath, f.sourceStart, f.sourceEnd);
    for (const clip of covering) {
      const r = cutTranscriptTimelineRow({
        clipId: clip.id,
        sourceStart: f.sourceStart,
        sourceEnd: f.sourceEnd,
      });
      if (r.success) {
        removedSec += r.removedSec;
        appliedCount += 1;
        // 剪切点 = 切后留下的接缝处；用切后 clip 序列算时间轴位置
        const seam = timelineSeamForSource(f.mediaPath, f.sourceStart);
        if (seam != null) cutPoints.push({ timelineSec: seam, findingId: f.id });
      }
    }
  }

  const after = useEditorStore.getState();
  // 已应用的 findings 从报告中移除（剩余的保持勾选状态）
  const report = after.speechAudit;
  if (report && appliedCount > 0) {
    const appliedIds = new Set(targets.map((f) => f.id));
    after.setSpeechAudit({
      ...report,
      findings: report.findings.filter((f) => !(appliedIds.has(f.id) && f.enabled)),
    });
  }

  return {
    appliedCount,
    removedSec,
    clipsBefore,
    clipsAfter: after.clips.length,
    cutPoints,
  };
}

/** 源时间 → 剪后时间轴接缝位置（最近的 clip 边界） */
function timelineSeamForSource(mediaPath: string, srcSec: number): number | null {
  const s = useEditorStore.getState();
  let acc = 0;
  for (const c of s.clips) {
    const len = s.clipLength(c);
    if (c.path === mediaPath && srcSec >= c.inSec - 0.5 && srcSec <= c.outSec + 0.5) {
      // 接缝在这个 clip 的开头或结尾，取更近的
      const atStart = Math.abs(srcSec - c.inSec) <= Math.abs(srcSec - c.outSec);
      return atStart ? acc : acc + len;
    }
    acc += len;
  }
  return null;
}

/** 给 finding 生成稳定的 UI key（面板增量刷新用） */
export function findingKey(f: SpeechFinding): string {
  return f.id || `${f.mediaPath}:${f.sourceStart.toFixed(2)}-${f.sourceEnd.toFixed(2)}-${nanoid(4)}`;
}

/**
 * 手动字级删除：用户在文稿里圈选任意词区间 → 生成 manual finding（默认勾选）。
 * 没有审片报告时自动建一个空报告。边界留 30ms 呼吸余量。
 */
export function addManualFinding(mediaPath: string, sourceStart: number, sourceEnd: number, text: string): SpeechFinding | null {
  if (sourceEnd - sourceStart < 0.03) return null;
  const s = useEditorStore.getState();
  const finding: SpeechFinding = {
    id: `sm-${nanoid(6)}`,
    category: 'manual',
    mediaPath,
    sourceStart: Math.max(0, sourceStart - 0.03),
    sourceEnd: sourceEnd + 0.03,
    text,
    evidence: [{ kind: 'user_manual', detail: '用户手动圈选' }],
    confidence: 1,
    enabled: true,
  };
  const report = s.speechAudit ?? {
    createdAt: Date.now(),
    findings: [],
    stats: { asrCalls: 0, llmCalls: 0, windows: 0 },
    status: 'done' as const,
  };
  s.setSpeechAudit({
    ...report,
    findings: [...report.findings, finding].sort((a, b) => a.sourceStart - b.sourceStart),
  });
  return finding;
}

/**
 * enabled findings → 时间轴跳过区间（升序合并）。预览「眼睛」开关用：
 * 播放头落入区间即跳到区间尾，不真剪试听成片节奏。
 * minPauseSec 过滤 pause 类（与面板最短停顿阈值一致）。
 */
export function computeSkipRanges(minPauseSec = 0): [number, number][] {
  const s = useEditorStore.getState();
  const report = s.speechAudit;
  if (!report) return [];
  const ranges: [number, number][] = [];
  let acc = 0;
  for (const c of s.clips) {
    const speed = c.speed && c.speed > 0 ? c.speed : 1;
    const len = s.clipLength(c);
    for (const f of report.findings) {
      if (!f.enabled || f.mediaPath !== c.path) continue;
      if (f.category === 'pause' && (f.pauseDur ?? 0) < minPauseSec) continue;
      const a = Math.max(f.sourceStart, c.inSec);
      const b = Math.min(f.sourceEnd, c.outSec);
      if (b - a < 0.03) continue;
      ranges.push([acc + (a - c.inSec) / speed, acc + (b - c.inSec) / speed]);
    }
    acc += len;
  }
  ranges.sort((x, y) => x[0] - y[0]);
  const merged: [number, number][] = [];
  for (const r of ranges) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 0.02) last[1] = Math.max(last[1], r[1]);
    else merged.push([...r] as [number, number]);
  }
  return merged;
}
