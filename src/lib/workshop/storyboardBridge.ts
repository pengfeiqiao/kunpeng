import { convertFileSrc } from '@tauri-apps/api/tauri';
import { BaseDirectory, copyFile, createDir } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import type { Edge, Node } from 'reactflow';
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import { loadImageBitmap } from '@/lib/canvas/imageSource';
import { saveCanvasImage } from '@/lib/canvas/assetPersist';
import {
  applyVideoPlanningReferencePrefixes,
  buildImageRefPaths,
  compactStoryboardFrameReferences,
  numToCn,
  remapShotPromptRefs,
} from '@/lib/workshop/shotRefs';
import type { ShotRefBinding } from '@/lib/workshop/shotRefs';
import type { AssetCandidate, StoryboardBoard, StoryboardFrame, WorkshopData, WsShot } from '@/lib/workshop/types';
import type { WorkshopRef } from '@/lib/workshop/canvasSync';

export interface StoryboardFrameTarget {
  projectId: string;
  shotId: string;
  shotNo: string;
  frameId: string;
  frameIndex: number;
  prompt: string;
  imagePath?: string;
  revision: number;
}

export interface StoryboardShotTarget {
  projectId: string;
  shotId: string;
  shotNo: string;
  description: string;
  frameCount: number;
  boardCount: number;
}

function getOpenProject() {
  const state = useWorkshopStore.getState();
  if (!state.project || !state.data) throw new Error('请先打开对应的工坊项目');
  return { project: state.project, data: state.data };
}

function shotIdentity(shot: WsShot): string {
  return shot.id ?? shot.shotNo;
}

function findShot(data: WorkshopData, shotIdOrNo: string): WsShot | undefined {
  return data.shots.find((shot) => shot.id === shotIdOrNo || shot.shotNo === shotIdOrNo);
}

function refContext(data: WorkshopData) {
  return {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  };
}

function nextCanvasPosition(nodes: Node[]): { x: number; y: number } {
  if (nodes.length === 0) return { x: 120, y: 120 };
  const right = Math.max(...nodes.map((node) => node.position.x + Number(node.width ?? 280)));
  const top = Math.min(...nodes.map((node) => node.position.y));
  return { x: right + 120, y: top };
}

function findFrameNode(projectId: string, frameId: string): Node | undefined {
  return useCanvasStore.getState().nodes.find((node) => {
    const ref = (node.data as Record<string, unknown> | undefined)?.workshopRef as WorkshopRef | undefined;
    return ref?.projectId === projectId && ref.kind === 'storyboardFrame' && ref.id === frameId;
  });
}

function canvasReferenceKind(binding: ShotRefBinding): WorkshopRef['kind'] {
  if (binding.kind === 'palette') return 'colorPalette';
  if (binding.kind === 'directorConstraintCard') return 'directorConstraintCard';
  if (binding.kind === 'scene' || binding.kind === 'character' || binding.kind === 'prop') return binding.kind;
  return 'shot';
}

function canvasReferenceId(shot: WsShot, frame: StoryboardFrame, binding: ShotRefBinding): string {
  return binding.id ?? `${shotIdentity(shot)}:${frame.id}:${binding.kind}:${binding.index}`;
}

async function ensureWorkshopCanvasIsActive(projectId: string): Promise<void> {
  const projectStore = useProjectStore.getState();
  const workshop = useWorkshopStore.getState();
  const linked = projectStore.projects.find(
    (item) =>
      item.aigcProjectId === projectId
      || item.id === workshop.data?.canvasProjectId
      || item.id === projectId,
  );
  if (!linked) {
    throw new Error('对应工坊工程尚未出现在画布项目列表中，请先重新打开该工坊项目');
  }
  if (projectStore.activeProjectId !== linked.id) {
    await projectStore.switchProject(linked.id);
  }
}

function buildFrameReferenceNodes(
  projectId: string,
  shot: WsShot,
  frame: StoryboardFrame,
  targetNodeId: string,
  targetPosition: { x: number; y: number },
  bindings: ShotRefBinding[],
): { nodes: Node[]; edges: Edge[]; referenceImages: { url: string; name: string }[] } {
  const nodes: Node[] = [];
  const edges: Edge[] = [];
  const referenceImages: { url: string; name: string }[] = [];

  bindings.forEach((binding, index) => {
    const sourceNodeId = `node-ws-frame-ref-${frame.id}-${index + 1}`;
    const url = convertFileSrc(binding.path);
    const name = `@图片${numToCn(binding.index)} ${binding.label}`.trim();
    const workshopRef: WorkshopRef = {
      projectId,
      kind: canvasReferenceKind(binding),
      id: canvasReferenceId(shot, frame, binding),
      role: 'prompt-reference',
      shotId: shotIdentity(shot),
      shotNoSnapshot: shot.shotNo,
      frameId: frame.id,
      sourceRevision: frame.revision ?? 0,
    };
    nodes.push({
      id: sourceNodeId,
      type: 'image',
      position: {
        x: targetPosition.x - 340,
        y: targetPosition.y + index * 112,
      },
      style: defaultNodeStyle('image'),
      data: {
        generatedImageUrl: url,
        localPath: binding.path,
        description: name,
        workshopPromptRefTarget: targetNodeId,
        workshopReferenceIndex: binding.index,
        workshopReferenceKind: binding.kind,
        workshopRef,
      },
    });
    edges.push({
      id: `e-ws-frame-ref-${frame.id}-${index + 1}`,
      source: sourceNodeId,
      target: targetNodeId,
      type: 'custom',
    });
    referenceImages.push({ url, name });
  });

  return { nodes, edges, referenceImages };
}

export function listStoryboardFrameTargets(): StoryboardFrameTarget[] {
  const state = useWorkshopStore.getState();
  if (!state.project || !state.data) return [];
  return state.data.shots.flatMap((shot) =>
    (shot.storyboardFrames ?? []).map((frame, frameIndex) => ({
      projectId: state.project!.id,
      shotId: shotIdentity(shot),
      shotNo: shot.shotNo,
      frameId: frame.id,
      frameIndex,
      prompt: frame.prompt,
      imagePath: frame.imagePath,
      revision: frame.revision ?? 0,
    })),
  );
}

export function listStoryboardShotTargets(): StoryboardShotTarget[] {
  const state = useWorkshopStore.getState();
  if (!state.project || !state.data) return [];
  return state.data.shots.map((shot) => ({
    projectId: state.project!.id,
    shotId: shotIdentity(shot),
    shotNo: shot.shotNo,
    description: shot.description,
    frameCount: shot.storyboardFrames?.length ?? 0,
    boardCount: shot.storyboardBoards?.length ?? 0,
  }));
}

export async function sendStoryboardFrameToCanvas(
  shotIdOrNo: string,
  frameId: string,
): Promise<{
  nodeId: string;
  created: boolean;
  referenceCount: number;
  referenceNodeIds: string[];
  target: StoryboardFrameTarget;
}> {
  const { project, data } = getOpenProject();
  const shot = findShot(data, shotIdOrNo);
  const frameIndex = shot?.storyboardFrames?.findIndex((item) => item.id === frameId) ?? -1;
  const frame = frameIndex >= 0 ? shot!.storyboardFrames![frameIndex] : undefined;
  if (!shot || !frame) throw new Error('目标故事板分镜不存在，可能已被删除或重排');

  await ensureWorkshopCanvasIsActive(project.id);
  const store = useCanvasStore.getState();
  const beforeNodes = store.nodes;
  const beforeEdges = store.edges;
  const existing = findFrameNode(project.id, frame.id);
  const nodeId = existing?.id ?? `node-ws-frame-${frame.id}`;
  const targetPosition = existing?.position ?? nextCanvasPosition(
    store.nodes.filter((node) => {
      const data = node.data as Record<string, unknown> | undefined;
      return data?.workshopPromptRefTarget !== nodeId;
    }),
  );
  const compacted = compactStoryboardFrameReferences(shot, frame, refContext(data));
  const bindings = compacted.bindings;
  const managed = buildFrameReferenceNodes(
    project.id,
    shot,
    frame,
    nodeId,
    targetPosition,
    bindings,
  );
  const existingData = (existing?.data ?? {}) as Record<string, unknown>;
  const previousManagedUrls = new Set(
    (existingData.workshopManagedReferenceUrls as string[] | undefined) ?? [],
  );
  const manualReferenceImages = (
    (existingData.referenceImages as { url: string; name?: string }[] | undefined) ?? []
  ).filter((item) => !previousManagedUrls.has(item.url));
  const workshopRef: WorkshopRef = {
    projectId: project.id,
    kind: 'storyboardFrame',
    id: frame.id,
    role: 'storyboard-frame',
    shotId: shotIdentity(shot),
    shotNoSnapshot: shot.shotNo,
    frameId: frame.id,
    sourceRevision: frame.revision ?? 0,
  };
  const patch = {
    description: compacted.prompt,
    ...(frame.imagePath
      ? { generatedImageUrl: convertFileSrc(frame.imagePath), localPath: frame.imagePath }
      : { generatedImageUrl: undefined, localPath: undefined }),
    referenceImages: [...managed.referenceImages, ...manualReferenceImages],
    generationMode: managed.referenceImages.length > 0 ? 'image-to-image' : 'text-to-image',
    workshopManagedReferenceUrls: managed.referenceImages.map((item) => item.url),
    workshopRef,
    storyboardTarget: {
      projectId: project.id,
      shotId: shotIdentity(shot),
      shotNo: shot.shotNo,
      frameId: frame.id,
      frameIndex,
      sourceRevision: frame.revision ?? 0,
    },
  };

  const managedNodeIds = new Set(
    beforeNodes
      .filter((node) => {
        const nodeData = node.data as Record<string, unknown> | undefined;
        return nodeData?.workshopPromptRefTarget === nodeId;
      })
      .map((node) => node.id),
  );
  const baseNodes = beforeNodes.filter((node) => !managedNodeIds.has(node.id));
  const nextTarget: Node = existing
    ? { ...existing, position: targetPosition, data: { ...existing.data, ...patch } }
    : {
      id: nodeId,
      type: 'image',
      position: targetPosition,
      style: defaultNodeStyle('image'),
      data: patch,
    };
  const nextNodes = existing
    ? baseNodes.map((node) => (node.id === nodeId ? nextTarget : node))
    : [...baseNodes, nextTarget];
  const baseEdges = beforeEdges.filter(
    (edge) => !managedNodeIds.has(edge.source) && !managedNodeIds.has(edge.target),
  );

  try {
    // 参考边放在全局 edge 数组前部，collectNodeReferences 按 edge 顺序编号，
    // 因此该格提示词里的 @图片N 永远先对应这批工坊资产。
    store.setNodes([...nextNodes, ...managed.nodes]);
    store.setEdges([...managed.edges, ...baseEdges]);
    await useProjectStore.getState().flushActiveCanvas();
  } catch (error) {
    store.setNodes(beforeNodes);
    store.setEdges(beforeEdges);
    await useProjectStore.getState().flushActiveCanvas().catch(() => {});
    throw new Error(`分镜传入画布失败，已恢复原画布：${error instanceof Error ? error.message : String(error)}`);
  }
  return {
    nodeId,
    created: !existing,
    referenceCount: managed.nodes.length,
    referenceNodeIds: managed.nodes.map((node) => node.id),
    target: {
      projectId: project.id,
      shotId: shotIdentity(shot),
      shotNo: shot.shotNo,
      frameId: frame.id,
      frameIndex,
      prompt: frame.prompt,
      imagePath: frame.imagePath,
      revision: frame.revision ?? 0,
    },
  };
}

async function copyCanvasImageToProject(projectId: string, src: string, baseName: string): Promise<string> {
  const home = await homeDir();
  const ext = /\.[a-z0-9]{2,5}$/i.exec(src)?.[0] ?? '.png';
  const relDir = `.kunpeng/aigc-memory/projects/${projectId}/shots/storyboard`;
  await createDir(relDir, { dir: BaseDirectory.Home, recursive: true });
  const rel = `${relDir}/${baseName}${ext}`;
  await copyFile(src, rel, { dir: BaseDirectory.Home });
  return `${home}${rel}`;
}

export async function writeCanvasImageToStoryboardFrame(options: {
  nodeId: string;
  shotId: string;
  frameId?: string;
  setCurrent?: boolean;
  syncPrompt?: boolean;
  expectedRevision?: number;
  clientToken?: string;
}): Promise<{
  shotNo: string;
  frameId: string;
  frameIndex: number;
  path: string;
  revision: number;
  reused: boolean;
  createdFrame: boolean;
}> {
  const { project, data } = getOpenProject();
  const shot = findShot(data, options.shotId);
  if (!shot) throw new Error('回传镜头不存在，请重新选择');
  const existingFrames = shot.storyboardFrames ?? [];
  const token = options.clientToken?.trim();
  const tokenFrameIndex = token
    ? existingFrames.findIndex((item) => item.candidates?.some((candidate) => candidate.clientToken === token))
    : -1;
  if (tokenFrameIndex >= 0) {
    const tokenFrame = existingFrames[tokenFrameIndex];
    const existing = tokenFrame.candidates!.find((item) => item.clientToken === token)!;
    return {
      shotNo: shot.shotNo,
      frameId: tokenFrame.id,
      frameIndex: tokenFrameIndex,
      path: existing.path,
      revision: tokenFrame.revision ?? 0,
      reused: true,
      createdFrame: false,
    };
  }

  const requestedFrameId = options.frameId?.trim();
  let frameIndex = requestedFrameId
    ? existingFrames.findIndex((item) => item.id === requestedFrameId)
    : -1;
  let frame = frameIndex >= 0 ? existingFrames[frameIndex] : undefined;
  const createdFrame = !requestedFrameId && existingFrames.length === 0;
  if (requestedFrameId && !frame) throw new Error('回传目标格不存在，请刷新后重新选择');
  if (!requestedFrameId && existingFrames.length > 0) throw new Error('该镜已有故事板，请选择要回传的具体分镜格');

  const node = useCanvasStore.getState().nodes.find((item) => item.id === options.nodeId);
  if (!node || node.type !== 'image') throw new Error('请选择一个图片节点再回传');
  const nodeData = node.data as Record<string, unknown>;
  const localPath = nodeData.localPath as string | undefined;
  if (!localPath) throw new Error('这张图还没有本地文件，请先等待生成或下载完成');

  if (createdFrame) {
    frameIndex = 0;
    frame = {
      id: `sb-${nanoid(8)}`,
      prompt: typeof nodeData.description === 'string' && nodeData.description.trim()
        ? nodeData.description.trim()
        : shot.imagePrompt || shot.description || '画布回传分镜',
      refImagePaths: buildImageRefPaths(shot, refContext(data)),
      selected: true,
      status: 'idle',
      revision: 0,
    };
  }
  if (!frame) throw new Error('无法建立回传目标分镜格');

  const currentRevision = frame.revision ?? 0;
  if (options.expectedRevision !== undefined && options.expectedRevision !== currentRevision) {
    throw new Error(`目标已被修改：预期版本 ${options.expectedRevision}，当前版本 ${currentRevision}。请刷新后确认回传。`);
  }
  const reused = Boolean(token && frame.candidates?.some((item) => item.clientToken === token));
  if (reused) {
    const existing = frame.candidates!.find((item) => item.clientToken === token)!;
    return {
      shotNo: shot.shotNo,
      frameId: frame.id,
      frameIndex,
      path: existing.path,
      revision: currentRevision,
      reused: true,
      createdFrame,
    };
  }

  const nextRevision = currentRevision + 1;
  const dest = await copyCanvasImageToProject(
    project.id,
    localPath,
    `${shot.shotNo.replace(/[^\w-]+/g, '_')}-${frame.id}-v${nextRevision}-${nanoid(5)}`,
  );
  const baseCandidates = [...(frame.candidates ?? [])];
  if (frame.imagePath && !baseCandidates.some((item) => item.path === frame.imagePath)) {
    baseCandidates.push({
      path: frame.imagePath,
      source: 'generate',
      prompt: frame.prompt,
      revision: currentRevision,
      createdAt: Date.now(),
    });
  }
  const candidate: AssetCandidate = {
    path: dest,
    source: 'canvas',
    prompt: nodeData.description as string | undefined,
    originNodeId: node.id,
    clientToken: token || undefined,
    revision: nextRevision,
    createdAt: Date.now(),
  };
  const nextFrame: StoryboardFrame = {
    ...frame,
    candidates: [...baseCandidates, candidate],
    ...(createdFrame || options.setCurrent !== false ? { imagePath: dest, status: 'done' as const } : {}),
    ...(options.syncPrompt && typeof nodeData.description === 'string'
      ? { prompt: nodeData.description }
      : {}),
    revision: nextRevision,
  };
  const frames = createdFrame
    ? [nextFrame]
    : existingFrames.map((item) => item.id === frame.id ? nextFrame : item);
  useWorkshopStore.getState().updateShot(shot.shotNo, { storyboardFrames: frames });
  try {
    await useWorkshopStore.getState().commitNow();
  } catch (error) {
    useWorkshopStore.getState().updateShot(shot.shotNo, { storyboardFrames: existingFrames });
    throw error;
  }
  return {
    shotNo: shot.shotNo,
    frameId: nextFrame.id,
    frameIndex,
    path: dest,
    revision: nextRevision,
    reused: false,
    createdFrame,
  };
}

function ratioSize(ratio?: string): { width: number; height: number } {
  switch (ratio) {
    case '9:16': return { width: 1080, height: 1920 };
    case '3:4': return { width: 1200, height: 1600 };
    case '4:3': return { width: 1600, height: 1200 };
    case '1:1': return { width: 1600, height: 1600 };
    case '21:9': return { width: 2100, height: 900 };
    default: return { width: 1920, height: 1080 };
  }
}

function autoGrid(count: number, ratio?: string): { columns: number; rows: number; label: string } {
  const portrait = ratio === '9:16' || ratio === '3:4';
  if (count <= 2) return portrait
    ? { columns: 1, rows: count, label: `1x${count}` }
    : { columns: count, rows: 1, label: `${count}x1` };
  if (count <= 4) return { columns: 2, rows: 2, label: '2x2' };
  if (count <= 6) return portrait
    ? { columns: 2, rows: 3, label: '2x3' }
    : { columns: 3, rows: 2, label: '3x2' };
  return { columns: 3, rows: 3, label: '3x3' };
}

function drawBitmap(
  ctx: CanvasRenderingContext2D,
  image: ImageBitmap,
  x: number,
  y: number,
  width: number,
  height: number,
  fit: 'contain' | 'cover',
) {
  const scale = fit === 'cover'
    ? Math.max(width / image.width, height / image.height)
    : Math.min(width / image.width, height / image.height);
  const drawWidth = image.width * scale;
  const drawHeight = image.height * scale;
  const drawX = x + (width - drawWidth) / 2;
  const drawY = y + (height - drawHeight) / 2;
  if (fit === 'cover') {
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
  }
  ctx.drawImage(image, drawX, drawY, drawWidth, drawHeight);
  if (fit === 'cover') ctx.restore();
}

async function composeBoard(paths: string[], ratio: string | undefined, fit: 'contain' | 'cover') {
  const { width, height } = ratioSize(ratio);
  const grid = autoGrid(paths.length, ratio);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('当前环境不支持图片合成');
  ctx.fillStyle = '#101113';
  ctx.fillRect(0, 0, width, height);
  const gap = Math.max(8, Math.round(width * 0.006));
  const cellWidth = (width - gap * (grid.columns - 1)) / grid.columns;
  const cellHeight = (height - gap * (grid.rows - 1)) / grid.rows;
  const bitmaps = await Promise.all(paths.map((path) => loadImageBitmap(path)));
  bitmaps.forEach((bitmap, index) => {
    const x = (index % grid.columns) * (cellWidth + gap);
    const y = Math.floor(index / grid.columns) * (cellHeight + gap);
    drawBitmap(ctx, bitmap, x, y, cellWidth, cellHeight, fit);
    bitmap.close();
  });
  return {
    imagePath: await saveCanvasImage(canvas.toDataURL('image/png'), 'canvas-storyboard-board'),
    layout: grid.label,
  };
}

export async function composeCanvasSelectionToStoryboardBoard(options: {
  nodeIds: string[];
  shotId: string;
  fit?: 'contain' | 'cover';
  useInVideo?: boolean;
  clientToken?: string;
}): Promise<{ board: StoryboardBoard; nodeId: string; shotNo: string; reused: boolean }> {
  const { project, data } = getOpenProject();
  const shot = findShot(data, options.shotId);
  if (!shot) throw new Error('目标镜头不存在');
  const token = options.clientToken?.trim();
  const existingBoard = token
    ? shot.storyboardBoards?.find((board) => board.clientToken === token)
    : undefined;
  if (existingBoard) {
    const existingNode = useCanvasStore.getState().nodes.find((node) => {
      const ref = (node.data as Record<string, unknown>)?.workshopRef as WorkshopRef | undefined;
      return ref?.kind === 'storyboardBoard' && ref.id === existingBoard.id;
    });
    return { board: existingBoard, nodeId: existingNode?.id ?? '', shotNo: shot.shotNo, reused: true };
  }
  const uniqueIds = [...new Set(options.nodeIds)];
  if (uniqueIds.length < 2) throw new Error('至少选择 2 张图片');
  if (uniqueIds.length > 9) throw new Error('一次最多拼 9 张；超过 9 张请拆成多块分镜板');
  const nodes = uniqueIds.map((id) => useCanvasStore.getState().nodes.find((node) => node.id === id));
  if (nodes.some((node) => !node || node.type !== 'image')) throw new Error('所选内容中包含非图片节点');
  const paths = nodes.map((node) => (node!.data as Record<string, unknown>).localPath as string | undefined);
  if (paths.some((path) => !path)) throw new Error('有图片还没有本地文件，请等待生成或下载完成');
  const fit = options.fit ?? 'contain';
  const composed = await composeBoard(paths as string[], shot.videoRatio, fit);
  const dest = await copyCanvasImageToProject(
    project.id,
    composed.imagePath,
    `${shot.shotNo.replace(/[^\w-]+/g, '_')}-board-${Date.now()}-${nanoid(5)}`,
  );
  const frameIds = nodes.flatMap((node) => {
    const ref = (node!.data as Record<string, unknown>).workshopRef as WorkshopRef | undefined;
    return ref?.kind === 'storyboardFrame' && ref.frameId ? [ref.frameId] : [];
  });
  const board: StoryboardBoard = {
    id: `board-${shotIdentity(shot)}-${Date.now()}-${nanoid(5)}`,
    frameIds,
    imagePath: dest,
    createdAt: Date.now(),
    useInVideo: options.useInVideo !== false,
    sourceCanvasNodeIds: uniqueIds,
    layout: composed.layout,
    fit,
    clientToken: token || undefined,
  };
  const oldShot = shot;
  const nextBoards = [...(shot.storyboardBoards ?? []), board];
  const nextShot = { ...shot, storyboardBoards: nextBoards };
  const remapped = remapShotPromptRefs(oldShot, nextShot, refContext(data));
  useWorkshopStore.getState().updateShot(shot.shotNo, {
    ...remapped,
    storyboardBoards: nextBoards,
    videoPrompt: applyVideoPlanningReferencePrefixes(nextShot, remapped.videoPrompt ?? shot.videoPrompt),
  });
  await useWorkshopStore.getState().commitNow();

  const canvas = useCanvasStore.getState();
  const nodeId = `node-ws-board-${board.id}`;
  canvas.addNode({
    id: nodeId,
    type: 'image',
    position: nextCanvasPosition(canvas.nodes),
    style: defaultNodeStyle('image'),
    data: {
      generatedImageUrl: convertFileSrc(dest),
      localPath: dest,
      description: `${shot.shotNo} 完整分镜板 · ${composed.layout}`,
      workshopRef: {
        projectId: project.id,
        kind: 'storyboardBoard',
        id: board.id,
        role: 'storyboard-board',
        shotId: shotIdentity(shot),
        shotNoSnapshot: shot.shotNo,
      } satisfies WorkshopRef,
    },
  });
  uniqueIds.forEach((source) => canvas.onConnect({ source, target: nodeId, sourceHandle: null, targetHandle: null }));
  await useProjectStore.getState().flushActiveCanvas();
  return { board, nodeId, shotNo: shot.shotNo, reused: false };
}
