/**
 * CanvasChatBubble — 画布鲲鹏抽屉（AgentDrawer 壳的画布 wrapper）。
 * 负责：画布上下文 prefix、@ 引用 URL 提取、附件选择、
 * NodeInfoBar 派发的 pendingAgentAction 自动发送。
 */
import { useState, useEffect, useMemo } from 'react';
import { useChatStore } from '@/stores';
import { useCanvasStore } from '@/stores/canvasStore';
import { open as tauriOpen } from '@tauri-apps/api/dialog';
import { useCanvasMention } from '@/hooks/useCanvasMention';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { ensureProjectSession } from '@/lib/projectSessions';
import { useHelloGreeting } from '@/lib/greeting';
import AgentDrawer from '../chat/AgentDrawer';
import ProjectConversationContext from '../chat/ProjectConversationContext';
import { SYSTEM_REPAIR_PROMPT_EVENT, type SystemRepairPromptDetail } from '@/lib/agent/systemRepair';
import { Bot, FileText, Film, Globe2, Image as ImageIcon, Layers, Music, X } from 'lucide-react';
import {
  canvasNodeDisplayLabel,
  canvasNodePreviewUrl,
  canvasNodeStatusLabel,
  canvasNodeTypeLabel,
} from '@/lib/canvas/nodeAgent';
import { buildCanvasContext, buildCanvasActionPrompt, appendCanvasMentionUrls } from '@/lib/canvas/canvasAgentPrompt';
import { resolveCanvasAgentMediaUrl } from '@/lib/canvas/canvasAgentMedia';
import {
  createProjectConversationReference,
  mergeProjectConversationReferences,
  PROJECT_AGENT_CONTEXT_EVENT,
  type ProjectAgentContextEventDetail,
} from '@/lib/projectObjects/conversationRefs';

const STRIP_RE = /^\[用户正在画布视图中操作[\s\S]*?\]\n\n/;

interface CanvasChatBubbleProps {
  onSendMessage: (content: string, filePaths?: string[]) => void;
  onAbort: () => void;
}

type CanvasNode = ReturnType<typeof useCanvasStore.getState>['nodes'][number];
type CanvasEdge = ReturnType<typeof useCanvasStore.getState>['edges'][number];

export default function CanvasChatBubble({ onSendMessage, onAbort }: CanvasChatBubbleProps) {
  const hello = useHelloGreeting();
  const [open, setOpen] = useState(false);
  const [focusedNodeIds, setFocusedNodeIds] = useState<string[]>([]);
  const mention = useCanvasMention();
  const msgCount = useChatStore((s) => s.messages.reduce(
    (count, message) => count + (message.role === 'assistant' ? 1 : 0),
    0,
  ));
  const isStreaming = useChatStore((s) => s.streamingPhase) !== 'idle';
  const [queuedRepair, setQueuedRepair] = useState<string | null>(null);
  const [focusedNodes, setFocusedNodes] = useState<CanvasNode[]>([]);
  const [focusedEdges, setFocusedEdges] = useState<CanvasEdge[]>([]);
  const focusedNode = focusedNodes[0] ?? null;
  const projectId = useWorkshopStore((s) => s.data?.projectId);
  const persistedSelectedObjectIds = useWorkshopStore((s) => s.data?.projectViewState?.selectedObjectIds ?? []);
  const conversationReferences = useWorkshopStore((s) => s.data?.projectViewState?.conversationReferences ?? []);

  useEffect(() => {
    if (!projectId || focusedNodeIds.length > 0 || persistedSelectedObjectIds.length === 0) return;
    const existing = new Set(useCanvasStore.getState().nodes.map((node) => node.id));
    const restored = persistedSelectedObjectIds.filter((id) => existing.has(id));
    if (restored.length > 0) setFocusedNodeIds(restored);
    // Restore only once per project; later focus changes are explicit user actions.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId]);

  const focusCanvasNodes = (nodeIds: string[]) => {
    const unique = nodeIds.filter((id, index, all) => id && all.indexOf(id) === index);
    const canvas = useCanvasStore.getState();
    const nodes = unique
      .map((id) => canvas.nodes.find((node) => node.id === id))
      .filter((node): node is CanvasNode => Boolean(node));
    setFocusedNodeIds(nodes.map((node) => node.id));
    const workshop = useWorkshopStore.getState();
    const refs = nodes.map((node) => createProjectConversationReference({
      objectId: `canvas-node:${node.id}`,
      kind: 'canvas-node',
      sourceView: 'canvas',
      sourceId: node.id,
      label: canvasNodeDisplayLabel(node),
      ownerLabel: workshop.project?.name,
      operationScope: 'edit',
      thumbnailPath: canvasNodePreviewUrl(node),
    }));
    workshop.updateProjectViewState({
      selectedObjectIds: nodes.map((node) => node.id),
      conversationReferences: mergeProjectConversationReferences(
        workshop.data?.projectViewState?.conversationReferences,
        refs,
      ),
    });
  };

  const clearFocusedNodes = () => {
    setFocusedNodeIds([]);
    useWorkshopStore.getState().updateProjectViewState({ selectedObjectIds: [] });
  };

  useEffect(() => {
    if (!open || focusedNodeIds.length === 0) {
      setFocusedNodes([]);
      setFocusedEdges([]);
      return;
    }
    let timer: number | null = null;
    let lastNodes: CanvasNode[] = [];
    let lastEdges: CanvasEdge[] = [];
    const sync = () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        const state = useCanvasStore.getState();
        const ids = new Set(focusedNodeIds);
        const nodes = focusedNodeIds
          .map((nodeId) => state.nodes.find((node) => node.id === nodeId))
          .filter((node): node is CanvasNode => Boolean(node));
        const edges = state.edges.filter((edge) => ids.has(edge.source) || ids.has(edge.target));
        const nodesChanged = nodes.length !== lastNodes.length
          || nodes.some((node, index) => node !== lastNodes[index]);
        const edgesChanged = edges.length !== lastEdges.length
          || edges.some((edge, index) => edge !== lastEdges[index]);
        if (nodesChanged) {
          lastNodes = nodes;
          setFocusedNodes(nodes);
        }
        if (edgesChanged) {
          lastEdges = edges;
          setFocusedEdges(edges);
        }
        if (nodes.length !== focusedNodeIds.length) {
          setFocusedNodeIds(nodes.map((node) => node.id));
        }
      }, 120);
    };
    sync();
    const unsubscribe = useCanvasStore.subscribe(sync);
    return () => {
      unsubscribe();
      if (timer !== null) window.clearTimeout(timer);
    };
  }, [open, focusedNodeIds]);

  const sendCanvasMessage = async (
    text: string,
    filePaths?: string[],
    targetNodes: string | string[] | undefined = focusedNodeIds,
  ) => {
    // 项目对话隔离
    const unifiedId = useUnifiedProjectStore.getState().activeId;
    const proj = useWorkshopStore.getState().project;
    if (unifiedId && proj) await ensureProjectSession(unifiedId, proj.name);
    const snapshot = useCanvasStore.getState().getSnapshot();
    const selectedIds = Array.isArray(targetNodes) ? targetNodes : targetNodes ? [targetNodes] : [];
    const first = selectedIds.map((id) => snapshot.nodes.find((node) => node.id === id)).find(Boolean);
    if (first) useCanvasStore.getState().setSelectedNodeId(first.id);
    const prefix = buildCanvasContext(snapshot, selectedIds, useWorkshopStore.getState().data?.projectViewState?.conversationReferences);
    onSendMessage(prefix + text, filePaths);
  };

  // 抽屉发送：@ 引用提取为参考 URL 行
  const handleSend = (raw: string, files?: string[]) => {
    const text = appendCanvasMentionUrls(raw, mention.extractMentionedUrls(raw));
    void sendCanvasMessage(text, files);
  };

  useEffect(() => {
    const handler = (event: Event) => {
      const prompt = (event as CustomEvent<SystemRepairPromptDetail>).detail?.prompt;
      if (!prompt) return;
      setOpen(true);
      if (useChatStore.getState().streamingPhase === 'idle') setTimeout(() => void sendCanvasMessage(prompt), 250);
      else setQueuedRepair(prompt);
    };
    window.addEventListener(SYSTEM_REPAIR_PROMPT_EVENT, handler);
    return () => window.removeEventListener(SYSTEM_REPAIR_PROMPT_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!queuedRepair || isStreaming) return;
    const prompt = queuedRepair;
    setQueuedRepair(null);
    setTimeout(() => void sendCanvasMessage(prompt), 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queuedRepair, isStreaming]);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<ProjectAgentContextEventDetail>).detail;
      if (!detail?.references?.some((reference) => reference.sourceView === 'canvas')) return;
      const workshop = useWorkshopStore.getState();
      workshop.updateProjectViewState({
        conversationReferences: mergeProjectConversationReferences(
          workshop.data?.projectViewState?.conversationReferences,
          detail.references,
        ),
      });
      if (detail.open !== false) setOpen(true);
    };
    window.addEventListener(PROJECT_AGENT_CONTEXT_EVENT, handler);
    return () => window.removeEventListener(PROJECT_AGENT_CONTEXT_EVENT, handler);
  }, []);

  const handlePickFiles = async (): Promise<string[] | null> => {
    try {
      const selected = await tauriOpen({
        multiple: true,
        filters: [{ name: 'All', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'mp4', 'mov', 'webm', 'txt', 'md', 'pdf', 'json', 'csv'] }],
      });
      if (!selected) return null;
      return Array.isArray(selected) ? selected : [selected];
    } catch (err) {
      console.error('选择文件失败:', err);
      return null;
    }
  };

  // NodeInfoBar 派发的 Agent 动作：自动打开抽屉并发送
  const pendingAction = useCanvasStore((s) => s.pendingAgentAction);
  const clearPendingAction = useCanvasStore((s) => s.clearPendingAction);
  useEffect(() => {
    if (!pendingAction) return;
    const { action, nodeId, nodeIds } = pendingAction;
    if (action === 'agent-focus-node' || action === 'agent-focus-nodes') {
      clearPendingAction();
      focusCanvasNodes(nodeIds?.length ? nodeIds : [nodeId]);
      setOpen(true);
      return;
    }
    if (isStreaming) return;
    clearPendingAction();
    focusCanvasNodes([nodeId]);
    setOpen(true);

    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    void buildCanvasActionPrompt(node, pendingAction, resolveCanvasAgentMediaUrl).then((prompt) => {
      if (prompt) setTimeout(() => void sendCanvasMessage(prompt, undefined, nodeId), 300);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingAction, isStreaming, clearPendingAction]);

  const { focusedEdgeCount, focusedInternalEdgeCount } = useMemo(() => {
    const focusedSet = new Set(focusedNodeIds);
    let related = 0;
    let internal = 0;
    for (const edge of focusedEdges) {
      const sourceFocused = focusedSet.has(edge.source);
      const targetFocused = focusedSet.has(edge.target);
      if (sourceFocused || targetFocused) related += 1;
      if (sourceFocused && targetFocused) internal += 1;
    }
    return { focusedEdgeCount: related, focusedInternalEdgeCount: internal };
  }, [focusedEdges, focusedNodeIds]);
  const focusedNodeMeta = focusedNode ? {
    label: canvasNodeDisplayLabel(focusedNode),
    typeLabel: canvasNodeTypeLabel(focusedNode.type),
    previewUrl: canvasNodePreviewUrl(focusedNode),
    statusLabel: canvasNodeStatusLabel(focusedNode),
    edgeCount: focusedEdgeCount,
  } : null;
  const focusedTypeSummary = useMemo(() => [...new Set(focusedNodes.map((node) => canvasNodeTypeLabel(node.type)))]
    .slice(0, 3)
    .join('、'), [focusedNodes]);
  const focusedPreviewNodes = useMemo(() => focusedNodes
    .map((node) => ({ node, previewUrl: canvasNodePreviewUrl(node) }))
    .slice(0, 4), [focusedNodes]);
  const FocusIcon = focusedNode?.type === 'text' ? FileText
    : focusedNode?.type === 'image' ? ImageIcon
    : focusedNode?.type === 'video' ? Film
    : focusedNode?.type === 'audio' ? Music
    : focusedNode?.type === 'panorama' ? Globe2
    : focusedNode?.type === 'group' ? Layers
    : Bot;

  return (
    <AgentDrawer
      open={open}
      onOpenChange={setOpen}
      stripPrefixRe={STRIP_RE}
      greeting={{ hello: hello, title: '今天想一起创作点什么？' }}
      suggestions={[
        '搭一条 文案→分镜图→视频 流水线',
        '为选中的图片生成 4 个风格变体',
        '把分镜图按剧情批量生成视频',
      ]}
      onSend={handleSend}
      onAbort={onAbort}
      badgeCount={msgCount}
      onPickFiles={handlePickFiles}
      mention={mention}
      modelScope="canvas"
      placeholder={focusedNodes.length > 1
        ? '告诉鲲鹏要怎样处理这些节点'
        : focusedNode
          ? '告诉鲲鹏要怎样修改这个节点'
          : '描述创意或需求，@ 引用画布素材'}
      contextBannerKey={`${focusedNodeIds.join('|')}:${conversationReferences.map((reference) => reference.id).join('|')}`}
      contextBanner={(focusedNode && focusedNodeMeta) || conversationReferences.length > 0 ? (
        <div className="space-y-2">
        {focusedNode && focusedNodeMeta ? <div
          data-agent-context-target="canvas-node-agent"
          className="flex min-w-0 items-center gap-2.5 rounded-xl border border-white/[0.09] bg-white/[0.045] px-2.5 py-2 shadow-[0_8px_24px_rgba(0,0,0,0.12)]"
        >
          <span className="flex h-11 w-14 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/[0.08] text-[var(--canvas-text-1)]">
            {focusedNodes.length > 1 ? (
              <span className="grid h-full w-full grid-cols-2 gap-px overflow-hidden">
                {focusedPreviewNodes.map(({ node, previewUrl }) => {
                  const ItemIcon = node.type === 'text' ? FileText
                    : node.type === 'image' ? ImageIcon
                    : node.type === 'video' ? Film
                    : node.type === 'audio' ? Music
                    : node.type === 'panorama' ? Globe2
                    : Layers;
                  return previewUrl ? (
                    <img key={node.id} src={previewUrl} alt="" className="h-full min-h-0 w-full object-cover" />
                  ) : (
                    <span key={node.id} className="flex min-h-0 items-center justify-center bg-white/[0.05]">
                      <ItemIcon size={10} />
                    </span>
                  );
                })}
              </span>
            ) : focusedNodeMeta.previewUrl ? (
              <img src={focusedNodeMeta.previewUrl} alt="" className="h-full w-full object-cover" />
            ) : (
              <FocusIcon size={17} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="flex items-center gap-1.5 text-[9px] text-[var(--canvas-text-3)]">
              <span className={`h-1.5 w-1.5 rounded-full ${focusedNodeMeta.statusLabel === '生成中' ? 'animate-pulse bg-amber-400' : 'bg-emerald-400/80'}`} />
              {focusedNodes.length > 1
                ? `当前工作集 · ${focusedNodes.length} 个节点`
                : `当前节点 · ${focusedNodeMeta.typeLabel} · ${focusedNodeMeta.statusLabel}`}
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-medium text-[var(--canvas-text-1)]">
              {focusedNodes.length > 1 ? focusedTypeSummary : focusedNodeMeta.label}
            </span>
            <span className="mt-0.5 flex items-center gap-1.5 text-[9px] text-[var(--canvas-text-3)]">
              <Bot size={9} />
              Agent 已接管
              <span className="text-white/20">·</span>
              {focusedNodes.length > 1
                ? `${focusedInternalEdgeCount} 条组内连线 · ${focusedEdgeCount} 条相关连线`
                : focusedNodeMeta.edgeCount > 0
                  ? `关联 ${focusedNodeMeta.edgeCount} 条连线`
                  : '暂无连线'}
              {focusedNodes.length === 1 && (
                <>
                  <span className="text-white/20">·</span>
                  <span className="truncate">ID {focusedNode.id.slice(0, 8)}</span>
                </>
              )}
            </span>
          </span>
          <button
            onClick={clearFocusedNodes}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--canvas-text-3)] transition-colors hover:bg-white/[0.08] hover:text-[var(--canvas-text-1)]"
            title={focusedNodes.length > 1 ? '取消节点工作集' : '取消指定节点'}
          >
            <X size={13} />
          </button>
        </div> : null}
        <ProjectConversationContext
          currentLabel={focusedNodes.length > 1 ? `${focusedNodes.length} 个画布节点` : focusedNodeMeta?.label}
          currentMeta={conversationReferences.length > 0 ? `${conversationReferences.length} 个对象已添加到对话` : undefined}
        />
        </div>
      ) : undefined}
    />
  );
}
