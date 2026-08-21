"""
豆包协作者客户端
====================================================
与豆包 AI 协作，处理多模态问题。

核心原则：
1. 用户提需求 → 我下发给豆包 → 一起协作解决
2. 不能搞乱 skill 的核心逻辑
3. 只在需要时调用
4. 提示词是动态生成的
5. 直接调用豆包API获取真实结果

用法：
    from systems.collaborator import DoubaoClient

    client = DoubaoClient()

    # 直接问豆包（文本）
    result = client.ask("分析这张分镜图的表演问题")

    # 问豆包（带图片）
    result = client.ask("分析这张分镜图", images=["shot_1.jpg"])

    # 诊断问题
    result = client.diagnose_problem("表演僵硬", image_path="shot_1.jpg")

    # 审查分镜
    result = client.review_storyboard("shot_1.jpg", scene_name="大堂")
"""

import os
import base64
import requests
from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, Any, Optional, List
from PIL import Image
import io

from .prompt_generator import PromptGenerator


@dataclass
class CollaborationResult:
    """协作者结果"""
    success: bool
    task_type: str
    prompt: str
    response: str = ""
    suggestions: List[str] = field(default_factory=list)
    issues: List[str] = field(default_factory=list)
    scores: Dict[str, float] = field(default_factory=dict)


class DoubaoClient:
    """豆包协作者客户端 - 直接调用豆包API"""

    # 豆包模型列表
    MODELS = {
        "pro": "doubao-seed-2-0-pro-260215",
        "lite": "doubao-seed-2-0-lite-260215",
        "mini": "doubao-seed-2-0-mini-260215"
    }

    def __init__(self, work_logger=None, model: str = "pro"):
        self.work_logger = work_logger
        self.api_key = os.environ.get("DMXAPI_KEY")
        if not self.api_key:
            raise ValueError("❌ DMXAPI_KEY 未配置，请在 ~/.zshrc 中设置")
        self.base_url = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"
        self.model = self.MODELS.get(model, self.MODELS["pro"])

    def ask(
        self,
        prompt: str,
        images: List[Path] = None,
        model: str = None,
        timeout: int = 300
    ) -> CollaborationResult:
        """
        直接问豆包（支持多模态）

        Args:
            prompt: 提示词
            images: 图片路径列表
            model: 模型选择 (pro/standard/vision)
            timeout: 超时时间

        Returns:
            CollaborationResult
        """
        # 选择模型
        use_model = self.MODELS.get(model, self.model) if model else self.model

        # 如果有图片，使用pro模型（支持多模态）
        if images:
            use_model = self.MODELS["pro"]

        # 构建消息内容
        content = [{"type": "text", "text": prompt}]

        # 添加图片
        if images:
            for img_path in images:
                if Path(img_path).exists():
                    img_b64 = self._compress_image(Path(img_path))
                    content.append({
                        "type": "image_url",
                        "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}
                    })

        try:
            response = requests.post(
                f"{self.base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": use_model,
                    "messages": [{"role": "user", "content": content}],
                    "max_tokens": 8192
                },
                timeout=timeout
            )

            if response.status_code == 200:
                result = response.json()
                if "choices" in result and len(result["choices"]) > 0:
                    response_text = result["choices"][0]["message"]["content"]

                    # 记录到工作日志
                    if self.work_logger:
                        self.work_logger.log_collaboration(
                            collaborator="豆包",
                            task=prompt[:100],
                            result=response_text[:200]
                        )

                    return CollaborationResult(
                        success=True,
                        task_type="direct_query",
                        prompt=prompt,
                        response=response_text
                    )
                else:
                    return CollaborationResult(
                        success=False,
                        task_type="direct_query",
                        prompt=prompt,
                        response=f"解析失败: {result}"
                    )
            else:
                return CollaborationResult(
                    success=False,
                    task_type="direct_query",
                    prompt=prompt,
                    response=f"请求失败: {response.status_code} - {response.text}"
                )

        except Exception as e:
            return CollaborationResult(
                success=False,
                task_type="direct_query",
                prompt=prompt,
                response=f"异常: {str(e)}"
            )

    def analyze(
        self,
        task_type: str,
        images: List[Path] = None,
        context: Dict[str, Any] = None,
        custom_prompt: str = None
    ) -> CollaborationResult:
        """
        分析任务（使用预定义模板）

        Args:
            task_type: 任务类型
            images: 图片列表
            context: 上下文
            custom_prompt: 自定义提示词

        Returns:
            CollaborationResult
        """
        context = context or {}

        # 生成提示词
        if custom_prompt:
            prompt = custom_prompt
        else:
            prompt = PromptGenerator.generate(task_type, context)

        # 调用豆包
        return self.ask(prompt, images=images)

    def diagnose_problem(
        self,
        problem: str,
        scene_id: str = None,
        image_path: Path = None,
        style: str = "古装剧"
    ) -> CollaborationResult:
        """
        诊断问题（便捷方法）

        用法：
            result = client.diagnose_problem(
                problem="表演僵硬",
                scene_id="scene_07",
                image_path="shot_1.jpg"
            )
            print(result.response)
        """
        prompt = f"""你是一个专业的{style}问题诊断专家。

问题描述：{problem}
场景：{scene_id or '未指定'}

请分析：
1. 问题的根本原因
2. 可能的解决方案
3. 建议的修改方向
4. 预期效果

请给出具体可操作的建议。"""

        images = [image_path] if image_path else None
        return self.ask(prompt, images=images)

    def check_image_quality(
        self,
        image_path: Path,
        focus_areas: List[str] = None,
        style: str = "古装剧",
        image_type: str = "分镜图"
    ) -> CollaborationResult:
        """
        检查图像质量（便捷方法）

        用法：
            result = client.check_image_quality(
                image_path="shot_1.jpg",
                focus_areas=["角色一致性", "光影质量", "质感真实度"]
            )
            print(result.response)
        """
        focus_text = "\n".join(f"- {area}" for area in (focus_areas or ["整体质量"]))

        prompt = f"""你是一个专业的{style}视觉质量审查专家。

请分析这张{image_type}，重点关注以下方面：
{focus_text}

请提供：
1. 总体评分（1-10）
2. 各维度详细评分
3. 发现的具体问题
4. 改进建议（可操作的）"""

        return self.ask(prompt, images=[image_path])

    def check_character_identity(
        self,
        image_path: Path,
        character_marks: Dict[str, List[str]],
        style: str = "古装剧"
    ) -> CollaborationResult:
        """
        检查角色一致性（便捷方法）

        用法：
            result = client.check_character_identity(
                image_path="shot_1.jpg",
                character_marks={
                    "沈砚舟": ["左侧鼻翼泪痣"],
                    "陶檐": ["双侧梨涡"]
                }
            )
            print(result.response)
        """
        marks_text = []
        for char_name, marks in character_marks.items():
            marks_text.append(f"{char_name}:")
            for mark in marks:
                marks_text.append(f"  - {mark}")
        marks_str = "\n".join(marks_text)

        prompt = f"""你是一个专业的角色一致性审查专家。

角色关键特征：
{marks_str}

请检查：
1. 关键特征是否保留
2. 面部是否与参考一致
3. 服装是否正确
4. 需要调整的地方"""

        return self.ask(prompt, images=[image_path])

    def review_storyboard(
        self,
        image_path: Path,
        scene_name: str,
        shot_type: str = "medium",
        style: str = "古装剧"
    ) -> CollaborationResult:
        """
        审查分镜图（便捷方法）

        用法：
            result = client.review_storyboard(
                image_path="shot_9_wide.jpg",
                scene_name="辟讹署大堂",
                shot_type="全景"
            )
            print(result.response)
        """
        prompt = f"""你是一个专业的分镜图审查专家。

场景：{scene_name}
风格：{style}
镜头类型：{shot_type}

请审查这张分镜图：
1. 角色一致性（面部特征、服装）
2. 场景融合度（是否有假面感）
3. 光影质量
4. 构图美感
5. 表演自然度（角色是否僵硬）
6. 改进建议"""

        return self.ask(prompt, images=[image_path])

    def discuss_optimization(
        self,
        topic: str,
        current_state: str,
        image_path: Path = None
    ) -> CollaborationResult:
        """
        讨论优化方案（便捷方法）

        用法：
            result = client.discuss_optimization(
                topic="光影系统扩展",
                current_state="当前只支持雪夜场景..."
            )
            print(result.response)
        """
        prompt = f"""我正在开发一个AI分镜生成系统，需要你帮我讨论优化方案。

## 讨论主题
{topic}

## 当前状态
{current_state}

请给出：
1. 问题分析
2. 优化建议
3. 具体可操作的方案
4. 可以直接加入提示词的关键词"""

        images = [image_path] if image_path else None
        return self.ask(prompt, images=images, timeout=180)

    def get_prompt_for_task(self, task_type: str, context: Dict[str, Any]) -> str:
        """获取任务提示词（不调用API，只生成提示词）"""
        return PromptGenerator.generate(task_type, context)

    def _compress_image(self, path: Path, max_size: int = 1500) -> str:
        """压缩图像"""
        img = Image.open(path)
        if max(img.size) > max_size:
            ratio = max_size / max(img.size)
            new_size = (int(img.width * ratio), int(img.height * ratio))
            img = img.resize(new_size, Image.Resampling.LANCZOS)
        if img.mode in ('RGBA', 'P'):
            img = img.convert('RGB')
        buffer = io.BytesIO()
        img.save(buffer, format='JPEG', quality=85)
        return base64.b64encode(buffer.getvalue()).decode()


def get_prompt(task_type: str, context: Dict[str, Any]) -> str:
    """获取提示词（便捷函数）"""
    return PromptGenerator.generate(task_type, context)
