import { useState } from 'react';
import { motion } from 'framer-motion';
import { Camera, MessageSquare, Zap } from 'lucide-react';
import { useMemoryStore } from '@/stores/memoryStore';

const PATTERN_ICONS: Record<string, React.ReactNode> = {
  establishing: <Camera size={16} />,
  dialogue: <MessageSquare size={16} />,
  action: <Zap size={16} />,
};

export default function ShotPatternTab() {
  const { shotPatterns, loading } = useMemoryStore();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-20 rounded-xl animate-pulse"
            style={{ backgroundColor: 'rgb(var(--c-border))' }}
          />
        ))}
      </div>
    );
  }

  if (shotPatterns.length === 0) {
    return (
      <div className="text-center py-12 text-sm" style={{ color: 'rgb(var(--c-text-muted))' }}>
        暂无镜头模式数据
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>
        共 {shotPatterns.length} 种镜头模式
      </div>

      {shotPatterns.map((pattern) => {
        const isExpanded = expandedId === pattern.id;
        return (
          <div
            key={pattern.id}
            className="border border-dark-border rounded-xl overflow-hidden transition-colors"
            style={{ backgroundColor: 'rgb(var(--c-card))' }}
          >
            <button
              onClick={() => setExpandedId(isExpanded ? null : pattern.id)}
              className="w-full p-3 flex items-center gap-3 text-left hover:bg-dark-border/30 transition-colors"
            >
              <div
                className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0"
                style={{ backgroundColor: 'rgb(var(--c-border))', color: 'rgb(var(--c-text-muted))' }}
              >
                {PATTERN_ICONS[pattern.id] || <Camera size={16} />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-medium text-sm">{pattern.name}</div>
                {pattern.purpose && (
                  <div className="text-xs text-gray-500 mt-0.5 line-clamp-1">{pattern.purpose}</div>
                )}
              </div>
            </button>

            {isExpanded && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                className="border-t border-dark-border px-3 py-3 space-y-3"
              >
                <pre className="text-xs text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">
                  {pattern.body}
                </pre>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    useMemoryStore.getState().applyShotPattern(pattern.id);
                  }}
                  className="w-full py-1.5 rounded-lg text-xs font-medium transition-colors"
                  style={{
                    backgroundColor: 'rgba(99, 102, 241, 0.15)',
                    color: '#818cf8',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.25)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.15)';
                  }}
                >
                  应用模式
                </button>
              </motion.div>
            )}
          </div>
        );
      })}
    </div>
  );
}
