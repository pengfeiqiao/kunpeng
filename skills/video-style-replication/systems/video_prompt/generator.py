"""
视频提示词生成器
====================================================
核心生成器，将九宫格分镜转换为 AI 视频生成所需的提示词。

核心功能：
- 加载分镜脚本和角色配置
- 按 2-2-2-2-1 规则分段
- 生成 5 段视频提示词
- 保存为 Markdown 文件

用法：
    from systems.video_prompt import VideoPromptGenerator
    from pathlib import Path

    gen = VideoPromptGenerator(Path('/path/to/project'))
    prompts = gen.generate_video_prompts('辟讹署大堂')
    gen.save_video_prompts(prompts, '辟讹署大堂')
"""

from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Optional, Any
import json

from .segmenter import VideoSegmenter, VideoSegment
from .templates import VideoPromptTemplateManager, CharacterInfo
from .formatter import VideoPromptFormatter, VideoPrompt


class VideoPromptGenerator:
    """视频提示词生成器"""

    def __init__(self, project_path: Path, style: str = "costume_drama"):
        """
        初始化生成器

        Args:
            project_path: 项目路径
            style: 风格类型 (costume_drama / wasteland)
        """
        self.project_path = Path(project_path)
        self.style = style

        # 初始化组件
        self.segmenter = VideoSegmenter()
        self.template_manager = VideoPromptTemplateManager(style=style)
        self.formatter = VideoPromptFormatter()

        # 加载项目配置
        self.project_config = self._load_project_config()

        # 角色配置缓存
        self._character_configs: Dict[str, Dict] = {}

    def generate_video_prompts(self, scene_name: str) -> List[VideoPrompt]:
        """
        生成视频提示词

        Args:
            scene_name: 场景名称

        Returns:
            5 个视频提示词
        """
        # 1. 加载分镜脚本
        script = self._load_storyboard_script(scene_name)
        if not script:
            raise ValueError(f"找不到场景 '{scene_name}' 的分镜脚本")

        # 2. 加载角色配置
        characters = self._load_character_configs(script.get("characters", []))

        # 3. 分段
        shots = script.get("shots", [])
        segments = self.segmenter.segment_shots(shots)

        # 4. 生成每段提示词
        prompts = []
        for segment in segments:
            prompt = self._build_video_prompt(
                segment=segment,
                characters=characters,
                script=script,
                scene_name=scene_name
            )
            prompts.append(prompt)

        return prompts

    def save_video_prompts(
        self,
        prompts: List[VideoPrompt],
        scene_name: str
    ) -> List[Path]:
        """
        保存视频提示词到文件

        Args:
            prompts: 视频提示词列表
            scene_name: 场景名称

        Returns:
            保存的文件路径列表
        """
        # 创建输出目录
        safe_name = scene_name.replace("/", "_").replace(" ", "_")
        output_dir = self.project_path / "scenes" / f"scene_{safe_name}" / "video_prompts"
        output_dir.mkdir(parents=True, exist_ok=True)

        saved_paths = []

        # 保存单个文件
        for prompt in prompts:
            filename = VideoPromptFormatter.get_filename(prompt)
            path = output_dir / filename
            content = VideoPromptFormatter.format_prompt(prompt)
            path.write_text(content, encoding="utf-8")
            saved_paths.append(path)

        # 保存合并文件
        all_content = VideoPromptFormatter.format_all(prompts, scene_name)
        all_path = output_dir / VideoPromptFormatter.get_all_filename()
        all_path.write_text(all_content, encoding="utf-8")
        saved_paths.append(all_path)

        return saved_paths

    def _load_project_config(self) -> Dict:
        """加载项目配置"""
        config_path = self.project_path / "project.yaml"
        if config_path.exists():
            import yaml
            with open(config_path, "r", encoding="utf-8") as f:
                return yaml.safe_load(f) or {}
        return {}

    def _load_storyboard_script(self, scene_name: str) -> Optional[Dict]:
        """加载分镜脚本"""
        safe_name = scene_name.replace("/", "_").replace(" ", "_")

        # 尝试新路径
        script_path = self.project_path / "scenes" / f"scene_{safe_name}" / "storyboard" / "script.json"

        # 尝试旧路径
        if not script_path.exists():
            script_path = self.project_path / "scenes" / f"scene_{safe_name}" / "storyboard_script.json"

        if not script_path.exists():
            return None

        with open(script_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _load_character_configs(self, character_names: List[str]) -> Dict[str, CharacterInfo]:
        """加载角色配置"""
        characters = {}

        for name in character_names:
            if name in self._character_configs:
                config = self._character_configs[name]
            else:
                config = self._load_single_character_config(name)
                self._character_configs[name] = config

            if config:
                characters[name] = self.template_manager.build_character_info(name, config)

        return characters

    def _load_single_character_config(self, name: str) -> Optional[Dict]:
        """加载单个角色配置"""
        config_path = self.project_path / "characters" / f"{name}_config.json"

        if not config_path.exists():
            return None

        with open(config_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def _build_video_prompt(
        self,
        segment: VideoSegment,
        characters: Dict[str, CharacterInfo],
        script: Dict,
        scene_name: str
    ) -> VideoPrompt:
        """构建单个视频提示词"""
        # 收集本段出场角色
        segment_characters = self._get_segment_characters(segment, characters)

        # 构建镜头描述
        shot_descriptions = self._build_shot_descriptions(segment.shots)

        # 收集台词
        dialogues = [shot.get("dialogue", "") for shot in segment.shots if shot.get("dialogue")]

        # 收集音效
        sound_effects = self._build_sound_effects(segment.shots, script)

        # 使用模板构建提示词
        prompt_text = self.template_manager.build_full_prompt(
            scene_name=scene_name,
            scene_description=script.get("scene_description", ""),
            characters=list(segment_characters.values()),
            shot_descriptions=shot_descriptions,
            dialogues=dialogues,
            sound_effects=sound_effects,
            segment_name=segment.segment_name,
            segment_index=segment.segment_index
        )

        return VideoPrompt(
            segment_index=segment.segment_index,
            segment_name=segment.segment_name,
            prompt_text=prompt_text,
            shots_included=segment.shot_numbers,
            characters=list(segment_characters.keys()),
            duration_estimate=segment.duration_estimate,
            scene_name=scene_name
        )

    def _get_segment_characters(
        self,
        segment: VideoSegment,
        characters: Dict[str, CharacterInfo]
    ) -> Dict[str, CharacterInfo]:
        """获取本段出场角色"""
        segment_chars = {}

        for shot in segment.shots:
            for char_name in shot.get("characters", []):
                if char_name in characters and char_name not in segment_chars:
                    segment_chars[char_name] = characters[char_name]

        return segment_chars

    def _build_shot_descriptions(self, shots: List[Dict]) -> List[str]:
        """构建镜头描述列表"""
        descriptions = []

        for shot in shots:
            shot_num = shot.get("shot_number", "?")
            shot_type = shot.get("shot_type", "中景")
            camera_angle = shot.get("camera_angle", "平拍")
            description = shot.get("description", "")
            action = shot.get("action", "")
            expression = shot.get("expression", "")
            lighting = shot.get("lighting_note", "")

            # 构建镜头描述
            parts = [f"切{shot_type}固定镜头，{camera_angle}"]

            if description:
                parts.append(f"：{description}")

            if action and action != "空镜头":
                parts.append(f"，动作：{action}")

            if expression:
                parts.append(f"，表情：{expression}")

            if lighting:
                parts.append(f"，光线：{lighting}")

            descriptions.append("".join(parts))

        return descriptions

    def _build_sound_effects(self, shots: List[Dict], script: Dict) -> str:
        """构建音效描述"""
        # 从脚本元数据获取氛围关键词
        metadata = script.get("metadata", {})
        atmosphere = metadata.get("atmosphere_keywords", [])

        # 收集音效
        sounds = []

        # 根据场景类型添加音效
        scene_type = metadata.get("scene_type", "")
        if "nighttime" in scene_type:
            sounds.append("晚风拂过的簌簌声")
            sounds.append("远处隐约的虫鸣")

        if "indoor" in scene_type:
            sounds.append("烛火摇曳声")

        # 添加氛围音效
        for keyword in atmosphere[:3]:
            if "声" in keyword:
                sounds.append(keyword)

        return "、".join(sounds) if sounds else "无特殊音效"


# 便捷函数
def generate_video_prompts_for_scene(
    project_path: Path,
    scene_name: str,
    style: str = "costume_drama"
) -> List[Path]:
    """
    为场景生成视频提示词（便捷函数）

    Args:
        project_path: 项目路径
        scene_name: 场景名称
        style: 风格类型

    Returns:
        保存的文件路径列表
    """
    gen = VideoPromptGenerator(project_path, style=style)
    prompts = gen.generate_video_prompts(scene_name)
    return gen.save_video_prompts(prompts, scene_name)
