import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Zap } from 'lucide-react';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey } from '@/lib/credentials';
import {
  CHAT_MODELS,
  CHAT_PROVIDER_LABELS,
  WORKSPACE_SCOPE_LABELS,
  decodeChatModel,
  encodeChatModel,
  getChatModelLabel,
  getDefaultModelId,
  type AgentWorkspaceScope,
} from '@/lib/agent/modelCatalog';
import DeepseekHarnessControl from './DeepseekHarnessControl';

interface Props {
  scope: AgentWorkspaceScope;
  variant?: 'dark' | 'light';
  disabled?: boolean;
}

export default function WorkspaceAgentModelPicker({ scope, variant = 'dark', disabled }: Props) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selection = useSettingsStore((state) => state.workspaceAgentModels[scope] || 'global');
  const setSelection = useSettingsStore((state) => state.setWorkspaceAgentModel);
  const providerDefault = useSettingsStore((state) => state.providerDefault);
  const providerModels = useSettingsStore((state) => state.providerModels);
  const providerApiKeys = useSettingsStore((state) => state.providerApiKeys);
  const credentials = useSettingsStore((state) => state.credentials);
  const credentialRefs = useSettingsStore((state) => state.credentialRefs);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const globalModelId = providerModels[providerDefault] || getDefaultModelId(providerDefault);
  const selectedProviderId = decodeChatModel(selection)?.providerId ?? providerDefault;
  const currentLabel = useMemo(() => {
    if (selection === 'global') return getChatModelLabel(providerDefault, globalModelId);
    const separator = selection.indexOf(':');
    if (separator < 1) return '跟随全局';
    return getChatModelLabel(selection.slice(0, separator), selection.slice(separator + 1));
  }, [globalModelId, providerDefault, selection]);

  const isDark = variant === 'dark';
  const text = isDark ? 'var(--canvas-text-2)' : '#4B5563';
  const strong = isDark ? 'var(--canvas-text-1)' : '#18181B';
  const panel = isDark ? 'rgba(24,24,27,0.99)' : '#FFFFFF';
  const border = isDark ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.09)';
  const hover = isDark ? 'rgba(255,255,255,0.07)' : '#F4F4F5';

  const choose = (value: string) => {
    setSelection(scope, value);
    setOpen(false);
  };

  return (
    <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-hidden">
      <DeepseekHarnessControl providerId={selectedProviderId} variant={variant} disabled={disabled} compact />
      <div ref={rootRef} className="relative min-w-0 flex-1">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className="flex h-7 w-full min-w-0 items-center gap-1 rounded-full px-1.5 text-[10.5px] transition-colors disabled:opacity-40"
        style={{ color: text }}
        title={`${WORKSPACE_SCOPE_LABELS[scope]}助手模型：${selection === 'global' ? '跟随全局' : currentLabel}`}
      >
        <Zap size={11} fill="currentColor" />
        <span className="truncate">{currentLabel}</span>
        <ChevronDown size={9} className="shrink-0" />
      </button>

        {open && (
        <div
          className="absolute bottom-full left-0 z-[70] mb-1.5 w-[278px] overflow-hidden rounded-xl py-1.5 shadow-2xl"
          style={{ background: panel, border: `1px solid ${border}` }}
        >
          <div className="px-3 pb-1.5 pt-1 text-[10px]" style={{ color: text }}>
            {WORKSPACE_SCOPE_LABELS[scope]}助手模型
          </div>
          <button
            type="button"
            onClick={() => choose('global')}
            className="flex w-full items-center gap-2 px-3 py-2 text-left"
            style={{ background: selection === 'global' ? hover : 'transparent' }}
          >
            <span className="flex h-6 w-6 items-center justify-center rounded-md" style={{ background: hover, color: strong }}>
              <Zap size={12} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[11.5px] font-medium" style={{ color: strong }}>跟随全局</span>
              <span className="block truncate text-[9.5px]" style={{ color: text }}>{getChatModelLabel(providerDefault, globalModelId)}</span>
            </span>
            {selection === 'global' && <Check size={13} style={{ color: strong }} />}
          </button>

          <div className="mx-3 my-1 h-px" style={{ background: border }} />
          <div className="max-h-[250px] overflow-y-auto">
            {Object.entries(CHAT_MODELS)
              .map(([providerId, models]) => ({
                providerId,
                models,
                configured: Boolean(resolveApiKey({ credentials, credentialRefs }, `provider:${providerId}`, providerApiKeys[providerId] ?? '').trim()),
              }))
              // 未配置 API Key 的 provider 不列出；当前选中项除外（避免选择
              // 凭空消失）。全部未配置时至少显示当前项并标注未配置。
              .filter((entry) => entry.configured || decodeChatModel(selection)?.providerId === entry.providerId)
              .map(({ providerId, models, configured }) => (
                <div key={providerId} className="py-0.5">
                  <div className="px-3 py-1 text-[9.5px]" style={{ color: text }}>
                    {CHAT_PROVIDER_LABELS[providerId] || providerId}
                  </div>
                  {models.map((model) => {
                    const value = encodeChatModel(providerId, model.value);
                    const active = selection === value;
                    return (
                      <button
                        key={value}
                        type="button"
                        disabled={!configured}
                        onClick={() => choose(value)}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left disabled:opacity-35"
                        style={{ background: active ? hover : 'transparent' }}
                        title={configured ? model.detail : `请先在设置中配置 ${CHAT_PROVIDER_LABELS[providerId] || providerId}`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[11px] font-medium" style={{ color: strong }}>{model.label}</span>
                          <span className="block truncate text-[9px]" style={{ color: text }}>{configured ? model.detail : '未配置 API Key'}</span>
                        </span>
                        {active && <Check size={13} style={{ color: strong }} />}
                      </button>
                    );
                  })}
                </div>
              ))}
          </div>
        </div>
        )}
      </div>
    </div>
  );
}
