"""
统一生图客户端
支持 API 降级：gpt-image-2 → doubao-seedream-5.0-lite → doubao-seedream-5-0-260128 (official)
"""

import os
import json
import base64
import requests
from typing import List, Dict, Any, Optional, Tuple
from dataclasses import dataclass
from pathlib import Path


@dataclass
class ImageResult:
    """生图结果"""
    success: bool
    image_path: Optional[str] = None
    image_url: str = ""
    message: str = ""
    model_used: str = ""


class ImageGenerationClient:
    """统一生图客户端，支持 API 降级"""

    # 降级链：按顺序尝试
    FALLBACK_CHAIN = [
        "gpt-image-2",
        "doubao-seedream-5.0-lite",
        "doubao-seedream-5-0-260128-official"  # 火山引擎官方API
    ]

    # GPT Image 2 专用（不走降级链）
    GPT_IMAGE_2_MODEL = "gpt-image-2"

    # API 端点
    BASE_URL = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn")

    def __init__(self):
        self.api_key = os.environ.get("DMXAPI_KEY", "")
        self.volcano_config = self._load_volcano_config()

    def _load_volcano_config(self) -> Dict:
        """加载火山引擎配置"""
        config_path = Path(__file__).parent.parent / "config/api_config.json"
        if config_path.exists():
            try:
                with open(config_path, 'r') as f:
                    config = json.load(f)
                    volcano = config.get("volcano_engine", {})
                    if volcano.get("enabled"):
                        # API key 从环境变量读取，不存储在配置文件中
                        env_key = volcano.get("api_key_env", "ARK_API_KEY")
                        api_key = os.environ.get(env_key, volcano.get("api_key", ""))
                        if api_key:
                            volcano["api_key"] = api_key
                            print(f"[OK] 已加载火山引擎配置")
                        else:
                            print(f"[WARNING] 火山引擎 API Key 未配置（环境变量 {env_key}）")
                        return volcano
            except Exception as e:
                print(f"[WARNING] 加载火山引擎配置失败: {e}")
        return {}

    def generate_storyboard_grid(
        self,
        prompt: str,
        reference_images: List[Tuple[str, str]] = None,
        output_path = None,
        size: str = "4096x2304"
    ) -> ImageResult:
        """
        生成九宫格分镜（支持自动降级）

        Args:
            prompt: 提示词
            reference_images: [(name, base64_data), ...] 参考图片列表
            output_path: 输出路径
            size: 图片尺寸，如 "4096x2304" (16:9)
        """
        for model in self.FALLBACK_CHAIN:
            try:
                if model == "gpt-image-2":
                    result = self._try_gpt_image_2(prompt, output_path, size)
                elif "official" in model:
                    result = self._try_volcano_official(model, prompt, reference_images, output_path, size)
                elif model.startswith("doubao"):
                    result = self._try_doubao(model, prompt, reference_images, output_path, size)
                else:
                    continue

                if result.success:
                    print(f"✅ 使用 {model} 生成成功")
                    return result

            except Exception as e:
                print(f"⚠️ {model} 失败: {e}")
                continue

        return ImageResult(success=False, message="所有模型均失败")

    def _try_gpt_image_2(
        self,
        prompt: str,
        output_path,
        size: str
    ) -> ImageResult:
        """尝试使用 GPT Image 2 API"""

        response = requests.post(
            f"{self.BASE_URL}/v1/images/generations",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json"
            },
            json={
                "model": "gpt-image-2",
                "prompt": prompt,
                "n": 1,
                "size": size,
                "quality": "high",
            },
            timeout=600
        )

        response.raise_for_status()
        result = response.json()

        if "data" in result and len(result["data"]) > 0:
            item = result["data"][0]
            if item.get("b64_json"):
                image_bytes = base64.b64decode(item["b64_json"])
            elif item.get("url"):
                image_bytes = requests.get(item["url"], timeout=300).content
            else:
                return ImageResult(success=False, message="gpt-image-2: 返回中无图片数据")

            output_path = Path(output_path)
            output_path.parent.mkdir(parents=True, exist_ok=True)

            with open(output_path, "wb") as f:
                f.write(image_bytes)

            return ImageResult(
                success=True,
                image_path=str(output_path),
                model_used="gpt-image-2"
            )

        return ImageResult(success=False, message=f"gpt-image-2: 无有效返回")

    def _try_doubao(
        self,
        model: str,
        prompt: str,
        reference_images: List[Tuple[str, str]],
        output_path,
        size: str
    ) -> ImageResult:
        """尝试使用 doubao-seedream-5.0-lite API"""

        # 准备参考图片列表（只需要 base64 数据，不需要 data:image 前缀）
        image_list = []
        for _, img_b64 in (reference_images or []):
            # 如果已经有 data:image 前缀，保留；否则添加
            if img_b64.startswith("data:"):
                image_list.append(img_b64)
            else:
                image_list.append(f"data:image/jpeg;base64,{img_b64}")

        response = requests.post(
            f"{self.BASE_URL}/v1/responses",
            headers={
                "Authorization": self.api_key,
                "Content-Type": "application/json"
            },
            json={
                "model": model,
                "input": prompt,
                "size": size,
                "image": image_list,
                "response_format": "url",
                "watermark": False,
                "output_format": "jpeg",
                "stream": False,
            },
            timeout=300
        )

        response.raise_for_status()
        result = response.json()

        if result.get("status") == "completed" and result.get("output"):
            image_urls = [
                item["image_url"]["url"]
                for item in result["output"]
                if item.get("image_url")
            ]
            if image_urls:
                # 下载图片
                img_response = requests.get(image_urls[0], timeout=60)
                img_response.raise_for_status()

                # 确保输出目录存在
                output_path = Path(output_path)
                output_path.parent.mkdir(parents=True, exist_ok=True)

                with open(output_path, "wb") as f:
                    f.write(img_response.content)

                return ImageResult(
                    success=True,
                    image_path=str(output_path),
                    image_url=image_urls[0],
                    model_used=model
                )

        return ImageResult(success=False, message=f"{model}: 生成未完成")

    def _try_volcano_official(
        self,
        model: str,
        prompt: str,
        reference_images: List[Tuple[str, str]],
        output_path,
        size: str
    ) -> ImageResult:
        """尝试使用火山引擎官方 doubao-seedream-5-0-260128 API"""

        if not self.volcano_config.get("enabled"):
            return ImageResult(success=False, message="火山引擎API未启用")

        api_key = self.volcano_config.get("api_key", "")
        base_url = self.volcano_config.get("base_url", "https://ark.cn-beijing.volces.com/api/v3")

        if not api_key:
            return ImageResult(success=False, message="火山引擎API Key未配置")

        # 准备参考图片（火山引擎可能使用不同的参数名）
        # 根据火山引擎文档，参考图可能需要作为单独参数传递

        # 构建请求 - 使用火山引擎的格式
        headers = {
            "Authorization": f"Bearer {api_key}",
            "Content-Type": "application/json"
        }

        # 火山引擎的请求格式
        payload = {
            "model": self.volcano_config.get("model", "doubao-seedream-5-0-260128"),
            "prompt": prompt,
            "size": size,
            "scale": 1.0,
            "seed": 0
        }

        # 如果有参考图，尝试添加
        # 注意：火山引擎的 API 可能对参考图的处理方式不同
        # 这里使用与 DMXAPI 类似的格式，如果失败可能需要调整

        try:
            response = requests.post(
                f"{base_url}/services/generation/ImageSynthesisRequest",
                headers=headers,
                json=payload,
                timeout=300
            )

            response.raise_for_status()
            result = response.json()

            # 处理火山引擎的响应格式
            # 根据火山引擎文档，响应格式可能是：
            # {"output": {"image_url": "https://xxx"}}
            # 或其他格式

            if "output" in result:
                output = result["output"]

                # 尝试多种可能的响应格式
                image_url = None
                if isinstance(output, dict):
                    image_url = output.get("image_url")
                elif isinstance(output, str):
                    image_url = output

                if image_url:
                    # 下载图片
                    img_response = requests.get(image_url, timeout=60)
                    img_response.raise_for_status()

                    # 保存图片
                    output_path = Path(output_path)
                    output_path.parent.mkdir(parents=True, exist_ok=True)

                    with open(output_path, "wb") as f:
                        f.write(img_response.content)

                    return ImageResult(
                        success=True,
                        image_path=str(output_path),
                        image_url=image_url,
                        model_used="doubao-seedream-5-0-260128 (official)"
                    )

            return ImageResult(success=False, message=f"火山引擎API返回格式异常: {result}")

        except requests.exceptions.HTTPError as e:
            return ImageResult(success=False, message=f"火山引擎API HTTP错误: {e.response.status_code}")
        except Exception as e:
            return ImageResult(success=False, message=f"火山引擎API调用失败: {str(e)}")

    def generate_gpt_image(
        self,
        prompt: str,
        output_path,
        size: str = "auto",
        quality: str = "high",
        n: int = 1,
        reference_images: List[Tuple[str, str]] = None,
    ) -> ImageResult:
        """
        使用 GPT Image 2 生成图片（文生图或图片编辑）

        Args:
            prompt: 提示词（最大 32000 字符）
            output_path: 输出路径
            size: "auto" / "1024x1024" / "1536x1024" / "1024x1536"
            quality: "auto" / "high" / "medium" / "low"
            n: 生成数量 1-10
            reference_images: [(name, base64_data), ...] 参考图（有则走图片编辑接口）
        """
        if reference_images:
            return self._try_gpt_image_2_edit(prompt, reference_images, output_path, size, quality, n)
        else:
            return self._try_gpt_image_2(prompt, output_path, size, quality, n)

    def _try_gpt_image_2(
        self,
        prompt: str,
        output_path,
        size: str = "auto",
        quality: str = "high",
        n: int = 1,
    ) -> ImageResult:
        """GPT Image 2 文生图"""
        response = requests.post(
            f"{self.BASE_URL}/v1/images/generations",
            headers={
                "Authorization": f"Bearer {self.api_key}",
                "Content-Type": "application/json",
            },
            json={
                "model": self.GPT_IMAGE_2_MODEL,
                "prompt": prompt,
                "n": n,
                "size": size,
                "quality": quality,
            },
            timeout=600,
        )
        response.raise_for_status()
        result = response.json()

        if "data" not in result or not result["data"]:
            return ImageResult(success=False, message=f"gpt-image-2: 无有效返回 {result}")

        item = result["data"][0]
        if item.get("b64_json"):
            image_bytes = base64.b64decode(item["b64_json"])
        elif item.get("url"):
            image_bytes = requests.get(item["url"], timeout=300).content
        else:
            return ImageResult(success=False, message="gpt-image-2: 返回中无图片数据")

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(image_bytes)

        return ImageResult(
            success=True,
            image_path=str(output_path),
            model_used=self.GPT_IMAGE_2_MODEL,
        )

    def _try_gpt_image_2_edit(
        self,
        prompt: str,
        reference_images: List[Tuple[str, str]],
        output_path,
        size: str = "auto",
        quality: str = "high",
        n: int = 1,
    ) -> ImageResult:
        """GPT Image 2 图片编辑（带参考图）"""
        import io

        files = []
        for name, img_b64 in reference_images:
            raw = img_b64.split(",")[-1] if "," in img_b64 else img_b64
            img_bytes = base64.b64decode(raw)
            files.append(("image", (f"{name}.png", io.BytesIO(img_bytes), "image/png")))

        # 所有文本参数统一用 data 传，files 只放图片
        data = {
            "model": self.GPT_IMAGE_2_MODEL,
            "prompt": prompt,
            "n": str(n),
            "size": size,
            "quality": quality,
        }

        response = requests.post(
            f"{self.BASE_URL}/v1/images/edits",
            headers={"Authorization": f"Bearer {self.api_key}"},
            data=data,
            files=files,
            timeout=600,
        )
        response.raise_for_status()
        result = response.json()

        if "data" not in result or not result["data"]:
            return ImageResult(success=False, message=f"gpt-image-2 edit: 无有效返回 {result}")

        item = result["data"][0]
        if item.get("b64_json"):
            image_bytes = base64.b64decode(item["b64_json"])
        elif item.get("url"):
            image_bytes = requests.get(item["url"], timeout=300).content
        else:
            return ImageResult(success=False, message="gpt-image-2 edit: 返回中无图片数据")

        output_path = Path(output_path)
        output_path.parent.mkdir(parents=True, exist_ok=True)
        with open(output_path, "wb") as f:
            f.write(image_bytes)

        return ImageResult(
            success=True,
            image_path=str(output_path),
            model_used=f"{self.GPT_IMAGE_2_MODEL} (edit)",
        )
