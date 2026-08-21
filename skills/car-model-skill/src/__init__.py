"""
Car Model Generation Skill
汽车模型生成技能
"""

__version__ = "3.0.0"
__author__ = "Claude Code"

from .core.gemini_client import GeminiClient
from .core.doubao_analyzer import DoubaoAnalyzer
from .workflows.generate_car_model import CarModelGenerator

__all__ = [
    'GeminiClient',
    'DoubaoAnalyzer',
    'CarModelGenerator'
]
