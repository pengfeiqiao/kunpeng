#!/usr/bin/env python3
"""把标准同步图片协议转换为 Pixhub 的 GPT Image 2.5 接口。

对外提供：
  POST /v1/images/generations     （标准同步图片协议，直接返回图片）
  GET  /healthz                   （上游鉴权自检，无需本地密钥）

Pixhub 把文生图与图生图拆成了两个端点，且图生图收 multipart 文件：

  无参考图 → POST {PIXHUB}/v1/images/generations   （JSON）
  有参考图 → POST {PIXHUB}/v1/images/edits         （multipart，image 字段可重复）

拆端点与 multipart 都是供应商私有细节，全部收在本服务内；前端只说标准协议。
上游响应原样回传（{data:[{url|b64_json}]}），前端解析逻辑无需改动。

实测契约（2026-09-11 真实请求）：
  * /v1/images/generations 与 /v1/images/edits 的成功响应结构一致：
    {"data":[{"revised_prompt":..., "url":"https://oss*.cxkedu.shop/..."}], "usage":..., ...}
  * multipart 字段 `image`（单图）与 `image[]`（多图）均返回 HTTP 200；
    本服务统一使用可重复的 `image`。
  * 缺少/错误的 Authorization 返回 401。
"""

from __future__ import annotations

import base64
import hashlib
import json
import mimetypes
import os
import re
import socket
import threading
import urllib.error
import urllib.parse
import urllib.request
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from typing import Any

DEFAULT_UPSTREAM = "https://pixhub.top"
DEFAULT_HOST = "127.0.0.1"
# 8787 = agent-gateway，8788 = codex_api_server（重叠监听），8790 = MiniMax H3 适配服务。
DEFAULT_PORT = 8791
DEFAULT_MODEL = "gpt-image-2.5"
GENERATIONS_PATH = "/v1/images/generations"
EDITS_PATH = "/v1/images/edits"
ENV_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".env.pixhub-proxy")
MAX_REFS = 16
MAX_REF_BYTES = 20 * 1024 * 1024
HEALTH_PATH = "/v1/models"

# 标准协议传的是比例或 auto；Pixhub 的 OpenAI 兼容 size 要像素值。
# 横竖各落到 1024 档（1536x1024 / 1024x1536 属 gpt-image 的 1K 档位）。
RATIO_TO_SIZE = {
    "1:1": "1024x1024",
    "3:2": "1536x1024", "4:3": "1536x1024", "5:4": "1536x1024",
    "16:9": "1536x1024", "2:1": "1536x1024", "3:1": "1536x1024", "21:9": "1536x1024",
    "2:3": "1024x1536", "3:4": "1024x1536", "4:5": "1024x1536",
    "9:16": "1024x1536", "1:2": "1024x1536", "1:3": "1024x1536", "9:21": "1024x1536",
}
PIXEL_SIZE_RE = re.compile(r"^\d{3,5}x\d{3,5}$", re.I)


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
        key, value = key.strip(), value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key:
            values[key] = value
    return values


def key_fingerprint(key: str) -> str:
    """密钥指纹：只用于识别“进程在用哪把密钥”，不可逆、不泄露原文。"""
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:8] if key else "none"


def normalize_size(value: Any) -> str | None:
    """比例 / auto / WxH → Pixhub 可接受的 size；无法识别则返回 None（交由上游用参考图尺寸）。"""
    text = str(value or "").strip()
    if not text:
        return None
    if PIXEL_SIZE_RE.match(text):
        return text.lower()
    if text.lower() == "auto":
        return "auto"
    return RATIO_TO_SIZE.get(text)


def _json_object(value: Any) -> dict[str, Any]:
    return value if isinstance(value, dict) else {}


def reference_urls(payload: dict[str, Any]) -> list[str]:
    """读取标准 payload 里的参考图（http(s) URL 或 data: URL）。"""
    raw = payload.get("image_urls")
    if not isinstance(raw, list):
        return []
    refs = [item.strip() for item in raw if isinstance(item, str) and item.strip()]
    if len(refs) > MAX_REFS:
        raise ValueError(f"参考图最多 {MAX_REFS} 张，当前 {len(refs)} 张")
    for ref in refs:
        if not ref.startswith("data:image/") and not ref.startswith(("http://", "https://")):
            raise ValueError("参考图必须是 data:image/... URL 或 http(s) URL")
    return refs


def fetch_reference(ref: str, timeout: float = 120.0) -> tuple[str, bytes]:
    """把参考图取回本地字节（multipart 必须传文件，不能传 URL）。"""
    if ref.startswith("data:"):
        header, _, encoded = ref.partition(",")
        ctype = header[5:].split(";")[0] or "image/png"
        try:
            return ctype, base64.b64decode(encoded)
        except (ValueError, TypeError) as exc:
            raise ValueError(f"参考图 data URL 解析失败: {exc}") from None
    request = urllib.request.Request(ref, headers={"User-Agent": "kunpeng-pixhub-proxy/1.0"})
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            data = response.read(MAX_REF_BYTES + 1)
            ctype = response.headers.get("Content-Type", "").split(";")[0].strip()
    except (urllib.error.URLError, TimeoutError) as exc:
        raise ValueError(f"参考图下载失败: {exc}") from None
    if len(data) > MAX_REF_BYTES:
        raise ValueError(f"参考图超过 {MAX_REF_BYTES // (1024 * 1024)}MB 限制")
    if not ctype.startswith("image/"):
        ctype = mimetypes.guess_type(urllib.parse.urlparse(ref).path)[0] or "image/png"
    return ctype, data


def build_multipart(fields: dict[str, Any], files: list[tuple[str, str, bytes]]) -> tuple[bytes, str]:
    """构造 multipart/form-data 请求体（files 为 (字段名, 文件名, 内容)）。"""
    boundary = "----kunpeng" + uuid.uuid4().hex
    chunks: list[bytes] = []
    for name, value in fields.items():
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"\r\n\r\n{value}\r\n'.encode()
        )
    for name, filename, data in files:
        ctype = mimetypes.guess_type(filename)[0] or "application/octet-stream"
        chunks.append(
            f'--{boundary}\r\nContent-Disposition: form-data; name="{name}"; filename="{filename}"\r\n'
            f"Content-Type: {ctype}\r\n\r\n".encode()
        )
        chunks.append(data)
        chunks.append(b"\r\n")
    chunks.append(f"--{boundary}--\r\n".encode())
    return b"".join(chunks), f"multipart/form-data; boundary={boundary}"


def build_upstream_request(payload: dict[str, Any], refs: list[str], *, default_model: str) -> dict[str, Any]:
    """决定走 generations 还是 edits，并给出上游请求的全部要素（纯函数）。

    字段保留原生类型：JSON 端点的 `n` 必须是数字（传字符串会被上游以
    `cannot unmarshal string into ... n of type uint` 拒绝），multipart 时才转字符串。
    """
    model = str(payload.get("model") or default_model).strip() or default_model
    fields: dict[str, Any] = {
        "model": model,
        "prompt": str(payload.get("prompt") or ""),
        "n": 1,  # Pixhub 要求固定 1
        "response_format": str(payload.get("response_format") or "url"),
    }
    size = normalize_size(payload.get("size") or payload.get("aspect_ratio"))
    if size:
        fields["size"] = size
    quality = str(payload.get("quality") or "").strip()
    if quality:
        fields["quality"] = quality
    return {"path": EDITS_PATH if refs else GENERATIONS_PATH, "fields": fields}


class ProxyError(RuntimeError):
    """上游请求或响应错误。"""


class HttpError(ProxyError):
    """带上游状态码的错误，便于按原状态回传。"""

    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status


class PixhubProxy:
    """无第三方依赖的标准图片协议 → Pixhub 转换服务。"""

    def __init__(self, *, upstream_base_url: str, api_key: str, default_model: str = DEFAULT_MODEL,
                 proxy_api_key: str = "", timeout: float = 300.0) -> None:
        if not upstream_base_url.strip():
            raise ValueError("PIXHUB_UPSTREAM_BASE_URL 不能为空")
        if not api_key.strip():
            raise ValueError("PIXHUB_API_KEY 不能为空（不提供内置密钥，必须显式注入）")
        self.upstream_base_url = upstream_base_url.rstrip("/")
        self.api_key = api_key
        self.default_model = default_model
        self.proxy_api_key = proxy_api_key
        self.timeout = timeout

    @property
    def key_fingerprint(self) -> str:
        return key_fingerprint(self.api_key)

    def _headers(self, content_type: str) -> dict[str, str]:
        # Pixhub 与本项目其它渠道一致，使用 Bearer 鉴权。
        return {"Authorization": f"Bearer {self.api_key}", "Content-Type": content_type, "Accept": "*/*"}

    def _call(self, method: str, path: str, data: bytes | None, content_type: str) -> tuple[int, dict[str, Any]]:
        request = urllib.request.Request(
            f"{self.upstream_base_url}{path}", data=data, method=method,
            headers=self._headers(content_type),
        )
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                status = getattr(response, "status", 200)
                raw = response.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode("utf-8", errors="replace")[:500]
            raise HttpError(exc.code, f"上游 HTTP {exc.code}: {detail}") from None
        except (urllib.error.URLError, TimeoutError) as exc:
            raise ProxyError(f"上游连接失败: {exc}") from None
        try:
            body = json.loads(raw)
        except json.JSONDecodeError:
            raise ProxyError(f"上游返回不是 JSON: {raw[:200]}") from None
        return status, _json_object(body)

    def generate(self, payload: dict[str, Any]) -> tuple[int, dict[str, Any]]:
        """标准同步图片请求 → Pixhub generations / edits，响应原样回传。"""
        refs = reference_urls(payload)
        plan = build_upstream_request(payload, refs, default_model=self.default_model)
        if refs:
            files = [("image", f"ref-{index}{_suffix(ctype)}", data)
                     for index, (ctype, data) in enumerate((fetch_reference(r) for r in refs), start=1)]
            data, content_type = build_multipart(plan["fields"], files)
        else:
            data, content_type = json.dumps(plan["fields"], ensure_ascii=False).encode(), "application/json"
        return self._call("POST", plan["path"], data, content_type)

    def health(self) -> dict[str, Any]:
        """真实打一次上游：200 说明鉴权可用，401 说明密钥不被接受。"""
        base = {"upstream": self.upstream_base_url, "key_fingerprint": self.key_fingerprint}
        try:
            status, body = self._call("GET", HEALTH_PATH, None, "application/json")
        except HttpError as exc:
            return {**base, "ok": False, "reason": classify_health(exc.status), "error": str(exc)}
        except ProxyError as exc:
            return {**base, "ok": False, "reason": "upstream_unreachable", "error": str(exc)}
        return {**base, "ok": status == 200, "reason": classify_health(status), "upstream_status": status}


def classify_health(status: int) -> str:
    """401 专门指向“Authorization 未被上游接受”。"""
    if status == 200:
        return "upstream_authenticated"
    if status == 401:
        return "upstream_rejected_credentials"
    return f"upstream_http_{status}"


def _suffix(content_type: str) -> str:
    return {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}.get(content_type, ".png")


class Handler(BaseHTTPRequestHandler):
    """实现标准同步图片协议，供鲲鹏自定义图片插件调用。"""

    def _send(self, status: int, body: dict[str, Any]) -> None:
        encoded = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def _proxy(self) -> PixhubProxy:
        return getattr(self.server, "proxy")

    def _authorized(self) -> bool:
        expected = self._proxy().proxy_api_key
        return not expected or self.headers.get("Authorization") == f"Bearer {expected}"

    def do_POST(self) -> None:  # noqa: N802
        if self.path != GENERATIONS_PATH:
            self._send(404, {"error": "not found"})
            return
        if not self._authorized():
            self._send(401, {"error": "unauthorized"})
            return
        try:
            length = int(self.headers.get("Content-Length", "0"))
            payload = _json_object(json.loads(self.rfile.read(length)))
            status, body = self._proxy().generate(payload)
            self._send(status, body)
        except (ValueError, json.JSONDecodeError) as exc:
            self._send(400, {"error": str(exc)})
        except HttpError as exc:
            self._send(exc.status, {"error": {"message": str(exc)}})
        except ProxyError as exc:
            self._send(502, {"error": {"message": str(exc)}})

    def do_GET(self) -> None:  # noqa: N802
        if self.path != "/healthz":
            self._send(404, {"error": "not found"})
            return
        try:
            self._send(200, self._proxy().health())
        except Exception as exc:  # keep diagnostics visible to curl and logs
            print(f"[pixhub-proxy] healthz exception: {type(exc).__name__}: {exc}", flush=True)
            self._send(502, {"ok": False, "reason": "healthz_exception", "error": str(exc)})

    def log_message(self, format: str, *args: Any) -> None:
        print(f"[pixhub-proxy] {format % args}", flush=True)


class ProxyServer(ThreadingHTTPServer):
    """带转换器实例的线程 HTTP 服务。"""

    def __init__(self, address: tuple[str, int], proxy: PixhubProxy) -> None:
        super().__init__(address, Handler)
        self.proxy = proxy


def port_in_use(host: str, port: int) -> bool:
    """预检端口：同端口已有监听者时，本机请求可能落到别的进程。"""
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as probe:
        probe.settimeout(1.0)
        return probe.connect_ex((host, port)) == 0


def resolve_settings(environ: dict[str, str] | None = None) -> dict[str, Any]:
    """解析配置：环境变量优先，其次本地 env 文件；不提供内置密钥。"""
    env = dict(os.environ if environ is None else environ)
    for key, value in load_env_file(env.get("PIXHUB_PROXY_ENV_FILE", ENV_FILE)).items():
        env.setdefault(key, value)
    return {
        "host": env.get("PIXHUB_PROXY_HOST", DEFAULT_HOST),
        "port": int(env.get("PIXHUB_PROXY_PORT", str(DEFAULT_PORT))),
        "upstream_base_url": env.get("PIXHUB_UPSTREAM_BASE_URL", DEFAULT_UPSTREAM),
        "api_key": env.get("PIXHUB_API_KEY", ""),
        "default_model": env.get("PIXHUB_DEFAULT_MODEL", DEFAULT_MODEL),
        "proxy_api_key": env.get("PIXHUB_PROXY_API_KEY", ""),
        "timeout": float(env.get("PIXHUB_PROXY_TIMEOUT", "300")),
    }


def main() -> None:
    """读取配置并启动本地适配服务。"""
    settings = resolve_settings()
    if not settings["api_key"]:
        raise SystemExit(
            "缺少 PIXHUB_API_KEY：请通过环境变量或 "
            f"{ENV_FILE}（已在 .gitignore 中）注入，服务不再内置任何密钥。"
        )
    if port_in_use(settings["host"], settings["port"]):
        raise SystemExit(
            f"端口 {settings['host']}:{settings['port']} 已有监听者，拒绝启动："
            "同一端口存在两个监听者时请求可能落到其它进程。请用 PIXHUB_PROXY_PORT 指定空闲端口。"
        )
    proxy = PixhubProxy(
        upstream_base_url=settings["upstream_base_url"],
        api_key=settings["api_key"],
        default_model=settings["default_model"],
        proxy_api_key=settings["proxy_api_key"],
        timeout=settings["timeout"],
    )
    print(f"[pixhub-proxy] listening on http://{settings['host']}:{settings['port']}", flush=True)
    print(f"[pixhub-proxy] upstream={proxy.upstream_base_url} key_fingerprint={proxy.key_fingerprint}", flush=True)
    with ProxyServer((settings["host"], settings["port"]), proxy) as server:
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            print("\n[pixhub-proxy] stopped")


if __name__ == "__main__":
    main()
