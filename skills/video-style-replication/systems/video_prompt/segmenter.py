"""
视频分段器
====================================================
将九宫格分镜按 2-2-2-2-1 规则分为 5 段视频。

分段规则：
- 段1 (开篇): 分镜 1-2
- 段2 (发展): 分镜 3-4
- 段3 (高潮): 分镜 5-6
- 段4 (转折): 分镜 7-8
- 段5 (结尾): 分镜 9
"""

from dataclasses import dataclass, field
from typing import List, Dict, Any, Optional


@dataclass
class VideoSegment:
    """视频段落"""
    segment_index: int              # 段落序号 1-5
    segment_name: str               # 段落名称（开篇/发展/高潮/转折/结尾）
    shot_numbers: List[int]         # 包含的分镜编号
    shots: List[Dict[str, Any]] = field(default_factory=list)  # 分镜数据
    duration_estimate: float = 0.0  # 预估时长（秒）

    @property
    def shot_count(self) -> int:
        """包含的分镜数量"""
        return len(self.shot_numbers)


class VideoSegmenter:
    """视频分段器 - 将 9 个分镜映射为 5 段视频"""

    # 默认分段规则: 2-2-2-2-1
    DEFAULT_SEGMENTATION = [
        {"segment": 1, "name": "开篇", "shots": [1, 2], "duration": 4},
        {"segment": 2, "name": "发展", "shots": [3, 4], "duration": 4},
        {"segment": 3, "name": "高潮", "shots": [5, 6], "duration": 4},
        {"segment": 4, "name": "转折", "shots": [7, 8], "duration": 4},
        {"segment": 5, "name": "结尾", "shots": [9], "duration": 3},
    ]

    # 段落镜头类型映射
    SEGMENT_SHOT_TYPES = {
        1: "开篇远景/中景",
        2: "发展近景/特写",
        3: "高潮中景/近景",
        4: "转折中景/全景",
        5: "结尾全景/远景"
    }

    def __init__(self, custom_segmentation: Optional[List[Dict]] = None):
        """
        初始化分段器

        Args:
            custom_segmentation: 自定义分段规则（可选）
        """
        self.segmentation = custom_segmentation or self.DEFAULT_SEGMENTATION

    def segment_shots(self, shots: List[Dict[str, Any]]) -> List[VideoSegment]:
        """
        将分镜列表按规则分段

        Args:
            shots: 9 个分镜数据列表

        Returns:
            5 个视频段落
        """
        segments = []

        for rule in self.segmentation:
            segment_index = rule["segment"]
            segment_name = rule["name"]
            shot_numbers = rule["shots"]
            duration = rule.get("duration", 4)

            # 获取对应的分镜数据
            segment_shots = []
            for shot_num in shot_numbers:
                if shot_num <= len(shots):
                    segment_shots.append(shots[shot_num - 1])

            segment = VideoSegment(
                segment_index=segment_index,
                segment_name=segment_name,
                shot_numbers=shot_numbers,
                shots=segment_shots,
                duration_estimate=duration
            )
            segments.append(segment)

        return segments

    def get_segment_shot_type(self, segment_index: int) -> str:
        """获取段落的镜头类型"""
        return self.SEGMENT_SHOT_TYPES.get(segment_index, "中景")

    def get_segmentation_summary(self) -> str:
        """获取分段规则摘要"""
        lines = ["视频分段规则 (2-2-2-2-1):"]
        for rule in self.segmentation:
            shots_str = "+".join(map(str, rule["shots"]))
            lines.append(f"  段{rule['segment']} ({rule['name']}): 分镜 {shots_str} ({rule.get('duration', 4)}秒)")
        return "\n".join(lines)
