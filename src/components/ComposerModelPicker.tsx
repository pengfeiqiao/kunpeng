import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Image, MessageCircle, Video, Zap } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import { CHAT_MODELS, CHAT_PROVIDER_LABELS } from '@/lib/agent/modelCatalog';

type ModelTab = 'chat' | 'image' | 'video';

const IMAGE_MODELS = [
  { value: 'gpt-image-2', label: 'GPT Image 2', detail: '文字、设计与综合生图' },
  { value: 'seedream-v5-pro', label: '豆包 5 Pro', detail: 'Seedream 5.0 Pro' },
  { value: 'midjourney-v82', label: 'Midjourney V8.2', detail: 'APIMart · 新版审美 · 4 张候选' },
  { value: 'midjourney-v81', label: 'Midjourney V8.1', detail: 'APIMart 通道 · 4 张候选' },
] as const;

const VIDEO_MODELS = [
  { value: 'minimax-h3', label: 'MiniMax H3', detail: '2K 多模态，5-15 秒' },
  { value: 'seedance-2.0', label: 'Seedance 2.0', detail: '高质量多模态视频' },
  { value: 'seedance-2.0-fast', label: 'Seedance 2.0 Fast', detail: '速度优先' },
  { value: 'seedance-2.0-mini', label: 'Seedance 2.0 Mini', detail: '低成本备用' },
  { value: 'seedance-2.5', label: 'Seedance 2.5', detail: '即梦 CLI 新版视频' },
  { value: 'omni-mg-animation', label: 'Omni MG', detail: 'MG 动画与视频包装' },
] as const;

export default function ComposerModelPicker({ disabled }: { disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<ModelTab>('chat');
  const rootRef = useRef<HTMLDivElement>(null);
  const providerDefault = useSettingsStore((s) => s.providerDefault);
  const providerModels = useSettingsStore((s) => s.providerModels);
  const providerApiKeys = useSettingsStore((s) => s.providerApiKeys);
  const credentials = useSettingsStore((s) => s.credentials);
  const credentialRefs = useSettingsStore((s) => s.credentialRefs);
  const setProviderDefault = useSettingsStore((s) => s.setProviderDefault);
  const setProviderModel = useSettingsStore((s) => s.setProviderModel);
  const chatImageModel = useSettingsStore((s) => s.chatImageModel);
  const setChatImageModel = useSettingsStore((s) => s.setChatImageModel);
  const chatVideoModel = useSettingsStore((s) => s.chatVideoModel);
  const setChatVideoModel = useSettingsStore((s) => s.setChatVideoModel);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const currentChatModel = providerModels[providerDefault]
    || CHAT_MODELS[providerDefault]?.[0]?.value
    || providerDefault;
  const currentLabel = useMemo(() => {
    const match = Object.values(CHAT_MODELS).flat().find((item) => item.value === currentChatModel);
    return match?.label ?? currentChatModel;
  }, [currentChatModel]);

  const selectChat = (provider: string, model: string) => {
    setProviderDefault(provider);
    setProviderModel(provider, model);
  };

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        title="选择对话、生图或生视频模型"
        className="flex h-8 max-w-[176px] items-center gap-1.5 rounded-lg bg-white px-2.5 text-[12px] font-medium text-[rgb(var(--c-text))] transition-colors hover:bg-[rgb(var(--c-card))] disabled:opacity-40 dark:bg-transparent"
      >
        <Zap size={14} fill="currentColor" />
        <span className="truncate">{currentLabel}</span>
        <ChevronDown size={13} className="text-[rgb(var(--c-text-muted))]" />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 6, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 6, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full right-0 z-40 mb-2 w-[360px] overflow-hidden rounded-xl border border-[rgb(var(--c-border))] bg-white shadow-2xl dark:bg-[rgb(var(--c-bg))]"
          >
            <div className="grid grid-cols-3 gap-1 p-1.5 border-b border-[rgb(var(--c-border))]">
              {([
                ['chat', MessageCircle, '对话'],
                ['image', Image, '生图'],
                ['video', Video, '生视频'],
              ] as const).map(([value, Icon, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setTab(value)}
                  className={`h-8 flex items-center justify-center gap-1.5 rounded-lg text-xs font-medium transition-colors ${tab === value ? 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text))]' : 'text-[rgb(var(--c-text-muted))] hover:bg-[rgb(var(--c-border))]/60'}`}
                >
                  <Icon size={14} /> {label}
                </button>
              ))}
            </div>

            <div className="max-h-[310px] overflow-y-auto p-2">
              {tab === 'chat' && (() => {
                // 未配置 API Key 的 provider 不出现在选择器里；当前选中项除外
                // （避免 key 被删除后选择器里的当前模型凭空消失）。
                const entries = Object.entries(CHAT_MODELS).map(([provider, models]) => ({
                  provider,
                  models,
                  configured: Boolean(resolveApiKey({ credentials, credentialRefs }, `provider:${provider}`, providerApiKeys[provider] ?? '').trim()),
                }));
                const visible = entries.filter((entry) => entry.configured || entry.provider === providerDefault);
                if (visible.every((entry) => !entry.configured)) {
                  return (
                    <div className="px-3 py-6 text-center text-[12px] text-[rgb(var(--c-text-muted))]">
                      还没有可用的对话模型，请先在 设置 → API 凭证 中配置模型 Key。
                    </div>
                  );
                }
                return visible.map(({ provider, models, configured }) => (
                  <div key={provider} className="mb-2 last:mb-0">
                    <div className="px-2 py-1 text-[11px] font-medium text-[rgb(var(--c-text-muted))]">
                      {CHAT_PROVIDER_LABELS[provider] ?? provider}{configured ? '' : ' · 未配置'}
                    </div>
                    {models.map((model) => {
                      const active = providerDefault === provider && currentChatModel === model.value;
                      return (
                        <ModelRow key={model.value} label={model.label} detail={model.detail} active={active} disabled={!configured} onClick={() => selectChat(provider, model.value)} />
                      );
                    })}
                  </div>
                ));
              })()}
              {tab === 'image' && IMAGE_MODELS.map((model) => (
                <ModelRow key={model.value} {...model} active={chatImageModel === model.value} onClick={() => setChatImageModel(model.value)} />
              ))}
              {tab === 'video' && VIDEO_MODELS.map((model) => (
                <ModelRow key={model.value} {...model} active={chatVideoModel === model.value} onClick={() => setChatVideoModel(model.value)} />
              ))}
            </div>
            {tab !== 'chat' && (
              <div className="px-3 py-2 border-t border-[rgb(var(--c-border))] text-[11px] leading-4 text-[rgb(var(--c-text-muted))]">
                这是普通对话的默认生成偏好。画布和工坊仍以各节点、各镜头自己的选择为准。
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function ModelRow({ label, detail, active, disabled, onClick }: {
  label: string;
  detail: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`w-full min-h-12 px-2.5 py-2 flex items-center gap-2 rounded-lg text-left transition-colors disabled:opacity-40 ${active ? 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text))]' : 'hover:bg-[rgb(var(--c-border))]/60 text-[rgb(var(--c-text))]'}`}
    >
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium truncate">{label}</span>
        <span className="block text-[11px] text-[rgb(var(--c-text-muted))] truncate">{detail}</span>
      </span>
      {active && <Check size={15} className="flex-shrink-0" />}
    </button>
  );
}
