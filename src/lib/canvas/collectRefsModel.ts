import { isNonReferenceEdgeData } from './referencePolicy.ts';

export interface ReferenceNode { id: string; type?: string; data: Record<string, unknown> }
export interface ReferenceEdge { id: string; source: string; target: string; data?: unknown }

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
export function collectReferencesFromSnapshot(
  nodeId: string,
  snapshot: { nodes: ReferenceNode[]; edges: ReferenceEdge[] },
  opts?: { extraTailImages?: string[]; groupImages?: (id: string) => string[]; localPath?: (url: string) => string | null },
): CollectedRefs {
  const { nodes, edges } = snapshot;
  const nodesById = new Map(nodes.map((node) => [node.id, node]));
  const self = nodesById.get(nodeId);
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
    const src = nodesById.get(e.source);
    if (!src) continue;
    const d = src.data as Record<string, unknown>;
    if (src.type === 'image') {
      pushImage((d.generatedImageUrl || d.referenceImage) as string | undefined, e.id, src.id, d.description as string | undefined);
    } else if (src.type === 'group') {
      // 组成员按其 edge 位置原地展开——绝不 unshift 到最前
      for (const url of opts?.groupImages?.(src.id) ?? []) pushImage(url, e.id, src.id);
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
      const submit = (d.localPath as string) || (display ? opts?.localPath?.(display) ?? display : undefined);
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
