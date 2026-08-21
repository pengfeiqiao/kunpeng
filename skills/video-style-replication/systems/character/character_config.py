"""
增强角色卡配置系统
====================================================
基于古装角色复刻项目的详细角色卡格式设计。
支持结构化的视觉特征、提示词模板、一致性控制等。

用法：
    from systems.character.character_config import CharacterConfig

    # 从 JSON 加载
    config = CharacterConfig.from_dict(json_data)

    # 生成提示词
    prompt = config.generate_prompt()

    # 加载小传卡
    bio = config.load_biography(project_path)
"""

from dataclasses import dataclass, field
from typing import List, Dict, Optional, Any
from pathlib import Path
import json


@dataclass
class VisualMemoryPoint:
    """视觉记忆点"""
    feature: str           # 特征名称
    description: str       # 详细描述
    criticality: int = 5   # 重要性 1-10
    must_preserve: bool = True

    def to_dict(self) -> dict:
        return {
            "feature": self.feature,
            "description": self.description,
            "criticality": self.criticality,
            "must_preserve": self.must_preserve
        }

    @classmethod
    def from_dict(cls, data: dict) -> "VisualMemoryPoint":
        return cls(
            feature=data.get("feature", ""),
            description=data.get("description", ""),
            criticality=data.get("criticality", 5),
            must_preserve=data.get("must_preserve", True)
        )


@dataclass
class BoneStructure:
    """骨相结构"""
    face_shape: str = ""
    face_shape_description: str = ""
    forehead: Dict[str, str] = field(default_factory=dict)
    brow_ridge: Dict[str, str] = field(default_factory=dict)
    eye_shape: Dict[str, str] = field(default_factory=dict)
    cheekbone: Dict[str, Any] = field(default_factory=dict)
    nose: Dict[str, str] = field(default_factory=dict)
    jaw: Dict[str, Any] = field(default_factory=dict)
    facial_thirds: List[float] = field(default_factory=list)
    facial_fifths: List[float] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "face_shape": self.face_shape,
            "face_shape_description": self.face_shape_description,
            "forehead": self.forehead,
            "brow_ridge": self.brow_ridge,
            "eye_shape": self.eye_shape,
            "cheekbone": self.cheekbone,
            "nose": self.nose,
            "jaw": self.jaw,
            "facial_thirds": self.facial_thirds,
            "facial_fifths": self.facial_fifths
        }

    @classmethod
    def from_dict(cls, data: dict) -> "BoneStructure":
        return cls(
            face_shape=data.get("face_shape", ""),
            face_shape_description=data.get("face_shape_description", ""),
            forehead=data.get("forehead", {}),
            brow_ridge=data.get("brow_ridge", {}),
            eye_shape=data.get("eye_shape", {}),
            cheekbone=data.get("cheekbone", {}),
            nose=data.get("nose", {}),
            jaw=data.get("jaw", {}),
            facial_thirds=data.get("facial_thirds", []),
            facial_fifths=data.get("facial_fifths", [])
        )


@dataclass
class SoftTissue:
    """软组织特征"""
    skin: Dict[str, str] = field(default_factory=dict)
    eyes: Dict[str, str] = field(default_factory=dict)
    brows: Dict[str, str] = field(default_factory=dict)
    nose: Dict[str, str] = field(default_factory=dict)
    lips: Dict[str, str] = field(default_factory=dict)
    unique_marks: List[Dict[str, str]] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "skin": self.skin,
            "eyes": self.eyes,
            "brows": self.brows,
            "nose": self.nose,
            "lips": self.lips,
            "unique_marks": self.unique_marks
        }

    @classmethod
    def from_dict(cls, data: dict) -> "SoftTissue":
        return cls(
            skin=data.get("skin", {}),
            eyes=data.get("eyes", {}),
            brows=data.get("brows", {}),
            nose=data.get("nose", {}),
            lips=data.get("lips", {}),
            unique_marks=data.get("unique_marks", [])
        )


@dataclass
class PromptTemplate:
    """提示词模板"""
    positive: str = ""
    negative: str = ""

    def to_dict(self) -> dict:
        return {
            "positive": self.positive,
            "negative": self.negative
        }

    @classmethod
    def from_dict(cls, data: dict) -> "PromptTemplate":
        return cls(
            positive=data.get("positive", ""),
            negative=data.get("negative", "")
        )


@dataclass
class ConsistencyTips:
    """一致性控制"""
    weight_priority: str = ""
    description_method: str = ""
    control_methods: str = ""

    def to_dict(self) -> dict:
        return {
            "weight_priority": self.weight_priority,
            "description_method": self.description_method,
            "control_methods": self.control_methods
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ConsistencyTips":
        return cls(
            weight_priority=data.get("weight_priority", ""),
            description_method=data.get("description_method", ""),
            control_methods=data.get("control_methods", "")
        )


@dataclass
class ExpressionTemperament:
    """表情气质"""
    resting_expression: str = ""
    temperament_keywords: List[str] = field(default_factory=list)
    gaze_type: str = ""

    def to_dict(self) -> dict:
        return {
            "resting_expression": self.resting_expression,
            "temperament_keywords": self.temperament_keywords,
            "gaze_type": self.gaze_type
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ExpressionTemperament":
        return cls(
            resting_expression=data.get("resting_expression", ""),
            temperament_keywords=data.get("temperament_keywords", []),
            gaze_type=data.get("gaze_type", "")
        )


@dataclass
class CharacterConfig:
    """完整角色配置"""
    # 基础信息
    character_id: str = ""
    name: str = ""
    courtesy_name: str = ""
    age: str = ""
    gender: str = ""
    character_type: str = ""  # male_lead, female_lead, supporting
    archetype: str = ""

    # 气质描述
    temperament: List[str] = field(default_factory=list)
    synesthesia: str = ""

    # 面部特征
    bone_structure: Optional[BoneStructure] = None
    soft_tissue: Optional[SoftTissue] = None

    # 视觉记忆点
    visual_memory_points: List[VisualMemoryPoint] = field(default_factory=list)

    # 表情气质
    expression_temperament: Optional[ExpressionTemperament] = None

    # 提示词相关
    prompt_template: Optional[PromptTemplate] = None
    consistency_tips: Optional[ConsistencyTips] = None

    # 造型
    hairstyle: Dict[str, str] = field(default_factory=dict)
    costume: Dict[str, Any] = field(default_factory=dict)

    # 人物特色
    quirks: List[str] = field(default_factory=list)
    signature_lines: List[str] = field(default_factory=list)

    # 关系
    relationship: Dict[str, str] = field(default_factory=dict)
    call_sign: Dict[str, str] = field(default_factory=dict)
    backstory: str = ""

    # 生成相关
    reference_image: str = ""
    makeup_images: List[str] = field(default_factory=list)
    three_views: Dict[str, str] = field(default_factory=dict)
    status: str = "draft"

    def to_dict(self) -> dict:
        """转换为字典"""
        return {
            "character_id": self.character_id,
            "name": self.name,
            "courtesy_name": self.courtesy_name,
            "age": self.age,
            "gender": self.gender,
            "character_type": self.character_type,
            "archetype": self.archetype,
            "temperament": self.temperament,
            "synesthesia": self.synesthesia,
            "bone_structure": self.bone_structure.to_dict() if self.bone_structure else None,
            "soft_tissue": self.soft_tissue.to_dict() if self.soft_tissue else None,
            "visual_memory_points": [vmp.to_dict() for vmp in self.visual_memory_points],
            "expression_temperament": self.expression_temperament.to_dict() if self.expression_temperament else None,
            "prompt_template": self.prompt_template.to_dict() if self.prompt_template else None,
            "consistency_tips": self.consistency_tips.to_dict() if self.consistency_tips else None,
            "hairstyle": self.hairstyle,
            "costume": self.costume,
            "quirks": self.quirks,
            "signature_lines": self.signature_lines,
            "relationship": self.relationship,
            "call_sign": self.call_sign,
            "backstory": self.backstory,
            "reference_image": self.reference_image,
            "makeup_images": self.makeup_images,
            "three_views": self.three_views,
            "status": self.status
        }

    @classmethod
    def from_dict(cls, data: dict) -> "CharacterConfig":
        """从字典创建"""
        bone_structure = None
        if data.get("bone_structure"):
            bone_structure = BoneStructure.from_dict(data["bone_structure"])

        soft_tissue = None
        if data.get("soft_tissue"):
            soft_tissue = SoftTissue.from_dict(data["soft_tissue"])

        visual_memory_points = [
            VisualMemoryPoint.from_dict(vmp)
            for vmp in data.get("visual_memory_points", [])
        ]

        expression_temperament = None
        if data.get("expression_temperament"):
            expression_temperament = ExpressionTemperament.from_dict(data["expression_temperament"])

        prompt_template = None
        if data.get("prompt_template"):
            prompt_template = PromptTemplate.from_dict(data["prompt_template"])

        consistency_tips = None
        if data.get("consistency_tips"):
            consistency_tips = ConsistencyTips.from_dict(data["consistency_tips"])

        return cls(
            character_id=data.get("character_id", ""),
            name=data.get("name", ""),
            courtesy_name=data.get("courtesy_name", ""),
            age=data.get("age", ""),
            gender=data.get("gender", ""),
            character_type=data.get("character_type", ""),
            archetype=data.get("archetype", ""),
            temperament=data.get("temperament", []),
            synesthesia=data.get("synesthesia", ""),
            bone_structure=bone_structure,
            soft_tissue=soft_tissue,
            visual_memory_points=visual_memory_points,
            expression_temperament=expression_temperament,
            prompt_template=prompt_template,
            consistency_tips=consistency_tips,
            hairstyle=data.get("hairstyle", {}),
            costume=data.get("costume", {}),
            quirks=data.get("quirks", []),
            signature_lines=data.get("signature_lines", []),
            relationship=data.get("relationship", {}),
            call_sign=data.get("call_sign", {}),
            backstory=data.get("backstory", ""),
            reference_image=data.get("reference_image", ""),
            makeup_images=data.get("makeup_images", []),
            three_views=data.get("three_views", {}),
            status=data.get("status", "draft")
        )

    def generate_prompt(self, shot_type: str = "closeup") -> str:
        """
        根据角色配置生成提示词

        Args:
            shot_type: 镜头类型 (closeup, medium, wide)

        Returns:
            生成的提示词
        """
        parts = []

        # 基础信息
        if self.name:
            parts.append(f"角色：{self.name}")
        if self.age:
            parts.append(f"年龄：{self.age}")
        if self.archetype:
            parts.append(f"身份：{self.archetype}")

        # 气质
        if self.temperament:
            parts.append(f"气质：{', '.join(self.temperament)}")
        if self.synesthesia:
            parts.append(f"通感：{self.synesthesia}")

        # 视觉记忆点（按重要性排序）
        if self.visual_memory_points:
            sorted_points = sorted(
                self.visual_memory_points,
                key=lambda x: x.criticality,
                reverse=True
            )
            vmp_parts = []
            for vmp in sorted_points:
                if vmp.must_preserve:
                    weight = vmp.criticality / 10
                    vmp_parts.append(f"({vmp.description}:{weight:.1f})")
            if vmp_parts:
                parts.append(f"视觉特征：{', '.join(vmp_parts)}")

        # 骨相结构
        if self.bone_structure:
            bs = self.bone_structure
            if bs.face_shape_description:
                parts.append(f"脸型：{bs.face_shape_description}")

        # 软组织
        if self.soft_tissue:
            st = self.soft_tissue
            if st.eyes:
                eye_desc = st.eyes.get("eye_spirit", "") or st.eyes.get("shape", "")
                if eye_desc:
                    parts.append(f"眼睛：{eye_desc}")
            if st.unique_marks:
                for mark in st.unique_marks:
                    parts.append(f"特征：{mark.get('description', '')}")

        # 表情气质
        if self.expression_temperament:
            et = self.expression_temperament
            if et.resting_expression:
                parts.append(f"表情：{et.resting_expression}")

        # 发型
        if self.hairstyle:
            hair_desc = self.hairstyle.get("details", "") or self.hairstyle.get("style", "")
            if hair_desc:
                parts.append(f"发型：{hair_desc}")

        # 服装
        if self.costume:
            costume_desc = self.costume.get("style", "") or str(self.costume)
            if costume_desc:
                parts.append(f"服装：{costume_desc}")

        return "\n".join(parts)

    def load_biography(self, project_path: Path) -> Optional[str]:
        """
        加载角色小传卡

        Args:
            project_path: 项目路径

        Returns:
            小传卡内容，        """
        bio_path = Path(project_path) / "characters" / f"{self.name}_biography.md"
        if bio_path.exists():
            return bio_path.read_text(encoding="utf-8")
        return None

    def save_biography(self, project_path: Path, content: str) -> Path:
        """
        保存角色小传卡

        Args:
            project_path: 项目路径
            content: 小传卡内容

        Returns:
            保存的文件路径
        """
        bio_path = Path(project_path) / "characters" / f"{self.name}_biography.md"
        bio_path.parent.mkdir(parents=True, exist_ok=True)
        bio_path.write_text(content, encoding="utf-8")
        return bio_path

