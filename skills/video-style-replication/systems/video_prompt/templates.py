"""
视频提示词模板
====================================================
基于用户提供的视频提示词模板，生成符合 AI 视频生成平台格式的提示词。

模板结构：
1. 技术参数 - 8K、24fps、电影级质感等
2. 场景描述 - 光影、氛围、色调
3. 固定人物设定 - 角色外貌、服装、气质
4. 镜头描述 - 景别、角度、内容、动作
5. 同步要求 - 口型、台词、音效
6. 约束条件 - 无字幕、无BGM等
"""

from dataclasses import dataclass
from typing import Dict, List, Any, Optional


@dataclass
class CharacterInfo:
    """角色信息（用于提示词）"""
    name: str
    age: str
    appearance: str          # 外貌描述
    costume: str             # 服装描述
    temperament: str         # 气质关键词
    special_marks: str       # 特殊标记


class VideoPromptTemplateManager:
    """视频提示词模板管理器"""

    # ==================== 技术参数模板 ====================
    TECH_PARAMS_TEMPLATE = """8K超清，电影级古风国风写实长视频，真人影视级质感，24fps，镜头画面连续丝滑无闪烁，人物动作自然流畅，口型与台词精准同步匹配，cinematic电影级光影调色，氛围感拉满"""

    # 古装剧风格模板（光影描述动态生成）
    COSTUME_DRAMA_SCENE_TEMPLATE = """大雍王朝{scene_name}，{scene_description}，{lighting_keywords}，全程色调统一，细腻皮肤质感，真实棉麻布料纹理，画面干净通透无多余杂物"""

    # ==================== 角色描述模板 ====================
    FEMALE_CHARACTER_TEMPLATE = """{age}少女{name}，{appearance}，{temperament}"""
    MALE_CHARACTER_TEMPLATE = """{age}少年{name}，{appearance}，{temperament}"""

    # ==================== 镜头描述模板 ====================
    SHOT_DESCRIPTION_TEMPLATE = """{shot_type}固定镜头，{camera_angle}：{content}"""

    # ==================== 同步要求模板 ====================
    SYNC_TEMPLATE = """同步环境音效：{sound_effects}"""

    # ==================== 约束条件模板 ====================
    CONSTRAINTS_TEMPLATE = """视频中不得出现字幕，不需要背景bgm音乐，有人声台词和音效即可，如有台词、对话、旁白，均使用默认字体，字体不透明度为0%"""

    def __init__(self, style: str = "costume_drama"):
        """
        初始化模板管理器

        Args:
            style: 风格类型 (costume_drama / wasteland)
        """
        self.style = style

    def build_full_prompt(
        self,
        scene_name: str,
        scene_description: str,
        characters: List[CharacterInfo],
        shot_descriptions: List[str],
        dialogues: List[str],
        sound_effects: str,
        segment_name: str,
        segment_index: int,
        scene_type: str = "indoor_daytime",
        mood: str = "normal"
    ) -> str:
        """
        构建完整视频提示词

        Args:
            scene_name: 场景名称
            scene_description: 场景描述
            characters: 角色信息列表
            shot_descriptions: 镜头描述列表
            dialogues: 台词列表
            sound_effects: 音效描述
            segment_name: 段落名称
            segment_index: 段落序号
            scene_type: 场景类型（indoor_daytime, outdoor_nighttime 等）
            mood: 情绪模式（normal, warm, tense, solemn）

        Returns:
            完整的提示词文本
        """
        parts = []

        # 1. 技术参数
        parts.append(self._build_tech_params())

        # 2. 场景描述
        parts.append(self._build_scene_description(scene_name, scene_description, scene_type, mood))

        # 3. 固定人物设定
        parts.append(self._build_character_descriptions(characters))

        # 4. 镜头描述
        parts.append(self._build_shot_descriptions(shot_descriptions, dialogues))

        # 5. 同步要求
        parts.append(self._build_sync_requirements(sound_effects))

        # 6. 约束条件
        parts.append(self._build_constraints())

        return "\n\n".join(parts)

    def _build_tech_params(self) -> str:
        """构建技术参数部分"""
        return self.TECH_PARAMS_TEMPLATE

    def _build_scene_description(
        self,
        scene_name: str,
        scene_description: str,
        scene_type: str = "indoor_daytime",
        mood: str = "normal"
    ) -> str:
        """
        构建场景描述部分

        Args:
            scene_name: 场景名称
            scene_description: 场景描述
            scene_type: 场景类型（indoor_daytime, outdoor_nighttime 等）
            mood: 情绪模式（normal, warm, tense, solemn）
        """
        # 动态获取光影关键词
        from systems.lighting import get_lighting_keywords
        lighting_keywords = get_lighting_keywords(scene_type, mood)

        if self.style == "costume_drama":
            return self.COSTUME_DRAMA_SCENE_TEMPLATE.format(
                scene_name=scene_name,
                scene_description=scene_description,
                lighting_keywords=lighting_keywords
            )
        return f"{scene_name}，{scene_description}"

    def _build_character_descriptions(self, characters: List[CharacterInfo]) -> str:
        """构建固定人物设定部分"""
        lines = ["固定人物设定全程统一不崩坏："]

        for char in characters:
            if char.name:
                char_line = f"{char.age}{char.name}，{char.appearance}"
                if char.temperament:
                    char_line += f"，{char.temperament}"
                lines.append(char_line)

        return "，".join(lines) if len(lines) > 1 else ""

    def _build_shot_descriptions(
        self,
        shot_descriptions: List[str],
        dialogues: List[str]
    ) -> str:
        """构建镜头描述部分"""
        lines = []

        for i, desc in enumerate(shot_descriptions):
            lines.append(desc)
            # 如果有对应台词，添加到描述后
            if i < len(dialogues) and dialogues[i]:
                lines.append(f"同步口型念出台词：'{dialogues[i]}'，语气温柔坚定")

        return "\n".join(lines)

    def _build_sync_requirements(self, sound_effects: str) -> str:
        """构建同步要求部分"""
        return self.SYNC_TEMPLATE.format(sound_effects=sound_effects or "无特殊音效")

    def _build_constraints(self) -> str:
        """构建约束条件部分"""
        return self.CONSTRAINTS_TEMPLATE

    def build_character_info(
        self,
        name: str,
        config: Dict[str, Any]
    ) -> CharacterInfo:
        """
        从角色配置构建 CharacterInfo

        Args:
            name: 角色名称
            config: 角色配置字典

        Returns:
            CharacterInfo 对象
        """
        # 提取外貌描述
        appearance = self._extract_appearance(config)

        # 提取服装描述
        costume = self._extract_costume(config)

        # 提取气质关键词
        temperament = self._extract_temperament(config)

        # 提取特殊标记
        special_marks = self._extract_special_marks(config)

        return CharacterInfo(
            name=name,
            age=config.get("age", "20多岁"),
            appearance=appearance,
            costume=costume,
            temperament=temperament,
            special_marks=special_marks
        )

    def _extract_appearance(self, config: Dict[str, Any]) -> str:
        """提取外貌描述"""
        parts = []

        # 骨相
        bone = config.get("bone_structure", {})
        if bone.get("face_shape_description"):
            parts.append(bone["face_shape_description"])

        # 软组织
        soft = config.get("soft_tissue", {})
        if soft.get("eyes", {}).get("eye_spirit"):
            parts.append(soft["eyes"]["eye_spirit"])
        if soft.get("brows", {}).get("description"):
            parts.append(soft["brows"]["description"])
        if soft.get("nose", {}).get("description"):
            parts.append(soft["nose"]["description"])
        if soft.get("lips", {}).get("description"):
            parts.append(soft["lips"]["description"])

        # 视觉记忆点
        for vmp in config.get("visual_memory_points", [])[:3]:
            if vmp.get("must_preserve"):
                parts.append(vmp["description"])

        return "，".join(parts) if parts else "五官端正"

    def _extract_costume(self, config: Dict[str, Any]) -> str:
        """提取服装描述"""
        costume = config.get("costume", {})
        if isinstance(costume, dict):
            default_costume = costume.get("default", "")
            variations = costume.get("variations", {})
            if variations:
                daily = variations.get("日常", "")
                return daily or default_costume
            return default_costume
        return str(costume)

    def _extract_temperament(self, config: Dict[str, Any]) -> str:
        """提取气质关键词"""
        temperament = config.get("temperament", [])
        if temperament:
            return "，".join(temperament[:3])

        expr = config.get("expression_temperament", {})
        if expr.get("temperament_keywords"):
            return "，".join(expr["temperament_keywords"][:3])

        return ""

    def _extract_special_marks(self, config: Dict[str, Any]) -> str:
        """提取特殊标记"""
        marks = []

        soft = config.get("soft_tissue", {})
        for mark in soft.get("unique_marks", []):
            if mark.get("visibility") == "always":
                marks.append(mark["description"])

        return "，".join(marks) if marks else ""
