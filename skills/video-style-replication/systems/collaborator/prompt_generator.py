"""
动态提示词生成器
====================================================
根据具体问题动态生成提示词，不是写死的。

用法：
    from systems.collaborator import PromptGenerator

    prompt = PromptGenerator.generate(
        task_type="image_quality_check",
        context={"style": "古装剧", "focus_areas": ["角色一致性"]}
    )
"""

from dataclasses import dataclass, field
from typing import Dict, Any, Optional, List
from datetime import datetime


class PromptGenerator:
    """动态提示词生成器"""

    TEMPLATES = {
        "image_quality_check": """
你是一个专业的{style}视觉质量审查专家。

请分析这张{image_type}，重点关注以下方面：
{focus_areas_text}

请提供：
1. 总体评分（1-10）
2. 各维度详细评分
3. 发现的具体问题
4. 改进建议（可操作的）
""",

        "problem_diagnosis": """
你是一个专业的{style}问题诊断专家。

问题描述：{problem}
场景：{scene}

请分析：
1. 问题的根本原因
2. 可能的解决方案
3. 建议的修改方向
4. 预期效果
""",

        "character_identity": """
你是一个专业的角色一致性审查专家。

角色关键特征：
{character_marks}

请检查：
1. 关键特征是否保留
2. 面部是否与参考一致
3. 服装是否正确
4. 需要调整的地方
""",

        "lighting_analysis": """
你是一个专业的光影分析专家。

风格：{style}
场景类型：{scene_type}

请分析这张图片的光影：
1. 主光源方向和类型
2. 色温是否合适
3. 对比度是否自然
4. 改进建议
""",

        "makeup_review": """
你是一个专业的定妆照审查专家。

角色：{character_name}
风格：{style}

请审查这张定妆照：
1. 角色特征是否清晰
2. 服装是否符合设定
3. 光影是否合适
4. 是否有 AI 感
5. 改进建议
""",

        "storyboard_review": """
你是一个专业的分镜图审查专家。

场景：{scene_name}
风格：{style}
镜头类型：{shot_type}

请审查这张分镜图：
1. 角色一致性（面部特征、服装）
2. 场景融合度（是否有假面感）
3. 光影质量
4. 构图美感
5. 改进建议
""",
    }

    @classmethod
    def register_template(cls, task_type: str, template: str):
        """注册自定义模板"""
        cls.TEMPLATES[task_type] = template

    @classmethod
    def generate(cls, task_type: str, context: Dict[str, Any]) -> str:
        """动态生成提示词"""
        template = cls.TEMPLATES.get(task_type, "")
        if not template:
            return cls._generate_generic_prompt(task_type, context)

        variables = cls._prepare_variables(context)

        try:
            prompt = template.format(**variables)
        except KeyError:
            prompt = template
            for key, value in variables.items():
                prompt = prompt.replace(f"{{{key}}}", str(value))

        return prompt.strip()

    @classmethod
    def _prepare_variables(cls, context: Dict[str, Any]) -> Dict[str, str]:
        """准备模板变量"""
        variables = {}

        variables["style"] = context.get("style", "古装剧")
        variables["image_type"] = context.get("image_type", "图像")
        variables["scene"] = context.get("scene", "未知场景")
        variables["scene_name"] = context.get("scene_name", context.get("scene", "未知场景"))
        variables["problem"] = context.get("problem", "")
        variables["scene_type"] = context.get("scene_type", "")
        variables["shot_type"] = context.get("shot_type", "")
        variables["character_name"] = context.get("character_name", "")

        focus_areas = context.get("focus_areas", [])
        if focus_areas:
            variables["focus_areas_text"] = "\n".join(f"- {area}" for area in focus_areas)
        else:
            variables["focus_areas_text"] = "- 整体质量"

        character_marks = context.get("character_marks", {})
        if character_marks:
            marks_text = []
            for char_name, marks in character_marks.items():
                marks_text.append(f"{char_name}:")
                for mark in marks:
                    marks_text.append(f"  - {mark}")
            variables["character_marks"] = "\n".join(marks_text)
        else:
            variables["character_marks"] = "无特定标记"

        variables["timestamp"] = datetime.now().strftime('%Y-%m-%d %H:%M')

        return variables

    @classmethod
    def _generate_generic_prompt(cls, task_type: str, context: Dict[str, Any]) -> str:
        """生成通用提示词"""
        return f"""
请帮助分析以下问题：

任务类型：{task_type}
上下文：{context}

请提供详细的分析和建议。
"""

    @classmethod
    def list_available_tasks(cls) -> List[str]:
        """列出所有可用的任务类型"""
        return list(cls.TEMPLATES.keys())
