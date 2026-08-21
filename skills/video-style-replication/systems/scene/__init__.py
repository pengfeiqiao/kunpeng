"""
场景生成系统
====================================================
生成场景概念图。

用法：
    from systems.scene import SceneGenerator

    generator = SceneGenerator(project_path)

    # 生成场景概念图
    result = generator.generate_scene_concept(scene_info)
"""

from .generator import SceneGenerator

__all__ = ["SceneGenerator"]
