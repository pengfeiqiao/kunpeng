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
import { SYSTEM_REPAIR_PROMPT_EVENT, type SystemRepairPromptDetail } from '@/lib/agent/systemRepair';
import { Bot, FileText, Film, Globe2, Image as ImageIcon, Layers, Music, X } from 'lucide-react';
import {
  canvasNodeDisplayLabel,
  canvasNodePreviewUrl,
  canvasNodeStatusLabel,
  canvasNodeTypeLabel,
} from '@/lib/canvas/nodeAgent';
import { normalizeMidjourneyVersion } from '@/lib/midjourney/prompt';

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
    const canvasCtx = snapshot.nodes.length > 0
      ? `\n当前画布有 ${snapshot.nodes.length} 个节点、${snapshot.edges.length} 条连线。`
      : '\n当前画布为空。';
    let focusCtx = '';
    const targetNodeIds = (Array.isArray(targetNodes) ? targetNodes : targetNodes ? [targetNodes] : [])
      .filter((nodeId, index, all) => all.indexOf(nodeId) === index);
    if (targetNodeIds.length > 0) {
      const nodes = targetNodeIds
        .map((nodeId) => snapshot.nodes.find((item) => item.id === nodeId))
        .filter((node): node is NonNullable<typeof node> => Boolean(node));
      if (nodes.length > 0) {
        useCanvasStore.getState().setSelectedNodeId(nodes[0].id);
        const targetSet = new Set(nodes.map((node) => node.id));
        const relatedEdges = snapshot.edges.filter((edge) => targetSet.has(edge.source) || targetSet.has(edge.target));
        const describe = (value: unknown, limit = 360) => {
          if (typeof value !== 'string') return value;
          return value.length > limit ? `${value.slice(0, limit)}...` : value;
        };
        const nodeDetails = nodes.map((node) => {
          const data = node.data ?? {};
          const actionableData = Object.fromEntries(
            Object.entries(data)
              .filter(([key, value]) =>
                value !== undefined
                && !['generationHistory', 'candidates'].includes(key)
                && !(typeof value === 'string' && value.startsWith('data:')))
              .slice(0, nodes.length > 8 ? 8 : 24)
              .map(([key, value]) => [
                key,
                Array.isArray(value)
                  ? value.slice(0, 8).map((item) => typeof item === 'object' ? '[关联素材]' : describe(item, 120))
                  : describe(value, nodes.length > 8 ? 160 : 360),
              ]),
          );
          return {
            id: node.id,
            type: node.type,
            position: node.position,
            size: { width: node.width, height: node.height },
            data: actionableData,
          };
        });
        const isGroupFocus = nodes.length > 1;
        focusCtx = `
当前用户已明确把${isGroupFocus ? `一组共 ${nodes.length} 个节点` : '节点'}交给你操作。目标节点 ID=${JSON.stringify(nodes.map((node) => node.id))}，节点详情=${JSON.stringify(nodeDetails)}，相关连线=${JSON.stringify(relatedEdges)}。
除非用户明确切换或移除对象，后续“${isGroupFocus ? '这些/这一组/所选节点' : '这个/它/当前节点'}”都指向上述目标。${isGroupFocus ? '先逐个读取必要节点的 neighborhood，理解组内关系；用户要求整体修改时应作用于整组，要求其中某个节点时根据 ID 和类型精确操作。' : `先用 canvas_get_state(detail:"neighborhood", node_id:"${nodes[0].id}")读取最新状态。`}内容和参数用 canvas_update_node，图片/视频生成用 canvas_generate，音频生成用 doubao_speech_generate(target_node_id)，位置用 canvas_set_node_position，尺寸用 canvas_set_node_size，连线用 canvas_connect/canvas_disconnect，也可复制或删除。修改后用 canvas_get_state 或 canvas_capture_node 核验，不要另建无关替代节点。`;
      }
    }
    const prefix = `[用户正在画布视图中操作。生成图片/视频优先使用 canvas_generate 工具（按模型走对应渠道并自动更新节点）；GPT Image 2 使用「设置 → 图片模型」中的 API 槽位。如果用户看过 MG/视频结果后说“不满意/文字还是错/有错字/乱码/字幕不对/字不对/文案不对/还是不行”，优先调用 mg_text_fallback_generate 做二次兜底：GPT-Image-2 生成文字定版图，再用筷子 Seedance 2.0 Mini 图生视频；不要继续反复调 Omni。其他画布操作用 canvas_add_node / canvas_update_node / canvas_connect。语音转写/字幕/口播剪辑用 canvas_transcribe（豆包 ASR，长素材免分段）。${canvasCtx}${focusCtx}]\n\n`;
    onSendMessage(prefix + text, filePaths);
  };

  // 抽屉发送：@ 引用提取为参考 URL 行
  const handleSend = (raw: string, files?: string[]) => {
    const { imageUrls, videoUrls, audioUrls } = mention.extractMentionedUrls(raw);
    let text = raw;
    if (imageUrls.length > 0 || videoUrls.length > 0 || audioUrls.length > 0) {
      const refs: string[] = [];
      if (imageUrls.length > 0) refs.push(`参考图片: ${imageUrls.join(', ')}`);
      if (videoUrls.length > 0) refs.push(`参考视频: ${videoUrls.join(', ')}`);
      if (audioUrls.length > 0) refs.push(`参考音频: ${audioUrls.join(', ')}`);
      text += '\n\n' + refs.join('\n');
    }
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
    const { action, nodeId, nodeIds, prompt: actionPrompt } = pendingAction;
    if (action === 'agent-focus-node' || action === 'agent-focus-nodes') {
      clearPendingAction();
      setFocusedNodeIds(nodeIds?.length ? nodeIds : [nodeId]);
      setOpen(true);
      return;
    }
    if (isStreaming) return;
    clearPendingAction();
    setFocusedNodeIds([nodeId]);
    setOpen(true);

    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) return;
    const data = node.data as Record<string, unknown>;

    // asset:// URL → COS 公网 URL（agent 需要可访问地址）
    const assetToCosUrl = async (url: string): Promise<string> => {
      if (!url) return '';
      if (url.startsWith('http://') || url.startsWith('https://')) {
        if (!url.includes('asset.localhost')) return url;
      }
      try {
        let localPath: string;
        if (url.startsWith('asset://') || url.startsWith('https://asset.localhost/')) {
          localPath = decodeURIComponent(
            url.replace(/^asset:\/\/localhost/, '').replace(/^https:\/\/asset\.localhost/, '')
          );
        } else if (url.startsWith('/')) {
          localPath = url;
        } else {
          return url;
        }
        const { uploadToCos } = await import('@/lib/cos');
        const fileName = localPath.split('/').pop() || `ref-${Date.now()}.png`;
        return await uploadToCos(localPath, fileName);
      } catch (err) {
        console.warn('COS 上传失败，传原始 URL:', err);
        return url;
      }
    };

    (async () => {
    let prompt = '';

    switch (action) {
      case 'ai-polish':
        prompt = `请对节点 ${nodeId} 的文本进行润色优化，保持原意但提升表达质量。当前文本："${data.description || data.generatedContent || ''}"`;
        break;
      case 'ai-expand':
        prompt = `请对节点 ${nodeId} 的文本进行扩写，丰富细节和内容。当前文本："${data.description || data.generatedContent || ''}"`;
        break;
      case 'ai-generate-image': {
        const imgData = data as Record<string, unknown>;
        const desc = actionPrompt || (imgData.description as string) || '';
        const engine = (imgData.imageModel as string) || 'gpt-image-2';
        const ar = (imgData.aspectRatio as string) || '16:9';
        if (engine === 'dreamina') {
          const res = (imgData.resolution as string) || '4k';
          prompt = `请为节点 ${nodeId} 使用即梦生成一张图片。描述："${desc}"。参数：模型版本 5.0，比例 ${ar}，分辨率 ${res}。`;
        } else {
          const isMidjourney = engine === 'midjourney' || engine.startsWith('midjourney-');
          const version = isMidjourney ? normalizeMidjourneyVersion(imgData.modelVersion) : '';
          const engineId = isMidjourney && version === 'v8.1'
            ? 'midjourney-v81'
            : isMidjourney
              ? 'midjourney-v82'
              : 'gpt-image-2';
          const mjParams = isMidjourney
            ? `${version ? `,"version":"${version}"` : ''}${Number.isFinite(imgData.midjourneyStylize) ? `,"stylize":${imgData.midjourneyStylize}` : ''}${Number.isFinite(imgData.midjourneyChaos) ? `,"chaos":${imgData.midjourneyChaos}` : ''}${typeof imgData.midjourneyRaw === 'boolean' ? `,"raw":${imgData.midjourneyRaw}` : ''}${Number.isFinite(imgData.midjourneyWeird) ? `,"weird":${imgData.midjourneyWeird}` : ''}`
            : '';
          prompt = `请为节点 ${nodeId} 生成一张图片。描述："${desc}"。
直接调用 canvas_generate 工具：engine="${engineId}"，params={"aspectRatio":"${ar}"${mjParams}}；如有参考图请传 reference_urls。
工具会自动生成、下载并更新节点，不需要再调 canvas_update_node。`;
        }
        break;
      }
      case 'ai-image-to-image': {
        const imgUrl = (data.generatedImageUrl || data.referenceImage) as string || '';
        prompt = `请基于节点 ${nodeId} 的参考图进行图生图，生成风格相似但有变化的新图片。
直接调用 canvas_generate 工具：engine="gpt-image-2"，reference_urls=["${imgUrl}"]（本地 asset URL 可直接传，工具会自动上传）。`;
        break;
      }
      case 'ai-generate-video': {
        const videoData = data as Record<string, unknown>;
        const res = (videoData.resolution as string) || '720p';
        const ar = (videoData.aspectRatio as string) || 'adaptive';
        const dur = (videoData.duration as number) || 5;
        const mdl = (videoData.modelVersion as string) || 'seedance-2.0';
        const desc = actionPrompt || (videoData.description as string) || '';
        const engineId = mdl === 'minimax-hailuo-h3' || mdl === 'minimax-h3'
          ? 'minimax-hailuo-h3'
          : mdl.includes('fast') ? 'seedance-2.0-fast' : 'seedance-2.0';
        prompt = `请为节点 ${nodeId} 生成一段视频。描述："${desc}"。
使用 canvas_generate 工具：engine="${engineId}"（无参考图时改用 "seedance-2.0-t2v"），params={"resolution":"${res}","ratio":"${ar}","duration":"${dur}"}。
注意 Seedance 视频提示词以 ~/.kunpeng/aigc-memory/prompt-templates/seedance/README.md 为准；@图片按 reference_urls 顺序用中文数字引用；多模态引擎必须有参考图。
先按规范优化提示词再调用工具。工具会自动更新节点。`;
        break;
      }
      case 'ai-3d-camera': {
        const imgUrl3d = await assetToCosUrl((data.generatedImageUrl || data.referenceImage) as string || '');
        prompt = `请基于节点 ${nodeId} 的图片，使用 3D 相机视角变换生成新图片。${imgUrl3d ? `\n图片 URL: ${imgUrl3d}` : ''}${actionPrompt ? `\n${actionPrompt}` : ''}`;
        break;
      }
      case 'ai-image-to-prompt': {
        const imgUrlP = await assetToCosUrl((data.generatedImageUrl || data.referenceImage) as string || '');
        prompt = `请分析节点 ${nodeId} 的图片内容，反推出详细的图片生成提示词（prompt），包括主题、风格、环境、光线、构图等要素。${imgUrlP ? `\n图片 URL: ${imgUrlP}` : ''}`;
        break;
      }
    }

    if (prompt) {
      setTimeout(() => void sendCanvasMessage(prompt, undefined, nodeId), 300);
    }
    })();
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
      contextBannerKey={focusedNodeIds.join('|')}
      contextBanner={focusedNode && focusedNodeMeta ? (
        <div
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
            onClick={() => setFocusedNodeIds([])}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-[var(--canvas-text-3)] transition-colors hover:bg-white/[0.08] hover:text-[var(--canvas-text-1)]"
            title={focusedNodes.length > 1 ? '取消节点工作集' : '取消指定节点'}
          >
            <X size={13} />
          </button>
        </div>
      ) : undefined}
    />
  );
}
