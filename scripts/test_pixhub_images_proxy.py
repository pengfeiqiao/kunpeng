"""Pixhub 图片适配服务的纯函数测试。"""

from __future__ import annotations

import base64
import importlib.util
import json
import os
import pathlib
import stat
import tempfile
import unittest


_PATH = pathlib.Path(__file__).with_name("pixhub_images_proxy.py")
_SPEC = importlib.util.spec_from_file_location("pixhub_images_proxy", _PATH)
assert _SPEC and _SPEC.loader
_MODULE = importlib.util.module_from_spec(_SPEC)
_SPEC.loader.exec_module(_MODULE)

DATA_URL = "data:image/png;base64," + base64.b64encode(b"\x89PNG fake").decode()
HTTP_REF = "https://cdn.example.com/ref.png"


class EnvAndConfigTests(unittest.TestCase):
    """配置来源与密钥指纹：不得内置密钥，指纹不可逆。"""

    def test_load_env_file_parses_and_ignores_noise(self) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as handle:
            handle.write('# c\n\nPIXHUB_API_KEY="sk-abc"\nPIXHUB_PROXY_PORT=9999\nnoise\n')
            path = handle.name
        try:
            values = _MODULE.load_env_file(path)
        finally:
            os.unlink(path)
        self.assertEqual(values["PIXHUB_API_KEY"], "sk-abc")
        self.assertEqual(values["PIXHUB_PROXY_PORT"], "9999")
        self.assertNotIn("noise", values)

    def test_key_fingerprint_hides_plaintext(self) -> None:
        fp = _MODULE.key_fingerprint("super-secret")
        self.assertEqual(fp, _MODULE.key_fingerprint("super-secret"))
        self.assertEqual(len(fp), 8)
        self.assertNotIn("secret", fp)
        self.assertEqual(_MODULE.key_fingerprint(""), "none")

    def test_resolve_settings_env_beats_file(self) -> None:
        with tempfile.NamedTemporaryFile("w", suffix=".env", delete=False) as handle:
            handle.write("PIXHUB_API_KEY=from-file\nPIXHUB_PROXY_PORT=1111\n")
            path = handle.name
        try:
            from_env = _MODULE.resolve_settings({"PIXHUB_PROXY_ENV_FILE": path, "PIXHUB_API_KEY": "from-env"})
            self.assertEqual(from_env["api_key"], "from-env")
            self.assertEqual(from_env["port"], 1111)
            self.assertEqual(from_env["upstream_base_url"], "https://pixhub.top")
            self.assertEqual(from_env["default_model"], "gpt-image-2.5")
        finally:
            os.unlink(path)

    def test_default_port_avoids_known_ports(self) -> None:
        # 8787 agent-gateway；8788 codex_api_server（重叠监听）；8790 H3 适配服务。
        self.assertNotIn(_MODULE.DEFAULT_PORT, (8787, 8788, 8790))

    def test_constructor_requires_explicit_key(self) -> None:
        with self.assertRaisesRegex(ValueError, "PIXHUB_API_KEY"):
            _MODULE.PixhubProxy(upstream_base_url="https://pixhub.top", api_key="")
        with self.assertRaisesRegex(ValueError, "PIXHUB_UPSTREAM_BASE_URL"):
            _MODULE.PixhubProxy(upstream_base_url=" ", api_key="k")


class SizeNormalizationTests(unittest.TestCase):
    """标准协议传比例，Pixhub 要像素值 —— 这层映射错了会导致出图比例不对。"""

    def test_ratios_map_to_pixel_sizes(self) -> None:
        self.assertEqual(_MODULE.normalize_size("1:1"), "1024x1024")
        self.assertEqual(_MODULE.normalize_size("9:16"), "1024x1536")
        self.assertEqual(_MODULE.normalize_size("16:9"), "1536x1024")
        self.assertEqual(_MODULE.normalize_size("21:9"), "1536x1024")
        self.assertEqual(_MODULE.normalize_size("2:3"), "1024x1536")

    def test_pixel_sizes_pass_through_lowercased(self) -> None:
        self.assertEqual(_MODULE.normalize_size("1536X1024"), "1536x1024")

    def test_auto_and_unknowns(self) -> None:
        self.assertEqual(_MODULE.normalize_size("auto"), "auto")
        self.assertIsNone(_MODULE.normalize_size("7:3"))
        self.assertIsNone(_MODULE.normalize_size(""))
        self.assertIsNone(_MODULE.normalize_size(None))


class ReferenceTests(unittest.TestCase):
    """参考图必须能变成文件字节：edits 端点只收 multipart。"""

    def test_reference_urls_accepts_http_and_data(self) -> None:
        self.assertEqual(_MODULE.reference_urls({"image_urls": [HTTP_REF, DATA_URL]}), [HTTP_REF, DATA_URL])

    def test_reference_urls_strips_and_drops_empties(self) -> None:
        self.assertEqual(_MODULE.reference_urls({"image_urls": [f" {HTTP_REF} ", "", "  "]}), [HTTP_REF])

    def test_reference_urls_rejects_non_image(self) -> None:
        with self.assertRaisesRegex(ValueError, "参考图"):
            _MODULE.reference_urls({"image_urls": ["ftp://x/y.png"]})

    def test_reference_urls_caps_count(self) -> None:
        with self.assertRaisesRegex(ValueError, "最多"):
            _MODULE.reference_urls({"image_urls": [HTTP_REF] * (_MODULE.MAX_REFS + 1)})

    def test_fetch_reference_decodes_data_url(self) -> None:
        ctype, data = _MODULE.fetch_reference(DATA_URL)
        self.assertEqual(ctype, "image/png")
        self.assertEqual(data, b"\x89PNG fake")

    def test_fetch_reference_rejects_broken_data_url(self) -> None:
        with self.assertRaisesRegex(ValueError, "解析失败"):
            _MODULE.fetch_reference("data:image/png;base64,!!!not-base64!!!")


class UpstreamPlanTests(unittest.TestCase):
    """端点分流是这次接入的核心：有图走 edits，无图走 generations。"""

    def test_no_refs_use_generations(self) -> None:
        plan = _MODULE.build_upstream_request({"model": "gpt-image-2.5", "prompt": "cat"}, [], default_model="x")
        self.assertEqual(plan["path"], _MODULE.GENERATIONS_PATH)
        self.assertEqual(plan["fields"]["n"], 1)
        self.assertEqual(plan["fields"]["response_format"], "url")
        self.assertNotIn("size", plan["fields"])
        self.assertNotIn("quality", plan["fields"])

    def test_json_body_keeps_n_numeric(self) -> None:
        # 回归：JSON 端点要求 n 是数字，传字符串会被上游以
        # `cannot unmarshal string into ... n of type uint` 拒绝（400）。
        plan = _MODULE.build_upstream_request({"prompt": "p"}, [], default_model="m")
        body = json.loads(json.dumps(plan["fields"]))
        self.assertIsInstance(body["n"], int)
        self.assertNotIsInstance(body["n"], str)

    def test_refs_use_edits(self) -> None:
        plan = _MODULE.build_upstream_request({"prompt": "cat"}, [HTTP_REF], default_model="x")
        self.assertEqual(plan["path"], _MODULE.EDITS_PATH)
        self.assertEqual(plan["fields"]["model"], "x")

    def test_model_and_size_and_quality(self) -> None:
        plan = _MODULE.build_upstream_request(
            {"model": " ", "prompt": "p", "size": "9:16", "quality": "high", "response_format": "b64_json"},
            [], default_model="gpt-image-2.5",
        )
        self.assertEqual(plan["fields"]["model"], "gpt-image-2.5")
        self.assertEqual(plan["fields"]["size"], "1024x1536")
        self.assertEqual(plan["fields"]["quality"], "high")
        self.assertEqual(plan["fields"]["response_format"], "b64_json")

    def test_aspect_ratio_fallback(self) -> None:
        plan = _MODULE.build_upstream_request({"prompt": "p", "aspect_ratio": "16:9"}, [], default_model="m")
        self.assertEqual(plan["fields"]["size"], "1536x1024")


class MultipartTests(unittest.TestCase):
    """multipart 字段名必须可重复：Pixhub 的 edits 靠它接多张参考图。"""

    def test_builds_repeated_image_parts_with_content(self) -> None:
        body, content_type = _MODULE.build_multipart(
            {"model": "gpt-image-2.5", "n": 1},
            [("image", "a.png", b"AAA"), ("image", "b.jpg", b"BBB")],
        )
        self.assertTrue(content_type.startswith("multipart/form-data; boundary="))
        boundary = content_type.split("boundary=")[1]
        text = body.decode("latin-1")
        self.assertEqual(text.count(f'name="image"; filename="a.png"'), 1)
        self.assertEqual(text.count(f'name="image"; filename="b.jpg"'), 1)
        self.assertIn('name="model"', text)
        # multipart 里 n 必须是字符串化的文本字段
        self.assertRegex(text, r'name="n"\r\n\r\n1\r\n')
        self.assertIn("Content-Type: image/png", text)
        self.assertIn("Content-Type: image/jpeg", text)
        self.assertTrue(text.endswith(f"--{boundary}--\r\n"))
        self.assertIn(b"AAA", body)
        self.assertIn(b"BBB", body)

    def test_suffix_for_content_types(self) -> None:
        self.assertEqual(_MODULE._suffix("image/png"), ".png")
        self.assertEqual(_MODULE._suffix("image/jpeg"), ".jpg")
        self.assertEqual(_MODULE._suffix("image/webp"), ".webp")
        self.assertEqual(_MODULE._suffix("application/octet-stream"), ".png")


class HealthTests(unittest.TestCase):
    """401 必须明确判定为“密钥未被上游接受”。"""

    def test_classify(self) -> None:
        self.assertEqual(_MODULE.classify_health(200), "upstream_authenticated")
        self.assertEqual(_MODULE.classify_health(401), "upstream_rejected_credentials")
        self.assertEqual(_MODULE.classify_health(503), "upstream_http_503")

    def test_health_reports_401_without_leaking_key(self) -> None:
        proxy = _MODULE.PixhubProxy(upstream_base_url="https://example.invalid", api_key="secret-key-123")

        def boom(method: str, path: str, data: bytes | None, content_type: str):
            raise _MODULE.HttpError(401, '上游 HTTP 401: {"error":{"message":"Invalid token"}}')

        proxy._call = boom  # type: ignore[method-assign]
        report = proxy.health()
        self.assertFalse(report["ok"])
        self.assertEqual(report["reason"], "upstream_rejected_credentials")
        self.assertNotIn("secret-key-123", str(report))
        self.assertEqual(report["key_fingerprint"], _MODULE.key_fingerprint("secret-key-123"))

    def test_health_reports_unreachable(self) -> None:
        proxy = _MODULE.PixhubProxy(upstream_base_url="https://example.invalid", api_key="k")
        report = proxy.health()
        self.assertFalse(report["ok"])
        self.assertEqual(report["reason"], "upstream_unreachable")


class EnvFileSecurityTests(unittest.TestCase):
    """本地 env 文件必须挨着服务脚本，且不可被其他用户读取。"""

    def test_env_file_lives_next_to_script(self) -> None:
        self.assertTrue(_MODULE.ENV_FILE.endswith(".env.pixhub-proxy"))
        self.assertEqual(os.path.dirname(_MODULE.ENV_FILE), str(_PATH.parent))

    def test_env_file_not_world_readable_when_present(self) -> None:
        if not os.path.exists(_MODULE.ENV_FILE):
            self.skipTest("本地 env 文件尚未创建")
        mode = stat.S_IMODE(os.stat(_MODULE.ENV_FILE).st_mode)
        self.assertEqual(mode & 0o077, 0, f"env 文件权限过宽: {oct(mode)}")


if __name__ == "__main__":
    unittest.main()
