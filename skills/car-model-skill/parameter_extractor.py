#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
参数提取模块
从分类后的图片中提取汽车特征参数
"""

import os
from pathlib import Path
from typing import Dict, List, Any
import base64
import json

try:
    from anthropic import Anthropic
    ANTHROPIC_AVAILABLE = True
except ImportError:
    ANTHROPIC_AVAILABLE = False


class CarParameterExtractor:
    """汽车参数提取器"""

    def __init__(self, api_key: str = None):
        """
        初始化提取器

        Args:
            api_key: Anthropic API密钥
        """
        self.api_key = api_key or os.environ.get('ANTHROPIC_API_KEY')
        self.client = None

        if ANTHROPIC_AVAILABLE and self.api_key:
            self.client = Anthropic(api_key=self.api_key)

    def extract_body_parameters(self, body_images: List[Path]) -> Dict:
        """
        提取车身参数

        Args:
            body_images: 车身图片列表

        Returns:
            车身参数字典
        """
        if not body_images:
            return {}

        # 选择最清晰的几张图片进行分析
        sample_images = body_images[:3] if len(body_images) >= 3 else body_images

        prompt = """请详细分析这些汽车车身图片，提取以下参数：

1. 车身比例：
   - 长宽高比例
   - 轴距比例
   - 前后悬比例

2. 腰线与体块：
   - 腰线位置和走向
   - 主体块特征
   - 车身曲面特征

3. 灯组结构：
   - 前大灯形状、位置、内部结构
   - 尾灯形状、位置、内部结构
   - 日间行车灯特征

4. 车漆特性：
   - 车漆颜色（主色调、RGB估计值）
   - 车漆类型（金属漆/珍珠漆/实色漆）
   - 颗粒度（粒径密度、闪烁方式）

5. 光影特性：
   - 高光区域色相
   - 暗部区域色相
   - 反射特性

请以JSON格式返回结果。"""

        if self.client:
            return self._extract_with_claude(sample_images, prompt)
        else:
            return self._extract_default_body_parameters()

    def extract_wheel_parameters(self, wheel_images: List[Path]) -> Dict:
        """提取轮毂参数"""
        if not wheel_images:
            return {}

        prompt = """请分析这些轮毂图片，提取以下参数：

1. 轮毂设计：
   - 轮毂样式类型
   - 辐条数量和形状
   - 尺寸（英寸）
   - 颜色和材质

2. 刹车系统：
   - 刹车盘类型（通风盘/实心盘）
   - 卡钳颜色和位置
   - 卡钳品牌标识

请以JSON格式返回结果。"""

        if self.client:
            return self._extract_with_claude(wheel_images[:2], prompt)
        else:
            return self._extract_default_wheel_parameters()

    def extract_lights_parameters(self, lights_images: List[Path]) -> Dict:
        """提取灯组参数"""
        if not lights_images:
            return {}

        prompt = """请分析这些灯组图片，提取以下参数：

1. 灯组设计：
   - 灯组形状和轮廓
   - 内部结构布局
   - 灯组科技感元素

2. 光源特性：
   - 光源类型（LED/氙气/卤素）
   - 日间行车灯样式
   - 转向灯位置

请以JSON格式返回结果。"""

        if self.client:
            return self._extract_with_claude(lights_images[:2], prompt)
        else:
            return self._extract_default_lights_parameters()

    def extract_sensor_parameters(self, sensor_images: List[Path]) -> Dict:
        """提取传感器雷达参数"""
        if not sensor_images:
            return {}

        prompt = """请分析这些传感器雷达图片，提取以下参数：

1. 传感器位置和类型：
   - 摄像头位置
   - 雷达位置
   - 激光雷达位置

2. 外观特征：
   - 传感器外观设计
   - 集成方式

请以JSON格式返回结果。"""

        if self.client:
            return self._extract_with_claude(sensor_images[:2], prompt)
        else:
            return self._extract_default_sensor_parameters()

    def extract_logo_parameters(self, logo_images: List[Path]) -> Dict:
        """提取车标参数"""
        if not logo_images:
            return {}

        prompt = """请分析这些车标图片，提取以下参数：

1. 车标设计：
   - 车标形状和轮廓
   - 车标尺寸比例
   - 品牌特征

2. 材质特性：
   - 材质类型
   - 表面处理
   - 反光特性

请以JSON格式返回结果。"""

        if self.client:
            return self._extract_with_claude(logo_images[:1], prompt)
        else:
            return self._extract_default_logo_parameters()

    def _extract_with_claude(self, images: List[Path], prompt: str) -> Dict:
        """使用Claude Vision提取参数"""
        if not images:
            return {}

        try:
            # 准备图片内容
            content = []
            for image_path in images:
                with open(image_path, 'rb') as f:
                    image_data = base64.b64encode(f.read()).decode('utf-8')

                ext = image_path.suffix.lower()
                media_type = 'image/jpeg' if ext in ['.jpg', '.jpeg'] else 'image/png'

                content.append({
                    "type": "image",
                    "source": {
                        "type": "base64",
                        "media_type": media_type,
                        "data": image_data,
                    },
                })

            # 添加文本提示
            content.append({
                "type": "text",
                "text": prompt
            })

            # 调用API
            message = self.client.messages.create(
                model="claude-3-5-sonnet-20241022",
                max_tokens=2000,
                messages=[
                    {
                        "role": "user",
                        "content": content,
                    }
                ],
            )

            # 解析JSON结果
            response_text = message.content[0].text

            # 尝试提取JSON
            try:
                # 查找JSON内容
                start_idx = response_text.find('{')
                end_idx = response_text.rfind('}') + 1
                if start_idx != -1 and end_idx > start_idx:
                    json_str = response_text[start_idx:end_idx]
                    return json.loads(json_str)
                else:
                    return {"raw_analysis": response_text}
            except json.JSONDecodeError:
                return {"raw_analysis": response_text}

        except Exception as e:
            print(f"使用Claude提取参数失败: {e}")
            return {"error": str(e)}

    def extract_all_parameters(self, classified_images: Dict[str, List[Path]]) -> Dict:
        """
        提取所有参数

        Args:
            classified_images: 分类后的图片字典

        Returns:
            完整的参数字典
        """
        parameters = {
            'body': self.extract_body_parameters(classified_images.get('body', [])),
            'wheel': self.extract_wheel_parameters(classified_images.get('wheel', [])),
            'lights': self.extract_lights_parameters(classified_images.get('lights', [])),
            'sensor': self.extract_sensor_parameters(classified_images.get('sensor', [])),
            'logo': self.extract_logo_parameters(classified_images.get('logo', []))
        }

        return parameters

    # 默认参数（当API不可用时）
    def _extract_default_body_parameters(self) -> Dict:
        return {
            "车身比例": "标准SUV比例",
            "腰线": "贯穿式腰线",
            "车漆": "金属漆，中等颗粒度"
        }

    def _extract_default_wheel_parameters(self) -> Dict:
        return {
            "轮毂": "多辐式铝合金轮毂",
            "刹车": "通风盘，红色卡钳"
        }

    def _extract_default_lights_parameters(self) -> Dict:
        return {
            "灯组": "LED灯组",
            "日行灯": "贯穿式设计"
        }

    def _extract_default_sensor_parameters(self) -> Dict:
        return {
            "传感器": "多传感器融合系统"
        }

    def _extract_default_logo_parameters(self) -> Dict:
        return {
            "车标": "品牌标识，镀铬材质"
        }
