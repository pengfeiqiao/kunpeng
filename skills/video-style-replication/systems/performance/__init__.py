"""
表演系统
====================================================
支持多种情绪状态和动作描述，解决角色表演僵硬问题。

情绪模板：
    - distressed: 痛苦/濒死状态
    - caring: 关切/怜悯
    - focused_calm: 专注平静
    - confident_skilled: 自信熟练
    - curious: 好奇/探询
    - joyful: 愉悦/开心
    - angry: 愤怒/激动
    - neutral: 中性/平静

动作描述：
    - sitting_collapsed: 瘫坐
    - offering_food: 递食物
    - writing_brush: 写毛笔字
    - kneading_dough: 揉面
    - walking: 行走
    - standing: 站立
    - reading: 阅读
    - cooking: 烹饪
    - serving: 端菜/上菜

用法：
    from systems.performance import get_performance_prompt, get_dual_performance_prompt

    # 单角色
    prompt = get_performance_prompt(
        shot_type="medium",
        emotion="focused_calm",
        action="writing_brush",
        character="male"
    )

    # 双角色
    prompt = get_dual_performance_prompt(
        shot_type="wide",
        male_emotion="distressed",
        male_action="sitting_collapsed",
        female_emotion="caring",
        female_action="offering_food"
    )
"""

from .generator import (
    get_performance_prompt,
    get_dual_performance_prompt,
    get_scene01_performance,
    get_scene02_performance,
    EmotionType,
    ActionType,
    CharacterType,
    PERFORMANCE_ANTI_PATTERNS
)

__all__ = [
    "get_performance_prompt",
    "get_dual_performance_prompt",
    "get_scene01_performance",
    "get_scene02_performance",
    "EmotionType",
    "ActionType",
    "CharacterType",
    "PERFORMANCE_ANTI_PATTERNS"
]
