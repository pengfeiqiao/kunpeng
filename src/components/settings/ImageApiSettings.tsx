import { useCallback, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  Zap,
} from 'lucide-react';
import { nanoid } from 'nanoid';
import {
  IMAGE_PROVIDERS,
  type ImageApiSlot,
  type ImageProvider,
  useSettingsStore,
} from '@/stores/settingsStore';
import { resolveSlotApiKey } from '@/lib/credentials';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';

const providerKeys = Object.keys(IMAGE_PROVIDERS) as ImageProvider[];

export default function ImageApiSettings() {
  const slots = useSettingsStore((state) => state.imageApiSlots);
  const setSlots = useSettingsStore((state) => state.setImageApiSlots);
  const credentials = useSettingsStore((state) => state.credentials);
  const latencyCache = useSettingsStore((state) => state.imageApiLatency);
  const setLatency = useSettingsStore((state) => state.setImageApiLatency);

  const [editingSlotId, setEditingSlotId] = useState<string | null>(null);
  const [showKeys, setShowKeys] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [testingAll, setTestingAll] = useState(false);

  const toggleShowKey = (id: string) => {
    const next = new Set(showKeys);
    next.has(id) ? next.delete(id) : next.add(id);
    setShowKeys(next);
  };

  const addSlot = (provider: ImageProvider) => {
    const info = IMAGE_PROVIDERS[provider];
    const slot: ImageApiSlot = {
      id: nanoid(8),
      label: info.label,
      provider,
      baseUrl: info.baseUrl,
      apiKey: '',
      enabled: true,
      priority: slots.length,
    };
    setSlots([...slots, slot]);
    setEditingSlotId(slot.id);
  };

  const removeSlot = (id: string) => {
    setSlots(slots.filter((slot) => slot.id !== id));
    if (editingSlotId === id) setEditingSlotId(null);
  };

  const updateSlot = (id: string, patch: Partial<ImageApiSlot>) => {
    setSlots(slots.map((slot) => (slot.id === id ? { ...slot, ...patch } : slot)));
  };

  const moveSlot = (fromIndex: number, direction: -1 | 1) => {
    const toIndex = fromIndex + direction;
    if (toIndex < 0 || toIndex >= slots.length) return;
    const next = [...slots];
    [next[fromIndex], next[toIndex]] = [next[toIndex], next[fromIndex]];
    next.forEach((slot, index) => { slot.priority = index; });
    setSlots(next);
  };

  const testOne = useCallback(async (slot: ImageApiSlot) => {
    setTesting((previous) => new Set(previous).add(slot.id));
    try {
      const start = Date.now();
      await tauriFetch(`${slot.baseUrl}/v1/models`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${resolveSlotApiKey(useSettingsStore.getState(), slot)}` },
        responseType: ResponseType.JSON,
        timeout: 15,
      });
      setLatency(slot.id, Date.now() - start);
    } catch {
      setLatency(slot.id, -1);
    } finally {
      setTesting((previous) => {
        const next = new Set(previous);
        next.delete(slot.id);
        return next;
      });
    }
  }, [setLatency]);

  const testAll = useCallback(async () => {
    setTestingAll(true);
    const state = useSettingsStore.getState();
    await Promise.all(slots.filter((slot) => slot.enabled && resolveSlotApiKey(state, slot)).map((slot) => testOne(slot)));
    setTestingAll(false);
  }, [slots, testOne]);

  const sortSlotsByLatency = () => {
    const next = [...slots].sort((first, second) => {
      const firstLatency = latencyCache[first.id]?.latencyMs ?? Number.POSITIVE_INFINITY;
      const secondLatency = latencyCache[second.id]?.latencyMs ?? Number.POSITIVE_INFINITY;
      const firstValue = firstLatency < 0 ? Number.POSITIVE_INFINITY : firstLatency;
      const secondValue = secondLatency < 0 ? Number.POSITIVE_INFINITY : secondLatency;
      return firstValue - secondValue;
    });
    next.forEach((slot, index) => { slot.priority = index; });
    setSlots(next);
  };

  const formatLatency = (id: string) => {
    const entry = latencyCache[id];
    if (!entry) return null;
    return entry.latencyMs < 0 ? '连接失败' : `${entry.latencyMs}ms`;
  };

  const editingSlot = slots.find((slot) => slot.id === editingSlotId);
  if (editingSlot) {
    const latency = formatLatency(editingSlot.id);
    const isTesting = testing.has(editingSlot.id);
    const provider = IMAGE_PROVIDERS[editingSlot.provider];
    const keyShown = showKeys.has(editingSlot.id);
    const effectiveKey = resolveSlotApiKey({ credentials }, editingSlot);

    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => setEditingSlotId(null)}
          className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-950"
        >
          <ArrowLeft size={14} />
          返回生图服务列表
        </button>

        <div className="flex items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700">
              <ImageIcon size={20} />
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-zinc-950">{editingSlot.label || provider.label}</h3>
              <p className="mt-0.5 truncate font-mono text-[11px] text-zinc-500">{editingSlot.baseUrl}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => testOne(editingSlot)}
            disabled={!effectiveKey || isTesting}
            className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
          >
            {isTesting ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
            {latency || '测试连接'}
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="flex items-center justify-between gap-6 border-b border-zinc-100 px-5 py-4">
            <div>
              <div className="text-[13px] font-medium text-zinc-900">服务类型</div>
              <p className="mt-1 text-[11px] text-zinc-500">接口类型由鲲鹏预设，避免错误匹配模型协议。</p>
            </div>
            <span className="rounded-md bg-zinc-100 px-2.5 py-1.5 text-xs font-medium text-zinc-700">{provider.label}</span>
          </div>

          <div className="border-b border-zinc-100 px-5 py-4">
            <label className="mb-2 block text-[13px] font-medium text-zinc-900">引用凭证</label>
            <select
              value={editingSlot.credentialId ?? ''}
              onChange={(event) => updateSlot(editingSlot.id, { credentialId: event.target.value || undefined })}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
            >
              <option value="">不引用（使用下方直填 Key）</option>
              {credentials.map((cred) => (
                <option key={cred.id} value={cred.id}>{cred.label}{cred.baseUrl ? ` · ${cred.baseUrl}` : ''}</option>
              ))}
            </select>
            <p className="mt-2 text-[11px] text-zinc-500">
              {editingSlot.credentialId
                ? '已引用「API 凭证」页中的凭证：改凭证即对所有引用处生效，下方直填 Key 作为回退保留。'
                : '可在「API 凭证」页统一管理密钥后回到这里引用；也可以继续直填。'}
            </p>
          </div>

          <div className="border-b border-zinc-100 px-5 py-4">
            <label className="mb-2 block text-[13px] font-medium text-zinc-900">API Key{editingSlot.credentialId ? '（回退）' : ''}</label>
            <div className="relative">
              <input
                type={keyShown ? 'text' : 'password'}
                value={editingSlot.apiKey}
                onChange={(event) => updateSlot(editingSlot.id, { apiKey: event.target.value })}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 pr-10 font-mono text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
                placeholder={editingSlot.credentialId ? '凭证不可用时回退到此 Key' : '粘贴 API Key'}
              />
              <button
                type="button"
                onClick={() => toggleShowKey(editingSlot.id)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-700"
                title={keyShown ? '隐藏密钥' : '显示密钥'}
              >
                {keyShown ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="flex items-center justify-between gap-6 px-5 py-4">
            <div className="min-w-0">
              <div className="text-[13px] font-medium text-zinc-900">启用此服务</div>
              <p className="mt-1 text-[11px] text-zinc-500">关闭后保留密钥，但不参与生图调用。</p>
            </div>
            <button
              type="button"
              role="switch"
              aria-checked={editingSlot.enabled}
              onClick={() => updateSlot(editingSlot.id, { enabled: !editingSlot.enabled })}
              className={`relative h-[22px] w-10 rounded-full transition-colors ${editingSlot.enabled ? 'bg-zinc-900' : 'bg-zinc-200'}`}
            >
              <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${editingSlot.enabled ? 'translate-x-[21px]' : 'translate-x-[3px]'}`} />
            </button>
          </div>
        </div>

        <div className="flex items-center justify-between rounded-lg border border-zinc-200 bg-white px-4 py-3">
          <p className="text-[11px] text-zinc-500">该服务的接口地址由鲲鹏内置管理，避免误改造成调用失败。</p>
          <button
            type="button"
            onClick={() => removeSlot(editingSlot.id)}
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900"
          >
            <Trash2 size={13} />
            删除服务
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-5">
        <div>
          <h3 className="text-[13px] font-semibold text-zinc-900">生图服务</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">查看通道状态，点“编辑”后再填写该服务的 API Key。</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={testAll}
            disabled={testingAll}
            className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-50"
          >
            {testingAll ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
            全部测速
          </button>
          <button
            type="button"
            onClick={sortSlotsByLatency}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            按速度排序
          </button>
        </div>
      </div>

      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {slots.map((slot, index) => {
          const latency = formatLatency(slot.id);
          const isTesting = testing.has(slot.id);
          const configured = Boolean(resolveSlotApiKey({ credentials }, slot).trim());
          return (
            <div key={slot.id} className="group flex min-h-[86px] items-center gap-3 px-4 py-3 transition-colors hover:bg-zinc-50/70">
              <div className="flex flex-col gap-0.5">
                <button type="button" onClick={() => moveSlot(index, -1)} disabled={index === 0} className="rounded p-0.5 text-zinc-400 hover:bg-white hover:text-zinc-800 disabled:opacity-20" title="上移">
                  <ArrowUp size={13} />
                </button>
                <button type="button" onClick={() => moveSlot(index, 1)} disabled={index === slots.length - 1} className="rounded p-0.5 text-zinc-400 hover:bg-white hover:text-zinc-800 disabled:opacity-20" title="下移">
                  <ArrowDown size={13} />
                </button>
              </div>
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600">
                <ImageIcon size={17} />
              </div>
              <button type="button" onClick={() => setEditingSlotId(slot.id)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-zinc-900">{slot.label || IMAGE_PROVIDERS[slot.provider]?.label}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${configured ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}>{configured ? '已配置' : '未配置'}</span>
                  {!slot.enabled && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">已停用</span>}
                  {latency && <span className={`text-[10px] tabular-nums ${latency === '连接失败' ? 'text-zinc-400' : 'text-emerald-600'}`}>{latency}</span>}
                </div>
                <p className="mt-1 truncate font-mono text-[11px] text-zinc-500">{slot.baseUrl}</p>
              </button>
              <button
                type="button"
                onClick={() => testOne(slot)}
                disabled={isTesting || !resolveSlotApiKey({ credentials }, slot)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white hover:text-zinc-800 disabled:opacity-30"
                title="测速"
              >
                {isTesting ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              </button>
              <button
                type="button"
                onClick={() => setEditingSlotId(slot.id)}
                className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              >
                <Pencil size={13} />
                编辑
              </button>
              <ChevronRight size={15} className="text-zinc-300 transition-transform group-hover:translate-x-0.5" />
            </div>
          );
        })}
        {slots.length === 0 && <div className="px-4 py-10 text-center text-xs text-zinc-400">尚未添加生图服务</div>}
      </div>

      <div>
        <p className="mb-2 text-[11px] font-medium text-zinc-500">添加服务</p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {providerKeys.map((provider) => (
            <button
              key={provider}
              type="button"
              onClick={() => addSlot(provider)}
              className="flex items-center justify-center gap-1.5 rounded-md border border-dashed border-zinc-300 py-2.5 text-xs text-zinc-500 transition-colors hover:border-zinc-400 hover:bg-zinc-50 hover:text-zinc-900"
            >
              <Plus size={14} />
              {IMAGE_PROVIDERS[provider].label}
            </button>
          ))}
        </div>
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        这里只管理服务密钥。具体文生、图生、价格和速度策略在“智能路由”中统一调整，测速结果缓存 1 小时。
      </p>
    </div>
  );
}
