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
import { computePendingCanvasPositions } from '@/lib/workshop/canvasSyncModel';
import { workspaceDraftKey } from '@/lib/workspace/drafts';
import { stableProjectHash } from '@/lib/projectObjects/migrate';
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

/**
 * 一键自动加载画布：资产（角色/场景/道具/色卡定版图）+ 分镜（视频节点）全部投影到画布，
 * 分镜与资产之间补选角/场景/道具/色卡关系连线。沿用兼容投影的全部冲突保护：
 * 手工编辑、生成中、已被修改或输出未索引的节点一律保留不动；新节点进待整理区。
 */
export async function autoLoadWorkspaceToCanvas(): Promise<string> {
  const result: { assets?: ReturnType<typeof projectLegacyCanvas>; shots?: ReturnType<typeof projectLegacyCanvas> } = {};
  const displayPath = (path: string) => /^(https?:|data:|asset:)/.test(path) ? path : convertFileSrc(path);
  try {
    publishLegacyProjectCommand((state) => {
      const assets = projectLegacyCanvas(state, 'assets', displayPath);
      const shots = projectLegacyCanvas({ workshop: assets.workshop, canvas: assets.canvas }, 'shots', displayPath);
      result.assets = assets; result.shots = shots;
      return { workshop: shots.workshop, canvas: shots.canvas };
    });
    await useProjectStore.getState().flushActiveCanvas();
    const assets = result.assets!; const shots = result.shots!;
    const conflicts = assets.conflicts + shots.conflicts;
    if (!assets.created && !assets.updated && !shots.created && !shots.updated && !conflicts) {
      return '项目还没有可加载的资产或分镜。请先在工坊完成拆解与资产定版。';
    }
    return `自动加载完成：资产新建 ${assets.created}、更新 ${assets.updated}；分镜新建 ${shots.created}、更新 ${shots.updated}；`
      + `保留 ${conflicts} 个冲突或不可写对象。未提交生成、复制文件或自动采用候选。`;
  } catch (error) {
    return `自动加载未完成：${error instanceof Error ? error.message : '保存失败'}。已发布的内存修改不会回滚，请检查保存状态。`;
  }
}

/** 单素材传入画布：当前媒体生成画布节点（待整理区），已存在则仅选中定位。不复制文件、不复制参考。 */
export async function sendMediaToCanvas(projectId: string, objectId: string, mediaId: string): Promise<string> {
  let message = '未执行';
  try {
    publishLegacyProjectCommand((state) => {
      if (state.workshop.projectId !== projectId) throw new Error('项目已切换，未传入');
      const registry = state.workshop.projectObjects;
      const media = registry?.media.find((item) => item.id === mediaId && !item.archived);
      const owner = registry?.objects.find((item) => item.id === objectId && !item.archived);
      if (!registry || !media || !owner) throw new Error('素材或对象已不存在，未传入');
      const existing = state.canvas.nodes.find((node) => node.data.projectObjectId === objectId
        && node.data.mediaObjectId === mediaId);
      if (existing) {
        message = '该素材已在画布中，已为你定位选中';
        return { workshop: state.workshop, canvas: { nodes: state.canvas.nodes.map((node) => ({ ...node, selected: node.id === existing.id })),
          edges: state.canvas.edges } };
      }
      const type = media.mediaType === 'video' ? 'video' : media.mediaType === 'audio' ? 'audio' : 'image';
      const display = /^(https?:|data:|asset:)/.test(media.path) ? media.path : convertFileSrc(media.path);
      const nodeId = `node-workspace-${stableProjectHash(`${projectId}:${mediaId}`)}`;
      if (state.canvas.nodes.some((node) => node.id === nodeId)) throw new Error('节点已存在，未重复传入');
      const node: Node = {
        id: nodeId, type, position: computePendingCanvasPositions(state.canvas.nodes, 1)[0],
        style: { width: 280, height: 220 },
        data: {
          description: state.workshop.workspaceDrafts?.[workspaceDraftKey(objectId, type)]?.prompt ?? media.label ?? '',
          projectObjectId: objectId, mediaObjectId: media.id, versionObjectId: media.versionObjectId,
          mediaPurpose: media.purpose === 'current-version' ? 'current-version' : undefined,
          localPath: media.path,
          ...(type === 'image' ? { generatedImageUrl: display } : type === 'video' ? { generatedVideoUrl: display } : { audioUrl: display }),
          pendingOrganization: true,
          workshopRef: { projectId, kind: owner.kind, id: owner.sourceId ?? owner.id, role: 'asset', objectId },
        },
      };
      message = '已传入画布（待整理区）';
      return { workshop: state.workshop, canvas: { nodes: [...state.canvas.nodes, node], edges: state.canvas.edges } };
    });
    await useProjectStore.getState().flushActiveCanvas();
    return message;
  } catch (error) {
    return `传入画布未完成：${error instanceof Error ? error.message : '保存失败'}`;
  }
}

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
