import { useState } from 'react';
import { ArrowLeft, RotateCcw, BookOpen, ChevronDown, ChevronRight, Lightbulb, AlertTriangle } from 'lucide-react';
import { useCopywritingStore } from '@/stores/copywritingStore';

interface Props {
  onClose: () => void;
}

function truncate(s: string, max: number): string {
  if (!s || s.length <= max) return s || '';
  return s.slice(0, max) + '…';
}

function formatNotes(notes: string | string[]): string {
  if (Array.isArray(notes)) return notes.join('；');
  return notes || '';
}

function relativeTime(ts: number): string {
  const d = Date.now() - ts;
  if (d < 60_000) return '刚刚';
  if (d < 3_600_000) return `${Math.floor(d / 60_000)} 分钟前`;
  if (d < 86_400_000) return `${Math.floor(d / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function ExperienceCard({ exp }: { exp: { id: string; timestamp: number; docTitle: string; styleNotes: string | string[]; whatWorked: string; whatToImprove: string; tonePreference: string; structurePattern: string; vocabularyHits: string | string[] } }) {
  const [expanded, setExpanded] = useState(false);
  const notes = formatNotes(exp.styleNotes);
  const hasDetail = exp.whatWorked || exp.whatToImprove || exp.tonePreference || exp.structurePattern;

  return (
    <div
      className="rounded-lg border transition-all"
      style={{ borderColor: 'var(--cw-border)', background: 'var(--cw-bg)' }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-start gap-2.5 p-3 text-left"
      >
        <span className="mt-0.5 shrink-0" style={{ color: 'var(--cw-text-muted)' }}>
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[12px] font-medium truncate" style={{ color: 'var(--cw-text)' }}>
              {exp.docTitle || '未命名'}
            </span>
            <span className="text-[10px] shrink-0" style={{ color: 'var(--cw-text-muted)' }}>
              {relativeTime(exp.timestamp)}
            </span>
          </div>
          {notes && (
            <p className="text-[11px] mt-1 leading-relaxed" style={{ color: 'var(--cw-text-2)' }}>
              {expanded ? notes : truncate(notes, 80)}
            </p>
          )}
        </div>
      </button>

      {expanded && hasDetail && (
        <div className="px-3 pb-3 pt-0 ml-[22px] space-y-2">
          {exp.whatWorked && (
            <div className="flex gap-2">
              <Lightbulb size={11} className="mt-0.5 shrink-0" style={{ color: '#059669' }} />
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--cw-text-2)' }}>{exp.whatWorked}</p>
            </div>
          )}
          {exp.whatToImprove && (
            <div className="flex gap-2">
              <AlertTriangle size={11} className="mt-0.5 shrink-0" style={{ color: '#D97706' }} />
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--cw-text-2)' }}>{exp.whatToImprove}</p>
            </div>
          )}
          {exp.tonePreference && (
            <div>
              <p className="text-[10px] font-medium mb-0.5" style={{ color: 'var(--cw-text-muted)' }}>语气偏好</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--cw-text-2)' }}>{exp.tonePreference}</p>
            </div>
          )}
          {exp.structurePattern && (
            <div>
              <p className="text-[10px] font-medium mb-0.5" style={{ color: 'var(--cw-text-muted)' }}>结构手法</p>
              <p className="text-[11px] leading-relaxed" style={{ color: 'var(--cw-text-2)' }}>{exp.structurePattern}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ExperiencePanel({ onClose }: Props) {
  const styleProfile = useCopywritingStore(s => s.styleProfile);
  const experiences = useCopywritingStore(s => s.experiences);

  const hasTone = styleProfile?.toneSpectrum && Object.keys(styleProfile.toneSpectrum).length > 0;
  const hasPatterns = styleProfile?.favoritePatterns && styleProfile.favoritePatterns.length > 0;
  const hasVocab = styleProfile?.vocabulary && styleProfile.vocabulary.length > 0;
  const hasAvoid = styleProfile?.avoidPatterns && styleProfile.avoidPatterns.length > 0;
  const hasProfile = styleProfile && (styleProfile.coreStyle || hasTone || hasPatterns || hasVocab);

  return (
    <div className="flex-1 flex flex-col min-w-0" style={{ background: 'var(--cw-bg)' }}>
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 shrink-0" style={{ borderBottom: '1px solid var(--cw-border)' }}>
        <button
          onClick={onClose}
          className="p-1.5 rounded-lg transition-colors"
          style={{ color: 'var(--cw-text-2)' }}
          onMouseEnter={e => { e.currentTarget.style.background = 'var(--cw-card)'; }}
          onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}
        >
          <ArrowLeft size={16} />
        </button>
        <span className="text-[14px] font-semibold" style={{ color: 'var(--cw-text)' }}>写作经验</span>
        <div className="flex-1" />
        <span className="text-[11px]" style={{ color: 'var(--cw-text-muted)' }}>
          {styleProfile?.totalSessions ?? 0} 次写作 · {experiences.length} 条记录
        </span>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Style Profile */}
        {hasProfile && (
          <div className="px-4 py-4" style={{ borderBottom: '1px solid var(--cw-border)' }}>
            <div className="flex items-center gap-1.5 mb-3">
              <BookOpen size={13} style={{ color: 'var(--cw-text-muted)' }} />
              <span className="text-[12px] font-medium" style={{ color: 'var(--cw-text-muted)' }}>文体画像</span>
            </div>

            {styleProfile?.coreStyle && (
              <p className="text-[12px] leading-relaxed mb-3" style={{ color: 'var(--cw-text-2)' }}>
                {styleProfile.coreStyle}
              </p>
            )}

            {hasPatterns && (
              <div className="mb-3">
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--cw-text-muted)' }}>常用手法</p>
                <div className="space-y-1">
                  {styleProfile!.favoritePatterns.map((p, i) => (
                    <p key={i} className="text-[11px] leading-relaxed pl-2" style={{ color: 'var(--cw-text-2)', borderLeft: '2px solid var(--cw-border)' }}>
                      {p}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {hasTone && (
              <div className="mb-3">
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--cw-text-muted)' }}>语气倾向</p>
                <div className="space-y-1">
                  {Object.entries(styleProfile!.toneSpectrum)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 4)
                    .map(([tone, pct]) => (
                      <div key={tone} className="flex items-start gap-2">
                        <span className="text-[10px] shrink-0 mt-px px-1 py-px rounded" style={{ background: 'var(--cw-card)', color: 'var(--cw-text-muted)' }}>
                          {Math.round(pct * 100)}%
                        </span>
                        <p className="text-[11px] leading-relaxed" style={{ color: 'var(--cw-text-2)' }}>
                          {tone}
                        </p>
                      </div>
                    ))}
                </div>
              </div>
            )}

            {hasVocab && (
              <div className="mb-3">
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--cw-text-muted)' }}>高频表达</p>
                <div className="space-y-0.5">
                  {styleProfile!.vocabulary.slice(0, 10).map((v, i) => (
                    <p key={i} className="text-[11px] leading-relaxed" style={{ color: 'var(--cw-text-2)' }}>
                      <span style={{ color: 'var(--cw-text-muted)' }}>·</span> {v.word}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {hasAvoid && (
              <div>
                <p className="text-[10px] font-medium mb-1" style={{ color: 'var(--cw-text-muted)' }}>待改进</p>
                <div className="space-y-1">
                  {styleProfile!.avoidPatterns.map((p, i) => (
                    <p key={i} className="text-[11px] leading-relaxed pl-2" style={{ color: 'var(--cw-text-2)', borderLeft: '2px solid #FBBF24' }}>
                      {p}
                    </p>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* Experience List */}
        <div className="px-4 py-4">
          <p className="text-[12px] font-medium mb-3" style={{ color: 'var(--cw-text-muted)' }}>经验记录</p>
          {experiences.length === 0 ? (
            <div className="py-8 text-center">
              <p className="text-[12px]" style={{ color: 'var(--cw-text-muted)' }}>
                还没有经验记录。
              </p>
              <p className="text-[11px] mt-1" style={{ color: 'var(--cw-text-muted)' }}>
                在对话中完成一次写作后，AI 会自动总结经验。
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {experiences
                .slice()
                .reverse()
                .slice(0, 30)
                .map(exp => (
                  <ExperienceCard key={exp.id} exp={exp} />
                ))}
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="px-4 py-2.5 flex items-center justify-between" style={{ borderTop: '1px solid var(--cw-border)' }}>
        <button
          className="flex items-center gap-1.5 text-[11px] transition-colors"
          style={{ color: 'var(--cw-text-muted)' }}
          onMouseEnter={e => { e.currentTarget.style.color = 'var(--cw-danger)'; }}
          onMouseLeave={e => { e.currentTarget.style.color = 'var(--cw-text-muted)'; }}
          onClick={() => {
            if (confirm('确定重置所有经验数据？此操作不可恢复。')) {
              // TODO: implement reset
            }
          }}
        >
          <RotateCcw size={11} /> 重置
        </button>
      </div>
    </div>
  );
}
