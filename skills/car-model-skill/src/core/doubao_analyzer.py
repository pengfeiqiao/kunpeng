#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
豆包视觉分析客户端 - 质量分析和提示词优化
"""

import osfrom pathlib import Path
from typing import Dict, Optional
import base64
import json

from openai import OpenAI


class DoubaoAnalyzer:
    """豆包AI视觉分析客户端，用于质量检测和提示词优化"""

    def __init__(self, api_key: str, base_url: str = None):
        """
        初始化分析器

        Args:
            api_key: 豆包API密钥
            base_url: API基础URL
        """
        self.api_key = api_key
        self.base_url = base_url
        self.model = "doubao-seed-2-0-pro-260215"

        # 创建客户端
        self.client = OpenAI(
            api_key=api_key,
            base_url=base_url
        )

    def encode_image(self, image_path: Path) -> str:
        """将图片编码为base64"""
        with open(image_path, "rb") as f:
            return base64.b64encode(f.read()).decode('utf-8')

    def analyze_generation(
        self,
        reference_image: Path,
        generated_image: Path,
        current_prompt: str,
        category: str = ""
    ) -> Dict:
        """
        分析生成图片的问题

        Args:
            reference_image: 参考图路径
            generated_image: 生成图路径
            current_prompt: 当前使用的提示词
            category: 图片类别

        Returns:
            分析结果字典，包含：
            - issues: 问题列表
            - root_cause: 根本原因
            - optimized_prompt: 优化后的提示词
            - explanation: 优化说明
        """
        # 构建消息
        content = []

        # 添加参考图
        ref_base64 = self.encode_image(reference_image)
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{ref_base64}"}
        })

        # 添加生成图
        gen_base64 = self.encode_image(generated_image)
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{gen_base64}"}
        })

        # 构建分析提示
        prompt = f"""我是AI图像生成工程师，生成的{category}图片有问题。

**第一张图片**：真实的参考图（真实产品照片）
**第二张图片**：AI生成的图片（使用当前提示词）

**当前使用的提示词**：
```
{current_prompt}
```

请你：

1. **对比参考图和生成图**：
   - 详细列出所有不一致的地方
   - 特别关注构图、样式、细节等

2. **深度分析问题根源**：
   - 为什么会出现这些问题？
   - 提示词哪里有缺陷？
   - AI调用了什么错误的知识？

3. **给出优化后的提示词**：
   - 针对发现的问题进行优化
   - 使用更清晰的表达
   - 必要时使用正向指令而非否定式

请用以下JSON格式回答：

{{
  "issues": [
    "问题1：详细描述",
    "问题2：详细描述",
    "问题3：详细描述"
  ],
  "root_cause": "根本原因的详细分析",
  "optimized_prompt": "优化后的完整提示词",
  "explanation": "为什么这个优化会有效"
}}
"""

        content.append({"type": "text", "text": prompt})

        # 调用API
        response = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": content}],
            max_tokens=3000
        )

        result_text = response.choices[0].message.content

        # 尝试解析JSON
        try:
            # 提取JSON部分（可能被markdown包裹）
            if "```json" in result_text:
                json_str = result_text.split("```json")[1].split("```")[0].strip()
            elif "```" in result_text:
                json_str = result_text.split("```")[1].split("```")[0].strip()
            else:
                json_str = result_text.strip()

            result = json.loads(json_str)
        except:
            # 如果无法解析JSON，返回原始文本
            result = {
                "issues": ["无法解析分析结果"],
                "root_cause": result_text,
                "optimized_prompt": current_prompt,
                "explanation": "请查看root_cause字段获取详细分析"
            }

        return result

    def check_quality(
        self,
        reference_image: Path,
        generated_image: Path,
        category: str
    ) -> Dict:
        """
        快速质量检查

        Args:
            reference_image: 参考图路径
            generated_image: 生成图路径
            category: 图片类别

        Returns:
            质量检查结果
        """
        content = []

        # 添加参考图和生成图
        ref_base64 = self.encode_image(reference_image)
        gen_base64 = self.encode_image(generated_image)

        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{ref_base64}"}
        })
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{gen_base64}"}
        })

        prompt = f"""快速检查这张{category}生成图的质量。

第一张：参考图
第二张：生成图

请检查：
1. 是否单张完整图像（不是多图拼接）
2. 主要设计元素是否正确
3. 是否有明显的错误或问题

用JSON格式回答：
{{
  "pass": true/false,
  "issues": ["问题1", "问题2"],
  "severity": "high/medium/low"
}}
"""

        content.append({"type": "text", "text": prompt})

        response = self.client.chat.completions.create(
            model=self.model,
            messages=[{"role": "user", "content": content}],
            max_tokens=1000
        )

        result_text = response.choices[0].message.content

        try:
            if "```json" in result_text:
                json_str = result_text.split("```json")[1].split("```")[0].strip()
            elif "```" in result_text:
                json_str = result_text.split("```")[1].split("```")[0].strip()
            else:
                json_str = result_text.strip()

            result = json.loads(json_str)
        except:
            result = {
                "pass": False,
                "issues": ["无法解析检查结果"],
                "severity": "medium"
            }

        return result
