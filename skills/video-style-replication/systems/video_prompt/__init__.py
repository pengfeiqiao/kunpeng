"""
视频提示词生成模块
====================================================
将九宫格分镜转换为 AI 视频生成所需的提示词。

核心功能：
- 按 2-2-2-2-1 规则将 9 个分镜分为 5 段视频
- 基于角色配置和分镜脚本生成视频提示词
- 输出格式化的 Markdown 文件

用法：
    from systems.video_prompt import VideoPromptGenerator
    from pathlib import Path

    gen = VideoPromptGenerator(Path('/path/to/project'))
    prompts = gen.generate_video_prompts('场景名称')
    gen.save_video_prompts(prompts, '场景名称')
"""

from .generator import VideoPromptGenerator
from .segmenter import VideoSegmenter, VideoSegment
from .templates import VideoPromptTemplateManager, CharacterInfo
from .formatter import VideoPromptFormatter, VideoPrompt

__all__ = [
    'VideoPromptGenerator',
    'VideoSegmenter',
    'VideoSegment',
    'VideoPromptTemplateManager',
    'VideoPromptFormatter',
    'VideoPrompt',
]
