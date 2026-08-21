"""
分镜生成系统
====================================================
生成场景的分镜图。

工作流程（简化版）：
1. localize_scene - 场景实景化转制
2. [交互确认] 用户确认实景化效果
3. generate_storyboard_grid - 直接生成九宫格分镜
4. [交互确认] 用户确认九宫格效果
5. generate_individual_shots - 生成9张独立分镜

核心功能：
- localize_scene - 场景实景化转制
- generate_storyboard_grid - 直接生成九宫格分镜（一步到位）
- generate_individual_shots - 生成9张独立分镜

用法：
    from systems.storyboard import StoryboardGenerator

    generator = StoryboardGenerator(project_path)

    # Step 1: 场景实景化转制
    result = generator.localize_scene(scene_name, scene_concept_path)
    # → 等待用户确认

    # Step 2: 生成九宫格分镜
    result = generator.generate_storyboard_grid(
        scene_name, scene_localized_path, character_refs, shot_descriptions
    )
    # → 等待用户确认

    # Step 3: 生成9张独立分镜
    results = generator.generate_individual_shots(storyboard_grid_path)
"""

from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
import os
import base64
import requests
import yaml  # 新增：用于读取preset.yaml

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from utils.dmxapi_client import DMXAPIClient
from utils.image_client import ImageGenerationClient
from systems.memory.work_logger import WorkLogger
from systems.config.project_manager import ProjectConfig
from systems.lighting.generator import get_lighting_prompt, get_lighting_keywords
from systems.performance.generator import get_3d_performance_prompt, get_emotion_performance_keywords
from systems.character.character_config import CharacterConfig


@dataclass
class ShotDescription:
    """分镜描述"""
    shot_number: int
    shot_type: str  # 特写/近景/中景/全景/远景
    camera_angle: str  # 平拍/俯拍/仰拍
    description: str  # 分镜内容描述


@dataclass
class StoryboardResult:
    """分镜生成结果"""
    success: bool
    image_path: Path = None
    image_url: str = ""
    message: str = ""
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


class StoryboardGenerator:
    """分镜生成器"""

    # 文件夹结构常量
    SCENE_SUBDIRS = {
        'concept': 'concept',           # 概念图
        'localized': 'localized',       # 实景化场景
        'storyboard': 'storyboard',     # 分镜
        'shots': 'storyboard/shots',    # 独立分镜
        'references': 'references',     # 参考资料
    }

    # 文件名常量
    FILENAMES = {
        'concept': 'scene_concept.jpg',
        'localized': 'scene_localized.jpg',
        'storyboard_grid': 'grid.jpg',
        'storyboard_script': 'script.json',
        'biography': 'biography.md',
        'metadata': 'metadata.json',
        'three_view': 'three_view.jpg',
    }

    def __init__(
        self,
        project_path: Path = None,
        work_logger: WorkLogger = None,
        project_config: ProjectConfig = None
    ):
        self.project_path = Path(project_path) if project_path else None
        self.work_logger = work_logger
        self.project_config = project_config
        self.api_client = DMXAPIClient()
        self.image_client = ImageGenerationClient()  # 新增：统一生图客户端
        self.skill_path = Path(__file__).parent.parent.parent  # 新增：skill根目录路径

    def _load_style_preset(self, style: str) -> Dict:
        """
        加载风格配置文件

        Args:
            style: 风格名称（如 modern_travel, costume_drama, wasteland）

        Returns:
            风格配置字典，如果不存在则返回空字典
        """
        # 目前只实现modern_travel的加载
        if style == "modern_travel":
            preset_path = self.skill_path / "database/styles/modern_travel/preset.yaml"
            if preset_path.exists():
                try:
                    with open(preset_path, 'r', encoding='utf-8') as f:
                        preset = yaml.safe_load(f)
                        print(f"[OK] 已加载modern_travel风格配置: {preset_path}")
                        return preset
                except Exception as e:
                    print(f"[WARNING] 加载modern_travel配置失败: {e}")
                    return {}
        return {}

    def set_project(self, project_path: Path):
        """设置项目路径"""
        self.project_path = Path(project_path)

    def get_scene_dir(self, scene_name: str) -> Path:
        """获取场景根目录"""
        safe_name = scene_name.replace("/", "_").replace(" ", "_")
        return self.project_path / "scenes" / f"scene_{safe_name}"

    def get_scene_subdir(self, scene_name: str, subdir_type: str) -> Path:
        """获取场景子目录"""
        scene_dir = self.get_scene_dir(scene_name)
        subdir = self.SCENE_SUBDIRS.get(subdir_type, subdir_type)
        return scene_dir / subdir

    def init_scene_structure(self, scene_name: str) -> Path:
        """
        初始化场景文件夹结构

        Args:
            scene_name: 场景名称

        Returns:
            场景根目录路径
        """
        scene_dir = self.get_scene_dir(scene_name)
        scene_dir.mkdir(parents=True, exist_ok=True)

        # 创建子目录
        for subdir in self.SCENE_SUBDIRS.values():
            (scene_dir / subdir).mkdir(parents=True, exist_ok=True)

        return scene_dir

    # === 路径获取方法 ===

    def get_concept_path(self, scene_name: str) -> Path:
        """获取概念图路径"""
        return self.get_scene_subdir(scene_name, 'concept') / self.FILENAMES['concept']

    def get_localized_path(self, scene_name: str) -> Path:
        """获取实景化场景路径"""
        return self.get_scene_subdir(scene_name, 'localized') / self.FILENAMES['localized']

    def get_storyboard_grid_path(self, scene_name: str) -> Path:
        """获取九宫格分镜路径"""
        return self.get_scene_subdir(scene_name, 'storyboard') / self.FILENAMES['storyboard_grid']

    def get_storyboard_script_path(self, scene_name: str) -> Path:
        """获取分镜脚本路径"""
        return self.get_scene_subdir(scene_name, 'storyboard') / self.FILENAMES['storyboard_script']

    def get_shot_path(self, scene_name: str, shot_number: int) -> Path:
        """获取独立分镜路径"""
        return self.get_scene_subdir(scene_name, 'shots') / f"shot_{shot_number}.jpg"

    def get_biography_path(self, scene_name: str) -> Path:
        """获取场景小传路径"""
        return self.get_scene_dir(scene_name) / self.FILENAMES['biography']

    def get_metadata_path(self, scene_name: str) -> Path:
        """获取元数据路径"""
        return self.get_scene_dir(scene_name) / self.FILENAMES['metadata']

    def set_logger(self, work_logger: WorkLogger):
        """设置工作日志"""
        self.work_logger = work_logger

    def load_character_biography(self, character_name: str) -> Optional[str]:
        """
        加载角色小传卡

        Args:
            character_name: 角色名称

        Returns:
            小传卡内容，如果不存在则返回 None
        """
        if not self.project_path:
            return None

        bio_path = self.project_path / "characters" / f"{character_name}_biography.md"
        if bio_path.exists():
            return bio_path.read_text(encoding="utf-8")
        return None

    def load_scene_biography(self, scene_name: str) -> Optional[str]:
        """
        加载场景小传卡（新路径优先，兼容旧路径）

        Args:
            scene_name: 场景名称

        Returns:
            小传卡内容，如果不存在则返回 None
        """
        if not self.project_path:
            return None

        # 新路径
        bio_path = self.get_biography_path(scene_name)
        if bio_path.exists():
            return bio_path.read_text(encoding="utf-8")

        # 兼容旧路径
        safe_name = scene_name.replace("/", "_").replace(" ", "_")
        old_bio_path = self.project_path / "scenes" / f"scene_{safe_name}" / "scene_biography.md"
        if old_bio_path.exists():
            return old_bio_path.read_text(encoding="utf-8")

        return None

    def load_character_config(self, character_name: str) -> Optional[CharacterConfig]:
        """
        加载角色详细配置

        Args:
            character_name: 角色名称

        Returns:
            CharacterConfig 对象，如果不存在则返回 None
        """
        if not self.project_path:
            return None

        config_path = self.project_path / "characters" / f"{character_name}_config.json"
        if config_path.exists():
            import json
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return CharacterConfig.from_dict(data)
        return None

    def load_storyboard_script(self, scene_name: str) -> Optional[Dict[str, Any]]:
        """
        加载分镜脚本（新路径优先，兼容旧路径）

        Args:
            scene_name: 场景名称

        Returns:
            分镜脚本字典，如果不存在则返回 None
        """
        if not self.project_path:
            return None

        # 新路径
        script_path = self.get_storyboard_script_path(scene_name)
        if script_path.exists():
            import json
            with open(script_path, 'r', encoding='utf-8') as f:
                return json.load(f)

        # 兼容旧路径
        safe_name = scene_name.replace("/", "_").replace(" ", "_")
        old_script_path = self.project_path / "scenes" / f"scene_{safe_name}" / "storyboard_script.json"
        if old_script_path.exists():
            import json
            with open(old_script_path, 'r', encoding='utf-8') as f:
                return json.load(f)

        return None

    def parse_script_to_shot_descriptions(self, script: Dict[str, Any]) -> List[ShotDescription]:
        """
        将分镜脚本转换为 ShotDescription 列表

        Args:
            script: 分镜脚本字典

        Returns:
            ShotDescription 列表
        """
        shots = []
        for shot_data in script.get("shots", []):
            shot = ShotDescription(
                shot_number=shot_data.get("shot_number", 0),
                shot_type=shot_data.get("shot_type", "中景"),
                camera_angle=shot_data.get("camera_angle", "平拍"),
                description=shot_data.get("description", "")
            )
            shots.append(shot)
        return shots

    def get_character_emotions_from_script(self, script: Dict[str, Any]) -> Dict[str, str]:
        """
        从分镜脚本中提取角色情绪映射

        Args:
            script: 分镜脚本字典

        Returns:
            角色情绪映射字典
        """
        emotions = {}
        for shot_data in script.get("shots", []):
            shot_emotions = shot_data.get("emotion", {})
            for char_name, emotion in shot_emotions.items():
                # 如果角色已有情绪，保留第一个（通常是最重要的）
                if char_name not in emotions:
                    emotions[char_name] = emotion
        return emotions

    def extract_visual_summary(self, biography: str) -> str:
        """
        从角色小传中提取视觉特征摘要（150-200字）

        只提取与视觉生成相关的核心信息：
        - 面部特征
        - 发型
        - 标志性特征
        - 服装风格
        - 气质通感

        Args:
            biography: 完整的角色小传文本

        Returns:
            视觉特征摘要（150-200字）
        """
        if not biography:
            return ""

        # 提取关键章节
        sections = {}
        current_section = ""
        current_content = []

        for line in biography.split('\n'):
            # 识别章节标题
            if line.startswith('## ') or line.startswith('### '):
                if current_section:
                    sections[current_section] = '\n'.join(current_content)
                current_section = line.replace('#', '').strip()
                current_content = []
            else:
                current_content.append(line)

        if current_section:
            sections[current_section] = '\n'.join(current_content)

        # 提取视觉相关部分
        visual_parts = []

        # 1. 面部特征（核心识别点）
        if "外貌特征" in sections:
            content = sections["外貌特征"]
            # 提取核心识别点部分
            if "核心识别点" in content:
                start = content.find("核心识别点")
                end = content.find("###", start + 1) if "###" in content[start+1:] else len(content)
                visual_parts.append(f"面部:{content[start:end][:100].replace('**', '').replace('- ', '').strip()}")

        # 2. 发型
        if "造型配置" in sections:
            content = sections["造型配置"]
            if "发型" in content:
                lines = content.split('\n')
                hair_lines = []
                in_hair = False
                for line in lines:
                    if "发型" in line:
                        in_hair = True
                    elif line.startswith("###") or line.startswith("##"):
                        in_hair = False
                    elif in_hair and line.strip():
                        hair_lines.append(line.strip())
                if hair_lines:
                    visual_parts.append(f"发型:{' '.join(hair_lines[:2])}")

        # 3. 服装
        if "造型配置" in sections:
            content = sections["造型配置"]
            if "服装" in content:
                lines = content.split('\n')
                costume_lines = []
                in_costume = False
                for line in lines:
                    if "服装" in line:
                        in_costume = True
                    elif line.startswith("###") or line.startswith("##"):
                        in_costume = False
                    elif in_costume and line.strip() and "日常" in line:
                        costume_lines.append(line.strip())
                if costume_lines:
                    visual_parts.append(f"服装:{costume_lines[0][:50]}")

        # 4. 标志性特征
        if "特殊标记" in sections:
            content = sections["特殊标记"]
            # 提取前两个标记
            marks = []
            for line in content.split('\n'):
                if line.strip().startswith(('1.', '2.', '-', '*')):
                    marks.append(line.strip().lstrip('123456789.-* ').strip())
            if marks:
                visual_parts.append(f"标志:{' '.join(marks[:2])}")

        # 5. 气质通感
        if "外貌特征" in sections:
            content = sections["外貌特征"]
            if "气质通感" in content:
                start = content.find("气质通感")
                end = content.find("\n\n", start) if "\n\n" in content[start:] else len(content)
                temperament = content[start:end].replace("气质通感", "").replace(":", "").strip()[:60]
                if temperament:
                    visual_parts.append(f"气质:{temperament}")

        return " | ".join(visual_parts[:4])  # 最多4个关键点

    def extract_scene_visual_summary(self, biography: str) -> str:
        """
        从场景小传中提取视觉特征摘要（100字以内）

        Args:
            biography: 完整的场景小传文本

        Returns:
            场景视觉摘要
        """
        if not biography:
            return ""

        # 提取关键章节
        sections = {}
        current_section = ""
        current_content = []

        for line in biography.split('\n'):
            if line.startswith('## '):
                if current_section:
                    sections[current_section] = '\n'.join(current_content)
                current_section = line.replace('#', '').strip()
                current_content = []
            else:
                current_content.append(line)

        if current_section:
            sections[current_section] = '\n'.join(current_content)

        # 提取视觉相关部分
        parts = []

        # 场景描述
        if "场景描述" in sections:
            desc = sections["场景描述"][:80].replace('\n', ' ').strip()
            parts.append(desc)

        # 视觉风格
        if "视觉风格参考" in sections:
            style = sections["视觉风格参考"][:50].replace('\n', ' ').strip()
            parts.append(style)

        # 氛围关键词
        if "氛围关键词" in sections:
            keywords = sections["氛围关键词"][:40].replace('\n', ', ').strip()
            parts.append(f"氛围:{keywords}")

        return " | ".join(parts[:2])

    def _build_shot_prompt(self, shot_data: Dict[str, Any]) -> str:
        """
        构建单个分镜的精简提示词（50-70字）

        Args:
            shot_data: 分镜数据字典

        Returns:
            精简的分镜提示词
        """
        parts = [f"分镜{shot_data.get('shot_number', 0)}"]

        # 景别和角度
        if shot_data.get('shot_type'):
            parts.append(f"[景别]{shot_data['shot_type']}")
        if shot_data.get('camera_angle'):
            parts.append(f"[角度]{shot_data['camera_angle']}")

        # 主体
        if shot_data.get('subject'):
            parts.append(f"[主体]{shot_data['subject']}")
        elif shot_data.get('characters'):
            chars = shot_data['characters']
            if isinstance(chars, list) and chars:
                parts.append(f"[主体]{','.join(chars[:2])}")

        # 动作（精简）
        if shot_data.get('action'):
            action = shot_data['action'][:15]  # 限制长度
            parts.append(f"[动作]{action}")

        # 表情（精简）
        if shot_data.get('expression'):
            parts.append(f"[表情]{shot_data['expression']}")

        # 服装（优先使用 character_costumes，其次 costume_note）
        character_costumes = shot_data.get('character_costumes', {})
        if character_costumes:
            # 格式: 沈青辞(日常常服),苏景澜(会客礼服)
            costume_str = ",".join([f"{char}({costume})" for char, costume in character_costumes.items()])
            parts.append(f"[服装]{costume_str}")
        elif shot_data.get('costume_note'):
            parts.append(f"[服装]{shot_data['costume_note']}")

        # 光线备注
        if shot_data.get('lighting_note'):
            parts.append(f"[光线]{shot_data['lighting_note']}")

        # 面部质量锚点
        face_quality = shot_data.get('face_quality', '清晰五官，无变形')
        parts.append(f"[面部]{face_quality}")

        return "|".join(parts)

    def get_character_costume_refs(
        self,
        character_name: str,
        costume_name: str
    ) -> Optional[Path]:
        """
        获取角色指定服装的三视图路径

        Args:
            character_name: 角色名称
            costume_name: 服装名称（如 "日常常服", "会客礼服"）

        Returns:
            三视图路径，如果不存在则返回 None
        """
        if not self.project_path:
            return None

        # 尝试多种命名格式
        possible_names = [
            f"{character_name}_{costume_name}_三视图.jpg",
            f"{character_name}_{costume_name}.jpg",
            f"{character_name}_三视图.jpg"  # 默认三视图
        ]

        for name in possible_names:
            path = self.project_path / "characters" / "三视图" / name
            if path.exists():
                return path

        return None

    def localize_scene(
        self,
        scene_name: str,
        scene_concept_path: Path,
        style: str = "costume_drama"
    ) -> StoryboardResult:
        """
        场景实景化转制（独立步骤，只转制场景，无人物、无剧情）

        将场景概念图转制为实景化场景图：
        - 牌匾、楹联等文字转为清晰的中文
        - 保留概念图的布局和光影氛围
        - 不包含任何人物

        Args:
            scene_name: 场景名称（用于牌匾文字）
            scene_concept_path: 场景概念图路径
            style: 视觉风格

        Returns:
            StoryboardResult
        """
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        scene_concept_path = Path(scene_concept_path)
        if not scene_concept_path.exists():
            raise ValueError(f"场景概念图不存在: {scene_concept_path}")

        # 初始化场景文件夹结构
        self.init_scene_structure(scene_name)

        # 使用新路径
        output_path = self.get_localized_path(scene_name)

        # 记录开始
        if self.work_logger:
            self.work_logger.log_step(
                "localize_scene",
                f"场景「{scene_name}」实景化转制",
                {"scene_concept": str(scene_concept_path)}
            )

        print(f"\n🎬 正在转制场景「{scene_name}」为实景...")

        # 读取场景概念图
        with open(scene_concept_path, 'rb') as f:
            scene_b64 = base64.b64encode(f.read()).decode()

        # 构建实景化转制提示词
        style_desc = {
            "costume_drama": "古装剧风格，写实摄影",
            "wasteland": "末世废土风格，赛博朋克质感"
        }.get(style, "写实摄影风格")

        # 简化版提示词
        prompt = f"""将这张古装剧场景概念图转换为电影级实景照片。

核心要求：
1. 参考概念图的场景氛围和布局
2. 将所有手绘材质替换为真实材质：
   - 木材：真实木纹，有磨损和使用痕迹
   - 石材：天然石纹理，有裂纹和水渍
   - 朱红漆门：真实大漆质感，有掉漆和氧化
3. 牌匾文字「{scene_name}」必须清晰可读，楷书字体，金漆效果
4. 光影：自然光，电影级质感
5. 禁止：人物、手绘风格、插画感、CG感

输出：16:9实景照片，8K画质，ARRI摄影机拍摄效果"""

        # 调用API生成
        content = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{scene_b64}"}}
        ]

        try:
            response = requests.post(
                os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {os.environ.get('DMXAPI_KEY')}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gemini-3.1-flash-image-preview",
                    "messages": [{"role": "user", "content": content}],
                    "max_tokens": 8192
                },
                timeout=180
            )

            if response.status_code == 200:
                result = response.json()
                if "choices" in result and len(result["choices"]) > 0:
                    img_content = result["choices"][0].get("message", {}).get("content", "")

                    if len(img_content) > 1000:
                        if "base64," in img_content:
                            b64_data = img_content.split("base64,")[1]
                        else:
                            b64_data = img_content

                        with open(output_path, "wb") as f:
                            f.write(base64.b64decode(b64_data))

                        print(f"✅ 实景化场景已生成！")

                        # 注册到项目配置
                        if self.project_config:
                            relative_path = str(output_path.relative_to(self.project_path))
                            existing = self.project_config.scenes.get(scene_name, {})
                            self.project_config.register_scene(scene_name, {
                                **existing,
                                "status": "localized",
                                "localized_path": relative_path
                            })

                            if self.work_logger:
                                self.work_logger.log_step(
                                    "register_scene",
                                    f"更新场景「{scene_name}」实景化路径",
                                    {"localized_path": relative_path}
                                )

                        if self.work_logger:
                            self.work_logger.log_decision(
                                f"场景「{scene_name}」实景化转制完成",
                                f"路径: {output_path}"
                            )

                        return StoryboardResult(
                            success=True,
                            image_path=output_path,
                            message="实景化场景已生成"
                        )

            return StoryboardResult(success=False, message="生成失败")

        except Exception as e:
            return StoryboardResult(success=False, message=str(e))

    def generate_storyboard_grid(
        self,
        scene_name: str,
        scene_localized_path: Path,
        character_refs: List[Path],
        shot_descriptions: List['ShotDescription'] = None,
        style: str = "costume_drama",
        scene_type: str = "indoor_daytime",
        mood: str = "normal",
        character_emotions: Dict[str, str] = None,
        load_biographies: bool = True,
        storyboard_mode: str = "landscape_focused"
    ) -> 'StoryboardResult':
        """
        从实景化场景生成九宫格分镜（集成光影和表演系统）

        工作流程：
        实景化场景 + 角色参考 + 光影系统 + 表演系统 + 小传卡 → 九宫格分镜

        Args:
            scene_name: 场景名称
            scene_localized_path: 实景化场景图路径
            character_refs: 角色参考图路径列表
            shot_descriptions: 分镜描述列表（可选）
            style: 视觉风格
            scene_type: 场景光影类型 (indoor_daytime, indoor_nighttime, etc.)
            mood: 情绪模式 (normal, warm, tense, solemn)
            character_emotions: 角色情绪映射，如 {"苏景澜": "confident", "沈青辞": "focused"}
            load_biographies: 是否自动加载小传卡
            storyboard_mode: 分镜模式（仅modern_travel风格有效）
                - "portrait_focused": 人像为主模式，1近景+1中景+远景
                - "landscape_focused": 风景人像混合模式，人物占比8%

        Returns:
            StoryboardResult
        """
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        character_emotions = character_emotions or {}

        # === 加载小传卡 ===
        character_biographies = {}
        scene_biography = ""
        character_visual_summaries = {}  # 新增：视觉特征摘要
        scene_visual_summary = ""  # 新增：场景视觉摘要

        if load_biographies:
            # 从角色参考图路径提取角色名称
            for char_ref in character_refs:
                char_name = Path(char_ref).stem
                # 尝试匹配角色名（可能包含场景后缀，如 "苏景澜_三视图"）
                for name_part in char_name.split("_"):
                    bio = self.load_character_biography(name_part)
                    if bio:
                        character_biographies[name_part] = bio
                        # 提取视觉特征摘要
                        character_visual_summaries[name_part] = self.extract_visual_summary(bio)
                        break

            # 加载场景小传
            scene_biography = self.load_scene_biography(scene_name) or ""
            if scene_biography:
                scene_visual_summary = self.extract_scene_visual_summary(scene_biography)

        scene_localized_path = Path(scene_localized_path)
        if not scene_localized_path.exists():
            raise ValueError(f"实景化场景不存在: {scene_localized_path}")

        # 确保场景结构存在
        self.init_scene_structure(scene_name)

        # 使用新路径
        output_path = self.get_storyboard_grid_path(scene_name)

        # 记录开始
        if self.work_logger:
            self.work_logger.log_step(
                "generate_storyboard_grid",
                f"生成场景「{scene_name}」九宫格分镜",
                {"scene_localized": str(scene_localized_path)}
            )

        print(f"\n🎬 正在生成场景「{scene_name}」九宫格分镜...")
        print(f"   场景类型: {scene_type}")
        print(f"   情绪模式: {mood}")
        if character_biographies:
            print(f"   已加载角色小传: {list(character_biographies.keys())}")
        if scene_biography:
            print(f"   已加载场景小传")

        # 读取实景化场景
        with open(scene_localized_path, 'rb') as f:
            scene_b64 = base64.b64encode(f.read()).decode()

        # 读取角色参考图
        char_b64_list = []
        for char_ref in character_refs:
            if Path(char_ref).exists():
                with open(char_ref, 'rb') as f:
                    char_b64_list.append((Path(char_ref).stem, base64.b64encode(f.read()).decode()))

        # === 加载风格配置（新增）===
        preset = self._load_style_preset(style)

        # === 光影系统 ===
        # 如果是modern_travel风格且preset中有光影配置，使用preset配置
        if style == "modern_travel" and preset:
            lighting_presets = preset.get('lighting_presets', {})
            # 根据scene_type选择预设
            if "golden" in scene_type or "sunset" in scene_type:
                preset_name = "golden_hour"
            elif "blue" in scene_type or "twilight" in scene_type:
                preset_name = "blue_hour"
            elif "overcast" in scene_type:
                preset_name = "overcast"
            else:
                preset_name = "daytime"

            lighting_config = lighting_presets.get(preset_name, {})
            keywords = lighting_config.get('keywords', [])
            lighting_keywords = ", ".join(keywords) if keywords else "natural lighting"
        else:
            # 其他风格使用原有的光影系统
            lighting_keywords = get_lighting_keywords(scene_type, mood)

        # === 表演系统 ===
        performance_parts = []
        if shot_descriptions:
            for shot in shot_descriptions:
                shot_type_en = {"特写": "closeup", "近景": "closeup", "中景": "medium", "全景": "wide", "大全景": "wide", "远景": "wide"}.get(shot.shot_type, "medium")
                for char_name, emotion in character_emotions.items():
                    identity = "文官" if "苏" in char_name or "沈" in char_name else "侍女"
                    perf_keywords = get_emotion_performance_keywords(emotion, identity, shot_type_en)
                    if perf_keywords:
                        performance_parts.append(f"分镜{shot.shot_number} {char_name}: {perf_keywords}")

        performance_text = "\n".join(performance_parts[:6]) if performance_parts else ""

        # === 构建精简分镜描述（优化版）===
        shot_list = ""
        if shot_descriptions:
            shot_lines = []
            for shot in shot_descriptions:
                # 使用精简格式：景别|角度|描述
                shot_lines.append(f"分镜{shot.shot_number}：{shot.shot_type}|{shot.camera_angle}|{shot.description[:50]}")
            shot_list = "\n".join(shot_lines)

        # 构建完整提示词
        style_desc = {
            "costume_drama": "宋代古装剧风格，写实摄影",
            "wasteland": "末世废土风格",
            "modern_travel": "现代旅游风光影视片风格，治愈诗意，自然光影"  # 新增modern_travel风格
        }.get(style, "古装剧风格")

        # === 构建角色视觉特征摘要（优化版）===
        character_visual_context = ""
        if character_visual_summaries:
            visual_parts = []
            for char_name, visual_summary in character_visual_summaries.items():
                if visual_summary:
                    visual_parts.append(f"【角色·{char_name}】\n{visual_summary}")
            character_visual_context = "\n\n".join(visual_parts)

        # === 构建场景视觉摘要（优化版）===
        scene_visual_context = ""
        if scene_visual_summary:
            scene_visual_context = f"【场景·{scene_name}】\n{scene_visual_summary}"

        # === 面部质量锚点 ===
        face_quality_text = """
【面部质量要求 - 极其重要】
- 五官清晰端正，无变形，无崩坏
- 眼睛有神，瞳孔清晰，不空洞
- 面部细节完整，轮廓清晰
- 多人场景中，每个角色的面部特征独立清晰
- 禁止：面部模糊、五官错位、眼睛空洞、表情僵硬"""

        # === 构建提示词（根据风格分支）===
        if style == "modern_travel" and preset:
            # 获取模式配置
            mode_config = preset.get('storyboard_modes', {}).get(storyboard_mode, {})
            if not mode_config:
                # 默认使用landscape_focused
                mode_config = preset.get('storyboard_modes', {}).get('landscape_focused', {})

            # 根据模式构建不同的提示词
            if storyboard_mode == "portrait_focused":
                prompt = self._build_portrait_focused_prompt(
                    preset, mode_config, lighting_keywords,
                    character_visual_context, scene_visual_context,
                    face_quality_text, shot_list
                )
            else:  # landscape_focused
                prompt = self._build_landscape_focused_prompt(
                    preset, mode_config, lighting_keywords,
                    character_visual_context, scene_visual_context,
                    face_quality_text, shot_list
                )
        else:
            # 古装剧/废土风格的提示词（原有逻辑）
            prompt = f"""你是一位专业的电影分镜师。请基于这张实景化场景图和角色参考图，绘制一张九宫格分镜图。

【核心风格要求 - 最重要】
- 必须是写实电影摄影风格，参考《知否知否应是绿肥红瘦》《甄嬛传》《庆余年》的视觉质感
- 绝对禁止：动漫风格、插画风格、二次元/ACG风格、游戏CG风格
- 画面中绝对不能出现任何文字、数字、编号
{face_quality_text}

{character_visual_context}

{scene_visual_context}

【分镜内容】
{shot_list if shot_list else "根据场景和角色自动设计9个分镜"}

【九宫格布局】
- 3行×3列，共9个分镜
- 每个分镜16:9宽屏比例
- 分镜之间用极细的线分隔
- 整体输出为16:9宽屏

【画质规格】
- 摄影机：ARRI Alexa 65 或 RED EPIC
- 镜头：Panavision G系列或 Cooke S4/i
- 分辨率：4608x2592 (16:9宽屏九宫格)
- 调色：电影级调色，低饱和度，胶片质感
- 光影：{lighting_keywords}
- 肤质：真实皮肤质感，毛孔可见

{performance_text}"""

        try:
            # 使用新的API端点和参数结构（支持正确的16:9比例）
            # 构建parts数组（文本 + 场景图 + 角色参考图）
            parts = [{"text": prompt}]

            # 添加场景图
            parts.append({
                "inlineData": {
                    "mimeType": "image/jpeg",
                    "data": scene_b64
                }
            })

            # 添加角色参考图
            for char_name, char_b64 in char_b64_list:
                parts.append({
                    "inlineData": {
                        "mimeType": "image/jpeg",
                        "data": char_b64
                    }
                })

            # 使用统一生图客户端（支持 API 降级）
            # 准备参考图片
            reference_images = []
            reference_images.append(("场景", scene_b64))
            for char_name, char_b64 in char_b64_list:
                reference_images.append((char_name, char_b64))

            # 构建完整提示词
            full_prompt = prompt

            # 调用统一客户端（自动降级）
            result = self.image_client.generate_storyboard_grid(
                prompt=full_prompt,
                reference_images=reference_images,
                output_path=output_path,
                size="4096x2304"  # 16:9
            )

            if result.success:
                print(f"✅ 九宫格分镜已生成！使用模型: {result.model_used}")

                # 注册到项目配置
                if self.project_config:
                    relative_path = str(output_path.relative_to(self.project_path))
                    existing = self.project_config.scenes.get(scene_name, {})
                    self.project_config.register_scene(scene_name, {
                        **existing,
                        "status": "storyboard_generated",
                        "storyboard_path": relative_path
                    })

                    if self.work_logger:
                        self.work_logger.log_step(
                            "register_scene",
                            f"更新场景「{scene_name}」分镜路径",
                            {"storyboard_path": relative_path}
                        )

                if self.work_logger:
                    self.work_logger.log_decision(
                        f"场景「{scene_name}」九宫格分镜生成完成",
                        f"路径: {output_path} (使用 {result.model_used})"
                    )

                return StoryboardResult(
                    success=True,
                    image_path=output_path,
                    message=f"九宫格分镜已生成 (使用 {result.model_used})"
                )
            else:
                print(f"❌ 生成失败: {result.message}")
                return StoryboardResult(success=False, message=result.message)

        except Exception as e:
            return StoryboardResult(success=False, message=str(e))

    def generate_from_script(
        self,
        scene_name: str,
        scene_localized_path: Path,
        character_refs: List[Path],
        script_path: Path = None,
        style: str = "costume_drama"
    ) -> StoryboardResult:
        """
        从分镜脚本生成九宫格分镜（优化版：使用精简提示词）

        Args:
            scene_name: 场景名称
            scene_localized_path: 实景化场景图路径
            character_refs: 角色参考图路径列表
            script_path: 分镜脚本路径（可选，不提供则自动查找）
            style: 视觉风格

        Returns:
            StoryboardResult
        """
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        # 加载分镜脚本
        if script_path:
            import json
            with open(script_path, 'r', encoding='utf-8') as f:
                script = json.load(f)
        else:
            script = self.load_storyboard_script(scene_name)

        if not script:
            raise ValueError(f"未找到场景「{scene_name}」的分镜脚本")

        print(f"\n📋 已加载分镜脚本: {scene_name}")
        print(f"   剧情摘要: {script.get('plot_summary', '')[:50]}...")

        # 提取角色情绪
        character_emotions = self.get_character_emotions_from_script(script)
        if character_emotions:
            print(f"   角色情绪: {character_emotions}")

        # 从脚本元数据获取场景类型和情绪
        metadata = script.get("metadata", {})
        scene_type = metadata.get("scene_type", "indoor_daytime")
        mood = metadata.get("mood", "normal")

        # === 使用优化后的提示词生成 ===
        return self._generate_with_optimized_prompt(
            scene_name=scene_name,
            scene_localized_path=scene_localized_path,
            character_refs=character_refs,
            script=script,
            style=style,
            scene_type=scene_type,
            mood=mood,
            character_emotions=character_emotions
        )

    def _generate_with_optimized_prompt(
        self,
        scene_name: str,
        scene_localized_path: Path,
        character_refs: List[Path],
        script: Dict[str, Any],
        style: str = "costume_drama",
        scene_type: str = "indoor_daytime",
        mood: str = "normal",
        character_emotions: Dict[str, str] = None
    ) -> StoryboardResult:
        """
        使用优化后的精简提示词生成九宫格分镜

        核心优化：
        1. 角色视觉特征摘要（150-200字/角色）替代完整小传
        2. 分镜描述精简格式（50-70字/分镜）替代叙事描述
        3. 添加面部质量锚点
        4. 总提示词控制在1500字以内

        Args:
            scene_name: 场景名称
            scene_localized_path: 实景化场景图路径
            character_refs: 角色参考图路径列表
            script: 分镜脚本字典
            style: 视觉风格
            scene_type: 场景光影类型
            mood: 情绪模式
            character_emotions: 角色情绪映射

        Returns:
            StoryboardResult
        """
        character_emotions = character_emotions or {}

        scene_localized_path = Path(scene_localized_path)
        if not scene_localized_path.exists():
            raise ValueError(f"实景化场景不存在: {scene_localized_path}")

        # 确保场景结构存在
        self.init_scene_structure(scene_name)

        # 使用新路径
        output_path = self.get_storyboard_grid_path(scene_name)

        # 记录开始
        if self.work_logger:
            self.work_logger.log_step(
                "generate_storyboard_grid",
                f"生成场景「{scene_name}」九宫格分镜（优化版）",
                {"scene_localized": str(scene_localized_path)}
            )

        print(f"\n🎬 正在生成场景「{scene_name}」九宫格分镜（优化版提示词）...")
        print(f"   场景类型: {scene_type}")
        print(f"   情绪模式: {mood}")

        # === 读取图片 ===
        with open(scene_localized_path, 'rb') as f:
            scene_b64 = base64.b64encode(f.read()).decode()

        # === 收集所有需要的角色服装参考图 ===
        # 从分镜脚本中提取所有角色服装组合
        all_costume_refs = {}  # {(角色名, 服装名): Path}
        for shot_data in script.get("shots", []):
            character_costumes = shot_data.get("character_costumes", {})
            for char_name, costume_name in character_costumes.items():
                key = (char_name, costume_name)
                if key not in all_costume_refs:
                    ref_path = self.get_character_costume_refs(char_name, costume_name)
                    if ref_path:
                        all_costume_refs[key] = ref_path
                        print(f"   加载服装参考: {char_name} - {costume_name}")

        # 如果没有指定服装，使用传入的默认参考图
        char_b64_list = []
        if all_costume_refs:
            for (char_name, costume_name), ref_path in all_costume_refs.items():
                if ref_path.exists():
                    with open(ref_path, 'rb') as f:
                        # 使用 "角色名_服装名" 作为标识
                        char_b64_list.append((f"{char_name}_{costume_name}", base64.b64encode(f.read()).decode()))
        else:
            # 使用传入的默认参考图
            for char_ref in character_refs:
                if Path(char_ref).exists():
                    with open(char_ref, 'rb') as f:
                        char_b64_list.append((Path(char_ref).stem, base64.b64encode(f.read()).decode()))

        # === 光影系统 ===
        lighting_keywords = get_lighting_keywords(scene_type, mood)

        # === 加载并提取视觉特征摘要 ===
        character_visual_summaries = {}
        for char_ref in character_refs:
            char_name = Path(char_ref).stem
            for name_part in char_name.split("_"):
                bio = self.load_character_biography(name_part)
                if bio:
                    character_visual_summaries[name_part] = self.extract_visual_summary(bio)
                    print(f"   已提取角色视觉摘要: {name_part}")
                    break

        # 加载场景视觉摘要
        scene_biography = self.load_scene_biography(scene_name) or ""
        scene_visual_summary = self.extract_scene_visual_summary(scene_biography) if scene_biography else ""

        # === 构建精简分镜描述 ===
        shot_lines = []
        for shot_data in script.get("shots", []):
            shot_line = self._build_shot_prompt(shot_data)
            shot_lines.append(shot_line)
        shot_list = "\n".join(shot_lines)

        # 构建风格描述
        style_desc = {
            "costume_drama": "宋代古装剧风格，写实摄影",
            "wasteland": "末世废土风格"
        }.get(style, "古装剧风格")

        # === 构建角色视觉特征摘要 ===
        character_visual_context = ""
        if character_visual_summaries:
            visual_parts = []
            for char_name, visual_summary in character_visual_summaries.items():
                if visual_summary:
                    visual_parts.append(f"【角色·{char_name}】\n{visual_summary}")
            character_visual_context = "\n\n".join(visual_parts)

        # === 构建场景视觉摘要 ===
        scene_visual_context = ""
        if scene_visual_summary:
            scene_visual_context = f"【场景·{scene_name}】\n{scene_visual_summary}"

        # === 面部质量锚点 ===
        face_quality_text = """
【面部质量要求 - 极其重要】
- 五官清晰端正，无变形，无崩坏
- 眼睛有神，瞳孔清晰，不空洞
- 面部细节完整，轮廓清晰
- 多人场景中，每个角色的面部特征独立清晰
- 禁止：面部模糊、五官错位、眼睛空洞、表情僵硬"""

        # === 构建最终提示词 ===
        prompt = f"""你是一位专业的电影分镜师。请基于这张实景化场景图和角色参考图，绘制一张九宫格分镜图。

【核心风格要求 - 最重要】
- 必须是写实电影摄影风格，参考《知否知否应是绿肥红瘦》《甄嬛传》《庆余年》的视觉质感
- 绝对禁止：动漫风格、插画风格、二次元/ACG风格、游戏CG风格
- 画面中绝对不能出现任何文字、数字、编号
{face_quality_text}

{character_visual_context}

{scene_visual_context}

【分镜内容】
{shot_list}

【画质规格】
- 摄影机：ARRI Alexa 65，Panavision G系列镜头
- 分辨率：4096x2304 (16:9宽屏九宫格)
- 单个分镜：约1365x768 (16:9)
- 调色：电影级调色，低饱和度，柔和对比度
- 光影：{lighting_keywords}

【布局】3行3列九宫格，整体画面16:9宽屏比例，分镜间用细线分隔"""

        # 打印提示词长度用于验证
        print(f"\n📏 提示词长度: {len(prompt)} 字符")
        if len(prompt) > 1500:
            print(f"   ⚠️ 警告: 提示词超过1500字，当前为{len(prompt)}字")

        # 构建多模态内容
        content = [{"type": "text", "text": prompt}]
        content.append({
            "type": "image_url",
            "image_url": {"url": f"data:image/jpeg;base64,{scene_b64}"}
        })
        for char_name, char_b64 in char_b64_list:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{char_b64}"}
            })

        try:
            response = requests.post(
                os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {os.environ.get('DMXAPI_KEY')}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gemini-3.1-flash-image-preview",
                    "messages": [{"role": "user", "content": content}],
                    "max_tokens": 8192
                },
                timeout=180
            )

            if response.status_code == 200:
                result = response.json()
                if "choices" in result and len(result["choices"]) > 0:
                    img_content = result["choices"][0].get("message", {}).get("content", "")

                    if len(img_content) > 1000:
                        if "base64," in img_content:
                            b64_data = img_content.split("base64,")[1]
                        else:
                            b64_data = img_content

                        with open(output_path, "wb") as f:
                            f.write(base64.b64decode(b64_data))

                        print(f"✅ 九宫格分镜已生成！")

                        # 注册到项目配置
                        if self.project_config:
                            relative_path = str(output_path.relative_to(self.project_path))
                            existing = self.project_config.scenes.get(scene_name, {})
                            self.project_config.register_scene(scene_name, {
                                **existing,
                                "status": "storyboard_generated",
                                "storyboard_path": relative_path
                            })

                        if self.work_logger:
                            self.work_logger.log_decision(
                                f"场景「{scene_name}」九宫格分镜生成完成（优化版）",
                                f"路径: {output_path}"
                            )

                        return StoryboardResult(
                            success=True,
                            image_path=output_path,
                            message="九宫格分镜已生成"
                        )

            return StoryboardResult(success=False, message="生成失败")

        except Exception as e:
            return StoryboardResult(success=False, message=str(e))

    def generate_panoramic_storyboard(
        self,
        scene_name: str,
        scene_concept_path: Path,
        character_refs: List[Path],
        shot_descriptions: List[ShotDescription] = None,
        style: str = "costume_drama",
        scene_type: str = "indoor_daytime",
        mood: str = "normal",
        character_emotions: Dict[str, str] = None
    ) -> StoryboardResult:
        """
        生成全景分镜（9个分镜合在一张图）

        Args:
            scene_name: 场景名称
            scene_concept_path: 场景概念图路径
            character_refs: 角色参考图路径列表
            shot_descriptions: 分镜描述列表（可选，不提供则自动生成）
            style: 视觉风格
            scene_type: 场景光影类型 (indoor_daytime, indoor_nighttime, outdoor_daytime, etc.)
            mood: 情绪模式 (normal, warm, tense, solemn)
            character_emotions: 角色情绪映射，如 {"沈砚舟": "distressed", "陶檐": "caring"}

        Returns:
            StoryboardResult
        """
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        # 记录开始
        if self.work_logger:
            self.work_logger.log_step(
                "generate_panoramic_storyboard",
                f"生成场景「{scene_name}」全景分镜",
                {"scene_concept": str(scene_concept_path), "characters": [str(c) for c in character_refs]}
            )

        # 准备输出路径
        safe_name = scene_name.replace("/", "_").replace(" ", "_")
        output_dir = self.project_path / "scenes" / f"scene_{safe_name}"
        output_dir.mkdir(parents=True, exist_ok=True)
        output_path = output_dir / "shot_9_wide.jpg"

        # 如果没有提供分镜描述，使用默认的9个分镜
        if not shot_descriptions:
            shot_descriptions = self._get_default_shot_descriptions(scene_name)

        # 构建提示词
        prompt = self._build_panoramic_prompt(
            scene_name, shot_descriptions, style,
            scene_type=scene_type, mood=mood, character_emotions=character_emotions
        )

        # 准备参考图片
        reference_images = []

        # 读取场景概念图
        if Path(scene_concept_path).exists():
            with open(scene_concept_path, 'rb') as f:
                scene_b64 = base64.b64encode(f.read()).decode()
            reference_images.append(("场景概念图", scene_b64))

        # 读取角色参考图
        for char_ref in character_refs:
            if Path(char_ref).exists():
                with open(char_ref, 'rb') as f:
                    char_b64 = base64.b64encode(f.read()).decode()
                char_name = Path(char_ref).stem
                reference_images.append((f"角色参考-{char_name}", char_b64))

        print(f"\n🎬 正在生成场景「{scene_name}」全景分镜...")
        print(f"   参考图片: {len(reference_images)} 张")
        print(f"   分镜数量: 9 个")

        # 调用 Gemini API 生成（使用多模态对话）
        result = self._generate_with_references(
            prompt=prompt,
            reference_images=reference_images,
            output_path=output_path
        )

        if result.success:
            if self.work_logger:
                self.work_logger.log_decision(
                    f"场景「{scene_name}」全景分镜生成完成",
                    f"路径: {result.image_path}"
                )

        return result

    def generate_nine_grid(
        self,
        panoramic_path: Path,
        scene_name: str = None
    ) -> StoryboardResult:
        """
        从全景分镜生成九宫格预览图（用于确认分镜内容）

        这是可选步骤，用于让用户确认每个分镜的内容是否正确。

        Args:
            panoramic_path: 全景分镜路径
            scene_name: 场景名称

        Returns:
            StoryboardResult
        """
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        panoramic_path = Path(panoramic_path)
        if not panoramic_path.exists():
            raise ValueError(f"全景分镜不存在: {panoramic_path}")

        # 从路径提取场景名
        if not scene_name:
            scene_name = panoramic_path.parent.name.replace("scene_", "")

        safe_name = scene_name.replace("/", "_").replace(" ", "_")
        output_dir = self.project_path / "scenes" / f"scene_{safe_name}"
        output_path = output_dir / "nine_grid_preview.jpg"

        # 记录开始
        if self.work_logger:
            self.work_logger.log_step(
                "generate_nine_grid",
                f"生成场景「{scene_name}」九宫格预览"
            )

        print(f"\n🎬 正在生成九宫格预览...")

        # 读取全景分镜
        with open(panoramic_path, 'rb') as f:
            panoramic_b64 = base64.b64encode(f.read()).decode()

        prompt = """基于提供的九宫格全景分镜，生成一张带编号标注的九宫格预览图。

要求：
1. 保持原图的9个分镜内容完全不变
2. 在每个分镜的中心位置添加小圆圈数字标注（①②③④⑤⑥⑦⑧⑨）
3. 数字标注要清晰可见但不遮挡主要内容
4. 输出为高清预览图

输出格式：3x3九宫格，16:9宽屏比例"""

        result = self._generate_with_reference(
            prompt=prompt,
            reference_image=panoramic_b64,
            output_path=output_path,
            size="1792x1024"
        )

        if result.success:
            if self.work_logger:
                self.work_logger.log_decision(
                    f"九宫格预览生成完成",
                    f"路径: {result.image_path}"
                )

        return result

    def generate_individual_shots(
        self,
        panoramic_path: Path,
        scene_name: str = None
    ) -> List[StoryboardResult]:
        """
        从全景分镜生成9张独立分镜

        Args:
            panoramic_path: 全景分镜路径
            scene_name: 场景名称

        Returns:
            List[StoryboardResult]: 9个分镜的结果列表
        """
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        panoramic_path = Path(panoramic_path)
        if not panoramic_path.exists():
            raise ValueError(f"全景分镜不存在: {panoramic_path}")

        # 从路径提取场景名
        if not scene_name:
            scene_name = panoramic_path.parent.name.replace("scene_", "")

        safe_name = scene_name.replace("/", "_").replace(" ", "_")
        output_dir = self.project_path / "scenes" / f"scene_{safe_name}"

        # 记录开始
        if self.work_logger:
            self.work_logger.log_step(
                "generate_individual_shots",
                f"生成场景「{scene_name}」9张独立分镜"
            )

        # 读取全景分镜
        with open(panoramic_path, 'rb') as f:
            panoramic_b64 = base64.b64encode(f.read()).decode()

        print(f"\n🎬 正在从全景分镜生成9张独立分镜...")

        results = []

        # 为每个分镜生成独立图片
        for i in range(1, 10):
            prompt = f"""基于提供的九宫格全景分镜，提取第 {i} 个分镜，生成独立的分镜图片。

要求：
1. 完全复刻第 {i} 个分镜的画面内容
2. 保持原图的构图、光影、角色造型
3. 输出为独立的高清分镜图片
4. 禁止画面中出现任何文字

【角色表演要求】
- 保持原图中角色的表情和姿态
- 如果原图表情僵硬，在保持相似的前提下微调为更自然的状态
- 眼神要有焦点，不是空洞直视
- 肢体语言要有动态感

分镜 {i} 的位置说明：
- 分镜1-3: 第一行（左到右）
- 分镜4-6: 第二行（左到右）
- 分镜7-9: 第三行（左到右）

输出格式：单张分镜图片，16:9 比例"""

            output_path = output_dir / f"shot_{i}.jpg"

            result = self._generate_with_reference(
                prompt=prompt,
                reference_image=panoramic_b64,
                output_path=output_path,
                size="1792x1024"
            )

            if result.success:
                print(f"   ✅ 分镜 {i} 完成")
                results.append(result)
            else:
                print(f"   ❌ 分镜 {i} 失败")
                results.append(result)

        # 记录完成
        success_count = sum(1 for r in results if r.success)
        if self.work_logger:
            self.work_logger.log_decision(
                f"独立分镜生成完成",
                f"成功: {success_count}/9"
            )

        return results

    def _generate_with_references(
        self,
        prompt: str,
        reference_images: List[tuple],
        output_path: Path
    ) -> StoryboardResult:
        """使用多张参考图生成"""

        # 构建多模态消息
        content = [{"type": "text", "text": prompt}]

        for name, img_b64 in reference_images:
            content.append({
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{img_b64}"}
            })

        try:
            response = requests.post(
                os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {os.environ.get('DMXAPI_KEY')}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gemini-3.1-flash-image-preview",
                    "messages": [{"role": "user", "content": content}],
                    "max_tokens": 4096
                },
                timeout=180
            )

            if response.status_code == 200:
                result = response.json()
                if "choices" in result and len(result["choices"]) > 0:
                    img_content = result["choices"][0].get("message", {}).get("content", "")

                    if len(img_content) > 1000:
                        if "base64," in img_content:
                            b64_data = img_content.split("base64,")[1]
                        else:
                            b64_data = img_content

                        output_path = Path(output_path)
                        output_path.parent.mkdir(parents=True, exist_ok=True)

                        with open(output_path, "wb") as f:
                            f.write(base64.b64decode(b64_data))

                        print(f"✅ 全景分镜已生成！")

                        return StoryboardResult(
                            success=True,
                            image_path=output_path,
                            message="全景分镜已生成"
                        )

            return StoryboardResult(success=False, message="生成失败")

        except Exception as e:
            return StoryboardResult(success=False, message=str(e))

    def _generate_with_reference(
        self,
        prompt: str,
        reference_image: str,
        output_path: Path,
        size: str = "1792x1024"
    ) -> StoryboardResult:
        """使用单张参考图生成"""

        content = [
            {"type": "text", "text": prompt},
            {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{reference_image}"}}
        ]

        try:
            response = requests.post(
                os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1/chat/completions",
                headers={
                    "Authorization": f"Bearer {os.environ.get('DMXAPI_KEY')}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": "gemini-3.1-flash-image-preview",
                    "messages": [{"role": "user", "content": content}],
                    "max_tokens": 4096
                },
                timeout=180
            )

            if response.status_code == 200:
                result = response.json()
                if "choices" in result and len(result["choices"]) > 0:
                    img_content = result["choices"][0].get("message", {}).get("content", "")

                    if len(img_content) > 1000:
                        if "base64," in img_content:
                            b64_data = img_content.split("base64,")[1]
                        else:
                            b64_data = img_content

                        with open(output_path, "wb") as f:
                            f.write(base64.b64decode(b64_data))

                        return StoryboardResult(
                            success=True,
                            image_path=output_path,
                            message=f"分镜已生成"
                        )

            return StoryboardResult(success=False, message="生成失败")

        except Exception as e:
            return StoryboardResult(success=False, message=str(e))

    def _build_panoramic_prompt(
        self,
        scene_name: str,
        shot_descriptions: List[ShotDescription],
        style: str,
        scene_type: str = "indoor_daytime",
        mood: str = "normal",
        character_emotions: Dict[str, str] = None
    ) -> str:
        """构建全景分镜提示词（集成光影和表演系统）"""

        character_emotions = character_emotions or {}

        style_desc = {
            "costume_drama": "宋代古装剧风格（知否/清平乐），写实摄影风格",
            "wasteland": "末世废土风格，赛博朋克质感"
        }.get(style, "古装剧风格")

        # === 光影系统 ===
        lighting_keywords = get_lighting_keywords(scene_type, mood)

        # === 表演系统 ===
        # 根据景别分组，生成对应的表演提示词
        performance_parts = []
        for shot in shot_descriptions:
            shot_type_en = {"特写": "closeup", "近景": "closeup", "中景": "medium", "全景": "wide", "大全景": "wide", "远景": "wide"}.get(shot.shot_type, "medium")

            # 如果有角色情绪配置，生成角色表演提示
            for char_name, emotion in character_emotions.items():
                identity = "文官" if "沈" in char_name or "官" in char_name else "侍女"
                perf_keywords = get_emotion_performance_keywords(emotion, identity, shot_type_en)
                if perf_keywords:
                    performance_parts.append(f"分镜{shot.shot_number} {char_name}: {perf_keywords}")

        performance_text = "\n".join(performance_parts[:6]) if performance_parts else ""

        # 构建分镜描述
        shots_text = []
        for shot in shot_descriptions:
            shots_text.append(f"""
分镜{shot.shot_number}：
- 景别：{shot.shot_type}，{shot.camera_angle}
- 内容：{shot.description}""")

        prompt = f"""基于提供的场景概念图和角色参考图，生成一张包含9个分镜头的九宫格故事板图片。

【场景】{scene_name}
【风格】{style_desc}
【光影】{lighting_keywords}

【场景实景化转制规则 - 优先级从高到低】
1. 必须1:1保留概念图的空间布局、核心物件位置、整体光影氛围，仅优化细节为真实拍摄级实景质感
2. 所有文字元素处理规则：
   - 牌匾文字必须转换为正确的中文汉字，内容为「{scene_name}」
   - 楷书/行书字体，木刻质感
   - 排版从右至左（古装规制）
3. 禁止项：现代文字、英文字母、乱码、不可识别符号

【九宫格布局】3行3列，每个分镜占1/9画面，用细线分隔

【分镜内容】
{''.join(shots_text)}

【角色表演要求 - 非常重要】
- 表情自然生动，有情绪层次，拒绝僵硬摆拍感
- 眼神要有焦点和情绪，不是空洞直视
- 肢体语言自然放松，有动态感
- 角色之间有真实的互动和气场
- 每个人物都像是在"演戏"而不是"站桩"
- 捕捉动作的瞬间感，像电影截图而不是证件照
- 微表情：轻微皱眉、嘴角微动、眼神流转
{performance_text}

【技术要求】
- 完全复刻参考图中的角色面部特征和服装
- 保持场景概念图的氛围和光影
- 九宫格布局：3行3列，每个分镜16:9比例，整体画面也是16:9
- 场景中的牌匾文字必须是清晰可读的中文
- 写实摄影风格，电影质感
- 分辨率：4096x2304（16:9宽屏九宫格）

【负面排除】插画风格、卡通、二次元、僵硬摆拍、表情空洞、证件照感、乱码文字、不可识别符号"""

        return prompt

    def _get_default_shot_descriptions(self, scene_name: str) -> List[ShotDescription]:
        """获取默认的分镜描述"""
        return [
            ShotDescription(1, "全景", "平拍", f"{scene_name}全景，建立场景"),
            ShotDescription(2, "中景", "侧拍", "角色进入场景"),
            ShotDescription(3, "近景", "平拍", "角色面部表情"),
            ShotDescription(4, "中景", "俯拍15°", "角色动作"),
            ShotDescription(5, "特写", "平拍", "关键道具/细节"),
            ShotDescription(6, "中景", "仰拍10°", "角色互动"),
            ShotDescription(7, "全景", "侧拍", "场景与角色关系"),
            ShotDescription(8, "中景", "平拍", "角色反应"),
            ShotDescription(9, "大全景", "俯拍30°", "场景收尾"),
        ]

    def _build_portrait_focused_prompt(self, preset, mode_config, lighting_keywords,
                                       character_context, scene_context,
                                       face_quality_text, shot_list):
        """构建人像为主模式的提示词（龙龛码头海鸥版风格）"""

        references = preset.get('metadata', {}).get('references', [])
        reference_text = "、".join(references[:3]) if references else "《去有风的地方》"

        shot_design = mode_config.get('shot_design', {})
        color_progression = mode_config.get('color_progression', {})

        # 构建9镜头详细描述
        shot_descriptions = []
        for i in range(1, 10):
            shot_key = f"shot{i}"
            shot_config = shot_design.get(shot_key, {})

            row_num = (i - 1) // 3 + 1
            color_phase = color_progression.get(f"row{row_num}", "golden_warm")

            figure_pct = shot_config.get('figure_scale', 0.1) * 100

            desc = f"""【镜头{i}】{shot_config.get('type', 'wide')} 16:9
- 人物占比: {figure_pct:.0f}%
- 构图: {shot_config.get('composition', '三分法')}
- 画面: {shot_config.get('description', '')}
- 色调: {color_phase}"""
            shot_descriptions.append(desc)

        # 检查是否有特殊元素（如龙龛码头海鸥）
        special_elements = mode_config.get('special_elements', {})
        seagulls_desc = ""
        if special_elements.get('seagulls', {}).get('enabled'):
            seagulls_desc = f"""
【特殊场景元素 - 龙龛码头海鸥】
- 海鸥群飞：多个镜头中要有海鸥飞舞
- 海鸥停驻：木栈道栏杆上有海鸥停歇
- 海鸥环绕：人物周围有海鸥飞翔
- 海鸥倒影：水面倒影中有海鸥"""

        # 预先计算镜头描述文本（避免 f-string 中的反斜杠）
        shot_descriptions_text = "\n\n".join(shot_descriptions)

        return f"""生成3x3九宫格分镜图，现代旅游风光影视片风格。

【核心风格要求】
- 参考风格: {reference_text}
- 强调人物与风景的叙事结合
- 包含1个近景特写+1个中景+7个远景/全景
- 展现"有风"的感觉（风吹动裙摆、发丝）
- 绝对禁止: 动漫风格、插画风格、文字标注
{face_quality_text}

{character_context}

{scene_context}
{seagulls_desc}

【9镜头设计】
{shot_descriptions_text}

{shot_list if shot_list else ""}

【九宫格布局】
- 3行x3列，每个镜头16:9宽屏比例
- 白色细线分隔
- 整体16:9输出

【画质规格】
- 摄影机: 专业电影摄影设备
- 调色: 电影级调色，《去有风的地方》治愈风格
- 光影: {lighting_keywords}
- 分辨率: 16:9宽屏
"""

    def _build_landscape_focused_prompt(self, preset, mode_config, lighting_keywords,
                                        character_context, scene_context,
                                        face_quality_text, shot_list):
        """构建风景人像混合模式的提示词（孤独星球/BBC纪录片风格）"""

        references = preset.get('metadata', {}).get('references', [])
        reference_text = "、".join(references[:3]) if references else "孤独星球、BBC旅游纪录片、国家地理"

        composition = preset.get('composition_rules', {})
        figure_scale = composition.get('figure_scale', {}).get('recommended', 0.08)

        atmosphere_tones = preset.get('atmosphere_tones', {})
        peaceful = atmosphere_tones.get('peaceful_poetic', {}).get('keywords', [])
        healing = atmosphere_tones.get('warm_healing', {}).get('keywords', [])
        atmosphere_keywords = ", ".join((peaceful + healing)[:5])

        shot_design = mode_config.get('shot_design', {})
        color_progression = mode_config.get('color_progression', {})

        # 构建9镜头简要描述（因为人物占比统一）
        shot_descriptions = []
        for i in range(1, 10):
            shot_key = f"shot{i}"
            shot_config = shot_design.get(shot_key, {})

            row_num = (i - 1) // 3 + 1
            color_phase = color_progression.get(f"row{row_num}", "golden_warm")

            figure_pct = shot_config.get('figure_scale', 0.1) * 100

            desc = f"""【镜头{i}】{shot_config.get('type', 'wide')} 16:9
- 人物占比: {figure_pct:.0f}%
- 构图: {shot_config.get('composition', '三分法')}
- 画面: {shot_config.get('description', '')}
- 色调: {color_phase}"""
            shot_descriptions.append(desc)

        # 预先计算镜头描述文本（避免 f-string 中的反斜杠）
        shot_descriptions_text = "\n\n".join(shot_descriptions)

        return f"""生成3x3九宫格分镜图，现代旅游风光纪录片风格。

【核心风格要求】
- 参考风格: {reference_text}
- 强调风景为主，人物为辅（人物占比{figure_scale*100:.0f}%以内）
- 展现人与自然的和谐，{atmosphere_keywords}的氛围
- 绝对禁止: 动漫风格、插画风格、文字标注
{face_quality_text}

{character_context}

{scene_context}

【构图要求】
- 人物占比: {figure_scale*100:.0f}%以内（极小的人物，强调环境的壮美）
- 构图方式: 三分法、大面积留白
- 人物朝向: 背影为主，侧影为辅

【9镜头设计】
{shot_descriptions_text}

{shot_list if shot_list else "根据场景和角色自动设计9个分镜，强调风景的壮美和人物的渺小"}

【九宫格布局】
- 3行x3列，每个镜头16:9宽屏比例
- 白色细线分隔
- 整体16:9输出

【画质规格】
- 摄影机: 专业风光摄影设备
- 调色: 电影级调色，自然饱和度，胶片质感
- 光影: {lighting_keywords}
- 分辨率: 16:9宽屏

【特殊要求】
- 展现风吹动的元素（裙摆、发丝、树叶、云朵）
- 慢节奏，舒缓的镜头
- 强调人与自然的和谐
- 避免摆拍感，追求旅居感
"""
