"""
配置系统
====================================================
管理项目配置、风格数据库、路径解析。

用法：
    from systems.config import ProjectManager, StyleManager

    # 创建项目
    pm = ProjectManager()
    project_path = pm.create_project(name="新项目", style="costume_drama")

    # 加载风格
    style = StyleManager.load_style("costume_drama")
"""

from .style_manager import StyleManager, StyleConfig
from .project_manager import ProjectManager, ProjectInfo

__all__ = [
    "StyleManager",
    "StyleConfig",
    "ProjectManager",
    "ProjectInfo",
]
