import { useState } from 'react';
import { motion } from 'framer-motion';
import { invoke } from '@tauri-apps/api/tauri';
import { Clock, ChevronDown, ChevronRight, FileText, FolderOpen } from 'lucide-react';
import { useMemoryStore, type GenerationLogEntry } from '@/stores/memoryStore';

function formatTimestamp(ts: string): string {
  try {
    const parts = ts.match(/^(\d{4})-(\d{2})-(\d{2})-(\d{2})(\d{2})(\d{2})$/);
    if (!parts) return ts;
    return `${parts[1]}-${parts[2]}-${parts[3]} ${parts[4]}:${parts[5]}`;
  } catch {
    return ts;
  }
}

async function revealInFinder(relPath: string) {
  try {
    const home = await invoke<string>('get_home_dir');
    const fullPath = `${home}/${relPath}`;
    await invoke('open_path', { path: fullPath, reveal: true });
  } catch (err) {
    console.error('Failed to open path:', err);
  }
}

function LogEntry({ entry }: { entry: GenerationLogEntry }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="border border-dark-border rounded-xl overflow-hidden transition-colors"
      style={{ backgroundColor: 'rgb(var(--c-card))' }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full p-3 flex items-start gap-3 text-left hover:bg-dark-border/30 transition-colors"
      >
        <FileText size={14} className="mt-0.5 flex-shrink-0" style={{ color: 'rgb(var(--c-text-muted))' }} />
        <div className="flex-1 min-w-0">
          <div className="text-sm truncate">
            {entry.director ? (
              <span className="font-medium">{entry.name.replace(/^[\d-]+-/, '')}</span>
            ) : (
              <span className="font-medium">{entry.name}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <Clock size={10} className="text-gray-500 flex-shrink-0" />
            <span className="text-[11px] text-gray-500">{formatTimestamp(entry.timestamp)}</span>
            {entry.director && (
              <span className="text-[11px] text-gray-500">| {entry.director}</span>
            )}
            {entry.engine && (
              <span className="text-[11px] text-gray-500">| {entry.engine}</span>
            )}
          </div>
        </div>
        <div className="pt-0.5 flex-shrink-0" style={{ color: 'rgb(var(--c-text-muted))' }}>
          {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        </div>
      </button>

      {expanded && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: 'auto', opacity: 1 }}
          className="border-t border-dark-border px-3 py-3 space-y-2"
        >
          {entry.prompt && (
            <div>
              <h4 className="text-[11px] font-medium text-gray-500 mb-1">Prompt</h4>
              <pre className="text-[11px] text-gray-400 whitespace-pre-wrap font-sans leading-relaxed line-clamp-4">
                {entry.prompt}
              </pre>
            </div>
          )}
          {entry.resultPath && (
            <div>
              <h4 className="text-[11px] font-medium text-gray-500 mb-1">产物路径</h4>
              <code className="text-[11px] text-indigo-400 break-all">{entry.resultPath}</code>
            </div>
          )}
          {entry.body && (
            <pre className="text-[11px] text-gray-400 whitespace-pre-wrap font-sans leading-relaxed line-clamp-4">
              {entry.body}
            </pre>
          )}

          <button
            onClick={(e) => {
              e.stopPropagation();
              revealInFinder(entry.path);
            }}
            className="w-full py-1.5 rounded-lg text-xs font-medium flex items-center justify-center gap-1.5 transition-colors"
            style={{
              backgroundColor: 'rgba(99, 102, 241, 0.1)',
              color: '#818cf8',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.2)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'rgba(99, 102, 241, 0.1)';
            }}
          >
            <FolderOpen size={12} />
            在 Finder 中显示
          </button>
        </motion.div>
      )}
    </div>
  );
}

export default function GenerationLogTab() {
  const { generationLogs, loading } = useMemoryStore();

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3].map((i) => (
          <div
            key={i}
            className="h-16 rounded-xl animate-pulse"
            style={{ backgroundColor: 'rgb(var(--c-border))' }}
          />
        ))}
      </div>
    );
  }

  if (generationLogs.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <FileText size={24} style={{ color: 'rgb(var(--c-text-muted))' }} />
        <div className="text-sm" style={{ color: 'rgb(var(--c-text-muted))' }}>
          还没有生成记录
        </div>
        <div className="text-[11px] text-gray-500">
          使用 AIGC 创作功能后，记录将自动出现在这里
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>
        共 {generationLogs.length} 条生成记录
      </div>
      {generationLogs.map((entry) => (
        <LogEntry key={entry.path} entry={entry} />
      ))}
    </div>
  );
}
