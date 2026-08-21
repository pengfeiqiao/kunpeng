import { useState } from 'react';
import { useSettingsStore } from '@/stores';
import { resolveApiKey } from '@/lib/credentials';
import { channelsByKind } from '@/lib/channels/catalog';
import { testChatProviderKey } from '@/lib/channels/testConnection';
import { KeyInput, TestButton, type TestState } from '../wizard/wizardUi';

/**
 * 聊天空态补配卡：主聊天没有任何 provider Key 时显示在欢迎屏顶部。
 * 选 provider → 填 key → 测试连接 → 保存，3 步内补上（保存即生效，
 * App 的 providerSettingsSig 副作用会自动重挂 provider）。
 */
export default function ChatKeySetupCard() {
  const credentials = useSettingsStore((s) => s.credentials);
  const credentialRefs = useSettingsStore((s) => s.credentialRefs);
  const providerApiKeys = useSettingsStore((s) => s.providerApiKeys);
  const glmApiKey = useSettingsStore((s) => s.glmApiKey);
  const setProviderApiKey = useSettingsStore((s) => s.setProviderApiKey);

  const chatChannels = channelsByKind('chat');
  const [providerId, setProviderId] = useState('deepseek');
  const [key, setKey] = useState('');
  const [testState, setTestState] = useState<TestState>('idle');
  const [saved, setSaved] = useState(false);

  const storedKey = resolveApiKey(
    { credentials, credentialRefs },
    `provider:${providerId}`,
    providerApiKeys[providerId] ?? (providerId === 'glm' ? glmApiKey : ''),
  );

  const handleTest = async () => {
    const candidate = key.trim() || storedKey;
    if (!candidate) {
      setTestState('fail');
      return;
    }
    setTestState('testing');
    const ok = await testChatProviderKey(providerId, candidate);
    setTestState(ok ? 'ok' : 'fail');
  };

  const handleSave = () => {
    if (!key.trim()) return;
    setProviderApiKey(providerId, key.trim());
    setKey('');
    setSaved(true);
  };

  return (
    <div className="mx-auto mb-8 w-full max-w-md min-w-0 rounded-lg border border-zinc-200 bg-white p-5 text-left text-zinc-900">
      <div className="text-[15px] font-medium text-zinc-900">先配置主聊天模型</div>
      <p className="mt-1 break-words text-[11px] leading-relaxed text-zinc-500">
        当前还没有可用的模型 Key，对话功能暂不可用。任选一个服务填入 Key 即可，也可稍后在 设置 → 语言模型 里配置。
      </p>

      <div className="mt-4 space-y-3">
        <div className="flex min-w-0 items-center gap-2">
          <select
            value={providerId}
            onChange={(e) => {
              setProviderId(e.target.value);
              setKey('');
              setTestState('idle');
              setSaved(false);
            }}
            className="min-w-0 flex-1 rounded-md border border-zinc-200 bg-white px-3 py-2 text-[13px] outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100"
          >
            {chatChannels.map((c) => (
              <option key={c.id} value={c.id}>{c.label}</option>
            ))}
          </select>
          {chatChannels.find((c) => c.id === providerId)?.url && (
            <a
              href={chatChannels.find((c) => c.id === providerId)!.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-900 hover:underline"
            >
              获取 Key
            </a>
          )}
        </div>

        <KeyInput
          value={key}
          onChange={(v) => {
            setKey(v);
            setTestState('idle');
            setSaved(false);
          }}
          placeholder={storedKey ? '已保存过 Key，粘贴新 Key 可覆盖' : '粘贴 API Key'}
        />

        <div className="flex items-center justify-end gap-2">
          <TestButton
            state={testState}
            disabled={!key.trim() && !storedKey.trim()}
            onClick={() => void handleTest()}
          />
          <button
            type="button"
            onClick={handleSave}
            disabled={!key.trim()}
            className="rounded-md bg-primary-500 px-4 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-600 disabled:opacity-40"
          >
            {saved ? '已保存' : '保存'}
          </button>
        </div>
      </div>
    </div>
  );
}
