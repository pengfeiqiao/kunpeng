import { useEffect, useMemo, useState } from 'react';
import { Bot, Check, CheckCircle2, MessageSquarePlus, Pencil, Trash2, X } from 'lucide-react';
import { nanoid } from 'nanoid';
import { useCopywritingStore } from '@/stores/copywritingStore';
import type { CopyComment, CopyDoc } from '@/lib/copywriting/types';
import type { CopyCommentTarget } from '@/lib/copywriting/commentAnchors';
import { dispatchCopywritingPrompt } from './CopywritingChatPanel';

interface Props {
  doc: CopyDoc;
  target: CopyCommentTarget | null;
  onCancelTarget: () => void;
  onCreated: () => void;
  onJump: (comment: CopyComment) => void;
  onClose: () => void;
}

export default function CommentsPanel({ doc, target, onCancelTarget, onCreated, onJump, onClose }: Props) {
  const addComment = useCopywritingStore(s => s.addComment);
  const updateComment = useCopywritingStore(s => s.updateComment);
  const deleteComment = useCopywritingStore(s => s.deleteComment);
  const [body, setBody] = useState('');
  const [showResolved, setShowResolved] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingBody, setEditingBody] = useState('');

  useEffect(() => {
    setBody('');
  }, [target?.start, target?.end]);

  const comments = useMemo(() => (doc.comments ?? [])
    .filter(comment => showResolved || comment.status === 'open')
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === 'open' ? -1 : 1;
      return a.start - b.start || a.createdAt - b.createdAt;
    }), [doc.comments, showResolved]);

  const openCount = (doc.comments ?? []).filter(comment => comment.status === 'open').length;

  const submit = () => {
    const note = body.trim();
    if (!target || !note) return;
    const now = Date.now();
    addComment(doc.id, {
      id: nanoid(10),
      body: note,
      ...target,
      status: 'open',
      orphaned: false,
      createdAt: now,
      updatedAt: now,
    });
    setBody('');
    onCreated();
  };

  const askAi = (comment: CopyComment) => {
    dispatchCopywritingPrompt(
      `请处理当前文档中的批注 ${comment.id}。先调用 copywriting_get_comments 读取批注和原文位置，再根据批注要求做最小必要修改。正文修改成功后调用 copywriting_resolve_comment 标记这条批注已处理；如果批注意图不清或会改变事实，先询问我，不要自行猜测。`,
      comment.quote,
    );
  };

  const saveEdit = (comment: CopyComment) => {
    const next = editingBody.trim();
    if (next && next !== comment.body) updateComment(doc.id, comment.id, { body: next });
    setEditingId(null);
    setEditingBody('');
  };

  return (
    <aside
      className="flex h-full shrink-0 flex-col border-l bg-white"
      style={{ borderColor: 'var(--cw-border)', width: 'clamp(260px, 26vw, 320px)' }}
    >
      <div className="flex h-12 shrink-0 items-center justify-between border-b px-3" style={{ borderColor: 'var(--cw-border)' }}>
        <div className="flex items-center gap-2">
          <MessageSquarePlus size={14} style={{ color: 'var(--cw-text-2)' }} />
          <span className="text-[13px] font-semibold" style={{ color: 'var(--cw-text)' }}>批注</span>
          <span className="text-[10px]" style={{ color: 'var(--cw-text-muted)' }}>{openCount} 条待处理</span>
        </div>
        <button onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-stone-100" title="关闭批注">
          <X size={14} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {target && (
          <div className="mb-3 rounded-lg border p-2.5" style={{ borderColor: 'var(--cw-border)', background: '#FAFAF9' }}>
            <p className="line-clamp-3 border-l-2 pl-2 text-[11px] leading-relaxed" style={{ color: 'var(--cw-text-2)', borderColor: '#A8A29E' }}>
              {target.quote}
            </p>
            <textarea
              autoFocus
              value={body}
              onChange={event => setBody(event.target.value)}
              onKeyDown={event => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  submit();
                }
              }}
              rows={3}
              className="mt-2 w-full resize-none rounded-md border bg-white px-2.5 py-2 text-[12px] leading-5 outline-none focus:border-stone-400"
              style={{ color: 'var(--cw-text)', borderColor: 'var(--cw-border)' }}
              placeholder="写下修改意见，Cmd+Enter 提交"
            />
            <div className="mt-2 flex items-center justify-end gap-1.5">
              <button onClick={onCancelTarget} className="flex h-7 w-7 items-center justify-center rounded-md hover:bg-stone-200" title="取消">
                <X size={13} />
              </button>
              <button
                onClick={submit}
                disabled={!body.trim()}
                className="flex h-7 items-center gap-1 rounded-md bg-stone-900 px-2.5 text-[11px] font-medium text-white disabled:opacity-35"
              >
                <Check size={13} /> 添加
              </button>
            </div>
          </div>
        )}

        {comments.length === 0 && !target ? (
          <div className="px-3 py-12 text-center">
            <MessageSquarePlus className="mx-auto" size={22} style={{ color: 'var(--cw-text-muted)' }} />
            <p className="mt-3 text-[12px]" style={{ color: 'var(--cw-text-2)' }}>选中文字后点击“批注”</p>
            <p className="mt-1 text-[11px] leading-relaxed" style={{ color: 'var(--cw-text-muted)' }}>批注不会写进正文，可以交给 AI 定向修改。</p>
          </div>
        ) : (
          <div className="space-y-2">
            {comments.map(comment => (
              <div
                key={comment.id}
                className="rounded-lg border p-2.5 transition-colors hover:border-stone-300"
                style={{ borderColor: 'var(--cw-border)', opacity: comment.status === 'resolved' ? 0.62 : 1 }}
              >
                <button onClick={() => onJump(comment)} className="block w-full text-left" disabled={comment.orphaned}>
                  <p className="line-clamp-2 border-l-2 pl-2 text-[10px] leading-relaxed" style={{ color: 'var(--cw-text-muted)', borderColor: comment.orphaned ? '#D6D3D1' : '#78716C' }}>
                    {comment.quote}
                  </p>
                </button>
                {comment.orphaned && comment.status === 'open' && (
                  <p className="mt-1.5 text-[10px]" style={{ color: '#B45309' }}>原文已变化，AI 将根据引用和批注判断位置。</p>
                )}

                {editingId === comment.id ? (
                  <div className="mt-2">
                    <textarea
                      autoFocus
                      value={editingBody}
                      onChange={event => setEditingBody(event.target.value)}
                      rows={3}
                      className="w-full resize-none rounded-md border px-2 py-1.5 text-[12px] leading-5 outline-none focus:border-stone-400"
                      style={{ color: 'var(--cw-text)', borderColor: 'var(--cw-border)' }}
                    />
                    <div className="mt-1 flex justify-end gap-1">
                      <button onClick={() => setEditingId(null)} className="flex h-6 w-6 items-center justify-center rounded hover:bg-stone-100" title="取消"><X size={12} /></button>
                      <button onClick={() => saveEdit(comment)} className="flex h-6 w-6 items-center justify-center rounded bg-stone-900 text-white" title="保存"><Check size={12} /></button>
                    </div>
                  </div>
                ) : (
                  <p className="mt-2 whitespace-pre-wrap text-[12px] leading-5" style={{ color: 'var(--cw-text)' }}>{comment.body}</p>
                )}

                <div className="mt-2 flex items-center justify-between gap-2">
                  {comment.status === 'open' ? (
                    <button
                      onClick={() => askAi(comment)}
                      className="flex items-center gap-1 rounded-md bg-stone-900 px-2 py-1 text-[10px] font-medium text-white"
                    >
                      <Bot size={11} /> 交给 AI 修改
                    </button>
                  ) : (
                    <span className="flex items-center gap-1 text-[10px]" style={{ color: 'var(--cw-text-muted)' }}><CheckCircle2 size={11} /> 已解决</span>
                  )}
                  <div className="flex items-center gap-0.5">
                    {comment.status === 'open' && (
                      <>
                        <button
                          onClick={() => { setEditingId(comment.id); setEditingBody(comment.body); }}
                          className="flex h-6 w-6 items-center justify-center rounded hover:bg-stone-100"
                          title="编辑批注"
                        ><Pencil size={11} /></button>
                        <button
                          onClick={() => updateComment(doc.id, comment.id, { status: 'resolved', resolvedAt: Date.now() })}
                          className="flex h-6 w-6 items-center justify-center rounded hover:bg-stone-100"
                          title="标记为已解决"
                        ><CheckCircle2 size={12} /></button>
                      </>
                    )}
                    <button
                      onClick={() => deleteComment(doc.id, comment.id)}
                      className="flex h-6 w-6 items-center justify-center rounded hover:bg-stone-100"
                      title="删除批注"
                    ><Trash2 size={11} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {(doc.comments ?? []).some(comment => comment.status === 'resolved') && (
        <label className="flex h-10 shrink-0 cursor-pointer items-center gap-2 border-t px-3 text-[11px]" style={{ borderColor: 'var(--cw-border)', color: 'var(--cw-text-muted)' }}>
          <input type="checkbox" checked={showResolved} onChange={event => setShowResolved(event.target.checked)} />
          显示已解决批注
        </label>
      )}
    </aside>
  );
}
