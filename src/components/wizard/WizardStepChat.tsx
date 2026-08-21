import { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useSettingsStore } from '@/stores';
import { resolveApiKey } from '@/lib/credentials';
import { channelsByKind } from '@/lib/channels/catalog';
import { testChatProviderKey } from '@/lib/channels/testConnection';
import { ChannelCard, KeyInput, TestButton, type TestState } from './wizardUi';

const PLACEHOLDERS: Record<string, string> = {
  deepseek: 'sk-...',
  glm: 'xxxxxxxx.xxxxxxxx',
  kimi: '粘贴 Kimi Code API Key',
};

export default function WizardStepChat() {
  const providerApiKeys = useSettingsStore((s) => s.providerApiKeys);
  const glmApiKey = useSettingsStore((s) => s.glmApiKey);
  const credentials = useSettingsStore((s) => s.credentials);
  const credentialRefs = useSettingsStore((s) => s.credentialRefs);
  const setProviderApiKey = useSettingsStore((s) => s.setProviderApiKey);

  // DeepSeek 默认展开，GLM / Kimi 手风琴收起
  const [openId, setOpenId] = useState<string>('deepseek');
  const [testState, setTestState] = useState<Record<string, TestState>>({});

  const resolveKey = (id: string): string =>
    resolveApiKey(
      { credentials, credentialRefs },
      `provider:${id}`,
      providerApiKeys[id] ?? (id === 'glm' ? glmApiKey : ''),
    );

  const handleTest = async (id: string) => {
    const key = resolveKey(id);
    if (!key.trim()) {
      setTestState((prev) => ({ ...prev, [id]: 'fail' }));
      return;
    }
    setTestState((prev) => ({ ...prev, [id]: 'testing' }));
    const ok = await testChatProviderKey(id, key);
    setTestState((prev) => ({ ...prev, [id]: ok ? 'ok' : 'fail' }));
  };

  return (
    <div className="space-y-3">
      <p className="text-[13px] leading-relaxed text-zinc-600">
        主聊天模型是所有助手的核心大脑。不配也能跳过——跳过=主聊天暂不可用，其余页面仍可浏览，
        之后可在 设置 → 语言模型 里补配。
      </p>

      {channelsByKind('chat').map((channel) => {
        const open = openId === channel.id;
        const key = resolveKey(channel.id);
        return (
          <div key={channel.id} className="min-w-0">
            {open ? (
              <ChannelCard
                title={channel.label}
                url={channel.url}
                purpose={channel.purpose}
                note={channel.note}
                badge={channel.id === 'deepseek' ? '默认选中' : undefined}
              >
                <div className="flex min-w-0 items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <KeyInput
                      value={key}
                      onChange={(v) => setProviderApiKey(channel.id, v)}
                      placeholder={PLACEHOLDERS[channel.id] ?? '粘贴 API Key'}
                      onInput={() => setTestState((prev) => ({ ...prev, [channel.id]: 'idle' }))}
                    />
                  </div>
                  <TestButton
                    state={testState[channel.id] ?? 'idle'}
                    disabled={!key.trim()}
                    onClick={() => void handleTest(channel.id)}
                  />
                </div>
              </ChannelCard>
            ) : (
              <button
                type="button"
                onClick={() => setOpenId(channel.id)}
                className="flex w-full min-w-0 items-center gap-2 rounded-lg border border-zinc-200 bg-white px-4 py-3 text-left transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              >
                <ChevronRight size={14} className="shrink-0 text-zinc-400" />
                <span className="text-[13px] font-medium text-zinc-900">{channel.label}</span>
                <span className="truncate text-[11px] text-zinc-500">{channel.purpose}</span>
                {key.trim() && (
                  <span className="ml-auto shrink-0 rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">
                    已配置
                  </span>
                )}
              </button>
            )}
          </div>
        );
      })}

      {openId !== '' && (
        <button
          type="button"
          onClick={() => setOpenId('')}
          className="flex items-center gap-1 text-[11px] text-zinc-500 transition-colors hover:text-zinc-900"
        >
          <ChevronDown size={12} />
          全部收起
        </button>
      )}
    </div>
  );
}
