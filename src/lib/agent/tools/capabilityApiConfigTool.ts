/**
 * capability_api_config — 查看/调整「识图」与「联网搜索」两个模块的 API 配置。
 * 用户说"帮我配置识图 API / 联网搜索换个接口 / 这两个模块怎么用我自己的 key"时，
 * 用本工具读取当前配置并按用户给出的端点信息写入。
 * 安全纪律：get 只返回 key 是否已配置（绝不回显密钥值）；set 写入后建议用户自行验证一次。
 */
import type { Tool } from '../types';
import { useSettingsStore } from '@/stores/settingsStore';

type ModuleId = 'vision' | 'web_search';

const MODULE_LABEL: Record<ModuleId, string> = {
  vision: '识图（image_recognition）',
  web_search: '联网搜索（web_search）',
};

function describe(module: ModuleId): string {
  const s = useSettingsStore.getState();
  if (module === 'vision') {
    const lines = [
      `模式：${s.visionApiMode === 'custom' ? '自定义端点' : '自动（原生 Kimi → DMX kimi-k3 → 豆包 lite → GPT-4o-mini 容灾链）'}`,
    ];
    if (s.visionApiMode === 'custom') {
      lines.push(`Base URL：${s.visionCustomBaseUrl || '（未填）'}`);
      lines.push(`模型：${s.visionCustomModel || '（未填）'}`);
      lines.push(`API Key：${s.visionCustomApiKey ? '已配置' : '未配置'}`);
    }
    return lines.join('；');
  }
  const lines = [
    `模式：${s.webSearchApiMode === 'custom' ? '自定义端点' : '自动（DMX perplexity-sonar-pro → 腾讯搜索回退）'}`,
  ];
  if (s.webSearchApiMode === 'custom') {
    lines.push(`Base URL：${s.webSearchCustomBaseUrl || '（未填）'}`);
    lines.push(`模型：${s.webSearchCustomModel || '（未填）'}`);
    lines.push(`API Key：${s.webSearchCustomApiKey ? '已配置' : '未配置'}`);
  }
  return lines.join('；');
}

export const capabilityApiConfigTool: Tool = {
  definition: {
    name: 'capability_api_config',
    description:
      '查看和调整「识图」(image_recognition) 与「联网搜索」(web_search) 两个模块的 API 对接。' +
      '用户让你帮忙配置/修改这两个模块的接口、换 key、换端点时使用。' +
      'op=get 读取当前配置（不回显密钥）；op=set 写入：module 必填，mode 为 auto（内置链路）或 custom（OpenAI 兼容端点），' +
      'custom 时 base_url、model、api_key 三件套按需传入（未传的字段保持原值）。' +
      '端点只需填到 host 或 /v1，系统会自动补全 /chat/completions。写入后提醒用户在设置 → 识图与联网里可复查。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['get', 'set'], description: 'get=查看；set=修改' },
        module: {
          type: 'string',
          enum: ['vision', 'web_search'],
          description: 'vision=识图模块；web_search=联网搜索模块。get 省略时返回两个模块',
        },
        mode: { type: 'string', enum: ['auto', 'custom'], description: 'auto=内置链路；custom=OpenAI 兼容自定义端点' },
        base_url: { type: 'string', description: 'custom 模式的端点地址，如 https://api.perplexity.ai 或 https://www.dmxapi.cn' },
        model: { type: 'string', description: 'custom 模式的模型名（识图需支持图片输入；联网建议带搜索能力的模型）' },
        api_key: { type: 'string', description: 'custom 模式的 API Key。用户没主动给 key 时不要编造' },
      },
      required: ['op'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const op = String(params.op ?? 'get');
    const s = useSettingsStore.getState();

    if (op === 'get') {
      const module = params.module as ModuleId | undefined;
      const modules: ModuleId[] = module ? [module] : ['vision', 'web_search'];
      const output = modules.map((m) => `【${MODULE_LABEL[m]}】${describe(m)}`).join('\n');
      return { success: true, output };
    }

    if (op === 'set') {
      const module = params.module as ModuleId | undefined;
      if (!module) return { success: false, output: '', error: 'set 必须指定 module（vision 或 web_search）' };
      const mode = params.mode ? String(params.mode) : undefined;
      if (mode && mode !== 'auto' && mode !== 'custom') {
        return { success: false, output: '', error: 'mode 只能是 auto 或 custom' };
      }
      const baseUrl = typeof params.base_url === 'string' ? params.base_url.trim() : undefined;
      const model = typeof params.model === 'string' ? params.model.trim() : undefined;
      const apiKey = typeof params.api_key === 'string' ? params.api_key.trim() : undefined;

      if (mode === 'custom') {
        const missing: string[] = [];
        const curBase = baseUrl ?? (module === 'vision' ? s.visionCustomBaseUrl : s.webSearchCustomBaseUrl);
        const curModel = model ?? (module === 'vision' ? s.visionCustomModel : s.webSearchCustomModel);
        const curKey = apiKey ?? (module === 'vision' ? s.visionCustomApiKey : s.webSearchCustomApiKey);
        if (!curBase) missing.push('base_url');
        if (!curModel) missing.push('model');
        if (!curKey) missing.push('api_key');
        if (missing.length > 0) {
          return {
            success: false,
            output: '',
            error: `切到自定义端点前还缺：${missing.join('、')}。请向用户索要后再写入，不要编造。`,
          };
        }
      }

      const patch: Partial<ReturnType<typeof useSettingsStore.getState>> = {};
      if (module === 'vision') {
        if (mode) patch.visionApiMode = mode as 'auto' | 'custom';
        if (baseUrl !== undefined) patch.visionCustomBaseUrl = baseUrl;
        if (model !== undefined) patch.visionCustomModel = model;
        if (apiKey !== undefined) patch.visionCustomApiKey = apiKey;
      } else {
        if (mode) patch.webSearchApiMode = mode as 'auto' | 'custom';
        if (baseUrl !== undefined) patch.webSearchCustomBaseUrl = baseUrl;
        if (model !== undefined) patch.webSearchCustomModel = model;
        if (apiKey !== undefined) patch.webSearchCustomApiKey = apiKey;
      }
      useSettingsStore.setState(patch);

      return {
        success: true,
        output: `【${MODULE_LABEL[module]}】已更新：${describe(module)}。用户可在「设置 → 识图与联网」复查；建议实际调用一次验证端点可用。`,
      };
    }

    return { success: false, output: '', error: `不支持的 op: ${op}` };
  },
};
