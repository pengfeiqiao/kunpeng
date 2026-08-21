"""
现代在地特色服装数据库
====================================================
管理现代旅拍中的地域特色服装数据。

用法：
    from systems.character import RegionalCostumeDB

    db = RegionalCostumeDB()
    info = db.get_regional_info("云南大理")
    costume = db.get_costume_description("云南大理", "female", ["春夏"])
"""

import json
from pathlib import Path
from typing import Dict, List, Optional


class RegionalCostumeDB:
    """现代地域特色服装数据库"""

    def __init__(self):
        self.db_path = Path(__file__).parent.parent.parent / "database" / "costumes" / "regional_modern_costume_db.json"
        self._db = None

    def load(self) -> Dict:
        """
        加载数据库

        Returns:
            地域服装数据库字典
        """
        if self._db is None:
            with open(self.db_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                self._db = data.get("regional_modern_costume_db", {})
        return self._db

    def get_regional_info(self, region: str) -> Dict:
        """
        获取地域服装信息（支持模糊匹配）

        Args:
            region: 地域名（如"大理"、"云南大理"）

        Returns:
            地域服装信息字典，未找到返回"现代通用"
        """
        db = self.load()

        # 精确匹配
        if region in db:
            return db[region]

        # 模糊匹配（包含关系）
        for key in db:
            if region in key or key in region:
                return db[key]

        # 默认返回现代通用
        return db.get("现代通用", {})

    def match_by_tags(self, items: List[Dict], tags: List[str]) -> List[Dict]:
        """
        根据标签匹配素材（智能权重匹配）

        Args:
            items: 物品列表（每个物品有name, description, tags字段）
            tags: 需要匹配的标签列表

        Returns:
            匹配的物品列表（按匹配度排序，最匹配的在前面）
        """
        if not tags:
            return items

        # 计算每个物品的匹配分数
        scored_items = []
        for item in items:
            item_tags = item.get("tags", [])

            # 特殊标签"通用"匹配所有
            if "通用" in item_tags:
                scored_items.append((item, 999))  # 高分但不是最高
                continue

            # 计算交集数量（匹配度）
            intersection = set(item_tags) & set(tags)
            score = len(intersection)

            if score > 0:
                scored_items.append((item, score))

        # 按分数降序排序
        scored_items.sort(key=lambda x: x[1], reverse=True)

        # 返回排序后的物品列表
        if scored_items:
            return [item for item, score in scored_items]
        else:
            return items  # 无匹配返回全部

    def get_costume_description(
        self,
        region: str,
        gender: str,
        tags: List[str] = None,
        detail_level: str = "medium",
        max_length: int = 500
    ) -> str:
        """
        生成地域服装描述（增强版）

        Args:
            region: 地域名
            gender: 性别（"male"/"female"）
            tags: 标签列表（如["春夏", "休闲"]）
            detail_level: 详细程度（"simple"/"medium"/"detailed"/"outfit"）
                - simple: 仅基础描述（兼容现有逻辑）
                - medium: 添加廓形+面料组合（推荐）
                - detailed: 完整设计细节（用于AI生成）
                - outfit: 完整穿搭方案（包含穿搭组合、配色、造型、场景）
            max_length: 控制描述最大长度

        Returns:
            服装描述文本
        """
        info = self.get_regional_info(region)

        # 根据详细度选择生成逻辑
        if detail_level == "simple":
            return self._simple_description(info, gender, tags)
        elif detail_level == "medium":
            raw_desc = self._medium_description(info, gender, tags)
        elif detail_level == "detailed":
            raw_desc = self._detailed_description(info, gender, tags)
        elif detail_level == "outfit":
            raw_desc = self._outfit_description(info, gender, tags)
        else:
            raw_desc = self._medium_description(info, gender, tags)

        # 长度控制
        if len(raw_desc) > max_length:
            return self._compress_description(raw_desc, max_length)

        return raw_desc

    def _simple_description(self, info: Dict, gender: str, tags: List[str]) -> str:
        """简单描述（兼容现有逻辑）"""
        anchors = info.get("core_anchors", [])
        anchors_str = "、".join(anchors[:2]) if anchors else ""

        gender_key = "male" if gender in ["男", "male", "male_lead"] else "female"
        costume_solutions = info.get("costume_solutions", {}).get(gender_key, [])

        if tags:
            matched = self.match_by_tags(costume_solutions, tags)
        else:
            matched = costume_solutions

        if matched:
            costume = matched[0]
            desc = costume.get("description", "")
            fusion = costume.get("fusion_ratio", "3:7原则")
            return f"{desc}（{fusion}，{anchors_str}）"

        return f"现代旅拍休闲装（{anchors_str}）"

    def _medium_description(self, info: Dict, gender: str, tags: List[str]) -> str:
        """中等详细度：基础描述 + 廓形 + 面料组合"""
        parts = []

        # 1. 基础描述
        base_desc = self._simple_description(info, gender, tags)
        parts.append(base_desc)

        # 2. 获取design_details
        gender_key = "male" if gender in ["男", "male", "male_lead"] else "female"
        costume_solutions = info.get("costume_solutions", {}).get(gender_key, [])

        if tags:
            matched = self.match_by_tags(costume_solutions, tags)
        else:
            matched = costume_solutions

        if matched and "design_details" in matched[0]:
            design = matched[0]["design_details"]

            # 添加廓形
            silhouette = design.get("silhouette", {})
            if silhouette:
                sil_type = silhouette.get("type", "")
                sil_desc = silhouette.get("description", "")
                parts.append(f"廓形：{sil_type}，{sil_desc}")

            # 添加面料组合
            fabric_layers = design.get("fabric_layers", [])
            if fabric_layers:
                fabric_parts = []
                for layer in fabric_layers:
                    layer_name = layer.get("layer", "").upper()
                    item = layer.get("item", "")
                    material = layer.get("material", "")
                    color = layer.get("color", "")
                    fabric_parts.append(f"【{layer_name}层】{item} {material}材质 {color}配色")
                parts.append(" | ".join(fabric_parts))

        return " | ".join(parts)

    def _detailed_description(self, info: Dict, gender: str, tags: List[str]) -> str:
        """完整设计细节：用于AI生成"""
        parts = []

        # 获取costume和design_details
        gender_key = "male" if gender in ["男", "male", "male_lead"] else "female"
        costume_solutions = info.get("costume_solutions", {}).get(gender_key, [])

        if tags:
            matched = self.match_by_tags(costume_solutions, tags)
        else:
            matched = costume_solutions

        if not matched:
            return self._simple_description(info, gender, tags)

        costume = matched[0]
        design = costume.get("design_details", {})

        if not design:
            # 如果没有design_details，降级到medium
            return self._medium_description(info, gender, tags)

        # 1. 廓形
        silhouette = design.get("silhouette", {})
        if silhouette:
            sil_type = silhouette.get("type", "")
            sil_desc = silhouette.get("description", "")
            sil_weight = silhouette.get("visual_weight", "")
            parts.append(f"【廓形】{sil_type}轮廓，{sil_desc}，{sil_weight}视觉平衡")

        # 2. 面料层次
        fabric_layers = design.get("fabric_layers", [])
        if fabric_layers:
            layer_parts = []
            for layer in fabric_layers:
                layer_name = layer.get("layer", "").upper()
                item = layer.get("item", "")
                material = layer.get("material", "")
                color = layer.get("color", "")
                texture = layer.get("texture", "")
                pattern = layer.get("pattern", "")
                fit = layer.get("fit", "")
                special = layer.get("special_treatment", "")

                desc_parts = [f"【{layer_name}层】{item} {material}材质 {color}配色 {texture}质感"]
                if pattern:
                    desc_parts.append(f"图案：{pattern}")
                if fit:
                    desc_parts.append(f"版型：{fit}")
                if special:
                    desc_parts.append(f"工艺：{special}")

                layer_parts.append(" ".join(desc_parts))
            parts.append("\n".join(layer_parts))

        # 3. 结构打破
        structure_breaks = design.get("structure_breaks", [])
        if structure_breaks:
            break_parts = []
            for sb in structure_breaks:
                sb_type = sb.get("type", "")
                sb_loc = sb.get("location", "")
                sb_desc = sb.get("description", "")
                break_parts.append(f"【结构打破】{sb_type}设计（{sb_loc}）：{sb_desc}")
            parts.append("\n".join(break_parts))

        # 4. 肌理细节
        texture_details = design.get("texture_details", [])
        if texture_details:
            texture_parts = []
            for td in texture_details:
                td_type = td.get("type", "")
                td_loc = td.get("location", "")
                td_desc = td.get("description", "")
                texture_parts.append(f"{td_type}（{td_loc}）：{td_desc}")
            parts.append(f"【肌理细节】{'；'.join(texture_parts)}")

        # 5. 层次搭配
        layering_logic = design.get("layering_logic", {})
        if layering_logic:
            base_vis = layering_logic.get("base_visibility", "")
            outer_dom = layering_logic.get("outer_dominance", "")
            color_int = layering_logic.get("color_interaction", "")
            parts.append(f"【层次搭配】内层露出：{base_vis}，外层占比：{outer_dom}，配色关系：{color_int}")

        # 6. 文化融合
        cultural_integration = design.get("cultural_integration", {})
        if cultural_integration:
            elements = cultural_integration.get("elements", [])
            application = cultural_integration.get("application", "")
            ratio = cultural_integration.get("ratio", "")
            parts.append(f"【文化融合】在地元素：{'，'.join(elements)}，应用方式：{application}，融合比例：{ratio}")

        return "\n\n".join(parts)

    def _outfit_description(self, info: Dict, gender: str, tags: List[str]) -> str:
        """完整穿搭方案：包含主题、穿搭组合、配色、造型、场景"""
        parts = []

        # 获取costume和outfit_combination
        gender_key = "male" if gender in ["男", "male", "male_lead"] else "female"
        costume_solutions = info.get("costume_solutions", {}).get(gender_key, [])

        if tags:
            matched = self.match_by_tags(costume_solutions, tags)
        else:
            matched = costume_solutions

        if not matched:
            return self._detailed_description(info, gender, tags)

        costume = matched[0]

        # 检查是否有outfit_combination
        if "outfit_combination" not in costume:
            # 如果没有，降级到detailed
            return self._detailed_description(info, gender, tags)

        outfit = costume.get("outfit_combination", {})

        # 1. 主题
        theme = outfit.get("theme", "")
        if theme:
            parts.append(f"【主题】{theme}")

        # 2. 穿搭组合
        outfit_parts = []
        upper = outfit.get("upper", {})
        if upper:
            upper_desc = f"{upper.get('item', '')}（{upper.get('fit', '')}版型，{upper.get('material', '')}面料，{upper.get('design', '')}）"
            outfit_parts.append(f"上装：{upper_desc}")

        lower = outfit.get("lower", {})
        if lower:
            lower_desc = f"{lower.get('item', '')}（{lower.get('fit', '')}版型，{lower.get('material', '')}面料，{lower.get('design', '')}）"
            outfit_parts.append(f"下装：{lower_desc}")

        accessories = outfit.get("accessories", [])
        if accessories:
            outfit_parts.append(f"配饰：{' + '.join(accessories)}")

        footwear = outfit.get("footwear", "")
        if footwear:
            outfit_parts.append(f"鞋履：{footwear}")

        parts.append("【穿搭组合】\n" + "\n".join(outfit_parts))

        # 3. 配色方案
        color_scheme = costume.get("color_scheme", {})
        if color_scheme:
            primary = color_scheme.get("primary", "")
            secondary = color_scheme.get("secondary", "")
            accent = color_scheme.get("accent", "")
            desc = color_scheme.get("description", "")
            parts.append(f"【配色方案】{primary} + {secondary} + {accent}\n{desc}")

        # 4. 整体造型
        styling = costume.get("styling", {})
        if styling:
            overall_look = styling.get("overall_look", "")
            parts.append(f"【整体造型】{overall_look}")

        # 5. 时尚元素
        fashion_elements = styling.get("fashion_elements", [])
        if fashion_elements:
            parts.append("【时尚元素】\n" + "\n".join([f"- {elem}" for elem in fashion_elements]))

        # 6. 在地元素
        local_elements = styling.get("local_elements", [])
        if local_elements:
            parts.append("【在地元素】\n" + "\n".join([f"- {elem}" for elem in local_elements]))

        # 7. 场景适配
        scene_adaptation = costume.get("scene_adaptation", {})
        if scene_adaptation:
            scene = scene_adaptation.get("scene", "")
            mood = scene_adaptation.get("mood", "")
            photo_tips = scene_adaptation.get("photo_tips", "")
            lighting = scene_adaptation.get("lighting", "")
            poses = scene_adaptation.get("poses", [])

            scene_parts = []
            if scene:
                scene_parts.append(f"场景：{scene}")
            if mood:
                scene_parts.append(f"氛围：{mood}")
            if lighting:
                scene_parts.append(f"光线：{lighting}")
            if photo_tips:
                scene_parts.append(f"拍照建议：{photo_tips}")
            if poses:
                scene_parts.append(f"推荐姿态：{'、'.join(poses)}")

            parts.append("【场景适配】\n" + "\n".join(scene_parts))

        # 8. 文化禁忌检查
        design_details = costume.get("design_details", {})
        if design_details:
            is_safe = self.check_cultural_taboos(design_details, info.get("region_full_name", ""))
            if is_safe:
                parts.append("【文化禁忌】\n✅ 已通过检查（无触犯禁忌）")
                elements = design_details.get("cultural_integration", {}).get("elements", [])
                if elements:
                    parts[-1] += f"\n使用安全元素：{'、'.join(elements)}"

        return "\n\n".join(parts)

    def _compress_description(self, desc: str, max_len: int) -> str:
        """智能压缩描述"""
        lines = desc.split("\n")
        priority_order = [
            "廓形", "面料层次", "文化融合",  # 高优先级
            "肌理细节", "层次搭配",         # 中优先级
            "结构打破"                      # 低优先级
        ]

        compressed = []
        current_len = 0

        for section in priority_order:
            matching_lines = [l for l in lines if section in l]
            for line in matching_lines:
                if current_len + len(line) <= max_len:
                    compressed.append(line)
                    current_len += len(line)

        return "\n".join(compressed) if compressed else desc[:max_len]

    def check_cultural_taboos(self, design_details: Dict, region: str) -> bool:
        """
        检查文化禁忌（基于豆包提供的清单）

        Args:
            design_details: 设计详情字典
            region: 地域名

        Returns:
            True表示通过检查，False表示触犯禁忌
        """
        taboos = self.load_cultural_taboos(region)
        elements = design_details.get("cultural_integration", {}).get("elements", [])

        for element in elements:
            if any(taboo in element for taboo in taboos):
                return False  # 触犯禁忌
        return True  # 通过检查

    def load_cultural_taboos(self, region: str) -> List[str]:
        """
        加载文化禁忌清单（豆包提供）

        Args:
            region: 地域名

        Returns:
            文化禁忌列表
        """
        db = self.load()

        # 尝试从顶层cultural_taboos读取
        if "cultural_taboos" in db:
            return db["cultural_taboos"].get(region, [])

        # 默认禁忌（如果数据库中没有）
        default_taboos = {
            "云南大理": [
                "本主庙祭祀图案",
                "婚礼服专属元素",
                "未简化的宗教符号",
                "部族专属图腾"
            ],
            "云南迪庆": [
                "六字真言",
                "法轮",
                "活佛服饰",
                "法会专用服饰",
                "经幡"
            ],
            "云南丽江": [
                "东巴文（未正确使用）",
                "纳西族宗教神祗图案",
                "祭天仪式服饰",
                "神路图"
            ]
        }

        return default_taboos.get(region, [])

    def get_accessories(
        self,
        region: str,
        tags: List[str] = None
    ) -> List[Dict]:
        """
        获取地域配饰列表

        Args:
            region: 地域名
            tags: 标签列表（如["女性", "头部配饰"]）

        Returns:
            配饰列表
        """
        info = self.get_regional_info(region)
        accessories = info.get("accessories", [])

        if tags:
            return self.match_by_tags(accessories, tags)

        return accessories

    def get_shooting_scenes(self, region: str) -> List[Dict]:
        """
        获取地域拍摄场景列表

        Args:
            region: 地域名

        Returns:
            拍摄场景列表
        """
        info = self.get_regional_info(region)
        return info.get("shooting_scenes", [])

    def get_cultural_notes(self, region: str) -> str:
        """
        获取地域文化注意事项

        Args:
            region: 地域名

        Returns:
            文化注意事项文本
        """
        info = self.get_regional_info(region)
        return info.get("cultural_notes", "")

    def list_available_regions(self) -> List[str]:
        """
        列出所有可用地域

        Returns:
            地域名列表
        """
        db = self.load()
        return list(db.keys())
