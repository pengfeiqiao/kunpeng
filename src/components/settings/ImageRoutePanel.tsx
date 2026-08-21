import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
import {
  clearImageRouteMetrics,
  getImageRouteDefinitions,
  getImageRouteOrder,
  getImageRouteStats,
  moveImageRoute,
  sortImageRouteOrder,
  type ImageRouteDefinition,
  type ImageRouteSortMode,
} from '@/lib/imageRouter/metrics';
import { runGeneration } from '@/lib/canvasGen';

const TEST_REF =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAIAAAACACAIAAABMXPacAAABUUlEQVR4nO3asQ2DMBAEQZL/f2sHkWqJCMV4YBna6iooqGn2zLwzAMyZ3wfgHwHBBBAEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEAAAQQQQAABBBBAAAEEEEDgB+7nB9kYn3nDAAAAAElFTkSuQmCC';

async function getTestRefPath(): Promise<string> {
  const [{ writeBinaryFile, createDir }, { homeDir }] = await Promise.all([
    import('@tauri-apps/api/fs'),
    import('@tauri-apps/api/path'),
  ]);
  const home = await homeDir();
  const dir = `${home}.kunpeng/tmp`;
  await createDir(dir, { recursive: true }).catch(() => {});
  const path = `${dir}/image-route-test.png`;
  const b64 = TEST_REF.split(',')[1] ?? '';
  await writeBinaryFile(path, Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  return path;
}

function typeLabel(route?: ImageRouteDefinition): string {
  if (!route) return '';
  const mode = route.mode === 'image-to-image' ? '图生' : '文生';
  const tier = route.tier === 'cheap' ? '低价' : '普通';
  const model = route.model === 'seedream-v5-pro' ? 'S5' : 'GPT';
  return `${model} ${tier}${mode}`;
}

function verdict(successRate: number, avgMs: number): string {
  if (successRate >= 0.95 && avgMs > 0 && avgMs < 45000) return '又快又稳';
  if (successRate >= 0.9) return '挺稳';
  if (successRate >= 0.65) return '偶尔掉链子';
  return '先别放前面';
}

export default function ImageRoutePanel() {
  const [tick, setTick] = useState(0);
  const [testing, setTesting] = useState(false);
  const [sorting, setSorting] = useState<ImageRouteSortMode>('cheap-first');
  const sortedOnceRef = useRef(false);
  const stats = useMemo(() => getImageRouteStats(), [tick]);
  const definitions = useMemo(() => getImageRouteDefinitions(), [tick]);
  const order = useMemo(() => getImageRouteOrder(), [tick]);
  const statById = new Map(stats.map((s) => [s.routeId, s]));
  const routeById = new Map(definitions.map((r) => [r.id, r]));

  const applySort = (mode: ImageRouteSortMode) => {
    setSorting(mode);
    sortImageRouteOrder(mode);
    setTick((x) => x + 1);
  };

  useEffect(() => {
    if (sortedOnceRef.current || stats.length === 0) return;
    sortedOnceRef.current = true;
    sortImageRouteOrder(sorting);
    setTick((x) => x + 1);
  }, [sorting, stats.length]);

  const runRouteTest = async (routeId: string, testRefPath: string) => {
    const route = routeById.get(routeId);
    if (!route) return;
    const isI2I = route.mode === 'image-to-image';
    const engineId = route.model === 'seedream-v5-pro'
      ? (isI2I ? 'seedream-v5-pro-i2i' : 'seedream-v5-pro')
      : (isI2I ? 'gpt-image-2-i2i' : 'gpt-image-2');
    await runGeneration({
      engineId,
      forceChannel: routeId,
      prompt: isI2I
        ? '保留参考图的主体轮廓，改成干净的产品摄影风格，自然光，背景简洁'
        : '一只白色陶瓷杯放在木桌上，自然光，简洁产品摄影',
      referenceUrls: isI2I ? [testRefPath] : undefined,
      params: { aspectRatio: '1:1', resolution: '1k', quality: 'low' },
    });
    setTick((x) => x + 1);
  };

  const testAll = async () => {
    if (testing) return;
    setTesting(true);
    try {
      const testRefPath = await getTestRefPath();
      const queue = order.filter((routeId) => routeById.has(routeId));
      let cursor = 0;
      const worker = async () => {
        while (cursor < queue.length) {
          const routeId = queue[cursor++];
          await runRouteTest(routeId, testRefPath);
        }
      };
      await Promise.all(Array.from({ length: Math.min(3, queue.length) }, () => worker()));
      sortImageRouteOrder(sorting);
    } finally {
      setTesting(false);
      setTick((x) => x + 1);
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <button
          onClick={() => void testAll()}
          disabled={testing}
          className="flex items-center justify-center gap-1.5 rounded-md bg-zinc-900 px-3 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-50"
        >
          {testing ? '测试中…' : '测试全部'}
        </button>
        <div className="flex items-center gap-2">
        <button
          onClick={() => applySort('cheap-first')}
          className={`flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-xs transition-colors ${
            sorting === 'cheap-first' ? 'border-zinc-300 bg-zinc-100 text-zinc-900' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
          }`}
        >
          <SlidersHorizontal size={13} />
          低价优先排序
        </button>
        <button
          onClick={() => applySort('speed-first')}
          className={`flex items-center justify-center gap-1.5 rounded-md border px-2.5 py-2 text-xs transition-colors ${
            sorting === 'speed-first' ? 'border-zinc-300 bg-zinc-100 text-zinc-900' : 'border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50'
          }`}
        >
          <SlidersHorizontal size={13} />
          速度优先排序
        </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={() => setTick((x) => x + 1)}
          className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
        >
          <RefreshCw size={13} />
          刷新
        </button>
        <button
          onClick={() => { clearImageRouteMetrics(); setTick((x) => x + 1); }}
          className="flex items-center justify-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-700 hover:bg-zinc-50"
        >
          <Trash2 size={13} />
          清空
        </button>
      </div>

      <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
        <div className="grid grid-cols-[1.2fr_56px_0.55fr_0.65fr_0.8fr_52px] gap-2 px-3 py-2 text-[11px] text-zinc-500 bg-zinc-50 border-b border-zinc-100">
          <span>通道</span>
          <span>类型</span>
          <span>成功</span>
          <span>用时</span>
          <span>建议</span>
          <span className="text-right">排序</span>
        </div>
        {order.map((routeId, idx) => {
          const route = routeById.get(routeId);
          const s = statById.get(routeId);
          const successRate = s?.successRate ?? 0;
          const avgMs = s?.avgMs ?? 0;
          return (
          <div key={routeId} className="grid grid-cols-[1.2fr_56px_0.55fr_0.65fr_0.8fr_52px] gap-2 items-center px-3 py-2 text-[11px] border-b border-zinc-100 last:border-b-0">
            <span className="text-zinc-800 truncate">{route?.label ?? routeId}</span>
            <span className="text-zinc-500 whitespace-nowrap">{typeLabel(route)}</span>
            <span className="text-zinc-600">{s ? `${s.successes}/${s.attempts}` : '-'}</span>
            <span className="font-mono text-zinc-700">{avgMs ? `${(avgMs / 1000).toFixed(1)}s` : '-'}</span>
            <span className={successRate >= 0.9 ? 'text-emerald-600' : successRate >= 0.65 ? 'text-amber-600' : 'text-zinc-500'}>
              {s ? verdict(successRate, avgMs) : '待观察'}
            </span>
            <span className="flex justify-end gap-1">
              <button
                onClick={() => { moveImageRoute(routeId, -1); setTick((x) => x + 1); }}
                disabled={idx === 0}
                className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 disabled:opacity-25"
                title="上移"
              >
                <ChevronUp size={12} />
              </button>
              <button
                onClick={() => { moveImageRoute(routeId, 1); setTick((x) => x + 1); }}
                disabled={idx === order.length - 1}
                className="p-1 rounded text-zinc-400 hover:text-zinc-700 hover:bg-zinc-50 disabled:opacity-25"
                title="下移"
              >
                <ChevronDown size={12} />
              </button>
            </span>
          </div>
        );})}
      </div>

      <p className="text-[11px] text-zinc-500 leading-relaxed">
        所有接口都会一起记录速度和成功情况。生成记录越多，排序越接近实际使用表现。
      </p>
    </div>
  );
}
