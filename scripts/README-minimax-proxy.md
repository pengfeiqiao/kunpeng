# MiniMax H3 标准协议转换服务

零第三方依赖的 Python HTTP 代理，把鲲鹏/APIMart 风格的标准异步视频协议转换成 AutoDL 的
MiniMax H3 ComfyUI 工作流接口（`minimax_h3_lightx2v_v5_15s`，图生视频）。

> 同一实现也镜像在 `/Users/adtiger/claw/minimax_h3_proxy/`，两处内容一致，改动请同步。

## 对外接口

```text
POST /v1/videos/generations     提交任务 → {code, data:[{task_id, status}]}
GET  /v1/tasks/{task_id}        查询任务 → {code, data:{status, progress, result.videos[]}}
GET  /healthz                   上游鉴权自检（无需本地密钥）
```

代理内部调用上游：

```text
POST /api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_v5_15s
GET  /api/v1/comfyui/comfyui_workflow/result/{task_id}
```

## 启动

代理**不内置任何密钥**，必须显式注入。推荐写到本地 env 文件（已被 `.gitignore` 的
`.env.*` 覆盖，权限 0600）：

```bash
# scripts/.env.minimax-proxy
MINIMAX_UPSTREAM_API_KEY=你的_AutoDL_密钥
```

```bash
cd /Users/adtiger/kunpeng
python3 scripts/minimax_comfyui_proxy.py
```

也可以用环境变量直接注入（环境变量优先于 env 文件）：

```bash
MINIMAX_UPSTREAM_API_KEY='***' MINIMAX_PROXY_PORT=8790 python3 scripts/minimax_comfyui_proxy.py
```

启动后会打印 `upstream=` 与 `key_fingerprint=`（密钥的 SHA256 前 8 位，不可逆），
用于确认“当前进程到底在用哪把密钥”。

### 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MINIMAX_PROXY_HOST` | `127.0.0.1` | 只监听本机 |
| `MINIMAX_PROXY_PORT` | `8790` | 见下方端口说明 |
| `MINIMAX_UPSTREAM_BASE_URL` | `https://autodl.art` | 注意不是 `www.autodl.art`（两者都可用，但以 `autodl.art` 为准） |
| `MINIMAX_UPSTREAM_API_KEY` | 无（必填） | 原始密钥，**不拼接 `Bearer`** |
| `MINIMAX_PROXY_API_KEY` | 空 | 本地访问密钥；为空则不校验（仅监听 127.0.0.1） |
| `MINIMAX_PROXY_TIMEOUT` | `180` | 上游超时（秒） |
| `MINIMAX_INLINE_REF_IMAGES` | `0` | 置 `1` 时把 http(s) 参考图下载并内联为 data URL |
| `MINIMAX_PROXY_ENV_FILE` | `scripts/.env.minimax-proxy` | env 文件路径 |

#### 端口为什么是 8790

* `8787` 已被 `agent-gateway/server.py` 占用；
* `8788` 与 `codex_api_server`（uvicorn）**重叠监听**，同一端口存在两个 LISTEN 时请求可能落到
  另一个进程，由对方返回它自己的 401 —— 这是排障中最容易误判的一类假故障。

代理启动前会做端口预检，若端口已有监听者会拒绝启动并提示换端口。

## 鲲鹏中的插件配置

```text
Base URL: http://127.0.0.1:8790
Protocol: 异步任务协议（task_id + 轮询）
Model ID: minimax-h3
API Key:  与 MINIMAX_PROXY_API_KEY 相同（未设置则留空）
```

## 标准请求示例

```json
{
  "model": "minimax-h3",
  "prompt": "人物自然转身，镜头缓慢推进，保持画面稳定",
  "duration": 5,
  "resolution": "480p横",
  "size": "16:9",
  "image_urls": ["https://example.com/reference.png"]
}
```

* 参考图支持 http(s) URL，也支持 `data:image/...;base64,...`，最多 9 张；
  也可以直接用工作流原生字段 `ref_image_0` 传入。
* 分辨率：`480p竖`/`480p横`/`768p竖`/`768p横`/`480p(1:1)`/`768p(1:1)`；
  其它值（如 `2K`、`720P`）按 `size` 比例退回 `480p` 档。
* 时长：工作流实际边界为 **5–15 秒**，超出会被夹到区间内。

## 排障：上游 401 `Invalid authentication credentials`

这是**唯一**与鉴权有关的报错，含义很明确：上游请求里的 `Authorization` 不是有效密钥。

已实测确认（2026-09-11 对 `https://autodl.art` 的真实请求）：

| 请求头 | 结果 |
| --- | --- |
| 仅 `Authorization` + `Content-Type` | **HTTP 200** |
| 加 `Bearer ` 前缀 | HTTP 200 |
| 加完整浏览器头（Origin/Referer/User-Agent/sec-ch-ua*/sec-fetch-*） | HTTP 200 |
| 带站点 Cookie | 非必需 |
| **不带 `Authorization`** | **HTTP 401 `Invalid authentication credentials`** |

结论：浏览器上下文头和 Cookie **都不是必需**的；出现该 401 只说明发出请求的那个进程用了
错误的密钥（或没带上密钥）。排查顺序：

1. `curl -s http://127.0.0.1:8790/healthz` — 若 `ok:false` 且 `reason=upstream_rejected_credentials`，
   直接看返回的 `key_fingerprint`，与预期密钥的指纹比对（`python3 -c "import hashlib;print(hashlib.sha256(b'密钥').hexdigest()[:8])"`）。
2. 确认没有第二个进程监听同一端口（`lsof -nP -iTCP:8790 -sTCP:LISTEN`）。
3. 确认 `MINIMAX_UPSTREAM_API_KEY` 没有被 shell 截断或带上了多余字符。

## 真实冒烟测试

`scripts/minimax_h3_live_check.mjs` 用鲲鹏**前端真实函数**跑一遍完整链路
（构造 payload → 标准协议提交 → 轮询 → 用前端函数解析 → 校验产物可下载），
链路中不出现任何 AutoDL 私有协议。

```bash
# 先启动适配服务，再执行
cd /Users/adtiger/kunpeng
node scripts/minimax_h3_live_check.mjs
```

> ⚠️ 每次运行都会真实提交一个视频任务并**产生费用**，因此**不进单测套件、不要接 CI**。
> 可用 `MINIMAX_PROXY_BASE`、`MINIMAX_LIVE_REF` 覆盖服务地址与参考图。

## 限制

* H3 为**图生视频**，必须至少提供一张参考图（`minimax_h3_lightx2v_no_pic` 是文生视频，不用于本接入）。
* 代理不缓存任务状态，查询直接转发上游。
* 尚未自动打包进 Tauri，需要先独立启动该 Python 服务。
