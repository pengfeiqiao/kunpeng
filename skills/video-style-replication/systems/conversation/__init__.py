"""
对话引导系统
====================================================
提供对话式交互引导，替代命令行菜单。

用法：
    from systems.conversation import ConversationGuide, ConversationState

    # 初始化对话引导
    guide = ConversationGuide()

    # 开始对话流程
    response = guide.start(user_message="我想做一个古装剧的分镜")
"""

from .state import ConversationState
from .prompts import ConversationPrompts
from .guide import ConversationGuide

__all__ = ["ConversationState", "ConversationPrompts", "ConversationGuide"]
