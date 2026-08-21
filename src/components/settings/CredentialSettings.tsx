import { useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  Eye,
  EyeOff,
  Key,
  Loader2,
  Pencil,
  Plus,
  Trash2,
  XCircle,
  Zap,
} from 'lucide-react';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { confirm as tauriConfirm } from '@tauri-apps/api/dialog';
import { useSettingsStore } from '@/stores/settingsStore';
import {
  credentialIdFor,
  listCredentialUsages,
  normalizeBaseUrl,
  type Credential,
} from '@/lib/credentials';

interface TestResult {
  ok: boolean;
  text: string;
}

function maskApiKey(key: string): string {
  if (!key) return '（空）';
  if (key.length <= 8) return '••••••';
  return `${key.slice(0, 3)}…${key.slice(-4)}`;
}

const inputCls =
  'w-full rounded-md border border-zinc-200 bg-white px-3 py-2.5 text-xs outline-none transition-colors focus:border-zinc-400 focus:ring-2 focus:ring-zinc-100';

/**
 * 对凭证发一个最小请求（GET {baseUrl}/v1/models），把失败原因翻译成可读文案。
 * 不打印 key 本体。
 */
async function testCredentialConnection(cred: Credential): Promise<TestResult> {
  const baseUrl = normalizeBaseUrl(cred.baseUrl);
  if (!baseUrl) return { ok: false, text: '未填写请求地址，无法测试' };
  try {
    const res = await tauriFetch(`${baseUrl}/v1/models`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${cred.apiKey}` },
      responseType: ResponseType.JSON,
      timeout: 15,
    });
    if (res.status >= 200 && res.status < 300) return { ok: true, text: '连接成功' };
    if (res.status === 401 || res.status === 403) {
      return { ok: false, text: `认证失败（HTTP ${res.status}）：密钥无效或已过期` };
    }
    if (res.status === 402) return { ok: false, text: '余额不足（HTTP 402）' };
    if (res.status === 404) return { ok: true, text: '服务可达（无 /v1/models 接口，HTTP 404）' };
    if (res.status === 429) return { ok: false, text: '请求被限流（HTTP 429）' };
    return { ok: false, text: `服务返回 HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, text: `网络错误：${err instanceof Error ? err.message : String(err)}` };
  }
}

export default function CredentialSettings() {
  const credentials = useSettingsStore((s) => s.credentials);
  const credentialRefs = useSettingsStore((s) => s.credentialRefs);
  const imageApiSlots = useSettingsStore((s) => s.imageApiSlots);
  const upsertCredential = useSettingsStore((s) => s.upsertCredential);
  const removeCredential = useSettingsStore((s) => s.removeCredential);

  const usages = listCredentialUsages({ credentialRefs, imageApiSlots });

  const [editingId, setEditingId] = useState<string | null>(null); // '__new__' 表示新建
  const [draft, setDraft] = useState<{ label: string; baseUrl: string; apiKey: string }>({ label: '', baseUrl: '', apiKey: '' });
  const [showKey, setShowKey] = useState(false);
  const [error, setError] = useState('');
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [results, setResults] = useState<Record<string, TestResult>>({});

  const startCreate = () => {
    setDraft({ label: '', baseUrl: '', apiKey: '' });
    setError('');
    setEditingId('__new__');
  };

  const startEdit = (cred: Credential) => {
    setDraft({ label: cred.label, baseUrl: cred.baseUrl, apiKey: cred.apiKey });
    setError('');
    setEditingId(cred.id);
  };

  const handleSave = () => {
    const label = draft.label.trim();
    const apiKey = draft.apiKey.trim();
    if (!label) { setError('请填写名称'); return; }
    if (!apiKey) { setError('请填写 API Key'); return; }
    const baseUrl = normalizeBaseUrl(draft.baseUrl);
    if (editingId === '__new__') {
      const id = credentialIdFor(baseUrl, apiKey);
      if (credentials.some((c) => c.id === id)) {
        setError('相同地址和密钥的凭证已存在');
        return;
      }
      upsertCredential({ id, label, baseUrl, apiKey, createdAt: Date.now() });
    } else {
      const existing = credentials.find((c) => c.id === editingId);
      if (!existing) { setEditingId(null); return; }
      upsertCredential({ ...existing, label, baseUrl, apiKey });
    }
    setEditingId(null);
  };

  const handleDelete = async (cred: Credential) => {
    const usedBy = usages[cred.id] ?? [];
    const message = usedBy.length > 0
      ? `凭证「${cred.label}」正被以下能力引用：\n${usedBy.map((u) => `· ${u}`).join('\n')}\n\n删除后这些能力会回退到旧的分散字段。确定删除？`
      : `确定删除凭证「${cred.label}」？`;
    if (!(await tauriConfirm(message, { title: '删除凭证', type: 'warning' }))) return;
    removeCredential(cred.id);
    if (editingId === cred.id) setEditingId(null);
  };

  const handleTest = async (cred: Credential) => {
    setTesting((prev) => new Set(prev).add(cred.id));
    try {
      const result = await testCredentialConnection(cred);
      setResults((prev) => ({ ...prev, [cred.id]: result }));
    } finally {
      setTesting((prev) => {
        const next = new Set(prev);
        next.delete(cred.id);
        return next;
      });
    }
  };

  // ── 编辑视图 ──────────────────────────────────────────────────────────────
  if (editingId) {
    const isNew = editingId === '__new__';
    const usedBy = isNew ? [] : usages[editingId] ?? [];
    return (
      <div className="space-y-6">
        <button
          type="button"
          onClick={() => setEditingId(null)}
          className="flex items-center gap-1.5 rounded-md px-1 py-1 text-xs font-medium text-zinc-500 transition-colors hover:text-zinc-950"
        >
          <ArrowLeft size={14} />
          返回凭证列表
        </button>

        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-700">
            <Key size={20} />
          </div>
          <div className="min-w-0">
            <h3 className="text-lg font-semibold text-zinc-950">{isNew ? '新建凭证' : draft.label || '编辑凭证'}</h3>
            <p className="mt-0.5 text-xs text-zinc-500">保存后所有引用此凭证的能力立即生效。</p>
          </div>
        </div>

        <div className="overflow-hidden rounded-lg border border-zinc-200 bg-white">
          <div className="border-b border-zinc-100 px-5 py-4">
            <label className="mb-2 block text-[13px] font-medium text-zinc-900">名称</label>
            <input
              type="text"
              value={draft.label}
              onChange={(e) => setDraft({ ...draft, label: e.target.value })}
              placeholder="例如：DMXAPI 中转 / 火山方舟"
              className={inputCls}
            />
          </div>
          <div className="border-b border-zinc-100 px-5 py-4">
            <label className="mb-2 block text-[13px] font-medium text-zinc-900">请求地址（Base URL）</label>
            <input
              type="text"
              value={draft.baseUrl}
              onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
              placeholder="https://…"
              className={`${inputCls} font-mono`}
            />
            <p className="mt-2 text-[11px] text-zinc-500">用于「测试连接」；留空则无法测试。</p>
          </div>
          <div className="border-b border-zinc-100 px-5 py-4">
            <label className="mb-2 block text-[13px] font-medium text-zinc-900">API Key</label>
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value })}
                placeholder="粘贴 API Key"
                className={`${inputCls} pr-10 font-mono`}
              />
              <button
                type="button"
                onClick={() => setShowKey(!showKey)}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-zinc-400 transition-colors hover:text-zinc-700"
                title={showKey ? '隐藏密钥' : '显示密钥'}
              >
                {showKey ? <EyeOff size={15} /> : <Eye size={15} />}
              </button>
            </div>
          </div>
          {usedBy.length > 0 && (
            <div className="px-5 py-4">
              <div className="mb-2 text-[13px] font-medium text-zinc-900">被引用</div>
              <div className="flex flex-wrap gap-1.5">
                {usedBy.map((u) => (
                  <span key={u} className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-600">{u}</span>
                ))}
              </div>
            </div>
          )}
        </div>

        {error && <p className="text-[11px] text-zinc-500">{error}</p>}

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSave}
            className="rounded-md bg-zinc-900 px-4 py-2 text-xs font-medium text-white transition-colors hover:bg-zinc-700"
          >
            保存
          </button>
          <button
            type="button"
            onClick={() => setEditingId(null)}
            className="rounded-md border border-zinc-200 bg-white px-4 py-2 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  // ── 列表视图 ──────────────────────────────────────────────────────────────
  return (
    <div className="space-y-4">
      <div className="flex items-end justify-between gap-5">
        <div>
          <h3 className="text-[13px] font-semibold text-zinc-900">API 凭证</h3>
          <p className="mt-0.5 text-[11px] text-zinc-500">
            密钥的单一事实源：聊天、生图、视频等能力只引用这里的凭证，改一处处处生效。凭证不会被导出。
          </p>
        </div>
        <button
          type="button"
          onClick={startCreate}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-[11px] font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          <Plus size={13} />
          新建凭证
        </button>
      </div>

      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {credentials.map((cred) => {
          const usedBy = usages[cred.id] ?? [];
          const isTesting = testing.has(cred.id);
          const result = results[cred.id];
          return (
            <div key={cred.id} className="group flex min-h-[86px] items-center gap-4 px-4 py-3.5 transition-colors hover:bg-zinc-50/70">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-zinc-200 bg-zinc-50 text-zinc-600">
                <Key size={16} />
              </div>
              <button type="button" onClick={() => startEdit(cred)} className="min-w-0 flex-1 text-left">
                <div className="flex items-center gap-2">
                  <span className="text-[13px] font-semibold text-zinc-900">{cred.label}</span>
                  <span className="font-mono text-[10px] text-zinc-400">{maskApiKey(cred.apiKey)}</span>
                </div>
                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-zinc-500">
                  {cred.baseUrl && <span className="truncate font-mono">{cred.baseUrl}</span>}
                  {usedBy.length > 0 && (
                    <span className="text-zinc-400">
                      被引用：{usedBy.join('、')}
                    </span>
                  )}
                </div>
                {result && (
                  <div className={`mt-1 flex items-center gap-1 text-[11px] ${result.ok ? 'text-emerald-600' : 'text-zinc-500'}`}>
                    {result.ok ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
                    {result.text}
                  </div>
                )}
              </button>
              <button
                type="button"
                onClick={() => void handleTest(cred)}
                disabled={isTesting}
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white hover:text-zinc-800 disabled:opacity-30"
                title="测试连接"
              >
                {isTesting ? <Loader2 size={13} className="animate-spin" /> : <Zap size={13} />}
              </button>
              <button
                type="button"
                onClick={() => startEdit(cred)}
                className="flex items-center gap-1.5 rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:border-zinc-300 hover:bg-zinc-50"
              >
                <Pencil size={13} />
                编辑
              </button>
              <button
                type="button"
                onClick={() => void handleDelete(cred)}
                className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-400 transition-colors hover:bg-white hover:text-zinc-800"
                title="删除凭证"
              >
                <Trash2 size={13} />
              </button>
            </div>
          );
        })}
        {credentials.length === 0 && (
          <div className="px-4 py-10 text-center text-xs text-zinc-400">
            暂无凭证。旧版本保存的密钥会在升级后自动迁移到这里。
          </div>
        )}
      </div>
    </div>
  );
}
