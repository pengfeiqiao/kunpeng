"""
标准化生图客户端
按 provider (dmxapi / aihubmix) 分路调用，多 slot 降级
API 端点和 Key 由调用方传入（从鲲鹏设置界面读取），不做硬编码。
"""

import os
import json
import base64
import time
import requests
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Tuple, Optional, Dict, Any
from dataclasses import dataclass
from pathlib import Path

GPT_IMAGE_2_ALLOWED_SIZES = {
    "auto",
    "1024x1024",
    "1536x1024",
    "1024x1536",
    "2048x2048",
    "2048x1152",
    "1536x864",
    "1536x1152",
    "1152x1536",
    "1280x1024",
    "1024x1280",
    "1152x2048",
    "3840x2160",
    "2160x3840",
}

SEEDREAM_PRO_MODEL_ID = "doubao-seedream-5-0-pro-260628"


def normalize_gpt_image_2_size(size: str = "auto", aspect_ratio: str = "16:9") -> str:
    raw = str(size or "").strip().lower()
    if raw and raw != "auto" and raw in GPT_IMAGE_2_ALLOWED_SIZES:
        return raw
    ratio_sizes = {
        "16:9": "2048x1152",
        "9:16": "1152x2048",
        "3:2": "1536x1024",
        "2:3": "1024x1536",
        "4:3": "1536x1152",
        "3:4": "1152x1536",
        "4:5": "1024x1280",
        "5:4": "1280x1024",
        "21:9": "2048x1152",
        "1:1": "1024x1024",
    }
    return ratio_sizes.get(str(aspect_ratio or "").strip(), raw if raw and raw != "auto" else "1024x1024")


def normalize_seedream_pro_size(size: str = "auto", aspect_ratio: str = "16:9", resolution: str = "2k") -> str:
    if size and "x" in size and size != "auto":
        return size
    table = {
        "1k": {
            "1:1": (1024, 1024),
            "4:3": (1152, 864),
            "3:4": (864, 1152),
            "16:9": (1424, 800),
            "9:16": (800, 1424),
            "3:2": (1248, 832),
            "2:3": (832, 1248),
            "21:9": (1568, 672),
        },
        "2k": {
            "1:1": (2048, 2048),
            "4:3": (2368, 1776),
            "3:4": (1776, 2368),
            "16:9": (2816, 1584),
            "9:16": (1584, 2816),
            "3:2": (2496, 1664),
            "2:3": (1664, 2496),
            "21:9": (3136, 1344),
        },
    }
    res = "1k" if str(resolution).lower() == "1k" else "2k"
    width, height = table[res].get(aspect_ratio, table[res]["16:9"])
    return f"{width}x{height}"


@dataclass
class ImageResult:
    """生图结果"""
    success: bool
    image_path: Optional[str] = None
    image_url: str = ""
    message: str = ""
    model_used: str = ""
    api_used: str = ""
    latency_ms: int = 0


class ImageGenerationClient:
    """统一生图客户端，按 provider 分路 + 多 slot 降级"""

    def __init__(self, api_slots: List[Dict[str, str]] = None):
        """
        Args:
            api_slots: [{"label": "...", "base_url": "...", "api_key": "...", "provider": "dmxapi|aihubmix"}, ...]
        """
        if api_slots:
            self.slots = api_slots
        else:
            self.slots = [{
                "label": "env",
                "base_url": os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn"),
                "api_key": os.environ.get("DMXAPI_KEY", ""),
                "provider": "dmxapi",
            }]

    # ── 统一入口 ──────────────────────────────────────────────────────────

    def generate(
        self,
        prompt: str,
        output_path: str,
        model: str = "gpt-image-2",
        size: str = "auto",
        quality: str = "high",
        resolution: str = "2k",
        n: int = 1,
        reference_images: List[Tuple[str, str]] = None,
        aspect_ratio: str = "16:9",
    ) -> ImageResult:
        last_err = "无可用 API"
        for slot in self.slots:
            base_url = slot.get("base_url", "").rstrip("/")
            api_key = slot.get("api_key", "")
            label = slot.get("label", base_url)
            provider = slot.get("provider", "dmxapi")
            if not base_url or not api_key:
                continue

            try:
                start = time.time()
                request_size = normalize_gpt_image_2_size(size, aspect_ratio) if model == "gpt-image-2" else size
                if model == "gpt-image-2":
                    models_to_try = ["gpt-image-2-03", "gpt-image-2"] if provider == "dmxapi" else ["gpt-image-2"]
                    sub_err = ""
                    result = ImageResult(success=False, message="no model tried")
                    for provider_model in models_to_try:
                        try:
                            result = self._gpt_image_2(
                                base_url, api_key, provider, provider_model, prompt, output_path,
                                request_size, quality, n, reference_images,
                            )
                            if result.success:
                                break
                        except Exception as e:
                            sub_err = f"{provider_model}: {e}"
                            print(f"⚠️ [{label}] {sub_err}")
                    if not result.success and sub_err:
                        result.message = sub_err
                elif model == "seedream-v5-pro":
                    if provider != "dmxapi":
                        result = ImageResult(success=False, message=f"seedream-v5-pro 当前仅支持 DMXAPI slot，当前 provider={provider}")
                    else:
                        request_size = normalize_seedream_pro_size(size, aspect_ratio, resolution)
                        result = self._seedream_v5_pro(
                            base_url, api_key, prompt, output_path, request_size, reference_images,
                        )
                elif model.startswith("gemini"):
                    continue
                else:
                    continue

                elapsed = int((time.time() - start) * 1000)
                if result.success:
                    result.api_used = label
                    result.latency_ms = elapsed
                    print(f"✅ [{label}] {model} ({provider}) 生成成功 ({elapsed}ms)")
                    return result

                last_err = f"[{label}] {model}: {result.message}"
                print(f"⚠️ {last_err}")

            except Exception as e:
                last_err = f"[{label}] {model}: {e}"
                print(f"⚠️ {last_err}")
                continue

        return ImageResult(success=False, message=f"所有端点均失败。最后错误: {last_err}")

    # ── GPT Image 2 ──────────────────────────────────────────────────────

    @staticmethod
    def _raise_for_status(resp: requests.Response, label: str):
        if resp.ok:
            return
        raise requests.HTTPError(
            f"{label}: HTTP {resp.status_code}: {resp.text[:800]}",
            response=resp,
        )

    def _gpt_image_2(
        self, base_url: str, api_key: str, provider: str, provider_model: str,
        prompt: str, output_path: str,
        size: str, quality: str, n: int,
        reference_images: List[Tuple[str, str]] = None,
    ) -> ImageResult:
        if reference_images:
            if provider == "aihubmix":
                return self._gpt_image_2_edit_aihubmix(
                    base_url, api_key, provider_model, prompt, output_path,
                    size, n, reference_images,
                )
            else:
                return self._gpt_image_2_edit_dmxapi(
                    base_url, api_key, provider_model, prompt, output_path,
                    size, quality, n, reference_images,
                )
        return self._gpt_image_2_gen(
            base_url, api_key, provider_model, prompt, output_path, size, quality, n,
        )

    def _gpt_image_2_gen(
        self, base_url: str, api_key: str, provider_model: str,
        prompt: str, output_path: str,
        size: str, quality: str, n: int,
    ) -> ImageResult:
        """GPT Image 2 文生图（两家格式一样）"""
        resp = requests.post(
            f"{base_url}/v1/images/generations",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": provider_model,
                "prompt": prompt,
                "n": n,
                "size": size,
                "quality": quality,
            },
            timeout=300,
        )
        self._raise_for_status(resp, f"{provider_model} generations")
        return self._parse_openai_image_response(resp.json(), output_path, provider_model)

    def _gpt_image_2_edit_dmxapi(
        self, base_url: str, api_key: str,
        provider_model: str, prompt: str, output_path: str,
        size: str, quality: str, n: int,
        reference_images: List[Tuple[str, str]],
    ) -> ImageResult:
        """dmxapi 图编辑: multipart form-data, 带 quality/n/background, 支持多张参考图"""
        import io

        files = []
        for name, img_b64 in reference_images:
            raw = img_b64.split(",")[-1] if "," in img_b64 else img_b64
            img_bytes = base64.b64decode(raw)
            compressed = self._compress_bytes(img_bytes, max_dim=1536, quality=85)
            files.append(("image", (f"{name}.jpg", io.BytesIO(compressed), "image/jpeg")))

        data = {
            "model": provider_model,
            "prompt": prompt,
            "n": n,
            "size": size,
            "quality": quality,
        }

        resp = requests.post(
            f"{base_url}/v1/images/edits",
            headers={"Authorization": f"Bearer {api_key}"},
            data=data,
            files=files,
            timeout=300,
        )
        self._raise_for_status(resp, f"{provider_model} edit dmxapi")
        return self._parse_openai_image_response(resp.json(), output_path, f"{provider_model} (edit/dmxapi)")

    def _gpt_image_2_edit_aihubmix(
        self, base_url: str, api_key: str,
        provider_model: str, prompt: str, output_path: str,
        size: str, n: int,
        reference_images: List[Tuple[str, str]],
    ) -> ImageResult:
        """aihubmix 图编辑: multipart form-data, 不带 quality, 支持多张参考图"""
        import io

        files = []
        for name, img_b64 in reference_images:
            raw = img_b64.split(",")[-1] if "," in img_b64 else img_b64
            img_bytes = base64.b64decode(raw)
            compressed = self._compress_bytes(img_bytes, max_dim=1536, quality=85)
            field_name = "image[]" if len(reference_images) > 1 else "image"
            files.append((field_name, (f"{name}.jpg", io.BytesIO(compressed), "image/jpeg")))

        data = {
            "model": provider_model,
            "prompt": prompt,
            "n": n,
            "size": size,
        }

        resp = requests.post(
            f"{base_url}/v1/images/edits",
            headers={"Authorization": f"Bearer {api_key}"},
            data=data,
            files=files,
            timeout=300,
        )
        self._raise_for_status(resp, f"{provider_model} edit aihubmix")
        return self._parse_openai_image_response(resp.json(), output_path, f"{provider_model} (edit/aihubmix)")

    def _seedream_v5_pro(
        self, base_url: str, api_key: str,
        prompt: str, output_path: str,
        size: str,
        reference_images: List[Tuple[str, str]] = None,
    ) -> ImageResult:
        images = []
        for name, img_b64 in (reference_images or [])[:10]:
            raw = img_b64.split(",")[-1] if "," in img_b64 else img_b64
            images.append(f"data:image/jpeg;base64,{raw}")
        payload = {
            "model": SEEDREAM_PRO_MODEL_ID,
            "prompt": prompt,
            "size": size,
            "response_format": "url",
            "output_format": "jpeg",
            "watermark": False,
        }
        if images:
            payload["image"] = images
        resp = requests.post(
            f"{base_url}/v1/images/generations",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
            timeout=300,
        )
        self._raise_for_status(resp, "seedream-v5-pro generations")
        return self._parse_openai_image_response(resp.json(), output_path, "seedream-v5-pro")

    def _parse_openai_image_response(
        self, result: Dict, output_path: str, model_label: str,
    ) -> ImageResult:
        if "data" not in result or not result["data"]:
            return ImageResult(success=False, message=f"{model_label}: 无有效返回 {result}")

        item = result["data"][0]
        if item.get("b64_json"):
            image_bytes = base64.b64decode(item["b64_json"])
        elif item.get("url"):
            image_bytes = requests.get(item["url"], timeout=300).content
        else:
            return ImageResult(success=False, message=f"{model_label}: 返回中无图片数据")

        self._save(output_path, image_bytes)
        return ImageResult(success=True, image_path=str(output_path), model_used=model_label)

    # ── Gemini ────────────────────────────────────────────────────────────

    def _gemini(
        self, base_url: str, api_key: str, model: str,
        prompt: str, output_path: str,
        reference_images: List[Tuple[str, str]] = None,
        aspect_ratio: str = "16:9",
    ) -> ImageResult:
        parts = [{"text": prompt}]
        for name, img_b64 in (reference_images or []):
            compressed = self._compress_b64(img_b64, max_dim=1536)
            parts.append({
                "inlineData": {"mimeType": "image/jpeg", "data": compressed}
            })

        resp = requests.post(
            f"{base_url}/v1beta/models/{model}:generateContent",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
            },
            json={
                "contents": [{"parts": parts}],
                "generationConfig": {
                    "responseModalities": ["Text", "Image"],
                    "imageConfig": {"aspectRatio": aspect_ratio},
                },
            },
            timeout=300,
        )
        self._raise_for_status(resp, model)
        result = resp.json()

        if "candidates" in result and result["candidates"]:
            candidate = result["candidates"][0]
            for part in candidate.get("content", {}).get("parts", []):
                if "inlineData" in part:
                    image_bytes = base64.b64decode(part["inlineData"]["data"])
                    self._save(output_path, image_bytes)
                    return ImageResult(
                        success=True, image_path=str(output_path), model_used=model,
                    )

        return ImageResult(success=False, message=f"{model}: 无有效返回")

    # ── 工具方法 ──────────────────────────────────────────────────────────

    @staticmethod
    def _compress_bytes(img_bytes: bytes, max_dim: int = 1536, quality: int = 85) -> bytes:
        """将图片字节缩放到 max_dim 以内，返回 JPEG bytes"""
        from PIL import Image
        import io

        img = Image.open(io.BytesIO(img_bytes))
        w, h = img.size
        if w > max_dim or h > max_dim:
            scale = max_dim / max(w, h)
            img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
        if img.mode == "RGBA":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        result = buf.getvalue()
        print(f"📐 参考图压缩: {w}x{h} → {img.size[0]}x{img.size[1]}, {len(result)//1024}KB")
        return result

    @staticmethod
    def _compress_b64(img_b64: str, max_dim: int = 1536) -> str:
        """将 base64 图片缩放到 max_dim 以内，返回 JPEG base64"""
        from PIL import Image
        import io

        raw = img_b64.split(",")[-1] if "," in img_b64 else img_b64
        img = Image.open(io.BytesIO(base64.b64decode(raw)))
        w, h = img.size
        if w > max_dim or h > max_dim:
            scale = max_dim / max(w, h)
            img = img.resize((round(w * scale), round(h * scale)), Image.LANCZOS)
        if img.mode == "RGBA":
            img = img.convert("RGB")
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        return base64.b64encode(buf.getvalue()).decode()

    @staticmethod
    def _save(output_path: str, data: bytes):
        p = Path(output_path)
        p.parent.mkdir(parents=True, exist_ok=True)
        with open(p, "wb") as f:
            f.write(data)

    @staticmethod
    def speed_test(slots: List[Dict[str, str]]) -> List[Dict[str, Any]]:
        def _ping(slot: Dict) -> Dict:
            base_url = slot.get("base_url", "").rstrip("/")
            api_key = slot.get("api_key", "")
            try:
                start = time.time()
                requests.get(
                    f"{base_url}/v1/models",
                    headers={"Authorization": f"Bearer {api_key}"},
                    timeout=15,
                )
                return {**slot, "latency_ms": int((time.time() - start) * 1000)}
            except Exception:
                return {**slot, "latency_ms": -1}

        results = []
        with ThreadPoolExecutor(max_workers=min(len(slots), 5)) as pool:
            futures = {pool.submit(_ping, s): s for s in slots}
            for f in as_completed(futures):
                results.append(f.result())

        results.sort(key=lambda r: (r["latency_ms"] < 0, r["latency_ms"]))
        return results


# ── CLI 入口 ──────────────────────────────────────────────────────────────

if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="统一生图客户端")
    parser.add_argument("--test-speed", action="store_true", help="测速所有 API 端点")
    parser.add_argument("--slots-json", type=str, help="API 端点列表 JSON")
    parser.add_argument("--prompt", type=str, help="生图提示词")
    parser.add_argument("--output", type=str, help="输出路径")
    parser.add_argument("--model", type=str, default="gpt-image-2", help="首选模型")
    parser.add_argument("--size", type=str, default="auto", help="图片尺寸")
    parser.add_argument("--quality", type=str, default="high", help="质量")
    parser.add_argument("--resolution", type=str, default="2k", help="Seedream Pro 分辨率: 1k/2k")
    args = parser.parse_args()

    slots = []
    if args.slots_json:
        slots = json.loads(args.slots_json)
    elif os.environ.get("DMXAPI_KEY"):
        slots = [{"label": "env", "base_url": os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn"),
                  "api_key": os.environ["DMXAPI_KEY"], "provider": "dmxapi"}]

    if args.test_speed:
        results = ImageGenerationClient.speed_test(slots)
        for r in results:
            status = f"{r['latency_ms']}ms" if r['latency_ms'] >= 0 else "失败"
            print(f"  {r.get('label', r['base_url'])}: {status}")
    elif args.prompt and args.output:
        client = ImageGenerationClient(api_slots=slots)
        result = client.generate(
            prompt=args.prompt,
            output_path=args.output,
            model=args.model,
            size=args.size,
            quality=args.quality,
            resolution=args.resolution,
        )
        print(json.dumps({
            "success": result.success,
            "path": result.image_path,
            "model": result.model_used,
            "api": result.api_used,
            "message": result.message,
        }, ensure_ascii=False))
    else:
        parser.print_help()
