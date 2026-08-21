/**
 * canvasSync — 工坊 ↔ 画布双向同步。
 *
 * 协议：画布节点 data.workshopRef = { projectId, kind, id, role }，
 * canvas.json 透传，canvasStore 零侵入。
 *
 * 工坊 → 画布：syncAssetsToCanvas（资产建节点+角色/场景编组）、
 *   syncShotPromptsToCanvas（视频提示词建 video 节点 + 参考资产连线）。
 * 画布 → 工坊：pullFromCanvas（工坊端拉取，新图进候选集不自动替换，
 *   description 变化回传 videoPrompt）。
 */
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { copyFile, createDir, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import type { Node } from 'reactflow';
import { useCanvasStore } from '@/stores/canvasStore';
import { useProjectStore } from '@/stores/projectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { groupSelection } from '@/lib/canvas/grouping';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import { ensureVideoThumb } from '@/lib/canvas/videoThumbs';
import { buildVideoRefPaths } from '@/lib/workshop/shotRefs';
import type { WsShot, WorkshopData } from '@/lib/workshop/types';

function activePromptTemplate(shot: WsShot, data: WorkshopData): 'legacy' | 'universal' {
  return shot.videoPromptTemplate || data.videoPromptTemplate || 'legacy';
}

function activeVideoPrompt(shot: WsShot, data: WorkshopData): string {
  return activePromptTemplate(shot, data) === 'universal'
    ? shot.universalVideoPrompt || shot.seedance25VideoPrompt || shot.videoPrompt || ''
    : shot.videoPrompt || '';
}

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

const NUM_TO_CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];
function numToCn(n: number): string { return n <= 10 ? NUM_TO_CN[n - 1] : String(n); }

function buildShotVideoCanvasRefs(shot: WsShot, data: WorkshopData): { path: string; label: string }[] {
  const paths = buildVideoRefPaths(shot, {
    scenes: data.scenes,
    characters: data.characters,
    props: data.props ?? [],
    colorPalettes: data.colorPalettes ?? [],
    globalColorPaletteId: data.globalColorPaletteId,
  });
  const seen = new Set<string>();
  return paths
    .filter((path) => {
      if (!path || seen.has(path)) return false;
      seen.add(path);
      return true;
    })
    .map((path, i) => ({ path, label: `@图片${numToCn(i + 1)} ${shot.shotNo} 参考素材` }));
}

function clearShotVideoIncomingRefs(videoNodeId: string) {
  const store = useCanvasStore.getState();
  const localRefIds = new Set(
    store.nodes
      .filter((n) => {
        const d = n.data as Record<string, unknown> | undefined;
        return d?.workshopPromptRefTarget === videoNodeId;
      })
      .map((n) => n.id),
  );
  store.setEdges(store.edges.filter((e) => e.target !== videoNodeId && !localRefIds.has(e.source) && !localRefIds.has(e.target)));
  store.setNodes(store.nodes.filter((n) => !localRefIds.has(n.id)));
  store.updateNode(videoNodeId, {
    referenceImages: [],
    referenceVideos: [],
    imageUrl: undefined,
    generatedVideoUrl: undefined,
    localPath: undefined,
    sourceVideoPath: undefined,
    mediaRole: undefined,
  });
}

function connectShotVideoRefs(videoNodeId: string, refs: { path: string; label: string }[], baseX: number, baseY: number, projectId: string) {
  const store = useCanvasStore.getState();
  refs.forEach((ref, idx) => {
    const nodeId = `node-ws-shot-ref-${Date.now()}-${idx}-${Math.random().toString(36).slice(2, 7)}`;
    store.addNode({
      id: nodeId,
      type: 'image',
      position: { x: baseX - 300, y: baseY + idx * 92 },
      style: defaultNodeStyle('image'),
      data: {
        generatedImageUrl: convertFileSrc(ref.path),
        localPath: ref.path,
        description: ref.label,
        workshopPromptRefTarget: videoNodeId,
        workshopRef: { projectId, kind: 'shot', id: videoNodeId, role: 'asset' } satisfies WorkshopRef,
      },
    });
    store.onConnect({ source: nodeId, target: videoNodeId, sourceHandle: null, targetHandle: null });
  });
}

async function copyToAssets(projectId: string, srcAbs: string, baseName: string): Promise<string> {
  const home = await homeDir();
  const ext = srcAbs.includes('.') ? srcAbs.slice(srcAbs.lastIndexOf('.')) : '.png';
  const rel = `.kunpeng/aigc-memory/projects/${projectId}/assets/${baseName}${ext}`;
  await copyFile(srcAbs, rel, { dir: BaseDirectory.Home });
  return `${home}${rel}`;
}

async function copyToShots(projectId: string, srcAbs: string, baseName: string): Promise<string> {
  const home = await homeDir();
  const ext = srcAbs.includes('.') ? srcAbs.slice(srcAbs.lastIndexOf('.')) : '.mp4';
  const rel = `.kunpeng/aigc-memory/projects/${projectId}/shots/${baseName}${ext}`;
  await copyFile(srcAbs, rel, { dir: BaseDirectory.Home });
  return `${home}${rel}`;
}

/** 工坊资产 → 画布：建/更新 image 节点，人物一组、场景一组。 */
export async function syncAssetsToCanvas(): Promise<string> {
  const { project, data } = useWorkshopStore.getState();
  if (!project || !data) return '没有打开的工坊项目';
  const store = useCanvasStore.getState();

  let created = 0;
  let updated = 0;
  const newIdsByKind: Record<'character' | 'scene' | 'prop' | 'colorPalette', string[]> = { character: [], scene: [], prop: [], colorPalette: [] };

  const selectedPaletteIds = new Set([
    data.globalColorPaletteId,
    ...data.shots.map((shot) => shot.colorPaletteId),
  ].filter(Boolean) as string[]);

  const items: { kind: 'character' | 'scene' | 'prop' | 'colorPalette'; id: string; name: string; prompt?: string; imagePath?: string }[] = [
    ...data.characters.map((c) => ({ kind: 'character' as const, id: c.id, name: c.name, prompt: c.assetPrompt, imagePath: c.assetImagePath })),
    ...data.scenes.map((s) => ({ kind: 'scene' as const, id: s.id, name: s.name, prompt: s.assetPrompt, imagePath: s.assetImagePath })),
    ...(data.props ?? []).map((p) => ({ kind: 'prop' as const, id: p.id, name: p.name, prompt: p.assetPrompt, imagePath: p.assetImagePath })),
    ...(data.colorPalettes ?? [])
      .filter((p) => p.assetImagePath && selectedPaletteIds.has(p.id))
      .map((p) => ({ kind: 'colorPalette' as const, id: p.id, name: p.name, prompt: p.usagePrompt || p.assetPrompt, imagePath: p.assetImagePath })),
  ];

  items.forEach((item, i) => {
    const nodes = useCanvasStore.getState().nodes;
    const existing = findRefNode(nodes, project.id, item.kind, item.id, 'asset');
    const imgData = item.imagePath
      ? { generatedImageUrl: convertFileSrc(item.imagePath), localPath: item.imagePath }
      : {};
    if (existing) {
      store.updateNode(existing.id, { ...imgData, description: item.prompt || item.name });
      updated++;
    } else {
      const col = item.kind === 'character' ? 0 : item.kind === 'scene' ? 1 : item.kind === 'prop' ? 2 : 3;
      const idx = newIdsByKind[item.kind].length;
      const nodeId = `node-ws-asset-${Date.now()}-${i}`;
      store.addNode({
        id: nodeId,
        type: 'image',
        position: { x: 80 + col * 320, y: 80 + idx * 240 },
        style: defaultNodeStyle('image'),
        data: {
          ...imgData,
          description: item.prompt || item.name,
          workshopRef: { projectId: project.id, kind: item.kind, id: item.id, role: 'asset' } satisfies WorkshopRef,
        },
      });
      newIdsByKind[item.kind].push(nodeId);
      created++;
    }
  });

  // 编组：新建的角色一组、场景一组（groupSelection 作用于 selected）
  for (const kind of ['character', 'scene', 'prop', 'colorPalette'] as const) {
    const ids = newIdsByKind[kind];
    if (ids.length < 2) continue;
    const cur = useCanvasStore.getState();
    cur.setNodes(cur.nodes.map((n) => ({ ...n, selected: ids.includes(n.id) })));
    groupSelection();
  }
  // 清选中
  const fin = useCanvasStore.getState();
  fin.setNodes(fin.nodes.map((n) => ({ ...n, selected: false })));

  await useProjectStore.getState().flushActiveCanvas();
  return `资产同步完成：新建 ${created} 个节点，更新 ${updated} 个`;
}

/** 工坊分镜提示词 → 画布：video 节点 + 参考资产连线（onConnect 自动写引用）。 */
export async function syncShotPromptsToCanvas(): Promise<string> {
  const { project, data } = useWorkshopStore.getState();
  if (!project || !data) return '没有打开的工坊项目';
  const store = useCanvasStore.getState();

  let created = 0;
  let updated = 0;
  const shotsWithPrompt = data.shots.filter((shot) => activeVideoPrompt(shot, data));

  shotsWithPrompt.forEach((shot, i) => {
    const prompt = activeVideoPrompt(shot, data);
    const nodes = useCanvasStore.getState().nodes;
    const existing = findRefNode(nodes, project.id, 'shot', shot.shotNo, 'shot-video');
    let nodeId = existing?.id;
    let nodePosition = existing?.position ?? { x: 980, y: 80 + (created + updated) * 300 };
    if (existing) {
      store.updateNode(existing.id, {
        description: prompt,
        videoPromptTemplate: shot.videoPromptTemplate,
        legacyVideoPrompt: shot.videoPrompt,
        universalVideoPrompt: shot.universalVideoPrompt || shot.seedance25VideoPrompt,
        generatedVideoUrl: undefined,
        localPath: undefined,
        sourceVideoPath: undefined,
        mediaRole: undefined,
        referenceVideos: [],
      });
      updated++;
    } else {
      nodeId = `node-ws-shot-${Date.now()}-${i}`;
      store.addNode({
        id: nodeId,
        type: 'video',
        position: nodePosition,
        style: defaultNodeStyle('video'),
        data: {
          description: prompt,
          videoPromptTemplate: shot.videoPromptTemplate,
          legacyVideoPrompt: shot.videoPrompt,
          universalVideoPrompt: shot.universalVideoPrompt || shot.seedance25VideoPrompt,
          workshopRef: { projectId: project.id, kind: 'shot', id: shot.shotNo, role: 'shot-video' } satisfies WorkshopRef,
        },
      });
      created++;
    }
    if (!nodeId) return;
    clearShotVideoIncomingRefs(nodeId);
    const refs = buildShotVideoCanvasRefs(shot, data);
    connectShotVideoRefs(nodeId, refs, nodePosition.x, nodePosition.y, project.id);
    useWorkshopStore.getState().updateShot(shot.shotNo, { canvasNodeId: nodeId });
  });

  await useProjectStore.getState().flushActiveCanvas();
  return `分镜同步完成：新建 ${created} 个视频节点（含参考连线），更新 ${updated} 个`;
}

/** 画布 → 工坊：拉取带 workshopRef 的节点变化（画布零污染，工坊端主动）。 */
export async function pullFromCanvas(): Promise<string> {
  const { project, data } = useWorkshopStore.getState();
  if (!project || !data) return '没有打开的工坊项目';
  const ws = useWorkshopStore.getState();
  const nodes = useCanvasStore.getState().nodes;

  let newCandidates = 0;
  let videosPulled = 0;
  let promptsPulled = 0;
  let voicesPulled = 0;

  for (const node of nodes) {
    const ref = refOf(node);
    if (!ref || ref.projectId !== project.id) continue;
    const d = node.data as Record<string, unknown>;

    if (ref.role === 'asset' && (ref.kind === 'character' || ref.kind === 'scene' || ref.kind === 'prop' || ref.kind === 'colorPalette')) {
      const localPath = d.localPath as string | undefined;
      if (!localPath) continue;
      const item = ref.kind === 'character'
        ? ws.data!.characters.find((c) => c.id === ref.id)
        : ref.kind === 'scene'
          ? ws.data!.scenes.find((s) => s.id === ref.id)
          : ref.kind === 'colorPalette'
            ? (ws.data!.colorPalettes ?? []).find((p) => p.id === ref.id)
            : (ws.data!.props ?? []).find((p) => p.id === ref.id);
      if (!item) continue;
      const known = (item.candidates ?? []).some((c) => c.path === localPath)
        || item.assetImagePath === localPath;
      if (known) continue;
      // 画布上改过的图 → 拷入项目 assets/ 进候选集（不自动替换最终图）
      try {
        const dest = await copyToAssets(project.id, localPath, `${ref.kind}-${ref.id.replace(/[^\w-]+/g, '_')}-cv-${Date.now()}`);
        ws.addAssetCandidate(ref.kind, ref.id, {
          path: dest, source: 'canvas', prompt: d.description as string | undefined, createdAt: Date.now(),
        }, false);
        newCandidates++;
      } catch (err) {
        console.warn('[canvasSync] 拉取资产失败:', err);
      }
    }

    if (ref.role === 'shot-image' && ref.kind === 'shot') {
      const shot = ws.data!.shots.find((s) => s.shotNo === ref.id);
      if (!shot) continue;
      const localPath = d.localPath as string | undefined;
      if (!localPath) continue;
      // 画布上生成分镜图后回传 → 写 shot.imagePath 作为分镜图/封面产物；
      // 不再作为视频参考资产传入，视频参考由高清故事板和显式参考图控制。
      if (localPath !== shot.imagePath) {
        try {
          const dest = await copyToShots(project.id, localPath, `${ref.id.replace(/[^\w-]+/g, '_')}-img-${Date.now()}`);
          ws.updateShot(ref.id, { imagePath: dest });
        } catch (err) {
          console.warn('[canvasSync] 拉取分镜图失败:', err);
        }
      }
    }

    if (ref.role === 'shot-video' && ref.kind === 'shot') {
      const shot = ws.data!.shots.find((s) => s.shotNo === ref.id);
      if (!shot) continue;
      const localPath = d.localPath as string | undefined;
      const desc = d.description as string | undefined;
      // 视频回流
      if (localPath && localPath !== shot.videoPath) {
        try {
          const dest = await copyToShots(project.id, localPath, `${ref.id.replace(/[^\w-]+/g, '_')}-cv-${Date.now()}`);
          const thumb = await ensureVideoThumb(dest).catch(() => null);
          ws.updateShot(ref.id, { videoPath: dest, ...(thumb?.path ? { videoThumbPath: thumb.path } : {}), genStatus: 'done' });
          videosPulled++;
        } catch (err) {
          console.warn('[canvasSync] 拉取视频失败:', err);
        }
      }
      // 提示词回传
      const nodeTemplate = d.videoPromptTemplate === 'legacy' || d.videoPromptTemplate === 'universal'
        ? d.videoPromptTemplate
        : activePromptTemplate(shot, ws.data!);
      const currentPrompt = nodeTemplate === 'universal'
        ? shot.universalVideoPrompt || shot.seedance25VideoPrompt || shot.videoPrompt
        : shot.videoPrompt;
      if (desc && desc !== currentPrompt) {
        ws.updateShot(ref.id, nodeTemplate === 'universal' ? { universalVideoPrompt: desc } : { videoPrompt: desc });
        promptsPulled++;
      }
    }
  }

  // 音频节点 → 角色音色：扫描所有 audio 节点，通过 edge 找到连接的角色资产节点
  const edges = useCanvasStore.getState().edges;
  for (const node of nodes) {
    if (node.type !== 'audio') continue;
    const d = node.data as Record<string, unknown>;
    const localPath = d.localPath as string | undefined;
    if (!localPath) continue;
    // 找与此 audio 节点通过 edge 相连的角色资产节点
    const connectedIds = edges
      .filter((e) => e.source === node.id || e.target === node.id)
      .map((e) => e.source === node.id ? e.target : e.source);
    for (const connId of connectedIds) {
      const connNode = nodes.find((n) => n.id === connId);
      if (!connNode) continue;
      const connRef = refOf(connNode);
      if (!connRef || connRef.projectId !== project.id || connRef.kind !== 'character' || connRef.role !== 'asset') continue;
      const char = useWorkshopStore.getState().data!.characters.find((c) => c.id === connRef.id);
      if (!char || char.voicePath === localPath) continue;
      try {
        const ext = localPath.includes('.') ? localPath.slice(localPath.lastIndexOf('.')) : '.mp3';
        const relDir = `.kunpeng/aigc-memory/projects/${project.id}/assets/voices`;
        await createDir(relDir, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
        const rel = `${relDir}/${connRef.id.replace(/[^\w-]+/g, '_')}-cv${ext}`;
        await copyFile(localPath, rel, { dir: BaseDirectory.Home });
        const home = await homeDir();
        useWorkshopStore.getState().setCharacterVoice(connRef.id, `${home}${rel}`, 'canvas');
        voicesPulled++;
      } catch (err) {
        console.warn('[canvasSync] 拉取音色失败:', err);
      }
    }
  }

  if (newCandidates + videosPulled + promptsPulled + voicesPulled === 0) return '画布没有新的变化';
  return `已拉取：${newCandidates} 张新候选图（在候选集中手选启用）、${videosPulled} 段视频、${promptsPulled} 条提示词更新${voicesPulled > 0 ? `、${voicesPulled} 个音色` : ''}`;
}
