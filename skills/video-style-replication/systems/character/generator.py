"""
角色图片生成器
====================================================
生成角色定妆照和三视图。

核心功能：
1. generate_makeup_images - 生成定妆照候选图（4张）
2. generate_base_model - 生成素模三视图（基础模型）
3. generate_costume_threeview - 基于素模生成服装三视图

三视图生成流程（两步法）：
1. 先生成「素模三视图」- 白色/素衣基础模型，确立角色面部和身体基础特征
2. 再基于素模生成「服装三视图」- 添加具体服装

朝代服装系统：
- 支持多朝代（唐、宋、明、清、架空等）
- 根据角色朝代、性别、身份动态匹配服装材质和形制

用法：
    from systems.character import CharacterGenerator

    generator = CharacterGenerator(project_path)

    # 生成定妆照
    images = generator.generate_makeup_images(character_info, count=4)

    # 生成素模三视图
    base_model = generator.generate_base_model(
        character_info=character_info,
        reference_image=makeup_image_path  # 可选，作为参考
    )

    # 基于素模生成服装三视图（自动匹配朝代服装）
    costume_view = generator.generate_costume_threeview(
        base_model_path=base_model.image_paths[0],
        costume_name="日常常服",
        character_info=character_info  # 包含朝代信息
    )
"""

import os
import base64
import requests
import json
from pathlib import Path
from typing import Dict, List, Optional, Any
from dataclasses import dataclass
from datetime import datetime

# 导入工作日志和项目配置
import sys
sys.path.insert(0, str(Path(__file__).parent.parent.parent))
from systems.memory import WorkLogger
from systems.config.project_manager import ProjectConfig
from systems.character.character_config import CharacterConfig
from systems.character.regional_costume_db import RegionalCostumeDB


@dataclass
class GenerationResult:
    """生成结果"""
    success: bool
    image_paths: List[Path]
    message: str
    metadata: Dict[str, Any] = None


class DynastyCostumeDB:
    """朝代服装数据库"""

    def __init__(self):
        self.db_path = Path(__file__).parent.parent.parent / "database" / "costumes" / "dynasty_costume_db.json"
        self._db = None

    def load(self) -> Dict:
        """加载数据库"""
        if self._db is None:
            if self.db_path.exists():
                with open(self.db_path, 'r', encoding='utf-8') as f:
                    self._db = json.load(f).get("dynasty_costume_db", {})
            else:
                self._db = {}
        return self._db

    def get_dynasty_info(self, dynasty: str) -> Dict:
        """获取朝代服装信息"""
        db = self.load()

        # 尝试匹配朝代
        for key in db:
            if dynasty in key or key in dynasty:
                return db[key]

        # 未找到则返回架空配置
        return db.get("架空", {
            "dynasty_full_name": dynasty,
            "general_style": "传统古风风格",
            "fabric": [{"name": "丝绸", "desc": "光泽柔和，质地顺滑", "tags": ["所有身份"]}],
            "costume_patterns": {
                "male": [{"name": "交领长衫", "desc": "交领右衽，衣长及踝", "tags": ["日常"]}],
                "female": [{"name": "交领襦裙", "desc": "交领上衣，下裙束腰", "tags": ["日常"]}]
            },
            "color_palette": [{"desc": "根据角色身份选择合适色系", "tags": ["所有身份"]}],
            "accessories": {
                "male": [{"desc": "发簪、腰带、玉佩", "tags": ["日常"]}],
                "female": [{"desc": "发簪、步摇、荷包", "tags": ["日常"]}]
            }
        })

    def match_by_tags(self, items: List[Dict], tags: List[str]) -> List[Dict]:
        """根据标签匹配素材"""
        matched = []
        for item in items:
            item_tags = item.get("tags", [])
            # 检查是否有匹配的标签
            if "所有身份" in item_tags or any(tag in item_tags for tag in tags):
                matched.append(item)
        return matched if matched else items  # 无匹配则返回全部


class CharacterGenerator:
    """角色图片生成器"""

    API_BASE = os.environ.get("DMXAPI_BASE_URL", "https://www.dmxapi.cn") + "/v1"
    MODEL_IMAGE = "gemini-3.1-flash-image-preview"

    def __init__(
        self,
        project_path: Path = None,
        work_logger: WorkLogger = None,
        project_config: ProjectConfig = None,
        style: str = "costume_drama"
    ):
        self.project_path = Path(project_path) if project_path else None
        self.api_key = os.environ.get("DMXAPI_KEY")
        self.style = style

        # 条件加载服装数据库
        if style == "modern_travel":
            self.costume_db = RegionalCostumeDB()
        else:
            self.costume_db = DynastyCostumeDB()

        self.work_logger = work_logger
        self.project_config = project_config

        if not self.api_key:
            raise ValueError("❌ DMXAPI_KEY 未配置，请在 ~/.zshrc 中设置")

        # 初始化时记录
        if self.work_logger:
            self.work_logger.log_note("CharacterGenerator 初始化完成")

    def set_project(self, project_path: Path):
        """设置项目路径"""
        self.project_path = Path(project_path)

    def set_logger(self, work_logger: WorkLogger):
        """设置工作日志"""
        self.work_logger = work_logger

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
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
            return CharacterConfig.from_dict(data)
        return None

    def _build_makeup_prompt_from_config(self, config: CharacterConfig, style: str) -> str:
        """
        从 CharacterConfig 构建增强版定妆照提示词

        使用角色卡中的：
        - 视觉记忆点 (visual_memory_points) - 高权重特征
        - 骨相结构 (bone_structure) - 面部结构
        - 软组织特征 (soft_tissue) - 皮肤、眼睛、嘴唇等
        - 提示词模板 (prompt_template) - 正向/负向模板
        """
        style_map = {
            "costume_drama": "宋代古装剧风格（知否/清平乐）",
            "wasteland": "未来废土风格（赛博朋克）"
        }
        style_desc = style_map.get(style, "宋代古装剧风格")

        # 基础信息
        prompt_parts = [f"{style_desc}角色定妆照，高质量写实摄影风格。\n"]

        # 角色信息
        prompt_parts.append(f"【角色信息】")
        prompt_parts.append(f"- 姓名：{config.name}")
        if config.age:
            prompt_parts.append(f"- 年龄：{config.age}")
        if config.archetype:
            prompt_parts.append(f"- 身份：{config.archetype}")
        if config.temperament:
            prompt_parts.append(f"- 气质：{'、'.join(config.temperament)}")
        if config.synesthesia:
            prompt_parts.append(f"- 通感：{config.synesthesia}")

        # 视觉记忆点（核心特征）
        if config.visual_memory_points:
            prompt_parts.append("\n【核心视觉特征 - 必须准确呈现】")
            sorted_points = sorted(
                [p for p in config.visual_memory_points if p.must_preserve],
                key=lambda x: x.criticality,
                reverse=True
            )
            for point in sorted_points[:5]:  # 最多5个核心特征
                weight = point.criticality / 10
                prompt_parts.append(f"- ({point.description})")

        # 骨相结构
        if config.bone_structure:
            bs = config.bone_structure
            prompt_parts.append("\n【面部结构】")
            if bs.face_shape_description:
                prompt_parts.append(f"- 脸型：{bs.face_shape_description}")
            if bs.eye_shape and bs.eye_shape.get("description"):
                prompt_parts.append(f"- 眼型：{bs.eye_shape.get('description')}")
            if bs.nose and bs.nose.get("description"):
                prompt_parts.append(f"- 鼻型：{bs.nose.get('description')}")

        # 软组织特征
        if config.soft_tissue:
            st = config.soft_tissue
            prompt_parts.append("\n【五官细节】")
            if st.skin:
                prompt_parts.append(f"- 皮肤：{st.skin.get('description', st.skin.get('tone', ''))}")
            if st.eyes:
                prompt_parts.append(f"- 眼睛：{st.eyes.get('eye_spirit', st.eyes.get('shape', ''))}")
            if st.brows:
                prompt_parts.append(f"- 眉毛：{st.brows.get('description', st.brows.get('shape', ''))}")
            if st.lips:
                prompt_parts.append(f"- 嘴唇：{st.lips.get('description', '')}")

            # 特殊标记
            if st.unique_marks:
                prompt_parts.append("\n【关键标记 - 必须呈现】")
                for mark in st.unique_marks:
                    prompt_parts.append(f"- {mark.get('description', '')}")

        # 表情气质
        if config.expression_temperament:
            et = config.expression_temperament
            prompt_parts.append("\n【表情气质】")
            if et.resting_expression:
                prompt_parts.append(f"- 默认表情：{et.resting_expression}")
            if et.temperament_keywords:
                prompt_parts.append(f"- 气质关键词：{'、'.join(et.temperament_keywords)}")

        # 发型
        if config.hairstyle:
            prompt_parts.append("\n【发型】")
            hair_desc = config.hairstyle.get("details", "") or config.hairstyle.get("style", "")
            if hair_desc:
                prompt_parts.append(f"- {hair_desc}")

        # 服装
        if config.costume:
            prompt_parts.append("\n【服装造型】")
            costume_default = config.costume.get("default", "")
            costume_variations = config.costume.get("variations", {})
            if costume_default:
                prompt_parts.append(f"- {costume_default}")
            if costume_variations.get("日常"):
                prompt_parts.append(f"- 日常装束：{costume_variations['日常']}")

        # 技术要求
        prompt_parts.append("""
【场景氛围】
- 江南园林或简约背景
- 柔和自然光，中性色温5500K
- 电影质感，胶片颗粒
- 知否/清平乐风格

【技术要求】
- 写实摄影风格，非插画
- 半身像构图
- 正面或微侧角度
- 面部清晰可见，细节丰富
- 1024x1024分辨率""")

        # 负向提示词
        if config.prompt_template and config.prompt_template.negative:
            prompt_parts.append(f"\n【负面排除】{config.prompt_template.negative}")

        return "\n".join(prompt_parts)

    # ============================================================
    # 定妆照生成
    # ============================================================

    def generate_makeup_images(
        self,
        character_info: Dict[str, Any],
        count: int = 4,
        style: str = "costume_drama"
    ) -> GenerationResult:
        """
        生成定妆照候选图

        Args:
            character_info: 角色信息字典
            count: 生成数量（默认4张）
            style: 视觉风格

        Returns:
            GenerationResult
        """
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        character_name = character_info.get('name', '角色')

        # 记录开始
        if self.work_logger:
            self.work_logger.log_step(
                "generate_makeup",
                f"生成「{character_name}」定妆照",
                {"count": count, "style": style}
            )

        output_dir = self.project_path / "characters"
        output_dir.mkdir(parents=True, exist_ok=True)

        # 尝试加载 CharacterConfig 以使用增强版提示词
        config = self.load_character_config(character_name)
        if config:
            print(f"   已加载角色详细配置: {character_name}_config.json")
            prompt = self._build_makeup_prompt_from_config(config, style)
        else:
            # 使用基础提示词构建
            prompt = self._build_makeup_prompt(character_info, style)

        generated_images = []

        for i in range(1, count + 1):
            print(f"🎨 正在生成定妆照 U{i}...")

            # 为每张图添加角度/风格变化
            variant_prompt = self._add_makeup_variant(prompt, i)

            image_path = self._generate_image(
                prompt=variant_prompt,
                output_path=output_dir / f"{character_name}_定妆照_U{i}.jpg",
                size="1024x1024"
            )

            if image_path:
                generated_images.append(image_path)
                print(f"   ✅ U{i} 完成")
            else:
                print(f"   ❌ U{i} 失败")

        if generated_images:
            # 记录完成
            if self.work_logger:
                self.work_logger.log_decision(
                    f"「{character_name}」定妆照生成完成",
                    f"共生成 {len(generated_images)} 张"
                )

            return GenerationResult(
                success=True,
                image_paths=generated_images,
                message=f"成功生成 {len(generated_images)} 张定妆照",
                metadata={"count": len(generated_images), "character": character_info.get("name")}
            )
        else:
            return GenerationResult(
                success=False,
                image_paths=[],
                message="定妆照生成失败"
            )

    def generate_with_face_reference(
        self,
        character_info: Dict[str, Any],
        real_person_photo_path: str,
        style: str = "modern_travel"
    ) -> GenerationResult:
        """
        使用真人参考图生成角色（基于 Gemini API）

        这是现代旅游风格的特殊功能，会保持真人脸部特征，
        仅改变服装和场景。

        Args:
            character_info: 角色信息字典
            real_person_photo_path: 真人照片路径
            style: 视觉风格（默认 modern_travel）

        Returns:
            GenerationResult
        """
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        character_name = character_info.get('name', '角色')

        # 记录开始
        if self.work_logger:
            self.work_logger.log_step(
                "generate_with_face_reference",
                f"生成「{character_name}」（带真人参考）",
                {"real_photo": real_person_photo_path, "style": style}
            )

        output_dir = self.project_path / "characters"
        output_dir.mkdir(parents=True, exist_ok=True)

        # 1. 构建prompt，要求保持人脸特征
        prompt = self._build_face_reference_prompt(character_info, style)

        # 2. 读取真人照片并转为 base64
        try:
            import base64
            with open(real_person_photo_path, 'rb') as f:
                photo_data = f.read()
                reference_image_b64 = base64.b64encode(photo_data).decode('utf-8')
        except Exception as e:
            return GenerationResult(
                success=False,
                image_paths=[],
                message=f"读取真人照片失败: {e}"
            )

        generated_images = []

        # 3. 生成定妆照（2张即可，因为有真人参考）
        for i in range(1, 3):
            print(f"🎨 正在生成定妆照（带真人参考）U{i}...")

            # 为每张图添加角度/风格变化
            variant_prompt = self._add_makeup_variant(prompt, i)

            image_path = self._generate_with_reference(
                prompt=variant_prompt,
                reference_image=reference_image_b64,
                output_path=output_dir / f"{character_name}_定妆照_真人参考_U{i}.jpg",
                size="1024x1024"
            )

            if image_path:
                generated_images.append(image_path)
                print(f"   ✅ U{i} 完成（已融合真人特征）")
            else:
                print(f"   ❌ U{i} 失败")

        if not generated_images:
            return GenerationResult(
                success=False,
                image_paths=[],
                message="定妆照生成失败"
            )

        # 4. 使用定妆照生成三视图（正常流程）
        print(f"🎨 基于定妆照生成三视图...")

        three_view_result = self.generate_base_model(
            character_info=character_info,
            reference_image=generated_images[0]
        )

        if three_view_result.success:
            all_images = generated_images + three_view_result.image_paths

            # 记录完成
            if self.work_logger:
                self.work_logger.log_decision(
                    f"「{character_name}」生成完成（带真人参考）",
                    f"定妆照 {len(generated_images)} 张 + 三视图 {len(three_view_result.image_paths)} 张"
                )

            return GenerationResult(
                success=True,
                image_paths=all_images,
                message=f"成功生成定妆照 {len(generated_images)} 张 + 三视图 {len(three_view_result.image_paths)} 张（已融合真人特征）",
                metadata={
                    "character": character_name,
                    "makeup_count": len(generated_images),
                    "three_view_count": len(three_view_result.image_paths),
                    "real_person_photo": real_person_photo_path
                }
            )
        else:
            # 三视图生成失败，但定妆照成功
            return GenerationResult(
                success=True,
                image_paths=generated_images,
                message=f"定妆照生成成功，但三视图生成失败: {three_view_result.message}",
                metadata={
                    "character": character_name,
                    "makeup_count": len(generated_images),
                    "real_person_photo": real_person_photo_path
                }
            )

    def _build_face_reference_prompt(self, character_info: Dict[str, Any], style: str) -> str:
        """构建真人参考图提示词"""
        name = character_info.get('name', '角色')
        age = character_info.get('age', '25岁')
        temperament = character_info.get('temperament', '')
        costume = character_info.get('costume', '')

        # 从 preset.yaml 加载风格特定的提示词模板
        try:
            from systems.config import StyleManager
            style_config = StyleManager.load_style(style)
            template = style_config.raw_data.get('prompt_templates', {}).get('face_reference_prompt', '')
        except:
            # 如果加载失败，使用默认模板
            template = """
Generate a character portrait based on this description:

Name: {character_name}
Age: {character_age}
Style: {character_style}
Costume: {character_costume}

IMPORTANT: Use the facial features and identity from the reference image provided.
Maintain the person's facial structure, features, and likeness while adapting
the clothing, setting, and style to match the character description above.

The result should look like the same person in the reference photo, but in
the costume and setting described.

Style: cinematic travel photography, 16:9 aspect ratio, natural lighting,
{lighting_type}, {atmosphere} atmosphere.
"""

        # 填充模板
        prompt = template.format(
            character_name=name,
            character_age=age,
            character_style=temperament,
            character_costume=costume,
            lighting_type="golden hour",
            atmosphere="serene and peaceful"
        )

        return prompt.strip()


    # ============================================================
    # 三视图生成（两步法）
    # ============================================================

    def generate_base_model(
        self,
        character_info: Dict[str, Any],
        reference_image: Path = None
    ) -> GenerationResult:
        """
        生成素模三视图（基础模型）

        这是三视图生成的第一步，生成白色/素衣的基础模型，
        确立角色的面部和身体基础特征。

        Args:
            character_info: 角色信息字典
            reference_image: 参考图片（定妆照），可选

        Returns:
            GenerationResult
        """
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        output_dir = self.project_path / "characters" / "三视图"
        output_dir.mkdir(parents=True, exist_ok=True)

        character_name = character_info.get("name", "角色")

        # 记录开始
        if self.work_logger:
            self.work_logger.log_step(
                "generate_base_model",
                f"生成「{character_name}」素模三视图",
                {"reference": str(reference_image) if reference_image else "无"}
            )

        print(f"🎨 正在生成「{character_name}」的素模三视图...")

        # 构建素模提示词
        prompt = self._build_base_model_prompt(character_info)

        # 如果有参考图，读取并使用
        reference_base64 = None
        if reference_image and Path(reference_image).exists():
            with open(reference_image, 'rb') as f:
                reference_base64 = base64.b64encode(f.read()).decode()
            print(f"📸 已加载参考图: {Path(reference_image).name}")

        output_path = output_dir / f"{character_name}_素模_三视图.jpg"

        if reference_base64:
            # 基于参考图生成
            result = self._generate_with_reference(
                prompt=prompt,
                reference_image=reference_base64,
                output_path=output_path,
                size="2048x1024"
            )
        else:
            # 纯文本生成
            result = self._generate_image(
                prompt=prompt,
                output_path=output_path,
                size="2048x1024"
            )

        if result:
            print(f"✅ 素模三视图已生成！")
            # 记录完成
            if self.work_logger:
                self.work_logger.log_decision(
                    f"「{character_name}」素模三视图生成完成",
                    f"路径: {result}"
                )
            return GenerationResult(
                success=True,
                image_paths=[result],
                message=f"素模三视图已生成",
                metadata={"character": character_name, "type": "base_model"}
            )
        else:
            if self.work_logger:
                self.work_logger.log_error("素模三视图生成失败", {"character": character_name})
            return GenerationResult(
                success=False,
                image_paths=[],
                message="素模三视图生成失败"
            )

    def generate_costume_threeview(
        self,
        base_model_path: Path,
        costume_name: str,
        character_info: Dict[str, Any] = None,
        costume_description: str = None,
        character_name: str = None,
        character_marks: List[str] = None,
        dynasty: str = None,
        gender: str = None,
        identity: str = None,
        no_hat: bool = None
    ) -> GenerationResult:
        """
        基于素模生成服装三视图

        这是三视图生成的第二步，在素模基础上添加具体服装。
        支持根据角色朝代动态匹配服装材质。

        Args:
            base_model_path: 素模三视图路径
            costume_name: 服装名称（如"日常常服"、"礼服"等）
            character_info: 角色完整信息（推荐，包含朝代、性别、身份等）
            costume_description: 服装详细描述（可选，不提供则自动生成）
            character_name: 角色名称
            character_marks: 角色关键标记（如泪痣等）
            dynasty: 朝代（可选，优先从 character_info 读取）
            gender: 性别（可选，优先从 character_info 读取）
            identity: 身份（可选，优先从 character_info 读取）
            no_hat: 是否不戴帽子（可选，None时从描述中自动检测）

        Returns:
            GenerationResult
        """
        if not self.project_path:
            raise ValueError("请先设置项目路径")

        base_path = Path(base_model_path)
        if not base_path.exists():
            raise ValueError(f"素模三视图不存在: {base_path}")

        output_dir = self.project_path / "characters" / "三视图"
        output_dir.mkdir(parents=True, exist_ok=True)

        # 从 character_info 提取信息
        if character_info:
            character_name = character_name or character_info.get("name")
            dynasty = dynasty or character_info.get("dynasty", "架空")
            gender = gender or character_info.get("gender") or ("男" if character_info.get("character_type") == "male_lead" else "女")
            identity = identity or character_info.get("identity", "日常")
            character_marks = character_marks or self._extract_marks_from_info(character_info)

        # 从文件名提取角色名（如果仍未提供）
        if not character_name:
            character_name = base_path.stem.split("_")[0]

        # 默认值
        dynasty = dynasty or "架空"
        gender = gender or "男"
        identity = identity or "日常"

        print(f"🎨 正在基于素模生成「{costume_name}」三视图...")
        print(f"   朝代: {dynasty}, 性别: {gender}, 身份: {identity}")

        # 读取素模图片
        with open(base_path, 'rb') as f:
            base_model_base64 = base64.b64encode(f.read()).decode()

        print(f"📸 已加载素模: {base_path.name}")

        # 如果未提供服装描述，则根据朝代自动生成
        if not costume_description:
            costume_description = self._generate_costume_description(
                dynasty=dynasty,
                gender=gender,
                identity=identity,
                costume_name=costume_name
            )
            print(f"   自动生成服装描述: {costume_description[:50]}...")

        # 检测是否不戴帽（从描述中提取或使用参数）
        detected_no_hat = no_hat if no_hat is not None else ("不戴帽" in costume_description or "【古装偶像剧风格，不戴帽】" in costume_description)

        # 构建服装三视图提示词（使用朝代信息）
        prompt = self._build_costume_prompt(
            costume_name=costume_name,
            costume_description=costume_description,
            character_name=character_name,
            character_marks=character_marks,
            dynasty=dynasty,
            no_hat=detected_no_hat
        )

        # 清理服装名称用于文件名
        safe_costume_name = costume_name.replace("/", "_").replace(" ", "_")
        output_path = output_dir / f"{character_name}_{safe_costume_name}_三视图.jpg"

        # 基于素模生成
        result = self._generate_with_reference(
            prompt=prompt,
            reference_image=base_model_base64,
            output_path=output_path,
            size="2048x1024"
        )

        if result:
            print(f"✅ 「{costume_name}」三视图已生成！")

            # 注册到项目配置
            if self.project_config and character_info:
                existing = self.project_config.characters.get(character_name, {})
                if "three_views" not in existing:
                    existing["three_views"] = {}
                existing["three_views"][costume_name] = str(Path(result).relative_to(self.project_path))

                # 合并角色信息
                merged_config = {**character_info, **existing}
                self.project_config.register_character(character_name, merged_config)

                if self.work_logger:
                    self.work_logger.log_step(
                        "register_character",
                        f"注册角色「{character_name}」三视图到项目",
                        {"costume": costume_name}
                    )

            return GenerationResult(
                success=True,
                image_paths=[result],
                message=f"{costume_name} 三视图已生成",
                metadata={
                    "character": character_name,
                    "costume": costume_name,
                    "dynasty": dynasty,
                    "type": "costume_threeview"
                }
            )
        else:
            return GenerationResult(
                success=False,
                image_paths=[],
                message=f"{costume_name} 三视图生成失败"
            )

    def _extract_marks_from_info(self, character_info: Dict) -> List[str]:
        """从角色信息中提取关键标记"""
        marks = []
        special_marks = character_info.get("special_marks", "")
        if special_marks:
            # 按行分割
            for line in special_marks.split("\n"):
                line = line.strip().strip("- ")
                if line:
                    marks.append(line)
        return marks

    def _generate_costume_description(
        self,
        dynasty: str,
        gender: str,
        identity: str,
        costume_name: str
    ) -> str:
        """
        根据朝代、性别、身份自动生成服装描述

        Args:
            dynasty: 朝代
            gender: 性别（"男"/"女"）
            identity: 身份标签
            costume_name: 服装名称

        Returns:
            服装描述文本
        """
        dynasty_info = self.costume_db.get_dynasty_info(dynasty)

        # 确定性别键
        gender_key = "male" if gender in ["男", "male", "male_lead"] else "female"

        # 匹配标签
        tags = [identity, "日常"]

        # 获取面料
        fabrics = self.costume_db.match_by_tags(dynasty_info.get("fabric", []), tags)
        fabric_desc = ""
        if fabrics:
            f = fabrics[0]
            fabric_desc = f"{f['name']}，{f['desc']}"

        # 获取服装形制
        patterns = dynasty_info.get("costume_patterns", {}).get(gender_key, [])
        matched_patterns = self.costume_db.match_by_tags(patterns, tags)
        pattern_desc = ""
        if matched_patterns:
            p = matched_patterns[0]
            pattern_desc = f"{p['name']}，{p['desc']}"

        # 获取配色
        colors = self.costume_db.match_by_tags(dynasty_info.get("color_palette", []), tags)
        color_desc = colors[0]["desc"] if colors else ""

        # 获取配饰
        accessories = dynasty_info.get("accessories", {}).get(gender_key, [])
        matched_acc = self.costume_db.match_by_tags(accessories, tags)
        acc_desc = matched_acc[0]["desc"] if matched_acc else ""

        # 组装描述
        parts = []
        if pattern_desc:
            parts.append(pattern_desc)
        if fabric_desc:
            parts.append(f"面料为{fabric_desc}")
        if color_desc:
            parts.append(f"配色：{color_desc}")
        if acc_desc:
            parts.append(f"配饰：{acc_desc}")

        return "。".join(parts) if parts else f"{costume_name}，符合{dynasty_info.get('dynasty_full_name', dynasty)}风格"

    # ============================================================
    # 服装建议
    # ============================================================

    def get_costume_suggestions(self, character_info: Dict[str, Any], style: str = "costume_drama") -> List[Dict[str, str]]:
        """
        获取服装搭配建议（古装偶像剧风格）

        Args:
            character_info: 角色信息
            style: 视觉风格

        Returns:
            服装建议列表
        """
        character_type = character_info.get("character_type", "male_lead")
        name = character_info.get("name", "角色")

        if style == "costume_drama":
            if character_type == "male_lead":
                return [
                    {
                        "name": "日常常服",
                        "description": "【古装偶像剧风格，不戴帽】月白暗花纱直裰，暗纹兰草，半透纱质飘逸；内搭天青暗纹棉中衣，领口袖口露1cm边；外罩银灰暗纹罗短褙子，衣长到腰下；腰系天青丝绦，挂银质玉坠；头发高束成髻，用羊脂玉簪固定，额角留细碎胎毛，颅顶饱满；整体清冷干净，镜头感强",
                        "no_hat": True
                    },
                    {
                        "name": "会客礼服",
                        "description": "【古装偶像剧风格】月白色交领宽袖长衫，暗花纱面料；外罩竹青色暗纹罗褙子，宽袖飘逸；内搭白色中衣，领口露出细边；腰系银白锦缎腰带，挂和田玉佩；头戴素色东坡巾；整体温润贵气，适合正式场合",
                        "no_hat": False
                    },
                    {
                        "name": "出行便服",
                        "description": "【古装偶像剧风格，不戴帽】朱砂红织锦窄袖圆领袍，暗纹忍冬纹，微收腰版型显肩宽腰细；内搭玄黑棉麻中衣；外罩玄黑亮面纱大袖衫，袖口衣摆绣极细赤金云纹；腰系玄黑革带，挂玉饰；头发半束，上半部分用发带固定，下半部分顺垂，额前偏分碎发，少年感强",
                        "no_hat": True
                    },
                    {
                        "name": "作坊工作服",
                        "description": "【古装偶像剧风格，不戴帽】茶白苎麻交领襕衫，自然肌理褶皱，微宽松版型；内搭松绿棉质中衣，仅露领口边；外搭驼色薄款短披，松松披在肩头；腰间松系深棕麻质腰带，挂工具布囊；头发松束脑后，用素色布带系结，额前留几缕碎发，随性慵懒",
                        "no_hat": True
                    }
                ]
            elif character_type == "female_lead":
                return [
                    {
                        "name": "日常常服",
                        "description": "【古装偶像剧风格】淡藕荷色交领襦裙，暗花纱面料；外罩月白色半臂，袖口微透；腰系淡青丝绦，挂银质步摇；头发半束，斜插银簪，额前留细碎胎毛",
                        "no_hat": True
                    },
                    {
                        "name": "外出便服",
                        "description": "【古装偶像剧风格】天青色对襟褙子，暗纹竹叶；内搭月白色交领襦裙，裙摆飘逸；腰系同色丝绦；头发高束成髻，插玉簪",
                        "no_hat": True
                    },
                    {
                        "name": "正式礼服",
                        "description": "【古装偶像剧风格】石青色织锦对襟长褙子，暗纹灵芝云；内搭月白色交领襦裙，多层纱质裙摆；腰系玉带，挂玉佩；头发全束成高髻，插金步摇",
                        "no_hat": True
                    }
                ]

        return [{"name": "默认服装", "description": "根据角色身份搭配的日常服装"}]

    def get_regional_costume_description(
        self,
        region: str,
        gender: str,
        tags: List[str] = None
    ) -> str:
        """
        获取地域特色服装描述（仅用于modern_travel风格）

        Args:
            region: 地域名（如"云南大理"）
            gender: 性别
            tags: 标签列表（如["春夏", "休闲"]）

        Returns:
            服装描述文本
        """
        if isinstance(self.costume_db, RegionalCostumeDB):
            return self.costume_db.get_costume_description(region, gender, tags)
        else:
            return "现代旅拍休闲装"

    # ============================================================
    # 提示词构建
    # ============================================================

    def _build_makeup_prompt(self, character_info: Dict[str, Any], style: str) -> str:
        """构建定妆照提示词"""
        name = character_info.get("name", "角色")
        age = character_info.get("age_range", "25-30岁")
        archetype = character_info.get("archetype", "")
        appearance = character_info.get("appearance", "")
        special_marks = character_info.get("special_marks", "")
        costume = character_info.get("costume", "")
        temperament = character_info.get("temperament", [])

        style_map = {
            "costume_drama": "宋代古装剧风格（知否/清平乐）",
            "wasteland": "未来废土风格（赛博朋克）"
        }
        style_desc = style_map.get(style, "宋代古装剧风格")

        marks_section = ""
        if special_marks:
            marks_section = f"\n【关键标记 - 必须呈现】\n{special_marks}"

        temperament_text = "、".join(temperament) if temperament else ""

        prompt = f"""{style_desc}角色定妆照，高质量写实摄影风格。

【角色信息】
- 姓名：{name}
- 年龄：{age}
- 身份：{archetype}
- 气质：{temperament_text}

【外貌特征】
{appearance}
{marks_section}

【服装造型】
{costume}

【场景氛围】
- 江南园林或简约背景
- 柔和自然光，中性色温5500K
- 电影质感，胶片颗粒
- 知否/清平乐风格

【技术要求】
- 写实摄影风格，非插画
- 半身像构图
- 正面或微侧角度
- 面部清晰可见，细节丰富
- 1024x1024分辨率"""

        return prompt

    def _add_makeup_variant(self, base_prompt: str, variant_index: int) -> str:
        """为定妆照提示词添加变体"""
        variants = [
            "\n\n【本次变体】正面角度，主光从右侧45度打入，柔和眼神，自然表情",
            "\n\n【本次变体】微侧45度角，展现侧脸轮廓，主光从左侧打入，略带笑意",
            "\n\n【本次变体】正面近景，特写面部细节，正面柔光，沉稳内敛表情",
            "\n\n【本次变体】微侧角度，眼神带风流意，嘴角微扬，三分笑意"
        ]

        if 1 <= variant_index <= len(variants):
            return base_prompt + variants[variant_index - 1]
        return base_prompt

    def _build_base_model_prompt(self, character_info: Dict[str, Any]) -> str:
        """构建素模三视图提示词"""
        name = character_info.get("name", "角色")
        age = character_info.get("age_range", "25-30岁")
        appearance = character_info.get("appearance", "")
        special_marks = character_info.get("special_marks", "")

        marks_section = ""
        if special_marks:
            marks_section = f"\n【角色关键标记 - 三个视角都必须准确呈现】\n{special_marks}"

        prompt = f"""生成角色素模三视图。全程禁止在画面中生成任何文字、标注、指引线、说明性内容，不得添加任何提示词未提及的角色特征。画面仅保留角色和背景。

【角色】{name}，{age}

【外貌特征 - 三个视角保持100%一致】
{appearance}
{marks_section}

【素模服装要求】
- 全身白色/米白色素衣，无花纹装饰，无刺绣
- 传统棉麻或素绸材质，哑光质感，无现代面料光泽
- 服装贴身但不紧身，自然垂坠
- 用于确立角色基础面部和身体特征

【三视图布局（横版 2048x1024）】
- 左侧：正面全身像，双臂自然下垂
- 中间：侧面全身像（右侧脸），双臂自然下垂
- 右侧：背面全身像
- 三个姿态高度一致，比例相同

【技术要求】
- 纯白或浅灰纯色背景，无杂物
- 光线均匀柔和，无强烈阴影
- 写实摄影风格，非插画
- 角色特征在三个视角中完全一致"""

        return prompt

    def _build_costume_prompt(
        self,
        costume_name: str,
        costume_description: str,
        character_name: str,
        character_marks: List[str] = None,
        dynasty: str = None,
        no_hat: bool = False
    ) -> str:
        """
        构建服装三视图提示词

        Args:
            costume_name: 服装名称
            costume_description: 服装描述
            character_name: 角色名称
            character_marks: 角色关键标记
            dynasty: 朝代（用于动态匹配材质要求）
            no_hat: 是否不戴帽子
        """
        # 获取朝代信息
        dynasty = dynasty or "架空"
        dynasty_info = self.costume_db.get_dynasty_info(dynasty)
        dynasty_full_name = dynasty_info.get("dynasty_full_name", dynasty)
        general_style = dynasty_info.get("general_style", "传统古风风格")

        marks_text = ""
        if character_marks:
            marks_text = "\n【角色关键标记 - 必须保持一致】\n" + "\n".join(f"- {mark}" for mark in character_marks)

        # 获取该朝代的面料特征
        fabrics = dynasty_info.get("fabric", [])
        fabric_examples = []
        for f in fabrics[:3]:  # 取前3个面料作为示例
            fabric_examples.append(f"  · {f['name']}：{f['desc']}")
        fabric_examples_text = "\n".join(fabric_examples) if fabric_examples else "  · 传统丝绸：光泽柔和，质地顺滑"

        # 处理不戴帽的情况
        hat_negative = ""
        if no_hat:
            hat_negative = """
【发型要求 - 不戴帽子】
- 禁止任何形式的帽子、幞头、冠、巾
- 头发用发簪或发带束起，露出完整面部
- 发型要与服装风格协调，体现古装偶像剧的帅气感"""

        prompt = f"""基于提供的素模三视图，为角色{character_name}添加服装，生成「{costume_name}」三视图。

⚠️ 【禁止事项 - 最高优先级】
全程禁止在画面中生成任何文字、标题、标注、指引线、说明性内容。
不得添加任何提示词未提及的角色特征或标注。
画面仅保留角色和背景。

【角色固定要求（必须100%保持一致）】
- 完全保留素模的脸型、五官、肤色
- 身高、体型、身体比例不变
{marks_text}
{hat_negative}

【服装设计】{costume_name}
{costume_description}

【{dynasty_full_name}服装材质要求 - 极其重要】
整体风格：{general_style}

面料必须呈现传统材质质感：
{fabric_examples_text}

严禁出现现代面料特征：
  · 禁止化纤、涤纶的强烈镜面反光
  · 禁止西装面料的现代质感
  · 禁止塑料感、人造光泽

【三视图布局要求】
- 左：正面全身
- 中：侧面全身（右侧脸）
- 右：背面全身
- 三个视角的服装完全统一：颜色、款式、材质、褶皱、垂坠感一致

【技术要求】
- 纯白/浅灰色纯色背景，无杂物
- 光线均匀柔和，无硬阴影
- 写实摄影风格，电影质感
- 1024x1024 正方形构图"""

        return prompt

    # ============================================================
    # 底层图片生成
    # ============================================================

    def _generate_image(self, prompt: str, output_path: Path, size: str = "1024x1024") -> Optional[Path]:
        """生成图片（纯文本提示词）"""
        try:
            response = requests.post(
                f"{self.API_BASE}/images/generations",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.MODEL_IMAGE,
                    "prompt": prompt,
                    "n": 1,
                    "size": size
                },
                timeout=300
            )

            result = response.json()

            if "data" in result and len(result["data"]) > 0:
                image_data = result["data"][0]

                if "b64_json" in image_data:
                    with open(output_path, "wb") as f:
                        f.write(base64.b64decode(image_data["b64_json"]))
                    return output_path
                elif "url" in image_data:
                    img_response = requests.get(image_data["url"], timeout=60)
                    with open(output_path, "wb") as f:
                        f.write(img_response.content)
                    return output_path

            return None

        except Exception as e:
            print(f"   ❌ 异常: {e}")
            return None

    def _generate_with_reference(
        self,
        prompt: str,
        reference_image: str,
        output_path: Path,
        size: str = "2048x1024"
    ) -> Optional[Path]:
        """
        基于参考图生成图片

        Args:
            prompt: 提示词
            reference_image: 参考图的 base64 编码
            output_path: 输出路径
            size: 图片尺寸

        Returns:
            生成的图片路径，失败返回 None
        """
        try:
            # 方法1: 尝试 images/edits 端点
            response = requests.post(
                f"{self.API_BASE}/images/edits",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.MODEL_IMAGE,
                    "prompt": prompt,
                    "image": reference_image,
                    "n": 1,
                    "size": size
                },
                timeout=300
            )

            result = response.json()

            if "data" in result and len(result["data"]) > 0:
                image_data = result["data"][0]

                if "b64_json" in image_data:
                    with open(output_path, "wb") as f:
                        f.write(base64.b64decode(image_data["b64_json"]))
                    return output_path
                elif "url" in image_data:
                    img_response = requests.get(image_data["url"], timeout=60)
                    with open(output_path, "wb") as f:
                        f.write(img_response.content)
                    return output_path

            # 如果 images/edits 不可用，尝试多模态对话
            if "error" in result:
                print(f"   ⚠️ images/edits 不可用，尝试多模态对话...")
                return self._generate_via_chat(prompt, reference_image, output_path, size)

            return None

        except Exception as e:
            print(f"   ❌ 异常: {e}")
            return None

    def _generate_via_chat(
        self,
        prompt: str,
        reference_image: str,
        output_path: Path,
        size: str = "2048x1024"
    ) -> Optional[Path]:
        """通过 chat/completions 多模态 API 生成图片"""
        try:
            response = requests.post(
                f"{self.API_BASE}/chat/completions",
                headers={
                    "Authorization": f"Bearer {self.api_key}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": self.MODEL_IMAGE,
                    "messages": [
                        {
                            "role": "user",
                            "content": [
                                {"type": "text", "text": prompt},
                                {
                                    "type": "image_url",
                                    "image_url": {
                                        "url": f"data:image/jpeg;base64,{reference_image}"
                                    }
                                }
                            ]
                        }
                    ],
                    "max_tokens": 4096
                },
                timeout=300
            )

            result = response.json()

            if "choices" in result and len(result["choices"]) > 0:
                content = result["choices"][0].get("message", {}).get("content", "")

                # 如果返回的是 base64 图片数据
                if content.startswith("data:image") or len(content) > 1000:
                    if "base64," in content:
                        b64_data = content.split("base64,")[1]
                    else:
                        b64_data = content

                    try:
                        with open(output_path, "wb") as f:
                            f.write(base64.b64decode(b64_data))
                        return output_path
                    except:
                        pass

            return None

        except Exception as e:
            print(f"   ❌ 多模态生成异常: {e}")
            return None
