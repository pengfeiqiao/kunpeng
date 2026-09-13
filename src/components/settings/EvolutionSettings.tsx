import { useEffect, useState } from 'react';
import { getEvolutionStatus, runEvolutionReflect } from '@/lib/agent/evolution';

export default function EvolutionSettings() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof getEvolutionStatus>> | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => {
    let alive = true;
    const refresh = () => { void getEvolutionStatus().then((value) => { if (alive) setStatus(value); }); };
    refresh();
    const timer = setInterval(refresh, 5000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const reflect = async () => {
    setBusy(true);
    try { setMessage(await runEvolutionReflect(true) || '自省完成'); }
    catch { setMessage('自省失败，请查看下方状态与模型连接。'); }
    finally { setStatus(await getEvolutionStatus()); setBusy(false); }
  };
  return <section className="mb-6 rounded-lg border border-zinc-200 p-5 text-sm text-zinc-700">
    <h3 className="font-medium text-zinc-900">自进化与经验学习</h3>
    <p className="mt-2">已启用：记录对话、画布、工坊及剪辑任务。每累计 12 条新轨迹自动反思，两次批量反思至少间隔 30 分钟；明确负反馈另行触发反思。</p>
    <p className="mt-2">{status ? `${status.running || busy ? '正在反思' : '等待新经验'} · 待分析 ${status.pending}/${status.threshold} 条 · 已反思 ${status.reflections} 次 · 候选技能 ${status.skills} 个` : '正在读取状态…'}</p>
    {status?.lastAttemptAt && <p className="mt-2">最近尝试：{new Date(status.lastAttemptAt).toLocaleString()}</p>}
    {status?.lastSummary && <p className="mt-2">{status.lastSummary}</p>}
    {status?.lastError && <p role="alert" className="mt-2 text-red-600">最近失败：{status.lastError}</p>}
    {message && <p role="status" className="mt-2">{message}</p>}
    <button disabled={busy || status?.running} onClick={() => void reflect()} className="mt-3 rounded border border-zinc-300 px-3 py-1.5 disabled:opacity-50">立即总结经验</button>
    <p className="mt-3 text-xs text-zinc-500">自进化会总结问题并更新本地记忆与候选技能，下一轮任务加载。软件版本自动升级尚未接入，不会自动修改应用程序或模型权重。</p>
  </section>;
}
