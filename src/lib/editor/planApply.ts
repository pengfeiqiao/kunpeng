/**
 * planApply — 剪辑计划落轨的共享实现。
 * PlanPanel「全部应用」按钮与 timeline_apply_plan 工具走同一条管线，
 * 失败镜头明确上报不再静默吞掉。调用方负责 captureEditorSnapshot()。
 */
import { useEditorStore } from '@/stores/editorStore';

export interface ApplyPlanResult {
  applied: number;
  total: number;
  failures: { label: string; reason: string }[];
}

/** 把计划中所有 pending 镜头按序落主轨（追加 + 按入出点裁剪） */
export async function applyPendingPlanShots(): Promise<ApplyPlanResult> {
  const s = useEditorStore.getState();
  const pending = s.plan?.shots.filter((x) => x.status === 'pending') ?? [];
  let applied = 0;
  const failures: ApplyPlanResult['failures'] = [];
  for (const shot of pending) {
    try {
      const ids = await useEditorStore.getState().addClips([{ path: shot.sourcePath, label: shot.label }]);
      const id = ids[0];
      if (!id) throw new Error('addClips 未返回 id（素材可能不存在）');
      useEditorStore.getState().trimClip(id, shot.inSec, shot.outSec);
      useEditorStore.getState().updatePlanShot(shot.id, { status: 'applied' });
      applied += 1;
    } catch (err) {
      failures.push({ label: shot.label, reason: err instanceof Error ? err.message : String(err) });
    }
  }
  return { applied, total: pending.length, failures };
}
