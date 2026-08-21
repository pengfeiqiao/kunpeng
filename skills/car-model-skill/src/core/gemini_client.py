#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Gemini 多参考图融合客户端 - 核心模块
"""

import osfrom pathlib import Path
from typing import List, Optional
import base64
import json

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False


class GeminiClient:
    """Gemini API 客户端，用于多参考图融合生成"""

    def __init__(self, api_key: str, base_url: str = None):
        """
        初始化客户端

        Args:
            api_key: API密钥
            base_url: API基础URL
        """
        if not GENAI_AVAILABLE:
            raise ImportError("需要安装 google-genai: pip install google-genai")

        self.api_key = api_key
        self.base_url = base_url
        self.model = "gpt-image-2"

        # 创建客户端
        self.client = genai.Client(
            api_key=api_key,
            http_options={'base_url': self.base_url}
        )

    def generate_with_references(
        self,
        reference_images: List[Path],
        prompt: str,
        aspect_ratio: str = "16:9",
        image_size: str = "2K",
        output_path: Optional[Path] = None
    ) -> bytes:
        """
        使用参考图融合生成图片

        Args:
            reference_images: 参考图片路径列表（最多6张）
            prompt: 生成提示词
            aspect_ratio: 宽高比 (16:9, 1:1等)
            image_size: 分辨率 (2K等)
            output_path: 输出路径

        Returns:
            生成的图片数据（bytes）
        """
        # 限制参考图数量
        if len(reference_images) > 6:
            print(f"警告: 参考图过多({len(reference_images)}张)，只使用前6张")
            reference_images = reference_images[:6]

        # 构建contents
        contents = []

        # 添加参考图（使用inline_data base64编码）
        for i, img_path in enumerate(reference_images, 1):
            print(f"  添加参考图 {i}/{len(reference_images)}: {img_path.name}")
            with open(img_path, 'rb') as f:
                img_data = f.read()
                img_b64 = base64.b64encode(img_data).decode('utf-8')

                contents.append(
                    types.Part(
                        inline_data=types.Blob(
                            mime_type="image/jpeg",
                            data=img_b64
                        )
                    )
                )

        # 添加prompt
        contents.append(types.Part(text=prompt))

        print(f"  调用Gemini API: {self.model}")
        print(f"  参考图: {len(reference_images)}张, 宽高比: {aspect_ratio}, 分辨率: {image_size}")

        try:
            # 调用API（移除image_size参数，因为API不支持）
            response = self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=['IMAGE'],
                    image_config=types.ImageConfig(
                        aspect_ratio=aspect_ratio
                    )
                )
            )

            # 提取生成的图片
            if response.candidates:
                for candidate in response.candidates:
                    if candidate.content.parts:
                        for part in candidate.content.parts:
                            if hasattr(part, 'inline_data') and part.inline_data:
                                # 处理base64数据
                                if isinstance(part.inline_data.data, str):
                                    image_data = base64.b64decode(part.inline_data.data)
                                else:
                                    image_data = part.inline_data.data

                                # 保存图片
                                if output_path:
                                    with open(output_path, 'wb') as f:
                                        f.write(image_data)
                                    print(f"  [OK] 图片已保存: {output_path}")

                                return image_data

            raise Exception("API返回数据中未找到生成的图片")

        except Exception as e:
            print(f"  [ERROR] 生成失败: {e}")
            raise

    def generate_category_image(
        self,
        category: str,
        reference_images: List[Path],
        prompt: str,
        output_dir: Path,
        aspect_ratio: str = "16:9",
        image_size: str = "2K"
    ) -> Path:
        """
        生成特定类别的图片

        Args:
            category: 类别名称 (body_front, wheel, logo等)
            reference_images: 参考图片列表
            prompt: 提示词
            output_dir: 输出目录
            aspect_ratio: 宽高比
            image_size: 分辨率

        Returns:
            生成的图片路径
        """
        output_path = output_dir / f"{category}.jpg"

        self.generate_with_references(
            reference_images=reference_images,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            image_size=image_size,
            output_path=output_path
        )

        return output_path
