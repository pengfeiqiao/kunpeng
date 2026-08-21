"""
光影系统 V2 — 通用场景适配
====================================================
支持多种场景类型的光影配置，基于豆包专业建议优化。

场景类型：
    - indoor_daytime: 室内白天（官署、书房、茶寮）
    - indoor_nighttime: 室内夜晚（烛光书房）
    - indoor_nighttime_lantern: 室内夜晚（灯笼街道）
    - outdoor_daytime: 室外白天（街市、园林、郊外）
    - outdoor_nighttime: 室外夜晚（月夜）
    - outdoor_nighttime_festival: 室外夜晚（灯会）

情绪模式：
    - normal: 日常
    - warm: 温馨/明快
    - tense: 压抑/悬疑
    - solemn: 肃穆

用法：
    from systems.lighting import get_lighting_prompt

    # 基础用法
    prompt = get_lighting_prompt("wide", "indoor_daytime")

    # 带情绪模式
    prompt = get_lighting_prompt("wide", "indoor_nighttime", mood="tense")

    # 获取关键词
    keywords = get_lighting_keywords("indoor_daytime", mood="warm")
"""

from typing import Dict, Any, Optional
from dataclasses import dataclass


@dataclass
class LightingConfig:
    """光影配置"""
    key_light: str
    fill_light: str
    ambient: str
    shadow: str
    description: str


# ============================================================
# 场景光影预设（基于豆包专业建议）
# ============================================================

SCENE_LIGHTING_PRESETS: Dict[str, LightingConfig] = {
    # 室内白天
    "indoor_daytime": LightingConfig(
        key_light="5600K neutral natural daylight from high windows, left-above 30°, soft quality, intensity 60%",
        fill_light="5200K soft bounce light from walls, right-side fill, intensity 25%",
        ambient="subtle skylight from windows, intensity 15%",
        shadow="soft shadows, low contrast, natural falloff",
        description="Neutral natural lighting, soft shadows, even illumination, daylight interior"
    ),

    # 室内夜晚 - 烛光
    "indoor_nighttime": LightingConfig(
        key_light="2700K warm candlelight point source, height 1.2-1.5m, soft edge falloff, 1-meter range brightness decay, intensity 50%",
        fill_light="6500K cold blue skylight weak fill through windows, intensity 30%",
        ambient="faint warm glow from nearby light sources, intensity 20%",
        shadow="medium-soft shadows, high contrast, warm-cool color contrast",
        description="Warm intimate candlelit atmosphere, deep shadows, warm-cool contrast"
    ),

    # 室内夜晚 - 灯笼街道
    "indoor_nighttime_lantern": LightingConfig(
        key_light="2600K lantern warm light point sources, scattered distribution, light decays with distance, intensity 45%",
        fill_light="7000K cold blue ambient weak fill, intensity 30%",
        ambient="scattered warm glow from multiple lanterns, intensity 25%",
        shadow="medium shadows, dappled light and shadow, warm-cold contrast 1:1",
        description="Lantern-lit interior, scattered warm light pools, atmospheric shadows"
    ),

    # 室外白天
    "outdoor_daytime": LightingConfig(
        key_light="6000K sunlight from above-side 45°, medium-hard quality, intensity 70%",
        fill_light="5500K sky bounce fill light, intensity 20%",
        ambient="ambient skylight, intensity 10%",
        shadow="medium-hard shadows, natural light-dark gradation, 30% sky scattering",
        description="Bright natural daylight, defined shadows, natural contrast"
    ),

    # 室外夜晚 - 月夜
    "outdoor_nighttime": LightingConfig(
        key_light="7000K cold blue moonlight from above-side 20°, hard quality, intensity 40%",
        fill_light="3000K weak warm ground light (distant lamps/lanterns), intensity 35%",
        ambient="cold starlight, intensity 25%",
        shadow="hard shadows, low brightness, high contrast",
        description="Cold moonlit night with distant warm accent lights, high contrast"
    ),

    # 室外夜晚 - 灯会
    "outdoor_nighttime_festival": LightingConfig(
        key_light="7000K cold blue moonlight overhead, intensity 30%",
        fill_light="2500K colorful lantern point sources scattered, warm-cold contrast 1:1, intensity 40%",
        ambient="warm festive glow, light and shadow dappled, intensity 30%",
        shadow="varied shadows from multiple light sources, festive atmosphere",
        description="Festival night with colorful lanterns, warm-cold contrast, joyful atmosphere"
    ),
}

# ============================================================
# 情绪模式调整
# ============================================================

MOOD_MODIFIERS = {
    "normal": {
        "adjustment": "",
        "keywords": ""
    },
    "warm": {
        "adjustment": "soft light ratio 80%, shadow edges softened, warm-cold contrast 1:2, low saturation warm tone",
        "keywords": "soft lighting, warm atmosphere, gentle shadows, cozy feeling"
    },
    "tense": {
        "adjustment": "hard light ratio 90%, sharp shadows, warm-cold contrast 3:1, high contrast, deep blacks",
        "keywords": "dramatic lighting, harsh shadows, tense atmosphere, film noir style"
    },
    "solemn": {
        "adjustment": "overhead light 10°, hard shadows, low saturation, contrast maximized",
        "keywords": "solemn lighting, formal atmosphere, dignified, ceremonial"
    }
}

# ============================================================
# 景别适配
# ============================================================

SHOT_TYPE_ADAPTATIONS = {
    "closeup": "Focus on face illumination, catch lights in eyes, skin subsurface scattering visible",
    "medium": "Upper body and hands illuminated naturally, clear facial expression lighting",
    "wide": "Full scene and environment lighting, spatial depth through light and shadow"
}


def get_lighting_prompt(
    shot_type: str,
    scene_type: str = "indoor_daytime",
    mood: str = "normal",
    include_keywords: bool = True
) -> str:
    """
    生成光影提示词

    Args:
        shot_type: 景别 "wide" | "medium" | "closeup"
        scene_type: 场景类型（见 SCENE_LIGHTING_PRESETS）
        mood: 情绪模式 "normal" | "warm" | "tense" | "solemn"
        include_keywords: 是否包含关键词

    Returns:
        光影提示词
    """
    # 标准化输入
    shot_type = shot_type.lower().strip()
    if shot_type not in ("wide", "medium", "closeup"):
        shot_type = "wide"

    # 获取场景配置
    config = SCENE_LIGHTING_PRESETS.get(scene_type, SCENE_LIGHTING_PRESETS["indoor_daytime"])

    # 获取情绪调整
    mood_mod = MOOD_MODIFIERS.get(mood, MOOD_MODIFIERS["normal"])

    # 获取景别适配
    shot_adapt = SHOT_TYPE_ADAPTATIONS.get(shot_type, SHOT_TYPE_ADAPTATIONS["wide"])

    # 构建提示词
    parts = [
        "=== LIGHTING SYSTEM ===",
        f"Scene Type: {scene_type}",
        f"Mood: {mood}",
        "",
        f"KEY LIGHT: {config.key_light}",
        f"FILL LIGHT: {config.fill_light}",
        f"AMBIENT: {config.ambient}",
        f"SHADOW: {config.shadow}",
        "",
        f"Shot Adaptation: {shot_adapt}",
        f"Description: {config.description}",
    ]

    # 添加情绪调整
    if mood_mod["adjustment"]:
        parts.extend([
            "",
            f"Mood Adjustment: {mood_mod['adjustment']}"
        ])

    # 添加关键词
    if include_keywords and mood_mod["keywords"]:
        parts.extend([
            "",
            f"Style Keywords: {config.description}, {mood_mod['keywords']}"
        ])

    return "\n".join(parts)


def get_lighting_config(scene_type: str) -> LightingConfig:
    """获取场景光影配置"""
    return SCENE_LIGHTING_PRESETS.get(scene_type, SCENE_LIGHTING_PRESETS["indoor_daytime"])


def get_lighting_keywords(scene_type: str, mood: str = "normal") -> str:
    """获取光影关键词（用于提示词拼接）"""
    config = SCENE_LIGHTING_PRESETS.get(scene_type, SCENE_LIGHTING_PRESETS["indoor_daytime"])
    mood_mod = MOOD_MODIFIERS.get(mood, MOOD_MODIFIERS["normal"])

    keywords = [config.description]
    if mood_mod["keywords"]:
        keywords.append(mood_mod["keywords"])

    return ", ".join(keywords)


def list_scene_types() -> list:
    """列出所有场景类型"""
    return list(SCENE_LIGHTING_PRESETS.keys())


def list_moods() -> list:
    """列出所有情绪模式"""
    return list(MOOD_MODIFIERS.keys())


# ============================================================
# 兼容旧版接口
# ============================================================

def get_legacy_lighting_prompt(shot_type: str) -> str:
    """兼容旧版雪夜糕团铺场景的接口"""
    return """=== LIGHTING SYSTEM (Three-Source — Fixed for All Shots) ===
KEY LIGHT: warm amber 3200K from shop interior, left-above 45 degrees outward, intensity 55%
FILL LIGHT: charcoal basin firelight 2800K, below-right toward face/hands, intensity 20%
AMBIENT: cold blue 5800K overcast sky, right-above 15 degrees, intensity 25%
Cold-warm ratio: 3:1."""
