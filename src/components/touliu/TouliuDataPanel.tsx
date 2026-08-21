import { useTouliuStore } from '@/stores/touliuStore';
import { RefreshCw } from 'lucide-react';

export default function TouliuDataPanel() {
  const dashboard = useTouliuStore((s) => s.dashboard);
  const acct = useTouliuStore((s) => s.getActiveAccount());

  if (!dashboard) {
    return (
      <div className="px-3 pb-3">
        <div className="flex flex-col items-center justify-center py-6 text-[rgb(var(--c-text-muted))]">
          <RefreshCw size={20} className="opacity-30 mb-2" />
          <p className="text-xs">暂无投放数据</p>
          <p className="text-[10px] opacity-60 mt-1">在对话中说"查看投放数据"自动提取</p>
        </div>
      </div>
    );
  }

  const age = Date.now() - dashboard.fetchedAt;
  const ageMin = Math.floor(age / 60000);
  const ageLabel = ageMin < 1 ? '刚刚' : `${ageMin} 分钟前`;

  const kpis = [
    { label: '日消耗', value: `¥${dashboard.totalCost.toLocaleString()}`, color: 'text-red-400' },
    { label: '日预算', value: dashboard.totalBudget === '不限' ? '不限' : `¥${dashboard.totalBudget}`, color: 'text-amber-400' },
    { label: 'CPM', value: `¥${dashboard.totalCpm.toFixed(2)}`, color: 'text-orange-400' },
    { label: '展示', value: dashboard.totalImpressions.toLocaleString(), color: 'text-blue-400' },
    { label: '点击', value: `${dashboard.totalClicks.toLocaleString()}`, sub: `CTR ${dashboard.totalCtr.toFixed(2)}%`, color: 'text-cyan-400' },
    { label: '转化', value: dashboard.totalConversions.toLocaleString(), sub: `成本 ¥${dashboard.totalCpa.toFixed(2)}`, color: 'text-purple-400' },
  ];

  const medals = ['🥇', '🥈', '🥉'];

  return (
    <div className="px-3 pb-3 space-y-2.5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-[rgb(var(--c-text))]">投放数据</span>
          {acct && (
            <span className="text-[10px] text-[rgb(var(--c-text-muted))]">
              {acct.name} ({acct.aadvid})
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {dashboard.balance && (
            <span className="text-[10px] text-amber-400">余额 ¥{dashboard.balance}</span>
          )}
          <span className="text-[10px] text-[rgb(var(--c-text-muted))] opacity-60">{ageLabel}</span>
        </div>
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-6 gap-1.5">
        {kpis.map((k) => (
          <div
            key={k.label}
            className="bg-[rgb(var(--c-bg))] rounded-lg p-1.5 text-center border border-[rgb(var(--c-border))]/40"
          >
            <div className={`text-sm font-semibold ${k.color} leading-tight`}>{k.value}</div>
            {'sub' in k && k.sub && (
              <div className="text-[9px] text-[rgb(var(--c-text-muted))] mt-0.5">{k.sub}</div>
            )}
            <div className="text-[10px] text-[rgb(var(--c-text-muted))] mt-0.5">{k.label}</div>
          </div>
        ))}
      </div>

      {/* Unit table */}
      {dashboard.units.length > 0 && (
        <div className="border border-[rgb(var(--c-border))]/40 rounded-lg overflow-hidden">
          <div className="flex items-center justify-between px-2 py-1.5 bg-[rgb(var(--c-bg))]">
            <span className="text-[10px] font-medium text-[rgb(var(--c-text-muted))]">
              单元排名（共 {dashboard.units.length} 条）
            </span>
          </div>
          <table className="w-full text-[11px]">
            <thead>
              <tr className="bg-[rgb(var(--c-bg))]">
                <th className="text-left px-2 py-1 font-medium text-[rgb(var(--c-text-muted))]">单元</th>
                <th className="text-right px-1.5 py-1 font-medium text-[rgb(var(--c-text-muted))]">消耗</th>
                <th className="text-right px-1.5 py-1 font-medium text-[rgb(var(--c-text-muted))]">CPM</th>
                <th className="text-right px-1.5 py-1 font-medium text-[rgb(var(--c-text-muted))]">CTR</th>
                <th className="text-right px-1.5 py-1 font-medium text-[rgb(var(--c-text-muted))]">转化</th>
                <th className="text-right px-1.5 py-1 font-medium text-[rgb(var(--c-text-muted))]">成本</th>
                <th className="text-center px-1.5 py-1 font-medium text-[rgb(var(--c-text-muted))]">诊断</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.units.slice(0, 10).map((u, i) => (
                <tr key={u.id || i} className="border-t border-[rgb(var(--c-border))]/20">
                  <td className="px-2 py-1 text-[rgb(var(--c-text))] truncate max-w-[120px]">
                    <span className="mr-1">{i < 3 ? medals[i] : ''}</span>
                    {u.name}
                  </td>
                  <td className="px-1.5 py-1 text-right text-red-400 font-medium tabular-nums">
                    {u.cost >= 1 ? u.cost.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 }) : u.cost.toFixed(2)}
                  </td>
                  <td className="px-1.5 py-1 text-right text-[rgb(var(--c-text-muted))] tabular-nums">{u.cpm.toFixed(2)}</td>
                  <td className="px-1.5 py-1 text-right text-[rgb(var(--c-text-muted))] tabular-nums">{u.ctr.toFixed(2)}%</td>
                  <td className="px-1.5 py-1 text-right text-purple-400 tabular-nums">{u.conversions.toLocaleString()}</td>
                  <td className="px-1.5 py-1 text-right text-[rgb(var(--c-text-muted))] tabular-nums">{u.cpa.toFixed(2)}</td>
                  <td className="px-1.5 py-1 text-center">
                    <span className={`inline-block px-1 py-0.5 rounded text-[9px] ${
                      !u.diagnosis || u.diagnosis.includes('正常') || u.diagnosis.includes('暂无')
                        ? 'bg-green-500/10 text-green-400'
                        : u.diagnosis.includes('不起量')
                          ? 'bg-red-500/10 text-red-400'
                          : u.diagnosis.includes('挤压')
                            ? 'bg-yellow-500/10 text-yellow-400'
                            : 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))]'
                    }`}>
                      {u.diagnosis || '-'}
                    </span>
                  </td>
                </tr>
              ))}
              {dashboard.units.length > 10 && (
                <tr className="border-t border-[rgb(var(--c-border))]/20">
                  <td colSpan={7} className="px-2 py-1 text-center text-[10px] text-[rgb(var(--c-text-muted))]">
                    还有 {dashboard.units.length - 10} 条单元未显示
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
