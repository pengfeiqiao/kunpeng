"""
项目管理器
====================================================
规范化项目创建和管理。

用法：
    from systems.config import ProjectManager

    # 直接创建项目
    project_path = pm.create_project(
        name="新项目",
        location="~/Desktop",
        style="costume_drama"
    )

    # 打开已有项目
    project = pm.open_project("~/Desktop/新项目")

    # 获取项目列表
    projects = pm.list_projects()

注意：交互式创建已移除，现在由对话系统处理用户交互。
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional, List, Dict, Any
import yaml
from datetime import datetime
import shutil
import os


@dataclass
class ProjectInfo:
    """项目信息"""
    name: str
    path: Path
    style: str
    created_at: str
    status: str = "active"
    characters: List[str] = field(default_factory=list)
    scenes: List[str] = field(default_factory=list)


@dataclass
class ProjectConfig:
    """项目配置"""
    project_root: Path
    name: str = ""
    style: str = "costume_drama"
    created_at: str = ""
    characters: Dict[str, dict] = field(default_factory=dict)
    scenes: Dict[str, dict] = field(default_factory=dict)
    defaults: Dict[str, Any] = field(default_factory=dict)

    @classmethod
    def load(cls, project_path: Path) -> "ProjectConfig":
        """从项目目录加载配置"""
        project_path = Path(project_path)
        config_file = project_path / "project.yaml"

        if config_file.exists():
            with open(config_file, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f) or {}
        else:
            data = {}

        return cls(
            project_root=project_path,
            name=data.get("name", project_path.name),
            style=data.get("style", "costume_drama"),
            created_at=data.get("created_at", ""),
            characters=data.get("characters", {}),
            scenes=data.get("scenes", {}),
            defaults=data.get("defaults", {
                "costume": "日常常服",
                "image_size": "2K",
                "aspect_ratio": "16:9"
            }),
        )

    def save(self):
        """保存配置"""
        config_file = self.project_root / "project.yaml"
        data = {
            "name": self.name,
            "style": self.style,
            "created_at": self.created_at,
            "characters": self.characters,
            "scenes": self.scenes,
            "defaults": self.defaults,
        }
        with open(config_file, "w", encoding="utf-8") as f:
            yaml.dump(data, f, allow_unicode=True, default_flow_style=False)

    def get_character_3view(self, name: str, costume: str) -> Path:
        """获取角色三视图路径"""
        if name in self.characters:
            char_config = self.characters[name]
            if "three_views" in char_config and costume in char_config["three_views"]:
                return self.project_root / char_config["three_views"][costume]
        return self.project_root / "characters" / "三视图" / f"{name}_{costume}_三视图.jpg"

    def get_scene_dir(self, scene_id: str) -> Path:
        """获取场景目录"""
        return self.project_root / "scenes" / scene_id

    def get_scene_reference(self, scene_id: str) -> Optional[Path]:
        """获取场景参考图"""
        scene_dir = self.get_scene_dir(scene_id)
        shot_9_wide = scene_dir / "shot_9_wide.jpg"
        if shot_9_wide.exists():
            return shot_9_wide
        scene_concept = scene_dir / "scene_concept.jpg"
        if scene_concept.exists():
            return scene_concept
        return None

    def register_character(self, name: str, config: dict):
        """注册角色"""
        self.characters[name] = config
        self.save()

    def register_scene(self, scene_id: str, config: dict):
        """注册场景"""
        self.scenes[scene_id] = config
        self.save()


class ProjectManager:
    """项目管理器"""

    def __init__(self):
        """
        初始化项目管理器

        注意：交互式创建已移除，由对话系统处理用户交互
        """
        pass

    @classmethod
    def _get_projects_dir(cls) -> Path:
        """获取项目索引目录"""
        skill_root = os.environ.get("SKILL_ROOT")
        if skill_root:
            return Path(skill_root) / "database" / "projects"
        current_file = Path(__file__)
        return current_file.parent.parent.parent / "database" / "projects"

    @property
    def PROJECT_INDEX(self) -> Path:
        return self._get_projects_dir() / "index.yaml"

    def create_project(
        self,
        name: str,
        location: Path = None,
        style: str = "costume_drama",
        overwrite: bool = False
    ) -> Path:
        """创建新项目"""
        if location is None:
            location = Path.home() / "Desktop"
        location = Path(location).expanduser()

        project_path = location / name

        if project_path.exists():
            if not overwrite:
                raise ValueError(f"项目已存在: {project_path}")
            shutil.rmtree(project_path)

        # 创建目录结构
        dirs = [
            "characters",
            "characters/三视图",
            "scenes",
            "outputs",
        ]
        for d in dirs:
            (project_path / d).mkdir(parents=True, exist_ok=True)

        # 创建项目配置
        config = {
            "name": name,
            "style": style,
            "created_at": datetime.now().isoformat(),
            "characters": {},
            "scenes": {},
            "defaults": {
                "costume": "日常常服",
                "image_size": "2K",
                "aspect_ratio": "16:9"
            }
        }

        with open(project_path / "project.yaml", "w", encoding="utf-8") as f:
            yaml.dump(config, f, allow_unicode=True, default_flow_style=False)

        # 创建工作日志
        work_log_content = f"""# 工作日志 - {name}

**创建时间**: {datetime.now().strftime('%Y-%m-%d %H:%M')}
**风格**: {style}
**位置**: {project_path}

---

## 项目初始化

- 项目创建完成
- 风格设置: {style}
- 目录结构创建完成

"""
        with open(project_path / "work_log.md", "w", encoding="utf-8") as f:
            f.write(work_log_content)

        # 更新项目索引
        self._update_index(name, project_path, style)

        return project_path

    def open_project(self, path: Path) -> ProjectConfig:
        """打开项目"""
        path = Path(path).expanduser()
        config_file = path / "project.yaml"

        if not config_file.exists():
            raise ValueError(f"无效的项目目录: {path}")

        return ProjectConfig.load(path)

    def list_projects(self) -> List[ProjectInfo]:
        """列出所有项目"""
        if not self.PROJECT_INDEX.exists():
            return []

        with open(self.PROJECT_INDEX, "r", encoding="utf-8") as f:
            index = yaml.safe_load(f) or {}

        projects = []
        for name, info in index.get("projects", {}).items():
            path = Path(info.get("path", ""))
            if path.exists():
                projects.append(ProjectInfo(
                    name=name,
                    path=path,
                    style=info.get("style", "unknown"),
                    created_at=info.get("created_at", ""),
                    status=info.get("status", "active"),
                    characters=info.get("characters", []),
                    scenes=info.get("scenes", [])
                ))

        return projects

    def get_project(self, name: str) -> Optional[ProjectInfo]:
        """按名称获取项目"""
        projects = self.list_projects()
        for p in projects:
            if p.name == name:
                return p
        return None

    def _update_index(self, name: str, path: Path, style: str):
        """更新项目索引"""
        self.PROJECT_INDEX.parent.mkdir(parents=True, exist_ok=True)

        if self.PROJECT_INDEX.exists():
            with open(self.PROJECT_INDEX, "r", encoding="utf-8") as f:
                index = yaml.safe_load(f) or {}
        else:
            index = {"projects": {}}

        index["projects"][name] = {
            "path": str(path),
            "style": style,
            "created_at": datetime.now().isoformat(),
            "status": "active",
            "characters": [],
            "scenes": []
        }

        with open(self.PROJECT_INDEX, "w", encoding="utf-8") as f:
            yaml.dump(index, f, allow_unicode=True, default_flow_style=False)


# 便捷函数
def create_project(name: str, location: Path = None, style: str = "costume_drama") -> Path:
    """创建项目"""
    pm = ProjectManager()
    return pm.create_project(name, location, style)


def open_project(path: Path) -> ProjectConfig:
    """打开项目"""
    pm = ProjectManager()
    return pm.open_project(path)


def list_projects() -> List[ProjectInfo]:
    """列出项目"""
    pm = ProjectManager()
    return pm.list_projects()
