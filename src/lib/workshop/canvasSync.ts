/**
 * Compatibility canvas import/projection. Business changes are computed before publication.
 * Professional node editing/execution remains a separate legacy surface.
 */
import { convertFileSrc } from '@tauri-apps/api/tauri';
import type { Node } from 'reactflow';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { collectNodeReferences } from '@/lib/canvas/collectRefs';
import { assetUrlToLocalPath } from '@/lib/canvas/imageSource';
import { importLegacyCanvasObjects } from '@/lib/workspace/legacyCanvasImport';
import { applyWorkspaceProjectCommand } from '@/lib/workspace/runtime';
import { projectLegacyCanvas } from '@/lib/workspace/legacyCanvasProjection';
import { publishLegacyProjectCommand } from '@/lib/workspace/legacyProjectCommandRuntime';
import type { WorkspaceReference } from '@/lib/workspace/types';

export interface WorkshopRef {
  projectId: string;
  kind: 'character' | 'scene' | 'prop' | 'colorPalette' | 'shot' | 'storyboardFrame' | 'storyboardBoard' | 'directorConstraintCard';
  id: string;
  role: 'asset' | 'prompt-reference' | 'shot-image' | 'shot-video' | 'storyboard-frame' | 'storyboard-board';
  /** 稳定身份用于跨排序/改镜号回传；快照只供 UI 展示。 */
  shotId?: string;
  shotNoSnapshot?: string;
  frameId?: string;
  sourceRevision?: number;
  /** Stable cross-view identities; legacy id/role remain readable. */
  objectId?: string;
  mediaObjectId?: string;
  versionObjectId?: string;
}

function refOf(node: Node): WorkshopRef | undefined {
  return (node.data as Record<string, unknown> | undefined)?.workshopRef as WorkshopRef | undefined;
}

export function findRefNode(nodes: Node[], projectId: string, kind: string, id: string, role: string): Node | undefined {
  return nodes.find((n) => {
    const r = refOf(n);
    return r && r.projectId === projectId && r.kind === kind && r.id === id && r.role === role;
  });
}


async function projectToLegacyCanvas(scope: 'assets' | 'shots'): Promise<string> {
  const result: { value?: ReturnType<typeof projectLegacyCanvas> } = {};
  try {
    publishLegacyProjectCommand((state) => {
      result.value = projectLegacyCanvas(state, scope, (path) => /^(https?:|data:|asset:)/.test(path) ? path : convertFileSrc(path));
      return result.value;
    });
    await useProjectStore.getState().flushActiveCanvas();
    return `兼容投影完成：新建 ${result.value!.created} 个，更新 ${result.value!.updated} 个，保留 ${result.value!.conflicts} 个冲突或不可写对象。未提交生成、复制文件或自动采用候选。`;
  } catch (error) {
    return `兼容投影未完成：${error instanceof Error ? error.message : '保存失败'}。已发布的内存修改不会回滚，请检查保存状态。`;
  }
}

export async function syncAssetsToCanvas(): Promise<string> { return projectToLegacyCanvas('assets'); }
export async function syncShotPromptsToCanvas(): Promise<string> { return projectToLegacyCanvas('shots'); }

/** Compatibility-only import, with no file copies, automatic adoption or edge-derived ownership. */
export async function pullFromCanvas(): Promise<string> {
  const { project, data } = useWorkshopStore.getState();
  if (!project || !data) return '没有打开的工坊项目';
  const canvasProject = useProjectStore.getState();
  if (data.canvasProjectId !== canvasProject.activeProjectId
    && !canvasProject.projects.some((item) => item.id === canvasProject.activeProjectId && item.aigcProjectId === project.id)) {
    return '当前画布不属于此项目，未导入任何内容。';
  }
  const nodes = useCanvasStore.getState().nodes;
  const references: Record<string, WorkspaceReference[]> = {};
  for (const node of nodes) {
    if (!refOf(node) && !node.data.projectObjectId) continue;
    const collected = collectNodeReferences(node.id);
    references[node.id] = [...collected.images, ...collected.videos, ...collected.audios].map((item, index) => ({
      id: `canvas-ref:${node.id}:${index}`, type: item.kind, path: assetUrlToLocalPath(item.submitUrl) ?? item.submitUrl,
      label: item.name ?? `${item.kind === 'image' ? '图片' : item.kind === 'video' ? '视频' : '音频'} ${index + 1}`,
    }));
  }
  const imported = importLegacyCanvasObjects(data, nodes, references);
  if (!applyWorkspaceProjectCommand(project.id, (current) => current === data && nodes === useCanvasStore.getState().nodes ? imported.data : null)) {
    return '项目或画布已改变，未导入，请重新打开此项目后再试。';
  }
  return `已导入 ${imported.candidates} 个候选版本、${imported.prompts} 份工作台草稿；保留 ${imported.conflicts} 份有差异的现有草稿，跳过 ${imported.skipped} 个无效或锁定对象。未自动采用素材或更改角色音色。`;
}
