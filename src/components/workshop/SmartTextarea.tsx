/**
 * SmartTextarea — 聚焦时整框放大成悬浮编辑卡。
 *
 * 点进小输入框 → 从原位置丝滑生长为一张 ~640×400 的悬浮卡片
 * （近 16:10 比例，portal 悬浮于页面之上，不挤压周围布局）；
 * 失焦/Esc/点遮罩 → 缩回原位。framer-motion 驱动位置+尺寸过渡。
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { Mic, Video } from 'lucide-react';
import { Z } from '@/lib/ui/layers';

interface Props {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows?: number;
  /** 展开态顶部显示的标题 */
  editorTitle?: string;
  className?: string;
  /** 兼容旧参数：编辑区采用画布同款纯文本输入，避免透明叠层造成幽灵输入 */
  mentionHighlight?: boolean;
  /** 参考图/音频/视频缩略图行 */
  referenceImages?: { label: string; url: string; type?: 'audio' | 'video' }[];
}

const EASE = [0.32, 0.72, 0, 1] as const;
const CARD_W = 640;
const CARD_H = 400;

const MENTION_RE = /(@(?:图片|视频|音频)[一二三四五六七八九十\d]+|@[^\s@,;，；]+\.\w{2,5})/g;
const MENTION_TOKEN_RE = /^@(?:图片|视频|音频)[一二三四五六七八九十\d]+/;
const isGoodMention = (s: string) => /^@(?:图片|视频|音频)[一二三四五六七八九十\d]+$/.test(s);
const isBadMention = (s: string) => /^@[^\s@,;，；]+\.\w{2,5}$/.test(s);
const ENABLE_INLINE_MENTION_BACKDROP = false;

function mentionTokenFromLabel(label: string): string {
  return label.match(MENTION_TOKEN_RE)?.[0] ?? label;
}

function MentionInline({ text }: { text: string }) {
  const parts = text.split(MENTION_RE);
  return (
    <>
      {parts.map((p, i) =>
        isGoodMention(p)
          ? <span key={i} style={{ color: 'var(--canvas-accent)', fontWeight: 500 }}>{p}</span>
          : isBadMention(p)
            ? <span key={i} style={{ color: '#f59e0b', fontWeight: 500, textDecoration: 'underline wavy' }}>{p}</span>
            : <span key={i}>{p}</span>,
      )}
    </>
  );
}

export default function SmartTextarea({ value, onChange, placeholder, rows = 3, editorTitle, className, mentionHighlight, referenceImages }: Props) {
  const [expanded, setExpanded] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);
  const [srcRect, setSrcRect] = useState<DOMRect | null>(null);
  const collapsedHeight = Math.max(28, rows * 18 + 14);

  const openEditor = () => {
    const rect = anchorRef.current?.getBoundingClientRect();
    if (rect) setSrcRect(rect);
    setExpanded(true);
  };

  return (
    <>
      <div
        ref={anchorRef}
        role="textbox"
        tabIndex={0}
        onFocus={openEditor}
        onClick={openEditor}
        className={className ?? 'w-full resize-none bg-[rgba(255,255,255,0.04)] rounded-lg px-2.5 py-2 text-[11px] text-[var(--canvas-text-1)] leading-relaxed focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--canvas-accent)] border border-transparent hover:border-[var(--canvas-node-border-selected)] placeholder:text-[var(--canvas-text-3)] cursor-text'}
        style={{
          opacity: expanded ? 0.25 : 1,
          transition: 'opacity 0.2s ease',
          height: `${collapsedHeight}px`,
          maxHeight: `${collapsedHeight}px`,
          overflow: 'hidden',
        }}
      >
        <div
          className={rows <= 1 ? 'truncate' : 'whitespace-pre-wrap break-words overflow-hidden'}
          style={rows > 1 ? {
            display: '-webkit-box',
            WebkitLineClamp: rows,
            WebkitBoxOrient: 'vertical',
            lineHeight: '18px',
          } : undefined}
        >
          {value
            ? (mentionHighlight ? <MentionInline text={value} /> : value)
            : <span className="text-[var(--canvas-text-3)]">{placeholder}</span>}
        </div>
      </div>
      <AnimatePresence>
        {expanded && srcRect && (
          <FloatingEditor
            srcRect={srcRect}
            value={value}
            title={editorTitle ?? placeholder ?? ''}
            placeholder={placeholder}
            onChange={onChange}
            onClose={() => setExpanded(false)}
            mentionHighlight={mentionHighlight}
            referenceImages={referenceImages}
          />
        )}
      </AnimatePresence>
    </>
  );
}

function MentionBackdrop({ text, scrollRef }: { text: string; scrollRef: React.RefObject<HTMLTextAreaElement> }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const ta = scrollRef.current;
    const bd = ref.current;
    if (!ta || !bd) return;
    const sync = () => { bd.scrollTop = ta.scrollTop; bd.scrollLeft = ta.scrollLeft; };
    ta.addEventListener('scroll', sync);
    sync();
    return () => ta.removeEventListener('scroll', sync);
  }, [scrollRef, text]);
  return (
    <div
      ref={ref}
      aria-hidden
      className="absolute inset-0 px-4 pb-4 text-[14px] whitespace-pre-wrap break-words overflow-hidden pointer-events-none"
      style={{ color: 'var(--canvas-text-1)', lineHeight: 1.8 }}
    >
      <MentionInline text={text} />
      {text.endsWith('\n') ? '​' : ''}
    </div>
  );
}

function FloatingEditor({ srcRect, value, title, placeholder, onChange, onClose, mentionHighlight, referenceImages }: {
  srcRect: DOMRect;
  value: string;
  title: string;
  placeholder?: string;
  onChange: (v: string) => void;
  onClose: () => void;
  mentionHighlight?: boolean;
  referenceImages?: { label: string; url: string; type?: 'audio' | 'video' }[];
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [localValue, setLocalValue] = useState(value);
  const composingRef = useRef(false);
  const closingRef = useRef(false);
  const closeWithFlush = () => {
    if (closingRef.current) return;
    closingRef.current = true;
    // 中文输入法组合态、快速点遮罩或 Esc 时，最后一次字符可能尚未走到
    // 常规 onChange。关闭前用本地编辑值再回写一次，生成按钮随后读取到的
    // 一定是用户眼前看到的完整提示词。
    onChange(taRef.current?.value ?? localValue);
    onClose();
  };

  const insertAtCursor = (text: string) => {
    const el = taRef.current;
    const start = el?.selectionStart ?? localValue.length;
    const end = el?.selectionEnd ?? start;
    const next = `${localValue.slice(0, start)}${text}${localValue.slice(end)}`;
    setLocalValue(next);
    onChange(next);
    requestAnimationFrame(() => {
      el?.focus();
      el?.setSelectionRange(start + text.length, start + text.length);
    });
  };

  useEffect(() => {
    if (!composingRef.current) setLocalValue(value);
  }, [value]);

  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const w = Math.min(CARD_W, vw - 48);
  const h = Math.min(CARD_H, vh - 80);
  const targetX = Math.min(Math.max(srcRect.left + srcRect.width / 2 - w / 2, 24), vw - w - 24);
  const targetY = Math.min(Math.max(srcRect.top - 40, 24), vh - h - 24);

  useLayoutEffect(() => {
    const el = taRef.current;
    if (el) {
      const t = setTimeout(() => {
        el.focus();
        el.setSelectionRange(el.value.length, el.value.length);
      }, 120);
      return () => clearTimeout(t);
    }
  }, []);

  return createPortal(
    <div className="fixed inset-0 canvas-dark" style={{ zIndex: Z.modalStack }}>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22 }}
        className="absolute inset-0"
        style={{ background: 'rgba(0,0,0,0.6)' }}
        onClick={closeWithFlush}
      />
      <motion.div
        initial={{ x: srcRect.left, y: srcRect.top, width: srcRect.width, height: srcRect.height, opacity: 0.6 }}
        animate={{ x: targetX, y: targetY, width: w, height: h, opacity: 1 }}
        exit={{ x: srcRect.left, y: srcRect.top, width: srcRect.width, height: srcRect.height, opacity: 0 }}
        transition={{ duration: 0.34, ease: EASE }}
        className="absolute rounded-2xl border flex flex-col overflow-hidden"
        style={{
          background: 'var(--canvas-panel)',
          borderColor: 'rgba(31,162,220,0.45)',
          boxShadow: '0 20px 60px rgba(0,0,0,0.5), 0 0 0 4px rgba(31,162,220,0.08)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2, delay: 0.1 }}
          className="flex items-center justify-between px-4 pt-3 pb-2 shrink-0"
        >
          <span className="text-[12px] font-medium text-[var(--canvas-accent)] truncate">{title}</span>
          <span className="text-[10px] text-[var(--canvas-text-3)] shrink-0">{localValue.length} 字 · Esc 收起</span>
        </motion.div>

        {referenceImages && referenceImages.length > 0 && (
          <div className="flex items-center gap-2 px-4 pb-2 shrink-0">
            <span className="text-[10px] text-[var(--canvas-text-2)] font-medium shrink-0">资产</span>
            <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
              {referenceImages.map((ref, i) => (
                <div key={i} className="shrink-0 flex flex-col items-center gap-0.5">
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insertAtCursor(mentionTokenFromLabel(ref.label))}
                    title={`点击插入 ${mentionTokenFromLabel(ref.label)}`}
                    className="w-10 h-10 rounded-lg overflow-hidden border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.05)] flex items-center justify-center hover:ring-1 hover:ring-[var(--canvas-accent)] transition-all"
                  >
                    {ref.type === 'audio' ? (
                      <Mic size={16} className="text-[var(--canvas-accent)]" />
                    ) : ref.type === 'video' ? (
                      <Video size={16} className="text-emerald-400" />
                    ) : (
                      <img src={ref.url} alt="" className="w-full h-full object-cover" />
                    )}
                  </button>
                  <span className="text-[10px] font-medium" style={{ color: ref.type === 'audio' ? '#a78bfa' : ref.type === 'video' ? '#34d399' : 'var(--canvas-accent)' }}>{ref.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="flex-1 relative min-h-0">
          {mentionHighlight && ENABLE_INLINE_MENTION_BACKDROP && <MentionBackdrop text={localValue} scrollRef={taRef} />}
          <textarea
            ref={taRef}
            value={localValue}
            onChange={(e) => { setLocalValue(e.target.value); if (!composingRef.current) onChange(e.target.value); }}
            onCompositionStart={() => { composingRef.current = true; }}
            onCompositionEnd={(e) => { composingRef.current = false; onChange((e.target as HTMLTextAreaElement).value); }}
            onBlur={closeWithFlush}
            onKeyDown={(e) => {
              if (e.key === 'Escape') { e.stopPropagation(); closeWithFlush(); }
            }}
            placeholder={placeholder}
            className="absolute inset-0 w-full h-full resize-none bg-transparent px-4 pb-4 text-[14px] focus:outline-none placeholder:text-[var(--canvas-text-3)]"
            style={{
              lineHeight: 1.8,
              color: mentionHighlight && ENABLE_INLINE_MENTION_BACKDROP ? 'transparent' : 'var(--canvas-text-1)',
              caretColor: 'var(--canvas-text-1)',
            }}
          />
        </div>
      </motion.div>
    </div>,
    document.body,
  );
}
