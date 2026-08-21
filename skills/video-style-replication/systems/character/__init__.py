"""
角色图片生成系统
====================================================
生成角色定妆照和三视图。

用法：
    from systems.character import CharacterGenerator

    generator = CharacterGenerator(project_path)

    # 生成定妆照
    images = generator.generate_makeup_images(character_info, count=4)

    # 基于定妆照生成三视图
    threeview = generator.generate_threeview(makeup_image_path)

地域特色服装（modern_travel风格）：
    from systems.character import RegionalCostumeDB

    db = RegionalCostumeDB()
    costume = db.get_costume_description("云南大理", "female", ["春夏"])
"""

from .generator import CharacterGenerator
from .regional_costume_db import RegionalCostumeDB

__all__ = ["CharacterGenerator", "RegionalCostumeDB"]
