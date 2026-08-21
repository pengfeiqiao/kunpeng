#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
豆包多模态客户端
用于图像分类和参数提取
"""

import osimport requests
import base64
import json
from pathlib import Path
from typing import List, Dict


class DoubaoVisionClient:
    """豆包多模态客户端"""

    def __init__(self, api_key: str, base_url: str = None):
        """
        初始化客户端

        Args:
            api_key: API密钥
            base_url: API基础URL
        """
        self.api_key = api_key
        self.base_url = base_url or os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"
        self.model = "doubao-seed-2-0-pro-260215"

    def classify_image(self, image_path: Path) -> str:
        """
        使用豆包对单张图片进行分类

        Args:
            image_path: 图片路径

        Returns:
            分类类别
        """
        import sys
        # 读取并编码图片
        with open(image_path, 'rb') as f:
            image_data = base64.b64encode(f.read()).decode('utf-8')

        # 构建prompt
        prompt = """请分析这张汽车图片，并将其分类到以下类别之一：

- body: 三视图（车身整体视图，包括前、侧、后）
- wheel: 轮毂（包括刹车片和卡钳）
- lights: 灯组（前大灯、尾灯等）
- sensor: 传感器雷达
- logo: 车标

请只返回类别的英文键名（body/wheel/lights/sensor/logo），不要有任何其他解释。
如果图片包含多个类别的内容，请选择最主要的类别。"""

        # 构建请求
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": [
                        {
                            "type": "image_url",
                            "image_url": {
                                "url": f"data:image/jpeg;base64,{image_data}"
                            }
                        },
                        {
                            "type": "text",
                            "text": prompt
                        }
                    ]
                }
            ],
            "max_tokens": 50,
            "temperature": 0.1
        }

        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json"
        }

        try:
            print(f"  正在分类...", end='', flush=True)
            response = requests.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
                timeout=90  # 图片处理需要更长时间
            )

            if response.status_code == 200:
                result = response.json()
                if 'choices' in result and len(result['choices']) > 0:
                    category = result['choices'][0]['message']['content'].strip().lower()

                    # 提取有效的类别名
                    valid_categories = ['body', 'wheel', 'lights', 'sensor', 'logo']
                    for cat in valid_categories:
                        if cat in category:
                            print(f" [OK]", flush=True)
                            return cat

                    print(f" [OK] (默认)", flush=True)
                    return 'body'  # 默认分类
            else:
                print(f" [ERROR] HTTP {response.status_code}", flush=True)
                return 'body'

        except Exception as e:
            print(f" [ERROR] {str(e)[:50]}", flush=True)
            return 'body'

    def analyze_car_parameters(self, images: List[Path], category: str) -> Dict:
        """
        使用豆包分析汽车参数

        Args:
            images: 图片路径列表
            category: 分析类别

        Returns:
            参数字典
        """
        if not images:
            return {}

        # 选择前3张图片分析
        sample_images = images[:3] if len(images) >= 3 else images

        # 根据类别构建不同的分析prompt
        prompts = {
            'body': """请详细分析这些汽车车身图片，以JSON格式返回以下参数：
{
  "车身比例": "描述长宽高比例、轴距特征",
  "腰线特征": "描述腰线位置和走向",
  "车身特点": "描述主要特征",
  "车漆类型": "金属漆/珍珠漆/实色漆",
  "车漆颜色": "主要颜色描述",
  "光影特性": "高光和暗部特征"
}""",
            'wheel': """请分析这些轮毂图片，以JSON格式返回：
{
  "轮毂样式": "描述轮毂设计",
  "轮毂尺寸": "估计尺寸",
  "刹车系统": "刹车盘和卡钳特征"
}""",
            'lights': """请分析这些灯组图片，以JSON格式返回：
{
  "灯组类型": "LED/氙气/卤素",
  "灯组形状": "描述外形特征",
  "内部结构": "描述内部布局"
}""",
            'sensor': """请分析这些传感器图片，以JSON格式返回：
{
  "传感器类型": "摄像头/雷达/激光雷达",
  "安装位置": "描述位置",
  "外观特征": "描述设计"
}""",
            'logo': """请分析这些车标图片，以JSON格式返回：
{
  "品牌": "识别的品牌",
  "材质": "材质类型",
  "设计特点": "描述特征"
}"""
        }

        prompt = prompts.get(category, prompts['body'])

        # 准备图片内容
        content = []
        for img_path in sample_images:
            with open(img_path, 'rb') as f:
                image_data = base64.b64encode(f.read()).decode('utf-8')
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{image_data}"
                    }
                })

        content.append({
            "type": "text",
            "text": prompt
        })

        # 构建请求
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": content
                }
            ],
            "max_tokens": 1000,
            "temperature": 0.3
        }

        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json"
        }

        try:
            response = requests.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
                timeout=300
            )

            if response.status_code == 200:
                result = response.json()
                if 'choices' in result and len(result['choices']) > 0:
                    content_text = result['choices'][0]['message']['content']

                    # 尝试解析JSON
                    try:
                        # 查找JSON内容
                        start_idx = content_text.find('{')
                        end_idx = content_text.rfind('}') + 1
                        if start_idx != -1 and end_idx > start_idx:
                            json_str = content_text[start_idx:end_idx]
                            return json.loads(json_str)
                    except:
                        pass

                    return {"raw_analysis": content_text}
            else:
                print(f"参数提取失败: HTTP {response.status_code}")
                return {}

        except Exception as e:
            print(f"参数提取时出错: {e}")
            return {}

        return {}

    def analyze_images_with_prompt(self, images: List[Path], prompt: str, max_tokens: int = 2000) -> str:
        """
        使用自定义prompt分析图片

        Args:
            images: 图片路径列表
            prompt: 自定义分析prompt
            max_tokens: 最大返回token数

        Returns:
            分析结果文本
        """
        if not images:
            return ""

        # 准备图片内容
        content = []
        for img_path in images:
            with open(img_path, 'rb') as f:
                image_data = base64.b64encode(f.read()).decode('utf-8')
                content.append({
                    "type": "image_url",
                    "image_url": {
                        "url": f"data:image/jpeg;base64,{image_data}"
                    }
                })

        content.append({
            "type": "text",
            "text": prompt
        })

        # 构建请求
        payload = {
            "model": self.model,
            "messages": [
                {
                    "role": "user",
                    "content": content
                }
            ],
            "max_tokens": max_tokens,
            "temperature": 0.1
        }

        headers = {
            "Authorization": self.api_key,
            "Content-Type": "application/json"
        }

        try:
            response = requests.post(
                f"{self.base_url}/chat/completions",
                json=payload,
                headers=headers,
                timeout=300
            )

            if response.status_code == 200:
                result = response.json()
                if 'choices' in result and len(result['choices']) > 0:
                    return result['choices'][0]['message']['content']
            else:
                return f"分析失败: HTTP {response.status_code}"

        except Exception as e:
            return f"分析出错: {e}"

        return ""
