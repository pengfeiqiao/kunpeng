/**
 * ContextUsagePill — 上下文窗口用量指示。
 *
 * 数据来自 chatStore.contextStats（由 agent 循环在流式刷新帧、run 结束、
 * 会话恢复时写入）。让用户对"对话还能装多少"有持续感知：接近自动压缩
 * 阈值时变色预警，避免长任务突然触发整理时毫无预期。
 */

import { useChatStore } from '@/stores/chatStore';

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}k`;
  return String(n);
}

export default function ContextUsagePill({ tone = 'dark' }: { tone?: 'dark' | 'light' }) {
  const stats = useChatStore((s) => s.contextStats);
  if (!stats || stats.maxTokens <= 0) return null;

  const pct = Math.min(100, Math.max(1, Math.round((stats.estimatedTokens / stats.maxTokens) * 100)));
  const quiet = tone === 'light' ? '#6b7280' : 'rgba(255,255,255,0.55)';
  const color = pct >= 85 ? '#ef4444' : pct >= 65 ? '#f59e0b' : quiet;
  const track = tone === 'light' ? 'rgba(0,0,0,0.12)' : 'rgba(255,255,255,0.14)';

  return (
    <span
      className="flex select-none items-center gap-1.5 px-1 text-[10px]"
      style={{ color }}
      title={`当前对话约占用上下文 ${formatTokens(stats.estimatedTokens)} / ${formatTokens(stats.maxTokens)} tokens（${pct}%）。\n占用过高时会自动整理早期历史（近期内容不受影响），也可输入 /compact 手动整理。`}
    >
      <span className="relative h-1 w-8 overflow-hidden rounded-full" style={{ background: track }}>
        <span
          className="absolute inset-y-0 left-0 rounded-full transition-[width] duration-300"
          style={{ width: `${pct}%`, background: color }}
        />
      </span>
      {pct}%
    </span>
  );
}
