/**
 * MiniMax H3 全链路真实冒烟测试（手动运行，不进单测套件）。
 *
 * 用鲲鹏**前端真实函数**构造请求 → 标准异步协议 → 本地适配服务 → AutoDL ComfyUI 工作流
 * → 轮询 → 用前端真实解析函数解析 → 校验产物可下载。链路中不出现任何供应商私有协议。
 *
 * 前置条件：
 *   1) 适配服务已启动：python3 scripts/minimax_comfyui_proxy.py（默认 127.0.0.1:8790）
 *   2) scripts/.env.minimax-proxy 中已注入 MINIMAX_UPSTREAM_API_KEY
 *
 * 运行：
 *   node scripts/minimax_h3_live_check.mjs
 *
 * ⚠️ 每次运行都会向 AutoDL 真实提交一个视频任务并**产生实际费用**，不要把本脚本接入 CI。
 */
import assert from 'node:assert/strict';
import { buildCustomVideoPayload, customSubmitPath, customQueryPath, parseCustomTaskId }
  from '../src/lib/customMedia/payload.ts';
import { parseApimartTask } from '../src/lib/apimart/contracts.ts';

const BASE = process.env.MINIMAX_PROXY_BASE || 'http://127.0.0.1:8790';
const REF = process.env.MINIMAX_LIVE_REF
  || 'https://cdn-yxu7zakna342.vultrcdn.com/results/api/2026/09/11/20260911_e57119e1e9.png';
const api = { kind: 'video', protocol: 'apimart-async', modelId: 'minimax-h3', label: 'MiniMax H3' };

const log = (label, detail) => console.log(`[${label}] ${detail}`);

// ── 1) 适配服务 + 上游鉴权自检 ────────────────────────────────
const health = await (await fetch(`${BASE}/healthz`)).json();
log('healthz', JSON.stringify(health));
assert.equal(health.ok, true, `上游鉴权自检未通过：${JSON.stringify(health)}`);
assert.equal(health.reason, 'upstream_authenticated');

// ── 2) 前端真实函数构造标准 payload ───────────────────────────
const payload = buildCustomVideoPayload({ modelId: api.modelId }, {
  prompt: '人物自然转身，镜头缓慢推进，保持画面稳定',
  imageUrls: [REF],
  duration: 5,
  resolution: '480p横',
  aspectRatio: '16:9',
});
log('payload', JSON.stringify(payload));
assert.deepEqual(payload.image_urls, [REF], '前端 payload 未带上参考图');

// ── 3) 标准协议提交 ──────────────────────────────────────────
const submitUrl = `${BASE}${customSubmitPath(api)}`;
log('submit', `POST ${submitUrl}`);
const submitRes = await fetch(submitUrl, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(payload),
});
const submitBody = await submitRes.json();
log('submit-http', `${submitRes.status} ${JSON.stringify(submitBody)}`);
assert.equal(submitRes.ok, true, '提交失败');

const taskId = parseCustomTaskId(submitBody);
assert.ok(taskId, '前端 parseCustomTaskId 未能解析出 task_id');
log('task_id', taskId);

// ── 4) 轮询 + 前端真实状态解析 ────────────────────────────────
const started = Date.now();
let state = { status: 'pending', urls: [] };
for (;;) {
  const res = await fetch(`${BASE}${customQueryPath(api, taskId)}`);
  const body = await res.json();
  state = parseApimartTask(body, 'video');
  log('poll', `HTTP ${res.status} → parseApimartTask=${state.status}`
    + ` progress=${state.progress ?? '-'} elapsed=${Math.round((Date.now() - started) / 1000)}s`);
  if (state.status === 'succeeded' || state.status === 'failed') break;
  if (Date.now() - started > 8 * 60_000) throw new Error('轮询超时');
  await new Promise((resolve) => setTimeout(resolve, 10_000));
}

assert.equal(state.status, 'succeeded', `任务未成功: ${state.error ?? ''}`);
assert.ok(state.urls.length > 0, '前端未解析出产物 URL');
log('urls', state.urls.join('\n       '));

// ── 5) 产物可下载（Range GET）────────────────────────────────
const artifact = await fetch(state.urls[0], { headers: { Range: 'bytes=0-2047' } });
const bytes = new Uint8Array(await artifact.arrayBuffer());
log('artifact', `HTTP ${artifact.status} type=${artifact.headers.get('content-type')} bytes=${bytes.length}`);
assert.ok(artifact.ok || artifact.status === 206, `产物不可下载: HTTP ${artifact.status}`);
assert.ok(bytes.length > 0, '产物内容为空');

console.log('\n✅ 全链路真实测试通过：前端函数 → 标准协议 → 适配服务 → AutoDL H3 → 产物');
