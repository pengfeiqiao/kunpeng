import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Loader2,
  RefreshCw,
} from 'lucide-react';
import { open } from '@tauri-apps/api/shell';
import { queryMediaUsage, type MediaUsageSnapshot } from '@/lib/usage/providerUsage';

function statusLabel(item: MediaUsageSnapshot): string {
  if (item.status === 'available') return '实时';
  if (item.status === 'needs_setup') return '需补充信息';
  if (item.status === 'unsupported') return '平台未开放';
  if (item.status === 'unconfigured') return '未配置';
  return '查询失败';
}

function StatusIcon({ status }: { status: MediaUsageSnapshot['status'] }) {
  if (status === 'available') return <CheckCircle2 size={15} className="text-emerald-600" />;
  if (status === 'error') return <AlertCircle size={15} className="text-rose-500" />;
  return <CircleDashed size={15} className="text-zinc-400" />;
}

export default function UsageSettings() {
  const [items, setItems] = useState<MediaUsageSnapshot[]>([]);
  const [loading, setLoading] = useState(false);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    try {
      setItems(await queryMediaUsage());
      setUpdatedAt(Date.now());
    } finally {
      setLoading(false);
    }
  }, [loading]);

  useEffect(() => {
    void refresh();
    // The first query is deliberately mount-only. Balance endpoints should not
    // be polled in the background while the settings page is open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const configuredCount = useMemo(() => items.filter((item) => item.configured).length, [items]);
  const liveCount = useMemo(() => items.filter((item) => item.status === 'available').length, [items]);
  const visibleItems = useMemo(
    () => [...items].sort((a, b) => Number(b.configured) - Number(a.configured)),
    [items],
  );

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-6">
        <div>
          <h3 className="text-[13px] font-semibold text-zinc-900">媒体生成用量</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">
            只读取平台公开的余额接口。未开放查询的服务会明确标记，不会用连接状态推测余额。
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
        >
          {loading ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
          刷新用量
        </button>
      </div>

      <div className="grid grid-cols-3 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="border-r border-zinc-100 px-4 py-4">
          <div className="text-[11px] text-zinc-500">已配置服务</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{configuredCount}</div>
        </div>
        <div className="border-r border-zinc-100 px-4 py-4">
          <div className="text-[11px] text-zinc-500">可实时查询</div>
          <div className="mt-1 text-xl font-semibold tabular-nums text-zinc-950">{liveCount}</div>
        </div>
        <div className="px-4 py-4">
          <div className="text-[11px] text-zinc-500">最后刷新</div>
          <div className="mt-2 text-[12px] font-medium tabular-nums text-zinc-800">
            {updatedAt ? new Date(updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '尚未刷新'}
          </div>
        </div>
      </div>

      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {visibleItems.map((item) => (
          <div key={item.id} className="flex min-h-[82px] items-center gap-3 px-4 py-3.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50">
              <StatusIcon status={item.status} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-[13px] font-semibold text-zinc-900">{item.name}</span>
                <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">{item.category}</span>
                <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  item.status === 'available'
                    ? 'bg-emerald-50 text-emerald-700'
                    : item.status === 'error'
                      ? 'bg-rose-50 text-rose-600'
                      : 'bg-zinc-100 text-zinc-500'
                }`}>
                  {statusLabel(item)}
                </span>
              </div>
              <p className="mt-1 truncate text-[11px] text-zinc-500" title={item.detail}>{item.detail}</p>
              {item.source && <p className="mt-0.5 text-[10px] text-zinc-400">来源：{item.source}</p>}
            </div>
            <div className="min-w-[190px] text-right">
              {item.remaining ? (
                <>
                  <div className="text-[15px] font-semibold tabular-nums text-zinc-950">{item.remaining}</div>
                  <div className="mt-0.5 text-[10px] tabular-nums text-zinc-500">
                    {[item.used, item.secondary].filter(Boolean).join(' · ')}
                  </div>
                </>
              ) : (
                <div className="text-[11px] text-zinc-400">{item.configured ? '余额不可直接读取' : '未配置密钥'}</div>
              )}
            </div>
            {item.docsUrl && (
              <button
                type="button"
                onClick={() => void open(item.docsUrl!)}
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-800"
                title="查看平台或接口说明"
              >
                <ExternalLink size={14} />
              </button>
            )}
          </div>
        ))}
        {loading && items.length === 0 && (
          <div className="flex items-center justify-center gap-2 px-4 py-14 text-xs text-zinc-500">
            <Loader2 size={15} className="animate-spin" />
            正在读取各平台余额
          </div>
        )}
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        余额仅在进入本页或手动刷新时查询，不会后台轮询。平台返回的币种与积分单位保持原样，鲲鹏不会自行换算成预估金额。
      </p>
    </div>
  );
}
