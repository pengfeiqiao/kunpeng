"""
分镜系统
====================================================
生成场景的分镜图。

工作流程（含交互确认）：
1. generate_panoramic_storyboard - 生成全景分镜 shot_9_wide.jpg
2. [交互确认] 用户确认全景效果
3. generate_nine_grid - 从全景分镜生成九宫格（可选）
4. [交互确认] 用户确认效果
5. generate_individual_shots - 从全景分镜生成9张独立分镜

用法：
    from systems.storyboard import StoryboardGenerator, ShotDescription

    generator = StoryboardGenerator(project_path)

    # Step 1: 生成全景分镜
    result = generator.generate_panoramic_storyboard(...)
    # → 等待用户确认

    # Step 2: 生成九宫格（可选）
    result = generator.generate_nine_grid(panoramic_path)
    # → 等待用户确认

    # Step 3: 生成9张独立分镜
    results = generator.generate_individual_shots(panoramic_path)
"""

from .generator import StoryboardGenerator, ShotDescription, StoryboardResult

__all__ = ["StoryboardGenerator", "ShotDescription", "StoryboardResult"]
