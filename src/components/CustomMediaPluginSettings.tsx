/**
 * 自定义模型插件管理（issue #7）：图片/视频模型以 base_url + model_id 接入三方 API。
 * 在「设置 → 图片模型」与「设置 → 视频与语音」各挂一份（按 kind 过滤）。
 * 也可以直接在对话里让 Agent 用 media_api_plugin 工具代为配置。
 */
import { useState } from 'react';
import { Eye, EyeOff, Plus, Trash2 } from 'lucide-react';
import { useSettingsStore, type CustomMediaApi } from '@/stores/settingsStore';
import { resetCustomMediaSelections } from '@/lib/customMedia/runner';

const inputCls =
  'w-full bg-white border border-zinc-200 rounded-md px-2.5 py-1.5 outline-none transition-colors focus:border-zinc-400 text-xs';

function PluginRow({ api, onChange, onRemove }: {
  api: CustomMediaApi;
  onChange: (next: CustomMediaApi) => void;
  onRemove: () => void;
}) {
  const [showKey, setShowKey] = useState(false);
  return (
    <div className="rounded-lg border border-zinc-200/80 bg-zinc-50/60 p-3 space-y-2">
      <div className="flex items-center gap-2">
        <input
          value={api.label}
          onChange={(e) => onChange({ ...api, label: e.target.value })}
          className={inputCls}
          placeholder="显示名称，如「XX 网关 GPT-Image」"
        />
        <button
          type="button"
          onClick={() => onChange({ ...api, enabled: !api.enabled })}
          className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
            api.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-zinc-200 text-zinc-500'
          }`}
          title={api.enabled ? '点击停用' : '点击启用'}
        >
          {api.enabled ? '启用' : '停用'}
        </button>
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded-md p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500"
          title="删除插件"
        >
          <Trash2 size={13} />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={api.baseUrl}
          onChange={(e) => onChange({ ...api, baseUrl: e.target.value })}
          className={inputCls}
          placeholder="Base URL，如 https://api.example.com"
        />
        <input
          value={api.modelId}
          onChange={(e) => onChange({ ...api, modelId: e.target.value })}
          className={inputCls}
          placeholder="model_id，如 gpt-image-2 / wan3.0-video"
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={api.apiKey}
            onChange={(e) => onChange({ ...api, apiKey: e.target.value })}
            className={inputCls}
            placeholder="API Key"
          />
          <button
            type="button"
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-zinc-400 hover:text-zinc-600"
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>
        <select
          value={api.protocol}
          onChange={(e) => onChange({ ...api, protocol: e.target.value as CustomMediaApi['protocol'] })}
          className={inputCls}
          title="接口协议"
        >
          <option value="apimart-async">异步任务协议（task_id + 轮询，APIMart 系通用）</option>
          {api.kind === 'image' && <option value="openai-images">OpenAI Images 同步协议</option>}
        </select>
      </div>
    </div>
  );
}

export default function CustomMediaPluginSettings({ kind }: { kind: 'image' | 'video' }) {
  const customMediaApis = useSettingsStore((s) => s.customMediaApis);
  const setCustomMediaApis = useSettingsStore((s) => s.setCustomMediaApis);
  const apis = (customMediaApis ?? []).filter((api) => api.kind === kind);

  const updateAt = (id: string, next: CustomMediaApi) => {
    // 停用时重置悬空的普通对话默认选择
    if (!next.enabled) resetCustomMediaSelections(id);
    setCustomMediaApis((customMediaApis ?? []).map((api) => (api.id === id ? next : api)));
  };
  const removeAt = (id: string) => {
    // 删除前重置悬空的普通对话默认选择；画布节点/工坊分镜引用保留，
    // 生成时会得到明确的“插件不存在”错误
    resetCustomMediaSelections(id);
    setCustomMediaApis((customMediaApis ?? []).filter((api) => api.id !== id));
  };
  const addOne = () => {
    const api: CustomMediaApi = {
      id: `${kind}-${Date.now().toString(36)}`,
      label: '',
      kind,
      baseUrl: '',
      modelId: '',
      apiKey: '',
      protocol: 'apimart-async',
      enabled: true,
    };
    setCustomMediaApis([...(customMediaApis ?? []), api]);
  };

  return (
    <div className="space-y-2">
      {apis.length === 0 && (
        <p className="text-[11px] text-zinc-400">
          还没有自定义{kind === 'image' ? '图片' : '视频'}模型插件。添加后会出现在画布、普通对话{kind === 'video' ? '、工坊' : ''}的模型选择列表里；也可以直接在对话里把接口文档发给 Agent，让它用 media_api_plugin 工具帮你配置。
        </p>
      )}
      {apis.map((api) => (
        <PluginRow key={api.id} api={api} onChange={(next) => updateAt(api.id, next)} onRemove={() => removeAt(api.id)} />
      ))}
      <button
        type="button"
        onClick={addOne}
        className="flex items-center gap-1 rounded-md border border-dashed border-zinc-300 px-2.5 py-1.5 text-xs text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
      >
        <Plus size={12} />
        添加自定义{kind === 'image' ? '图片' : '视频'}模型
      </button>
      <p className="text-[10px] leading-relaxed text-zinc-400">
        协议说明：异步任务协议 = POST /v1/{kind === 'image' ? 'images' : 'videos'}/generations 返回 task_id，轮询 GET /v1/tasks/&#123;id&#125;（APIMart 及同类聚合网关通用）；
        {kind === 'image' ? 'OpenAI Images 同步协议 = POST /v1/images/generations 直接返回图片。' : '视频插件当前仅支持异步任务协议。'}
        Base URL 填到域名即可，不要带具体接口路径。
      </p>
    </div>
  );
}
