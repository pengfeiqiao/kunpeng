"""
工作日志系统
====================================================
记录工作进度，避免上下文过长失忆。

用法：
    from systems.memory import WorkLogger

    logger = WorkLogger(project_path)
    logger.log_step("step1", "创建角色卡")
    logger.log_issue("假面感", "角色与背景融合不好")
    logger.log_solution("添加场景参考锚点", "使用 IMAGE 1 作为场景基础")
"""

from dataclasses import dataclass, field
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any
import re


@dataclass
class LogEntry:
    """日志条目"""
    timestamp: str
    entry_type: str
    content: str
    details: Dict[str, Any] = field(default_factory=dict)

    def to_markdown(self) -> str:
        time_str = datetime.fromisoformat(self.timestamp).strftime('%H:%M')
        lines = [f"- **{time_str}** {self.content}"]
        if self.details:
            for key, value in self.details.items():
                if value:
                    lines.append(f"  - {key}: {value}")
        return "\n".join(lines)


class WorkLogger:
    """工作日志记录器"""

    ENTRY_TYPES = {
        "step": "▶️",
        "decision": "✅",
        "issue": "⚠️",
        "solution": "🔧",
        "note": "📝",
        "collaboration": "🤝",
        "checkpoint": "🔍",
        "error": "❌",
    }

    def __init__(self, project_path: Path):
        self.project_path = Path(project_path)
        self.log_file = self.project_path / "work_log.md"
        self.entries: List[LogEntry] = []
        self.session_start = datetime.now()
        self.metadata: Dict[str, str] = {}
        self._load_existing_log()

    def log_step(self, step_id: str, step_name: str, details: dict = None):
        """记录步骤"""
        entry = LogEntry(
            timestamp=datetime.now().isoformat(),
            entry_type="step",
            content=f"▶️ {step_name}",
            details={"step_id": step_id, **(details or {})}
        )
        self.entries.append(entry)
        self._auto_save()

    def log_decision(self, decision: str, reason: str = ""):
        """记录决策"""
        entry = LogEntry(
            timestamp=datetime.now().isoformat(),
            entry_type="decision",
            content=f"✅ 决策: {decision}",
            details={"reason": reason} if reason else {}
        )
        self.entries.append(entry)
        self._auto_save()

    def log_issue(self, issue: str, description: str = ""):
        """记录问题"""
        entry = LogEntry(
            timestamp=datetime.now().isoformat(),
            entry_type="issue",
            content=f"⚠️ 问题: {issue}",
            details={"description": description} if description else {}
        )
        self.entries.append(entry)
        self._auto_save()

    def log_solution(self, solution: str, result: str = ""):
        """记录解决方案"""
        entry = LogEntry(
            timestamp=datetime.now().isoformat(),
            entry_type="solution",
            content=f"🔧 解决: {solution}",
            details={"result": result} if result else {}
        )
        self.entries.append(entry)
        self._auto_save()

    def log_note(self, note: str):
        """记录笔记"""
        entry = LogEntry(
            timestamp=datetime.now().isoformat(),
            entry_type="note",
            content=f"📝 {note}",
            details={}
        )
        self.entries.append(entry)
        self._auto_save()

    def log_collaboration(self, collaborator: str, task: str, result: str = ""):
        """记录协作者交互"""
        entry = LogEntry(
            timestamp=datetime.now().isoformat(),
            entry_type="collaboration",
            content=f"🤝 {collaborator}: {task}",
            details={"result": result} if result else {}
        )
        self.entries.append(entry)
        self._auto_save()

    def log_checkpoint(self, checkpoint_name: str, status: str = "passed"):
        """记录检查点"""
        entry = LogEntry(
            timestamp=datetime.now().isoformat(),
            entry_type="checkpoint",
            content=f"🔍 检查点: {checkpoint_name}",
            details={"status": status}
        )
        self.entries.append(entry)
        self._auto_save()

    def log_error(self, error: str, details: dict = None):
        """记录错误"""
        entry = LogEntry(
            timestamp=datetime.now().isoformat(),
            entry_type="error",
            content=f"❌ 错误: {error}",
            details=details or {}
        )
        self.entries.append(entry)
        self._auto_save()

    def save(self):
        """保存日志为 Markdown"""
        lines = [
            f"# 工作日志 - {self.project_path.name}",
            "",
        ]

        if self.metadata:
            for key, value in self.metadata.items():
                lines.append(f"**{key}**: {value}")
            lines.append("")

        lines.extend([
            f"**会话开始**: {self.session_start.strftime('%Y-%m-%d %H:%M')}",
            f"**最后更新**: {datetime.now().strftime('%Y-%m-%d %H:%M')}",
            "",
            "---",
            "",
        ])

        current_date = None
        for entry in self.entries:
            entry_time = datetime.fromisoformat(entry.timestamp)
            entry_date = entry_time.strftime('%Y-%m-%d')

            if entry_date != current_date:
                lines.append(f"## {entry_date}")
                lines.append("")
                current_date = entry_date

            lines.append(entry.to_markdown())
            lines.append("")

        with open(self.log_file, "w", encoding="utf-8") as f:
            f.write("\n".join(lines))

    def get_summary(self, last_n: int = 10) -> str:
        """获取最近 N 条日志摘要"""
        recent = self.entries[-last_n:] if len(self.entries) > last_n else self.entries
        lines = [f"### 最近操作 ({len(recent)} 条)"]
        for entry in recent:
            time_str = datetime.fromisoformat(entry.timestamp).strftime('%H:%M')
            lines.append(f"- {time_str} {entry.content}")
        return "\n".join(lines)

    def get_issues(self) -> List[LogEntry]:
        """获取所有问题"""
        return [e for e in self.entries if e.entry_type == "issue"]

    def _load_existing_log(self):
        """加载已有日志"""
        if not self.log_file.exists():
            return

        with open(self.log_file, "r", encoding="utf-8") as f:
            content = f.read()

        # 解析元数据
        metadata_pattern = r'\*\*([^*]+)\*\*:\s*(.+)'
        for match in re.finditer(metadata_pattern, content):
            key = match.group(1).strip()
            value = match.group(2).strip()
            self.metadata[key] = value

        # 解析条目
        entry_pattern = r'- \*\*(\d{2}:\d{2})\*\* (.+)'
        for match in re.finditer(entry_pattern, content):
            time_str = match.group(1)
            content_str = match.group(2)

            entry_type = "note"
            if content_str.startswith("▶️"):
                entry_type = "step"
            elif content_str.startswith("✅"):
                entry_type = "decision"
            elif content_str.startswith("⚠️"):
                entry_type = "issue"
            elif content_str.startswith("🔧"):
                entry_type = "solution"
            elif content_str.startswith("🤝"):
                entry_type = "collaboration"
            elif content_str.startswith("🔍"):
                entry_type = "checkpoint"
            elif content_str.startswith("❌"):
                entry_type = "error"

            today = datetime.now().strftime('%Y-%m-%d')
            timestamp = f"{today}T{time_str}:00"

            entry = LogEntry(
                timestamp=timestamp,
                entry_type=entry_type,
                content=content_str,
                details={}
            )
            self.entries.append(entry)

    def _auto_save(self):
        """自动保存"""
        self.save()
