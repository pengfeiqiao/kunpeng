"""
对话流程引导
====================================================
定义完整的对话流程，处理用户输入并推进工作流。

用法：
    from systems.conversation import ConversationGuide

    guide = ConversationGuide()
    response = guide.process_message("我想做一个古装剧的分镜")
"""

from pathlib import Path
from typing import Dict, Any, Optional, List
import re

from .state import ConversationState, CharacterDraft, SceneDraft
from .prompts import ConversationPrompts


class ConversationGuide:
    """对话流程引导"""

    def __init__(self, project_path: Path = None):
        self.state = ConversationState(project_path)
        self.prompts = ConversationPrompts()

        # 意图识别模式
        self.intent_patterns = {
            "create_project": [
                r"我想做.*分镜",
                r"创建.*项目",
                r"开始.*新项目",
                r"做一个.*项目",
                r"复刻.*风格",
            ],
            "continue_project": [
                r"继续.*项目",
                r"打开.*项目",
                r"恢复.*项目",
            ],
            "list_projects": [
                r"查看.*项目",
                r"项目列表",
                r"我的项目",
                r"有哪些项目",
            ],
            "create_character": [
                r"创建.*角色",
                r"添加.*角色",
                r"定义.*角色",
                r"男主|女主",
            ],
            "confirm": [
                r"确认|是|对|ok|好的|没问题",
            ],
            "cancel": [
                r"取消|不|否|no|不对",
            ],
        }

    def process_message(self, user_message: str, context: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        处理用户消息

        Args:
            user_message: 用户输入的消息
            context: 额外上下文（如图片等）

        Returns:
            响应信息，包含：
            - response: 回复文本
            - phase: 当前阶段
            - step: 当前步骤
            - action: 需要执行的动作（可选）
            - options: 可选项（可选）
        """
        self.state.add_message("user", user_message)

        # 根据当前阶段处理
        if self.state.phase == "init":
            return self._handle_init_phase(user_message)
        elif self.state.phase == "project_setup":
            return self._handle_project_setup(user_message)
        elif self.state.phase == "character_creation":
            return self._handle_character_creation(user_message)
        elif self.state.phase == "scene_creation":
            return self._handle_scene_creation(user_message)
        elif self.state.phase == "storyboard_generation":
            return self._handle_storyboard_generation(user_message)
        elif self.state.phase == "review":
            return self._handle_review(user_message)
        elif self.state.phase == "video_prompt":
            return self._handle_video_prompt(user_message)
        else:
            return self._handle_unknown(user_message)

    def _handle_init_phase(self, user_message: str) -> Dict[str, Any]:
        """处理初始化阶段"""
        intent = self._recognize_intent(user_message)

        if intent == "create_project":
            self.state.set_phase("project_setup", 0)
            return {
                "response": self.prompts.get_prompt("WELCOME") + self.prompts.get_prompt("STYLE_OPTIONS"),
                "phase": "project_setup",
                "step": 0,
                "options": ["古装剧风格", "未来废土风格"]
            }

        elif intent == "continue_project":
            return self._list_projects_for_selection()

        elif intent == "list_projects":
            return self._list_projects()

        else:
            return {
                "response": self.prompts.get_prompt("UNKNOWN_INTENT"),
                "phase": "init",
                "step": 0
            }

    def _handle_project_setup(self, user_message: str) -> Dict[str, Any]:
        """处理项目设置阶段"""
        step = self.state.step

        if step == 0:
            # 选择风格
            style = self._extract_style(user_message)
            if style:
                from systems.config import StyleManager
                style_info = StyleManager.get_style_info(style)
                self.state.project_style = style
                self.state.step = 1

                return {
                    "response": self.prompts.get_prompt(
                        "STYLE_SELECTED",
                        style_name=style_info.get("name", style),
                        style_description=style_info.get("description", "")
                    ),
                    "phase": "project_setup",
                    "step": 1
                }
            else:
                return {
                    "response": "抱歉，我没有识别到风格。请选择：\n1. 古装剧风格\n2. 未来废土风格",
                    "phase": "project_setup",
                    "step": 0,
                    "options": ["古装剧风格", "未来废土风格"]
                }

        elif step == 1:
            # 输入项目名称
            name = user_message.strip()
            if name:
                self.state.project_name = name
                self.state.step = 2

                default_location = str(Path.home() / "Desktop")
                return {
                    "response": self.prompts.get_prompt(
                        "PROJECT_NAME_CONFIRM",
                        name=name,
                        default_location=default_location
                    ),
                    "phase": "project_setup",
                    "step": 2
                }
            else:
                return {
                    "response": "请输入项目名称：",
                    "phase": "project_setup",
                    "step": 1
                }

        elif step == 2:
            # 确认位置
            location = user_message.strip()
            if not location or location in ["默认", "桌面", "desktop", "确认", "ok", "好的"]:
                location = str(Path.home() / "Desktop")

            self.state.project_location = location
            self.state.step = 3

            return {
                "response": self.prompts.get_prompt(
                    "PROJECT_LOCATION_CONFIRM",
                    name=self.state.project_name,
                    style=self.state.project_style,
                    location=location
                ),
                "phase": "project_setup",
                "step": 3,
                "options": ["确认", "修改"]
            }

        elif step == 3:
            # 最终确认
            if self._is_confirm(user_message):
                # 创建项目
                project_path = self._create_project()

                self.state.set_phase("character_creation", 0)

                return {
                    "response": self.prompts.get_prompt(
                        "PROJECT_CREATED",
                        location=str(project_path)
                    ) + self.prompts.get_prompt("START_CHARACTER"),
                    "phase": "character_creation",
                    "step": 0,
                    "action": {
                        "type": "create_project",
                        "path": str(project_path)
                    }
                }
            else:
                self.state.step = 1
                return {
                    "response": "好的，让我们重新开始。请输入项目名称：",
                    "phase": "project_setup",
                    "step": 1
                }

        return {
            "response": "抱歉，出了点问题。让我们重新开始。",
            "phase": "init",
            "step": 0
        }

    def _handle_character_creation(self, user_message: str) -> Dict[str, Any]:
        """处理角色创建阶段"""
        step = self.state.step

        if step == 0:
            # 确定角色数量
            count = self._extract_number(user_message, default=2)
            self.state.start_character_creation(count)
            self.state.step = 1

            return {
                "response": f"好的，我们要创建 **{count}** 个角色。\n\n这是第一个角色，请问是：\n1. 男主\n2. 女主\n3. 配角",
                "phase": "character_creation",
                "step": 1,
                "options": ["男主", "女主", "配角"]
            }

        elif step == 1:
            # 确定角色类型
            char_type = self._extract_character_type(user_message)
            current_index = len(self.state.characters) + 1

            draft = self.state.create_character_draft("", char_type)
            self.state.step = 2

            archetype_examples = self.prompts.get_archetype_examples(
                char_type,
                self.state.project_style
            )

            return {
                "response": self.prompts.get_prompt(
                    "CHARACTER_TYPE_TEMPLATE",
                    character_type=self.prompts.format_character_type(char_type),
                    archetype_examples=archetype_examples
                ),
                "phase": "character_creation",
                "step": 2
            }

        elif step == 2:
            # 收集角色信息
            char_info = self._parse_character_info(user_message)
            current_char = self.state.get_current_character()

            if current_char:
                # 移除 char_info 中的 name 字段，避免重复传递
                char_info_without_name = {k: v for k, v in char_info.items() if k != "name"}
                self.state.update_character(
                    current_char.name,
                    **char_info_without_name
                )

                self.state.step = 3

                return {
                    "response": self.prompts.get_prompt(
                        "CHARACTER_INFO_CONFIRM",
                        character_type=self.prompts.format_character_type(current_char.character_type),
                        **char_info
                    ),
                    "phase": "character_creation",
                    "step": 3,
                    "options": ["确认", "修改"]
                }
            else:
                return {
                    "response": "抱歉，出了点问题。让我们重新开始角色创建。",
                    "phase": "character_creation",
                    "step": 1
                }

        elif step == 3:
            # 确认角色信息
            if self._is_confirm(user_message):
                current_char = self.state.get_current_character()
                if current_char:
                    self.state.confirm_character(current_char.name)

                # 现代旅游风格：询问真人参考图
                if self.state.project_style == "modern_travel":
                    self.state.step = 3.5  # 新增step询问真人参考图
                    return {
                        "response": f"✅ 角色「{current_char.name}」已确认！\n\n**是否有真人参考照片？**\n\n如果有，请提供照片路径（如：C:/Photos/my_face.jpg）。\n如果没有，请输入'无'，系统将按照描述生成角色。",
                        "phase": "character_creation",
                        "step": 3.5,
                        "options": ["无"]
                    }

                # 其他风格：继续正常流程
                # 检查是否还有角色需要创建
                if len([c for c in self.state.characters.values() if c.status == "confirmed"]) < self.state.character_count:
                    self.state.step = 1
                    return {
                        "response": f"✅ 角色「{current_char.name}」已确认！\n\n接下来创建第 {len(self.state.characters) + 1}/{self.state.character_count} 个角色。\n\n这是：\n1. 男主\n2. 女主\n3. 配角",
                        "phase": "character_creation",
                        "step": 1,
                        "options": ["男主", "女主", "配角"]
                    }
                else:
                    # 所有角色创建完成，进入定妆照生成
                    self.state.step = 4
                    char_list = "\n".join([f"- {name}" for name in self.state.characters.keys()])
                    return {
                        "response": f"🎉 **所有角色信息已收集！**\n\n{char_list}\n\n现在我们开始生成定妆照。我会为每个角色生成候选图，请稍等...",
                        "phase": "character_creation",
                        "step": 4,
                        "action": {
                            "type": "generate_makeup",
                            "characters": list(self.state.characters.keys())
                        }
                    }
            else:
                self.state.step = 2
                return {
                    "response": "好的，请重新描述角色信息：",
                    "phase": "character_creation",
                    "step": 2
                }

        elif step == 3.5:
            # 处理真人参考图（仅现代旅游风格）
            import os

            if user_message.strip().lower() in ["无", "no", "没有", "n"]:
                # 没有真人参考图
                self.state.real_person_photo = None
            else:
                # 验证文件是否存在
                photo_path = user_message.strip()
                if os.path.exists(photo_path):
                    self.state.real_person_photo = photo_path
                else:
                    # 文件不存在，重新询问
                    return {
                        "response": f"❌ 文件不存在：{photo_path}\n\n请重新提供正确的照片路径，或输入'无'跳过。",
                        "phase": "character_creation",
                        "step": 3.5,
                        "options": ["无"]
                    }

            # 检查是否还有角色需要创建
            current_char = self.state.get_current_character()
            if len([c for c in self.state.characters.values() if c.status == "confirmed"]) < self.state.character_count:
                self.state.step = 1
                photo_msg = f"（已收到真人参考照片：{self.state.real_person_photo}）\n\n" if hasattr(self.state, 'real_person_photo') and self.state.real_person_photo else ""
                return {
                    "response": f"✅ 角色「{current_char.name}」已确认！{photo_msg}\n\n接下来创建第 {len(self.state.characters) + 1}/{self.state.character_count} 个角色。\n\n这是：\n1. 男主\n2. 女主\n3. 配角",
                    "phase": "character_creation",
                    "step": 1,
                    "options": ["男主", "女主", "配角"]
                }
            else:
                # 所有角色创建完成，进入定妆照生成
                self.state.step = 4
                char_list = "\n".join([f"- {name}" for name in self.state.characters.keys()])
                photo_msg = f"（将使用真人参考照片生成角色）\n\n" if hasattr(self.state, 'real_person_photo') and self.state.real_person_photo else ""
                return {
                    "response": f"🎉 **所有角色信息已收集！**\n\n{char_list}\n\n{photo_msg}现在我们开始生成定妆照。我会为每个角色生成候选图，请稍等...",
                    "phase": "character_creation",
                    "step": 4,
                    "action": {
                        "type": "generate_makeup",
                        "characters": list(self.state.characters.keys())
                    }
                }

        elif step == 4:
            # 等待定妆照生成结果
            # 这一步由外部系统调用 confirm_makeup_selection() 处理
            return {
                "response": "正在生成定妆照，请稍等...",
                "phase": "character_creation",
                "step": 4
            }

        elif step == 5:
            # 选择定妆照
            selection = self._extract_selection(user_message)
            if selection:
                return {
                    "response": f"✅ 已选择 **{selection}** 作为定妆照！\n\n接下来生成三视图，请稍等...",
                    "phase": "character_creation",
                    "step": 6,
                    "action": {
                        "type": "generate_threeview",
                        "selection": selection
                    }
                }
            else:
                return {
                    "response": "请选择 U1-U4 中的一张：",
                    "phase": "character_creation",
                    "step": 5
                }

        elif step == 6:
            # 三视图生成完成
            # 检查是否还有角色的三视图需要生成
            chars_with_3view = [c for c in self.state.characters.values() if c.three_views]
            if len(chars_with_3view) < len(self.state.characters):
                return {
                    "response": "正在生成三视图，请稍等...",
                    "phase": "character_creation",
                    "step": 6
                }
            else:
                # 所有角色完成，进入场景创建
                self.state.set_phase("scene_creation", 0)
                char_list = "\n".join([f"- {c.name} ({self.prompts.format_character_type(c.character_type)})" for c in self.state.characters.values()])
                return {
                    "response": f"🎉 **所有角色创建完成！**\n\n{char_list}\n\n接下来我们进入场景创建阶段。\n\n" + self.prompts.get_prompt("START_SCENE"),
                    "phase": "scene_creation",
                    "step": 0
                }

        return {
            "response": "抱歉，出了点问题。",
            "phase": "character_creation",
            "step": step
        }

    def _handle_scene_creation(self, user_message: str) -> Dict[str, Any]:
        """处理场景创建阶段"""
        step = self.state.step

        if step == 0:
            # 确定场景数量
            count = self._extract_number(user_message, default=1)
            self.state.start_scene_creation(count)
            self.state.step = 1

            return {
                "response": self.prompts.get_prompt(
                    "SCENE_INFO_TEMPLATE",
                    index=1,
                    total=count
                ),
                "phase": "scene_creation",
                "step": 1
            }

        elif step == 1:
            # 收集场景信息
            scene_info = self._parse_scene_info(user_message)
            current_index = len(self.state.scenes) + 1
            scene_id = f"scene_{current_index:02d}_{scene_info.get('name', '未命名')}"

            draft = self.state.create_scene_draft(scene_id, scene_info.get('name', ''))
            self.state.update_scene(scene_id, **scene_info)

            self.state.step = 2

            return {
                "response": self.prompts.get_prompt(
                    "SCENE_INFO_CONFIRM",
                    name=scene_info.get('name', ''),
                    description=scene_info.get('description', ''),
                    scene_type=scene_info.get('scene_type', ''),
                    characters=", ".join(scene_info.get('characters', []))
                ),
                "phase": "scene_creation",
                "step": 2,
                "options": ["确认", "修改"]
            }

        elif step == 2:
            # 确认场景
            if self._is_confirm(user_message):
                current_scene = self.state.get_current_scene()
                if current_scene:
                    self.state.confirm_scene(current_scene.scene_id)

                # 检查是否还有场景需要创建
                if len([s for s in self.state.scenes.values() if s.status == "confirmed"]) < self.state.scene_count:
                    self.state.step = 1
                    return {
                        "response": f"✅ 场景「{current_scene.name}」已确认！\n\n" + self.prompts.get_prompt(
                            "SCENE_INFO_TEMPLATE",
                            index=len(self.state.scenes) + 1,
                            total=self.state.scene_count
                        ),
                        "phase": "scene_creation",
                        "step": 1
                    }
                else:
                    # 所有场景创建完成，开始生成场景概念图
                    self.state.step = 3
                    scene_list = "\n".join([f"- {s.name}" for s in self.state.scenes.values()])
                    return {
                        "response": f"🎉 **所有场景信息已收集！**\n\n{scene_list}\n\n现在开始生成场景概念图，请稍等...",
                        "phase": "scene_creation",
                        "step": 3,
                        "action": {
                            "type": "generate_scene_concepts",
                            "scenes": list(self.state.scenes.keys())
                        }
                    }
            else:
                self.state.step = 1
                return {
                    "response": "好的，请重新描述场景信息：",
                    "phase": "scene_creation",
                    "step": 1
                }

        elif step == 3:
            # 等待场景概念图生成
            return {
                "response": "正在生成场景概念图，请稍等...",
                "phase": "scene_creation",
                "step": 3
            }

        elif step == 4:
            # 场景概念图生成完成，自动询问是否放大
            return {
                "response": self.prompts.get_prompt("SCENE_CONCEPT_GENERATED", scene_name="场景图") + self.prompts.get_prompt("SCENE_UPSAMPLE_PROMPT"),
                "phase": "scene_creation",
                "step": 4,
                "options": ["放大（裁剪）", "跳过"]
            }

        elif step == 5:
            # 处理放大选择
            if "放大" in user_message or "1" in user_message:
                self.state.step = 6
                return {
                    "response": self.prompts.get_prompt("SCENE_UPSAMPLE_REGION_PROMPT"),
                    "phase": "scene_creation",
                    "step": 6
                }
            else:
                # 跳过放大，进入分镜生成
                return self._start_storyboard_generation()

        elif step == 6:
            # 执行放大
            crop_region = self._parse_crop_region(user_message)
            self.state.step = 7
            return {
                "response": "正在使用裁剪工具放大场景图...",
                "phase": "scene_creation",
                "step": 7,
                "action": {
                    "type": "upsample_scene_crop",
                    "crop_region": crop_region
                }
            }

        elif step == 7:
            # 放大完成，进入分镜生成
            return self._start_storyboard_generation()

        return {
            "response": "抱歉，出了点问题。",
            "phase": "scene_creation",
            "step": step
        }

    def _parse_crop_region(self, message: str) -> str:
        """解析裁剪区域描述"""
        message = message.lower().strip()
        if "左上" in message:
            return "top_left"
        elif "右上" in message:
            return "top_right"
        elif "左下" in message:
            return "bottom_left"
        elif "右下" in message:
            return "bottom_right"
        elif "中心" in message or "默认" in message or not message:
            return "center"
        else:
            return "center"

    def _start_storyboard_generation(self) -> Dict[str, Any]:
        """开始分镜生成阶段"""
        self.state.set_phase("storyboard_generation", 0)
        scene_list = "\n".join([f"- {s.name}" for s in self.state.scenes.values()])
        return {
            "response": f"🎉 **所有场景创建完成！**\n\n{scene_list}\n\n接下来我们进入分镜生成阶段。\n\n" + self.prompts.get_prompt(
                "START_STORYBOARD",
                scene_name=list(self.state.scenes.keys())[0] if self.state.scenes else "",
                characters=", ".join(self.state.characters.keys()),
                style=self.state.project_style
            ),
            "phase": "storyboard_generation",
            "step": 0,
            "options": ["确认", "取消"]
        }

    def _handle_storyboard_generation(self, user_message: str) -> Dict[str, Any]:
        """处理分镜生成阶段"""
        step = self.state.step

        if step == 0:
            # 确认开始生成
            if self._is_confirm(user_message):
                self.state.step = 1
                return {
                    "response": "正在生成3x3九宫格分镜，请稍等...",
                    "phase": "storyboard_generation",
                    "step": 1,
                    "action": {
                        "type": "generate_storyboard_grid"
                    }
                }
            else:
                return {
                    "response": "好的，你想修改什么？",
                    "phase": "storyboard_generation",
                    "step": 0
                }

        elif step == 1:
            # 等待九宫格生成
            return {
                "response": "正在生成九宫格分镜，请稍等...",
                "phase": "storyboard_generation",
                "step": 1
            }

        elif step == 2:
            # 九宫格生成完成，询问是否需要独立分镜
            if "独立分镜" in user_message or "1" in user_message:
                self.state.step = 3
                return {
                    "response": "正在生成9张独立分镜图...",
                    "phase": "storyboard_generation",
                    "step": 3,
                    "action": {
                        "type": "generate_shots"
                    }
                }
            else:
                # 跳过独立分镜，直接进入审查阶段
                self.state.set_phase("review", 0)
                return {
                    "response": "✅ **九宫格分镜生成完成！**\n\n接下来我们进入最终审查阶段。\n\n" + self.prompts.get_prompt("START_REVIEW"),
                    "phase": "review",
                    "step": 0,
                    "options": ["查看所有分镜", "直接确认", "重新生成"]
                }

        elif step == 3:
            # 独立分镜生成完成
            self.state.set_phase("review", 0)
            return {
                "response": "✅ **分镜生成完成！**\n\n接下来我们进入最终审查阶段。\n\n" + self.prompts.get_prompt("START_REVIEW"),
                "phase": "review",
                "step": 0,
                "options": ["查看所有分镜", "直接确认", "重新生成"]
            }

        return {
            "response": "抱歉，出了点问题。",
            "phase": "storyboard_generation",
            "step": step
        }

    def _handle_review(self, user_message: str) -> Dict[str, Any]:
        """处理审查阶段"""
        step = self.state.step

        if step == 0:
            if "查看" in user_message or "1" in user_message:
                self.state.step = 1
                return {
                    "response": "好的，我会逐张展示分镜。\n\n这是第 1/9 张：",
                    "phase": "review",
                    "step": 1,
                    "action": {
                        "type": "show_shot",
                        "index": 1
                    }
                }
            elif "确认" in user_message or "2" in user_message:
                # 直接确认，进入视频提示词阶段
                self.state.set_phase("video_prompt", 0)
                return {
                    "response": "✅ 分镜审查完成！\n\n" + self.prompts.get_prompt("START_VIDEO_PROMPT"),
                    "phase": "video_prompt",
                    "step": 0,
                    "options": ["生成视频提示词", "跳过"]
                }
            elif "重新生成" in user_message or "3" in user_message:
                return {
                    "response": "请告诉我要重新生成哪张分镜（1-9）：",
                    "phase": "review",
                    "step": 2
                }

        elif step == 1:
            # 审查单张分镜
            if "满意" in user_message or self._is_confirm(user_message):
                # 继续下一张或完成
                current_shot = self.state.step
                if current_shot < 9:
                    self.state.step = current_shot + 1
                    return {
                        "response": f"✅ 第 {current_shot} 张满意！\n\n这是第 {current_shot + 1}/9 张：",
                        "phase": "review",
                        "step": current_shot + 1,
                        "action": {
                            "type": "show_shot",
                            "index": current_shot + 1
                        }
                    }
                else:
                    # 所有分镜审查完成，进入视频提示词阶段
                    self.state.set_phase("video_prompt", 0)
                    return {
                        "response": "✅ 所有分镜已审查完成！\n\n" + self.prompts.get_prompt("START_VIDEO_PROMPT"),
                        "phase": "video_prompt",
                        "step": 0,
                        "options": ["生成视频提示词", "跳过"]
                    }
            elif "重新生成" in user_message:
                return {
                    "response": "正在重新生成...",
                    "phase": "review",
                    "step": step,
                    "action": {
                        "type": "regenerate_shot",
                        "index": step
                    }
                }

        elif step == 2:
            # 选择要重新生成的分镜
            shot_num = self._extract_number(user_message)
            if shot_num and 1 <= shot_num <= 9:
                return {
                    "response": f"正在重新生成第 {shot_num} 张分镜...",
                    "phase": "review",
                    "step": 1,
                    "action": {
                        "type": "regenerate_shot",
                        "index": shot_num
                    }
                }

        return {
            "response": "抱歉，出了点问题。",
            "phase": "review",
            "step": step
        }

    def _handle_video_prompt(self, user_message: str) -> Dict[str, Any]:
        """处理视频提示词生成阶段"""
        step = self.state.step

        if step == 0:
            # 询问是否生成
            if "生成" in user_message or "1" in user_message:
                self.state.step = 1

                # 获取当前场景
                scene_name = list(self.state.scenes.keys())[0] if self.state.scenes else ""
                characters = ", ".join(self.state.characters.keys())

                return {
                    "response": self.prompts.get_prompt(
                        "VIDEO_PROMPT_GENERATING",
                        scene_name=scene_name,
                        characters=characters
                    ),
                    "phase": "video_prompt",
                    "step": 1,
                    "action": {
                        "type": "generate_video_prompts",
                        "scene_name": scene_name
                    }
                }
            else:
                # 跳过，直接完成
                return self._complete_project()

        elif step == 1:
            # 等待生成完成（由外部调用 notify_video_prompts_generated）
            return {
                "response": "正在生成视频提示词，请稍等...",
                "phase": "video_prompt",
                "step": 1
            }

        elif step == 2:
            # 生成完成，询问下一步
            if "查看" in user_message or "1" in user_message:
                # 展示第一段提示词
                return self._show_video_prompt(1)
            else:
                return self._complete_project()

        elif step >= 3:
            # 查看提示词（step 3-7 对应 1-5 段）
            segment_index = step - 2
            if ("下一个" in user_message or "继续" in user_message) and segment_index < 5:
                return self._show_video_prompt(segment_index + 1)
            else:
                return self._complete_project()

        return self._complete_project()

    def _show_video_prompt(self, segment_index: int) -> Dict[str, Any]:
        """展示单个视频提示词"""
        import glob

        # 获取场景名称
        scene_name = list(self.state.scenes.keys())[0] if self.state.scenes else ""
        safe_name = scene_name.replace("/", "_").replace(" ", "_")

        # 查找提示词文件
        prompt_dir = self.state.project_path / "scenes" / f"scene_{safe_name}" / "video_prompts"
        pattern = str(prompt_dir / f"segment_{segment_index:02d}_*.md")
        files = glob.glob(pattern)

        if files:
            from pathlib import Path
            content = Path(files[0]).read_text(encoding="utf-8")

            segment_names = {1: "开篇", 2: "发展", 3: "高潮", 4: "转折", 5: "结尾"}
            segment_name = segment_names.get(segment_index, f"段落{segment_index}")

            next_action = "下一个" if segment_index < 5 else "完成"

            self.state.step = segment_index + 2
            return {
                "response": f"## 📹 段落{segment_index}：{segment_name}\n\n{content}\n\n---\n\n下一步：**{next_action}**",
                "phase": "video_prompt",
                "step": segment_index + 2,
                "options": ["下一个", "完成"] if segment_index < 5 else ["完成"]
            }

        # 文件不存在，直接完成
        return self._complete_project()

    def notify_video_prompts_generated(self, scene_name: str, output_path: str) -> Dict[str, Any]:
        """通知视频提示词生成完成（供外部调用）"""
        self.state.step = 2

        return {
            "response": self.prompts.get_prompt(
                "VIDEO_PROMPT_GENERATED",
                output_path=output_path
            ),
            "phase": "video_prompt",
            "step": 2,
            "options": ["查看提示词", "继续"]
        }

    def _handle_unknown(self, user_message: str) -> Dict[str, Any]:
        """处理未知状态"""
        return {
            "response": self.prompts.get_prompt("UNKNOWN_INTENT"),
            "phase": "init",
            "step": 0
        }

    # ============================================================
    # 辅助方法
    # ============================================================

    def _recognize_intent(self, message: str) -> str:
        """识别用户意图"""
        message = message.lower().strip()

        for intent, patterns in self.intent_patterns.items():
            for pattern in patterns:
                if re.search(pattern, message):
                    return intent

        return "unknown"

    def _extract_style(self, message: str) -> Optional[str]:
        """提取风格"""
        message = message.lower().strip()

        if "古装" in message or "1" in message or "知否" in message or "清平乐" in message:
            return "costume_drama"
        elif "废土" in message or "2" in message or "赛博" in message:
            return "wasteland"
        elif "旅游" in message or "风光" in message or "3" in message:
            return "modern_travel"

        return None

    def _extract_number(self, message: str, default: int = 0) -> int:
        """提取数字"""
        import re
        numbers = re.findall(r'\d+', message)
        if numbers:
            return int(numbers[0])
        return default

    def _extract_character_type(self, message: str) -> str:
        """提取角色类型"""
        message = message.lower().strip()

        if "男主" in message or "1" in message:
            return "male_lead"
        elif "女主" in message or "2" in message:
            return "female_lead"
        elif "配角" in message or "3" in message:
            return "supporting"

        return "male_lead"  # 默认

    def _extract_selection(self, message: str) -> Optional[str]:
        """提取选择（U1-U4）"""
        import re
        match = re.search(r'U([1-4])', message.upper())
        if match:
            return f"U{match.group(1)}"
        return None

    def _is_confirm(self, message: str) -> bool:
        """判断是否为确认"""
        message = message.lower().strip()
        return any(word in message for word in ["确认", "是", "对", "ok", "好的", "没问题", "yes", "y"])

    def _parse_character_info(self, message: str) -> Dict[str, Any]:
        """解析角色信息"""
        # 简单的解析逻辑，实际可以使用更复杂的 NLP
        info = {
            "name": "",
            "archetype": "",
            "age_range": "",
            "temperament": [],
            "appearance": "",
            "special_marks": ""
        }

        # 尝试提取名字（通常在开头）
        lines = message.strip().split('\n')
        if lines:
            first_line = lines[0].strip()
            # 移除常见的引导词
            for prefix in ["名字：", "姓名：", "角色名：", "叫", "是"]:
                if first_line.startswith(prefix):
                    first_line = first_line[len(prefix):].strip()
            if len(first_line) < 10:  # 假设名字比较短
                info["name"] = first_line

        # 如果没有解析到名字，使用默认
        if not info["name"]:
            info["name"] = "未命名角色"

        # 存储原始描述，供后续使用
        info["raw_description"] = message

        return info

    def _parse_scene_info(self, message: str) -> Dict[str, Any]:
        """解析场景信息"""
        info = {
            "name": "",
            "description": "",
            "scene_type": "indoor_daytime",
            "characters": []
        }

        # 简单的解析逻辑
        lines = message.strip().split('\n')
        if lines:
            info["name"] = lines[0].strip() if lines else "未命名场景"
            info["description"] = "\n".join(lines[1:]) if len(lines) > 1 else ""

        # 检测场景类型
        message_lower = message.lower()
        if "夜晚" in message_lower or "夜间" in message_lower:
            if "室内" in message_lower:
                info["scene_type"] = "indoor_nighttime"
            else:
                info["scene_type"] = "outdoor_nighttime"
        else:
            if "室外" in message_lower or "户外" in message_lower:
                info["scene_type"] = "outdoor_daytime"
            else:
                info["scene_type"] = "indoor_daytime"

        # 提取角色名
        for char_name in self.state.characters.keys():
            if char_name in message:
                info["characters"].append(char_name)

        return info

    def _create_project(self) -> Path:
        """创建项目"""
        from systems.config import ProjectManager

        pm = ProjectManager()
        project_path = pm.create_project(
            name=self.state.project_name,
            location=Path(self.state.project_location) if self.state.project_location else None,
            style=self.state.project_style
        )

        self.state.project_path = project_path
        self.state.save()

        return project_path

    def _list_projects(self) -> Dict[str, Any]:
        """列出项目"""
        from systems.config import ProjectManager

        pm = ProjectManager()
        projects = pm.list_projects()

        if not projects:
            return {
                "response": "📭 没有找到任何项目。\n\n你想创建一个新项目吗？",
                "phase": "init",
                "step": 0
            }

        project_list = "\n".join([
            f"{i+1}. **{p.name}** ({p.style}) - {p.created_at[:10]}"
            for i, p in enumerate(projects)
        ])

        return {
            "response": self.prompts.get_prompt("PROJECT_LIST", project_list=project_list),
            "phase": "init",
            "step": 0
        }

    def _list_projects_for_selection(self) -> Dict[str, Any]:
        """列出项目供选择"""
        from systems.config import ProjectManager

        pm = ProjectManager()
        projects = pm.list_projects()

        if not projects:
            return {
                "response": "📭 没有找到任何项目。让我们创建一个新项目吧！\n\n" + self.prompts.get_prompt("STYLE_OPTIONS"),
                "phase": "project_setup",
                "step": 0
            }

        project_list = "\n".join([
            f"{i+1}. **{p.name}** ({p.style})"
            for i, p in enumerate(projects)
        ])

        return {
            "response": f"📋 **你的项目**：\n\n{project_list}\n\n请输入项目编号或名称：",
            "phase": "init",
            "step": 0,
            "options": [p.name for p in projects]
        }

    def _complete_project(self) -> Dict[str, Any]:
        """完成项目"""
        char_list = "\n".join([f"- {c.name}" for c in self.state.characters.values()])
        scene_list = "\n".join([f"- {s.name}" for s in self.state.scenes.values()])

        summary = f"""
📊 **项目摘要**

📁 项目名称：{self.state.project_name}
🎨 风格：{self.state.project_style}

👤 角色：
{char_list}

🎬 场景：
{scene_list}

✅ 分镜：9 张已生成
"""

        return {
            "response": self.prompts.get_prompt(
                "ALL_REVIEWED",
                summary=summary,
                project_path=str(self.state.project_path)
            ),
            "phase": "completed",
            "step": 0,
            "action": {
                "type": "project_completed"
            }
        }

    # ============================================================
    # 外部调用的方法
    # ============================================================

    def notify_makeup_generated(self, character_name: str, image_paths: List[str]) -> Dict[str, Any]:
        """通知定妆照生成完成"""
        self.state.step = 5

        image_list = "\n".join([f"- {path}" for path in image_paths])

        return {
            "response": self.prompts.get_prompt(
                "MAKEUP_GENERATED",
                count=len(image_paths),
                image_list=image_list
            ),
            "phase": "character_creation",
            "step": 5,
            "options": ["U1", "U2", "U3", "U4"]
        }

    def notify_threeview_generated(self, character_name: str, threeview_path: str) -> Dict[str, Any]:
        """通知三视图生成完成"""
        # 更新角色的三视图
        if character_name in self.state.characters:
            self.state.characters[character_name].three_views["默认"] = threeview_path

        # 检查是否所有角色都完成了
        chars_with_3view = [c for c in self.state.characters.values() if c.three_views]

        if len(chars_with_3view) < len(self.state.characters):
            # 还有角色需要生成
            return {
                "response": f"✅ 角色「{character_name}」的三视图已生成！\n\n正在生成下一个角色的定妆照...",
                "phase": "character_creation",
                "step": 4
            }
        else:
            # 所有角色完成
            self.state.set_phase("scene_creation", 0)
            char_list = "\n".join([f"- {c.name}" for c in self.state.characters.values()])
            return {
                "response": f"🎉 **所有角色创建完成！**\n\n{char_list}\n\n接下来我们进入场景创建阶段。\n\n" + self.prompts.get_prompt("START_SCENE"),
                "phase": "scene_creation",
                "step": 0
            }

    def notify_scene_concept_generated(self, scene_name: str, image_path: str) -> Dict[str, Any]:
        """通知场景概念图生成完成"""
        self.state.step = 4

        return {
            "response": self.prompts.get_prompt("SCENE_CONCEPT_GENERATED", scene_name=scene_name) + f"\n📷 图片路径：{image_path}\n" + self.prompts.get_prompt("SCENE_UPSAMPLE_PROMPT"),
            "phase": "scene_creation",
            "step": 4,
            "options": ["放大（裁剪）", "跳过"]
        }

    def notify_scene_upsampled(self, output_path: str) -> Dict[str, Any]:
        """通知场景图放大完成"""
        self.state.step = 7

        return {
            "response": self.prompts.get_prompt("SCENE_UPSAMPLE_DONE", output_path=output_path),
            "phase": "scene_creation",
            "step": 7,
            "action": {
                "type": "upsample_complete",
                "output_path": output_path
            }
        }

    def notify_wide_shot_generated(self, image_path: str) -> Dict[str, Any]:
        """通知全景分镜生成完成"""
        self.state.step = 2

        return {
            "response": f"✅ **全景分镜已生成！**\n\n{image_path}\n\n" + self.prompts.get_prompt("STORYBOARD_GRID_PROMPT"),
            "phase": "storyboard_generation",
            "step": 2,
            "options": ["生成九宫格", "直接生成独立分镜"]
        }

    def notify_storyboard_grid_generated(self, image_path: str) -> Dict[str, Any]:
        """通知九宫格分镜生成完成"""
        self.state.step = 2

        return {
            "response": f"✅ **九宫格分镜已生成！**\n\n{image_path}\n\n" +
                       "接下来你想要：\n" +
                       "1. 生成9张独立分镜图（可选）\n" +
                       "2. 直接进入审查阶段",
            "phase": "storyboard_generation",
            "step": 2,
            "options": ["生成独立分镜", "直接审查"]
        }

    def notify_shots_generated(self, shot_paths: List[str]) -> Dict[str, Any]:
        """通知独立分镜生成完成"""
        self.state.set_phase("review", 0)

        shot_list = "\n".join([f"- {path}" for path in shot_paths])

        return {
            "response": self.prompts.get_prompt(
                "STORYBOARD_SHOTS_GENERATED",
                shot_list=shot_list
            ) + self.prompts.get_prompt("START_REVIEW"),
            "phase": "review",
            "step": 0,
            "options": ["查看所有分镜", "直接确认", "重新生成"]
        }
