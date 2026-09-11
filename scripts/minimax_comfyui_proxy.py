#!/usr/bin/env python3
"""将标准视频任务协议转换为 AutoDL MiniMax ComfyUI 接口。

对外提供：
  POST /v1/videos/generations
  GET  /v1/tasks/{task_id}
  GET  /healthz                 （上游鉴权自检，无需本地密钥）

上游使用 AutoDL 契约：
  POST /api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_v5_15s
  GET  /api/v1/comfyui/comfyui_workflow/result/{task_id}

已验证的上游行为（2026-09-11 真实请求）：
  * 鉴权只需要 `Authorization: <KEY>`（原始值，无需 Bearer）与 Content-Type；
    浏览器上下文头（Origin/Referer/User-Agent/sec-ch-ua*/sec-fetch-*）和站点 Cookie
    均非必需 —— 最小请求头实测返回 HTTP 200。
  * 上游在缺少/无法识别 Authorization 时返回：
    HTTP 401 {"error":{"message":"Invalid authentication credentials","type":"invalid_request_error"}}
    因此出现该 401 即代表“上游请求头里的密钥不对”，不代表协议或 Cookie 问题。
  * 创建成功响应为 {"code":"Success","data":{"task_id":...,"status":"QUEUED",...}}。
  * 结果查询响应为 {"code":"Success","data":{"status":"SUCCESS","results":[{"url":...}]}}。

服务只做请求转发与协议转换，不保存任务状态；状态与产物由 AutoDL 返回。
"""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

DEFAULT_UPSTREAM = "https://autodl.art"
DEFAULT_HOST = "127.0.0.1"
# 8787 被 agent-gateway/server.py 占用；8788 与 codex_api_server 重叠（同一端口存在两个
# 监听者，请求可能落到另一个进程并返回它自己的 401），因此默认使用独立端口 8790。
DEFAULT_PORT = 8790
CREATE_PATH = "/api/v1/comfyui/comfyui_workflow/minimax_h3_lightx2v_v5_15s"
RESULT_PATH = "/api/v1/comfyui/comfyui_workflow/result/"
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env.minimax-proxy")
# H3 工作流的真实边界：分辨率仅 2K 档位、时长 5–15 秒、参考图 <= 9 张。
DURATION_MIN, DURATION_MAX = 5, 15
MAX_REF_BYTES = 20 * 1024 * 1024
HEALTH_PROBE_TASK_ID = "00000000-0000-0000-0000-000000000000"


def load_env_file(path: str) -> dict[str, str]:
    """解析简单的 KEY=VALUE 环境文件（跳过空行与 # 注释），不修改进程环境。"""
    values: dict[str, str] = {}
    try:
        with open(path, "r", encoding="utf-8") as handle:
            lines = handle.readlines()
    except OSError:
        return values
    for line in lines:
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        values[key] = value
    return values


def key_fingerprint(key: str) -> str:
    """密钥指纹：只用于区分“进程实际用的是哪把密钥”，不可逆、不泄露原文。"""
    if not key:
        return "none"
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:8]


def _json_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def _reference_images(payload: dict[str, Any]) -> list[str]:
    """读取工作流需要的参考图：支持 data URL、http(s) URL 与 ref_image_N 直传。"""
    refs: list[str] = []
    direct = payload.get("ref_image_0")
    if isinstance(direct, str) and direct.strip():
        refs.append(direct.strip())
    image_urls = payload.get("image_urls")
    if isinstance(image_urls, list):
        refs.extend(item.strip() for item in image_urls if isinstance(item, str) and item.strip())
    refs = list(dict.fromkeys(refs))[:9]
    if not refs:
        raise ValueError("MiniMax H3 LightX2V 至少需要一张参考图")
    for ref in refs:
        if not ref.startswith("data:image/") and not ref.startswith(("http://", "https://")):
            raise ValueError("参考图必须是 data:image/... URL 或 http(s) URL")
    return refs


def inline_reference(ref: str, timeout: float = 60.0) -> str:
    """把 http(s) 参考图下载并转成 data URL（AutoDL 工作流原生接受 data URL）。"""
    if ref.startswith("data:"):
        return ref
    request = urllib.request.Request(ref, headers={"User-Agent": "kunpeng-minimax-proxy/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read(MAX_REF_BYTES + 1)
            content_type = response.headers.get("Content-Type", "").split(";")[0].strip()
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ValueError(f"参考图下载失败: {exc}") from None
    if len(raw) > MAX_REF_BYTES:
        raise ValueError(f"参考图超过 {MAX_REF_BYTES // (1024 * 1024)}MB 限制")
    if not content_type.startswith("image/"):
        content_type = mimetypes.guess_type(urllib.parse.urlparse(ref).path)[0] or "image/png"
    return f"data:{content_type};base64,{base64.b64encode(raw).decode('ascii')}"


SUPPORTED_RESOLUTIONS = ("480p竖", "480p横", "480p(1:1)", "768p竖", "768p横", "768p(1:1)")


def _resolution_for(ratio: str, requested: str) -> str:
    if requested in SUPPORTED_RESOLUTIONS:
        return requested
    orientation = {"9:16": "竖", "16:9": "横", "1:1": "(1:1)"}.get(ratio, "横")
    # 标准协议常用 2K/720P 等档位，这里按画面比例退回到工作流可识别的 480p 档。
    return f"480p{orientation}"


def build_upstream_payload(payload: dict[str, Any], *, inline_refs: bool = False) -> dict[str, Any]:
    """把标准视频请求映射成 AutoDL MiniMax H3 请求。"""
    refs = _reference_images(payload)
    if inline_refs:
        refs = [inline_reference(ref) for ref in refs]

    ratio = str(payload.get("size") or payload.get("aspect_ratio") or "16:9")
    requested = str(payload.get("resolution") or "").strip()
    resolution = _resolution_for(ratio, requested)

    try:
        duration = round(float(payload.get("duration", DURATION_MIN)))
    except (TypeError, ValueError):
        duration = DURATION_MIN
    duration = min(DURATION_MAX, max(DURATION_MIN, duration))

    result: dict[str, Any] = {
        "prompt": str(payload.get("prompt") or ""),
        "duration": duration,
        "resolution": resolution,
    }
    for index, url in enumerate(refs):
        result[f"ref_image_{index}"] = url
    if payload.get("seed") is not None:
        try:
            result["seed"] = int(payload["seed"])
        except (TypeError, ValueError) as exc:
            raise ValueError("seed 必须是整数") from exc
    return result


def normalize_create_response(body: dict[str, Any]) -> dict[str, Any]:
    """将上游创建响应统一为标准异步任务收据。"""
    data = _json_object(body.get("data"))
    task_id = data.get("task_id") or body.get("task_id") or data.get("id") or body.get("id")
    if not isinstance(task_id, str) or not task_id:
        raise ValueError(f"上游创建响应缺少 task_id: {body!r}")
    return {"code": 200, "data": [{"task_id": task_id, "status": "submitted"}]}


def _collect_urls(value: Any, result: list[str]) -> None:
    if isinstance(value, str) and value.startswith(("http://", "https://")):
        result.append(value)
    elif isinstance(value, list):
        for item in value:
            _collect_urls(item, result)
    elif isinstance(value, dict):
        for key, child in value.items():
            if key.lower() in {"url", "urls", "video", "videos", "results", "result", "outputs", "output_url", "video_url"}:
                _collect_urls(child, result)


def normalize_result_response(body: dict[str, Any]) -> dict[str, Any]:
    """将 AutoDL 状态映射为 APIMart 风格的标准任务响应。"""
    source = _json_object(body.get("data")) or body
    raw_status = str(source.get("status") or "").lower()
    if raw_status in {"completed", "complete", "success", "succeeded"}:
        status = "completed"
    elif raw_status in {"failed", "failure", "error", "cancelled", "canceled"}:
        status = "failed"
    else:
        status = "running" if raw_status in {"running", "processing"} else "pending"

    urls: list[str] = []
    _collect_urls(source.get("results"), urls)
    if not urls:
        _collect_urls(source.get("result"), urls)
    urls = list(dict.fromkeys(urls))

    output: dict[str, Any] = {
        "code": 200,
        "data": {
            "status": status,
            "progress": 100 if status == "completed" else source.get("progress", 0),
            "result": {"videos": [{"url": url} for url in urls]} if urls else {},
        },
    }
    if status == "failed":
        output["data"]["error_message"] = str(source.get("error") or source.get("message") or "MiniMax 任务失败")
    return output


def classify_health(status: int, body: dict[str, Any]) -> dict[str, Any]:
    """把上游自检结果分类成可读结论。401 专门指向“Authorization 未被接受”。"""
    if status == 200:
        return {"ok": True, "reason": "upstream_authenticated"}
    if status == 401:
        return {"ok": False, "reason": "upstream_rejected_credentials",
                "hint": "上游返回 401 Invalid authentication credentials：进程实际发送的 Authorization 不是有效密钥。"}
    return {"ok": False, "reason": f"upstream_http_{status}"}


class ProxyError(RuntimeError):
    """上游请求或响应错误。"""


class MiniMaxProxy:
    """无第三方依赖的 HTTP 转换代理。"""

    def __init__(self, *, upstream_base_url: str, upstream_api_key: str, proxy_api_key: str = "",
                 timeout: float = 180.0, inline_refs: bool = False) -> None:
        if not upstream_base_url.strip():
            raise ValueError("MINIMAX_UPSTREAM_BASE_URL 不能为空")
        if not upstream_api_key.strip():
            raise ValueError("MINIMAX_UPSTREAM_API_KEY 不能为空（不提供内置密钥，必须显式注入）")
        self.upstream_base_url = upstream_base_url.rstrip("/")
        self.upstream_api_key = upstream_api_key
        self.proxy_api_key = proxy_api_key
        self.timeout = timeout
        self.inline_refs = inline_refs

    @property
    def key_fingerprint(self) -> str:
        return key_fingerprint(self.upstream_api_key)

    def _request(self, method: str, path: str, payload: dict[str, Any] | None = None) -> dict[str, Any]:
        data = json.dumps(payload, ensure_ascii=False).encode() if payload is not None else None
        # 只发送实测必需的最小请求头：Authorization 用原始密钥（不拼接 Bearer）。
        request = urllib.request.Request(
            f"{self.upstream_base_url}{path}",
            data=data,
            method=method,
            headers={"Authorization": self.upstream_api_key, "Content-Type": "application/json", "Accept": "*/*"},
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read().decode("utf-8")
                status = getattr(response, "status", 200)
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            if exc.code == 401:
                raise ProxyError(
                    f"上游 HTTP 401 鉴权失败（当前密钥指纹 {self.key_fingerprint}）：{detail}"
                ) from None
            raise ProxyError(f"上游 HTTP {exc.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError) as exc:
            raise ProxyError(f"上游连接失败: {exc}") from None
        try:
            body = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise ProxyError("上游返回不是 JSON") from exc
        if not isinstance(body, dict):
            raise ProxyError("上游返回不是 JSON 对象")
        if status != 200:
            raise ProxyError(f"上游 HTTP {status}: {raw[:500]}")
        return body

    def create(self, payload: dict[str, Any]) -> dict[str, Any]:
        upstream = build_upstream_payload(payload, inline_refs=self.inline_refs)
        return normalize_create_response(self._request("POST", CREATE_PATH, upstream))

    def result(self, task_id: str) -> dict[str, Any]:
        return normalize_result_response(self._request("GET", f"{RESULT_PATH}{urllib.parse.quote(task_id, safe='')}"))

    def health(self) -> dict[str, Any]:
        """真实打一次上游查询接口：HTTP 200 说明鉴权可用，401 说明密钥不被接受。"""
        status = 200
        try:
            body = self._request("GET", f"{RESULT_PATH}{HEALTH_PROBE_TASK_ID}")
        except ProxyError as exc:
            message = str(exc)
            status = 401 if "HTTP 401" in message else 0
            report = classify_health(status, {})
            report.update({
                "upstream": self.upstream_base_url,
                "key_fingerprint": self.key_fingerprint,
                "error": message,
            })
            return report
        report = classify_health(status, body)
        report.update({
            "upstream": self.upstream_base_url,
            "key_fingerprint": self.key_fingerprint,
            "upstream_code": body.get("code"),
        })
        return report


class Handler(BaseHTTPRequestHandler):
    """实现标准任务 API，供鲲鹏自定义视频插件调用。"""

    def _send(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _authorized(self) -> bool:
        expected = getattr(self.server, "proxy").proxy_api_key
        return not expected or self.headers.get("Authorization") == f"Bearer {expected}"

    def do_POST(self) -> None:  # noqa: N802
        if self.path != "/v1/videos/generations":
            self._send(404, {"error": "not found"})
            return
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            body = json.loads(self.rfile.read(length))
            result = getattr(self.server, "proxy").create(_json_object(body))
            self._send(200, result)
        except (ValueError, json.JSONDecodeError) as exc:
            self._send(400, {"error": str(exc)})
        except ProxyError as exc:
            self._send(502, {"error": str(exc)})

    def do_GET(self) -> None:  # noqa: N802
        if self.path == "/healthz":
            try:
                self._send(200, getattr(self.server, "proxy").health())
            except Exception as exc:  # keep diagnostics visible to curl and logs
                print(f"[minimax-proxy] healthz exception: {type(exc).__name__}: {exc}", flush=True)
                self._send(502, {"ok": False, "reason": "healthz_exception", "error": str(exc)})
            return
        prefix = "/v1/tasks/"
        if not self.path.startswith(prefix):
            self._send(404, {"error": "not found"})
            return
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return
        task_id = urllib.parse.unquote(self.path[len(prefix):])
        if not task_id:
            self._send(400, {"error": "task_id is required"})
            return
        try:
            self._send(200, getattr(self.server, "proxy").result(task_id))
        except ProxyError as exc:
            self._send(502, {"error": str(exc)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[minimax-proxy] {format % args}", flush=True)


class ProxyServer(ThreadingHTTPServer):
    """带转换器实例的线程 HTTP 服务。"""

    def __init__(self, address: tuple[str, int], proxy: MiniMaxProxy) -> None:
        super().__init__(address, Handler)
        self.proxy = proxy


def port_in_use(host: str, port: int) -> bool:
    """预检端口：同一端口若已有监听者，本机请求可能落到别的进程。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1.0)
        return probe.connect_ex((host, port)) == 0


def resolve_settings(environ: dict[str, str] | None = None) -> dict[str, Any]:
    """解析配置：环境变量优先，其次本地 env 文件；不提供内置密钥。"""
    env = dict(os.environ if environ is None else environ)
    file_values = load_env_file(env.get("MINIMAX_PROXY_ENV_FILE", ENV_FILE))
    for key, value in file_values.items():
        env.setdefault(key, value)
    return {
        "host": env.get("MINIMAX_PROXY_HOST", DEFAULT_HOST),
        "port": int(env.get("MINIMAX_PROXY_PORT", str(DEFAULT_PORT))),
        "upstream_base_url": env.get("MINIMAX_UPSTREAM_BASE_URL", DEFAULT_UPSTREAM),
        "upstream_api_key": env.get("MINIMAX_UPSTREAM_API_KEY", ""),
        "proxy_api_key": env.get("MINIMAX_PROXY_API_KEY", ""),
        "timeout": float(env.get("MINIMAX_PROXY_TIMEOUT", "180")),
        "inline_refs": env.get("MINIMAX_INLINE_REF_IMAGES", "0").strip().lower() in {"1", "true", "yes", "on"},
    }


def main() -> None:
    """读取配置并启动本地代理。"""
    settings = resolve_settings()
    if not settings["upstream_api_key"]:
        raise SystemExit(
            "缺少 MINIMAX_UPSTREAM_API_KEY：请通过环境变量或 "
            f"{ENV_FILE}（已在 .gitignore 中）注入，代理不再内置任何密钥。"
        )
    if port_in_use(settings["host"], settings["port"]):
        raise SystemExit(
            f"端口 {settings['host']}:{settings['port']} 已有监听者，拒绝启动："
            "同一端口存在两个监听者时请求可能落到其它进程（这正是历史上偶发 401 的来源）。"
            "请换用 MINIMAX_PROXY_PORT 指定的空闲端口。"
        )
    proxy = MiniMaxProxy(
        upstream_base_url=settings["upstream_base_url"],
        upstream_api_key=settings["upstream_api_key"],
        proxy_api_key=settings["proxy_api_key"],
        timeout=settings["timeout"],
        inline_refs=settings["inline_refs"],
    )
    print(f"[minimax-proxy] listening on http://{settings['host']}:{settings['port']}", flush=True)
    print(f"[minimax-proxy] upstream={proxy.upstream_base_url} key_fingerprint={proxy.key_fingerprint}", flush=True)
    print(f"[minimax-proxy] inline_ref_images={proxy.inline_refs}", flush=True)
    with ProxyServer((settings["host"], settings["port"]), proxy) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[minimax-proxy] stopped")


if __name__ == "__main__":
    main()
