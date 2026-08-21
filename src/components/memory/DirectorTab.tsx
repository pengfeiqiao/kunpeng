import { useState } from 'react';
import { Search } from 'lucide-react';
import { useMemoryStore } from '@/stores/memoryStore';
import DirectorCard from './DirectorCard';

export default function DirectorTab() {
  const { directors, loading, expandedDirectorId, setExpandedDirector, applyDirector } = useMemoryStore();
  const [search, setSearch] = useState('');

  const filtered = search.trim()
    ? directors.filter(
        (d) =>
          d.name.toLowerCase().includes(search.toLowerCase()) ||
          d.tags.some((t) => t.toLowerCase().includes(search.toLowerCase())) ||
          d.description.toLowerCase().includes(search.toLowerCase())
      )
    : directors;

  if (loading) {
    return (
      <div className="space-y-2">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-16 rounded-xl animate-pulse"
            style={{ backgroundColor: 'rgb(var(--c-border))' }}
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'rgb(var(--c-text-muted))' }} />
        <input
          type="text"
          placeholder="搜索导演名称、标签、描述..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full bg-dark-border rounded-lg pl-9 pr-3 py-2 text-sm outline-none focus:ring-1 focus:ring-indigo-500"
          style={{ color: 'rgb(var(--c-text))' }}
        />
      </div>

      {/* Count */}
      <div className="text-xs" style={{ color: 'rgb(var(--c-text-muted))' }}>
        共 {filtered.length} 位导演
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-8 text-sm" style={{ color: 'rgb(var(--c-text-muted))' }}>
          {search ? '没有匹配的导演' : '暂无导演风格数据'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((director) => (
            <DirectorCard
              key={director.id}
              director={director}
              expanded={expandedDirectorId === director.id}
              onToggle={() => setExpandedDirector(director.id)}
              onApply={() => applyDirector(director.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
}
