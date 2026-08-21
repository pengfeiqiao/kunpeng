"""
视频提示词格式化器
====================================================
将生成的视频提示词格式化为 Markdown 文件。

输出格式：
- 单个段落文件: segment_01_开篇.md
- 合并文件: all_prompts.md
"""

from dataclasses import dataclass, field
from typing import List, Optional
from datetime import datetime


@dataclass
class VideoPrompt:
    """视频提示词"""
    segment_index: int              # 段落序号 1-5
    segment_name: str               # 段落名称
    prompt_text: str                # 完整提示词文本
    shots_included: List[int]       # 包含的分镜编号
    characters: List[str]           # 出场角色
    duration_estimate: float        # 预估时长（秒）
    scene_name: str = ""            # 场景名称
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())


class VideoPromptFormatter:
    """视频提示词格式化器"""

    @staticmethod
    def format_prompt(prompt: VideoPrompt) -> str:
        """
        格式化单个视频提示词为 Markdown

        Args:
            prompt: 视频提示词对象

        Returns:
            Markdown 格式的提示词
        """
        lines = []

        # 标题
        lines.append(f"# 视频提示词 - 段落{prompt.segment_index}：{prompt.segment_name}")
        lines.append("")

        # 元数据
        lines.append(f"**场景**: {prompt.scene_name}")
        lines.append(f"**分镜**: {', '.join(map(str, prompt.shots_included))}")
        lines.append(f"**预估时长**: {prompt.duration_estimate:.0f}秒")
        lines.append(f"**出场角色**: {', '.join(prompt.characters)}")
        lines.append("")

        # 分隔线
        lines.append("---")
        lines.append("")

        # 提示词内容
        lines.append(prompt.prompt_text)

        return "\n".join(lines)

    @staticmethod
    def format_all(prompts: List[VideoPrompt], scene_name: str) -> str:
        """
        格式化所有视频提示词为单个 Markdown 文件

        Args:
            prompts: 视频提示词列表
            scene_name: 场景名称

        Returns:
            Markdown 格式的合并提示词
        """
        lines = []

        # 总标题
        lines.append(f"# 视频提示词汇总 - {scene_name}")
        lines.append("")

        # 概览信息
        total_duration = sum(p.duration_estimate for p in prompts)
        all_characters = set()
        all_shots = []
        for p in prompts:
            all_characters.update(p.characters)
            all_shots.extend(p.shots_included)

        lines.append("## 概览")
        lines.append("")
        lines.append(f"- **总时长**: 约 {total_duration:.0f} 秒")
        lines.append(f"- **视频段数**: {len(prompts)} 段")
        lines.append(f"- **分镜数量**: {len(all_shots)} 个")
        lines.append(f"- **出场角色**: {', '.join(sorted(all_characters))}")
        lines.append("")

        # 分段规则说明
        lines.append("## 分段规则 (2-2-2-2-1)")
        lines.append("")
        lines.append("| 段落 | 名称 | 分镜 | 时长 |")
        lines.append("|------|------|------|------|")
        for p in prompts:
            shots_str = "+".join(map(str, p.shots_included))
            lines.append(f"| {p.segment_index} | {p.segment_name} | {shots_str} | {p.duration_estimate:.0f}秒 |")
        lines.append("")

        # 分隔线
        lines.append("---")
        lines.append("")

        # 各段提示词
        for i, prompt in enumerate(prompts):
            lines.append(f"## 段落{prompt.segment_index}：{prompt.segment_name}")
            lines.append("")
            lines.append(prompt.prompt_text)

            if i < len(prompts) - 1:
                lines.append("")
                lines.append("---")
                lines.append("")

        return "\n".join(lines)

    @staticmethod
    def get_filename(prompt: VideoPrompt) -> str:
        """生成单个提示词文件名"""
        return f"segment_{prompt.segment_index:02d}_{prompt.segment_name}.md"

    @staticmethod
    def get_all_filename() -> str:
        """生成合并文件名"""
        return "all_prompts.md"
