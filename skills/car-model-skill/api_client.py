#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BannanaPro API客户端
用于调用图像生成API
"""

import os
import requests
from pathlib import Path
from typing import List, Dict, Any
import base64
import json
import time


class BananaProClient:
    """BananaPro API客户端（基于DMXAPI的nano-banana-2模型）"""

    def __init__(self, api_key: str, base_url: str = None):
        """
        初始化客户端

        Args:
            api_key: API密钥
            base_url: API基础URL
        """
        self.api_key = api_key
        self.base_url = base_url or os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"
        self.session = requests.Session()
        self.session.headers.update({
            'Authorization': api_key,  # DMXAPI直接使用密钥，不需要Bearer前缀
            'Content-Type': 'application/json'
        })

    def generate_view(
        self,
        view: str,
        reference_images: List[Path],
        parameters: Dict,
        output_dir: Path
    ) -> Path:
        """
        生成指定视角的车身图像

        Args:
            view: 视角类型（front_view/side_view/rear_view）
            reference_images: 参考图片列表
            parameters: 控制参数
            output_dir: 输出目录

        Returns:
            生成的图片路径
        """
        view_names = {
            'front_view': '前视图',
            'side_view': '侧视图',
            'rear_view': '后视图'
        }

        print(f"正在生成{view_names.get(view, view)}...")

        # 构建生成prompt
        prompt = self._build_view_prompt(view, parameters)

        # 准备参考图片
        reference_data = self._prepare_reference_images(reference_images[:5])

        # 调用API
        try:
            image_data = self._call_generation_api(
                prompt=prompt,
                reference_images=reference_data,
                parameters=parameters
            )

            # 保存生成的图片
            output_path = output_dir / f"{view}.jpg"
            with open(output_path, 'wb') as f:
                f.write(image_data)

            print(f"{view_names.get(view, view)}生成完成: {output_path}")
            return output_path

        except Exception as e:
            print(f"生成{view}失败: {e}")
            # 返回一个占位符或使用第一张参考图
            if reference_images:
                placeholder = output_dir / f"{view}.jpg"
                # 复制第一张参考图作为占位
                import shutil
                shutil.copy(reference_images[0], placeholder)
                return placeholder
            raise

    def generate_detail(
        self,
        category: str,
        reference_images: List[Path],
        parameters: Dict,
        output_dir: Path
    ) -> Path:
        """
        生成细节图像

        Args:
            category: 细节类别（wheel/logo/sensor_radar/lights）
            reference_images: 参考图片列表
            parameters: 控制参数
            output_dir: 输出目录

        Returns:
            生成的图片路径
        """
        category_names = {
            'wheel': '轮毂',
            'logo': '车标',
            'sensor_radar': '传感器雷达',
            'lights': '灯组'
        }

        print(f"正在生成{category_names.get(category, category)}细节图...")

        # 构建生成prompt
        prompt = self._build_detail_prompt(category, parameters)

        # 准备参考图片
        reference_data = self._prepare_reference_images(reference_images[:3])

        # 调用API
        try:
            image_data = self._call_generation_api(
                prompt=prompt,
                reference_images=reference_data,
                parameters=parameters,
                detail_mode=True
            )

            # 保存生成的图片
            output_path = output_dir / f"{category}.jpg"
            with open(output_path, 'wb') as f:
                f.write(image_data)

            print(f"{category_names.get(category, category)}生成完成: {output_path}")
            return output_path

        except Exception as e:
            print(f"生成{category}失败: {e}")
            # 使用第一张参考图作为占位
            if reference_images:
                placeholder = output_dir / f"{category}.jpg"
                import shutil
                shutil.copy(reference_images[0], placeholder)
                return placeholder
            raise

    def _build_view_prompt(self, view: str, parameters: Dict) -> str:
        """构建视角生成的prompt"""
        body_params = parameters.get('body', {})

        view_prompts = {
            'front_view': f"""
高质量汽车前视图摄影，专业级别。
- 车身比例：{body_params.get('车身比例', '标准比例')}
- 腰线特征：{body_params.get('腰线', '贯穿式')}
- 车漆：{body_params.get('车漆', '金属漆')}
- 灯组：{parameters.get('lights', {}).get('灯组', 'LED灯组')}
- 车标：{parameters.get('logo', {}).get('车标', '品牌标识')}
专业摄影棚光线，4K分辨率，真实材质表现
""",
            'side_view': f"""
高质量汽车侧视图摄影，专业级别。
- 车身比例：{body_params.get('车身比例', '标准比例')}
- 腰线：{body_params.get('腰线', '贯穿式腰线')}
- 轮毂：{parameters.get('wheel', {}).get('轮毂', '铝合金轮毂')}
- 车漆：{body_params.get('车漆', '金属漆')}
- 传感器：{parameters.get('sensor', {}).get('传感器', '多传感器')}
专业摄影棚光线，4K分辨率，真实材质表现
""",
            'rear_view': f"""
高质量汽车后视图摄影，专业级别。
- 车身比例：{body_params.get('车身比例', '标准比例')}
- 尾灯：{parameters.get('lights', {}).get('灯组', 'LED尾灯')}
- 车漆：{body_params.get('车漆', '金属漆')}
- 车标：{parameters.get('logo', {}).get('车标', '品牌标识')}
专业摄影棚光线，4K分辨率，真实材质表现
"""
        }

        return view_prompts.get(view, "高质量汽车摄影")

    def _build_detail_prompt(self, category: str, parameters: Dict) -> str:
        """构建细节生成的prompt"""
        detail_prompts = {
            'wheel': f"""
汽车轮毂特写，专业产品摄影。
{parameters.get('wheel', {}).get('轮毂', '铝合金轮毂特写')}
{parameters.get('wheel', {}).get('刹车', '刹车系统可见')}
高清晰度，完美光线，材质细节丰富
""",
            'logo': f"""
汽车品牌标识特写，专业产品摄影。
{parameters.get('logo', {}).get('车标', '品牌标识')}
高清晰度，完美光线，材质质感强烈
""",
            'sensor_radar': f"""
汽车传感器雷达特写，专业产品摄影。
{parameters.get('sensor', {}).get('传感器', '传感器系统')}
高清晰度，完美光线，科技感强
""",
            'lights': f"""
汽车灯组特写，专业产品摄影。
{parameters.get('lights', {}).get('灯组', 'LED灯组')}
{parameters.get('lights', {}).get('日行灯', '日间行车灯')}
高清晰度，完美光线，内部结构清晰
"""
        }

        return detail_prompts.get(category, "汽车细节特写")

    def _prepare_reference_images(self, images: List[Path]) -> List[str]:
        """准备参考图片（转换为base64）"""
        reference_data = []
        for img_path in images:
            try:
                with open(img_path, 'rb') as f:
                    img_base64 = base64.b64encode(f.read()).decode('utf-8')
                    reference_data.append(img_base64)
            except Exception as e:
                print(f"读取参考图片失败 {img_path}: {e}")
        return reference_data

    def _call_generation_api(
        self,
        prompt: str,
        reference_images: List[str],
        parameters: Dict,
        detail_mode: bool = False
    ) -> bytes:
        """
        调用图像生成API（DMXAPI nano-banana-2）

        Args:
            prompt: 生成提示词
            reference_images: 参考图片（base64列表，nano-banana-2的文生图不直接支持，通过prompt描述）
            parameters: 控制参数
            detail_mode: 是否为细节模式

        Returns:
            生成的图片数据（bytes）
        """
        # nano-banana-2 API参数
        # 根据是否为细节模式选择宽高比和分辨率
        if detail_mode:
            aspect_ratio = "1:1"  # 细节图使用正方形
            size = "2k"  # 细节图使用2K分辨率
        else:
            aspect_ratio = "16:9"  # 三视图使用16:9
            size = "2k"  # 使用2K分辨率

        payload = {
            "model": "nano-banana-2",
            "prompt": prompt,
            "n": 1,
            "aspect_ratio": aspect_ratio,
            "size": size,
            "response_format": "b64_json"  # 使用base64返回格式
        }

        try:
            print(f"  调用API: {self.base_url}/images/generations")
            print(f"  模型: nano-banana-2, 宽高比: {aspect_ratio}, 分辨率: {size}")

            response = self.session.post(
                f"{self.base_url}/images/generations",
                json=payload,
                timeout=300  # 图像生成可能需要较长时间
            )

            if response.status_code == 200:
                result = response.json()
                # nano-banana-2返回格式: {"data": [{"b64_json": "..."}, ...]}
                if 'data' in result and len(result['data']) > 0:
                    image_data = result['data'][0]

                    # 处理base64编码的图片
                    if 'b64_json' in image_data:
                        print(f"  ✓ 成功接收base64图片数据")
                        return base64.b64decode(image_data['b64_json'])

                    # 处理URL格式
                    elif 'url' in image_data:
                        print(f"  ✓ 成功接收图片URL: {image_data['url']}")
                        img_response = requests.get(image_data['url'], timeout=30)
                        return img_response.content

                else:
                    raise Exception(f"API返回的数据格式不正确: {result}")
            else:
                raise Exception(f"API返回错误: {response.status_code} - {response.text}")

        except requests.exceptions.RequestException as e:
            print(f"  ✗ API调用失败: {e}")
            if hasattr(e, 'response') and e.response is not None:
                print(f"  错误详情: {e.response.text}")
            raise

        return b''  # 空数据
