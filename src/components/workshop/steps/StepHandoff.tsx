/**
 * StepHandoff — ⑥交付：把成片导入画布（建节点网格）或剪辑时间轴。
 */
import { useState } from 'react';
import { Clapperboard, LayoutDashboard, Loader2, Scissors } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { confirm as tauriConfirm } from '@tauri-apps/api/dialog';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useCanvasStore } from '@/stores/canvasStore';
import { useEditorStore } from '@/stores/editorStore';
import { useProjectStore } from '@/stores/projectStore';
import { useChatStore } from '@/stores';
import { defaultNodeStyle } from '@/lib/canvas/layout';
import { readProject, writeProject, type AigcProject } from '@/lib/aigc/projectStore';

const fmtImportDate = (ts: number) => {
  const d = new Date(ts);
  return `${d.getMonth() + 1}月${d.getDate()}日`;
};

type CanvasImportBatch = { nodeIds: string[]; at: number; count: number };

// 旧形态 canvas 记录是单批 { nodeIds, at, count }（无 main 字段），读取时归一为 { main, copies: [] }
const normalizeCanvasImport = (
  raw: NonNullable<AigcProject['handoffImports']>['canvas'] | undefined,
): { main: CanvasImportBatch; copies: CanvasImportBatch[] } | undefined => {
  if (!raw) return undefined;
  const legacy = raw as unknown as Partial<CanvasImportBatch>;
  const main =
    raw.main ??
    (Array.isArray(legacy.nodeIds) && typeof legacy.at === 'number' && typeof legacy.count === 'number'
      ? { nodeIds: legacy.nodeIds, at: legacy.at, count: legacy.count }
      : undefined);
  if (!main) return undefined;
  return { main, copies: Array.isArray(raw.copies) ? raw.copies : [] };
};

export default function StepHandoff() {
  // 本页只用 shots（成片/素材统计与导入），不整订 data，无关写入不重渲染
  const shots = useWorkshopStore((s) => s.data?.shots);
  const project = useWorkshopStore((s) => s.project);
  const markStepStatus = useWorkshopStore((s) => s.markStepStatus);
  const logChange = useWorkshopStore((s) => s.logChange);
  const setCurrentStep = useWorkshopStore((s) => s.setCurrentStep);
  const setActiveView = useChatStore((s) => s.setActiveView);
  const [busy, setBusy] = useState(false);
  const [canvasBusy, setCanvasBusy] = useState(false);
  const [editorError, setEditorError] = useState<string | null>(null);
  const [canvasError, setCanvasError] = useState<string | null>(null);

  if (!shots) return null;
  const shotsWithMedia = shots.filter((s) => s.imagePath || s.videoPath);
  const shotsWithVideo = shots.filter((s) => s.videoPath);
  const canvasImport = normalizeCanvasImport(project?.handoffImports?.canvas);
  // 状态行/确认文案展示全部批次的合计数量与最近导入时间
  const canvasImportCount = canvasImport
    ? canvasImport.main.count + canvasImport.copies.reduce((sum, c) => sum + c.count, 0)
    : 0;
  const canvasImportAt = canvasImport
    ? Math.max(canvasImport.main.at, ...canvasImport.copies.map((c) => c.at))
    : 0;
  const editorImport = project?.handoffImports?.editor;

  const persistHandoffImports = async (handoffImports: NonNullable<AigcProject['handoffImports']>) => {
    if (!project) return;
    const next = { ...project, handoffImports, updatedAt: Date.now() };
    await writeProject(next);
    useWorkshopStore.setState({ project: next });
  };

  const handleToCanvas = async () => {
    if (canvasBusy || shotsWithMedia.length === 0) return;
    setCanvasError(null);
    setCanvasBusy(true);
    try {
      // 已导入过时先选择：「更新已有」清掉全部旧批次再铺新批；「导入副本」保留旧批次并追加
      let replaceOld = false;
      if (canvasImport) {
        replaceOld = await tauriConfirm(
          `上次已于 ${fmtImportDate(canvasImportAt)} 导入 ${canvasImportCount} 个节点。\n\n「确定」更新已有导入：先删除之前导入的全部节点（含副本），再铺入新一批。`,
          { title: '导入画布', type: 'warning' },
        ).catch(() => false);
        if (!replaceOld) {
          const asCopy = await tauriConfirm(
            '改为导入副本：保留画布上已有的全部导入批次，追加一批新节点？',
            { title: '导入画布' },
          ).catch(() => false);
          if (!asCopy) return;
        }
      }
      // 1) 先算好整批新节点（id 预计算：稳定 id / 批次后缀 id），此阶段不动画布。
      // 「导入副本」与旧批共存，id 必须加批次后缀避免撞 id（canvasStore.addNode 不去重）；
      // 「更新已有」/首次导入保持原稳定 id，这样下次更新时按 nodeIds 删旧批才对得上。
      const batchSuffix = canvasImport && !replaceOld ? `-${Date.now()}` : '';
      const COLS = 4;
      const newNodes = shotsWithMedia.map((shot, i) => {
        const isVideo = Boolean(shot.videoPath);
        const path = (shot.videoPath ?? shot.imagePath)!;
        const url = convertFileSrc(path);
        return {
          id: `node-ws-${project?.id ?? 'default'}-${shot.shotNo}${batchSuffix}`,
          type: isVideo ? 'video' : 'image',
          position: { x: 80 + (i % COLS) * 320, y: 80 + Math.floor(i / COLS) * 260 },
          style: defaultNodeStyle(isVideo ? 'video' : 'image'),
          data: {
            ...(isVideo
              ? { generatedVideoUrl: url, localPath: path, mediaRole: 'output' }
              : { generatedImageUrl: url, localPath: path }),
            description: `${shot.shotNo} ${shot.description}`.slice(0, 60),
          },
        };
      });
      // 2) 记录先行：先把含新批 nodeIds 的导入记录写入项目文件，保存成功后才动画布。
      // 首次导入/更新已有 → 写入 main 并清空 copies；导入副本 → 追加 copies、不动 main
      const batch: CanvasImportBatch = {
        nodeIds: newNodes.map((n) => n.id),
        at: Date.now(),
        count: newNodes.length,
      };
      const nextCanvas = {
        main: !canvasImport || replaceOld ? batch : canvasImport.main,
        copies: !canvasImport || replaceOld ? [] : [...canvasImport.copies, batch],
      };
      if (!project) {
        setCanvasError('项目未加载，无法保存导入记录，画布未做任何改动');
        return;
      }
      await persistHandoffImports({ ...project.handoffImports, canvas: nextCanvas });
      // writeProject 内部吞错只 console.warn，读回校验确认记录真的落盘；
      // 失败则恢复内存中的旧记录并退出，画布完全不动
      const persisted = normalizeCanvasImport((await readProject(project.id))?.handoffImports?.canvas);
      if (!persisted || JSON.stringify(persisted) !== JSON.stringify(nextCanvas)) {
        useWorkshopStore.setState({ project });
        setCanvasError('导入记录保存失败，画布未做任何改动，请重试');
        return;
      }
      // 3) 记录已落盘，再一次性删旧铺新并立刻持久化画布。失败时同时回滚
      // 画布快照和导入记录，避免出现“记录新、画布旧”的半完成状态。
      const canvasStore = useCanvasStore.getState();
      const beforeCanvas = { nodes: canvasStore.nodes, edges: canvasStore.edges };
      try {
        const { addNode, deleteNode } = canvasStore;
        // 删除范围 = 主批 + 全部副本批，删干净再铺新批，否则遗漏批次的节点会遗留成重复节点
        if (replaceOld && canvasImport) {
          [canvasImport.main, ...canvasImport.copies].forEach((b) =>
            b.nodeIds.forEach((id) => deleteNode(id)),
          );
        }
        newNodes.forEach((n) => addNode(n));
        await useProjectStore.getState().flushActiveCanvas();
      } catch (err) {
        canvasStore.setNodes(beforeCanvas.nodes);
        canvasStore.setEdges(beforeCanvas.edges);
        await useProjectStore.getState().flushActiveCanvas().catch(() => {});
        await persistHandoffImports(project.handoffImports ?? {});
        setCanvasError(
          `画布操作失败，已回滚到导入前：${err instanceof Error ? err.message : String(err)}`,
        );
        return;
      }
      markStepStatus('handoff', 'done');
      logChange('handoff', `导入画布 ${newNodes.length} 个节点`);
      setActiveView('canvas');
    } catch (err) {
      setCanvasError(`导入画布失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setCanvasBusy(false);
    }
  };

  const handleToEditor = async () => {
    if (busy) return;
    setEditorError(null);
    // 时间轴可能已被用户编辑过，不自动删除旧片段，只提示会追加重复片段
    if (editorImport) {
      const ok = await tauriConfirm(
        `上次已导入 ${editorImport.count} 段（${fmtImportDate(editorImport.at)}），再次导入将在时间轴追加重复片段，继续？`,
        { title: '导入剪辑', type: 'warning' },
      ).catch(() => false);
      if (!ok) return;
    }
    setBusy(true);
    try {
      const clipIds = await useEditorStore.getState().addClips(
        shotsWithVideo.map((s) => ({
          path: s.videoPath!,
          label: `${s.shotNo} ${s.description}`.slice(0, 24),
        })),
      );
      markStepStatus('handoff', 'done');
      logChange('handoff', `导入剪辑 ${shotsWithVideo.length} 段`);
      await persistHandoffImports({
        ...project?.handoffImports,
        editor: { clipIds, at: Date.now(), count: shotsWithVideo.length },
      });
      setActiveView('editor');
    } catch (err) {
      setEditorError(`导入剪辑失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-[720px] mx-auto px-8 py-8 pb-16">
      <h2 className="text-[16px] font-semibold text-[var(--canvas-text-1)]">⑥ 交付</h2>
      <p className="text-[12px] text-[var(--canvas-text-3)] mt-1 mb-8">
        成片片段 {shotsWithVideo.length} 段 · 分镜素材共 {shotsWithMedia.length} 个
      </p>

      <div className="grid grid-cols-2 gap-4">
        <div>
          <button
            onClick={() => void handleToCanvas()}
            disabled={shotsWithMedia.length === 0 || canvasBusy}
            className="w-full rounded-2xl border border-[var(--canvas-node-border)] p-6 text-left hover:border-[var(--canvas-node-border-selected)] transition-colors disabled:opacity-40"
            style={{ background: 'var(--canvas-node-bg)' }}
          >
            {canvasBusy ? (
              <Loader2 size={20} className="text-[var(--canvas-accent)] mb-3 animate-spin" />
            ) : (
              <LayoutDashboard size={20} className="text-[var(--canvas-accent)] mb-3" />
            )}
            <h3 className="text-[14px] font-medium text-[var(--canvas-text-1)]">
              {canvasImport ? '再次导入' : '导入画布'}
            </h3>
            <p className="text-[11px] text-[var(--canvas-text-3)] mt-1 leading-relaxed">
              按分镜顺序铺成节点网格，继续推演、衍生、风格迁移
            </p>
            <p className="text-[11px] text-[var(--canvas-text-2)] mt-3">
              {canvasImport
                ? `已于 ${fmtImportDate(canvasImportAt)} 导入（${canvasImportCount} 个）`
                : `${shotsWithMedia.length} 个素材 →`}
            </p>
          </button>
          {canvasError && (
            <p className="mt-1.5 text-[12px]" style={{ color: 'var(--canvas-danger)' }}>
              {canvasError}
            </p>
          )}
        </div>

        <div>
          <button
            onClick={() => void handleToEditor()}
            disabled={shotsWithVideo.length === 0 || busy}
            className="w-full rounded-2xl border border-[var(--canvas-node-border)] p-6 text-left hover:border-[var(--canvas-node-border-selected)] transition-colors disabled:opacity-40"
            style={{ background: 'var(--canvas-node-bg)' }}
          >
            <Scissors size={20} className="text-[var(--canvas-accent)] mb-3" />
            <h3 className="text-[14px] font-medium text-[var(--canvas-text-1)]">
              {editorImport ? '再次导入' : '导入剪辑'}
            </h3>
            <p className="text-[11px] text-[var(--canvas-text-3)] mt-1 leading-relaxed">
              按镜号顺序进时间轴，裁剪、转场、配乐、字幕、成片导出
            </p>
            <p className="text-[11px] text-[var(--canvas-text-2)] mt-3">
              {editorImport
                ? `已于 ${fmtImportDate(editorImport.at)} 导入（${editorImport.count} 个）`
                : `${shotsWithVideo.length} 段视频 →`}
            </p>
          </button>
          {editorError && (
            <p className="mt-1.5 text-[12px]" style={{ color: 'var(--canvas-danger)' }}>
              {editorError}
            </p>
          )}
        </div>
      </div>

      {shotsWithVideo.length === 0 && (
        <button
          onClick={() => setCurrentStep('generate')}
          className="mt-6 w-full flex items-center justify-center gap-1.5 rounded-xl border border-dashed border-[var(--canvas-node-border)] px-4 py-4 text-[12px] text-[var(--canvas-text-2)] hover:border-[var(--canvas-node-border-selected)] hover:text-[var(--canvas-text-1)] transition-colors"
        >
          <Clapperboard size={13} /> 还没有成片视频，点击前往第⑤步生成 →
        </button>
      )}
    </div>
  );
}
