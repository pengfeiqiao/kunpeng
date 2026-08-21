"""
分镜脚本生成器
====================================================
生成分镜的剧情脚本，包含每个分镜的详细描述。

核心功能：
- generate_storyboard_script - 生成分镜脚本
- save_script - 保存脚本到项目

用法：
    from systems.storyboard.script_generator import ScriptGenerator

    generator = ScriptGenerator(project_path)

    script = generator.generate_storyboard_script(
        scene_name="辟讹署大堂",
        scene_description="官署大堂场景...",
        characters=["苏景澜", "沈青辞"],
        plot_summary="苏景澜正在审阅卷宗，沈青辞来访..."
    )

    generator.save_script(script, scene_name)
"""

from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass, field
from datetime import datetime
import json

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from systems.memory.work_logger import WorkLogger


@dataclass
class ShotScript:
    """单个分镜脚本 - 优化版数据结构"""
    shot_number: int
    shot_type: str  # 全景/中景/近景/特写
    camera_angle: str  # 平拍/俯拍/仰拍

    # 精简提示词字段（用于图像生成）
    subject: str = ""  # 主体（角色名，单角色场景）
    action: str = ""  # 简化动作（1-2个词）
    expression: str = ""  # 简化表情（1-2个词）
    costume_note: str = ""  # 服装备注
    lighting_note: str = ""  # 光线备注
    face_quality: str = "清晰五官，无变形"  # 面部质量锚点

    # 角色服装指定（新增）
    # 格式: {"角色名": "服装版本"}，如 {"沈青辞": "日常常服", "苏景澜": "会客礼服"}
    character_costumes: Dict[str, str] = field(default_factory=dict)

    # 完整描述（存档用，不用于生成）
    description: str = ""
    characters: List[str] = field(default_factory=list)  # 出场角色列表
    dialogue: str = ""  # 对白（可选）
    emotion: Dict[str, str] = field(default_factory=dict)  # 角色情绪映射


@dataclass
class StoryboardScript:
    """完整分镜脚本"""
    scene_name: str
    scene_description: str
    characters: List[str]
    plot_summary: str
    shots: List[ShotScript]
    created_at: str = field(default_factory=lambda: datetime.now().isoformat())
    metadata: Dict[str, Any] = field(default_factory=dict)


class ScriptGenerator:
    """分镜脚本生成器"""

    def __init__(self, project_path: Path = None, work_logger: WorkLogger = None):
        self.project_path = Path(project_path) if project_path else None
        self.work_logger = work_logger

    def set_project(self, project_path: Path):
        """设置项目路径"""
        self.project_path = Path(project_path)

    def generate_storyboard_script(
        self,
        scene_name: str,
        scene_description: str,
        characters: List[str],
        plot_summary: str,
        num_shots: int = 9
    ) -> StoryboardScript:
        """
        生成分镜脚本

        Args:
            scene_name: 场景名称
            scene_description: 场景描述
            characters: 出场角色列表
            plot_summary: 剧情摘要
            num_shots: 分镜数量（默认9个）

        Returns:
            StoryboardScript
        """
        # 根据剧情生成分镜
        shots = self._generate_shots(
            scene_name, scene_description, characters, plot_summary, num_shots
        )

        script = StoryboardScript(
            scene_name=scene_name,
            scene_description=scene_description,
            characters=characters,
            plot_summary=plot_summary,
            shots=shots
        )

        if self.work_logger:
            self.work_logger.log_step(
                "generate_script",
                f"生成场景「{scene_name}」分镜脚本",
                {"shots": num_shots}
            )

        return script

    def _generate_shots(
        self,
        scene_name: str,
        scene_description: str,
        characters: List[str],
        plot_summary: str,
        num_shots: int
    ) -> List[ShotScript]:
        """根据剧情生成分镜列表"""
        shots = []

        # 默认分镜模板（可根据剧情自定义）
        shot_templates = [
            {"type": "全景", "angle": "平拍", "purpose": "建立场景"},
            {"type": "中景", "angle": "侧拍", "purpose": "引入主要角色"},
            {"type": "近景", "angle": "平拍", "purpose": "角色表情"},
            {"type": "中景", "angle": "俯拍", "purpose": "角色互动"},
            {"type": "中景", "angle": "平拍", "purpose": "情节发展"},
            {"type": "近景", "angle": "侧拍", "purpose": "情绪反应"},
            {"type": "全景", "angle": "仰拍", "purpose": "空间关系"},
            {"type": "中景", "angle": "平拍", "purpose": "情节推进"},
            {"type": "大全景", "angle": "俯拍", "purpose": "场景收尾"},
        ]

        for i in range(min(num_shots, len(shot_templates))):
            template = shot_templates[i]
            shot = ShotScript(
                shot_number=i + 1,
                shot_type=template["type"],
                camera_angle=template["angle"],
                description=f"{scene_name} - {template['purpose']}",
                characters=characters[:2] if i > 0 else [characters[0]] if characters else [],
                action="待填写"
            )
            shots.append(shot)

        return shots

    def save_script(self, script: StoryboardScript, scene_name: str = None) -> Path:
        """
        保存脚本到项目（新路径结构）

        Args:
            script: 分镜脚本
            scene_name: 场景名称（可选，使用script中的名称）

        Returns:
            保存的文件路径
        """
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        scene_name = scene_name or script.scene_name
        safe_name = scene_name.replace("/", "_").replace(" ", "_")

        # 新路径: scenes/scene_xxx/storyboard/script.json
        output_dir = self.project_path / "scenes" / f"scene_{safe_name}" / "storyboard"
        output_dir.mkdir(parents=True, exist_ok=True)

        output_path = output_dir / "script.json"

        # 转换为字典
        script_dict = {
            "scene_name": script.scene_name,
            "scene_description": script.scene_description,
            "characters": script.characters,
            "plot_summary": script.plot_summary,
            "shots": [
                {
                    "shot_number": shot.shot_number,
                    "shot_type": shot.shot_type,
                    "camera_angle": shot.camera_angle,
                    # 精简提示词字段
                    "subject": shot.subject,
                    "action": shot.action,
                    "expression": shot.expression,
                    "costume_note": shot.costume_note,
                    "lighting_note": shot.lighting_note,
                    "face_quality": shot.face_quality,
                    # 角色服装指定
                    "character_costumes": shot.character_costumes,
                    # 完整描述（存档）
                    "description": shot.description,
                    "characters": shot.characters,
                    "dialogue": shot.dialogue,
                    "emotion": shot.emotion
                }
                for shot in script.shots
            ],
            "created_at": script.created_at,
            "metadata": script.metadata
        }

        with open(output_path, "w", encoding="utf-8") as f:
            json.dump(script_dict, f, ensure_ascii=False, indent=2)

        print(f"✅ 分镜脚本已保存: {output_path}")

        return output_path

    def load_script(self, scene_name: str) -> Optional[StoryboardScript]:
        """加载已保存的脚本（新路径优先，兼容旧路径）"""
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        safe_name = scene_name.replace("/", "_").replace(" ", "_")

        # 新路径优先
        script_path = self.project_path / "scenes" / f"scene_{safe_name}" / "storyboard" / "script.json"

        # 兼容旧路径
        if not script_path.exists():
            script_path = self.project_path / "scenes" / f"scene_{safe_name}" / "storyboard_script.json"

        if not script_path.exists():
            return None

        with open(script_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        shots = [
            ShotScript(
                shot_number=shot["shot_number"],
                shot_type=shot["shot_type"],
                camera_angle=shot["camera_angle"],
                # 精简提示词字段
                subject=shot.get("subject", ""),
                action=shot.get("action", ""),
                expression=shot.get("expression", ""),
                costume_note=shot.get("costume_note", ""),
                lighting_note=shot.get("lighting_note", ""),
                face_quality=shot.get("face_quality", "清晰五官，无变形"),
                # 角色服装指定
                character_costumes=shot.get("character_costumes", {}),
                # 完整描述
                description=shot.get("description", ""),
                characters=shot.get("characters", []),
                dialogue=shot.get("dialogue", ""),
                emotion=shot.get("emotion", {})
            )
            for shot in data["shots"]
        ]

        return StoryboardScript(
            scene_name=data["scene_name"],
            scene_description=data["scene_description"],
            characters=data["characters"],
            plot_summary=data["plot_summary"],
            shots=shots,
            created_at=data.get("created_at", ""),
            metadata=data.get("metadata", {})
        )

    def format_script_for_prompt(self, script: StoryboardScript) -> str:
        """将脚本格式化为提示词"""
        lines = [f"【场景】{script.scene_name}"]
        lines.append(f"【剧情】{script.plot_summary}")
        lines.append(f"【角色】{', '.join(script.characters)}")
        lines.append("")
        lines.append("【分镜内容】")

        for shot in script.shots:
            lines.append(f"分镜{shot.shot_number}：")
            lines.append(f"- 景别：{shot.shot_type}，{shot.camera_angle}")
            lines.append(f"- 画面：{shot.description}")
            if shot.characters:
                lines.append(f"- 角色：{', '.join(shot.characters)}")
            if shot.action and shot.action != "待填写":
                lines.append(f"- 动作：{shot.action}")
            if shot.dialogue:
                lines.append(f"- 对白：{shot.dialogue}")
            lines.append("")

        return "\n".join(lines)
