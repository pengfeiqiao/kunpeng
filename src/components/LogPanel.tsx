import { useState, useEffect, useRef, useSyncExternalStore } from 'react';
import { Trash2 } from 'lucide-react';
import { agentLog, type LogLevel } from '@/lib/agent/logger';

type Filter = 'all' | 'warn+error' | 'error';

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: 'text-gray-600',
  info: 'text-gray-400',
  warn: 'text-yellow-400',
  error: 'text-red-400',
};

const LEVEL_LABELS: Record<LogLevel, string> = {
  debug: 'DBG',
  info: 'INF',
  warn: 'WRN',
  error: 'ERR',
};

export default function LogPanel() {
  const entries = useSyncExternalStore(
    agentLog.subscribe,
    agentLog.getEntries,
  );
  const [filter, setFilter] = useState<Filter>('all');
  const bottomRef = useRef<HTMLDivElement>(null);

  const filtered = entries.filter((e) => {
    if (filter === 'all') return true;
    if (filter === 'warn+error') return e.level === 'warn' || e.level === 'error';
    return e.level === 'error';
  });

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [filtered.length]);

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    return `${d.getHours().toString().padStart(2, '0')}:${d.getMinutes().toString().padStart(2, '0')}:${d.getSeconds().toString().padStart(2, '0')}`;
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1">
          {(['all', 'warn+error', 'error'] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className={`px-2.5 py-1 rounded text-xs transition-colors ${
                filter === f
                  ? 'bg-white/10 text-white'
                  : 'text-gray-500 hover:text-gray-300'
              }`}
            >
              {f === 'all' ? '全部' : f === 'warn+error' ? '警告+错误' : '仅错误'}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span>{filtered.length} / {entries.length}</span>
          <button
            onClick={() => agentLog.clear()}
            className="p-1 hover:text-gray-300 transition-colors"
            title="清空日志"
          >
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {/* Log entries */}
      <div className="h-[min(520px,calc(100vh-230px))] overflow-y-auto rounded-lg border border-white/[0.08] font-mono text-xs leading-5"
        style={{ background: '#1c1c1e' }}>
        {filtered.length === 0 ? (
          <div className="flex items-center justify-center h-full text-gray-600">
            暂无日志
          </div>
        ) : (
          <div className="p-2 space-y-0">
            {filtered.map((entry, i) => (
              <div key={i} className="flex gap-2 hover:bg-white/[0.02] px-1 rounded">
                <span className="text-gray-600 flex-shrink-0">{formatTime(entry.ts)}</span>
                <span className={`flex-shrink-0 w-7 ${LEVEL_COLORS[entry.level]}`}>
                  {LEVEL_LABELS[entry.level]}
                </span>
                <span className="text-indigo-400/70 flex-shrink-0">[{entry.tag}]</span>
                <span className={`break-all ${entry.level === 'error' ? 'text-red-300' : 'text-gray-300'}`}>
                  {entry.message}
                  {entry.data !== undefined && (
                    <span className="text-gray-600 ml-1">
                      {typeof entry.data === 'string' ? entry.data : JSON.stringify(entry.data, null, 0)?.slice(0, 200)}
                    </span>
                  )}
                </span>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </div>
    </div>
  );
}
