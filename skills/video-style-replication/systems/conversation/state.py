"""
对话状态管理
====================================================
管理对话流程中的状态信息。

用法：
    from systems.conversation import ConversationState

    state = ConversationState()
    state.set_phase("character_creation")
    state.set_current_character("沈砚舟")
"""

from dataclasses import dataclass, field
from pathlib import Path
from typing import Dict, List, Any, Optional
from datetime import datetime
import json


@dataclass
class CharacterDraft:
    """角色草稿"""
    name: str = ""
    character_type: str = ""  # male_lead, female_lead, supporting
    archetype: str = ""  # 角色原型
    age_range: str = ""
    temperament: List[str] = field(default_factory=list)
    appearance: str = ""
    special_marks: str = ""  # 特殊标记
    costume: str = ""
    makeup_image: str = ""
    three_views: Dict[str, str] = field(default_factory=dict)
    status: str = "draft"  # draft, confirmed, completed


@dataclass
class SceneDraft:
    """场景草稿"""
    scene_id: str = ""
    name: str = ""
    description: str = ""
    scene_type: str = ""  # indoor_daytime, indoor_nighttime, outdoor_daytime, outdoor_nighttime
    mood: str = "normal"  # normal, warm, tense, solemn
    characters: List[str] = field(default_factory=list)
    concept_image: str = ""
    upsampled_image: str = ""  # 放大后的图片路径
    status: str = "draft"  # draft, confirmed, completed


class ConversationState:
    """对话状态管理"""

    def __init__(self, project_path: Path = None):
        self.project_path = project_path

        # 当前阶段
        # init -> project_setup -> character_creation -> scene_creation -> storyboard_generation -> review
        self.phase = "init"
        self.step = 0

        # 项目信息
        self.project_name = ""
        self.project_style = ""
        self.project_location = ""

        # 角色相关
        self.characters: Dict[str, CharacterDraft] = {}
        self.current_character: Optional[str] = None
        self.character_count = 0

        # 场景相关
        self.scenes: Dict[str, SceneDraft] = {}
        self.current_scene: Optional[str] = None
        self.scene_count = 0

        # 工作流相关
        self.current_workflow_step: Optional[str] = None
        self.workflow_results: Dict[str, Any] = {}

        # 待确认的内容
        self.pending_confirmation: Optional[Dict[str, Any]] = None

        # 对话历史（最近几轮）
        self.recent_messages: List[Dict[str, str]] = []

        # 元数据
        self.created_at = datetime.now().isoformat()
        self.updated_at = datetime.now().isoformat()

    def set_phase(self, phase: str, step: int = 0):
        """设置当前阶段"""
        self.phase = phase
        self.step = step
        self.updated_at = datetime.now().isoformat()

    def advance_step(self):
        """推进到下一步"""
        self.step += 1
        self.updated_at = datetime.now().isoformat()

    def set_project_info(self, name: str, style: str, location: str):
        """设置项目信息"""
        self.project_name = name
        self.project_style = style
        self.project_location = location
        self.updated_at = datetime.now().isoformat()

    def start_character_creation(self, count: int = 2):
        """开始角色创建阶段"""
        self.phase = "character_creation"
        self.step = 0
        self.character_count = count
        self.updated_at = datetime.now().isoformat()

    def create_character_draft(self, name: str, character_type: str = "") -> CharacterDraft:
        """创建角色草稿"""
        draft = CharacterDraft(name=name, character_type=character_type)
        self.characters[name] = draft
        self.current_character = name
        self.updated_at = datetime.now().isoformat()
        return draft

    def get_current_character(self) -> Optional[CharacterDraft]:
        """获取当前角色"""
        if self.current_character is not None and self.current_character in self.characters:
            return self.characters[self.current_character]
        return None

    def update_character(self, name: str, **kwargs):
        """更新角色信息"""
        if name in self.characters:
            char = self.characters[name]
            for key, value in kwargs.items():
                if hasattr(char, key):
                    setattr(char, key, value)
            self.updated_at = datetime.now().isoformat()

    def confirm_character(self, name: str) -> bool:
        """确认角色"""
        if name in self.characters:
            self.characters[name].status = "confirmed"
            self.updated_at = datetime.now().isoformat()
            return True
        return False

    def start_scene_creation(self, count: int = 1):
        """开始场景创建阶段"""
        self.phase = "scene_creation"
        self.step = 0
        self.scene_count = count
        self.updated_at = datetime.now().isoformat()

    def create_scene_draft(self, scene_id: str, name: str = "") -> SceneDraft:
        """创建场景草稿"""
        draft = SceneDraft(scene_id=scene_id, name=name)
        self.scenes[scene_id] = draft
        self.current_scene = scene_id
        self.updated_at = datetime.now().isoformat()
        return draft

    def get_current_scene(self) -> Optional[SceneDraft]:
        """获取当前场景"""
        if self.current_scene and self.current_scene in self.scenes:
            return self.scenes[self.current_scene]
        return None

    def update_scene(self, scene_id: str, **kwargs):
        """更新场景信息"""
        if scene_id in self.scenes:
            scene = self.scenes[scene_id]
            for key, value in kwargs.items():
                if hasattr(scene, key):
                    setattr(scene, key, value)
            self.updated_at = datetime.now().isoformat()

    def confirm_scene(self, scene_id: str) -> bool:
        """确认场景"""
        if scene_id in self.scenes:
            self.scenes[scene_id].status = "confirmed"
            self.updated_at = datetime.now().isoformat()
            return True
        return False

    def set_pending_confirmation(self, confirm_type: str, data: Dict[str, Any]):
        """设置待确认的内容"""
        self.pending_confirmation = {
            "type": confirm_type,
            "data": data,
            "created_at": datetime.now().isoformat()
        }
        self.updated_at = datetime.now().isoformat()

    def clear_pending_confirmation(self):
        """清除待确认的内容"""
        self.pending_confirmation = None
        self.updated_at = datetime.now().isoformat()

    def add_message(self, role: str, content: str):
        """添加消息到历史"""
        self.recent_messages.append({
            "role": role,
            "content": content,
            "timestamp": datetime.now().isoformat()
        })
        # 只保留最近 20 条消息
        if len(self.recent_messages) > 20:
            self.recent_messages = self.recent_messages[-20:]
        self.updated_at = datetime.now().isoformat()

    def get_summary(self) -> str:
        """获取状态摘要"""
        lines = [
            f"阶段: {self.phase}",
            f"步骤: {self.step}",
        ]
        if self.project_name:
            lines.append(f"项目: {self.project_name}")
        if self.project_style:
            lines.append(f"风格: {self.project_style}")
        if self.characters:
            lines.append(f"角色: {list(self.characters.keys())}")
        if self.scenes:
            lines.append(f"场景: {list(self.scenes.keys())}")
        return "\n".join(lines)

    def save(self, path: Path = None):
        """保存状态"""
        if path is None:
            if self.project_path:
                path = self.project_path / ".conversation_state.json"
            else:
                return

        data = {
            "project_path": str(self.project_path) if self.project_path else None,
            "phase": self.phase,
            "step": self.step,
            "project_name": self.project_name,
            "project_style": self.project_style,
            "project_location": self.project_location,
            "characters": {
                name: {
                    "name": char.name,
                    "character_type": char.character_type,
                    "archetype": char.archetype,
                    "age_range": char.age_range,
                    "temperament": char.temperament,
                    "appearance": char.appearance,
                    "special_marks": char.special_marks,
                    "costume": char.costume,
                    "makeup_image": char.makeup_image,
                    "three_views": char.three_views,
                    "status": char.status
                }
                for name, char in self.characters.items()
            },
            "current_character": self.current_character,
            "character_count": self.character_count,
            "scenes": {
                sid: {
                    "scene_id": scene.scene_id,
                    "name": scene.name,
                    "description": scene.description,
                    "scene_type": scene.scene_type,
                    "characters": scene.characters,
                    "concept_image": scene.concept_image,
                    "status": scene.status
                }
                for sid, scene in self.scenes.items()
            },
            "current_scene": self.current_scene,
            "scene_count": self.scene_count,
            "current_workflow_step": self.current_workflow_step,
            "workflow_results": self.workflow_results,
            "pending_confirmation": self.pending_confirmation,
            "recent_messages": self.recent_messages[-10:],
            "created_at": self.created_at,
            "updated_at": self.updated_at
        }

        with open(path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    @classmethod
    def load(cls, path: Path) -> "ConversationState":
        """从文件加载状态"""
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)

        state = cls()
        state.project_path = Path(data["project_path"]) if data.get("project_path") else None
        state.phase = data.get("phase", "init")
        state.step = data.get("step", 0)
        state.project_name = data.get("project_name", "")
        state.project_style = data.get("project_style", "")
        state.project_location = data.get("project_location", "")

        # 恢复角色
        for name, char_data in data.get("characters", {}).items():
            state.characters[name] = CharacterDraft(
                name=char_data.get("name", name),
                character_type=char_data.get("character_type", ""),
                archetype=char_data.get("archetype", ""),
                age_range=char_data.get("age_range", ""),
                temperament=char_data.get("temperament", []),
                appearance=char_data.get("appearance", ""),
                special_marks=char_data.get("special_marks", ""),
                costume=char_data.get("costume", ""),
                makeup_image=char_data.get("makeup_image", ""),
                three_views=char_data.get("three_views", {}),
                status=char_data.get("status", "draft")
            )

        state.current_character = data.get("current_character")
        state.character_count = data.get("character_count", 0)

        # 恢复场景
        for sid, scene_data in data.get("scenes", {}).items():
            state.scenes[sid] = SceneDraft(
                scene_id=scene_data.get("scene_id", sid),
                name=scene_data.get("name", ""),
                description=scene_data.get("description", ""),
                scene_type=scene_data.get("scene_type", ""),
                characters=scene_data.get("characters", []),
                concept_image=scene_data.get("concept_image", ""),
                status=scene_data.get("status", "draft")
            )

        state.current_scene = data.get("current_scene")
        state.scene_count = data.get("scene_count", 0)
        state.current_workflow_step = data.get("current_workflow_step")
        state.workflow_results = data.get("workflow_results", {})
        state.pending_confirmation = data.get("pending_confirmation")
        state.recent_messages = data.get("recent_messages", [])
        state.created_at = data.get("created_at", datetime.now().isoformat())
        state.updated_at = data.get("updated_at", datetime.now().isoformat())

        return state
