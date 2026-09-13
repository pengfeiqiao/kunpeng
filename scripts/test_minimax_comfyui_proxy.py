"""MiniMax H3 代理的纯函数测试。"""

from __future__ import annotations

import importlib.util
import os
import pathlib
import stat
import tempfile
import unittest


_PATH = pathlib.Path(__file__).with_name("minimax_comfyui_proxy.py")
_SPEC = importlib.util.spec_from_file_location("minimax_comfyui_proxy", _PATH)
assert _SPEC and _SPEC.loader
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)

DATA_URL = "data:image/jpeg;base64,QUJD"


class EnvAndFingerprintTests(unittest.TestCase):
    """配置来源与密钥指纹：不得内置密钥，指纹必须不可逆。"""

    def test_load_env_file_parses_and_ignores_noise(self) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as handle:
            handle.write('# comment\n\nMINIMAX_UPSTREAM_API_KEY="secret-value"\n')
            handle.write("MINIMAX_PROXY_PORT=9999\nbadline\n")
            path = handle.name
        try:
            values = _MODULE.load_env_file(path)
        finally:
            os.unlink(path)
        self.assertEqual(values["MINIMAX_UPSTREAM_API_KEY"], "secret-value")
        self.assertEqual(values["MINIMAX_PROXY_PORT"], "9999")
        self.assertNotIn("badline", values)

    def test_load_env_file_missing_path_is_empty(self) -> None:
        self.assertEqual(_MODULE.load_env_file("/nonexistent/env/file"), {})

    def test_key_fingerprint_hides_plaintext(self) -> None:
        fingerprint = _MODULE.key_fingerprint("super-secret-key")
        self.assertEqual(fingerprint, _MODULE.key_fingerprint("super-secret-key"))
        self.assertEqual(len(fingerprint), 8)
        self.assertNotIn("secret", fingerprint)
        self.assertEqual(_MODULE.key_fingerprint(""), "none")

    def test_resolve_settings_prefers_environment_over_file(self) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as handle:
            handle.write("MINIMAX_UPSTREAM_API_KEY=from-file\nMINIMAX_PROXY_PORT=1111\n")
            path = handle.name
        try:
            from_env = _MODULE.resolve_settings({
                "MINIMAX_PROXY_ENV_FILE": path,
                "MINIMAX_UPSTREAM_API_KEY": "from-env",
            })
            self.assertEqual(from_env["upstream_api_key"], "from-env")
            self.assertEqual(from_env["port"], 1111)
            self.assertEqual(from_env["host"], "127.0.0.1")
            self.assertFalse(from_env["inline_refs"])
            from_file = _MODULE.resolve_settings({"MINIMAX_PROXY_ENV_FILE": path})
            self.assertEqual(from_file["upstream_api_key"], "from-file")
        finally:
            os.unlink(path)

    def test_default_port_avoids_known_collision(self) -> None:
        # 8787 = agent-gateway，8788 = codex_api_server，都已被别的进程占用。
        self.assertNotIn(_MODULE.DEFAULT_PORT, (8787, 8788))

    def test_constructor_requires_explicit_key(self) -> None:
        with self.assertRaisesRegex(ValueError, "MINIMAX_UPSTREAM_API_KEY"):
            _MODULE.MiniMaxProxy(upstream_base_url="https://autodl.art", upstream_api_key="")
        with self.assertRaisesRegex(ValueError, "MINIMAX_UPSTREAM_BASE_URL"):
            _MODULE.MiniMaxProxy(upstream_base_url="  ", upstream_api_key="k")


class MiniMaxProxyMappingTests(unittest.TestCase):
    """验证标准请求与 AutoDL 请求/响应之间的转换。"""

    def test_build_payload_maps_standard_fields(self) -> None:
        payload = _MODULE.build_upstream_payload({
            "model": "minimax-h3",
            "prompt": "camera move",
            "duration": 5,
            "resolution": "2K",
            "size": "16:9",
            "image_urls": [" https://example.com/a.png "],
            "seed": 42,
        })
        self.assertEqual(payload["resolution"], "480p横")
        self.assertEqual(payload["ref_image_0"], "https://example.com/a.png")
        self.assertEqual(payload["seed"], 42)

    def test_duration_clamped_to_workflow_bounds(self) -> None:
        short = _MODULE.build_upstream_payload({"prompt": "p", "duration": 1, "image_urls": [DATA_URL]})
        self.assertEqual(short["duration"], _MODULE.DURATION_MIN)
        long = _MODULE.build_upstream_payload({"prompt": "p", "duration": 99, "image_urls": [DATA_URL]})
        self.assertEqual(long["duration"], _MODULE.DURATION_MAX)

    def test_accepts_data_url_and_direct_ref_image(self) -> None:
        by_image_urls = _MODULE.build_upstream_payload({"prompt": "p", "image_urls": [DATA_URL]})
        self.assertEqual(by_image_urls["ref_image_0"], DATA_URL)
        by_direct = _MODULE.build_upstream_payload({"prompt": "p", "ref_image_0": DATA_URL})
        self.assertEqual(by_direct["ref_image_0"], DATA_URL)

    def test_explicit_supported_resolution_passes_through(self) -> None:
        payload = _MODULE.build_upstream_payload({
            "prompt": "p", "image_urls": [DATA_URL], "resolution": "768p竖",
        })
        self.assertEqual(payload["resolution"], "768p竖")

    def test_requires_reference_image(self) -> None:
        with self.assertRaisesRegex(ValueError, "参考图"):
            _MODULE.build_upstream_payload({"prompt": "no image"})

    def test_rejects_non_image_reference(self) -> None:
        with self.assertRaisesRegex(ValueError, "参考图"):
            _MODULE.build_upstream_payload({"prompt": "p", "image_urls": ["ftp://nope/x.png"]})

    def test_normalizes_create_response(self) -> None:
        result = _MODULE.normalize_create_response({"data": {"task_id": "abc"}})
        self.assertEqual(result["data"][0]["task_id"], "abc")

    def test_normalizes_real_autodl_create_response(self) -> None:
        # 2026-09-11 真实响应结构
        result = _MODULE.normalize_create_response({
            "code": "Success",
            "data": {"task_id": "168dbbd1", "workflow": "H3多图生视频15秒", "status": "QUEUED"},
            "msg": "",
        })
        self.assertEqual(result["data"][0]["task_id"], "168dbbd1")

    def test_normalizes_completed_response(self) -> None:
        result = _MODULE.normalize_result_response({
            "data": {"status": "completed", "results": [{"url": "https://example.com/out.mp4"}]}
        })
        self.assertEqual(result["data"]["status"], "completed")
        self.assertEqual(result["data"]["result"]["videos"][0]["url"], "https://example.com/out.mp4")

    def test_normalizes_real_autodl_success_response(self) -> None:
        # 真实上游把状态大写为 SUCCESS，且 results 是对象数组
        result = _MODULE.normalize_result_response({
            "code": "Success",
            "data": {
                "status": "SUCCESS",
                "results": [{"type": "video", "alias": "final_video", "url": "https://cdn/out.mp4"}],
            },
        })
        self.assertEqual(result["data"]["status"], "completed")
        self.assertEqual(result["data"]["progress"], 100)
        self.assertEqual(result["data"]["result"]["videos"][0]["url"], "https://cdn/out.mp4")

    def test_queued_status_is_pending(self) -> None:
        result = _MODULE.normalize_result_response({"data": {"status": "QUEUED"}})
        self.assertEqual(result["data"]["status"], "pending")


class HealthClassificationTests(unittest.TestCase):
    """401 必须被明确判定为“密钥未被上游接受”。"""

    def test_ok(self) -> None:
        report = _MODULE.classify_health(200, {"code": "InternalError"})
        self.assertTrue(report["ok"])
        self.assertEqual(report["reason"], "upstream_authenticated")

    def test_unauthorized(self) -> None:
        report = _MODULE.classify_health(401, {})
        self.assertFalse(report["ok"])
        self.assertEqual(report["reason"], "upstream_rejected_credentials")
        self.assertIn("Authorization", report["hint"])

    def test_other_status(self) -> None:
        report = _MODULE.classify_health(503, {})
        self.assertFalse(report["ok"])
        self.assertEqual(report["reason"], "upstream_http_503")

    def test_health_probe_reports_401_without_leaking_key(self) -> None:
        proxy = _MODULE.MiniMaxProxy(upstream_base_url="https://example.invalid", upstream_api_key="secret-key-123")

        def boom(method: str, path: str, payload: dict | None = None) -> dict:
            raise _MODULE.ProxyError('上游 HTTP 401 鉴权失败（当前密钥指纹 deadbeef）：{"error":{"message":"Invalid authentication credentials"}}')

        proxy._request = boom  # type: ignore[method-assign]
        report = proxy.health()
        self.assertFalse(report["ok"])
        self.assertEqual(report["reason"], "upstream_rejected_credentials")
        self.assertNotIn("secret-key-123", str(report))
        self.assertEqual(report["key_fingerprint"], _MODULE.key_fingerprint("secret-key-123"))

    def test_health_probe_reports_connect_failure(self) -> None:
        proxy = _MODULE.MiniMaxProxy(upstream_base_url="https://example.invalid", upstream_api_key="k")
        report = proxy.health()
        self.assertFalse(report["ok"])
        self.assertNotEqual(report["reason"], "upstream_rejected_credentials")


class EnvFileSecurityTests(unittest.TestCase):
    """本地 env 文件必须位于 scripts/ 下、以 .env.minimax-proxy 结尾，且不可被其他用户读取。"""

    def test_env_file_lives_next_to_proxy_script(self) -> None:
        self.assertTrue(_MODULE.ENV_FILE.endswith(".env.minimax-proxy"))
        self.assertEqual(os.path.dirname(_MODULE.ENV_FILE), str(_PATH.parent))

    def test_env_file_is_not_world_readable_when_present(self) -> None:
        if not os.path.exists(_MODULE.ENV_FILE):
            self.skipTest("本地 env 文件尚未创建")
        mode = stat.S_IMODE(os.stat(_MODULE.ENV_FILE).st_mode)
        self.assertEqual(mode & 0o077, 0, f"env 文件权限过宽: {oct(mode)}")


if __name__ == "__main__":
    unittest.main()
