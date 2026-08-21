import { useSettingsStore } from '@/stores';
import { getChannel, CHANNELS_DISCLAIMER } from '@/lib/channels/catalog';
import { KeyInput, inputCls } from './wizardUi';

/** 第 4 步 · 对象存储中转（COS）：重点解释「为什么需要」，配置可全部留空。 */
export default function WizardStepCos() {
  const cosBucket = useSettingsStore((s) => s.cosBucket);
  const cosRegion = useSettingsStore((s) => s.cosRegion);
  const cosSecretId = useSettingsStore((s) => s.cosSecretId);
  const cosSecretKey = useSettingsStore((s) => s.cosSecretKey);
  const cosTransitEndpoint = useSettingsStore((s) => s.cosTransitEndpoint);
  const setCosBucket = useSettingsStore((s) => s.setCosBucket);
  const setCosRegion = useSettingsStore((s) => s.setCosRegion);
  const setCosSecretId = useSettingsStore((s) => s.setCosSecretId);
  const setCosSecretKey = useSettingsStore((s) => s.setCosSecretKey);
  const setCosTransitEndpoint = useSettingsStore((s) => s.setCosTransitEndpoint);

  const cosChannel = getChannel('cos');

  return (
    <div className="space-y-4">
      <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
        <div>
          <div className="text-[13px] font-medium text-zinc-900">问题：本地文件没有公网地址</div>
          <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-600">
            很多生图/生视频 API 的输入（垫图、参考帧）和输出（成品图/视频）要求公网可访问的 URL，
            而鲲鹏是本地应用，本地文件没有公网地址。
          </p>
        </div>
        <div>
          <div className="text-[13px] font-medium text-zinc-900">解法：对象存储桶做“中转站”</div>
          <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-600">
            本地文件先传到桶里拿到临时公网 URL 交给模型 API，用完即弃。
            推荐方案：{cosChannel?.label ?? '腾讯云 COS'} + 一个云函数做签名中转
            （源码已内置在 <span className="font-mono text-[12px]">scf/cos-transit/</span>，可一键自建到你自己的腾讯云账号）。
            选就近地域即可；临时链接默认短时有效，建议在桶里配 1 天自动删除规则，不上传的文件也会被生命周期自动清理。
          </p>
        </div>
        <div>
          <div className="text-[13px] font-medium text-zinc-900">成本与“也可以不用”</div>
          <p className="mt-1 break-words text-[13px] leading-relaxed text-zinc-600">
            低频使用下费用通常为每月几毛钱量级（以腾讯云官方定价为准）。
            不提供中转时，需要公网 URL 的能力会退化为不可用或手动填 URL；纯本地模型渠道不受影响。
          </p>
        </div>
      </div>

      <div className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <span className="text-[15px] font-medium text-zinc-900">COS 配置（可留空）</span>
          {cosChannel?.url && (
            <a
              href={cosChannel.url}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 text-[11px] text-zinc-500 hover:text-zinc-900 hover:underline"
            >
              获取密钥
            </a>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="min-w-0">
            <label className="mb-1 block text-[11px] text-zinc-500">SecretId</label>
            <KeyInput value={cosSecretId} onChange={setCosSecretId} placeholder="AKID..." />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-[11px] text-zinc-500">SecretKey</label>
            <KeyInput value={cosSecretKey} onChange={setCosSecretKey} />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-[11px] text-zinc-500">桶名（Bucket）</label>
            <input
              type="text"
              value={cosBucket}
              onChange={(e) => setCosBucket(e.target.value)}
              placeholder="example-1234567890"
              className={`${inputCls} font-mono text-xs`}
            />
          </div>
          <div className="min-w-0">
            <label className="mb-1 block text-[11px] text-zinc-500">地域（Region）</label>
            <input
              type="text"
              value={cosRegion}
              onChange={(e) => setCosRegion(e.target.value)}
              placeholder="ap-guangzhou"
              className={`${inputCls} font-mono text-xs`}
            />
          </div>
        </div>
        <div className="min-w-0">
          <label className="mb-1 block text-[11px] text-zinc-500">中转函数地址（源码自建后填入）</label>
          <input
            type="text"
            value={cosTransitEndpoint}
            onChange={(e) => setCosTransitEndpoint(e.target.value)}
            placeholder="https://service-xxx.gz.apigw.tencentcs.com/release/"
            className={`${inputCls} font-mono text-xs`}
          />
        </div>
      </div>

      <p className="break-words text-[11px] leading-relaxed text-zinc-500">{CHANNELS_DISCLAIMER}</p>
    </div>
  );
}
