"""
风格管理器
====================================================
管理多种视觉风格（古装/废土/自定义）

用法：
    from systems.config import StyleManager

    # 列出所有风格
    styles = StyleManager.list_styles()

    # 加载风格
    style = StyleManager.load_style("costume_drama")

    # 获取光影配置
    lighting = style.get_lighting("indoor_daytime")

    # 创建自定义风格
    StyleManager.create_custom_style("my_style", base_on="costume_drama")
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Optional, Any
import yaml
import os


@dataclass
class LightingConfig:
    """光影配置"""
    type: str = ""
    temperature: int = 5500
    description: str = ""
    key_light: str = ""
    fill_light: str = ""
    mood: str = ""
    contrast: str = ""


@dataclass
class CharacterTemplate:
    """角色模板"""
    archetype: str = ""
    name_example: str = ""
    age_range: List[int] = field(default_factory=list)
    temperament: List[str] = field(default_factory=list)
    costume: Dict[str, Any] = field(default_factory=dict)
    visual_marks: List[Dict[str, Any]] = field(default_factory=list)


@dataclass
class StyleConfig:
    """风格配置"""
    name: str = ""
    name_en: str = ""
    description: str = ""
    time_period: str = ""
    era: str = ""

    # 光影预设
    lighting_presets: Dict[str, LightingConfig] = field(default_factory=dict)

    # 质量标准
    quality_standards: Dict[str, List[str]] = field(default_factory=dict)

    # 角色模板
    character_templates: Dict[str, CharacterTemplate] = field(default_factory=dict)

    # 分镜类型
    shot_types: Dict[str, Dict[str, str]] = field(default_factory=dict)

    # 场景类型
    scene_types: Dict[str, List[str]] = field(default_factory=dict)

    # 原始数据
    raw_data: Dict[str, Any] = field(default_factory=dict)

    def get_lighting(self, lighting_type: str) -> Optional[LightingConfig]:
        """获取光影配置"""
        return self.lighting_presets.get(lighting_type)

    def get_quality_prompt(self, category: str = "visual_style") -> str:
        """获取质量标准提示词"""
        standards = self.quality_standards.get(category, [])
        return "\n".join(f"- {s}" for s in standards)

    def get_character_template(self, template_name: str) -> Optional[CharacterTemplate]:
        """获取角色模板"""
        return self.character_templates.get(template_name)


class StyleManager:
    """风格管理器"""

    # 动态获取 SKILL_ROOT
    @classmethod
    def _get_styles_dir(cls) -> Path:
        """获取风格数据库目录"""
        # 优先从环境变量获取
        skill_root = os.environ.get("SKILL_ROOT")
        if skill_root:
            return Path(skill_root) / "database" / "styles"

        # 否则从当前文件位置推断
        current_file = Path(__file__)
        return current_file.parent.parent.parent / "database" / "styles"

    STYLES_DIR = property(lambda cls: cls._get_styles_dir())

    @classmethod
    def list_styles(cls) -> List[str]:
        """列出所有可用风格"""
        styles_dir = cls._get_styles_dir()
        styles = []

        if not styles_dir.exists():
            return styles

        for style_dir in styles_dir.iterdir():
            if style_dir.is_dir() and (style_dir / "preset.yaml").exists():
                styles.append(style_dir.name)

        # 也检查 custom 子目录
        custom_dir = styles_dir / "custom"
        if custom_dir.exists():
            for style_dir in custom_dir.iterdir():
                if style_dir.is_dir() and (style_dir / "preset.yaml").exists():
                    styles.append(f"custom/{style_dir.name}")

        return sorted(styles)

    @classmethod
    def load_style(cls, style_name: str) -> StyleConfig:
        """加载风格配置"""
        styles_dir = cls._get_styles_dir()

        # 处理 custom/ 前缀
        if style_name.startswith("custom/"):
            style_dir = styles_dir / style_name
        else:
            style_dir = styles_dir / style_name

        preset_file = style_dir / "preset.yaml"

        if not preset_file.exists():
            raise ValueError(f"风格不存在: {style_name}。可用: {cls.list_styles()}")

        with open(preset_file, "r", encoding="utf-8") as f:
            preset = yaml.safe_load(f) or {}

        # 加载光影配置（支持两种方式：内联在 preset.yaml 或单独的 lighting.yaml）
        lighting_presets = {}

        # 方式1: 从 preset.yaml 内联加载
        inline_lighting = preset.get("lighting_presets", {})
        for key, value in inline_lighting.items():
            if isinstance(value, dict):
                lighting_presets[key] = LightingConfig(
                    type=value.get("type", ""),
                    temperature=value.get("temperature", 5500),
                    description=value.get("description", ""),
                    key_light=value.get("key_light", ""),
                    fill_light=value.get("fill_light", ""),
                    mood=value.get("mood", ""),
                    contrast=value.get("contrast", ""),
                )

        # 方式2: 从单独的 lighting.yaml 文件加载（覆盖内联定义）
        lighting_file = style_dir / "lighting.yaml"
        if lighting_file.exists():
            with open(lighting_file, "r", encoding="utf-8") as f:
                lighting_data = yaml.safe_load(f) or {}
                for key, value in lighting_data.items():
                    lighting_presets[key] = LightingConfig(
                        type=value.get("type", ""),
                        temperature=value.get("temperature", 5500),
                        description=value.get("description", ""),
                        key_light=value.get("key_light", ""),
                        fill_light=value.get("fill_light", ""),
                        mood=value.get("mood", ""),
                        contrast=value.get("contrast", ""),
                    )

        # 解析角色模板
        character_templates = {}
        for template_name, template_data in preset.get("character_templates", {}).items():
            character_templates[template_name] = CharacterTemplate(
                archetype=template_data.get("archetype", ""),
                name_example=template_data.get("name_example", ""),
                age_range=template_data.get("age_range", []),
                temperament=template_data.get("temperament", []),
                costume=template_data.get("costume", {}),
                visual_marks=template_data.get("visual_marks", []),
            )

        return StyleConfig(
            name=preset.get("name", style_name),
            name_en=preset.get("name_en", ""),
            description=preset.get("description", ""),
            time_period=preset.get("time_period", ""),
            era=preset.get("era", ""),
            lighting_presets=lighting_presets,
            quality_standards=preset.get("quality_standards", {}),
            character_templates=character_templates,
            shot_types=preset.get("shot_types", {}),
            scene_types=preset.get("scene_types", {}),
            raw_data=preset,
        )

    @classmethod
    def create_custom_style(
        cls,
        style_name: str,
        base_on: str = None,
        **customizations
    ) -> StyleConfig:
        """创建自定义风格"""
        styles_dir = cls._get_styles_dir()
        style_dir = styles_dir / "custom" / style_name
        style_dir.mkdir(parents=True, exist_ok=True)

        preset_data = {}

        # 如果基于现有风格，复制配置
        if base_on:
            try:
                base_style = cls.load_style(base_on)
                preset_data = base_style.raw_data.copy()
            except ValueError:
                pass

        # 应用自定义配置
        for key, value in customizations.items():
            preset_data[key] = value

        # 确保必要字段
        preset_data.setdefault("name", style_name)
        preset_data.setdefault("name_en", style_name)
        preset_data.setdefault("description", "Custom style")

        # 保存配置
        preset_file = style_dir / "preset.yaml"
        with open(preset_file, "w", encoding="utf-8") as f:
            yaml.dump(preset_data, f, allow_unicode=True, default_flow_style=False)

        return cls.load_style(f"custom/{style_name}")

    @classmethod
    def get_style_info(cls, style_name: str) -> Dict[str, str]:
        """获取风格简要信息"""
        try:
            style = cls.load_style(style_name)
            return {
                "name": style.name,
                "description": style.description,
                "time_period": style.time_period,
                "lighting_count": str(len(style.lighting_presets)),
                "template_count": str(len(style.character_templates)),
            }
        except ValueError:
            return {}


# 便捷函数
def get_style(style_name: str) -> StyleConfig:
    """获取风格配置"""
    return StyleManager.load_style(style_name)


def list_available_styles() -> List[str]:
    """列出所有可用风格"""
    return StyleManager.list_styles()
