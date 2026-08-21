"""
知数云 Midjourney Imagine API 客户端
====================================================
用于生成场景概念图、分镜图等高质量图片

API 文档: https://data.zhishuyun.com/documents/58ea7cc1-c685-40c3-a619-f29f9ac5d8f4

用法：
    from utils.midjourney_client import MidjourneyClient

    client = MidjourneyClient()
    result = client.imagine("a beautiful sunset --v 6.1 --ar 16:9")
    print(result["image_url"])
"""
import os
import requests
from pathlib import Path
from typing import Optional, Dict, Any
from dataclasses import dataclass


@dataclass
class MJResult:
    """Midjourney 生成结果"""
    success: bool
    task_id: str = ""
    image_id: str = ""
    image_url: str = ""
    actions: list = None
    error: str = ""

    def __post_init__(self):
        if self.actions is None:
            self.actions = []


class MidjourneyClient:
    """知数云 Midjourney Imagine API 客户端"""

    def __init__(self, api_key: str = None):
        self.api_key = api_key or os.environ.get("MJ_API_KEY")
        if not self.api_key:
            raise ValueError("❌ MJ_API_KEY 未配置，请在 ~/.zshrc 中设置: export MJ_API_KEY='your_key'")

        self.base_url = "https://api.zhishuyun.com/midjourney/imagine"

    def imagine(
        self,
        prompt: str,
        action: str = "generate",
        image_id: str = None,
        timeout: int = 480,
        translation: bool = False,
        wait: bool = True
    ) -> MJResult:
        """
        调用 Midjourney Imagine API 生成图片

        Args:
            prompt: 提示词（包含 Midjourney 参数，如 --v 6.1 --ar 16:9）
            action: 操作类型 (generate, upsample1-4, variation1-4)
            image_id: 图像ID（用于 upsample/variation 操作）
            timeout: API 超时时间（秒），默认480秒
            translation: 是否启用自动翻译，默认 False
            wait: 是否等待结果返回，默认 True

        Returns:
            MJResult: 包含 task_id, image_id, image_url, actions 等字段
        """
        url = f"{self.base_url}?token={self.api_key}"

        payload = {
            "action": action,
            "prompt": prompt,
            "timeout": timeout,
            "translation": translation
        }

        if image_id:
            payload["image_id"] = image_id

        print(f"\n[MJ] 提交任务...")
        print(f"   Action: {action}")
        print(f"   Prompt: {prompt[:100]}...")
        print(f"   Timeout: {timeout}s")

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

        try:
            response = requests.post(
                url,
                headers=headers,
                json=payload,
                timeout=timeout + 30
            )

            result = response.json()
            print(f"[MJ] Response Status: {response.status_code}")

            # 检查错误
            if "code" in result and result["code"] not in ["success", 200]:
                error_detail = result.get("detail", str(result))
                print(f"[MJ] Error: {error_detail}")
                return MJResult(success=False, error=error_detail)

            # 成功响应
            if "task_id" in result:
                print(f"[MJ] 任务完成！")
                print(f"   Image URL: {result.get('image_url')}")

                return MJResult(
                    success=True,
                    task_id=result.get("task_id", ""),
                    image_id=result.get("image_id", ""),
                    image_url=result.get("image_url", ""),
                    actions=result.get("actions", [])
                )

            return MJResult(success=False, error=str(result))

        except requests.exceptions.Timeout:
            print(f"[MJ] Timeout ({timeout}s)")
            return MJResult(success=False, error=f"Request timeout after {timeout}s")
        except Exception as e:
            print(f"[MJ] Error: {e}")
            return MJResult(success=False, error=str(e))

    def upsample(self, image_id: str, index: int = 1, timeout: int = 480) -> MJResult:
        """
        对生成的图片进行放大操作

        Args:
            image_id: 图像ID
            index: 放大哪个位置 (1-4)
            timeout: 超时时间

        Returns:
            MJResult: 放大后的图片信息
        """
        action = f"upsample{index}"
        return self.imagine(
            prompt="",
            action=action,
            image_id=image_id,
            timeout=timeout
        )

    def variation(self, image_id: str, index: int = 1, timeout: int = 480) -> MJResult:
        """
        对生成的图片进行变体操作

        Args:
            image_id: 图像ID
            index: 变体哪个位置 (1-4)
            timeout: 超时时间

        Returns:
            MJResult: 变体后的图片信息
        """
        action = f"variation{index}"
        return self.imagine(
            prompt="",
            action=action,
            image_id=image_id,
            timeout=timeout
        )

    def imagine_with_reference(
        self,
        prompt: str,
        reference_image_base64: str,
        action: str = "generate",
        image_id: str = None,
        timeout: int = 480,
        translation: bool = False
    ) -> MJResult:
        """
        使用参考图片生成 Midjourney 图片

        Args:
            prompt: 提示词
            reference_image_base64: 参考图片的 base64 编码
            action: 操作类型
            image_id: 图像ID
            timeout: 超时时间
            translation: 是否启用自动翻译

        Returns:
            MJResult: 生成结果
        """
        url = f"{self.base_url}?token={self.api_key}"

        payload = {
            "action": action,
            "prompt": prompt,
            "timeout": timeout,
            "translation": translation,
            "base64Array": [reference_image_base64]
        }

        if image_id:
            payload["image_id"] = image_id

        print(f"\n[MJ] 提交任务（带参考图）...")
        print(f"   Action: {action}")
        print(f"   Prompt: {prompt[:100]}...")
        print(f"   Reference: 1 image")

        headers = {
            "Content-Type": "application/json",
            "Accept": "application/json"
        }

        try:
            response = requests.post(
                url,
                headers=headers,
                json=payload,
                timeout=timeout + 30
            )

            result = response.json()
            print(f"[MJ] Response Status: {response.status_code}")

            if "code" in result and result["code"] not in ["success", 200]:
                error_detail = result.get("detail", str(result))
                return MJResult(success=False, error=error_detail)

            if "task_id" in result:
                return MJResult(
                    success=True,
                    task_id=result.get("task_id", ""),
                    image_id=result.get("image_id", ""),
                    image_url=result.get("image_url", ""),
                    actions=result.get("actions", [])
                )

            return MJResult(success=False, error=str(result))

        except Exception as e:
            return MJResult(success=False, error=str(e))

    def download_image(self, url: str, output_path: Path) -> bool:
        """下载图片到本地"""
        print(f"[MJ] 下载图片到: {output_path}")

        try:
            response = requests.get(url, timeout=60)

            if response.status_code == 200:
                output_path = Path(output_path)
                output_path.parent.mkdir(parents=True, exist_ok=True)

                with open(output_path, "wb") as f:
                    f.write(response.content)
                print(f"[MJ] 图片已保存: {output_path}")
                return True
            else:
                print(f"[MJ] 下载失败: {response.status_code}")
                return False
        except Exception as e:
            print(f"[MJ] 下载失败: {e}")
            return False
