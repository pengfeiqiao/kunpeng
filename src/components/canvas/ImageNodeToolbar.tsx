import { useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Maximize2, Copy, Upload, Download, Trash2, Camera, Grid3X3, Shuffle,
  Clapperboard, Wand2, MoreHorizontal, GitBranch, Clock, Layers, Lightbulb, ScanFace, ArrowLeftToLine,
  User, Mountain, Package, Palette, X, FolderOpen, Crop, RotateCcw, Bot,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { useCanvasStore } from '@/stores/canvasStore';
import NodeToolbarPortal from './NodeToolbarPortal';
import { nanoid } from 'nanoid';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { invoke } from '@tauri-apps/api/tauri';
import { message as tauriMessage, open } from '@tauri-apps/api/dialog';
import { generateForNode } from '@/lib/canvasGen';
import { IMAGE_TOOLS, applyImageTool } from '@/lib/canvas/imageTools';
import MaskPaintEditor, { type MaskToolMode } from './MaskPaintEditor';
import { deriveStoryGrid4, deriveBranchGrid4, multiCam9, storyboard25, deriveSingle } from '@/lib/canvas/gridDerive';
import ImageFullscreenViewer from './ImageFullscreenViewer';
import { lazy, Suspense } from 'react';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import { saveCanvasImage } from '@/lib/canvas/assetPersist';
import {
  buildColorPalettePrompt,
  buildPaletteUsagePrompt,
  extractPaletteFromImageUrl,
  renderColorPaletteDataUrl,
} from '@/lib/workshop/colorPalettes';

// three.js 较重——懒加载使其进入异步 chunk，不占主包
const Image3DCameraEditor = lazy(() => import('./Image3DCameraEditor'));
import StoryboardSplitter from './StoryboardSplitter';
import ImageCropEditor from './ImageCropEditor';
import ToolbarDropdown, { type DropdownItem } from './ToolbarDropdown';
import type { ImageNodeData } from '@/types/canvas';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useProjectStore } from '@/stores/projectStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import type { WorkshopAssetKind } from '@/lib/workshop/types';
import StoryboardCanvasActions from './StoryboardCanvasActions';
import { openCanvasNodeInAgent } from '@/lib/canvas/nodeAgent';
import { normalizeMidjourneyVersion } from '@/lib/midjourney/prompt';

interface ImageNodeToolbarProps {
  nodeId: string;
  imageUrl: string;
}

export default function ImageNodeToolbar({ nodeId, imageUrl }: ImageNodeToolbarProps) {
  const [showFullscreen, setShowFullscreen] = useState(false);
  const [show3DCamera, setShow3DCamera] = useState(false);
  const [showStoryboard, setShowStoryboard] = useState(false);
  const [showCrop, setShowCrop] = useState(false);
  const [maskMode, setMaskMode] = useState<MaskToolMode | null>(null);
  const [showWorkshopPicker, setShowWorkshopPicker] = useState(false);
  const [showStoryboardWriteback, setShowStoryboardWriteback] = useState(false);

  const handleFullscreen = useCallback(() => setShowFullscreen(true), []);

  const handleDuplicate = useCallback(() => {
    const { nodes, addNode } = useCanvasStore.getState();
    const currentNode = nodes.find((n) => n.id === nodeId);
    if (!currentNode) return;
    addNode({
      id: `node-${nanoid(8)}`,
      type: 'image',
      position: { x: currentNode.position.x + 40, y: currentNode.position.y + 40 },
      style: (currentNode.style as Record<string, unknown> | undefined) ?? defaultNodeStyle('image'),
      data: { ...currentNode.data },
      width: currentNode.width ?? undefined,
      height: currentNode.height ?? undefined,
    });
  }, [nodeId]);

  const handleUploadReplace = useCallback(async () => {
    try {
      const selected = await open({ filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] }], multiple: false });
      if (!selected || Array.isArray(selected)) return;
      const assetUrl = convertFileSrc(selected);
      useCanvasStore.getState().updateNode(nodeId, { referenceImage: assetUrl, generatedImageUrl: undefined, isUploadedImage: true });
    } catch (err) {
      console.error('上传图片失败:', err);
    }
  }, [nodeId]);

  const handleDownload = useCallback(async () => {
    try {
      await invoke('save_file_dialog', {
        sourcePath: imageUrl,
        defaultName: `image-${Date.now()}.png`,
      });
    } catch (err) {
      console.error('下载图片失败:', err);
    }
  }, [imageUrl]);

  const handleOpenFolder = useCallback(async () => {
    try {
      // 优先用 node.data.localPath（绝对路径），否则从 asset:// URL 反解
      const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
      const d = (node?.data ?? {}) as Record<string, unknown>;
      let localPath = (d.localPath as string) || '';
      if (!localPath) {
        // asset://localhost/<encoded> → 本地路径
        if (imageUrl.startsWith('https://asset.localhost/')) {
          localPath = decodeURIComponent(imageUrl.replace('https://asset.localhost/', '/').replace(/^\/+/, '/'));
        } else if (imageUrl.startsWith('asset://localhost/')) {
          localPath = decodeURIComponent(imageUrl.replace('asset://localhost/', '/').replace(/^\/+/, '/'));
        } else if (imageUrl.startsWith('/')) {
          localPath = imageUrl;
        }
      }
      if (!localPath) { await tauriMessage('未找到本地文件路径', { title: '提示' }); return; }
      await invoke('open_path', { path: localPath, reveal: true });
    } catch (err) {
      console.error('打开文件夹失败:', err);
      await tauriMessage(`打开失败：${err instanceof Error ? err.message : String(err)}`, { title: '错误' });
    }
  }, [nodeId, imageUrl]);

  const handleDelete = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    useCanvasStore.getState().deleteNode(nodeId);
  }, [nodeId]);

  // 生成变体：从当前成功节点分支出一个新节点，复用 prompt + 当前图作参考。
  const handleVariant = useCallback(() => {
    const { nodes, addNode, onConnect, setSelectedNodeId } = useCanvasStore.getState();
    const src = nodes.find((n) => n.id === nodeId);
    if (!src) return;
    const data = src.data as ImageNodeData;
    const prompt = data.description || '';
    if (!prompt) return;
    const isMidjourney = String(data.imageModel ?? '').startsWith('midjourney');
    const midjourneyVersion = normalizeMidjourneyVersion(data.modelVersion);
    const newId = `node-${nanoid(8)}`;
    addNode({
      id: newId,
      type: 'image',
      position: { x: src.position.x + (src.width ?? 200) + 60, y: src.position.y + 40 },
      style: defaultNodeStyle('image'),
      data: {
        description: prompt,
        generationMode: 'image-to-image',
        imageModel: data.imageModel,
        modelVersion: data.modelVersion,
        midjourneyStyleId: data.midjourneyStyleId,
        midjourneyStylize: data.midjourneyStylize,
        midjourneyChaos: data.midjourneyChaos,
        midjourneyRaw: data.midjourneyRaw,
        midjourneyStyleWeight: data.midjourneyStyleWeight,
        midjourneyImageWeight: data.midjourneyImageWeight,
        midjourneyWeird: data.midjourneyWeird,
        aspectRatio: data.aspectRatio,
      },
    });
    onConnect({ source: nodeId, target: newId, sourceHandle: null, targetHandle: null });
    setSelectedNodeId(newId);
    void generateForNode({
      nodeId: newId,
      engineId: isMidjourney && midjourneyVersion === 'v8.1' ? 'midjourney-v81' : isMidjourney ? 'midjourney-v82' : 'gpt-image-2',
      prompt,
      referenceUrls: [imageUrl],
      params: {
        ...(data.aspectRatio ? { aspectRatio: data.aspectRatio as string } : {}),
        ...(isMidjourney ? {
          version: midjourneyVersion,
          stylize: data.midjourneyStylize,
          chaos: data.midjourneyChaos,
          raw: data.midjourneyRaw,
          styleWeight: data.midjourneyStyleWeight,
          imageWeight: data.midjourneyImageWeight,
          weird: data.midjourneyWeird,
        } : {}),
      },
    });
  }, [nodeId, imageUrl]);

  const handleImageToPrompt = useCallback(() => {
    useCanvasStore.getState().triggerAgentAction('ai-image-to-prompt', nodeId);
  }, [nodeId]);

  const handleGeneratePalette = useCallback(async () => {
    const store = useCanvasStore.getState();
    const src = store.nodes.find((n) => n.id === nodeId);
    if (!src) return;
    const srcData = src.data as Record<string, unknown>;
    const titleBase = ((srcData.description as string) || '画布图片').slice(0, 18);
    const name = `${titleBase} · 色彩系统`;
    const description = 'canvas image extracted cinematic palette';
    try {
      const colors = await extractPaletteFromImageUrl(imageUrl, 13);
      const dataUrl = renderColorPaletteDataUrl(name, description, colors);
      const savedPath = await saveCanvasImage(dataUrl, 'color-palette');
      const displayUrl = convertFileSrc(savedPath);
      const project = useWorkshopStore.getState().project;
      const paletteId = `palette-${nanoid(8)}`;
      const assetPrompt = buildColorPalettePrompt(name, description, colors);
      const usagePrompt = buildPaletteUsagePrompt(name, colors);

      store.addNode({
        id: `node-${nanoid(8)}`,
        type: 'image',
        position: { x: src.position.x + (src.width ?? 220) + 80, y: src.position.y },
        style: defaultNodeStyle('image'),
        data: {
          generatedImageUrl: displayUrl,
          localPath: savedPath,
          description: name,
          isUploadedImage: true,
          ...(project ? { workshopRef: { projectId: project.id, kind: 'colorPalette', id: paletteId, role: 'asset' } } : {}),
        },
      });

      if (project) {
        const ws = useWorkshopStore.getState();
        ws.upsertColorPalette({
          id: paletteId,
          name,
          description,
          colors,
          assetPrompt,
          usagePrompt,
          assetImagePath: savedPath,
          candidates: [{ path: savedPath, source: 'canvas', prompt: assetPrompt, createdAt: Date.now() }],
          assetEngine: 'gpt-image-2',
          source: 'canvas',
          createdAt: Date.now(),
        });
        if (!ws.data?.globalColorPaletteId) ws.setGlobalColorPalette(paletteId);
        await ws.save();
      }
      await tauriMessage(project ? '已基于当前图片生成色卡，并回流到当前工坊。' : '已基于当前图片生成色卡。', { title: '生成色卡' });
    } catch (err) {
      await tauriMessage(err instanceof Error ? err.message : String(err), { title: '生成色卡失败', type: 'error' });
    }
  }, [nodeId, imageUrl]);

  // 一键三视图：左正脸大图 + 右三视图组合（aigc-memory 角色设计图模板）
  const handleTurnaround = useCallback(() => {
    const { nodes, addNode, onConnect, setSelectedNodeId } = useCanvasStore.getState();
    const src = nodes.find((n) => n.id === nodeId);
    if (!src) return;
    const prompt = '角色设计三视图组合图：画面左侧为该角色的正脸肖像大图，完整保留参考图中的五官、发型、神态与气质；画面右侧为同一角色的三视图——正面、侧面、背面全身视图并排，完整展示服装结构与体态。左右分区构图清晰，角色形象与参考图完全一致，背景统一为纯色浅灰，光线一致。超高细节，电影级角色设计图格式，画面无任何文字。';
    const newId = `node-${nanoid(8)}`;
    addNode({
      id: newId,
      type: 'image',
      position: { x: src.position.x + (src.width ?? 200) + 60, y: src.position.y + 40 },
      style: defaultNodeStyle('image'),
      data: {
        description: prompt,
        generationMode: 'image-to-image',
        referenceImages: [{ url: imageUrl, name: '角色参考' }],
      },
    });
    onConnect({ source: nodeId, target: newId, sourceHandle: null, targetHandle: null });
    setSelectedNodeId(newId);
    void generateForNode({
      nodeId: newId,
      engineId: 'gpt-image-2',
      prompt,
      referenceUrls: [imageUrl],
      params: { aspectRatio: '16:9' },
    });
  }, [nodeId, imageUrl]);

  // ── 分组下拉项（主入口；右键菜单保留同款功能作为熟手快捷冗余）──────────
  const deriveItems: DropdownItem[] = [
    { id: 'story4', icon: Clock, label: '剧情推演四宫格', hint: '前5s/前3s/后3s/后5s 时间线', onClick: () => void deriveStoryGrid4(nodeId) },
    { id: 'branch4', icon: GitBranch, label: '剧情分支四宫格', hint: '4 种剧情走向，发散分支树', onClick: () => void deriveBranchGrid4(nodeId) },
    { id: 'cam9', icon: Clapperboard, label: '多机位九宫格', hint: '9 个机位景别调度', onClick: () => void multiCam9(nodeId) },
    { id: 'sb25', icon: Layers, label: '25 宫格连贯分镜', hint: '自动拆解完整剧情段落', onClick: () => void storyboard25(nodeId) },
    { id: 'd-b3', icon: Clock, label: '推演前 3 秒', hint: '单图回溯剧情', onClick: () => void deriveSingle(nodeId, 'before', 3) },
    { id: 'd-a5', icon: Clock, label: '推演后 5 秒', hint: '单图推进剧情', onClick: () => void deriveSingle(nodeId, 'after', 5) },
  ];

  const aiToolItems: DropdownItem[] = [
    ...IMAGE_TOOLS.map((t) => {
      // 局部重绘/擦除走可视化遮罩编辑器（红笔涂抹/框选定位），
      // 比纯文字描述定位精准
      if (t.id === 'inpaint' || t.id === 'erase') {
        return {
          id: t.id,
          icon: Wand2,
          label: t.label,
          hint: '弹出编辑器，红笔涂抹/框选定位区域',
          onClick: () => setMaskMode(t.id as MaskToolMode),
        };
      }
      return {
        id: t.id,
        icon: Wand2,
        label: t.label,
        hint: t.autoRun ? '自动执行，衍生新节点' : '衍生新节点后补完描述再生成',
        onClick: () => void applyImageTool(nodeId, t),
      };
    }),
    { id: 'variant', icon: Shuffle, label: '生成变体', hint: '复用描述+当前图分支生成', onClick: handleVariant },
    { id: 'turnaround', icon: ScanFace, label: '一键三视图', hint: '左正脸大图 + 右正/侧/背三视图', onClick: handleTurnaround },
    { id: 'i2p', icon: Lightbulb, label: '反推提示词', hint: '分析图片输出生成提示词', onClick: handleImageToPrompt },
  ];

  const handleSendToWorkshop = useCallback(async () => {
    const ws = useWorkshopStore.getState();
    if (!ws.data) {
      const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
      const nodeData = node?.data as Record<string, unknown> | undefined;
      const workshopRef = nodeData?.workshopRef as { projectId?: string } | undefined;
      const ps = useProjectStore.getState();
      const activeCanvas = ps.projects.find((p) => p.id === ps.activeProjectId);
      const targetProjectId =
        useUnifiedProjectStore.getState().activeId ??
        activeCanvas?.aigcProjectId ??
        workshopRef?.projectId ??
        null;

      if (!targetProjectId) {
        await tauriMessage('当前画布没有关联到工坊项目，无法传回工坊。请先从项目里进入画布，或在工坊里打开对应画布。', { title: '传回工坊' });
        return;
      }

      await useUnifiedProjectStore.getState().recoverUnified(targetProjectId);
      if (!useWorkshopStore.getState().data) {
        await tauriMessage('已找到项目关联，但工坊数据没有恢复成功。请回到项目列表重新打开该项目后再试。', { title: '传回工坊' });
        return;
      }
    }
    setShowWorkshopPicker(true);
  }, [nodeId]);

  const moreItems: DropdownItem[] = [
    { id: 'crop', icon: Crop, label: '裁剪图片', hint: '框选区域裁剪生成新节点', onClick: () => setShowCrop(true) },
    { id: 'replace', icon: Upload, label: '替换图片', hint: '上传本地图替换当前图', onClick: () => void handleUploadReplace() },
    { id: '3d', icon: Camera, label: '3D 相机视角', hint: '三维空间调整视角重生成', onClick: () => setShow3DCamera(true) },
    { id: 'split', icon: Grid3X3, label: '手动分镜切分', hint: '宫格图点选切分（2x2/3x3/5x5）', onClick: () => setShowStoryboard(true) },
    {
      id: 'director-previs', icon: Clapperboard, label: '白模导演预演', hint: '识别人物站位并建立可调整的白模镜头',
      onClick: () => {
        const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
        const data = node?.data as Record<string, unknown> | undefined;
        const localPath = data?.localPath as string | undefined;
        window.dispatchEvent(new CustomEvent('kunpeng-open-director', { detail: { origin: {
          kind: 'canvas-image',
          title: ((data?.description as string) || '画布图片预演').slice(0, 48),
          nodeId,
          prompt: (data?.description as string) || undefined,
          referenceImagePaths: localPath ? [localPath] : [],
        } } }));
      },
    },
  ];

  return (
    <>
      {/* portal 到 body：压住底部配置卡 + 屏幕坐标系天然恒定尺寸 */}
      <NodeToolbarPortal nodeId={nodeId}>
        <motion.div
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.15, ease: 'easeOut' }}
          className="flex items-center gap-1 rounded-2xl px-2 py-1.5"
          style={{
            background: 'rgba(38,38,38,0.92)',
            backdropFilter: 'blur(12px) saturate(1.5)',
            boxShadow: '0 2px 12px rgba(0,0,0,0.1), 0 0 0 1px rgba(255,255,255,0.08)',
          }}
        >
          <ToolBtn onClick={handleFullscreen} title="全屏查看（双击节点同效）" label="全屏"><Maximize2 size={18} strokeWidth={2} /></ToolBtn>
          <ToolBtn onClick={handleDownload} title="另存为本地文件" label="下载"><Download size={18} strokeWidth={2} /></ToolBtn>
          <ToolBtn onClick={() => void handleOpenFolder()} title="在 Finder 中定位文件" label="打开"><FolderOpen size={18} strokeWidth={2} /></ToolBtn>
          <ToolBtn onClick={handleDuplicate} title="创建当前节点的副本（⌘D）" label="副本"><Copy size={18} strokeWidth={2} /></ToolBtn>
          <ToolBtn onClick={() => void handleSendToWorkshop()} title="作为角色、场景、道具或色卡候选图传回工坊" label="传回工坊"><ArrowLeftToLine size={18} strokeWidth={2} /></ToolBtn>
          <ToolBtn onClick={() => setShowStoryboardWriteback(true)} title="回传到指定工坊镜头的故事板分镜" label="回传分镜"><RotateCcw size={18} strokeWidth={2} /></ToolBtn>
          <ToolBtn onClick={() => openCanvasNodeInAgent(nodeId)} title="把当前图片节点交给 Agent 操作" label="Agent"><Bot size={18} strokeWidth={2} /></ToolBtn>
          <ToolBtn onClick={() => void handleGeneratePalette()} title="基于当前图片生成色卡" label="色卡"><Palette size={18} strokeWidth={2} /></ToolBtn>
          <Sep />
          <ToolbarDropdown icon={Clapperboard} label="推演" items={deriveItems} />
          <ToolbarDropdown icon={Wand2} label="AI 工具" items={aiToolItems} />
          <ToolbarDropdown icon={MoreHorizontal} label="更多" items={moreItems} />
          <Sep />
          <ToolBtn onClick={handleDelete} title="删除节点" label="删除" danger><Trash2 size={18} strokeWidth={2} /></ToolBtn>
        </motion.div>
      </NodeToolbarPortal>

      {showFullscreen && <ImageFullscreenViewer imageUrl={imageUrl} onClose={() => setShowFullscreen(false)} />}
      {show3DCamera && (
        <Suspense fallback={null}>
          <Image3DCameraEditor nodeId={nodeId} imageUrl={imageUrl} onClose={() => setShow3DCamera(false)} />
        </Suspense>
      )}
      {showStoryboard && <StoryboardSplitter nodeId={nodeId} imageUrl={imageUrl} onClose={() => setShowStoryboard(false)} />}
      {showCrop && <ImageCropEditor sourceNodeId={nodeId} imageUrl={imageUrl} onClose={() => setShowCrop(false)} />}
      {maskMode && <MaskPaintEditor sourceNodeId={nodeId} imageUrl={imageUrl} mode={maskMode} onClose={() => setMaskMode(null)} />}
      {showWorkshopPicker && <WorkshopAssetPicker nodeId={nodeId} imageUrl={imageUrl} onClose={() => setShowWorkshopPicker(false)} />}
      {showStoryboardWriteback && (
        <StoryboardCanvasActions
          mode="writeback"
          nodeIds={[nodeId]}
          onClose={() => setShowStoryboardWriteback(false)}
        />
      )}
    </>
  );
}

function ToolBtn({ onClick, title, label, danger, children }: {
  onClick: (e: React.MouseEvent) => void; title: string; label?: string; danger?: boolean; children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`flex flex-col items-center justify-center gap-1.5 px-3.5 py-2.5 min-w-[58px] rounded-xl transition-all duration-100 ${
        danger
          ? 'text-[var(--canvas-text-2)] hover:text-red-500 hover:bg-[rgba(255,97,99,0.15)]'
          : 'text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)]'
      }`}
    >
      {children}
      {label && <span className="text-[12px] leading-none whitespace-nowrap">{label}</span>}
    </button>
  );
}

function Sep() {
  return <div className="w-px h-5 mx-px bg-[rgba(255,255,255,0.1)]" />;
}

function WorkshopAssetPicker({ nodeId, imageUrl, onClose }: { nodeId: string; imageUrl: string; onClose: () => void }) {
  const data = useWorkshopStore((s) => s.data);
  const addAssetCandidate = useWorkshopStore((s) => s.addAssetCandidate);

  if (!data) return null;

  const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
  const nodeData = node?.data as Record<string, unknown> | undefined;
  const localPath = nodeData?.localPath as string | undefined;

  const handlePick = (kind: WorkshopAssetKind, id: string) => {
    const imgPath = localPath ?? imageUrl;
    addAssetCandidate(kind, id, { path: imgPath, source: 'canvas', createdAt: Date.now() }, true);
    onClose();
  };

  const ICONS = { character: User, scene: Mountain, prop: Package, colorPalette: Palette } as const;
  const LABELS = { character: '角色', scene: '场景', prop: '道具', colorPalette: '色卡' } as const;

  const items: { kind: WorkshopAssetKind; id: string; name: string }[] = [
    ...data.characters.map((c) => ({ kind: 'character' as const, id: c.id, name: c.name })),
    ...data.scenes.map((s) => ({ kind: 'scene' as const, id: s.id, name: s.name })),
    ...(data.props ?? []).map((p) => ({ kind: 'prop' as const, id: p.id, name: p.name })),
    ...(data.colorPalettes ?? []).map((p) => ({ kind: 'colorPalette' as const, id: p.id, name: p.name })),
  ];

  if (items.length === 0) { onClose(); return null; }

  return createPortal(
    <div
      className="fixed left-1/2 top-[18vh] z-[9999] w-[min(360px,calc(100vw-32px))] -translate-x-1/2 overflow-hidden rounded-xl border border-[rgba(255,255,255,0.08)] bg-[#262626] shadow-2xl"
      style={{ boxShadow: '0 10px 30px rgba(0,0,0,0.32)' }}
    >
        <div className="flex items-center justify-between border-b border-[rgba(255,255,255,0.10)] px-4 py-3">
          <div>
            <p className="text-[16px] font-semibold tracking-tight text-white">传回工坊</p>
            <p className="mt-0.5 text-[12px] text-[rgba(255,255,255,0.68)]">选择接收这张图的资产</p>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 text-[rgba(255,255,255,0.58)] transition-colors hover:bg-[rgba(255,255,255,0.10)] hover:text-white">
            <X size={18} />
          </button>
        </div>
        <div
          className="max-h-[360px] overflow-y-auto p-2"
          style={{ scrollbarWidth: 'auto', scrollbarColor: 'rgba(255,255,255,0.34) transparent' }}
        >
          {items.map((item) => {
            const Icon = ICONS[item.kind];
            return (
              <button
                key={`${item.kind}-${item.id}`}
                onClick={() => handlePick(item.kind, item.id)}
                className="group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-[rgba(255,255,255,0.10)] active:bg-[rgba(255,255,255,0.14)]"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[rgba(255,255,255,0.08)] text-[rgba(255,255,255,0.74)] transition-colors group-hover:bg-[rgba(31,162,220,0.18)] group-hover:text-white">
                  <Icon size={18} />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[14px] font-medium text-white">{item.name}</p>
                  <p className="mt-0.5 text-[11px] text-[rgba(255,255,255,0.58)]">{LABELS[item.kind]}</p>
                </div>
              </button>
            );
          })}
        </div>
    </div>,
    document.body,
  );
}
