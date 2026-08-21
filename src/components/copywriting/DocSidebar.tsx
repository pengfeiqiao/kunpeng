import { Plus, FileText, Trash2, BookOpen } from 'lucide-react';
import { useCopywritingStore } from '@/stores/copywritingStore';
import { buildGuidePrompt } from '@/lib/copywriting/antiAiStyle';

const GUIDES = [
  { label: '广告策划', prompt: buildGuidePrompt('ad') },
  { label: '剧本诊断', prompt: buildGuidePrompt('scriptDoctor') },
  { label: '视频脚本', prompt: buildGuidePrompt('videoScript') },
];

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  if (d < 604_800_000) return `${Math.floor(d / 86_400_000)} 天前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

interface Props {
  onGuideClick: (prompt: string) => void;
  onToggleExperience: () => void;
}

export default function DocSidebar({ onGuideClick, onToggleExperience }: Props) {
  const docs = useCopywritingStore(s => s.docs);
  const activeDocId = useCopywritingStore(s => s.activeDocId);
  const createDoc = useCopywritingStore(s => s.createDoc);
  const setActiveDoc = useCopywritingStore(s => s.setActiveDoc);
  const deleteDoc = useCopywritingStore(s => s.deleteDoc);

  return (
    <div
      className="flex flex-col h-full border-r"
      style={{ width: 220, background: 'var(--cw-sidebar)', borderColor: 'var(--cw-border)' }}
    >
      {/* New doc button */}
      <div className="px-3 pt-3 pb-2">
        <button
          onClick={() => createDoc()}
          className="w-full flex items-center justify-center gap-1.5 py-2 text-[13px] font-medium rounded-md transition-colors"
          style={{
            background: 'var(--cw-text)',
            color: '#FFFFFF',
          }}
          onMouseEnter={e => { e.currentTarget.style.opacity = '0.85'; }}
          onMouseLeave={e => { e.currentTarget.style.opacity = '1'; }}
        >
          <Plus size={14} /> 新建文案
        </button>
      </div>

      {/* Doc list */}
      <div className="flex-1 overflow-y-auto px-2 pb-2">
        {docs.length === 0 ? (
          <p className="text-center py-8 text-[12px]" style={{ color: 'var(--cw-text-muted)' }}>
            还没有文档
          </p>
        ) : (
          docs
            .slice()
            .sort((a, b) => b.updatedAt - a.updatedAt)
            .map(doc => {
              const active = activeDocId === doc.id;
              return (
                <div
                  key={doc.id}
                  onClick={() => setActiveDoc(doc.id)}
                  className="group flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer transition-colors mb-px"
                  style={{
                    background: active ? 'var(--cw-card)' : 'transparent',
                  }}
                  onMouseEnter={e => { if (!active) e.currentTarget.style.background = 'var(--cw-card)'; }}
                  onMouseLeave={e => { if (!active) e.currentTarget.style.background = 'transparent'; }}
                >
                  <FileText size={14} className="shrink-0" style={{ color: active ? 'var(--cw-text)' : 'var(--cw-text-muted)' }} />
                  <div className="flex-1 min-w-0">
                    <p
                      className="text-[13px] truncate"
                      style={{ color: active ? 'var(--cw-text)' : 'var(--cw-text-2)', fontWeight: active ? 500 : 400 }}
                    >
                      {doc.title || '未命名文案'}
                    </p>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-[10px]" style={{ color: 'var(--cw-text-muted)' }}>
                        {relativeTime(doc.updatedAt)}
                      </span>
                      {doc.larkUrl && (
                        <span className="text-[9px] px-1 rounded" style={{ background: 'var(--cw-card)', color: 'var(--cw-text-muted)' }}>
                          飞书
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={(e) => { e.stopPropagation(); deleteDoc(doc.id); }}
                    className="opacity-0 group-hover:opacity-100 p-1 rounded transition-opacity"
                    style={{ color: 'var(--cw-text-muted)' }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              );
            })
        )}
      </div>

      {/* Quick actions */}
      <div className="px-3 pb-2">
        <p className="text-[10px] font-medium uppercase tracking-wider px-0.5 mb-1.5" style={{ color: 'var(--cw-text-muted)' }}>
          快捷入口
        </p>
        <div className="flex flex-wrap gap-1">
          {GUIDES.map(g => (
            <button
              key={g.label}
              onClick={() => onGuideClick(g.prompt)}
              className="px-2 py-1 rounded-md text-[11px] transition-colors"
              style={{ color: 'var(--cw-text-muted)', border: '1px solid var(--cw-border)' }}
              onMouseEnter={e => { e.currentTarget.style.background = 'var(--cw-card)'; e.currentTarget.style.color = 'var(--cw-text-2)'; }}
              onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--cw-text-muted)'; }}
            >
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* Experience library button */}
      <div className="px-3 pb-3 pt-1.5" style={{ borderTop: '1px solid var(--cw-border)' }}>
        <button
          onClick={onToggleExperience}
          className="w-full flex items-center justify-center gap-1.5 py-1.5 mt-1 rounded-md text-[12px] transition-colors"
          style={{ color: 'var(--cw-text-muted)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--cw-card)'; e.currentTarget.style.color = 'var(--cw-text-2)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--cw-text-muted)'; }}
        >
          <BookOpen size={13} /> 写作经验
        </button>
      </div>
    </div>
  );
}
