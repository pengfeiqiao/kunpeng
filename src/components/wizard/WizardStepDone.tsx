import { useSettingsStore } from '@/stores';
import { hasAnyChatProviderKey, resolveApiKey, resolveSlotApiKey } from '@/lib/credentials';
import { primaryBtnCls, secondaryBtnCls } from './wizardUi';

interface Props {
  onBack?: () => void;
  onFinish: () => void;
}

export default function WizardStepDone({ onBack, onFinish }: Props) {
  const settings = useSettingsStore();

  const chatOk = hasAnyChatProviderKey(settings);
  const imageOk =
    settings.imageApiSlots.some((slot) => resolveSlotApiKey(settings, slot).trim()) ||
    Boolean(resolveApiKey(settings, 'ark', settings.arkApiKey).trim());
  const videoOk =
    Boolean(resolveApiKey(settings, 'ark', settings.arkApiKey).trim()) ||
    Boolean(resolveApiKey(settings, 'omniApimart', settings.omniApimartApiKey).trim()) ||
    Boolean(resolveApiKey(settings, 'runninghub', settings.runninghubApiKey).trim()) ||
    Boolean(resolveApiKey(settings, 'kuaizi', settings.kuaiziApiKey).trim());
  const cosOk = Boolean(
    settings.cosSecretId.trim() && settings.cosSecretKey.trim() && settings.cosBucket.trim(),
  );

  const rows = [
    { label: '主聊天模型', ok: chatOk },
    { label: '图片生成', ok: imageOk },
    { label: '视频生成', ok: videoOk },
    { label: '存储中转（COS）', ok: cosOk },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-[15px] font-medium text-zinc-900">配置完成</h2>
        <p className="mt-1 text-[13px] text-zinc-600">以下是各类能力的配置状态。</p>
      </div>

      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {rows.map((row) => (
          <div key={row.label} className="flex items-center justify-between px-4 py-3">
            <span className="text-[13px] text-zinc-900">{row.label}</span>
            <span className="text-[13px]">
              {row.ok ? '✅ 已配置' : '⏭ 已跳过'}
            </span>
          </div>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-zinc-500">
        ⏭ 的项目随时可在 设置 → API 凭证 里补配。
      </p>

      <div className="flex items-center gap-3 pt-1">
        {onBack && (
          <button type="button" onClick={onBack} className={secondaryBtnCls}>
            上一步
          </button>
        )}
        <button type="button" onClick={onFinish} className={primaryBtnCls}>
          进入应用
        </button>
      </div>
    </div>
  );
}
