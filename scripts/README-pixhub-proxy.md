# Pixhub 图片标准协议转换服务

零第三方依赖的 Python 服务，把**标准同步图片协议**转换成 Pixhub 的 GPT Image 2.5 接口。

存在的理由：Pixhub 把文生图和图生图**拆成了两个端点**，而且图生图收的是 **multipart 文件**，
不是 URL —— 这些都是供应商私有细节，不应该散进前端，于是统一收口在这个服务里。

## 对外接口

```text
POST /v1/images/generations     标准同步图片协议，直接返回 {data:[{url|b64_json}]}
GET  /healthz                   上游鉴权自检（无需本地密钥）
```

内部按有无参考图分流：

| 入参 | 上游 | 形式 |
| --- | --- | --- |
| 无 `image_urls` | `POST {PIXHUB}/v1/images/generations` | JSON |
| 有 `image_urls` | `POST {PIXHUB}/v1/images/edits` | multipart（`image` 字段可重复） |

上游响应**原样回传**，前端 `parseOpenaiImagesResponse` 无需改动。

## 启动

服务**不内置任何密钥**，必须显式注入。推荐写本地 env 文件（已被 `.gitignore` 的
`.env.*` 覆盖，权限 0600）：

```bash
# scripts/.env.pixhub-proxy
PIXHUB_API_KEY=你的_Pixhub_密钥
```

```bash
cd /Users/adtiger/kunpeng
python3 scripts/pixhub_images_proxy.py
```

启动日志会打印 `upstream=` 与 `key_fingerprint=`（密钥 SHA256 前 8 位，不可逆）。

### 配置项

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PIXHUB_PROXY_HOST` | `127.0.0.1` | 只监听本机 |
| `PIXHUB_PROXY_PORT` | `8791` | 8787/8788/8790 已被占用，见下 |
| `PIXHUB_UPSTREAM_BASE_URL` | `https://pixhub.top` | 上游域名，不带路径 |
| `PIXHUB_API_KEY` | 无（必填） | Bearer 鉴权 |
| `PIXHUB_DEFAULT_MODEL` | `gpt-image-2.5` | 请求未带 model 时使用 |
| `PIXHUB_PROXY_API_KEY` | 空 | 本地访问密钥；为空则不校验（仅监听 127.0.0.1） |
| `PIXHUB_PROXY_TIMEOUT` | `300` | 上游超时（秒） |
| `PIXHUB_PROXY_ENV_FILE` | `scripts/.env.pixhub-proxy` | env 文件路径 |

#### 端口约定（同一台机器）

| 端口 | 占用者 |
| --- | --- |
| 8787 | `agent-gateway/server.py` |
| 8788 | `codex_api_server`（与别的进程**重叠监听**，最坑） |
| 8790 | MiniMax H3 适配服务 |
| **8791** | **本服务** |

服务启动前会做端口预检，端口被占用时拒绝启动。

## 鲲鹏中的插件配置

```text
Base URL: http://127.0.0.1:8791
Protocol: OpenAI Images 同步协议        ← 不要选「异步任务协议」
Model ID: gpt-image-2.5
API Key:  必填（任何非空占位符即可，例如 local；本服务默认不校验本地密钥）
```

## 标准请求示例

```json
{
  "model": "gpt-image-2.5",
  "prompt": "把背景换成纯白，保持主体不变",
  "n": 1,
  "size": "9:16",
  "image_urls": ["https://example.com/ref.png"]
}
```

* `size` 支持比例（`1:1`/`16:9`/`9:16`/`3:4`…）、`auto`，也支持直接给 `WxH`。
  比例会被换成本地映射的像素值（`1:1 → 1024x1024`、`9:16 → 1024x1536`、`16:9 → 1536x1024`）；
  **无法识别的比例不传 size**，交由上游沿用参考图尺寸。
* `image_urls` 支持 http(s) URL 与 `data:image/...;base64,...`，最多 16 张。
  服务会把每张图下载成字节再以 multipart 上传——这是这个服务存在的核心原因。

## 实测契约（2026-09-11 真实请求）

| 请求 | 结果 |
| --- | --- |
| `POST /v1/images/generations`（JSON，无图） | HTTP 200，`{"data":[{"revised_prompt":…,"url":"https://oss*.cxkedu.shop/….png"}]}` |
| `POST /v1/images/edits`，字段 `image` ×1 | HTTP 200，响应结构与上面一致 |
| `POST /v1/images/edits`，字段 `image[]` ×2 | HTTP 200，响应结构与上面一致 |
| `GET /v1/models` 带 key / 不带 key | 200 / **401** |

> 注意：`/healthz` 用的是 `GET /v1/models` 作为探针 —— 它便宜且能区分 401，**不消耗生图额度**。

## 排障

```bash
curl -s http://127.0.0.1:8791/healthz
# {"ok": true, "reason": "upstream_authenticated", "key_fingerprint": "e4238dbc", ...}
```

* `reason=upstream_rejected_credentials` → 密钥不对，比对 `key_fingerprint`。
* `reason=upstream_unreachable` → 网络/域名问题。
* 返回 401 `{"error": "unauthorized"}` → 是**本地**密钥不对（`PIXHUB_PROXY_API_KEY` 设了但你填的不一致）。

## 限制

* 上游同步返回，没有 task_id，因此**没有轮询**；超时由 `PIXHUB_PROXY_TIMEOUT` 控制。
* 参考图需先能被本机访问（鲲鹏会把本地文件上传成公网 URL 后传进来）。
* 尚未自动打包进 Tauri，需要先独立启动该 Python 服务。
