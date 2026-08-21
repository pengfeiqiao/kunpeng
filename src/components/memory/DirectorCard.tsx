import { motion } from 'framer-motion';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { DirectorDNA } from '@/stores/memoryStore';

interface DirectorCardProps {
  director: DirectorDNA;
  expanded: boolean;
  onToggle: () => void;
  onApply: () => void;
}

const SCORE_COLORS = {
  gold: '#f59e0b',
  silver: '#9ca3af',
  gray: '#6b7280',
};

function getScoreColor(score: number): string {
  if (score >= 4.8) return SCORE_COLORS.gold;
  if (score >= 4.5) return SCORE_COLORS.silver;
  return SCORE_COLORS.gray;
}

function renderScoreStars(score: number): string {
  const full = Math.round(score);
  return '★'.repeat(full) + '☆'.repeat(5 - full);
}

export default function DirectorCard({ director, expanded, onToggle, onApply }: DirectorCardProps) {
  const scoreColor = getScoreColor(director.score);

  return (
    <div
      className="border border-dark-border rounded-xl overflow-hidden transition-colors"
      style={{ backgroundColor: 'rgb(var(--c-card))' }}
    >
      <button
        onClick={onToggle}
        className="w-full p-3 flex items-start gap-3 text-left hover:bg-dark-border/30 transition-colors"
      >
        {/* Avatar */}
        <div
          className="w-10 h-10 rounded-lg flex items-center justify-center text-sm font-bold flex-shrink-0"
          style={{
            backgroundColor: `${scoreColor}20`,
            color: scoreColor,
          }}
        >
          {director.name.charAt(0)}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-sm">{director.name}</span>
            <span className="text-xs" style={{ color: scoreColor }}>
              {renderScoreStars(director.score)} {director.score.toFixed(1)}
            </span>
          </div>
          <p className="text-xs text-gray-500 mt-0.5 line-clamp-1">{director.description}</p>
          <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
            {director.tags.slice(0, 4).map((tag) => (
              <span
                key={tag}
                className="text-[10px] px-1.5 py-0.5 rounded"
                style={{ backgroundColor: 'rgb(var(--c-border))', color: 'rgb(var(--c-text-muted))' }}
              >
                {tag}
              </span>
            ))}
            {director.usageCount > 0 && (
              <span className="text-[10px] text-gray-500 ml-auto">
                {director.usageCount} 次使用
              </span>
            )}
          </div>
        </div>

        {/* Expand indicator */}
        <div className="pt-1 flex-shrink-0" style={{ color: 'rgb(var(--c-text-muted))' }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {/* Expanded details */}
      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="border-t border-dark-border px-3 py-3 space-y-3"
        >
          {director.visualDNA && (
            <div>
              <h4 className="text-xs font-medium text-gray-400 mb-1">视觉基因</h4>
              <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                {director.visualDNA}
              </pre>
            </div>
          )}

          {director.cameraLanguage && (
            <div>
              <h4 className="text-xs font-medium text-gray-400 mb-1">镜头语言</h4>
              <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                {director.cameraLanguage}
              </pre>
            </div>
          )}

          {director.commonParams && (
            <div>
              <h4 className="text-xs font-medium text-gray-400 mb-1">常用参数</h4>
              <pre className="text-[11px] text-gray-400 whitespace-pre-wrap font-sans leading-relaxed">
                {director.commonParams}
              </pre>
            </div>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              onApply();
            }}
            className="w-full py-1.5 rounded-lg text-xs font-medium transition-colors"
            style={{
              backgroundColor: `${scoreColor}20`,
              color: scoreColor,
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = `${scoreColor}30`;
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = `${scoreColor}20`;
            }}
          >
            应用风格
          </button>
        </motion.div>
      )}
    </div>
  );
}
