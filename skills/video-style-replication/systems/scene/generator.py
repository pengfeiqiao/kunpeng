"""
场景图片生成器
====================================================
使用 Midjourney 生成场景概念图。

核心功能：
1. generate_scene_concept - 生成场景概念图
2. upsample_scene - 放大场景图

用法：
    from systems.scene import SceneGenerator

    generator = SceneGenerator(project_path)

    # 生成场景概念图
    result = generator.generate_scene_concept(
        scene_name="辟讹署大堂",
        scene_description="宋代官署正堂...",
        scene_type="indoor_daytime"
    )

    # 放大场景图
    result = generator.upsample_scene(image_id, index=1)
"""

import os
import base64
import requests
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime

import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))

from utils.midjourney_client import MidjourneyClient, MJResult
from systems.memory import WorkLogger
from systems.config.project_manager import ProjectConfig


@dataclass
class SceneResult:
    """场景生成结果"""
    success: bool
    image_path: Path = None
    image_url: str = ""
    image_id: str = ""
    message: str = ""
    metadata: Dict[str, Any] = None

    def __post_init__(self):
        if self.metadata is None:
            self.metadata = {}


class SceneGenerator:
    """场景图片生成器"""

    def __init__(
        self,
        project_path: Path = None,
        work_logger: WorkLogger = None,
        project_config: ProjectConfig = None
    ):
        self.project_path = Path(project_path) if project_path else None
        self.mj_client = MidjourneyClient()
        self.work_logger = work_logger
        self.project_config = project_config

        # 初始化时记录
        if self.work_logger:
            self.work_logger.log_note("SceneGenerator 初始化完成")

    def set_project(self, project_path: Path):
        """设置项目路径"""
        self.project_path = Path(project_path)

    def set_logger(self, work_logger: WorkLogger):
        """设置工作日志"""
        self.work_logger = work_logger

    def generate_scene_concept(
        self,
        scene_name: str,
        scene_description: str,
        scene_type: str = "indoor_daytime",
        style: str = "costume_drama",
        characters: List[str] = None,
        aspect_ratio: str = "16:9",
        version: str = "6.1",
        save_path: Path = None
    ) -> SceneResult:
        """
        生成场景概念图

        Args:
            scene_name: 场景名称
            scene_description: 场景详细描述
            scene_type: 场景类型 (indoor_daytime, indoor_nighttime, outdoor_daytime, outdoor_nighttime)
            style: 视觉风格 (costume_drama, wasteland)
            characters: 出场角色列表
            aspect_ratio: 画面比例 (16:9, 21:9, 1:1)
            version: Midjourney 版本
            save_path: 自定义保存路径

        Returns:
            SceneResult
        """
        if not self.project_path and not save_path:
            raise ValueError("请先设置项目路径或指定 save_path")

        # 记录开始
        if self.work_logger:
            self.work_logger.log_step(
                "generate_scene_concept",
                f"生成场景「{scene_name}」概念图",
                {"scene_type": scene_type, "style": style, "aspect_ratio": aspect_ratio}
            )

        # 确定保存路径
        if save_path:
            output_dir = Path(save_path).parent
            output_path = Path(save_path)
        else:
            safe_name = scene_name.replace("/", "_").replace(" ", "_")
            output_dir = self.project_path / "scenes" / f"scene_{safe_name}"
            output_dir.mkdir(parents=True, exist_ok=True)
            output_path = output_dir / "scene_concept.jpg"

        # 构建 Midjourney 提示词
        mj_prompt = self._build_scene_prompt(
            scene_name=scene_name,
            scene_description=scene_description,
            scene_type=scene_type,
            style=style,
            characters=characters,
            aspect_ratio=aspect_ratio,
            version=version
        )

        print(f"\n🎨 正在生成场景「{scene_name}」概念图...")
        print(f"   类型: {scene_type}")
        print(f"   比例: {aspect_ratio}")

        # 调用 Midjourney API
        result = self.mj_client.imagine(mj_prompt, timeout=480)

        if result.success:
            # 下载图片
            if self.mj_client.download_image(result.image_url, output_path):
                print(f"✅ 场景概念图已生成！")

                # 注册到项目配置
                if self.project_config:
                    relative_path = str(output_path.relative_to(self.project_path))
                    self.project_config.register_scene(scene_name, {
                        "description": scene_description,
                        "type": scene_type,
                        "style": style,
                        "status": "concept_generated",
                        "concept_path": relative_path,
                        "image_id": result.image_id
                    })

                    if self.work_logger:
                        self.work_logger.log_step(
                            "register_scene",
                            f"注册场景「{scene_name}」到项目",
                            {"type": scene_type, "path": relative_path}
                        )

                # 记录完成
                if self.work_logger:
                    self.work_logger.log_decision(
                        f"场景「{scene_name}」概念图生成完成",
                        f"Image ID: {result.image_id}"
                    )

                return SceneResult(
                    success=True,
                    image_path=output_path,
                    image_url=result.image_url,
                    image_id=result.image_id,
                    message=f"场景「{scene_name}」概念图已生成",
                    metadata={
                        "scene_name": scene_name,
                        "scene_type": scene_type,
                        "style": style,
                        "aspect_ratio": aspect_ratio
                    }
                )
            else:
                return SceneResult(
                    success=False,
                    image_url=result.image_url,
                    image_id=result.image_id,
                    message="图片下载失败"
                )
        else:
            return SceneResult(
                success=False,
                message=f"Midjourney 生成失败: {result.error}"
            )

    def upsample_scene(
        self,
        image_id: str,
        index: int = 1,
        scene_name: str = None,
        save_path: Path = None
    ) -> SceneResult:
        """
        放大场景图

        Args:
            image_id: 图像ID
            index: 放大哪个位置 (1-4)
            scene_name: 场景名称（用于文件命名）
            save_path: 自定义保存路径

        Returns:
            SceneResult
        """
        if not self.project_path and not save_path:
            raise ValueError("请先设置项目路径或指定 save_path")

        # 确定保存路径
        if save_path:
            output_path = Path(save_path)
        else:
            safe_name = (scene_name or "scene").replace("/", "_").replace(" ", "_")
            output_dir = self.project_path / "scenes" / f"scene_{safe_name}"
            output_path = output_dir / f"scene_concept_U{index}.jpg"

        print(f"\n🔍 正在放大场景图 U{index}...")

        result = self.mj_client.upsample(image_id, index=index, timeout=480)

        if result.success:
            if self.mj_client.download_image(result.image_url, output_path):
                print(f"✅ 场景图已放大！")

                return SceneResult(
                    success=True,
                    image_path=output_path,
                    image_url=result.image_url,
                    image_id=result.image_id,
                    message=f"场景图 U{index} 已放大"
                )
            else:
                return SceneResult(
                    success=False,
                    message="图片下载失败"
                )
        else:
            return SceneResult(
                success=False,
                message=f"放大失败: {result.error}"
            )

    def _build_scene_prompt(
        self,
        scene_name: str,
        scene_description: str,
        scene_type: str,
        style: str,
        characters: List[str],
        aspect_ratio: str,
        version: str
    ) -> str:
        """
        构建 Midjourney 提示词

        Args:
            所有 generate_scene_concept 的参数

        Returns:
            Midjourney 提示词字符串
        """
        # 风格映射
        style_map = {
            "costume_drama": "Song Dynasty Chinese drama style,知否/清平乐 aesthetic",
            "wasteland": "Post-apocalyptic wasteland style, cyberpunk aesthetic"
        }
        style_desc = style_map.get(style, style_map["costume_drama"])

        # 场景类型映射
        type_map = {
            "indoor_daytime": "indoor scene, natural daylight, soft lighting",
            "indoor_nighttime": "indoor scene, candlelight, warm amber lighting",
            "outdoor_daytime": "outdoor scene, bright sunlight, natural lighting",
            "outdoor_nighttime": "outdoor scene, moonlight, cool blue-white lighting"
        }
        lighting_desc = type_map.get(scene_type, type_map["indoor_daytime"])

        # 角色信息
        char_text = ""
        if characters:
            char_text = f", with {' and '.join(characters)} present"

        # 构建 MJ 提示词
        prompt = f"""{scene_description}

Style: {style_desc}
Lighting: {lighting_desc}
Format: cinematic establishing shot, 16:9 wide angle, no text, no people{char_text}, high detail, photorealistic, movie quality, no watermarks

--v {version} --ar {aspect_ratio} --q 2 --s 750"""

        return prompt.strip()

    def get_scene_presets(self, style: str = "costume_drama") -> List[Dict[str, str]]:
        """
        获取场景预设模板

        Args:
            style: 视觉风格

        Returns:
            场景预设列表
        """
        if style == "costume_drama":
            return [
                {
                    "name": "官署大堂",
                    "scene_type": "indoor_daytime",
                    "description": "宋代官署正堂，庄严肃穆，案牍堆积，光线从高窗斜射，青砖地面，木质横梁，素雅官署风格"
                },
                {
                    "name": "手工作坊",
                    "scene_type": "indoor_daytime",
                    "description": "宋代手工作坊，工具散落，木屑纷飞，自然光从窗户照入，充满手艺人气息，杂乱但有秩序"
                },
                {
                    "name": "繁华街市",
                    "scene_type": "outdoor_daytime",
                    "description": "汴京繁华街道，商铺林立，招牌飘扬，青石板路，人流熙攘的市井气息，有纵深层次感"
                },
                {
                    "name": "茶寮雅间",
                    "scene_type": "indoor_daytime",
                    "description": "幽静茶室，竹帘半卷，茶香袅袅，简约雅致，适合密谈，柔和自然光"
                },
                {
                    "name": "王府后院",
                    "scene_type": "outdoor_daytime",
                    "description": "王府或官府后院，假山流水，亭台楼阁，展示祥瑞之地，园林景观，阳光明媚"
                },
                {
                    "name": "书房夜景",
                    "scene_type": "indoor_nighttime",
                    "description": "夜间书房，烛火摇曳，书卷堆叠，孤独创作氛围，温暖烛光，深色调"
                }
            ]

        return []
