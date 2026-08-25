/**
 * media_api_plugin — 自定义图片/视频模型插件管理（issue #7）。
 * 用户给出三方模型的接入方式（base_url、model_id、key、协议文档）后，
 * 用本工具把插件写入设置；插件以 custom-media:{id} 引擎出现在
 * 画布/普通对话/工坊的模型选择器中。
 * 安全纪律：list 不回显密钥；add/update 缺关键字段时向用户索要，不要编造。
 */
import type { Tool } from '../types';
import { useSettingsStore, type CustomMediaApi } from '@/stores/settingsStore';

function summarize(api: CustomMediaApi): string {
  return `${api.id}｜${api.label}｜${api.kind === 'image' ? '图片' : '视频'}｜${api.modelId}｜${api.baseUrl}｜协议 ${api.protocol}｜${api.enabled ? '启用' : '停用'}｜Key ${api.apiKey || api.credentialId ? '已配置' : '未配置'}`;
}

function newPluginId(kind: string): string {
  return `${kind}-${Date.now().toString(36)}`;
}

export const mediaApiPluginTool: Tool = {
  definition: {
    name: 'media_api_plugin',
    description:
      '管理自定义图片/视频模型插件（base_url + model_id 接入三方模型）。' +
      '用户让你帮忙接入一个新的生图/生视频 API、给出接口文档或接入方式时使用。' +
      '协议二选一：openai-images=OpenAI Images 同步接口（POST /v1/images/generations 直接返回图片）；' +
      'apimart-async=异步任务接口（POST /v1/{images|videos}/generations 返回 task_id，轮询 GET /v1/tasks/{id}）。' +
      '添加后插件会出现在画布、普通对话、工坊的模型选择列表里（引擎 id 为 custom-media:{插件id}）。' +
      'list 查看现有插件；add 新增；update 修改（只改传入字段）；remove 删除；toggle 启停。',
    parameters: {
      type: 'object',
      properties: {
        op: { type: 'string', enum: ['list', 'add', 'update', 'remove', 'toggle'], description: '操作类型' },
        id: { type: 'string', description: 'update/remove/toggle 时的插件 id' },
        kind: { type: 'string', enum: ['image', 'video'], description: 'add 必填：图片或视频模型' },
        label: { type: 'string', description: '显示名称，如「XX 网关 GPT-Image」' },
        base_url: { type: 'string', description: 'API 基础地址，如 https://api.example.com（不要带 /v1/images/generations 这类具体路径）' },
        model_id: { type: 'string', description: '模型 ID，如 gpt-image-2 / wan3.0-video' },
        api_key: { type: 'string', description: 'API Key。用户没主动给 key 时不要编造' },
        protocol: { type: 'string', enum: ['openai-images', 'apimart-async'], description: '接口协议，默认 apimart-async' },
        enabled: { type: 'boolean', description: '是否启用，默认 true' },
      },
      required: ['op'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const op = String(params.op ?? 'list');
    const s = useSettingsStore.getState();
    const apis = [...(s.customMediaApis ?? [])];

    if (op === 'list') {
      if (apis.length === 0) {
        return { success: true, output: '当前没有自定义模型插件。用户给出 base_url、model_id、API Key 和接口协议后，用 op=add 添加。' };
      }
      return { success: true, output: apis.map(summarize).join('\n') };
    }

    if (op === 'add') {
      const kind = params.kind === 'image' || params.kind === 'video' ? params.kind : undefined;
      const label = String(params.label ?? '').trim();
      const baseUrl = String(params.base_url ?? '').trim().replace(/\/+$/, '');
      const modelId = String(params.model_id ?? '').trim();
      const apiKey = String(params.api_key ?? '').trim();
      const missing: string[] = [];
      if (!kind) missing.push('kind(image/video)');
      if (!label) missing.push('label');
      if (!baseUrl || !baseUrl.startsWith('http')) missing.push('base_url');
      if (!modelId) missing.push('model_id');
      if (!apiKey) missing.push('api_key');
      if (missing.length > 0) {
        return { success: false, output: '', error: `添加插件还缺：${missing.join('、')}。请向用户索要后再写入，不要编造。` };
      }
      const protocol = params.protocol === 'openai-images' ? 'openai-images' : 'apimart-async';
      if (kind === 'video' && protocol === 'openai-images') {
        return { success: false, output: '', error: '视频插件只支持 apimart-async 异步任务协议。' };
      }
      const api: CustomMediaApi = {
        id: newPluginId(kind!),
        label,
        kind: kind!,
        baseUrl,
        modelId,
        apiKey,
        protocol,
        enabled: params.enabled !== false,
      };
      useSettingsStore.getState().setCustomMediaApis([...apis, api]);
      return {
        success: true,
        output: `已添加插件：${summarize(api)}\n引擎 id：custom-media:${api.id}（已出现在画布/普通对话/工坊的模型选择中）。建议实际生成一次验证接入可用。`,
      };
    }

    const id = String(params.id ?? '').trim();
    const index = apis.findIndex((api) => api.id === id);
    if (index < 0) {
      return { success: false, output: '', error: `未找到插件 id: ${id || '(未提供)'}。先 op=list 查看。` };
    }

    if (op === 'remove') {
      const removed = apis[index];
      apis.splice(index, 1);
      useSettingsStore.getState().setCustomMediaApis(apis);
      return { success: true, output: `已删除插件：${removed.label}（custom-media:${removed.id}）` };
    }

    if (op === 'toggle') {
      apis[index] = {
        ...apis[index],
        enabled: typeof params.enabled === 'boolean' ? params.enabled : !apis[index].enabled,
      };
      useSettingsStore.getState().setCustomMediaApis(apis);
      return { success: true, output: `已${apis[index].enabled ? '启用' : '停用'}插件：${summarize(apis[index])}` };
    }

    if (op === 'update') {
      const cur = apis[index];
      const next: CustomMediaApi = {
        ...cur,
        label: typeof params.label === 'string' && params.label.trim() ? params.label.trim() : cur.label,
        baseUrl: typeof params.base_url === 'string' && params.base_url.trim() ? params.base_url.trim().replace(/\/+$/, '') : cur.baseUrl,
        modelId: typeof params.model_id === 'string' && params.model_id.trim() ? params.model_id.trim() : cur.modelId,
        apiKey: typeof params.api_key === 'string' && params.api_key.trim() ? params.api_key.trim() : cur.apiKey,
        protocol: params.protocol === 'openai-images' || params.protocol === 'apimart-async' ? params.protocol : cur.protocol,
        enabled: typeof params.enabled === 'boolean' ? params.enabled : cur.enabled,
      };
      if (next.kind === 'video' && next.protocol === 'openai-images') {
        return { success: false, output: '', error: '视频插件只支持 apimart-async 异步任务协议。' };
      }
      apis[index] = next;
      useSettingsStore.getState().setCustomMediaApis(apis);
      return { success: true, output: `已更新插件：${summarize(next)}` };
    }

    return { success: false, output: '', error: `不支持的 op: ${op}` };
  },
};
