import { memo, useState, useEffect, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeResizer } from 'reactflow';
import type { NodeProps } from 'reactflow';
import { Bot, FileText, Loader2, Trash2, Maximize2, X, Check } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { useCanvasStore } from '@/stores/canvasStore';
import type { TextNodeData } from '@/types/canvas';
import { renderMarkdown, wrapSelection, prefixLines } from '@/lib/canvas/mdRender';
import { openCanvasNodeInAgent } from '@/lib/canvas/nodeAgent';
import { useHasMultiNodeSelection } from '../NodeToolbarPortal';

function TextEditorModal({ value, onSave, onClose }: { value: string; onSave: (v: string) => void; onClose: () => void }) {
  const [text, setText] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  useEffect(() => { document.body.style.overflow = 'hidden'; return () => { document.body.style.overflow = ''; }; }, []);

  const handleSave = () => { onSave(text); onClose(); };

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.15 }}
      className="canvas-dark fixed inset-0 z-[99999] flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.35)', backdropFilter: 'blur(4px)' }}
      onClick={(e) => { if (e.target === e.currentTarget) handleSave(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 12 }}
        transition={{ duration: 0.2, ease: 'easeOut' }}
        className="w-[560px] max-h-[80vh] flex flex-col bg-[var(--canvas-panel)] rounded-2xl shadow-2xl border border-[var(--canvas-node-border)] overflow-hidden"
      >
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--canvas-node-border)]">
          <div className="flex items-center gap-2">
            <FileText size={14} className="text-[var(--canvas-text-2)]" />
            <span className="text-sm font-medium text-[var(--canvas-text-1)]">编辑文本</span>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={handleSave} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white/90 !text-[#141414] hover:bg-white text-white text-xs font-medium transition-colors">
              <Check size={12} />保存
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] transition-colors">
              <X size={16} />
            </button>
          </div>
        </div>
        <div className="flex-1 p-4 min-h-0">
          <textarea
            ref={textareaRef}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) { e.preventDefault(); handleSave(); } }}
            placeholder="输入文本内容..."
            className="w-full h-full min-h-[300px] text-sm text-[var(--canvas-text-1)] leading-relaxed bg-[rgba(255,255,255,0.05)] border border-[var(--canvas-node-border)] rounded-xl px-4 py-3 focus:outline-none focus:ring-2 focus:ring-[var(--canvas-node-border-selected)] resize-none"
          />
        </div>
        <div className="px-5 py-2.5 border-t border-[var(--canvas-node-border)] flex justify-between items-center">
          <span className="text-[10px] text-[var(--canvas-text-2)]">{text.length} 字</span>
          <span className="text-[10px] text-[var(--canvas-text-3)]">⌘ Enter 保存 · ESC 关闭</span>
        </div>
      </motion.div>
    </motion.div>,
    document.body,
  );
}

function TextNodeComponent({ id, data, selected }: NodeProps<TextNodeData>) {
  const hasMultiSelection = useHasMultiNodeSelection();
  const isGenerating = data.isGenerating || false;
  const content = data.generatedContent || data.description || '';
  const deleteNode = useCanvasStore((s) => s.deleteNode);
  const updateNode = useCanvasStore((s) => s.updateNode);
  const [localValue, setLocalValue] = useState(data.description || '');
  const [isEditing, setIsEditing] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const [fmtBar, setFmtBar] = useState(false);

  const applyWrap = (sym: string) => {
    const t = textareaRef.current;
    if (!t) return;
    const { next, selStart, selEnd } = wrapSelection(localValue, t.selectionStart, t.selectionEnd, sym);
    setLocalValue(next);
    requestAnimationFrame(() => { t.focus(); t.setSelectionRange(selStart, selEnd); });
  };
  const applyPrefix = (prefix: string) => {
    const t = textareaRef.current;
    if (!t) return;
    const { next, selStart, selEnd } = prefixLines(localValue, t.selectionStart, t.selectionEnd, prefix);
    setLocalValue(next);
    requestAnimationFrame(() => { t.focus(); t.setSelectionRange(selStart, selEnd); });
  };

  useEffect(() => {
    if (isEditing) return;
    setLocalValue(data.description || '');
  }, [data.description, isEditing]);

  // Open modal when triggered from NodeInfoBar
  useEffect(() => {
    if (data.isEditing) {
      setShowModal(true);
      updateNode(id, { isEditing: false });
    }
  }, [data.isEditing, id, updateNode]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setIsEditing(true);
    setTimeout(() => textareaRef.current?.focus(), 50);
  }, []);

  const handleBlur = useCallback(() => {
    setIsEditing(false);
    updateNode(id, { description: localValue });
  }, [id, localValue, updateNode]);

  return (
    <div className="relative group w-full h-full" style={{ minWidth: 180, minHeight: 80 }}>
      {selected && !hasMultiSelection && (
        <motion.div
          initial={{ opacity: 0, y: 6, scale: 0.92 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          transition={{ duration: 0.18, ease: 'easeOut' }}
          className="absolute -top-12 left-1/2 -translate-x-1/2 flex items-center gap-0.5 px-1.5 py-1 rounded-2xl bg-[var(--canvas-panel)] shadow-lg border border-[var(--canvas-node-border)] z-10"
          onMouseDown={(e) => e.stopPropagation()}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => setShowModal(true)}
            className="p-2 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors"
            title="展开编辑"
          >
            <Maximize2 size={14} strokeWidth={1.6} />
          </button>
          <button
            onClick={() => openCanvasNodeInAgent(id)}
            className="flex items-center gap-1 px-2 py-2 rounded-lg hover:bg-[var(--canvas-controls-hover)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] transition-colors"
            title="把当前文本节点交给 Agent 操作"
          >
            <Bot size={14} strokeWidth={1.6} /><span className="text-[10px]">Agent</span>
          </button>
          <div className="w-px h-5" style={{ backgroundColor: 'var(--canvas-node-border)' }} />
          <button
            onClick={() => deleteNode(id)}
            className="p-2 rounded-lg hover:bg-[rgba(255,97,99,0.15)] text-[var(--canvas-text-2)] hover:text-red-500 transition-colors"
            title="删除"
          >
            <Trash2 size={14} strokeWidth={1.6} />
          </button>
        </motion.div>
      )}

      
      {/* 节点外左上角标题 */}
      <div className="absolute -top-6 left-0.5 flex items-center gap-1.5 pointer-events-none">
        <FileText size={11} className="text-[var(--canvas-text-3)]" />
        <span className="text-[11px] text-[var(--canvas-text-3)] font-medium">Text</span>
      </div>


      {selected && (
        <NodeResizer
          color="#a8a8a8"
          isVisible={selected}
          minWidth={120}
          minHeight={60}
          handleStyle={{ backgroundColor: '#a8a8a8', border: '1px solid #141414', borderRadius: '50%', width: 6, height: 6 }}
          lineStyle={{ borderColor: '#a8a8a8', borderWidth: 1, borderStyle: 'dashed' }}
        />
      )}

      <Handle type="target" position={Position.Left} />
      <Handle type="source" position={Position.Right} />

      <div
        className={`rounded-xl min-w-[180px] min-h-[80px] w-full h-full transition-all duration-200 ${
          selected ? 'shadow-[0_0_0_1px_var(--canvas-node-border-selected),0_1px_8px_2px_rgba(255,255,255,0.06)]' : 'shadow-sm hover:shadow-[0_1px_4px_1px_rgba(255,255,255,0.08)]'
        }`}
        style={{ background: 'var(--canvas-node-bg)', border: `1px solid ${selected ? 'var(--canvas-node-border-selected)' : 'var(--canvas-node-border)'}` }}
        onDoubleClick={handleDoubleClick}
      >
        <div className="p-3.5 relative h-full overflow-hidden">
          {/* 沉浸式：无内部标题行（外部 ⊿ Text 标签承担），生成中仅右上角小指示 */}
          {isGenerating && (
            <Loader2 size={12} className="animate-spin text-[var(--canvas-text-2)] absolute top-2.5 right-2.5 z-10" />
          )}

          {isEditing || (selected && !content) ? (
            <div className="relative h-full">
              {fmtBar && (
                <div
                  className="absolute -top-9 left-0 z-20 flex items-center gap-0.5 px-1 py-0.5 rounded-lg nodrag"
                  style={{ background: 'rgba(28,28,32,0.95)', border: '1px solid rgba(255,255,255,0.1)', boxShadow: '0 4px 16px rgba(0,0,0,0.4)' }}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  {([
                    ['B', () => applyWrap('**')],
                    ['I', () => applyWrap('*')],
                    ['S', () => applyWrap('~~')],
                    ['H1', () => applyPrefix('# ')],
                    ['H2', () => applyPrefix('## ')],
                    ['H3', () => applyPrefix('### ')],
                    ['•', () => applyPrefix('- ')],
                    ['1.', () => applyPrefix('1. ')],
                  ] as const).map(([label, fn]) => (
                    <button
                      key={label}
                      onClick={fn}
                      className="min-w-[26px] px-1.5 py-1 rounded text-[11px] font-semibold text-[var(--canvas-text-2)] hover:text-white hover:bg-[rgba(255,255,255,0.1)] transition-colors"
                    >
                      {label}
                    </button>
                  ))}
                </div>
              )}
            <textarea
              ref={textareaRef}
              value={localValue}
              onChange={(e) => setLocalValue(e.target.value)}
              onBlur={handleBlur}
              onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleBlur(); }
              }}
              onMouseDown={(e) => e.stopPropagation()}
              onWheel={(e) => e.stopPropagation()}
              placeholder="点击输入文本..."
              className="nodrag nopan w-full h-full min-h-[64px] text-sm text-[var(--canvas-text-1)] leading-relaxed bg-transparent focus:outline-none resize-none placeholder:text-[var(--canvas-text-3)]"
              rows={3}
              autoFocus
              onSelect={(e) => {
                const t = e.target as HTMLTextAreaElement;
                setFmtBar(t.selectionStart !== t.selectionEnd);
              }}
            />
            </div>
          ) : content ? (
            <div className="cv-md h-full overflow-y-auto pr-1 text-[var(--canvas-text-1)] text-sm leading-relaxed break-words whitespace-normal [overflow-wrap:anywhere]">
              <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
              {isGenerating && <span className="inline-block w-1.5 h-3.5 bg-blue-400 ml-0.5 animate-pulse align-middle rounded-sm" />}
            </div>
          ) : (
            <div className="text-[var(--canvas-text-3)] text-xs italic">双击编辑文本...</div>
          )}
        </div>
      </div>

      <AnimatePresence>
        {showModal && (
          <TextEditorModal
            value={data.generatedContent || data.description || ''}
            onSave={(v) => { updateNode(id, { description: v, generatedContent: v }); setLocalValue(v); }}
            onClose={() => setShowModal(false)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

export default memo(TextNodeComponent);
