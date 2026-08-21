/**
 * collectRefs — 画布节点参考素材的单一权威收集器。
 *
 * 修复的核心病灶：参考集合曾有 4 个各自为政的排序来源（工具栏 vRefItems、
 * @提及 mentionItems、图片提交侧拼接、视频提交侧拼接），组图 unshift、
 * @提及前置、资产图前置任何一处重排都会让 Seedance/MJ 的位置语义
 * `@图片N` 指错素材。
 *
 * 纪律：
 * 1. 顺序唯一权威 = edge 数组顺序（连线先后），组节点在其 edge 位置原地展开成员。
 * 2. 展示编号、@ 系统编号、提交顺序三者必须调用本函数取同一列表。
 * 3. 资产库主体图追加在【尾部】（不再前置），展示侧同样编号可见。
 * 4. 节点自己的上一轮产物永不进参考（防重 roll 自吞）。
 */
import { useCanvasStore } from '@/stores/canvasStore';
import { getGroupImages } from '@/components/canvas/nodes/GroupNode';
import { assetUrlToLocalPath } from '@/lib/canvas/imageSource';
import {
  explicitSelfVideoSource,
  isNonReferenceEdgeData,
} from '@/lib/canvas/referencePolicy';

export interface CollectedRef {
  kind: 'image' | 'video' | 'audio';
  /** 提交/显示用 URL（图片显示与提交同源；音频提交侧要本地路径见 submitUrl） */
  url: string;
  /** 提交时实际使用的地址（音频优先 localPath；其余同 url） */
  submitUrl: string;
  /** 来源 edge（组成员共享组的 edge），用于断开操作 */
  edgeId?: string;
  /** 来源节点 id */
  sourceNodeId?: string;
  name?: string;
}

export interface CollectedRefs {
  /** 按最终提交顺序排列（= @图片N 编号顺序） */
  images: CollectedRef[];
  videos: CollectedRef[];
  audios: CollectedRef[];
}

/**
 * 收集连入 nodeId 的全部参考素材，顺序 = edge 顺序（组原地展开）。
 * @param extraTailImages 追加在尾部的图片（资产库主体图等），会去重
 */
export function collectNodeReferences(nodeId: string, opts?: { extraTailImages?: string[] }): CollectedRefs {
  const { nodes, edges } = useCanvasStore.getState();
  const self = nodes.find((n) => n.id === nodeId);
  const selfData = (self?.data ?? {}) as Record<string, unknown>;
  const ownOutputs = new Set(
    [selfData.generatedImageUrl, selfData.generatedVideoUrl, selfData.localPath].filter(Boolean) as string[],
  );

  const images: CollectedRef[] = [];
  const videos: CollectedRef[] = [];
  const audios: CollectedRef[] = [];
  const seen = new Set<string>();

  const pushImage = (url: string | undefined, edgeId?: string, sourceNodeId?: string, name?: string) => {
    if (!url || seen.has(url) || ownOutputs.has(url)) return;
    seen.add(url);
    images.push({ kind: 'image', url, submitUrl: url, edgeId, sourceNodeId, name });
  };

  for (const e of edges) {
    if (e.target !== nodeId) continue;
    // Version ancestry is only visual/history metadata. It must never become
    // a generation reference unless the user creates a normal edge.
    if (isNonReferenceEdgeData(e.data)) continue;
    const src = nodes.find((n) => n.id === e.source);
    if (!src) continue;
    const d = src.data as Record<string, unknown>;
    if (src.type === 'image') {
      pushImage((d.generatedImageUrl || d.referenceImage) as string | undefined, e.id, src.id, d.description as string | undefined);
    } else if (src.type === 'group') {
      // 组成员按其 edge 位置原地展开——绝不 unshift 到最前
      for (const url of getGroupImages(src.id)) pushImage(url, e.id, src.id);
    } else if (src.type === 'video') {
      // 生成时实时收集（替代 onConnect 时物化的 referenceVideos 快照）：
      // 源视频后来才生成/重新生成，这里都能拿到最新的
      const url = (d.localPath || d.generatedVideoUrl) as string | undefined;
      if (url && !seen.has(url) && !ownOutputs.has(url)) {
        seen.add(url);
        videos.push({ kind: 'video', url: (d.generatedVideoUrl || url) as string, submitUrl: url, edgeId: e.id, sourceNodeId: src.id, name: d.description as string | undefined });
      }
    } else if (src.type === 'audio') {
      const display = (d.audioUrl || d.localPath) as string | undefined;
      const submit = (d.localPath as string) || (display ? assetUrlToLocalPath(display) ?? display : undefined);
      // 去重键统一用本地路径形态，避免 localPath 与 asset:// 双形态各算一份
      const key = submit ?? display;
      if (display && key && !seen.has(key)) {
        seen.add(key);
        audios.push({ kind: 'audio', url: display, submitUrl: submit ?? display, edgeId: e.id, sourceNodeId: src.id, name: (d.fileName || d.description) as string | undefined });
      }
    }
  }

  // 节点 data.referenceImages 里"无 edge 背书"的条目（agent 写入 / 删线保留 /
  // FloatingMenu 预置）追加在 edge 序之后，不打乱前面的编号
  const dataRefs = (selfData.referenceImages as { url: string; name?: string }[] | undefined) ?? [];
  for (const r of dataRefs) pushImage(r.url, undefined, undefined, r.name);

  // 资产库主体图：尾部追加（曾经前置导致 @图片N 整体位移且用户不可见）
  for (const url of opts?.extraTailImages ?? []) pushImage(url);

  return { images, videos, audios };
}

/** 图片节点自动编辑参考：当前成图优先，其后才是外部连线参考。 */
export function selfImageFallback(nodeId: string, collected: CollectedRefs): string[] {
  const { nodes } = useCanvasStore.getState();
  const self = nodes.find((n) => n.id === nodeId);
  if (!self || self.type !== 'image') return [];
  const d = (self?.data ?? {}) as Record<string, unknown>;
  const current = (d.generatedImageUrl || d.referenceImage || d.localPath) as string | undefined;
  const currentSubmit = current ? assetUrlToLocalPath(current) ?? current : '';
  return [...new Set([
    currentSubmit,
    ...collected.images.map((ref) => ref.submitUrl),
  ].filter(Boolean))];
}

/** 旧名称保留给现有调用方。 */
export const selfUploadFallback = selfImageFallback;

/**
 * 已有视频节点直接输入修改要求时，只使用用户明确上传/选择的源视频。
 * 生成结果的 generatedVideoUrl/localPath 绝不隐式回灌；若用户确实要拿
 * 某个成片继续编辑，应把该成片节点显式连到目标节点。
 */
export function selfVideoFallback(nodeId: string, collected: CollectedRefs): string[] {
  if (collected.videos.length > 0) return collected.videos.map((r) => r.submitUrl);
  const { nodes } = useCanvasStore.getState();
  const self = nodes.find((n) => n.id === nodeId);
  if (!self || self.type !== 'video') return [];
  const d = (self.data ?? {}) as Record<string, unknown>;
  const source = explicitSelfVideoSource(d);
  const submit = source ? assetUrlToLocalPath(source) ?? source : '';
  return submit ? [submit] : [];
}
