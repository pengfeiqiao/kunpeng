/**
 * SpeechCutPanel — 剪口播（对标剪映同名面板，左侧抽屉弹出）。
 *
 * 智能去水词 = speechAudit 引擎：语气词/停顿本地秒出，重复/口误/废话经
 * 原始重转写 + 能量证据 + LLM 信息增量判定渐进补充。打开面板自动跑一次。
 * 字级编辑：在文稿里按住拖选任意字区间 → 标记为手动删除（词级时间戳精确到字）。
 * 全部只标记，用户复核后点「删除」一键应用；剪后自动验证边界。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff, Loader2, Search, Sparkles, Subtitles, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useEditorStore, type SubtitleCue } from '@/stores/editorStore';
import { captureEditorSnapshot } from '@/lib/editor/editorHistory';
import { buildTranscriptTimelineRows, ensureTranscript, punctuateChineseTranscriptText, type TranscriptTimelineRow } from '@/lib/editor/transcriptOps';
import { runSpeechAudit, isAuditRunning } from '@/lib/editor/speechAudit/engine';
import { applySpeechFindings, addManualFinding } from '@/lib/editor/speechAudit/apply';
import { verifyCutBoundaries } from '@/lib/editor/speechAudit/verify';
import { CATEGORY_LABELS, type FindingCategory, type SpeechFinding } from '@/lib/editor/speechAudit/types';

const CATEGORY_ORDER: FindingCategory[] = ['filler', 'repeat', 'pause', 'stutter', 'rambling', 'manual'];
const TOKEN_END_PUNCT_RE = /[。！？!?…]$/;
const TOKEN_PUNCT_RE = /[，。、！？!?,.：:;；、…]/;

function fmtPause(sec: number): string {
  return `${sec.toFixed(1)}s`;
}

/** finding 是否按当前停顿阈值生效 */
function findingActive(f: SpeechFinding, minPauseSec: number): boolean {
  return f.category !== 'pause' || (f.pauseDur ?? 0) >= minPauseSec;
}

interface WordToken {
  key: string;
  /** 全局顺序索引（拖选范围计算用） */
  idx: number;
  text: string;
  timelineSec: number;
  mediaPath: string;
  srcStart: number;
  srcEnd: number;
  /** 停顿徽标 token（不参与拖选） */
  isPause?: boolean;
  finding?: SpeechFinding;
  /** repeat 保留遍的下划线提示 */
  kept?: boolean;
}

interface Paragraph {
  key: string;
  tokens: WordToken[];
}

interface ManualSelection {
  tokens: WordToken[];
  x: number;
  y: number;
}

function tokenSpeechLength(text: string): number {
  return Array.from(text).reduce((n, ch) => n + (/[\u4e00-\u9fff]/.test(ch) ? 1 : /^[a-z0-9]$/i.test(ch) ? 0.5 : 0), 0);
}

/** 文稿行 + findings → 段落流 token（停顿 ≥2s 分段；停顿 finding 内联为徽标） */
function buildParagraphs(
  rows: TranscriptTimelineRow[],
  findings: SpeechFinding[],
  minPauseSec: number,
): { paragraphs: Paragraph[]; flat: WordToken[] } {
  const paragraphs: Paragraph[] = [];
  const flat: WordToken[] = [];
  let tokens: WordToken[] = [];
  let paraIdx = 0;
  let globalIdx = 0;
  const flush = () => {
    if (tokens.length > 0) paragraphs.push({ key: `p-${paraIdx++}`, tokens });
    tokens = [];
  };
  const push = (t: Omit<WordToken, 'idx'>) => {
    const token = { ...t, idx: globalIdx++ };
    tokens.push(token);
    flat.push(token);
  };
  const findingAt = (mediaPath: string, srcSec: number): SpeechFinding | undefined =>
    findings.find((f) =>
      f.mediaPath === mediaPath && f.category !== 'pause'
      && srcSec >= f.sourceStart - 0.02 && srcSec < f.sourceEnd + 0.02);
  const keptAt = (mediaPath: string, srcSec: number): boolean =>
    findings.some((f) =>
      f.mediaPath === mediaPath && f.category === 'repeat' && f.keptRange
      && srcSec >= f.keptRange[0] - 0.02 && srcSec < f.keptRange[1] + 0.02);
  const pauseFindings = findings
    .filter((f) => f.category === 'pause' && findingActive(f, minPauseSec))
    .sort((a, b) => a.sourceStart - b.sourceStart);
  const emittedPauses = new Set<string>();

  let prevRow: TranscriptTimelineRow | null = null;
  let paragraphChars = 0;
  for (const row of rows) {
    if (row.silence) continue;
    if (prevRow && row.timelineStart - prevRow.timelineEnd >= 2) {
      flush();
      paragraphChars = 0;
    }
    for (const pf of pauseFindings) {
      if (emittedPauses.has(pf.id)) continue;
      if (pf.mediaPath !== row.mediaPath) continue;
      if (pf.sourceEnd <= row.sourceStart && (!prevRow || pf.sourceStart >= prevRow.sourceEnd - 0.1)) {
        emittedPauses.add(pf.id);
        push({
          key: pf.id,
          text: `[…${fmtPause(pf.pauseDur ?? pf.sourceEnd - pf.sourceStart)}]`,
          timelineSec: row.timelineStart,
          mediaPath: pf.mediaPath,
          srcStart: pf.sourceStart,
          srcEnd: pf.sourceEnd,
          isPause: true,
          finding: pf,
        });
      }
    }
    const span = Math.max(0.01, row.sourceEnd - row.sourceStart);
    const scale = (row.timelineEnd - row.timelineStart) / span;
    let rowCharsSincePunct = 0;
    for (let i = 0; i < row.words.length; i++) {
      const w = row.words[i];
      const nextWord = row.words[i + 1]?.w ?? '';
      let displayText = w.w;
      if (TOKEN_PUNCT_RE.test(displayText)) {
        rowCharsSincePunct = 0;
      } else {
        rowCharsSincePunct += tokenSpeechLength(displayText);
        const nextIsPunct = !nextWord || TOKEN_PUNCT_RE.test(nextWord);
        const naturalPause = /[的了嘛吗呢吧呀啊噢哦喔]$/.test(displayText);
        if (i < row.words.length - 1 && !nextIsPunct && ((rowCharsSincePunct >= 16 && naturalPause) || rowCharsSincePunct >= 24)) {
          displayText += '，';
          rowCharsSincePunct = 0;
        }
      }
      if (i === row.words.length - 1 && !TOKEN_END_PUNCT_RE.test(displayText) && !TOKEN_END_PUNCT_RE.test(row.text.trim())) {
        displayText = displayText.replace(/，$/, '') + '。';
      }
      const timelineSec = row.timelineStart + Math.max(0, w.start - row.sourceStart) * scale;
      const mid = (w.start + w.end) / 2;
      for (const pf of pauseFindings) {
        if (emittedPauses.has(pf.id)) continue;
        if (pf.mediaPath === row.mediaPath && pf.sourceEnd <= mid && pf.sourceStart >= row.sourceStart - 0.1) {
          emittedPauses.add(pf.id);
          push({
            key: pf.id,
            text: `[…${fmtPause(pf.pauseDur ?? pf.sourceEnd - pf.sourceStart)}]`,
            timelineSec,
            mediaPath: pf.mediaPath,
            srcStart: pf.sourceStart,
            srcEnd: pf.sourceEnd,
            isPause: true,
            finding: pf,
          });
        }
      }
      push({
        key: `${row.id}-${i}`,
        text: displayText,
        timelineSec,
        mediaPath: row.mediaPath,
        srcStart: w.start,
        srcEnd: w.end,
        finding: findingAt(row.mediaPath, mid),
        kept: keptAt(row.mediaPath, mid),
      });
      paragraphChars += tokenSpeechLength(displayText);
    }
    if (TOKEN_END_PUNCT_RE.test(row.text.trim()) || paragraphChars >= 54) {
      flush();
      paragraphChars = 0;
    }
    prevRow = row;
  }
  flush();
  return { paragraphs, flat };
}

export default function SpeechCutPanel({ onClose }: { onClose?: () => void }) {
  const clips = useEditorStore((s) => s.clips);
  const transcripts = useEditorStore((s) => s.transcripts);
  const report = useEditorStore((s) => s.speechAudit);
  const previewSkip = useEditorStore((s) => s.previewSkipFindings);
  const minPauseSec = useEditorStore((s) => s.speechMinPauseSec);
  const setPreviewSkip = useEditorStore((s) => s.setPreviewSkipFindings);
  const setMinPauseSec = useEditorStore((s) => s.setSpeechMinPauseSec);
  const updateFinding = useEditorStore((s) => s.updateSpeechFinding);
  const setFindingsEnabled = useEditorStore((s) => s.setSpeechFindingsEnabled);
  const setPlayhead = useEditorStore((s) => s.setPlayhead);
  const setSubtitles = useEditorStore((s) => s.setSubtitles);

  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState('');
  const [query, setQuery] = useState('');
  const [summaryOpen, setSummaryOpen] = useState(true);
  // 拖选状态：anchor/hover 为全局 token 索引
  const [dragAnchor, setDragAnchor] = useState<number | null>(null);
  const [dragHover, setDragHover] = useState<number | null>(null);
  const [manualSelection, setManualSelection] = useState<ManualSelection | null>(null);
  const [activeFindingId, setActiveFindingId] = useState<string | null>(null);
  const draggingRef = useRef(false);
  const panelRef = useRef<HTMLDivElement>(null);

  const flash = (msg: string) => { setToast(msg); setTimeout(() => setToast(''), 3200); };

  const findings = report?.findings ?? [];
  const activeFindings = useMemo(
    () => findings.filter((f) => findingActive(f, minPauseSec)),
    [findings, minPauseSec],
  );
  const enabledCount = activeFindings.filter((f) => f.enabled).length;

  const categoryCounts = useMemo(() => {
    const counts = new Map<FindingCategory, { total: number; enabled: number }>();
    for (const c of CATEGORY_ORDER) counts.set(c, { total: 0, enabled: 0 });
    for (const f of activeFindings) {
      const c = counts.get(f.category)!;
      c.total += 1;
      if (f.enabled) c.enabled += 1;
    }
    return counts;
  }, [activeFindings]);

  const rows = useMemo(() => buildTranscriptTimelineRows(), [clips, transcripts]);
  const { paragraphs } = useMemo(
    () => buildParagraphs(rows, activeFindings, minPauseSec),
    [rows, activeFindings, minPauseSec],
  );

  const running = report?.status === 'running' || isAuditRunning();
  const hasTranscript = Object.keys(transcripts).length > 0;

  const handleAudit = async () => {
    if (busy || running) return;
    setBusy(true);
    try {
      const r = await runSpeechAudit();
      flash(`识别完成：${r.findings.length} 个候选（ASR ${r.stats.asrCalls} 次 / AI ${r.stats.llmCalls} 次）`);
    } catch (err) {
      flash(`识别失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // 默认开启去重复和水词：打开面板且还没有审片报告时自动跑一次
  useEffect(() => {
    if (clips.length === 0 || running || busy) return;
    if (report && report.findings.length > 0) return;
    if (report?.status === 'done' || report?.status === 'error') return;
    void handleAudit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const applyFindingsNow = (targets: SpeechFinding[], source = '候选') => {
    if (targets.length === 0) { flash('没有勾选的候选'); return; }
    captureEditorSnapshot();
    const r = applySpeechFindings(targets);
    flash(`已删除 ${source} ${r.appliedCount} 处 / ${r.removedSec.toFixed(1)}s，⌘Z 可撤销`);
    setManualSelection(null);
    setActiveFindingId(null);
    void verifyCutBoundaries(r).then((v) => {
      if (v.issues.length > 0) {
        flash(`⚠ ${v.issues.length} 处剪点疑似切字：${v.issues[0].detail}（点时间码复核）`);
      }
    }).catch(() => {});
  };

  const handleDelete = async () => {
    applyFindingsNow(activeFindings.filter((f) => f.enabled), '候选');
  };

  const deleteManualSelection = () => {
    const selected = manualSelection?.tokens.filter((t) => !t.isPause) ?? [];
    if (selected.length === 0) return;
    captureEditorSnapshot();
    const groups = new Map<string, WordToken[]>();
    for (const t of selected) {
      const g = groups.get(t.mediaPath) ?? [];
      g.push(t);
      groups.set(t.mediaPath, g);
    }
    const findings: SpeechFinding[] = [];
    for (const [mediaPath, g] of groups) {
      const start = Math.min(...g.map((t) => t.srcStart));
      const end = Math.max(...g.map((t) => t.srcEnd));
      const text = g.map((t) => t.text).join('');
      const finding = addManualFinding(mediaPath, start, end, text);
      if (finding) findings.push(finding);
    }
    if (findings.length === 0) { setManualSelection(null); return; }
    const r = applySpeechFindings(findings);
    flash(`已删除选中内容 ${r.appliedCount} 处 / ${r.removedSec.toFixed(1)}s，⌘Z 可撤销`);
    setManualSelection(null);
    setActiveFindingId(null);
    void verifyCutBoundaries(r).catch(() => {});
  };

  const deleteActiveFinding = () => {
    const finding = findings.find((f) => f.id === activeFindingId);
    if (!finding) return;
    if (!finding.enabled) useEditorStore.getState().updateSpeechFinding(finding.id, { enabled: true });
    applyFindingsNow([{ ...finding, enabled: true }], CATEGORY_LABELS[finding.category]);
  };

  /** CC：文稿 → 字幕轨（时间轴坐标） */
  const handleSubtitles = () => {
    const cues: SubtitleCue[] = rows
      .filter((row) => !row.silence && row.text.trim())
      .map((row) => ({
        id: `sub-${nanoid(6)}`,
        startSec: row.timelineStart,
        endSec: row.timelineEnd,
        text: punctuateChineseTranscriptText(row.text),
      }));
    if (cues.length === 0) { flash('先转写文稿'); return; }
    setSubtitles(cues);
    flash(`已生成 ${cues.length} 条字幕`);
  };

  const handleTranscribeAll = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const paths = [...new Set(clips.map((c) => c.path))];
      for (const p of paths) if (!transcripts[p]) await ensureTranscript(p);
    } catch (err) {
      flash(`转写失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  // ── 字级拖选 ────────────────────────────────────────────────────────────

  const selRange: [number, number] | null =
    dragAnchor != null && dragHover != null && dragHover !== dragAnchor
      ? [Math.min(dragAnchor, dragHover), Math.max(dragAnchor, dragHover)]
      : null;

  const handleTokenMouseDown = (t: WordToken, e: React.MouseEvent) => {
    if (t.isPause) return;
    e.preventDefault();
    setManualSelection(null);
    setActiveFindingId(null);
    setDragAnchor(t.idx);
    setDragHover(t.idx);
    draggingRef.current = false;
  };

  const handleTokenMouseEnter = (t: WordToken) => {
    if (dragAnchor == null || t.isPause) return;
    if (t.idx !== dragAnchor) draggingRef.current = true;
    setDragHover(t.idx);
  };

  const finishDrag = (allTokens: WordToken[], e: React.MouseEvent<HTMLDivElement>) => {
    const anchor = dragAnchor;
    const hover = dragHover;
    setDragAnchor(null);
    setDragHover(null);
    if (anchor == null || hover == null) return;
    if (!draggingRef.current || anchor === hover) return; // 单击走 click 逻辑
    const [a, b] = [Math.min(anchor, hover), Math.max(anchor, hover)];
    const selected = allTokens.filter((t) => t.idx >= a && t.idx <= b && !t.isPause && !t.finding);
    if (selected.length === 0) { flash('选中的内容已在标记里'); return; }
    const rect = panelRef.current?.getBoundingClientRect();
    setManualSelection({
      tokens: selected,
      x: rect ? Math.min(e.clientX - rect.left + 8, rect.width - 82) : 180,
      y: rect ? Math.max(58, e.clientY - rect.top - 38) : 160,
    });
  };

  const handleTokenClick = (t: WordToken) => {
    if (draggingRef.current) return; // 拖选结束的 click 不处理
    if (t.finding) {
      setManualSelection(null);
      setActiveFindingId(t.finding.id);
      updateFinding(t.finding.id, { enabled: !t.finding.enabled });
    } else {
      setActiveFindingId(null);
      setPlayhead(t.timelineSec);
    }
  };

  const queryLower = query.trim().toLowerCase();
  const allTokens = useMemo(() => paragraphs.flatMap((p) => p.tokens), [paragraphs]);
  const selectedTokenIndexes = useMemo(
    () => new Set(manualSelection?.tokens.map((t) => t.idx) ?? []),
    [manualSelection],
  );

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key !== 'Delete' && e.key !== 'Backspace') return;
      if (manualSelection && manualSelection.tokens.length > 0) {
        e.preventDefault();
        deleteManualSelection();
        return;
      }
      if (activeFindingId) {
        e.preventDefault();
        deleteActiveFinding();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [manualSelection, activeFindingId, findings]);

  return (
    <div
      ref={panelRef}
      className="h-full flex flex-col select-none relative"
      style={{ background: '#242424' }}
      onMouseUp={(e) => finishDrag(allTokens, e)}
      onMouseLeave={() => { setDragAnchor(null); setDragHover(null); }}
    >
      {/* 标题栏 */}
      <div className="h-[48px] flex items-center px-3 shrink-0 border-b border-white/[0.06]">
        <span className="text-[14px] font-semibold text-[#f1f1f1] tracking-0">剪口播</span>
        <div className="flex-1" />
        {onClose && (
          <button
            onClick={onClose}
            aria-label="关闭剪口播"
            className="w-7 h-7 grid place-items-center rounded-md text-[#9c9c9c] hover:text-[#f5f5f5] hover:bg-white/[0.06] transition-colors"
          >
            <X size={17} strokeWidth={2.2} />
          </button>
        )}
      </div>

      {/* 工具行：搜索 + 智能去水词 + 预览跳过 + CC */}
      <div className="flex items-center gap-1.5 px-3 py-2.5 shrink-0">
        <div className="h-8 flex items-center gap-1.5 flex-1 min-w-0 px-2.5 rounded-md bg-[#1b1b1b] border border-white/[0.05]">
          <Search size={14} className="text-[#7f7f7f] shrink-0" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="输入关键词快速定位"
            className="flex-1 min-w-0 bg-transparent text-[12px] text-[#e8e8e8] placeholder-[#747474] outline-none"
          />
        </div>
        <button
          onClick={() => void handleAudit()}
          disabled={busy || running || clips.length === 0}
          className="h-8 flex items-center gap-1 px-2.5 rounded-md text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40 shrink-0 shadow-[0_0_0_1px_rgba(255,255,255,0.08)_inset]"
          style={{ background: '#00c8d7' }}
          aria-label="智能去水词"
        >
          {running || busy ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
          智能去水词
        </button>
        <button
          onClick={() => setPreviewSkip(!previewSkip)}
          className={`w-8 h-8 grid place-items-center rounded-md transition-colors shrink-0 ${previewSkip ? 'text-[#00c8d7] bg-white/[0.08]' : 'text-[#a2a2a2] bg-white/[0.05] hover:text-[#f1f1f1]'}`}
          aria-label={previewSkip ? '预览跳过已标记段：开' : '预览跳过已标记段：关'}
        >
          {previewSkip ? <Eye size={15} /> : <EyeOff size={15} />}
        </button>
        <button
          onClick={handleSubtitles}
          disabled={!hasTranscript}
          className="w-8 h-8 grid place-items-center rounded-md text-[#a2a2a2] bg-white/[0.05] hover:text-[#f1f1f1] transition-colors disabled:opacity-40 shrink-0"
          aria-label="从文稿生成字幕轨"
        >
          <Subtitles size={15} />
        </button>
      </div>

      {/* 识别摘要卡 */}
      {findings.length > 0 && (
        <div className="mx-3 mb-2.5 rounded-lg bg-[#303030] px-3 py-3 shrink-0 border border-white/[0.03]">
          <button
            onClick={() => setSummaryOpen(!summaryOpen)}
            className="flex items-center gap-1 w-full text-left"
          >
            <span className="text-[13px] font-semibold text-[#f1f1f1]">
              识别到 <span className="text-[#00c8d7]">{enabledCount}</span> 个无效词
            </span>
            {report?.status === 'running' && (
              <span className="text-[11px] text-[#a5a5a5]">（{report.progress ?? '分析中…'}）</span>
            )}
            <span className="ml-auto text-[11px] text-[#9d9d9d]">{summaryOpen ? '▲' : '▼'}</span>
          </button>
          {summaryOpen && (
            <div className="mt-2.5 space-y-2">
              {CATEGORY_ORDER.map((cat) => {
                const c = categoryCounts.get(cat)!;
                if (c.total === 0) return null;
                const allOn = c.enabled === c.total;
                return (
                  <label key={cat} className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={allOn}
                      onChange={() => setFindingsEnabled(cat, !allOn)}
                      className="w-4 h-4 rounded accent-[#00c8d7]"
                    />
                    <span className="text-[12px] font-medium text-[#ededed]">
                      <span className="text-[#00c8d7] font-semibold mr-1">{c.enabled}</span>
                      {CATEGORY_LABELS[cat]}
                    </span>
                  </label>
                );
              })}
              {/* 最短停顿时长 */}
              {findings.some((f) => f.category === 'pause') ? (
                <div className="flex items-center gap-2 pt-1.5">
                  <span className="text-[12px] text-[#a9a9a9]">最短停顿时长</span>
                  <div className="h-8 flex items-center rounded-md bg-[#262626] overflow-hidden border border-white/[0.04]">
                    <input
                      type="number"
                      min={0.3}
                      max={5}
                      step={0.1}
                      value={minPauseSec}
                      onChange={(e) => setMinPauseSec(Number(e.target.value) || 0.8)}
                      className="w-12 px-1.5 bg-transparent text-[12px] text-center text-[#f2f2f2] outline-none"
                    />
                    <span className="pr-1.5 text-[11px] text-[#969696]">s</span>
                  </div>
                  <button
                    onClick={() => void handleDelete()}
                    disabled={enabledCount === 0}
                    className="ml-auto h-8 px-7 rounded-md text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    style={{ background: '#00c8d7' }}
                  >
                    删除
                  </button>
                </div>
              ) : (
                <div className="flex justify-end pt-1">
                  <button
                    onClick={() => void handleDelete()}
                    disabled={enabledCount === 0}
                    className="h-8 px-7 rounded-md text-[12px] font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-40"
                    style={{ background: '#00c8d7' }}
                  >
                    删除
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="mx-3 mb-2 px-3 py-2 rounded-lg text-[12px] text-[#ededed] bg-white/[0.06] shrink-0">
          {toast}
        </div>
      )}

      {/* 正文：段落流（按住拖选任意字区间 → 手动标记删除） */}
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-3 space-y-5 [scrollbar-width:thin]">
        {clips.length === 0 ? (
          <p className="text-center py-10 text-[13px] text-[#888]">时间轴还没有视频片段</p>
        ) : !hasTranscript && !running && !busy ? (
          <div className="text-center py-10">
            <p className="text-[13px] text-[#888] mb-3">还没有文稿</p>
            <button
              onClick={() => void handleTranscribeAll()}
              disabled={busy}
              className="px-4 h-9 rounded-lg text-[13px] font-semibold text-white disabled:opacity-40"
              style={{ background: '#00c8d7' }}
            >
              {busy ? '转写中…' : '转写文稿'}
            </button>
          </div>
        ) : !hasTranscript ? (
          <p className="text-center py-10 text-[13px] text-[#888]">
            <Loader2 size={13} className="animate-spin inline mr-1.5" />转写中…
          </p>
        ) : (
          paragraphs.map((para) => (
            <p key={para.key} className="text-[15px] leading-[2.02] font-medium text-[#f0f0f0]">
              {para.tokens.map((t) => {
                const marked = t.finding && t.finding.enabled;
                const dimmed = t.finding && !t.finding.enabled;
                const inSel = (selRange && t.idx >= selRange[0] && t.idx <= selRange[1] && !t.isPause) || selectedTokenIndexes.has(t.idx);
                const hit = queryLower && t.text.toLowerCase().includes(queryLower);
                const active = t.finding && t.finding.id === activeFindingId;
                const evidenceTip = t.finding
                  ? `${CATEGORY_LABELS[t.finding.category]} · 置信度 ${(t.finding.confidence * 100).toFixed(0)}%\n${t.finding.evidence.map((e) => e.detail).join('\n')}\n点击${t.finding.enabled ? '取消' : '恢复'}标记`
                  : '点击跳转；按住拖选可标记删除';
                return (
                  <span
                    key={t.key}
                    onMouseDown={(e) => handleTokenMouseDown(t, e)}
                    onMouseEnter={() => handleTokenMouseEnter(t)}
                    onClick={() => handleTokenClick(t)}
                    title={evidenceTip}
                    className={[
                      'cursor-pointer transition-colors rounded-[3px]',
                      marked ? 'line-through bg-[#8b751a] text-[#ffe898] px-[2px] decoration-[#ffe898]/80 decoration-2' : '',
                      dimmed ? 'bg-[#6f5f1d]/35 text-[#bfb48c] px-[2px]' : '',
                      active ? 'outline outline-1 outline-[#00c8d7]/80' : '',
                      t.kept && !t.finding ? 'underline decoration-emerald-400/60 decoration-2 underline-offset-4' : '',
                      inSel ? 'bg-[#00c8d7]/40' : '',
                      hit ? 'bg-[#00c8d7]/30' : '',
                      !t.finding && !inSel ? 'hover:bg-white/[0.08]' : '',
                    ].filter(Boolean).join(' ')}
                  >
                    {t.text}
                  </span>
                );
              })}
            </p>
          ))
        )}
      </div>
      {manualSelection && (
        <button
          onMouseDown={(e) => e.preventDefault()}
          onClick={deleteManualSelection}
          className="absolute z-50 h-8 px-4 rounded-md text-[12px] font-semibold text-white shadow-[0_8px_24px_rgba(0,0,0,0.35)] border border-white/[0.16]"
          style={{
            left: manualSelection.x,
            top: manualSelection.y,
            background: '#00c8d7',
          }}
        >
          删除
        </button>
      )}
    </div>
  );
}
