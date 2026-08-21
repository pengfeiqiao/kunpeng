"""
检查点系统
====================================================
管理工作流中的用户确认点。

为小白用户设计：
- 每一步都有清晰的提示
- 必须确认才能继续
- 提供简单的选项
"""

from dataclasses import dataclass
from pathlib import Path
from datetime import datetime
from typing import Optional, Dict, List
import json


@dataclass
class CheckpointResult:
    """检查点结果"""
    step_name: str
    passed: bool
    timestamp: str
    user_note: str = ""


class CheckpointManager:
    """检查点管理器"""

    def __init__(
        self,
        project_path: Path,
        auto_mode: bool = False,
        work_logger=None
    ):
        self.project_path = Path(project_path)
        self.auto_mode = auto_mode
        self.work_logger = work_logger
        self.checkpoints: Dict[str, CheckpointResult] = {}
        self.checkpoint_file = self.project_path / ".checkpoints.json"

    def set_auto_mode(self, auto_mode: bool):
        """设置自动模式"""
        self.auto_mode = auto_mode

    def show_progress_bar(self, current: int, total: int, width: int = 30):
        """显示进度条"""
        percent = current / total if total > 0 else 0
        filled = int(width * percent)
        bar = "█" * filled + "░" * (width - filled)
        print(f"\n  [{bar}] {current}/{total} ({percent*100:.0f}%)")

    def wait_for_confirmation(
        self,
        step_name: str,
        description: str = "",
        options: Dict[str, str] = None,
        show_progress: tuple = None  # (current, total)
    ) -> CheckpointResult:
        """
        等待用户确认 - 改为返回需要确认的状态，由对话系统处理

        Args:
            step_name: 步骤名称
            description: 步骤描述
            options: 自定义选项
            show_progress: 显示进度 (current, total)

        Returns:
            CheckpointResult 或 dict（需要确认时返回状态信息）
        """
        timestamp = datetime.now().isoformat()

        if self.auto_mode:
            result = CheckpointResult(
                step_name=step_name,
                passed=True,
                timestamp=timestamp,
                user_note="[auto mode]"
            )
            self.checkpoints[step_name] = result
            self._save()
            return result

        # 非自动模式：返回需要确认的状态信息
        # 对话系统会处理用户确认，然后调用 confirm() 方法
        current, total = show_progress if show_progress else (0, 0)
        return {
            "status": "waiting_confirmation",
            "step_name": step_name,
            "description": description,
            "progress": {"current": current, "total": total},
            "options": ["确认继续", "重新执行", "跳过", "停止"],
            "message": f"检查点: {step_name}"
        }

    def confirm(
        self,
        step_name: str,
        action: str = "continue",
        note: str = ""
    ) -> CheckpointResult:
        """
        确认检查点（对话系统调用）

        Args:
            step_name: 步骤名称
            action: 用户操作 - "continue"（继续）, "retry"（重试）, "skip"（跳过）, "stop"（停止）
            note: 用户备注

        Returns:
            CheckpointResult
        """
        timestamp = datetime.now().isoformat()

        if action == "continue":
            result = CheckpointResult(
                step_name=step_name,
                passed=True,
                timestamp=timestamp,
                user_note=note or "用户确认继续"
            )
        elif action == "retry":
            result = CheckpointResult(
                step_name=step_name,
                passed=True,
                timestamp=timestamp,
                user_note=note or "用户选择重试"
            )
            result.retry = True
        elif action == "skip":
            result = CheckpointResult(
                step_name=step_name,
                passed=True,
                timestamp=timestamp,
                user_note=note or "用户选择跳过"
            )
        else:  # stop
            result = CheckpointResult(
                step_name=step_name,
                passed=False,
                timestamp=timestamp,
                user_note=note or "用户选择停止"
            )

        self.checkpoints[step_name] = result
        self._save()

        if self.work_logger:
            self.work_logger.log_checkpoint(
                checkpoint_name=step_name,
                status="passed" if result.passed else "stopped"
            )

        return result

    def confirm_action(
        self,
        title: str,
        message: str,
        confirm_text: str = "确认",
        cancel_text: str = "取消"
    ) -> dict:
        """
        简单的确认对话框 - 改为返回需要确认的状态

        Args:
            title: 标题
            message: 消息内容
            confirm_text: 确认按钮文字
            cancel_text: 取消按钮文字

        Returns:
            dict: 包含确认状态信息，由对话系统处理
        """
        return {
            "status": "waiting_confirmation",
            "type": "confirm_action",
            "title": title,
            "message": message,
            "confirm_text": confirm_text,
            "cancel_text": cancel_text,
            "options": [confirm_text, cancel_text]
        }

    def process_confirm_action(self, user_response: str, confirm_text: str = "确认", cancel_text: str = "取消") -> bool:
        """
        处理用户对确认对话框的响应

        Args:
            user_response: 用户响应
            confirm_text: 确认按钮文字
            cancel_text: 取消按钮文字

        Returns:
            用户是否确认
        """
        return user_response.lower() in ["", "y", "yes", "确认", "是", confirm_text.lower()]

    def is_passed(self, step_name: str) -> bool:
        """检查步骤是否已通过"""
        if step_name in self.checkpoints:
            return self.checkpoints[step_name].passed
        return False

    def _save(self):
        """保存检查点记录"""
        data = {
            "project_path": str(self.project_path),
            "last_updated": datetime.now().isoformat(),
            "checkpoints": {
                name: {
                    "step_name": r.step_name,
                    "passed": r.passed,
                    "timestamp": r.timestamp,
                    "user_note": r.user_note
                }
                for name, r in self.checkpoints.items()
            }
        }
        with open(self.checkpoint_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _load(self):
        """加载检查点记录"""
        if not self.checkpoint_file.exists():
            return

        with open(self.checkpoint_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        for name, item in data.get("checkpoints", {}).items():
            self.checkpoints[name] = CheckpointResult(
                step_name=item.get("step_name", name),
                passed=item.get("passed", False),
                timestamp=item.get("timestamp", ""),
                user_note=item.get("user_note", "")
            )
