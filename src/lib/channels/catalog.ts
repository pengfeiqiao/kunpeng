/**
 * 渠道清单（Channel Catalog）—— 引导页和设置页共用的单一事实源（08 文档 §6.3）。
 *
 * 只维护这一份：新增/下线渠道只改这里，引导页与设置页自动跟上，避免两处漂移。
 * 本模块保持零依赖（不 import settingsStore / Tauri），引导页、设置页、脚本都能 import。
 *
 * 文案约束（08 文档 §5）：渠道卡片避免任何「推荐」「最便宜」「最快」等背书性词汇，
 * 只允许事实性描述（地址、用途、计费方式以官方为准）。
 */

export type ChannelKind = 'chat' | 'image' | 'video' | 'storage';

export interface ChannelEntry {
  id: string;
  label: string;
  /** 官网 / 控制台链接；本地方案为 '' */
  url: string;
  /** 用途：这个渠道能解锁什么功能（事实性描述） */
  purpose: string;
  kind: ChannelKind;
  /** false = 本地方案（如即梦 OAuth），无需 API Key */
  needsKey: boolean;
  note?: string;
}

export const CHANNEL_CATALOG: ChannelEntry[] = [
  // ── 聊天（主模型）──
  {
    id: 'deepseek',
    label: 'DeepSeek',
    url: 'https://platform.deepseek.com',
    purpose: '对话、代码、工具调用、任务规划——所有助手的核心大脑。',
    kind: 'chat',
    needsKey: true,
    note: '默认使用 DeepSeek 官方 Harness 引擎（更强的工具调用与长上下文）；出问题可在设置切回内置模式。',
  },
  {
    id: 'glm',
    label: '智谱 GLM',
    url: 'https://open.bigmodel.cn',
    purpose: '聊天模型备选渠道。',
    kind: 'chat',
    needsKey: true,
  },
  {
    id: 'kimi',
    label: 'Kimi',
    url: 'https://www.kimi.com/code/console',
    purpose: '聊天模型备选渠道（Kimi Code）。',
    kind: 'chat',
    needsKey: true,
  },
  // ── 图片生成 ──
  {
    id: 'dmxapi',
    label: 'DMXAPI',
    url: 'https://www.dmxapi.cn',
    purpose: '聚合中转，覆盖主流绘图模型。',
    kind: 'image',
    needsKey: true,
  },
  {
    id: 'aihubmix',
    label: 'AiHubMix',
    url: 'https://api.inferera.com',
    purpose: '聚合中转。',
    kind: 'image',
    needsKey: true,
  },
  {
    id: 'zexapi',
    label: 'ZexAPI',
    url: 'https://zexapi.com',
    purpose: '聚合中转。',
    kind: 'image',
    needsKey: true,
  },
  {
    id: 'dreamina-local',
    label: '即梦 Dreamina（本地）',
    url: '',
    purpose: '走本地 CLI（OAuth 登录，无需 Key），Seedream 系列图片。',
    kind: 'image',
    needsKey: false,
  },
  {
    id: 'ark',
    label: '火山引擎方舟（Ark）',
    url: 'https://www.volcengine.com/product/ark',
    purpose: '官方渠道。配一个 Key 解锁 Seedance 视频与 Seedream 图片，按 token 计费。',
    kind: 'image',
    needsKey: true,
    note: '模型清单见 src/lib/channels/arkModels.ts 注册表，可在设置页「同步模型列表」拉取最新。',
  },
  // ── 视频生成 ──
  {
    id: 'ark-video',
    label: '火山引擎方舟（Ark）',
    url: 'https://www.volcengine.com/product/ark',
    purpose: '官方渠道。Seedance 2.5（旗舰，30 秒长视频/多模态参考）与 2.0 系列，按 token 计费。',
    kind: 'video',
    needsKey: true,
    note: '与图片共用同一个 Ark Key；模型清单动态渲染（arkModels.ts），不写死在文案里。',
  },
  {
    id: 'dreamina-video',
    label: '即梦 Dreamina（本地）',
    url: '',
    purpose: '本地方案（OAuth 登录，无需 Key）；Seedance 2.5 的免 Key 备选通道，另有 Seedream 图片。',
    kind: 'video',
    needsKey: false,
  },
  {
    id: 'omni-apimart',
    label: 'Omni（APIMart 网关）',
    url: 'https://api.apimart.ai',
    purpose: '多模态聚合。',
    kind: 'video',
    needsKey: true,
    note: '备用域：apib.ai / aiuxu.com / aishuch.com。',
  },
  {
    id: 'runninghub',
    label: 'RunningHub',
    url: 'https://www.runninghub.cn',
    purpose: '云端 ComfyUI 工作流。',
    kind: 'video',
    needsKey: true,
  },
  {
    id: 'kuaizi',
    label: '筷子科技（Kuaizi）',
    url: 'https://aiopenapi.kuaizi.cn',
    purpose: '短视频批量生产链路。',
    kind: 'video',
    needsKey: true,
  },
  // ── 对象存储中转 ──
  {
    id: 'cos',
    label: '腾讯云 COS（对象存储中转）',
    url: 'https://cloud.tencent.com/product/cos',
    purpose: '给生图/生视频 API 提供公网可访问 URL 的“中转站”：本地文件先传到桶里拿临时公网 URL 交给模型 API，用完即弃。',
    kind: 'storage',
    needsKey: true,
    note: '源码已内置一键自建到你自己的腾讯云账号：scf/cos-transit/。低频使用费用通常为每月几毛钱量级（以官方定价为准）。',
  },
];

export function channelsByKind(kind: ChannelKind): ChannelEntry[] {
  return CHANNEL_CATALOG.filter((c) => c.kind === kind);
}

export function getChannel(id: string): ChannelEntry | undefined {
  return CHANNEL_CATALOG.find((c) => c.id === id);
}

/**
 * 免责声明固定文案（08 文档 §5）——引导页第 2/3/4 步与渠道清单卡片底部都要出现。
 * 修改文案只改这里。
 */
export const CHANNELS_DISCLAIMER =
  '以上渠道列表仅为作者开发时内置的接入选项，不构成任何商业推荐或背书；' +
  '各服务的价格、稳定性与合规性请以其官方说明为准。' +
  '鲲鹏是开源软件，你可以修改源码接入任何兼容的 API 服务，也可以移除不需要的渠道。';
