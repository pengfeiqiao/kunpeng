#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
极简版Gemini多图融合客户端 V3
核心策略：强化参考图权重，弱化文字描述，消除AI幻觉
"""

import osfrom pathlib import Path
from typing import List, Dict
import base64

try:
    from google import genai
    from google.genai import types
    GENAI_AVAILABLE = True
except ImportError:
    GENAI_AVAILABLE = False
    print("警告: Google GenAI SDK未安装，请运行: pip install google-genai")


class GeminiMultiRefClientV3Simple:
    """Gemini多图融合客户端 V3 - 极简版本，强化参考图权重"""

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
        self.base_url = base_url or os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn")
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
        output_path: Path = None
    ) -> bytes:
        """
        使用参考图融合生成图片

        Args:
            reference_images: 参考图片路径列表（最多6张）
            prompt: 生成提示词（极简）
            aspect_ratio: 宽高比
            image_size: 分辨率
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

        # 添加极简prompt
        contents.append(types.Part(text=prompt))

        print(f"  调用Gemini API: {self.model}")
        print(f"  参考图: {len(reference_images)}张, 宽高比: {aspect_ratio}, 分辨率: {image_size}")

        try:
            # 调用API
            response = self.client.models.generate_content(
                model=self.model,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_modalities=['IMAGE'],
                    image_config=types.ImageConfig(
                        aspect_ratio=aspect_ratio,
                        image_size=image_size
                    )
                )
            )

            # 提取生成的图片
            if response.candidates:
                for candidate in response.candidates:
                    if candidate.content.parts:
                        for part in candidate.content.parts:
                            if hasattr(part, 'inline_data') and part.inline_data:
                                if isinstance(part.inline_data.data, str):
                                    image_data = base64.b64decode(part.inline_data.data)
                                else:
                                    image_data = part.inline_data.data

                                if output_path:
                                    with open(output_path, 'wb') as f:
                                        f.write(image_data)
                                    print(f"  [OK] 图片已保存: {output_path}")

                                return image_data

            raise Exception("API返回数据中未找到生成的图片")

        except Exception as e:
            print(f"  [ERROR] 生成失败: {e}")
            raise

    def generate_detail_simple(
        self,
        category: str,
        reference_images: List[Path],
        output_dir: Path,
        brand: str = "Vehicle",
        model: str = ""
    ) -> Path:
        """
        使用极简prompt生成细节图 - 强化参考图权重

        核心策略：
        1. 明确告知AI：参考图是真实产品照片
        2. 要求：完全按照参考图生成，不要添加想象
        3. 禁止：根据文字描述进行创作

        Args:
            category: 细节类别 (wheel, logo, sensor_radar, lights)
            reference_images: 参考图片列表
            output_dir: 输出目录
            brand: 汽车品牌
            model: 车型名称

        Returns:
            生成的图片路径
        """
        category_names = {
            'wheel': '轮毂',
            'logo': '车标',
            'sensor_radar': '传感器雷达',
            'lights': '灯组'
        }

        print(f"\n正在生成{category_names.get(category, category)}细节图（基于{len(reference_images)}张参考图）...")

        # 极简化prompt - 核心是让AI看图而不是想象 - 通用版本
        detail_prompts = {
            'wheel': f"""CRITICAL: The provided reference images show the REAL {brand} {model} production wheel. Your task is to generate a professional photograph that EXACTLY matches these reference images.

INSTRUCTIONS:
1. Study ALL reference images carefully - they show the authentic wheel design
2. Replicate EXACTLY what you see in the references:
   - Copy the overall design and proportions
   - Copy the colors and materials
   - Copy the finish and reflections
3. DO NOT imagine or add any details not shown in references
4. DO NOT describe or interpret - just COPY what you see

STRICTLY PROHIBITED:
- DO NOT change any design elements
- DO NOT add imaginary details
- ONLY replicate the authentic design

OUTPUT: Professional product photography, 1:1 composition, 2K resolution, studio lighting, matching the reference images EXACTLY.""",

            'sensor_radar': f"""CRITICAL: The provided reference images show the REAL {brand} {model} production sensing system. Your task is to generate a professional photograph that EXACTLY matches these reference images.

INSTRUCTIONS:
1. Study ALL reference images carefully - they show the authentic sensor module design
2. Replicate EXACTLY what you see in the references:
   - Copy the overall design and position
   - Copy the surface details
   - Copy the materials and finish
3. DO NOT imagine or add any details not shown in references
4. DO NOT describe or interpret - just COPY what you see

STRICTLY PROHIBITED:
- DO NOT change any design elements
- DO NOT add imaginary details
- ONLY replicate the authentic design

OUTPUT: Professional product photography, 1:1 composition, 2K resolution, emphasizing high-tech details, matching the reference images EXACTLY.""",

            'lights': f"""CRITICAL: The provided reference images show the REAL {brand} {model} production light assemblies. Your task is to generate a professional photograph that EXACTLY matches these reference images.

INSTRUCTIONS:
1. Study ALL reference images carefully - they show the authentic headlight and taillight design
2. Replicate EXACTLY what you see in the references:
   - Copy the overall shape and layout
   - Copy the lens design
   - Copy the internal structure
3. DO NOT imagine or add any details not shown in references
4. DO NOT describe or interpret - just COPY what you see

STRICTLY PROHIBITED:
- DO NOT change any design elements
- DO NOT add imaginary details
- ONLY replicate the authentic design

OUTPUT: Professional product photography, 1:1 composition, 2K resolution, split-screen or composite showing both front and rear lights, matching the reference images EXACTLY.""",

            'logo': f"""CRITICAL: The provided reference images show the REAL {brand} brand badge. Your task is to generate a professional close-up photograph that EXACTLY matches these reference images.

INSTRUCTIONS:
1. Study ALL reference images carefully - they show the authentic {brand} logo design
2. Replicate EXACTLY what you see in the references:
   - Copy the shape and proportions
   - Copy the material and finish
   - Copy the lighting and reflections
3. DO NOT imagine or add any details not shown in references
4. DO NOT describe or interpret - just COPY what you see

STRICTLY PROHIBITED:
- DO NOT change any design elements
- DO NOT add imaginary details
- ONLY replicate the authentic design

OUTPUT: Professional product photography, 1:1 composition, 2K resolution, premium presentation, matching the reference images EXACTLY."""
        }

        prompt = detail_prompts.get(category, f"""CRITICAL: Generate a professional photograph that EXACTLY matches the reference images provided.

Study the reference images carefully and replicate what you see EXACTLY. DO NOT add imagined details.""")

        # 生成图片
        output_path = output_dir / f"{category}.jpg"
        image_data = self.generate_with_references(
            reference_images=reference_images,
            prompt=prompt,
            aspect_ratio="1:1",
            image_size="2K",
            output_path=output_path
        )

        return output_path

    def generate_detail_enhanced(
        self,
        category: str,
        reference_images: List[Path],
        output_dir: Path,
        brand: str = "Vehicle",
        model: str = ""
    ) -> Path:
        """
        增强版生成 - 支持三视图和细分灯组

        Args:
            category: 类别 (wheel, sensor_radar, lights_front, lights_rear,
                            body_front, body_side, body_rear, logo)
            reference_images: 参考图片列表
            output_dir: 输出目录
            brand: 汽车品牌
            model: 车型名称

        Returns:
            生成的图片路径
        """
        category_names = {
            'wheel': '轮毂',
            'logo': '车标',
            'sensor_radar': '传感器雷达',
            'lights_front': '前灯组',
            'lights_rear': '后灯组',
            'body_front': '前视图',
            'body_side': '侧视图',
            'body_rear': '后视图'
        }

        print(f"\n正在生成{category_names.get(category, category)}（基于{len(reference_images)}张参考图）...")

        # 极简化prompt - 三视图和灯组 - 通用版本
        enhanced_prompts = {
            'body_front': f"""CRITICAL: The provided reference images show the REAL {brand} {model} production vehicle front view in a WHITE PHOTOGRAPHY STUDIO.

INSTRUCTIONS:
1. Study ALL reference images carefully - they show the authentic front design in a white studio environment
2. Replicate EXACTLY what you see in the references:
   - White photography studio background (important!)
3. License plate area: Use a SOLID BLACK cover plate (NO text, NO numbers, NO characters)
4. DO NOT imagine or add any details not shown in references
5. DO NOT describe or interpret - just COPY what you see

STRICTLY PROHIBITED:
- DO NOT show any license plate text or numbers
- DO NOT change any design elements from the reference images
- DO NOT add imaginary details
- DO NOT change the studio background color
- ONLY replicate the authentic design shown in references

OUTPUT: Professional photography, 16:9 composition, 2K resolution, white studio environment, matching the reference images EXACTLY.""",

            'body_side': f"""CRITICAL: The provided reference images show the REAL {brand} {model} production vehicle side view in a WHITE PHOTOGRAPHY STUDIO.

INSTRUCTIONS:
1. Study ALL reference images carefully - they show the authentic side profile in a white studio environment
2. Replicate EXACTLY what you see in the references:
   - White photography studio background (important!)
3. License plate area: Use a SOLID BLACK cover plate (NO text, NO numbers, NO characters)
4. DO NOT imagine or add any details not shown in references
5. DO NOT describe or interpret - just COPY what you see

STRICTLY PROHIBITED:
- DO NOT show any license plate text or numbers
- DO NOT change any design elements from the reference images
- DO NOT add imaginary details
- DO NOT change the studio background color
- ONLY replicate the authentic design shown in references

OUTPUT: Professional photography, 16:9 composition, 2K resolution, white studio environment, matching the reference images EXACTLY.""",

            'body_rear': f"""# HIGHEST PRIORITY - SINGLE IMAGE OUTPUT
仅输出单张完整的车身后视图，绝对禁止任何多图拼接、多视角组合、拼贴形式，必须是一张完整的16:9后视图。

# 核心要求
1. 背景：纯白色专业摄影棚，无任何杂物
2. 车辆：完整的{brand} {model}车身后视图
   - 所有车尾设计元素100%对齐参考图，完全以参考图为唯一生成依据，禁止调用任何{brand} {model}旧款通用训练数据
   - 尾灯：严格匹配参考图的新款分体式结构、造型、灯带排布与颜色
   - 尾标：仅保留参考图中的「{model}」金属标识、「华晨宝马」中文金属标识，禁止添加任何其他额外标识
   - 车尾{brand} logo：使用参考图对应的最新款扁平化样式
   - 车牌区域：纯黑色盖板，无任何文字、图案
3. 构图：专业汽车摄影，车身居中，完整展示整个车尾

# 严格禁止
- 禁止输出多张拼接图、多视角组合图
- 禁止使用参考图之外的任何设计元素
- 禁止添加任何参考图不存在的标识、装饰
- 禁止修改背景颜色""",

            'lights_front': f"""CRITICAL: The provided reference images show the REAL {brand} {model} production front headlights.

INSTRUCTIONS:
1. Study ALL reference images carefully - they show the authentic front headlight design
2. Replicate EXACTLY what you see in the references:
   - Copy the overall shape and layout
   - Copy the lens design
   - Copy the internal structure
3. DO NOT imagine or add any details not shown in references
4. DO NOT describe or interpret - just COPY what you see

STRICTLY PROHIBITED:
- DO NOT change any design elements from the reference images
- DO NOT add imaginary details
- DO NOT use any pre-conceived design ideas
- ONLY replicate the authentic design shown in references

OUTPUT: Professional product photography, 1:1 composition, 2K resolution, studio lighting, matching the reference images EXACTLY.""",

            'lights_rear': f"""# HIGHEST PRIORITY (ENFORCE STRICTLY)
The provided reference image is the ONLY source of all visual features. All pre-trained knowledge about {brand}, {model}, cars are FORBIDDEN to use, reference image features have absolute priority over any built-in knowledge.

# 核心复刻要求（必须100%执行）
完全匹配参考图的所有几何特征：包括尾灯的整体轮廓、尾灯内部所有结构、车身所有曲面造型、所有部件的相对位置，不做任何修改、美化、调整，尾灯保持参考图的未点亮状态，不添加任何发光效果。

# 输出要求
专业汽车棚拍风格，光线柔和均匀，构图和参考图完全一致，不添加任何参考图不存在的元素，车牌区域如可见使用纯黑色盖板无任何文字。""",
        }

        # 使用原有的prompt（轮毂、传感器、车标）
        if category in ['wheel', 'sensor_radar', 'logo']:
            return self.generate_detail_simple(category, reference_images, output_dir)

        # 使用增强prompt（三视图、细分灯组）
        prompt = enhanced_prompts.get(category, f"Professional photograph matching the reference images exactly")

        # 确定宽高比
        aspect_ratio = "16:9" if category.startswith('body_') else "1:1"

        # 生成图片
        output_filename = f"{category}.jpg"
        output_path = output_dir / output_filename

        image_data = self.generate_with_references(
            reference_images=reference_images,
            prompt=prompt,
            aspect_ratio=aspect_ratio,
            image_size="2K",
            output_path=output_path
        )

        return output_path
