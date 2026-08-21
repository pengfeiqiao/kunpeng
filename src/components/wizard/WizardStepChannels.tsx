import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { IMAGE_PROVIDERS, useSettingsStore, type ImageApiSlot, type ImageProvider } from '@/stores/settingsStore';
import { resolveApiKey, resolveSlotApiKey } from '@/lib/credentials';
import { channelsByKind, CHANNELS_DISCLAIMER, type ChannelKind } from '@/lib/channels/catalog';
import { mergeArkModels } from '@/lib/channels/arkModels';
import { testArkKey, testModelsEndpoint } from '@/lib/channels/testConnection';
import { ChannelCard, KeyInput, TestButton, inputCls, type TestState } from './wizardUi';

type SettingsSnapshot = ReturnType<typeof useSettingsStore.getState>;

/** 每个渠道卡：key 从哪读、写到哪、怎么测。全部走 settingsStore 现有 setter（自动镜像进凭证注册表）。 */
function resolveChannelKey(state: SettingsSnapshot, channelId: string): string {
  const imageProvider = channelId as ImageProvider;
  if (IMAGE_PROVIDERS[imageProvider]) {
    const slot = state.imageApiSlots.find((s) => s.provider === imageProvider);
    return slot ? resolveSlotApiKey(state, slot) : '';
  }
  switch (channelId) {
    case 'ark':
    case 'ark-video':
      return resolveApiKey(state, 'ark', state.arkApiKey);
    case 'omni-apimart':
      return resolveApiKey(state, 'omniApimart', state.omniApimartApiKey);
    case 'runninghub':
      return resolveApiKey(state, 'runninghub', state.runninghubApiKey);
    case 'kuaizi':
      return resolveApiKey(state, 'kuaizi', state.kuaiziApiKey);
    default:
      return '';
  }
}

function writeChannelKey(state: SettingsSnapshot, channelId: string, key: string): void {
  const imageProvider = channelId as ImageProvider;
  const providerInfo = IMAGE_PROVIDERS[imageProvider];
  if (providerInfo) {
    const slots = state.imageApiSlots;
    const existing = slots.find((s) => s.provider === imageProvider);
    if (existing) {
      state.setImageApiSlots(slots.map((s) => (s.id === existing.id ? { ...s, apiKey: key } : s)));
    } else {
      const slot: ImageApiSlot = {
        id: `wizard-${imageProvider}`,
        label: providerInfo.label,
        provider: imageProvider,
        baseUrl: providerInfo.baseUrl,
        apiKey: key,
        enabled: true,
        priority: slots.length,
      };
      state.setImageApiSlots([...slots, slot]);
    }
    return;
  }
  switch (channelId) {
    case 'ark':
    case 'ark-video':
      state.setArkApiKey(key);
      break;
    case 'omni-apimart':
      state.setOmniApimartApiKey(key);
      break;
    case 'runninghub':
      state.setRunninghubApiKey(key);
      break;
    case 'kuaizi':
      state.setKuaiziApiKey(key);
      break;
  }
}

function testChannelKey(state: SettingsSnapshot, channelId: string, key: string): Promise<boolean> {
  const imageProvider = channelId as ImageProvider;
  const providerInfo = IMAGE_PROVIDERS[imageProvider];
  if (providerInfo) return testModelsEndpoint(providerInfo.baseUrl, key);
  switch (channelId) {
    case 'ark':
    case 'ark-video':
      return testArkKey(key);
    case 'omni-apimart':
      return testModelsEndpoint(state.omniBaseUrl || 'https://api.apimart.ai', key);
    case 'runninghub':
      return testModelsEndpoint('https://www.runninghub.cn', key);
    case 'kuaizi':
      return testModelsEndpoint('https://aiopenapi.kuaizi.cn', key);
    default:
      return Promise.resolve(false);
  }
}

/** 自定义渠道 baseUrl → 内置 provider 类型推断（与 settingsStore v12 迁移同一套规则）。 */
function inferImageProvider(baseUrl: string): ImageProvider {
  if (baseUrl.includes('aihubmix') || baseUrl.includes('inferera')) return 'aihubmix';
  if (baseUrl.includes('zexapi')) return 'zexapi';
  return 'dmxapi';
}

/** Ark 卡的模型清单：从 arkModels 注册表（含设置页同步缓存）动态渲染，不写死。 */
function ArkModelTags({ kind }: { kind: 'image' | 'video' }) {
  const cache = useSettingsStore((s) => s.arkModelsCache);
  const models = mergeArkModels(cache).filter((m) => m.modality === kind && m.status === 'published');
  if (models.length === 0) return null;
  return (
    <div className="mt-2 flex flex-wrap gap-1.5">
      {models.slice(0, 6).map((m) => (
        <span key={m.id} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
          {m.label}
        </span>
      ))}
      {models.length > 6 && (
        <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
          等 {models.length} 个模型
        </span>
      )}
    </div>
  );
}

export default function WizardStepChannels({ kind }: { kind: Extract<ChannelKind, 'image' | 'video'> }) {
  // 整店订阅：key 输入每击键都落 store，需要跟随重渲染
  const settings = useSettingsStore();
  const [testState, setTestState] = useState<Record<string, TestState>>({});
  const [customOpen, setCustomOpen] = useState(false);
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customKey, setCustomKey] = useState('');

  const channels = channelsByKind(kind);

  const handleTest = async (channelId: string) => {
    const key = resolveChannelKey(settings, channelId);
    if (!key.trim()) {
      setTestState((prev) => ({ ...prev, [channelId]: 'fail' }));
      return;
    }
    setTestState((prev) => ({ ...prev, [channelId]: 'testing' }));
    const ok = await testChannelKey(settings, channelId, key);
    setTestState((prev) => ({ ...prev, [channelId]: ok ? 'ok' : 'fail' }));
  };

  const addCustomChannel = () => {
    const baseUrl = customBaseUrl.trim().replace(/\/+$/, '');
    if (!baseUrl) return;
    const provider = inferImageProvider(baseUrl);
    const slot: ImageApiSlot = {
      id: `wizard-custom-${Date.now().toString(36)}`,
      label: '自定义渠道',
      provider,
      baseUrl,
      apiKey: customKey.trim(),
      enabled: true,
      priority: settings.imageApiSlots.length,
    };
    settings.setImageApiSlots([...settings.imageApiSlots, slot]);
    setCustomBaseUrl('');
    setCustomKey('');
    setCustomOpen(false);
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-zinc-600">
        {kind === 'image'
          ? '图片能力支持多渠道接入，以下是当前代码里已内置的渠道，任选一个配 Key 即可，也可全部跳过。'
          : '视频能力支持多渠道接入，任选一个配 Key 即可，也可全部跳过。'}
      </p>

      {channels.map((channel) => {
        const isArk = channel.id === 'ark' || channel.id === 'ark-video';
        const key = channel.needsKey ? resolveChannelKey(settings, channel.id) : '';
        return (
          <ChannelCard
            key={channel.id}
            title={channel.label}
            url={channel.needsKey ? channel.url : undefined}
            purpose={channel.purpose}
            note={channel.note}
          >
            {isArk && <ArkModelTags kind={kind} />}
            {channel.needsKey ? (
              <div className="flex min-w-0 items-center gap-2">
                <div className="min-w-0 flex-1">
                  <KeyInput
                    value={key}
                    onChange={(v) => writeChannelKey(settings, channel.id, v)}
                    placeholder="粘贴 API Key"
                    onInput={() => setTestState((prev) => ({ ...prev, [channel.id]: 'idle' }))}
                  />
                </div>
                <TestButton
                  state={testState[channel.id] ?? 'idle'}
                  disabled={!key.trim()}
                  onClick={() => void handleTest(channel.id)}
                />
              </div>
            ) : (
              <p className="text-[11px] text-zinc-500">本地方案，无需在此配置。</p>
            )}
          </ChannelCard>
        );
      })}

      {kind === 'image' && (
        <div className="rounded-lg border border-zinc-200 bg-white">
          <button
            type="button"
            onClick={() => setCustomOpen((v) => !v)}
            className="flex w-full items-center gap-2 px-4 py-3 text-left transition-colors hover:bg-zinc-50"
          >
            {customOpen ? (
              <ChevronDown size={14} className="shrink-0 text-zinc-400" />
            ) : (
              <ChevronRight size={14} className="shrink-0 text-zinc-400" />
            )}
            <span className="text-[13px] font-medium text-zinc-900">自定义渠道</span>
            <span className="truncate text-[11px] text-zinc-500">任意 OpenAI 兼容的生图 API</span>
          </button>
          {customOpen && (
            <div className="space-y-2 border-t border-zinc-100 px-4 py-3">
              <input
                type="text"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="Base URL，如 https://example.com"
                className={`${inputCls} font-mono text-xs`}
              />
              <KeyInput value={customKey} onChange={setCustomKey} />
              <div className="flex justify-end">
                <button
                  type="button"
                  onClick={addCustomChannel}
                  disabled={!customBaseUrl.trim()}
                  className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50 disabled:opacity-40"
                >
                  添加渠道
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      <p className="break-words pt-1 text-[11px] leading-relaxed text-zinc-500">
        {kind === 'image'
          ? '以上渠道定义在源码 src/lib/channels/catalog.ts 清单中，你可以自行添加任意 OpenAI 兼容的生图 API。'
          : '新增视频渠道可参照 src/lib/omni/、src/lib/rhtv/ 的 client 结构自行扩展。'}
      </p>
      <p className="break-words text-[11px] leading-relaxed text-zinc-500">{CHANNELS_DISCLAIMER}</p>
    </div>
  );
}
