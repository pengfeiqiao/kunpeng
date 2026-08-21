"""
光影系统
====================================================
三点光源核心 + 景别适配层。

核心光源配置：
    - 主光：3200K 暖琥珀，左上45°，强度55%
    - 副光：2800K 炭盆暖橙，前右底向上，强度20%
    - 天光：5800K 冷蓝，右上15°，强度25%

景别适配：
    - closeup: 主光打面部，副光打下颌，天光打发边轮廓
    - medium: 主光打上半身，副光打手部，天光打身后
    - wide: 主光覆盖门口，副光覆盖地面，天光覆盖全景

用法：
    from systems.lighting import get_lighting_prompt
    prompt = get_lighting_prompt("medium")  # "wide" | "medium" | "closeup"
"""

from .generator import get_lighting_prompt

__all__ = ["get_lighting_prompt"]
