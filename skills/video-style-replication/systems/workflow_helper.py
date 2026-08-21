"""
工作流助手
====================================================
统一管理工作日志和生成器，确保所有操作都被记录。
同时确保 project.yaml 与 work_log.md 同步更新。

用法：
    from systems.workflow_helper import WorkflowHelper

    helper = WorkflowHelper(project_path)

    # 角色生成（自动记录日志 + 注册到项目）
    result = helper.generate_makeup_images(character_info)

    # 场景生成（自动记录日志 + 注册到项目）
    result = helper.generate_scene_concept(scene_info)

    # 手动注册
    helper.register_character("苏景澜", {...})
    helper.register_scene("辟讹署大堂", {...})
"""

from pathlib import Path
from typing import Dict, List, Optional, Any
from datetime import datetime

from systems.memory.work_logger import WorkLogger
from systems.config.project_manager import ProjectConfig
from systems.character.generator import CharacterGenerator
from systems.scene.generator import SceneGenerator
from systems.storyboard.generator import StoryboardGenerator, ShotDescription


class WorkflowHelper:
    """工作流助手 - 统一管理工作日志、项目配置和生成器"""

    def __init__(self, project_path: Path):
        self.project_path = Path(project_path)
        self.work_logger = WorkLogger(project_path)
        self.project_config = ProjectConfig.load(project_path)

        # 初始化生成器，传入 work_logger 和 project_config
        self.character_gen = CharacterGenerator(
            project_path,
            work_logger=self.work_logger,
            project_config=self.project_config
        )
        self.scene_gen = SceneGenerator(
            project_path,
            work_logger=self.work_logger,
            project_config=self.project_config
        )
        self.storyboard_gen = StoryboardGenerator(
            project_path,
            work_logger=self.work_logger,
            project_config=self.project_config
        )

    # ============================================================
    # 项目配置管理（新增）
    # ============================================================

    def register_character(self, name: str, config: dict):
        """注册角色到项目配置"""
        self.project_config.register_character(name, config)
        self.work_logger.log_step("register_character", f"注册角色「{name}」到项目")

    def register_scene(self, scene_id: str, config: dict):
        """注册场景到项目配置"""
        self.project_config.register_scene(scene_id, config)
        self.work_logger.log_step("register_scene", f"注册场景「{scene_id}」到项目")

    def get_character_3view(self, name: str, costume: str) -> Path:
        """获取角色三视图路径"""
        return self.project_config.get_character_3view(name, costume)

    def get_scene_reference(self, scene_id: str) -> Optional[Path]:
        """获取场景参考图"""
        return self.project_config.get_scene_reference(scene_id)

    def get_character_info(self, name: str) -> Optional[dict]:
        """获取角色配置信息"""
        return self.project_config.characters.get(name)

    def get_scene_info(self, scene_id: str) -> Optional[dict]:
        """获取场景配置信息"""
        return self.project_config.scenes.get(scene_id)

    def list_characters(self) -> List[str]:
        """列出所有已注册角色"""
        return list(self.project_config.characters.keys())

    def list_scenes(self) -> List[str]:
        """列出所有已注册场景"""
        return list(self.project_config.scenes.keys())

    # ============================================================
    # 角色相关
    # ============================================================

    def generate_makeup_images(self, character_info: Dict, count: int = 4, style: str = "costume_drama"):
        """生成定妆照（自动记录日志）"""
        return self.character_gen.generate_makeup_images(character_info, count, style)

    def generate_base_model(self, character_info: Dict, reference_image: Path = None):
        """生成素模三视图（自动记录日志）"""
        return self.character_gen.generate_base_model(character_info, reference_image)

    def generate_costume_threeview(self, base_model_path: Path, costume_name: str, character_info: Dict = None, **kwargs):
        """生成服装三视图（自动记录日志 + 自动注册）"""
        return self.character_gen.generate_costume_threeview(
            base_model_path=base_model_path,
            costume_name=costume_name,
            character_info=character_info,
            **kwargs
        )

    def select_makeup_photo(self, character_name: str, selection: str, reason: str = ""):
        """记录定妆照选择"""
        self.work_logger.log_decision(
            f"「{character_name}」选择定妆照 {selection}",
            reason
        )

    # ============================================================
    # 场景相关
    # ============================================================

    def generate_scene_concept(self, scene_name: str, scene_description: str, **kwargs):
        """生成场景概念图（自动记录日志 + 自动注册）"""
        return self.scene_gen.generate_scene_concept(
            scene_name=scene_name,
            scene_description=scene_description,
            **kwargs
        )

    def upsample_scene(self, image_id: str, index: int = 1, scene_name: str = None, save_path: Path = None):
        """放大场景图（自动记录日志）"""
        # 记录放大操作
        self.work_logger.log_step(
            f"upsample_scene_U{index}",
            f"放大场景图 U{index}",
            {"image_id": image_id, "scene_name": scene_name}
        )

        result = self.scene_gen.upsample_scene(
            image_id=image_id,
            index=index,
            scene_name=scene_name,
            save_path=save_path
        )

        if result.success:
            self.work_logger.log_decision(f"场景图 U{index} 放大完成")

        return result

    # ============================================================
    # 分镜相关
    # ============================================================

    def localize_scene(self, scene_name: str, scene_concept_path: Path, style: str = "costume_drama"):
        """场景实景化转制（自动记录日志 + 自动注册）"""
        return self.storyboard_gen.localize_scene(
            scene_name=scene_name,
            scene_concept_path=scene_concept_path,
            style=style
        )

    def generate_storyboard_grid(
        self,
        scene_name: str,
        scene_localized_path,
        character_refs: list,
        shot_descriptions: list = None,
        style: str = "costume_drama",
        scene_type: str = "indoor_daytime",
        mood: str = "normal",
        character_emotions: Dict[str, str] = None
    ):
        """生成九宫格分镜（自动记录日志 + 自动注册）"""
        return self.storyboard_gen.generate_storyboard_grid(
            scene_name=scene_name,
            scene_localized_path=scene_localized_path,
            character_refs=character_refs,
            shot_descriptions=shot_descriptions,
            style=style,
            scene_type=scene_type,
            mood=mood,
            character_emotions=character_emotions
        )

    def generate_panoramic_storyboard(
        self,
        scene_name: str,
        scene_concept_path,
        character_refs: list,
        shot_descriptions: list = None,
        style: str = "costume_drama"
    ):
        """生成全景分镜（自动记录日志）"""
        return self.storyboard_gen.generate_panoramic_storyboard(
            scene_name=scene_name,
            scene_concept_path=scene_concept_path,
            character_refs=character_refs,
            shot_descriptions=shot_descriptions,
            style=style
        )

    def generate_nine_grid(self, panoramic_path, scene_name: str = None):
        """生成九宫格预览（自动记录日志）"""
        return self.storyboard_gen.generate_nine_grid(
            panoramic_path=panoramic_path,
            scene_name=scene_name
        )

    def generate_individual_shots(self, panoramic_path, scene_name: str = None):
        """从全景分镜生成9张独立分镜（自动记录日志）"""
        return self.storyboard_gen.generate_individual_shots(
            panoramic_path=panoramic_path,
            scene_name=scene_name
        )

    # ============================================================
    # 视频提示词生成
    # ============================================================

    def generate_video_prompts(self, scene_name: str) -> List[Path]:
        """
        生成视频提示词（自动记录日志）

        Args:
            scene_name: 场景名称

        Returns:
            保存的文件路径列表
        """
        from systems.video_prompt import VideoPromptGenerator

        gen = VideoPromptGenerator(self.project_path)
        prompts = gen.generate_video_prompts(scene_name)
        saved_paths = gen.save_video_prompts(prompts, scene_name)

        self.work_logger.log_step(
            "generate_video_prompts",
            f"生成场景「{scene_name}」视频提示词",
            {
                "segments": len(prompts),
                "output_dir": str(saved_paths[-1].parent) if saved_paths else ""
            }
        )

        return saved_paths

    # ============================================================
    # 日志方法
    # ============================================================

    def log_step(self, step_id: str, step_name: str, details: dict = None):
        """记录步骤"""
        self.work_logger.log_step(step_id, step_name, details)

    def log_decision(self, decision: str, reason: str = ""):
        """记录决策"""
        self.work_logger.log_decision(decision, reason)

    def log_issue(self, issue: str, description: str = ""):
        """记录问题"""
        self.work_logger.log_issue(issue, description)

    def log_solution(self, solution: str, result: str = ""):
        """记录解决方案"""
        self.work_logger.log_solution(solution, result)

    def log_note(self, note: str):
        """记录笔记"""
        self.work_logger.log_note(note)

    def log_error(self, error: str, details: dict = None):
        """记录错误"""
        self.work_logger.log_error(error, details)

    def get_summary(self, last_n: int = 20) -> str:
        """获取最近日志摘要"""
        return self.work_logger.get_summary(last_n)

    def save(self):
        """保存日志"""
        self.work_logger.save()
