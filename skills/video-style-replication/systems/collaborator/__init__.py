"""
协作者系统
====================================================
与豆包 AI 协作，处理多模态问题。
"""

from .prompt_generator import PromptGenerator
from .doubao_client import DoubaoClient, CollaborationResult

__all__ = ["DoubaoClient", "CollaborationResult", "PromptGenerator"]
