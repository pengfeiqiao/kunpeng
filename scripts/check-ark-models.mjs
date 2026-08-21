#!/usr/bin/env node
/**
 * Ark 模型注册表发布前校验（09 文档 §3.3）。
 *
 * - 无 ARK_API_KEY：只做静态校验（id 形式、status/modality/tier 合法、无重复），
 *   格式错误 exit 1。
 * - 有 ARK_API_KEY：追加调用方舟 `GET {baseUrl}/api/v3/models` 在线比对，
 *   对「目录里查无此 ID」的项打 warning（不阻断，exit 0），
 *   防止目录接口波动误伤构建。
 *
 * 安全约束：绝不打印 API Key 本体（只读环境变量，不回显）。
 */

import { ARK_MODELS } from '../src/lib/channels/arkModels.ts';

const ARK_BASE_URL = (process.env.ARK_BASE_URL || 'https://ark.cn-beijing.volces.com').replace(/\/+$/, '');
const ARK_API_KEY = process.env.ARK_API_KEY || '';

const ID_PATTERN = /^doubao-(seedance|seedream)-[a-z0-9-]+$/;
const VALID_STATUS = new Set(['published', 'retiring']);
const VALID_MODALITY = new Set(['video', 'image']);
const VALID_TIER = new Set(['flagship', 'fast', 'cheap', 'standard', 'legacy']);

let failed = false;
const errors = [];
const warnings = [];

// ── 静态校验 ──────────────────────────────────────────────────────────────
const seen = new Set();
for (const m of ARK_MODELS) {
  if (!m || typeof m.id !== 'string' || !ID_PATTERN.test(m.id)) {
    errors.push(`id 形式非法: ${JSON.stringify(m?.id)}`);
    continue;
  }
  if (seen.has(m.id)) errors.push(`重复 id: ${m.id}`);
  seen.add(m.id);
  if (!VALID_STATUS.has(m.status)) errors.push(`${m.id}: status 非法 (${m.status})`);
  if (!VALID_MODALITY.has(m.modality)) errors.push(`${m.id}: modality 非法 (${m.modality})`);
  if (!VALID_TIER.has(m.tier)) errors.push(`${m.id}: tier 非法 (${m.tier})`);
  if (!m.label) errors.push(`${m.id}: 缺少 label`);
  const wantModality = m.id.startsWith('doubao-seedance-') ? 'video' : 'image';
  if (m.modality !== wantModality) errors.push(`${m.id}: modality 应为 ${wantModality}`);
}

if (errors.length > 0) {
  console.error('❌ Ark 注册表静态校验失败：');
  for (const e of errors) console.error(`  - ${e}`);
  failed = true;
} else {
  console.log(`✅ 静态校验通过：${ARK_MODELS.length} 个模型（含 ${ARK_MODELS.filter((m) => m.status === 'retiring').length} 个 retiring）`);
}

// ── 在线比对（可选，warning 不阻断）────────────────────────────────────────
if (!failed && ARK_API_KEY) {
  const base = ARK_BASE_URL.endsWith('/api/v3') ? ARK_BASE_URL : `${ARK_BASE_URL}/api/v3`;
  try {
    const resp = await fetch(`${base}/models`, {
      headers: { Authorization: `Bearer ${ARK_API_KEY}` },
    });
    if (!resp.ok) {
      warnings.push(`方舟模型列表请求返回 HTTP ${resp.status}，跳过在线比对`);
    } else {
      const body = await resp.json();
      const remote = new Set(
        (Array.isArray(body?.data) ? body.data : [])
          .map((m) => m?.id)
          .filter((id) => typeof id === 'string'),
      );
      for (const m of ARK_MODELS) {
        if (remote.has(m.id)) continue;
        // retiring 模型从目录消失是预期行为，降级为提示
        const msg = `${m.id}: 方舟目录里查无此 ID`;
        if (m.status === 'retiring') console.log(`ℹ️  ${msg}（retiring，预期内）`);
        else warnings.push(msg);
      }
      console.log(`✅ 在线比对完成：目录共 ${remote.size} 个模型`);
    }
  } catch (err) {
    warnings.push(`在线比对失败：${err instanceof Error ? err.message : String(err)}`);
  }
} else if (!ARK_API_KEY) {
  console.log('ℹ️  未设置 ARK_API_KEY，跳过在线比对');
}

for (const w of warnings) console.warn(`⚠️  ${w}`);
// warning 不阻断构建；只有静态格式错误才失败
process.exit(failed ? 1 : 0);
