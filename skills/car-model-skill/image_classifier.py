#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
图像分类模块
使用AI视觉模型对汽车图片进行分类
"""

import os
from pathlib import Path
from typing import List, Dict
import base64
import json

try:
    from anthropic import Anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False
    print("Warning: anthropic library not installed, using fallback classifier")


class CarImageClassifier:
    """汽车图像分类器"""

    # 分类类别定义
    CATEGORIES = {
        'body': '三视图（车身整体视图，包括前、侧、后）',
        'wheel': '轮毂（包括刹车片和卡钳）',
        'lights': '灯组（前大灯、尾灯等）',
        'sensor': '传感器雷达',
        'logo': '车标'
    }

    def __init__(self, api_key: str = None):
        """
        初始化分类器

        Args:
            api_key: Anthropic API密钥（如果使用Claude Vision）
        """
        self.api_key = api_key or os.environ.get('ANTHROPIC_API_KEY')
        self.client = None

        if ANTHROPIC_AVAILABLE and self.api_key:
            self.client = Anthropic(api_key=self.api_key)

    def classify_single_image(self, image_path: Path) -> str:
        """
        对单张图片进行分类

        Args:
            image_path: 图片路径

        Returns:
            分类类别
        """
        if self.client:
            return self._classify_with_claude(image_path)
        else:
            return self._classify_with_rules(image_path)

    def _classify_with_claude(self, image_path: Path) -> str:
        """使用Claude Vision进行分类"""
        # 读取图片
        with open(image_path, 'rb') as f:
            image_data = base64.b64encode(f.read()).decode('utf-8')

        # 获取文件扩展名来确定媒体类型
        ext = image_path.suffix.lower()
        media_type = 'image/jpeg' if ext in ['.jpg', '.jpeg'] else 'image/png'

        # 构建分类prompt
        categories_desc = '\n'.join([
            f"- {key}: {desc}"
            for key, desc in self.CATEGORIES.items()
        ])

        prompt = f"""请分析这张汽车图片，并将其分类到以下类别之一：

{categories_desc}

请只返回类别的英文键名（body/wheel/lights/sensor/logo），不要有任何其他解释。
如果图片包含多个类别的内容，请选择最主要的类别。"""

        try:
            message = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=50,
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "image",
                                "source": {
                                    "type": "base64",
                                    "media_type": media_type,
                                    "data": image_data,
                                },
                            },
                            {
                                "type": "text",
                                "text": prompt
                            }
                        ],
                    }
                ],
            )

            # 提取分类结果
            category = message.content[0].text.strip().lower()

            # 验证分类结果
            if category in self.CATEGORIES:
                return category
            else:
                # 如果返回的不是有效类别，尝试模糊匹配
                for key in self.CATEGORIES.keys():
                    if key in category:
                        return key
                return 'body'  # 默认分类

        except Exception as e:
            print(f"使用Claude Vision分类失败: {e}")
            return self._classify_with_rules(image_path)

    def _classify_with_rules(self, image_path: Path) -> str:
        """
        使用基于规则的简单分类（后备方案）
        基于文件名关键词进行分类
        """
        filename = image_path.name.lower()

        # 关键词匹配规则
        rules = {
            'logo': ['logo', 'badge', '车标', 'emblem'],
            'wheel': ['wheel', 'rim', '轮毂', 'brake', 'caliper', '刹车', '卡钳'],
            'lights': ['light', 'lamp', 'headlight', 'taillight', '灯', '大灯', '尾灯'],
            'sensor': ['sensor', 'radar', 'lidar', '传感器', '雷达'],
            'body': ['front', 'side', 'rear', 'exterior', '车身', '外观']
        }

        # 检查文件名中是否包含关键词
        for category, keywords in rules.items():
            for keyword in keywords:
                if keyword in filename:
                    return category

        # 默认分类为车身
        return 'body'

    def classify_batch(self, image_paths: List[Path]) -> Dict[str, List[Path]]:
        """
        批量分类图片

        Args:
            image_paths: 图片路径列表

        Returns:
            分类结果字典，键为类别，值为图片路径列表
        """
        classified = {category: [] for category in self.CATEGORIES.keys()}

        for i, image_path in enumerate(image_paths, 1):
            print(f"分类进度: {i}/{len(image_paths)} - {image_path.name}")
            category = self.classify_single_image(image_path)
            classified[category].append(image_path)

        return classified
