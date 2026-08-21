import { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Pencil,
  XCircle,
  Zap,
} from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import {
  bootstrapProviders,
  getProvider,
  GLMProvider,
  DeepSeekProvider,
  KimiProvider,
  AnthropicCompatibleProvider,
  ANTHROPIC_PRESETS,
  getAnthropicPreset,
} from '@/lib/agent/providers';
import {
  CHAT_MODELS,
  CHAT_PROVIDER_LABELS,
  decodeChatModel,
  encodeChatModel,
  getDefaultModelId,
} from '@/lib/agent/modelCatalog';

type TestState = 'idle' | 'testing' | 'ok' | 'fail';
type ProviderSettingsMode = 'providers' | 'routing';

interface ProviderMeta {
  id: string;
  displayName: string;
  shortName: string;
  docUrl?: string;
  placeholder?: string;
  defaultBaseUrl: string;
  models: string[];
}

const KNOWN_PROVIDERS: ProviderMeta[] = [
  {
    id: 'glm',
    displayName: '智谱 GLM',
    shortName: 'GLM',
    docUrl: 'https://open.bigmodel.cn/',
    placeholder: '粘贴 GLM API Key',
    defaultBaseUrl: 'https://open.bigmodel.cn/api/anthropic',
    models: ['glm-5.3', 'glm-5.2', 'glm-5.1', 'glm-4.6'],
  },
  {
    id: 'deepseek',
    displayName: 'DeepSeek',
    shortName: 'DS',
    docUrl: 'https://platform.deepseek.com/',
    placeholder: '粘贴 DeepSeek API Key (sk-...)',
    defaultBaseUrl: 'https://api.deepseek.com/anthropic',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash', 'deepseek-v4', 'deepseek-chat', 'deepseek-reasoner'],
  },
  {
    id: 'kimi',
    displayName: 'Kimi',
    shortName: 'K3',
    docUrl: 'https://www.kimi.com/code/console',
    placeholder: '粘贴 Kimi Code API Key',
    defaultBaseUrl: 'https://api.kimi.com/coding/',
    models: ['k3[1m]', 'k3'],
  },
  // 通用 Anthropic 兼容渠道（MiniMax / Qwen / 豆包），元数据与
  // providers/anthropic.ts 的 ANTHROPIC_PRESETS 保持同源。
  ...ANTHROPIC_PRESETS.map((preset) => ({
    id: preset.id,
    displayName: preset.displayName,
    shortName: preset.shortName,
    docUrl: preset.docUrl,
    placeholder: preset.keyPlaceholder,
    defaultBaseUrl: preset.defaultBaseUrl,
    models: preset.models.map((model) => model.id),
  })),
];

function instantiate(meta: ProviderMeta, apiKey: string, baseUrl?: string, modelId?: string) {
  switch (meta.id) {
    case 'glm':
      return new GLMProvider({ apiKey, baseUrl: baseUrl || undefined, modelId: modelId || undefined });
    case 'deepseek':
      return new DeepSeekProvider({ apiKey, baseUrl: baseUrl || undefined, modelId: modelId || undefined });
    case 'kimi':
      return new KimiProvider({ apiKey, baseUrl: baseUrl || undefined, modelId: modelId || undefined });
    default: {
      const preset = getAnthropicPreset(meta.id);
      return preset
        ? new AnthropicCompatibleProvider(preset, { apiKey, baseUrl: baseUrl || undefined, modelId: modelId || undefined })
        : null;
    }
  }
}

function StatusIcon({ state }: { state: TestState }) {
  if (state === 'testing') return <Loader2 size={14} className="animate-spin" />;
  if (state === 'ok') return <CheckCircle2 size={14} className="text-emerald-600" />;
  if (state === 'fail') return <XCircle size={14} className="text-zinc-500" />;
  return <Zap size={14} />;
}

export default function ProviderSettings({ mode = 'providers' }: { mode?: ProviderSettingsMode }) {
  const providerApiKeys = useSettingsStore((s) => s.providerApiKeys);
  const setProviderApiKey = useSettingsStore((s) => s.setProviderApiKey);
  const credentials = useSettingsStore((s) => s.credentials);
  const credentialRefs = useSettingsStore((s) => s.credentialRefs);
  // 读时经凭证注册表解析（优先 credentialId 引用，回退旧 providerApiKeys 字段）
  const resolveProviderKey = (id: string): string =>
    resolveApiKey({ credentials, credentialRefs }, `provider:${id}`, providerApiKeys[id] ?? '');
  const providerBaseUrls = useSettingsStore((s) => s.providerBaseUrls);
  const setProviderBaseUrl = useSettingsStore((s) => s.setProviderBaseUrl);
  const providerModels = useSettingsStore((s) => s.providerModels);
  const setProviderModel = useSettingsStore((s) => s.setProviderModel);
  const providerDefault = useSettingsStore((s) => s.providerDefault);
  const setProviderDefault = useSettingsStore((s) => s.setProviderDefault);
  const providerFallbackChain = useSettingsStore((s) => s.providerFallbackChain);
  const setProviderFallbackChain = useSettingsStore((s) => s.setProviderFallbackChain);
  const deepseekEngine = useSettingsStore((s) => s.deepseekEngine);
  const setDeepseekEngine = useSettingsStore((s) => s.setDeepseekEngine);

  const [selectedProviderId, setSelectedProviderId] = useState<string | null>(null);
  const [showKey, setShowKey] = useState<Record<string, boolean>>({});
  const [testState, setTestState] = useState<Record<string, TestState>>({});
  const [dragId, setDragId] = useState<string | null>(null);

  const reBootstrap = (
    keys: Record<string, string>,
    baseUrls: Record<string, string>,
    models: Record<string, string>,
  ) => {
    const anthropicEntries: Record<string, { apiKey?: string; baseUrl?: string; model?: string }> = {};
    for (const preset of ANTHROPIC_PRESETS) {
      anthropicEntries[preset.id] = {
        apiKey: keys[preset.id],
        baseUrl: baseUrls[preset.id],
        model: models[preset.id],
      };
    }
    bootstrapProviders({
      glmApiKey: keys.glm,
      glmBaseUrl: baseUrls.glm,
      glmModel: models.glm,
      deepseekApiKey: keys.deepseek,
      deepseekBaseUrl: baseUrls.deepseek,
      deepseekModel: models.deepseek,
      kimiApiKey: keys.kimi,
      kimiBaseUrl: baseUrls.kimi,
      kimiModel: models.kimi,
      anthropic: anthropicEntries,
    });
  };

  const handleKeyChange = (id: string, key: string) => {
    setProviderApiKey(id, key);
    reBootstrap({ ...providerApiKeys, [id]: key }, providerBaseUrls, providerModels);
    setTestState((prev) => ({ ...prev, [id]: 'idle' }));
  };

  const handleBaseUrlChange = (id: string, url: string) => {
    setProviderBaseUrl(id, url);
    reBootstrap(providerApiKeys, { ...providerBaseUrls, [id]: url }, providerModels);
    setTestState((prev) => ({ ...prev, [id]: 'idle' }));
  };

  const handleModelChange = (id: string, model: string) => {
    setProviderModel(id, model);
    reBootstrap(providerApiKeys, providerBaseUrls, { ...providerModels, [id]: model });
    setTestState((prev) => ({ ...prev, [id]: 'idle' }));
  };

  const handleTest = async (meta: ProviderMeta) => {
    const key = resolveProviderKey(meta.id);
    if (!key) {
      setTestState((prev) => ({ ...prev, [meta.id]: 'fail' }));
      return;
    }
    setTestState((prev) => ({ ...prev, [meta.id]: 'testing' }));
    try {
      const p = getProvider(meta.id) ?? instantiate(
        meta,
        key,
        providerBaseUrls[meta.id],
        providerModels[meta.id],
      );
      const ok = p?.healthCheck ? await p.healthCheck() : true;
      setTestState((prev) => ({ ...prev, [meta.id]: ok ? 'ok' : 'fail' }));
    } catch {
      setTestState((prev) => ({ ...prev, [meta.id]: 'fail' }));
    }
  };

  const handleDrop = (targetId: string) => {
    if (!dragId || dragId === targetId) return;
    const next = [...providerFallbackChain];
    const from = next.indexOf(dragId);
    const to = next.indexOf(targetId);
    if (from === -1 || to === -1) return;
    next.splice(from, 1);
    next.splice(to, 0, dragId);
    setProviderFallbackChain(next);
    setDragId(null);
  };

  const toggleInChain = (id: string) => {
    setProviderFallbackChain(
      providerFallbackChain.includes(id)
        ? providerFallbackChain.filter((item) => item !== id)
        : [...providerFallbackChain, id],
    );
  };

  if (mode === 'routing') {
    const globalModel = providerModels[providerDefault] || getDefaultModelId(providerDefault);
    const globalSelection = encodeChatModel(providerDefault, globalModel);
    const orderedProviders = [
      ...providerFallbackChain
        .map((id) => KNOWN_PROVIDERS.find((provider) => provider.id === id))
        .filter((provider): provider is ProviderMeta => Boolean(provider)),
      ...KNOWN_PROVIDERS.filter((provider) => !providerFallbackChain.includes(provider.id)),
    ];

    return (
      <div className="space-y-8">
        <section>
          <div className="mb-2.5">
            <h3 className="text-[13px] font-semibold text-zinc-900">默认语言模型</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">普通对话、画布、工坊和剪辑默认继承这里；各工作区可单独覆盖。</p>
          </div>
          <div className="rounded-lg border border-zinc-200 bg-white px-4 py-3.5">
            <select
              value={globalSelection}
              onChange={(event) => {
                const selected = decodeChatModel(event.target.value);
                if (!selected) return;
                setProviderDefault(selected.providerId);
                handleModelChange(selected.providerId, selected.modelId);
              }}
              className="min-w-[280px] rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
            >
              {Object.entries(CHAT_MODELS).map(([providerId, models]) => (
                <optgroup key={providerId} label={CHAT_PROVIDER_LABELS[providerId] || providerId}>
                  {models.map((model) => (
                    <option
                      key={encodeChatModel(providerId, model.value)}
                      value={encodeChatModel(providerId, model.value)}
                      disabled={!resolveProviderKey(providerId).trim()}
                    >
                      {model.label}{resolveProviderKey(providerId).trim() ? '' : '（未配置）'}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </section>

        <section>
          <div className="mb-2.5">
            <h3 className="text-[13px] font-semibold text-zinc-900">语言模型降级链</h3>
            <p className="mt-0.5 text-[11px] text-zinc-500">拖动已启用的服务调整顺序；关闭后不会参与自动切换。</p>
          </div>
          <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
            {orderedProviders.map((meta) => {
              const enabled = providerFallbackChain.includes(meta.id);
              const position = providerFallbackChain.indexOf(meta.id);
              const configured = Boolean(resolveProviderKey(meta.id).trim());
              return (
                <div
                  key={meta.id}
                  draggable={enabled}
                  onDragStart={() => setDragId(meta.id)}
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={() => handleDrop(meta.id)}
                  className={`flex min-h-[68px] items-center gap-3 px-4 py-3 transition-colors ${enabled ? 'bg-white' : 'bg-zinc-50/60'}`}
                >
                  <GripVertical size={15} className={enabled ? 'cursor-grab text-zinc-400' : 'text-zinc-300'} />
                  <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-zinc-200 bg-zinc-50 text-[11px] font-semibold text-zinc-700">
                    {meta.shortName}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-[13px] font-medium text-zinc-900">{meta.displayName}</span>
                      {enabled && <span className="text-[10px] tabular-nums text-zinc-400">顺序 {position + 1}</span>}
                    </div>
                    <div className="mt-0.5 text-[11px] text-zinc-500">
                      {configured ? '已配置密钥' : '未配置密钥，启用后也无法调用'}
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={enabled}
                    onClick={() => toggleInChain(meta.id)}
                    className={`relative h-[22px] w-10 rounded-full transition-colors ${enabled ? 'bg-zinc-900' : 'bg-zinc-200'}`}
                    title={enabled ? '从降级链移除' : '加入降级链'}
                  >
                    <span className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${enabled ? 'translate-x-[21px]' : 'translate-x-[3px]'}`} />
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    );
  }

  const selectedMeta = KNOWN_PROVIDERS.find((provider) => provider.id === selectedProviderId);
  if (selectedMeta) {
    const key = resolveProviderKey(selectedMeta.id);
    const baseUrl = providerBaseUrls[selectedMeta.id] ?? '';
    const model = providerModels[selectedMeta.id] ?? '';
    const shown = showKey[selectedMeta.id] ?? false;
    const state = testState[selectedMeta.id] ?? 'idle';

    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => setSelectedProviderId(null)}
          className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-950"
        >
          <ArrowLeft size={14} />
          返回服务列表
        </button>

        <div className="flex items-center justify-between gap-6">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-sm font-semibold text-zinc-800">
              {selectedMeta.shortName}
            </div>
            <div className="min-w-0">
              <h3 className="text-lg font-semibold text-zinc-950">{selectedMeta.displayName}</h3>
              <p className="mt-0.5 text-xs text-zinc-500">配置密钥、请求地址与默认模型，修改后自动保存。</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => handleTest(selectedMeta)}
            disabled={!key || state === 'testing'}
            className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
          >
            <StatusIcon state={state} />
            {state === 'ok' ? '连接正常' : state === 'fail' ? '连接失败' : '测试连接'}
          </button>
        </div>

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-5 py-4">
            <div className="mb-2 flex items-center justify-between">
              <label className="text-[13px] font-medium text-zinc-900">API Key</label>
              {selectedMeta.docUrl && (
                <a href={selectedMeta.docUrl} target="_blank" rel="noreferrer" className="text-[11px] text-zinc-500 hover:text-zinc-900 hover:underline">
                  获取 API Key
                </a>
              )}
            </div>
            <div className="relative">
              <input
                type={shown ? 'text' : 'password'}
                value={key}
                onChange={(event) => handleKeyChange(selectedMeta.id, event.target.value)}
                placeholder={selectedMeta.placeholder}
                className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 pr-10 font-mono text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
              />
              <button
                type="button"
                onClick={() => setShowKey((prev) => ({ ...prev, [selectedMeta.id]: !prev[selectedMeta.id] }))}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-700"
                title={shown ? '隐藏密钥' : '显示密钥'}
              >
                {shown ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>

          <div className="border-b border-zinc-100 px-5 py-4">
            <label className="mb-2 block text-[13px] font-medium text-zinc-900">请求地址</label>
            <input
              type="text"
              value={baseUrl}
              onChange={(event) => handleBaseUrlChange(selectedMeta.id, event.target.value)}
              placeholder={selectedMeta.defaultBaseUrl}
              className="w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 font-mono text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
            />
            <p className="mt-2 text-[11px] text-zinc-500">留空时使用内置官方地址。</p>
          </div>

          {selectedMeta.id === 'deepseek' && (
            <div className="border-b border-zinc-100 px-5 py-4">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-[13px] font-medium text-zinc-900">Agent 引擎</div>
                  <p className="mt-1 text-[11px] text-zinc-500">
                    Harness 使用 DeepSeek 官方智能体运行时；内置模式保留迁移前的执行链。
                  </p>
                </div>
                <div className="flex shrink-0 rounded-md bg-zinc-100 p-0.5" role="group" aria-label="DeepSeek Agent 引擎">
                  <button
                    type="button"
                    onClick={() => setDeepseekEngine('harness')}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${deepseekEngine === 'harness' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}
                  >
                    Harness
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeepseekEngine('builtin')}
                    className={`rounded px-3 py-1.5 text-xs font-medium transition-colors ${deepseekEngine === 'builtin' ? 'bg-white text-zinc-950 shadow-sm' : 'text-zinc-500 hover:text-zinc-800'}`}
                  >
                    普通模式
                  </button>
                </div>
              </div>
            </div>
          )}

          <div className="px-5 py-4">
            <label className="mb-2 block text-[13px] font-medium text-zinc-900">默认模型</label>
            <div className="flex gap-2">
              <select
                value={model && selectedMeta.models.includes(model) ? model : '__custom__'}
                onChange={(event) => {
                  if (event.target.value !== '__custom__') handleModelChange(selectedMeta.id, event.target.value);
                }}
                className="min-w-[210px] rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
              >
                {selectedMeta.models.map((item) => <option key={item} value={item}>{item}</option>)}
                <option value="__custom__">自定义模型</option>
              </select>
              <input
                type="text"
                value={model}
                onChange={(event) => handleModelChange(selectedMeta.id, event.target.value)}
                placeholder={selectedMeta.models[0]}
                className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2.5 font-mono text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
              />
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-5">
        <div>
          <h3 className="text-[13px] font-semibold text-zinc-900">语言模型服务</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">选择一个服务进入详情。API Key 不再同时铺满页面。</p>
        </div>
        <span className="text-[11px] text-zinc-400">{KNOWN_PROVIDERS.filter((provider) => resolveProviderKey(provider.id).trim()).length} / {KNOWN_PROVIDERS.length} 已配置</span>
      </div>

      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {KNOWN_PROVIDERS.map((meta) => {
          const configured = Boolean(providerApiKeys[meta.id]);
          const state = testState[meta.id] ?? 'idle';
          const model = providerModels[meta.id] || meta.models[0];
          const baseUrl = providerBaseUrls[meta.id] || meta.defaultBaseUrl;
          return (
            <div key={meta.id} className="group flex min-h-[88px] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-zinc-50/70">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-xs font-semibold text-zinc-700">
                {meta.shortName}
              </div>
              <button type="button" onClick={() => setSelectedProviderId(meta.id)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-[14px] font-semibold text-zinc-900">{meta.displayName}</span>
                  <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${configured ? 'bg-zinc-900 text-white' : 'bg-zinc-100 text-zinc-500'}`}>
                    {configured ? '已配置' : '未配置'}
                  </span>
                  {providerDefault === meta.id && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">默认</span>}
                </div>
                <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-zinc-500">
                  <span className="shrink-0 font-mono">{model}</span>
                  <span className="text-zinc-300">·</span>
                  <span className="truncate font-mono">{baseUrl}</span>
                </div>
              </button>
              <button
                type="button"
                onClick={() => handleTest(meta)}
                disabled={!configured || state === 'testing'}
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white hover:text-zinc-800 disabled:opacity-30"
                title="测试连接"
              >
                <StatusIcon state={state} />
              </button>
              <button
                type="button"
                onClick={() => setSelectedProviderId(meta.id)}
                className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              >
                <Pencil size={13} />
                编辑
              </button>
              <ChevronRight size={15} className="text-zinc-300 transition-transform group-hover:translate-x-0.5" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export const PROVIDER_OPTIONS = KNOWN_PROVIDERS.map((provider) => ({
  id: provider.id,
  displayName: provider.displayName,
}));
