import { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import { createPortal } from 'react-dom';
import {
  Edit3, Eye, Megaphone, BookOpen, Clapperboard,
  Bold, Italic, Strikethrough, Underline,
  Heading1, Heading2, Heading3,
  List, ListOrdered, Quote, Code2, Link2, Undo2, Redo2,
  Check, X, Wand2, Minimize2, Maximize2, Smile, Replace,
  Download, ArrowRight, ShieldCheck, AlertTriangle, MessageSquareText,
} from 'lucide-react';
import { useCopywritingStore } from '@/stores/copywritingStore';
import { useChatStore } from '@/stores';
import { MarkdownRenderer } from '@/lib/markdown';
import { wrapSelection, prefixLines } from '@/lib/canvas/mdRender';
import TextActions from './TextActions';
import CommentsPanel from './CommentsPanel';
import ScriptTable, { parseMarkdownTable } from './ScriptTable';
import ReportCard from './ReportCard';
import { exportXlsx } from '@/lib/copywriting/exportXlsx';
import { buildCopyDocMap } from '@/lib/copywriting/documentMap';
import { dispatchCopywritingPrompt } from './CopywritingChatPanel';
import { TONE_OPTIONS, buildTonePrompt } from '@/lib/copywriting/toneOptions';
import { buildGuidePrompt, withCopywritingStyleGuard } from '@/lib/copywriting/antiAiStyle';
import { auditCopywriting, buildTargetedRewritePrompt } from '@/lib/copywriting/qualityAudit';
import { createCopyCommentTarget, findCopyCommentTarget, type CopyCommentTarget } from '@/lib/copywriting/commentAnchors';
import type { CopyComment, CopyDoc } from '@/lib/copywriting/types';
import type { WsShot } from '@/lib/workshop/types';

const FONT_STACK = "'Inter', 'PingFang SC', '-apple-system', 'Segoe UI', sans-serif";

const TB_SEP = 'sep' as const;
type ToolbarItem = { key: string; icon: React.ElementType; label: string; action: (ta: HTMLTextAreaElement) => ReturnType<typeof wrapSelection> } | typeof TB_SEP;

const TOOLBAR: ToolbarItem[] = [
  { key: 'bold', icon: Bold, label: '加粗', action: ta => wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, '**') },
  { key: 'italic', icon: Italic, label: '斜体', action: ta => wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, '*') },
  { key: 'strike', icon: Strikethrough, label: '删除线', action: ta => wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, '~~') },
  { key: 'underline', icon: Underline, label: '下划线', action: ta => wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, '<u>', '</u>') },
  TB_SEP,
  { key: 'h1', icon: Heading1, label: '标题 1', action: ta => prefixLines(ta.value, ta.selectionStart, ta.selectionEnd, '# ') },
  { key: 'h2', icon: Heading2, label: '标题 2', action: ta => prefixLines(ta.value, ta.selectionStart, ta.selectionEnd, '## ') },
  { key: 'h3', icon: Heading3, label: '标题 3', action: ta => prefixLines(ta.value, ta.selectionStart, ta.selectionEnd, '### ') },
  TB_SEP,
  { key: 'ul', icon: List, label: '无序列表', action: ta => prefixLines(ta.value, ta.selectionStart, ta.selectionEnd, '- ') },
  { key: 'ol', icon: ListOrdered, label: '有序列表', action: ta => prefixLines(ta.value, ta.selectionStart, ta.selectionEnd, '1. ') },
  { key: 'quote', icon: Quote, label: '引用', action: ta => prefixLines(ta.value, ta.selectionStart, ta.selectionEnd, '> ') },
  TB_SEP,
  { key: 'code', icon: Code2, label: '代码块', action: ta => wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, '```\n', '\n```') },
  { key: 'link', icon: Link2, label: '链接', action: ta => wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, '[', '](url)') },
];

const EMPTY_CARDS = [
  { icon: Megaphone, label: '广告创意策划', desc: '抖音/小红书短视频广告', prompt: buildGuidePrompt('ad') },
  { icon: BookOpen, label: '剧本分析诊断', desc: '6维量化 Coverage 报告', prompt: buildGuidePrompt('scriptDoctor') },
  { icon: Clapperboard, label: '视频脚本创作', desc: '旅行/品牌/纪录片脚本', prompt: buildGuidePrompt('videoScript') },
];

type PreviewBlock = {
  id: string;
  content: string;
  start: number;
  end: number;
};

const PREVIEW_ACTIONS = [
  { icon: Wand2, label: '改写', prompt: (t: string) => withCopywritingStyleGuard(`请改写以下文字，保持原意和体裁，不要改成通用 AI 文案。文学类保留意象、节奏和留白；商业类去掉套话，增加具体场景和判断：\n\n${t}`) },
  { icon: Minimize2, label: '缩写', prompt: (t: string) => withCopywritingStyleGuard(`请精简以下文字，保留核心信息、语气和文学/口播节奏。删掉空泛修饰和模板句，不要把文字压成干巴巴的摘要：\n\n${t}`) },
  { icon: Maximize2, label: '扩写', prompt: (t: string) => withCopywritingStyleGuard(`请扩充以下文字。不要堆形容词，不要写通用宣传腔；用具体场景、动作、物件、人物选择或镜头细节来扩写。文学类可以增加意象和留白，但要克制：\n\n${t}`) },
];

interface Props {
  doc: CopyDoc | null;
}

export default function DocEditor({ doc }: Props) {
  const updateDoc = useCopywritingStore(s => s.updateDoc);
  const [mode, setMode] = useState<'edit' | 'preview'>('edit');
  const [selection, setSelection] = useState<{ text: string; start: number; end: number; rect: DOMRect } | null>(null);
  const [previewSelection, setPreviewSelection] = useState<{ text: string; start: number; end: number; value: string; rect: DOMRect; replacing: boolean } | null>(null);
  const [editingBlock, setEditingBlock] = useState<{ id: string; start: number; end: number; value: string } | null>(null);
  const [qualityOpen, setQualityOpen] = useState(false);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [commentTarget, setCommentTarget] = useState<CopyCommentTarget | null>(null);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const analyzedDocIdRef = useRef(doc?.id ?? null);
  const [analysisContent, setAnalysisContent] = useState(doc?.content ?? '');

  // Keep typing urgent. Document maps, audits and table parsing are useful
  // metadata, but none of them should run between the key event and paint.
  // During AI generation this also coalesces hundreds of partial documents
  // into one analysis after the stream settles.
  useEffect(() => {
    const nextDocId = doc?.id ?? null;
    const nextContent = doc?.content ?? '';
    if (analyzedDocIdRef.current !== nextDocId) {
      analyzedDocIdRef.current = nextDocId;
      setAnalysisContent(nextContent);
      return;
    }
    const timer = setTimeout(() => setAnalysisContent(nextContent), 400);
    return () => clearTimeout(timer);
  }, [doc?.id, doc?.content]);

  const applyToolbar = useCallback((item: Exclude<ToolbarItem, typeof TB_SEP>) => {
    const ta = editorRef.current;
    if (!ta || !doc) return;
    const { next, selStart, selEnd } = item.action(ta);
    updateDoc(doc.id, { content: next });
    requestAnimationFrame(() => {
      ta.focus();
      ta.setSelectionRange(selStart, selEnd);
    });
  }, [doc, updateDoc]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!e.metaKey && !e.ctrlKey) return;
    const ta = editorRef.current;
    if (!ta || !doc) return;

    let result: ReturnType<typeof wrapSelection> | null = null;
    if (e.key === 'b') {
      e.preventDefault();
      result = wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, '**');
    } else if (e.key === 'i') {
      e.preventDefault();
      result = wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, '*');
    } else if (e.key === 'u') {
      e.preventDefault();
      result = wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, '<u>', '</u>');
    } else if (e.key === 's' && e.shiftKey) {
      e.preventDefault();
      result = wrapSelection(ta.value, ta.selectionStart, ta.selectionEnd, '~~');
    }
    if (result) {
      updateDoc(doc.id, { content: result.next });
      requestAnimationFrame(() => {
        ta.focus();
        ta.setSelectionRange(result!.selStart, result!.selEnd);
      });
    }
  }, [doc, updateDoc]);

  const handleSelect = useCallback(() => {
    const ta = editorRef.current;
    if (!ta) return;
    const sel = ta.value.substring(ta.selectionStart, ta.selectionEnd);
    if (sel.length > 2) {
      const rect = ta.getBoundingClientRect();
      const lineHeight = 30;
      const lines = ta.value.substring(0, ta.selectionStart).split('\n').length;
      const approxY = rect.top + lines * lineHeight - ta.scrollTop;
      setSelection({
        text: sel,
        start: ta.selectionStart,
        end: ta.selectionEnd,
        rect: new DOMRect(rect.left + 60, approxY, 200, lineHeight),
      });
    } else {
      setSelection(null);
    }
  }, []);

  const handlePushToWorkshop = useCallback((rows: Record<string, string>[]) => {
    const { useWorkshopStore } = require('@/stores/workshopStore');
    const shots: WsShot[] = rows.map((r, i) => ({
      shotNo: r['镜号'] || r['编号'] || `${i + 1}`,
      description: r['画面'] || r['描述'] || r['画面描述'] || '',
      dialogue: r['旁白'] || r['对白'] || r['台词'] || '',
      shotType: r['景别'] || '',
      characterIds: [],
      durationSec: parseInt(r['时长'] || '0', 10) || undefined,
    }));
    useWorkshopStore.getState().setShots(shots, 'merge');
    useChatStore.getState().setActiveView('workshop');
  }, []);

  const handlePreviewSelect = useCallback(() => {
    if (!doc || mode !== 'preview') return;
    const sel = window.getSelection();
    const text = sel?.toString().trim();
    const range = sel && sel.rangeCount > 0 ? sel.getRangeAt(0) : null;
    const root = previewRef.current;
    if (!text || text.length < 1 || !range || !root) {
      setPreviewSelection(null);
      return;
    }
    if (!root.contains(range.commonAncestorContainer)) return;
    const ancestor = range.commonAncestorContainer.nodeType === Node.ELEMENT_NODE
      ? range.commonAncestorContainer as Element
      : range.commonAncestorContainer.parentElement;
    const block = ancestor?.closest<HTMLElement>('[data-copy-start]');
    const blockStart = Number(block?.dataset.copyStart ?? 0);
    const blockEnd = Number(block?.dataset.copyEnd ?? doc.content.length);
    const target = findCopyCommentTarget(doc.content, text, blockStart, blockEnd)
      ?? findCopyCommentTarget(doc.content, text);
    if (!target) {
      setPreviewSelection(null);
      return;
    }
    setPreviewSelection({
      text,
      start: target.start,
      end: target.end,
      value: text,
      rect: range.getBoundingClientRect(),
      replacing: false,
    });
  }, [doc, mode]);

  const applyPreviewEdit = useCallback((source: string, replacement: string) => {
    if (!doc || !source) return;
    const exactIndex = doc.content.indexOf(source);
    if (exactIndex >= 0) {
      updateDoc(doc.id, {
        content: doc.content.slice(0, exactIndex) + replacement + doc.content.slice(exactIndex + source.length),
      });
      setPreviewSelection(null);
      window.getSelection()?.removeAllRanges();
      return;
    }

    const escapedSource = source.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wrappedRe = new RegExp(`(\\*\\*|~~|\\*|<u>)${escapedSource}(\\*\\*|~~|\\*|<\\/u>)`);
    const wrappedMatch = doc.content.match(wrappedRe);
    if (wrappedMatch && typeof wrappedMatch.index === 'number') {
      const start = wrappedMatch.index + wrappedMatch[1].length;
      updateDoc(doc.id, {
        content: doc.content.slice(0, start) + replacement + doc.content.slice(start + source.length),
      });
      setPreviewSelection(null);
      window.getSelection()?.removeAllRanges();
    }
  }, [doc, updateDoc]);

  const savePreviewBlock = useCallback(() => {
    if (!doc || !editingBlock) return;
    updateDoc(doc.id, {
      content: doc.content.slice(0, editingBlock.start) + editingBlock.value + doc.content.slice(editingBlock.end),
    });
    setEditingBlock(null);
  }, [doc, editingBlock, updateDoc]);

  const contentBlocks = useMemo(() => {
    if (!analysisContent) return [];
    const blocks: { type: 'md' | 'table' | 'report'; content: string; start: number; end: number }[] = [];
    const tableRe = /^(\|[^\n]+\|)\n(\|(?:\s*:?-+:?\s*\|)+)\n((?:\|[^\n]+\|\n?)+)/gm;
    const reportRe = /```json:report\n([\s\S]*?)```/g;

    let lastIndex = 0;
    const content = analysisContent;
    const markers: { start: number; end: number; type: 'table' | 'report'; raw: string }[] = [];

    let m;
    while ((m = tableRe.exec(content)) !== null) {
      markers.push({ start: m.index, end: m.index + m[0].length, type: 'table', raw: m[0] });
    }
    while ((m = reportRe.exec(content)) !== null) {
      markers.push({ start: m.index, end: m.index + m[0].length, type: 'report', raw: m[1] });
    }

    markers.sort((a, b) => a.start - b.start);

    for (const marker of markers) {
      if (marker.start > lastIndex) {
        blocks.push({ type: 'md', content: content.slice(lastIndex, marker.start), start: lastIndex, end: marker.start });
      }
      blocks.push({ type: marker.type, content: marker.raw, start: marker.start, end: marker.end });
      lastIndex = marker.end;
    }
    if (lastIndex < content.length) {
      blocks.push({ type: 'md', content: content.slice(lastIndex), start: lastIndex, end: content.length });
    }

    return blocks;
  }, [analysisContent]);

  const replaceContentRange = useCallback((start: number, end: number, nextBlock: string) => {
    if (!doc) return;
    updateDoc(doc.id, { content: doc.content.slice(0, start) + nextBlock + doc.content.slice(end) });
  }, [doc, updateDoc]);

  const documentTableData = useMemo(() => {
    const headers: string[] = [];
    const rows: Record<string, string>[] = [];
    for (const block of contentBlocks) {
      if (block.type !== 'table') continue;
      const table = parseMarkdownTable(block.content);
      if (!table) continue;
      for (const header of table.headers) {
        if (!headers.includes(header)) headers.push(header);
      }
      rows.push(...table.rows);
    }
    return { headers, rows };
  }, [contentBlocks]);

  const docBlocks = useMemo(() => buildCopyDocMap(analysisContent), [analysisContent]);
  const qualityAudit = useMemo(() => auditCopywriting(analysisContent), [analysisContent]);
  const openCommentCount = useMemo(
    () => (doc?.comments ?? []).filter(comment => comment.status === 'open').length,
    [doc?.comments],
  );
  const docBlockTitle = useMemo(() => {
    if (docBlocks.length === 0) return '暂无定位块';
    return docBlocks
      .slice(0, 28)
      .map(block => `${block.id} L${block.startLine}-${block.endLine} ${block.preview}`)
      .join('\n');
  }, [docBlocks]);

  const handleExportDocumentExcel = useCallback(() => {
    if (documentTableData.headers.length === 0 || documentTableData.rows.length === 0) return;
    void exportXlsx(documentTableData.headers, documentTableData.rows, doc?.title ?? '分镜表');
  }, [doc?.title, documentTableData]);

  const handlePushDocumentToWorkshop = useCallback(() => {
    if (documentTableData.rows.length === 0) return;
    handlePushToWorkshop(documentTableData.rows);
  }, [documentTableData.rows, handlePushToWorkshop]);

  const startComment = useCallback((start: number, end: number) => {
    if (!doc) return;
    const target = createCopyCommentTarget(doc.content, start, end);
    if (!target) return;
    setCommentTarget(target);
    setCommentsOpen(true);
    setSelection(null);
    setPreviewSelection(null);
    window.getSelection()?.removeAllRanges();
  }, [doc]);

  const jumpToComment = useCallback((comment: CopyComment) => {
    if (!doc || comment.orphaned) return;
    setMode('edit');
    setCommentsOpen(true);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const editor = editorRef.current;
        if (!editor) return;
        editor.focus({ preventScroll: true });
        editor.setSelectionRange(comment.start, comment.end);
        const line = doc.content.slice(0, comment.start).split('\n').length - 1;
        editor.scrollTop = Math.max(0, line * 30 - editor.clientHeight * 0.35);
      });
    });
  }, [doc]);

  useEffect(() => {
    setSelection(null);
    setPreviewSelection(null);
    setEditingBlock(null);
    setQualityOpen(false);
    setCommentTarget(null);
  }, [doc?.id]);

  if (!doc) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ background: 'var(--cw-bg)' }}>
        <div className="text-center max-w-[360px]">
          <div
            className="mx-auto mb-5 flex items-center justify-center"
            style={{
              width: 72, height: 72, borderRadius: 18,
              background: '#F3F4F6',
            }}
          >
            <Edit3 size={32} style={{ color: '#374151' }} />
          </div>
          <p className="text-[18px] font-semibold" style={{ color: 'var(--cw-text)' }}>
            文案工作室
          </p>
          <p className="text-[13px] mt-2 mb-5 leading-relaxed" style={{ color: 'var(--cw-text-muted)' }}>
            新建文档或选择快速开始模板
          </p>
          <div className="flex flex-col gap-2">
            {EMPTY_CARDS.map(c => (
              <button
                key={c.label}
                onClick={() => dispatchCopywritingPrompt(c.prompt)}
                className="flex items-center gap-3 px-4 py-3 rounded-xl text-left transition-all"
                style={{ background: '#FAFBFC', border: '1px solid var(--cw-border)' }}
                onMouseEnter={e => { e.currentTarget.style.boxShadow = 'var(--cw-shadow-md)'; e.currentTarget.style.borderColor = 'rgba(0,0,0,0.12)'; }}
                onMouseLeave={e => { e.currentTarget.style.boxShadow = 'none'; e.currentTarget.style.borderColor = 'var(--cw-border)'; }}
              >
                <span
                  className="flex items-center justify-center shrink-0"
                  style={{ width: 36, height: 36, borderRadius: 10, background: '#F3F4F6' }}
                >
                  <c.icon size={18} style={{ color: '#374151' }} />
                </span>
                <span>
                  <span className="block text-[13px] font-medium" style={{ color: 'var(--cw-text)' }}>{c.label}</span>
                  <span className="block text-[11px] mt-0.5" style={{ color: 'var(--cw-text-muted)' }}>{c.desc}</span>
                </span>
              </button>
            ))}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="flex-1 flex flex-col min-w-0 relative" style={{ background: 'var(--cw-bg)' }}>
      {/* Mode toggle — segmented control */}
      <div className="flex items-center gap-2 px-4 py-2 shrink-0" style={{ borderBottom: '1px solid rgba(0,0,0,0.04)' }}>
        <div className="flex items-center p-0.5 rounded-lg" style={{ background: '#F3F4F6' }}>
          {(['edit', 'preview'] as const).map(m => {
            const active = mode === m;
            const Icon = m === 'edit' ? Edit3 : Eye;
            const label = m === 'edit' ? '编辑' : '预览';
            return (
              <button
                key={m}
                onClick={() => setMode(m)}
                className="flex items-center gap-1 whitespace-nowrap px-3 py-1.5 rounded-md text-[12px] font-medium transition-all"
                style={{
                  background: active ? '#FFFFFF' : 'transparent',
                  color: active ? 'var(--cw-text)' : 'var(--cw-text-muted)',
                  boxShadow: active ? '0 1px 2px rgba(0,0,0,0.06)' : 'none',
                }}
              >
                <Icon size={12} /> {label}
              </button>
            );
          })}
        </div>
        <div className="flex-1" />
        <div className="flex items-center gap-1">
          <button
            onClick={() => setCommentsOpen(value => !value)}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[11px] transition-colors"
            style={{
              color: commentsOpen ? '#1C1917' : 'var(--cw-text-2)',
              background: commentsOpen ? '#F5F5F4' : '#FFFFFF',
              border: '1px solid var(--cw-border)',
            }}
            title="查看和处理文档批注"
          >
            <MessageSquareText size={12} />
            批注{openCommentCount > 0 ? ` ${openCommentCount}` : ''}
          </button>
          <div className="relative">
            <button
              onClick={() => setQualityOpen((value) => !value)}
              disabled={!doc.content.trim()}
              className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-35"
              style={{ color: 'var(--cw-text-2)', background: '#FFFFFF', border: '1px solid var(--cw-border)' }}
              title="检查模板句、重复表达、标点滥用和文风节奏"
            >
              {qualityAudit.grade === 'rewrite' ? <AlertTriangle size={12} /> : <ShieldCheck size={12} />}
              文风审校 {qualityAudit.score || '--'}
            </button>
            {qualityOpen && doc.content.trim() && (
              <div
                className="absolute right-0 top-[34px] z-40 w-[340px] max-h-[420px] overflow-y-auto rounded-xl border bg-white p-3 shadow-xl"
                style={{ borderColor: 'var(--cw-border)' }}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-[13px] font-semibold" style={{ color: 'var(--cw-text)' }}>
                      文风审校 {qualityAudit.score}/100
                    </p>
                    <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--cw-text-muted)' }}>
                      {qualityAudit.summary}
                    </p>
                  </div>
                  <button
                    onClick={() => setQualityOpen(false)}
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md hover:bg-stone-100"
                    title="关闭"
                  >
                    <X size={13} />
                  </button>
                </div>
                {qualityAudit.issues.length > 0 ? (
                  <div className="mt-3 space-y-2">
                    {qualityAudit.issues.map((current) => (
                      <div key={current.ruleId} className="rounded-lg bg-stone-50 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[11px] font-medium" style={{ color: 'var(--cw-text)' }}>{current.label}</span>
                          <span className="text-[10px]" style={{ color: 'var(--cw-text-muted)' }}>{current.count} 处</span>
                        </div>
                        <p className="mt-1 text-[10px] leading-relaxed" style={{ color: 'var(--cw-text-2)' }}>{current.suggestion}</p>
                        {current.excerpts[0] && (
                          <p className="mt-1 truncate text-[10px]" style={{ color: 'var(--cw-text-muted)' }} title={current.excerpts.join('\n')}>
                            {current.excerpts[0]}
                          </p>
                        )}
                      </div>
                    ))}
                    <button
                      onClick={() => {
                        dispatchCopywritingPrompt(buildTargetedRewritePrompt(qualityAudit));
                        setQualityOpen(false);
                      }}
                      className="mt-1 flex w-full items-center justify-center gap-1 rounded-lg bg-stone-900 px-3 py-2 text-[11px] font-medium text-white"
                    >
                      <Wand2 size={12} />
                      让 AI 定向精修
                    </button>
                  </div>
                ) : (
                  <p className="mt-3 rounded-lg bg-stone-50 px-3 py-2 text-[11px] leading-relaxed" style={{ color: 'var(--cw-text-2)' }}>
                    机械审校已通过。事实准确性、观点力度和戏剧效果仍由创作者最终判断。
                  </p>
                )}
              </div>
            )}
          </div>
          <button
            onClick={handleExportDocumentExcel}
            disabled={documentTableData.rows.length === 0}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-35"
            style={{ color: 'var(--cw-text-2)', background: '#FFFFFF', border: '1px solid var(--cw-border)' }}
            title={documentTableData.rows.length === 0 ? '文档中暂无可导出的表格' : '导出整篇文档中的表格数据'}
          >
            <Download size={12} />
            导出 Excel
          </button>
          <button
            onClick={handlePushDocumentToWorkshop}
            disabled={documentTableData.rows.length === 0}
            className="flex shrink-0 items-center gap-1 whitespace-nowrap rounded-md px-2 py-1.5 text-[11px] font-medium transition-opacity disabled:cursor-not-allowed disabled:opacity-35"
            style={{ color: '#FFFFFF', background: '#1A1A1A' }}
            title={documentTableData.rows.length === 0 ? '文档中暂无可推入工坊的表格' : '将整篇文档中的分镜表推入工坊'}
          >
            <ArrowRight size={12} />
            推入工坊
          </button>
        </div>
        <span className="text-[11px]" style={{ color: 'var(--cw-text-muted)' }}>
          {doc.content.length} 字
        </span>
        <span
          className="hidden sm:inline-flex items-center rounded-md px-2 py-1 text-[11px]"
          style={{ color: 'var(--cw-text-muted)', background: '#F7F8FA', border: '1px solid var(--cw-border)' }}
          title={docBlockTitle}
        >
          {docBlocks.length} 个定位块
        </span>
      </div>

      {/* Markdown format toolbar */}
      {mode === 'edit' && (
        <div
          className="flex items-center gap-0.5 px-4 shrink-0"
          style={{
            height: 36,
            background: '#FAFBFC',
            borderBottom: '1px solid rgba(0,0,0,0.04)',
          }}
        >
          {TOOLBAR.map((item, idx) => {
            if (item === TB_SEP) {
              return <span key={`sep-${idx}`} className="mx-1" style={{ width: 1, height: 16, background: 'rgba(0,0,0,0.06)' }} />;
            }
            return (
              <button
                key={item.key}
                onClick={() => applyToolbar(item)}
                className="flex shrink-0 items-center justify-center rounded-md transition-colors"
                style={{ width: 26, height: 26, color: 'var(--cw-text-2)' }}
                onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6'; e.currentTarget.style.color = '#1A1A1A'; }}
                onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--cw-text-2)'; }}
                title={item.label}
              >
                <item.icon size={14} />
              </button>
            );
          })}
          <span className="mx-1" style={{ width: 1, height: 16, background: 'rgba(0,0,0,0.06)' }} />
          <button
            className="flex items-center justify-center rounded-md transition-colors"
            style={{ width: 26, height: 26, color: 'var(--cw-text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6'; e.currentTarget.style.color = '#1A1A1A'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--cw-text-muted)'; }}
            title="撤销 (Cmd+Z)"
            onClick={() => document.execCommand('undo')}
          >
            <Undo2 size={14} />
          </button>
          <button
            className="flex items-center justify-center rounded-md transition-colors"
            style={{ width: 26, height: 26, color: 'var(--cw-text-muted)' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#F3F4F6'; e.currentTarget.style.color = '#1A1A1A'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--cw-text-muted)'; }}
            title="重做 (Cmd+Shift+Z)"
            onClick={() => document.execCommand('redo')}
          >
            <Redo2 size={14} />
          </button>
        </div>
      )}

      {/* Editor / Preview */}
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto">
          {mode === 'edit' ? (
          <div className="max-w-[720px] mx-auto px-8 py-10">
            <textarea
              ref={editorRef}
              value={doc.content}
              onChange={e => updateDoc(doc.id, { content: e.target.value })}
              onSelect={handleSelect}
              onBlur={() => setTimeout(() => setSelection(null), 200)}
              onKeyDown={handleKeyDown}
              className="w-full min-h-[calc(100vh-200px)] resize-none text-[16px] leading-[1.85] outline-none"
              style={{
                background: 'transparent',
                color: 'var(--cw-text)',
                fontFamily: FONT_STACK,
              }}
              placeholder="开始写作…&#10;&#10;提示：在右侧 AI 对话中描述需求，生成的内容会自动同步到这里。&#10;&#10;快捷键：Cmd+B 加粗 | Cmd+I 斜体 | Cmd+U 下划线"
            />
          </div>
        ) : (
          <div ref={previewRef} onMouseUp={handlePreviewSelect} className="max-w-[720px] mx-auto px-8 py-10">
            {doc.content ? (
              <div style={{ color: 'var(--cw-text)', fontFamily: FONT_STACK }}>
                {contentBlocks.map((block, bi) => {
                  if (block.type === 'table') {
                    return (
                      <div key={bi} data-copy-start={block.start} data-copy-end={block.end}>
                        <ScriptTable
                          markdown={block.content}
                          onChange={(next) => replaceContentRange(block.start, block.end, next)}
                        />
                      </div>
                    );
                  }
                  if (block.type === 'report') {
                    try {
                      const data = JSON.parse(block.content);
                      return <div key={bi} data-copy-start={block.start} data-copy-end={block.end}><ReportCard data={data} /></div>;
                    } catch {
                      return <div key={bi} data-copy-start={block.start} data-copy-end={block.end}><MarkdownRenderer content={'```json\n' + block.content + '\n```'} /></div>;
                    }
                  }
                  return (
                    <EditableMarkdownBlocks
                      key={bi}
                      content={block.content}
                      offset={block.start}
                      comments={doc.comments ?? []}
                      editingBlock={editingBlock}
                      onEdit={(edit) => {
                        setPreviewSelection(null);
                        window.getSelection()?.removeAllRanges();
                        setEditingBlock(edit);
                      }}
                      onSave={savePreviewBlock}
                      onCancel={() => setEditingBlock(null)}
                    />
                  );
                })}
              </div>
            ) : (
              <p className="text-[14px]" style={{ color: 'var(--cw-text-muted)' }}>
                暂无内容
              </p>
            )}
          </div>
          )}
        </div>
        {commentsOpen && (
          <CommentsPanel
            doc={doc}
            target={commentTarget}
            onCancelTarget={() => setCommentTarget(null)}
            onCreated={() => setCommentTarget(null)}
            onJump={jumpToComment}
            onClose={() => { setCommentsOpen(false); setCommentTarget(null); }}
          />
        )}
      </div>

      {/* Floating text actions */}
      {selection && mode === 'edit' && (
        <TextActions
          selectedText={selection.text}
          rect={selection.rect}
          onDismiss={() => setSelection(null)}
          onComment={() => startComment(selection.start, selection.end)}
        />
      )}
      {previewSelection && mode === 'preview' && (
        <PreviewSelectionToolbar
          selection={previewSelection}
          onAction={(prompt) => {
            dispatchCopywritingPrompt(prompt(previewSelection.text), previewSelection.text);
            setPreviewSelection(null);
            window.getSelection()?.removeAllRanges();
          }}
          onStartReplace={() => setPreviewSelection(current => current ? { ...current, replacing: true } : current)}
          onChange={(value) => setPreviewSelection(current => current ? { ...current, value } : current)}
          onApply={() => applyPreviewEdit(previewSelection.text, previewSelection.value)}
          onComment={() => startComment(previewSelection.start, previewSelection.end)}
          onDismiss={() => setPreviewSelection(null)}
        />
      )}
    </div>
  );
}

function splitLinesWithOffsets(content: string) {
  const matches = content.match(/[^\n]*(?:\n|$)/g) ?? [];
  const lines: { text: string; raw: string; start: number; end: number }[] = [];
  let start = 0;
  for (const raw of matches) {
    if (!raw && start >= content.length) continue;
    const text = raw.endsWith('\n') ? raw.slice(0, -1) : raw;
    lines.push({ text, raw, start, end: start + raw.length });
    start += raw.length;
  }
  return lines;
}

function isBlankLine(text: string) {
  return text.trim().length === 0;
}

function startsMarkdownBlock(text: string) {
  return /^(#{1,6}\s+|>\s?|```|\s*(?:[-*+]|\d+\.)\s+)/.test(text);
}

function parsePreviewBlocks(content: string, offset: number): PreviewBlock[] {
  const lines = splitLinesWithOffsets(content);
  const blocks: PreviewBlock[] = [];
  let i = 0;

  const pushBlock = (from: number, toExclusive: number) => {
    const start = lines[from].start;
    const end = lines[toExclusive - 1].end;
    const raw = content.slice(start, end).replace(/\n+$/, '');
    if (!raw.trim()) return;
    blocks.push({
      id: `${offset + start}:${offset + end}`,
      content: raw,
      start: offset + start,
      end: offset + start + raw.length,
    });
  };

  while (i < lines.length) {
    const line = lines[i];
    if (isBlankLine(line.text)) {
      i += 1;
      continue;
    }

    if (/^```/.test(line.text)) {
      const from = i;
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i].text)) i += 1;
      if (i < lines.length) i += 1;
      pushBlock(from, i);
      continue;
    }

    if (/^#{1,6}\s+/.test(line.text)) {
      pushBlock(i, i + 1);
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line.text)) {
      const from = i;
      i += 1;
      while (i < lines.length && /^>\s?/.test(lines[i].text)) i += 1;
      pushBlock(from, i);
      continue;
    }

    if (/^\s*(?:[-*+]|\d+\.)\s+/.test(line.text)) {
      const from = i;
      i += 1;
      while (
        i < lines.length
        && !isBlankLine(lines[i].text)
        && (/^\s+/.test(lines[i].text) || /^\s*(?:[-*+]|\d+\.)\s+/.test(lines[i].text))
      ) {
        i += 1;
      }
      pushBlock(from, i);
      continue;
    }

    const from = i;
    i += 1;
    while (i < lines.length && !isBlankLine(lines[i].text) && !startsMarkdownBlock(lines[i].text)) i += 1;
    pushBlock(from, i);
  }

  return blocks;
}

function EditableMarkdownBlocks({ content, offset, comments, editingBlock, onEdit, onSave, onCancel }: {
  content: string;
  offset: number;
  comments: CopyComment[];
  editingBlock: { id: string; start: number; end: number; value: string } | null;
  onEdit: (edit: { id: string; start: number; end: number; value: string }) => void;
  onSave: () => void;
  onCancel: () => void;
}) {
  const blocks = useMemo(() => parsePreviewBlocks(content, offset), [content, offset]);
  return (
    <div className="cw-preview-blocks">
      {blocks.map(block => {
        const active = editingBlock?.id === block.id;
        const blockCommentCount = comments.filter(comment => (
          comment.status === 'open'
          && !comment.orphaned
          && comment.start < block.end
          && comment.end > block.start
        )).length;
        if (active && editingBlock) {
          return (
            <div key={block.id} className="my-2 rounded-lg border bg-white p-2" style={{ borderColor: 'var(--cw-border)', boxShadow: 'var(--cw-shadow-md)' }}>
              <textarea
                autoFocus
                value={editingBlock.value}
                onChange={e => onEdit({ ...editingBlock, value: e.target.value })}
                onKeyDown={e => {
                  if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                    e.preventDefault();
                    onSave();
                  } else if (e.key === 'Escape') {
                    e.preventDefault();
                    onCancel();
                  }
                }}
                className="min-h-[96px] w-full resize-y rounded-md border px-3 py-2 text-[14px] leading-6 outline-none focus:border-stone-400"
                style={{ borderColor: 'var(--cw-border)', color: 'var(--cw-text)', fontFamily: FONT_STACK }}
              />
              <div className="mt-2 flex items-center justify-end gap-1.5">
                <button onClick={onCancel} className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-stone-100" title="取消">
                  <X size={14} />
                </button>
                <button onClick={onSave} className="flex h-7 w-7 items-center justify-center rounded-md bg-stone-900 text-white transition-opacity hover:opacity-85" title="保存">
                  <Check size={14} />
                </button>
              </div>
            </div>
          );
        }
        return (
          <div
            key={block.id}
            data-copy-start={block.start}
            data-copy-end={block.end}
            className="cw-preview-block relative mb-3 rounded-md border px-1.5 py-0.5 transition-colors hover:border-stone-300"
            style={{
              borderColor: blockCommentCount > 0 ? '#D6D3D1' : 'transparent',
              background: blockCommentCount > 0 ? '#FAFAF9' : 'transparent',
              paddingRight: blockCommentCount > 0 ? 32 : undefined,
            }}
            onDoubleClick={() => onEdit({ id: block.id, start: block.start, end: block.end, value: block.content })}
            title="双击编辑"
          >
            <MarkdownRenderer content={block.content} />
            {blockCommentCount > 0 && (
              <span
                className="absolute right-1 top-1 flex h-5 min-w-5 items-center justify-center gap-0.5 rounded px-1 text-[9px]"
                style={{ color: '#57534E', background: '#E7E5E4' }}
                title={`${blockCommentCount} 条待处理批注`}
              >
                <MessageSquareText size={10} /> {blockCommentCount}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function PreviewSelectionToolbar({ selection, onAction, onStartReplace, onChange, onApply, onComment, onDismiss }: {
  selection: { text: string; start: number; end: number; value: string; rect: DOMRect; replacing: boolean };
  onAction: (prompt: (text: string) => string) => void;
  onStartReplace: () => void;
  onChange: (value: string) => void;
  onApply: () => void;
  onComment: () => void;
  onDismiss: () => void;
}) {
  const [toneOpen, setToneOpen] = useState(false);
  const width = selection.replacing ? 328 : 414;
  const x = Math.max(12, Math.min(selection.rect.left, window.innerWidth - width - 12));
  const y = Math.max(12, selection.rect.top - (selection.replacing ? 146 : 42));
  return (
    createPortal(
      <div
        className="fixed z-[95] rounded-xl border bg-white p-1.5 shadow-xl"
        style={{
          left: x,
          top: y,
          width,
          borderColor: 'rgba(0,0,0,0.08)',
          boxShadow: '0 12px 36px rgba(0,0,0,0.14)',
        }}
      >
        {selection.replacing ? (
          <>
            <textarea
              value={selection.value}
              onChange={e => onChange(e.target.value)}
              autoFocus
              rows={3}
              className="w-full resize-none rounded-lg border px-2.5 py-2 text-[13px] leading-5 outline-none focus:border-stone-400"
              style={{ borderColor: 'var(--cw-border)', color: 'var(--cw-text)' }}
            />
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button onClick={onDismiss} className="flex h-7 w-7 items-center justify-center rounded-md transition-colors hover:bg-stone-100" title="取消">
                <X size={14} />
              </button>
              <button onClick={onApply} className="flex h-7 w-7 items-center justify-center rounded-md bg-stone-900 text-white transition-opacity hover:opacity-85" title="替换">
                <Check size={14} />
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-0.5 whitespace-nowrap">
            {PREVIEW_ACTIONS.map(action => (
              <button
                key={action.label}
                onClick={() => onAction(action.prompt)}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] transition-colors hover:bg-stone-100"
                style={{ color: 'var(--cw-text-2)' }}
                title={action.label}
              >
                <action.icon size={12} />
                {action.label}
              </button>
            ))}
            <div className="relative">
              <button
                onClick={() => setToneOpen(v => !v)}
                className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] transition-colors hover:bg-stone-100"
                style={{ color: 'var(--cw-text-2)' }}
                title="选择语气"
              >
                <Smile size={12} />
                语气
              </button>
              {toneOpen && (
                <div
                  className="absolute left-0 top-[34px] z-[96] w-[188px] rounded-xl border bg-white p-1.5 shadow-xl"
                  style={{ borderColor: 'rgba(0,0,0,0.08)' }}
                >
                  {TONE_OPTIONS.map(tone => (
                    <button
                      key={tone.label}
                      onClick={() => onAction(text => buildTonePrompt(tone.label, text))}
                      className="block w-full rounded-lg px-2 py-1.5 text-left text-[11px] leading-snug transition-colors hover:bg-stone-100"
                      style={{ color: 'var(--cw-text-2)' }}
                      title={tone.desc}
                    >
                      {tone.label}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <span className="mx-1 h-4 w-px bg-stone-200" />
            <button
              onClick={onComment}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] transition-colors hover:bg-stone-100"
              style={{ color: 'var(--cw-text-2)' }}
              title="添加批注"
            >
              <MessageSquareText size={12} />
              批注
            </button>
            <button
              onClick={onStartReplace}
              className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[11px] transition-colors hover:bg-stone-100"
              style={{ color: 'var(--cw-text-2)' }}
              title="替换"
            >
              <Replace size={12} />
              替换
            </button>
          </div>
        )}
      </div>,
      document.body,
    )
  );
}
