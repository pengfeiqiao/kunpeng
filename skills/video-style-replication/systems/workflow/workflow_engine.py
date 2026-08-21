"""
工作流引擎
====================================================
统一入口管理整个分镜生成流程。

用法：
    from systems.workflow import WorkflowEngine

    engine = WorkflowEngine(project_path="~/Desktop/古装角色复刻项目")
    engine.run_full_workflow()
"""

from dataclasses import dataclass, field
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Optional, Callable, Any
from enum import Enum
import json

from .checkpoint import CheckpointManager


class StepStatus(Enum):
    """步骤状态"""
    PENDING = "pending"
    RUNNING = "running"
    WAITING_CHECKPOINT = "waiting_checkpoint"
    COMPLETED = "completed"
    FAILED = "failed"
    SKIPPED = "skipped"


@dataclass
class WorkflowStep:
    """工作流步骤"""
    step_id: str
    name: str
    description: str = ""
    handler: Callable = None
    requires: List[str] = field(default_factory=list)
    checkpoint: bool = True
    auto_skip_if_completed: bool = True
    optional: bool = False
    status: StepStatus = StepStatus.PENDING
    result: Dict[str, Any] = field(default_factory=dict)
    error: str = ""


class WorkflowEngine:
    """工作流引擎"""

    DEFAULT_STEPS = [
        {"step_id": "step0_init_project", "name": "初始化项目", "description": "创建项目配置文件和目录结构", "checkpoint": True},
        {"step_id": "step1_create_characters", "name": "创建角色卡", "description": "定义男主/女主的角色卡", "checkpoint": True},
        {"step_id": "step2_generate_makeup", "name": "生成定妆照", "description": "使用 Gemini 生成角色定妆照", "checkpoint": True},
        {"step_id": "step3_generate_3view", "name": "生成三视图", "description": "基于定妆照生成角色三视图", "checkpoint": True},
        {"step_id": "step4_define_scenes", "name": "定义场景", "description": "创建场景配置", "checkpoint": True},
        {"step_id": "step5_generate_scene_concept", "name": "生成场景概念图", "description": "使用 MJ 生成场景概念图", "checkpoint": True},
        # step5b_upsample_scene 已移除，改为对话式交互
        {"step_id": "step6_composite_wide_shot", "name": "合成全景分镜", "description": "使用 Gemini 合成 shot_9_wide.jpg", "checkpoint": True},
        {"step_id": "step7_generate_9grid", "name": "生成九宫格", "description": "生成 3x3 九宫格分镜（可选）", "checkpoint": True, "optional": True},
        {"step_id": "step8_generate_shots", "name": "生成独立分镜", "description": "逐张生成 shot_1-9.jpg", "checkpoint": True},
        {"step_id": "step9_review", "name": "最终审查", "description": "用户审查分镜质量", "checkpoint": True},
    ]

    def __init__(self, project_path: Path, auto_checkpoint: bool = False, work_logger=None):
        self.project_path = Path(project_path)
        self.auto_checkpoint = auto_checkpoint
        self.work_logger = work_logger
        self.steps: Dict[str, WorkflowStep] = {}
        self.step_order: List[str] = []
        self.current_step: Optional[str] = None

        self.checkpoint_manager = CheckpointManager(
            project_path=self.project_path,
            auto_mode=auto_checkpoint,
            work_logger=work_logger
        )

        self._init_default_steps()
        self._load_progress()

    def _init_default_steps(self):
        """初始化默认步骤"""
        for step_def in self.DEFAULT_STEPS:
            step = WorkflowStep(
                step_id=step_def["step_id"],
                name=step_def["name"],
                description=step_def.get("description", ""),
                checkpoint=step_def.get("checkpoint", True),
                optional=step_def.get("optional", False),
            )
            self.register_step(step)

    def register_step(self, step: WorkflowStep):
        """注册步骤"""
        self.steps[step.step_id] = step
        if step.step_id not in self.step_order:
            self.step_order.append(step.step_id)

    def get_progress(self) -> Dict[str, Any]:
        """获取进度"""
        completed = sum(1 for s in self.steps.values() if s.status == StepStatus.COMPLETED)
        total = len(self.steps)
        return {
            "completed": completed,
            "total": total,
            "percentage": round(completed / total * 100, 1) if total > 0 else 0,
            "current_step": self.current_step,
        }

    def confirm_and_continue_step(self, step_id: str, action: str = "continue", **kwargs) -> Dict[str, Any]:
        """
        确认并继续执行步骤（对话系统调用）

        Args:
            step_id: 步骤 ID
            action: 用户操作 - "continue"（继续）, "skip"（跳过）, "stop"（停止）

        Returns:
            执行结果
        """
        if step_id not in self.steps:
            raise ValueError(f"未知步骤: {step_id}")

        step = self.steps[step_id]

        if action == "stop":
            step.status = StepStatus.PENDING
            return {"status": "stopped", "message": "用户停止工作流"}

        if action == "skip":
            step.status = StepStatus.SKIPPED
            self._save_progress()
            return {"status": "skipped", "message": f"用户跳过: {step.name}"}

        # 继续执行
        return self._execute_step(step_id, **kwargs)

    def _execute_step(self, step_id: str, **kwargs) -> Dict[str, Any]:
        """内部方法：实际执行步骤"""
        step = self.steps[step_id]
        step.status = StepStatus.RUNNING
        self.current_step = step_id

        step_index = self.step_order.index(step_id) + 1
        total_steps = len(self.step_order)
        completed_steps = sum(1 for s in self.steps.values() if s.status == StepStatus.COMPLETED)

        if self.work_logger:
            self.work_logger.log_step(step_id, step.name)

        try:
            if step.handler:
                result = step.handler(project_path=self.project_path, **kwargs)
            else:
                result = {"status": "manual", "message": f"请手动完成: {step.name}"}

            step.result = result
            step.status = StepStatus.COMPLETED

        except Exception as e:
            step.status = StepStatus.FAILED
            step.error = str(e)
            if self.work_logger:
                self.work_logger.log_error(str(e), {"step_id": step_id})
            raise

        finally:
            self._save_progress()

        # 如果需要检查点，返回等待确认状态
        if step.checkpoint:
            step.status = StepStatus.WAITING_CHECKPOINT
            return {
                "status": "waiting_checkpoint",
                "step_id": step_id,
                "step_name": step.name,
                "result": result,
                "progress": (completed_steps + 1, total_steps),
                "message": f"步骤完成，等待确认: {step.name}"
            }

        return step.result

    def confirm_checkpoint(self, step_id: str, passed: bool = True, note: str = "") -> Dict[str, Any]:
        """
        确认检查点（对话系统调用）

        Args:
            step_id: 步骤 ID
            passed: 是否通过
            note: 用户备注

        Returns:
            确认结果
        """
        if step_id not in self.steps:
            raise ValueError(f"未知步骤: {step_id}")

        step = self.steps[step_id]

        if passed:
            step.status = StepStatus.COMPLETED
            self.checkpoint_manager.checkpoints[step_id] = type('CheckpointResult', (), {
                'step_name': step_id,
                'passed': True,
                'timestamp': datetime.now().isoformat(),
                'user_note': note
            })()
            self.checkpoint_manager._save()
            return {"status": "confirmed", "step_id": step_id}
        else:
            step.status = StepStatus.PENDING
            return {"status": "rejected", "step_id": step_id, "message": "用户拒绝，需要重新执行"}

    def run_step(self, step_id: str, **kwargs) -> Dict[str, Any]:
        """运行单个步骤"""
        if step_id not in self.steps:
            raise ValueError(f"未知步骤: {step_id}")

        step = self.steps[step_id]

        if step.auto_skip_if_completed and step.status == StepStatus.COMPLETED:
            print(f"⏭️  跳过已完成步骤: {step.name}")
            return step.result

        step.status = StepStatus.RUNNING
        self.current_step = step_id

        # 计算当前进度
        step_index = self.step_order.index(step_id) + 1
        total_steps = len(self.step_order)
        completed_steps = sum(1 for s in self.steps.values() if s.status == StepStatus.COMPLETED)

        # 显示步骤信息
        print()
        print("╔" + "═" * 68 + "╗")
        print(f"║  ▶️  步骤 {step_index}/{total_steps}: {step.name:<52} ║")
        print("╠" + "═" * 68 + "╣")
        print(f"║  📝 {step.description:<64} ║")
        print("╠" + "═" * 68 + "╣")

        # 显示进度条
        progress_width = 50
        filled = int(progress_width * completed_steps / total_steps) if total_steps > 0 else 0
        bar = "█" * filled + "░" * (progress_width - filled)
        print(f"║  📊 进度: [{bar}] {completed_steps}/{total_steps}{' ' * 5} ║")

        print("╚" + "═" * 68 + "╝")
        print()

        # 步骤开始前确认 - 改为返回需要确认的状态，由对话系统处理
        # 如果不是自动检查点模式，返回需要确认的状态
        if not self.auto_checkpoint:
            step.status = StepStatus.WAITING_CHECKPOINT
            return {
                "status": "waiting_confirmation",
                "step_id": step_id,
                "step_name": step.name,
                "description": step.description,
                "progress": (step_index, total_steps),
                "message": f"准备执行步骤: {step.name}"
            }

        if self.work_logger:
            self.work_logger.log_step(step_id, step.name)

        try:
            if step.handler:
                result = step.handler(project_path=self.project_path, **kwargs)
            else:
                result = {"status": "manual", "message": f"请手动完成: {step.name}"}
                print(f"📌 请手动完成: {step.description}")

            step.result = result
            step.status = StepStatus.COMPLETED
            print(f"\n✅ 步骤完成: {step.name}")

        except Exception as e:
            step.status = StepStatus.FAILED
            step.error = str(e)
            print(f"\n❌ 步骤失败: {step.name} - {e}")
            if self.work_logger:
                self.work_logger.log_error(str(e), {"step_id": step_id})
            raise

        finally:
            self._save_progress()

        if step.checkpoint:
            step.status = StepStatus.WAITING_CHECKPOINT
            # 非自动模式下，返回等待确认状态，由对话系统处理
            if not self.auto_checkpoint:
                return {
                    "status": "waiting_checkpoint",
                    "step_id": step_id,
                    "step_name": step.name,
                    "result": step.result,
                    "progress": (completed_steps + 1, total_steps),
                    "message": f"步骤完成，等待确认: {step.name}"
                }
            # 自动模式下，自动确认
            step.status = StepStatus.COMPLETED

        return step.result

    def run_full_workflow(self, start_from: str = None, skip_optional: bool = True) -> Dict[str, Any]:
        """运行完整工作流"""
        print("\n" + "=" * 70)
        print("🎬 开始运行分镜生成工作流")
        print("=" * 70)

        progress = self.get_progress()
        print(f"进度: {progress['completed']}/{progress['total']} ({progress['percentage']}%)\n")

        steps_to_run = list(self.step_order)
        if start_from:
            if start_from not in steps_to_run:
                raise ValueError(f"未知步骤: {start_from}")
            steps_to_run = steps_to_run[steps_to_run.index(start_from):]

        results = {}
        for step_id in steps_to_run:
            step = self.steps[step_id]

            if skip_optional and step.optional:
                print(f"⏭️  跳过可选步骤: {step.name}")
                step.status = StepStatus.SKIPPED
                continue

            try:
                result = self.run_step(step_id)
                results[step_id] = result
            except KeyboardInterrupt:
                print("\n\n⚠️  工作流被用户中断")
                break
            except Exception as e:
                print(f"\n\n❌ 工作流失败: {e}")
                results[step_id] = {"error": str(e)}
                break

        final = self.get_progress()
        print("\n" + "=" * 70)
        print(f"🎉 完成: {final['completed']}/{final['total']} ({final['percentage']}%)")
        print("=" * 70)

        return {"progress": final, "results": results}

    def reset_progress(self):
        """重置进度"""
        for step in self.steps.values():
            step.status = StepStatus.PENDING
            step.result = {}
            step.error = ""
        self.current_step = None
        self._save_progress()

    def _save_progress(self):
        """保存进度"""
        progress_file = self.project_path / ".workflow_progress.json"
        data = {
            "project_path": str(self.project_path),
            "last_updated": datetime.now().isoformat(),
            "current_step": self.current_step,
            "steps": {sid: {"status": s.status.value, "result": s.result, "error": s.error}
                     for sid, s in self.steps.items()}
        }
        with open(progress_file, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)

    def _load_progress(self):
        """加载进度"""
        progress_file = self.project_path / ".workflow_progress.json"
        if not progress_file.exists():
            return

        with open(progress_file, "r", encoding="utf-8") as f:
            data = json.load(f)

        self.current_step = data.get("current_step")
        for sid, sdata in data.get("steps", {}).items():
            if sid in self.steps:
                self.steps[sid].status = StepStatus(sdata.get("status", "pending"))
                self.steps[sid].result = sdata.get("result", {})
                self.steps[sid].error = sdata.get("error", "")

        self.checkpoint_manager._load()
