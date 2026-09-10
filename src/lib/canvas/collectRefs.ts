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
  explicitSelfImageSource,
  explicitSelfVideoSource,
} from '@/lib/canvas/referencePolicy';

import { collectReferencesFromSnapshot, type CollectedRefs } from './collectRefsModel';
export type { CollectedRef, CollectedRefs } from './collectRefsModel';

export function collectNodeReferences(nodeId: string, opts?: { extraTailImages?: string[] }): CollectedRefs {
  return collectReferencesFromSnapshot(nodeId, useCanvasStore.getState(), {
    ...opts,
    groupImages: getGroupImages,
    localPath: assetUrlToLocalPath,
  });
}

/**
 * 图片节点隐式编辑源判定在 referencePolicy.explicitSelfImageSource（纯函数，已测）。
 * 图片节点自动编辑参考：用户显式上传的当前图优先，其后才是外部连线参考；AI 产物不回灌。
 */
export function selfImageFallback(nodeId: string, collected: CollectedRefs): string[] {
  const { nodes } = useCanvasStore.getState();
  const self = nodes.find((n) => n.id === nodeId);
  if (!self || self.type !== 'image') return [];
  const d = (self?.data ?? {}) as Record<string, unknown>;
  const source = explicitSelfImageSource(d);
  const currentSubmit = source ? assetUrlToLocalPath(source) ?? source : '';
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
