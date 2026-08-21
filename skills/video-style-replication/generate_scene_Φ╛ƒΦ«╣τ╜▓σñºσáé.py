#!/usr/bin/env python3
"""
场景一分镜生成脚本
====================================================
从分镜脚本生成辟讹署大堂场景的九宫格分镜
"""

import os
import sys
from pathlib import Path

# 添加项目路径
sys.path.insert(0, str(Path(__file__).parent))

from systems.storyboard.generator import StoryboardGenerator
from systems.memory.work_logger import WorkLogger
from systems.config.project_manager import ProjectConfig

def main():
    # 项目路径
    # Usage: python3 generate_scene_辟讹署纪事.py <项目根目录路径>
    if len(sys.argv) != 2:
        print("Usage: python3 generate_scene_辟讹署纪事.py <项目根目录路径>")
        sys.exit(1)
    project_path = Path(sys.argv[1])

    # 初始化组件
    work_logger = WorkLogger(project_path)
    project_config = ProjectConfig.load(project_path)

    # 创建分镜生成器
    generator = StoryboardGenerator(
        project_path=project_path,
        work_logger=work_logger,
        project_config=project_config
    )

    # 场景配置
    scene_name = "辟讹署大堂"
    scene_localized_path = project_path / "scenes" / "scene_辟讹署大堂" / "scene_localized_v4.jpg"

    # 角色参考图（使用日常常服三视图）
    character_refs = [
        project_path / "characters" / "三视图" / "苏景澜_日常常服_三视图.jpg",
        project_path / "characters" / "三视图" / "沈青辞_日常常服_三视图.jpg"
    ]

    # 分镜脚本路径
    script_path = project_path / "scenes" / "scene_辟讹署大堂" / "storyboard_script.json"

    print("=" * 60)
    print("场景一分镜生成")
    print("=" * 60)
    print(f"场景: {scene_name}")
    print(f"实景化场景: {scene_localized_path}")
    print(f"角色参考: {[str(r) for r in character_refs]}")
    print(f"分镜脚本: {script_path}")
    print("=" * 60)

    # 检查文件是否存在
    if not scene_localized_path.exists():
        print(f"❌ 实景化场景不存在: {scene_localized_path}")
        return

    for ref in character_refs:
        if not ref.exists():
            print(f"❌ 角色参考图不存在: {ref}")
            return

    if not script_path.exists():
        print(f"❌ 分镜脚本不存在: {script_path}")
        return

    # 从分镜脚本生成九宫格
    result = generator.generate_from_script(
        scene_name=scene_name,
        scene_localized_path=scene_localized_path,
        character_refs=character_refs,
        script_path=script_path,
        style="costume_drama"
    )

    if result.success:
        print("\n" + "=" * 60)
        print("✅ 分镜生成成功！")
        print(f"输出路径: {result.image_path}")
        print("=" * 60)
    else:
        print("\n" + "=" * 60)
        print(f"❌ 分镜生成失败: {result.message}")
        print("=" * 60)

if __name__ == "__main__":
    main()
