import type { Tool } from '../types';
import { useCanvasStore } from '@/stores/canvasStore';
import { useCanvasTaskStore } from '@/stores/canvasTaskStore';
import { nanoid } from 'nanoid';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { stripDriveLeadingSlash } from '@/lib/platform';
import { defaultNodeStyle, estimateNodeSize } from '@/lib/canvas/layout';
import { recoverCanvasTaskNow } from '@/hooks/useCanvasTaskRecovery';
import { useChatStore } from '@/stores/chatStore';
import { captureElementToPng, waitForElement } from '@/lib/agent/visualCapture';
import { loadMediaInput } from '@/lib/agent/mediaInput';
import type { Connection, Node } from 'reactflow';

/** 画布可渲染的节点类型（CanvasView nodeTypes 注册表） */
const VALID_NODE_TYPES = new Set(['text', 'image', 'video', 'audio', 'group', 'panorama']);
/** agent 传错 type 时的常见别名纠正 */
const TYPE_ALIASES: Record<string, string> = {
  img: 'image', picture: 'image', photo: 'image', 图片: 'image',
  vid: 'video', movie: 'video', 视频: 'video',
  sound: 'audio', music: 'audio', voice: 'audio', 音频: 'audio',
  txt: 'text', 文本: 'text', 文字: 'text',
};

function resolveNodeType(raw: unknown): { type?: string; error?: string } {
  const t = String(raw ?? '').trim().toLowerCase();
  if (VALID_NODE_TYPES.has(t)) return { type: t };
  const alias = TYPE_ALIASES[t];
  if (alias) return { type: alias };
  return { error: `未知节点类型 "${raw}"，可用: text / image / video / audio` };
}

/** Convert local file paths to Tauri asset URLs for WebView rendering.
 * 同时返回解析出的本地路径（供 data.localPath 同步写入——只有 asset URL
 * 没有 localPath 的节点，工坊回传/音色关联/恢复判定都找不到文件）。 */
function normalizeUrlWithPath(url: unknown): { url?: string; localPath?: string } {
  if (typeof url !== 'string' || !url) return {};
  if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('data:') || url.startsWith('asset://')) {
    return { url };
  }
  let filePath = url.startsWith('file://') ? url.replace('file://', '') : url;
  // file:///C:/... 反解后是 '/C:/...'，Windows 需去前导斜杠
  filePath = stripDriveLeadingSlash(filePath);
  // agent 常用 ~/ 前缀路径（工具文档就是这么写的），不展开就变死链
  if (filePath.startsWith('~/') && cachedHome) {
    filePath = `${cachedHome}${filePath.slice(1)}`;
  }
  // Windows 原生绝对路径（C:\...）同样转 asset URL 并给出 localPath
  if (filePath.startsWith('/') || /^[A-Za-z]:[\\/]/.test(filePath)) {
    return { url: convertFileSrc(filePath), localPath: filePath };
  }
  return { url };
}

// homeDir 是异步 API，但工具执行环境里 home 不会变——模块加载时异步取回缓存
//（agent 工具执行远晚于应用启动，实际总是就绪）。
let cachedHome = '';
void import('@tauri-apps/api/path').then(({ homeDir }) => homeDir()).then((h) => { cachedHome = h.replace(/\/$/, ''); }).catch(() => {});

function normalizeUrl(url: unknown): string | undefined {
  return normalizeUrlWithPath(url).url;
}

/** 统一的 data 解析 + 字段别名规范化 + URL 转换（add/update/batch 三处共用） */
function normalizeNodeData(rawData: unknown, type: string): Record<string, unknown> {
  let data: Record<string, unknown>;
  try {
    data = typeof rawData === 'string' ? JSON.parse(rawData) : ((rawData as Record<string, unknown>) ?? {});
  } catch {
    data = { description: String(rawData) };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    data = { description: String(rawData) };
  }
  // Normalize common field name variants
  if (data.image_url && !data.generatedImageUrl) data.generatedImageUrl = data.image_url;
  if (data.imageUrl && !data.generatedImageUrl && type === 'image') data.generatedImageUrl = data.imageUrl;
  if (data.url && type === 'image' && !data.generatedImageUrl) data.generatedImageUrl = data.url;
  if (data.video_url && !data.generatedVideoUrl) data.generatedVideoUrl = data.video_url;
  if (data.videoUrl && !data.generatedVideoUrl) data.generatedVideoUrl = data.videoUrl;
  if (data.url && type === 'video' && !data.generatedVideoUrl) data.generatedVideoUrl = data.url;
  if (data.audio_url && !data.audioUrl) data.audioUrl = data.audio_url;
  if (data.audioURL && !data.audioUrl) data.audioUrl = data.audioURL;
  if (data.url && type === 'audio' && !data.audioUrl) data.audioUrl = data.url;
  if (type === 'audio' && data.localPath && !data.audioUrl) data.audioUrl = data.localPath;

  // URL 转换 + localPath 同步写入（本地路径来源时）
  for (const key of ['generatedImageUrl', 'referenceImage', 'generatedVideoUrl', 'audioUrl', 'imageUrl'] as const) {
    if (!data[key]) continue;
    const { url, localPath } = normalizeUrlWithPath(data[key]);
    data[key] = url;
    if (localPath && !data.localPath) data.localPath = localPath;
  }
  // referenceImages 数组逐项规范化（曾只处理单数字段，数组里的裸路径破图）
  if (Array.isArray(data.referenceImages)) {
    data.referenceImages = (data.referenceImages as { url?: string; name?: string }[])
      .map((r) => ({ ...r, url: normalizeUrl(r?.url) ?? r?.url }))
      .filter((r) => Boolean(r.url));
  }
  if (type === 'video' && data.generatedVideoUrl) {
    if (data.mediaRole === 'reference') {
      const explicitPath = typeof data.sourceVideoPath === 'string'
        ? data.sourceVideoPath
        : typeof data.localPath === 'string'
          ? data.localPath
          : undefined;
      if (explicitPath) data.sourceVideoPath = explicitPath;
    } else {
      // Agent write-backs are generated outputs by default. An input video
      // must be explicitly declared mediaRole:"reference".
      data.mediaRole = 'output';
    }
  }
  return data;
}

/** type 与 data 内容交叉校验：媒体 URL 写进不匹配的节点类型不渲染，产物"消失" */
function checkTypeDataMismatch(type: string, data: Record<string, unknown>): string | null {
  if (type !== 'image' && data.generatedImageUrl && !data.generatedVideoUrl && !data.audioUrl) {
    return `data 含图片 URL 但节点类型是 ${type}——图片写进 ${type} 节点不会显示。请用 type:"image"`;
  }
  if (type !== 'video' && data.generatedVideoUrl && !data.generatedImageUrl && !data.audioUrl) {
    return `data 含视频 URL 但节点类型是 ${type}——请用 type:"video"`;
  }
  if (type !== 'audio' && data.audioUrl && !data.generatedImageUrl && !data.generatedVideoUrl) {
    return `data 含音频 URL 但节点类型是 ${type}——请用 type:"audio"`;
  }
  return null;
}

/** 计算新节点的自动位置（在最右侧节点右边 300px） */
function autoPosition(): { x: number; y: number } {
  const { nodes } = useCanvasStore.getState();
  if (nodes.length === 0) return { x: 100, y: 200 };
  const maxX = Math.max(...nodes.map((n) => n.position.x + (n.width || 280)));
  const avgY = nodes.reduce((s, n) => s + n.position.y, 0) / nodes.length;
  return { x: maxX + 80, y: avgY };
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return value.split(',').map((s) => s.trim()).filter(Boolean);
  }
}

function parsePositionList(value: unknown): { id: string; x: number; y: number }[] {
  const raw = typeof value === 'string' ? JSON.parse(value) : value;
  if (!Array.isArray(raw)) throw new Error('positions 必须是数组');
  return raw.map((item) => {
    const row = item as Record<string, unknown>;
    const id = String(row.id ?? row.node_id ?? '').trim();
    const x = Number(row.x ?? row.position_x);
    const y = Number(row.y ?? row.position_y);
    if (!id || !Number.isFinite(x) || !Number.isFinite(y)) {
      throw new Error('positions 每项必须包含 id、x、y');
    }
    return { id, x, y };
  });
}

const TOOL_STRING_LIMIT = 12_000;
const TOOL_ARRAY_LIMIT = 40;
const TOOL_OBJECT_LIMIT = 80;

/**
 * Tool results are appended to the Agent conversation. Never echo base64
 * media or an unbounded node payload back into that history: the canvas
 * already owns the authoritative data and the Agent only needs an operable
 * summary plus field names.
 */
function sanitizeCanvasToolValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') {
    if (value.startsWith('data:')) return `[内嵌媒体已省略 · ${value.length} 字符]`;
    if (value.length > TOOL_STRING_LIMIT) {
      return `${value.slice(0, TOOL_STRING_LIMIT)}\n...[已截断 ${value.length - TOOL_STRING_LIMIT} 字符]`;
    }
    return value;
  }
  if (value == null || typeof value !== 'object') return value;
  if (depth >= 5) return '[深层内容已省略]';
  if (Array.isArray(value)) {
    const items = value
      .slice(0, TOOL_ARRAY_LIMIT)
      .map((item) => sanitizeCanvasToolValue(item, depth + 1));
    if (value.length > TOOL_ARRAY_LIMIT) {
      items.push(`[另有 ${value.length - TOOL_ARRAY_LIMIT} 项已省略]`);
    }
    return items;
  }
  const entries = Object.entries(value as Record<string, unknown>);
  const sanitized = Object.fromEntries(
    entries
      .slice(0, TOOL_OBJECT_LIMIT)
      .map(([key, item]) => [key, sanitizeCanvasToolValue(item, depth + 1)]),
  );
  if (entries.length > TOOL_OBJECT_LIMIT) {
    sanitized.__omittedFields = entries.length - TOOL_OBJECT_LIMIT;
  }
  return sanitized;
}

function sanitizeCanvasNodeForTool<T extends { data: Record<string, unknown> }>(node: T): T {
  return {
    ...node,
    data: sanitizeCanvasToolValue(node.data) as Record<string, unknown>,
  };
}

export const canvasAddNode: Tool = {
  definition: {
    name: 'canvas_add_node',
    description: `在画布上创建一个新节点。返回新节点的 id。
- text 节点 data: {"description":"文案描述", "generatedContent":"生成的文字内容"}
- image 节点 data: {"description":"图片描述", "generatedImageUrl":"图片URL地址"}
- video 节点 data: {"description":"视频描述", "generatedVideoUrl":"视频URL地址"}
- audio 节点 data: {"description":"音频描述", "audioUrl":"音频URL地址", "localPath":"本地音频路径", "fileName":"文件名"}`,
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', description: '节点类型: text, image, video, audio', enum: ['text', 'image', 'video', 'audio'] },
        data: { type: 'string', description: '节点数据 JSON 字符串' },
        position_x: { type: 'number', description: '节点 X 坐标（可选，不填自动排列）' },
        position_y: { type: 'number', description: '节点 Y 坐标（可选，不填自动排列）' },
        width: { type: 'number', description: '节点宽度（可选）' },
        height: { type: 'number', description: '节点高度（可选）' },
      },
      required: ['type', 'data'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const resolved = resolveNodeType(params.type);
    if (!resolved.type) return { success: false, output: '', error: resolved.error! };
    const type = resolved.type;
    const data = normalizeNodeData(params.data, type);
    const mismatch = checkTypeDataMismatch(type, data);
    if (mismatch) return { success: false, output: '', error: mismatch };

    const pos = params.position_x != null
      ? { x: Number(params.position_x), y: Number(params.position_y || 200) }
      : autoPosition();
    const id = `node-${nanoid(8)}`;
    const nodeData: Record<string, unknown> = { id, type, position: pos, data };
    if (params.width != null) nodeData.width = Number(params.width);
    if (params.height != null) nodeData.height = Number(params.height);
    if (params.width == null && params.height == null) {
      const style = defaultNodeStyle(type);
      if (style) nodeData.style = style;
    }
    useCanvasStore.getState().addNode(nodeData as any);
    return {
      success: true,
      output: JSON.stringify({ id, type, position: pos, updatedFields: Object.keys(data) }),
    };
  },
};

export const canvasUpdateNode: Tool = {
  definition: {
    name: 'canvas_update_node',
    description: `更新画布上已有节点的内容与生成参数。data 为要合并的字段，不会清空未提供字段。
- 更新图片: {"generatedImageUrl":"https://..."}
- 写回生成视频: {"generatedVideoUrl":"https://...","localPath":"/path/out.mp4","mediaRole":"output"}
- 用户明确选择的视频输入: {"generatedVideoUrl":"...","localPath":"/path/input.mp4","sourceVideoPath":"/path/input.mp4","mediaRole":"reference"}
- 更新音频: {"audioUrl":"https://...","localPath":"/path/to/audio.mp3"}
- 更新文本: {"description":"提示词","generatedContent":"生成的文字"}
- 更新模型参数: {"imageModel":"gpt-image-2","aspectRatio":"16:9","resolution":"2k"}。
位置使用 canvas_set_node_position，尺寸使用 canvas_set_node_size，连线使用 canvas_connect/canvas_disconnect。`,
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: '要更新的节点 ID' },
        data: { type: 'string', description: '要合并的数据 JSON 字符串' },
      },
      required: ['node_id', 'data'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const id = params.node_id as string;
    const store = useCanvasStore.getState();
    const node = store.nodes.find((n) => n.id === id);
    if (!node) return { success: false, output: '', error: `Node ${id} not found` };
    const data = normalizeNodeData(params.data, node.type ?? 'text');
    // 按节点类型对 localPath 补写显示 URL（video/image 曾只有 audio 分支，
    // 只传 localPath 时节点显示空白）
    if (data.localPath && typeof data.localPath === 'string') {
      const assetUrl = normalizeUrl(data.localPath);
      if (node.type === 'video' && !data.generatedVideoUrl) data.generatedVideoUrl = assetUrl;
      if (node.type === 'image' && !data.generatedImageUrl) data.generatedImageUrl = assetUrl;
      if (node.type === 'audio' && !data.audioUrl) data.audioUrl = assetUrl;
    }
    store.updateNode(id, data);
    return {
      success: true,
      output: JSON.stringify({ id, updatedFields: Object.keys(data) }),
    };
  },
};

export const canvasDeleteNode: Tool = {
  definition: {
    name: 'canvas_delete_node',
    description: '删除画布上的一个节点及其所有连线。',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: '要删除的节点 ID' },
      },
      required: ['node_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const id = params.node_id as string;
    useCanvasStore.getState().deleteNode(id);
    return { success: true, output: `Deleted node ${id}` };
  },
};

export const canvasConnect: Tool = {
  definition: {
    name: 'canvas_connect',
    description: '在两个节点之间创建一条连线。',
    parameters: {
      type: 'object',
      properties: {
        source_id: { type: 'string', description: '源节点 ID' },
        target_id: { type: 'string', description: '目标节点 ID' },
      },
      required: ['source_id', 'target_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const source = params.source_id as string;
    const target = params.target_id as string;
    useCanvasStore.getState().onConnect({ source, target, sourceHandle: null, targetHandle: null });
    return { success: true, output: `Connected ${source} → ${target}` };
  },
};

export const canvasDisconnect: Tool = {
  definition: {
    name: 'canvas_disconnect',
    description: '断开画布节点连线。优先传 edge_id；也可传 source_id + target_id 精确定位。会同步清理目标节点对应的参考素材。',
    parameters: {
      type: 'object',
      properties: {
        edge_id: { type: 'string', description: '要断开的连线 ID' },
        source_id: { type: 'string', description: '源节点 ID；未传 edge_id 时使用' },
        target_id: { type: 'string', description: '目标节点 ID；未传 edge_id 时使用' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const store = useCanvasStore.getState();
    const edgeId = String(params.edge_id ?? '').trim();
    const sourceId = String(params.source_id ?? '').trim();
    const targetId = String(params.target_id ?? '').trim();
    const edge = edgeId
      ? store.edges.find((item) => item.id === edgeId)
      : store.edges.find((item) => item.source === sourceId && item.target === targetId);
    if (!edge) return { success: false, output: '', error: '未找到要断开的连线' };
    store.deleteEdge(edge.id);
    return { success: true, output: JSON.stringify({ disconnected: edge.id, source: edge.source, target: edge.target }) };
  },
};

export const canvasGetState: Tool = {
  definition: {
    name: 'canvas_get_state',
    description: '获取画布当前状态。默认 summary 只返回轻量摘要；需要局部细节用 selected/neighborhood/full。',
    parameters: {
      type: 'object',
      properties: {
        detail: {
          type: 'string',
          enum: ['summary', 'selected', 'neighborhood', 'full'],
          description: 'summary=节点/连线轻量摘要（默认）；selected=当前选中节点详情；neighborhood=某节点及一跳邻居；full=完整快照',
        },
        node_id: { type: 'string', description: 'detail=neighborhood 时指定中心节点；为空则使用当前选中节点' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const store = useCanvasStore.getState();
    const snapshot = store.getSnapshot();
    const taskSnapshot = useCanvasTaskStore.getState().tasks.slice(-20).map((t) => ({
      id: t.id,
      nodeId: t.nodeId,
      kind: t.kind,
      engineId: t.engineId,
      engineLabel: t.engineLabel,
      status: t.status,
      progress: t.progress,
      rhTaskId: t.rhTaskId,
      endpoint: t.endpoint,
      referenceCount: t.referenceUrls?.length ?? 0,
      referenceUrls: t.referenceUrls,
      submissionReceipt: t.submissionReceipt,
      resultPaths: t.resultPaths,
      resultUrls: t.resultUrls,
      error: t.error,
      fallbackUsed: t.fallbackUsed ?? false,
      inFlight: t.inFlight ?? false,
      workshopShotNo: t.workshopShotNo,
      workshopStoryboardFrameId: t.workshopStoryboardFrameId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      finishedAt: t.finishedAt,
      elapsedSec: Math.max(0, Math.round(((t.finishedAt ?? Date.now()) - t.createdAt) / 1000)),
      promptPreview: t.prompt.length > 240 ? `${t.prompt.slice(0, 240)}...` : t.prompt,
    }));
    const detail = (params.detail as string | undefined) ?? 'summary';
    const summarizeNode = (node: typeof snapshot.nodes[number]) => {
      const data = node.data ?? {};
      const desc = typeof data.description === 'string' ? data.description : '';
      const generatedContent = typeof data.generatedContent === 'string' ? data.generatedContent : '';
      return {
        id: node.id,
        type: node.type,
        position: node.position,
        size: { width: node.width, height: node.height },
        description: desc.length > 120 ? `${desc.slice(0, 120)}...` : desc,
        contentPreview: generatedContent.length > 160 ? `${generatedContent.slice(0, 160)}...` : generatedContent,
        hasImage: Boolean(data.generatedImageUrl || data.referenceImage),
        // localPath 是全类型通用字段（拖入的图片也有），不能证明有视频——
        // 只有 video 类型节点的 localPath 才算
        hasVideo: Boolean(data.generatedVideoUrl || (node.type === 'video' && data.localPath)),
        hasAudio: Boolean(data.audioUrl || (node.type === 'audio' && data.localPath)),
      };
    };

    if (detail === 'full') {
      return {
        success: true,
        output: JSON.stringify({
          ...snapshot,
          nodes: snapshot.nodes.map(sanitizeCanvasNodeForTool),
          generationTasks: taskSnapshot,
        }, null, 2),
      };
    }

    if (detail === 'selected') {
      const node = snapshot.nodes.find((n) => n.id === store.selectedNodeId);
      if (!node) return { success: false, output: '', error: '当前没有选中的画布节点' };
      return {
        success: true,
        output: JSON.stringify({
          node: sanitizeCanvasNodeForTool(node),
          edges: snapshot.edges.filter((e) => e.source === node.id || e.target === node.id),
          generationTasks: taskSnapshot.filter((t) => t.nodeId === node.id),
        }, null, 2),
      };
    }

    if (detail === 'neighborhood') {
      const centerId = (params.node_id as string | undefined) || store.selectedNodeId;
      if (!centerId) return { success: false, output: '', error: '请提供 node_id，或先在画布中选中一个节点' };
      const ids = new Set<string>([centerId]);
      const edges = snapshot.edges.filter((e) => e.source === centerId || e.target === centerId);
      for (const edge of edges) {
        ids.add(edge.source);
        ids.add(edge.target);
      }
      const centerNode = snapshot.nodes.find((node) => node.id === centerId);
      if (centerNode?.parentNode) ids.add(centerNode.parentNode);
      for (const node of snapshot.nodes) {
        if (node.parentNode === centerId) ids.add(node.id);
      }
      return {
        success: true,
        output: JSON.stringify({
          centerId,
          nodes: snapshot.nodes.filter((n) => ids.has(n.id)).map(sanitizeCanvasNodeForTool),
          edges,
          generationTasks: taskSnapshot.filter((t) => ids.has(t.nodeId)),
        }, null, 2),
      };
    }

    return {
      success: true,
      output: JSON.stringify({
        nodeCount: snapshot.nodes.length,
        edgeCount: snapshot.edges.length,
        selectedNodeId: store.selectedNodeId,
        nodes: snapshot.nodes.map(summarizeNode),
        edges: snapshot.edges,
        generationTasks: taskSnapshot,
      }, null, 2),
    };
  },
};

export const canvasCaptureNode: Tool = {
  definition: {
    name: 'canvas_capture_node',
    description: '把指定画布节点当前可见内容截成 PNG，并作为原生图片结果返回给支持视觉的模型，用于验收节点画面、文字和状态。',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: '画布节点 ID' },
        out_path: { type: 'string', description: '可选 PNG 绝对路径；不填则保存到当前工作区 images' },
      },
      required: ['node_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const nodeId = String(params.node_id ?? '');
    const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
    if (!node) return { success: false, output: '', error: `画布节点不存在：${nodeId || '(空)'}` };
    useChatStore.getState().setActiveView('canvas');
    const escaped = typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(nodeId) : nodeId.replace(/["\\]/g, '\\$&');
    try {
      const element = await waitForElement(`.react-flow__node[data-id="${escaped}"]`, 6000);
      const path = await captureElementToPng(element, {
        outPath: params.out_path as string | undefined,
        namePrefix: `canvas-node-${nodeId.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
        backgroundColor: null,
      });
      const native = await loadMediaInput(path);
      return {
        success: true,
        output: JSON.stringify({
          node_id: nodeId,
          node_type: node.type,
          path,
          next: '节点截图已作为原生图片附加到本次工具结果，请直接检查画面和文字是否符合目标。',
        }, null, 2),
        media: [{
          type: 'image',
          source: native.dataUrl.startsWith('data:')
            ? { type: 'base64', media_type: native.mediaType || 'image/png', data: native.dataUrl.slice(native.dataUrl.indexOf(',') + 1) }
            : { type: 'url', url: native.dataUrl },
        }],
      };
    } catch (err) {
      const data = node.data as Record<string, unknown> | undefined;
      const original = data?.localPath || data?.generatedImageUrl || data?.generatedVideoUrl;
      return {
        success: false,
        output: original ? JSON.stringify({ node_id: nodeId, original_media: original }, null, 2) : '',
        error: `截取画布节点失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

export const canvasAutoLayout: Tool = {
  definition: {
    name: 'canvas_auto_layout',
    description: `自动整理画布节点位置。用于用户说"整理画布/排版/太挤/美观一点"。
默认会使用更舒展的间距；可传 horizontal_spacing / vertical_spacing 调大留白。
layout_style:
- flow：按连线从左到右分层，适合工作流
- grid：按网格平铺，适合素材墙/图片资产
可以设置 selected_only=true 只整理当前选中节点，或传 node_ids 只整理指定节点。整理后如仍不美观，可继续用 canvas_set_node_position 或 canvas_batch_set_positions 精修。`,
    parameters: {
      type: 'object',
      properties: {
        layout_style: { type: 'string', enum: ['flow', 'grid'], description: '布局方式：flow=按连线分层；grid=素材网格。默认 flow；如果没有连线可用 grid。' },
        horizontal_spacing: { type: 'number', description: '节点之间的横向留白，默认 180；觉得密就设 240-360。' },
        vertical_spacing: { type: 'number', description: '节点之间的纵向留白，默认 120；觉得密就设 160-260。' },
        start_x: { type: 'number', description: '布局起始 X，默认 100。' },
        start_y: { type: 'number', description: '布局起始 Y，默认 100。' },
        columns: { type: 'number', description: 'grid 模式每行几列，默认自动估算。' },
        selected_only: { type: 'boolean', description: '只整理当前选中的节点。' },
        node_ids: { type: 'string', description: '只整理指定节点 ID，JSON 数组或逗号分隔。' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    const store = useCanvasStore.getState();
    const { nodes, edges } = store;
    if (nodes.length === 0) return { success: true, output: 'Canvas is empty' };
    const selectedOnly = Boolean(params.selected_only);
    const explicitIds = new Set(parseStringArray(params.node_ids));
    const targetNodes = nodes.filter((n) => {
      if (explicitIds.size > 0) return explicitIds.has(n.id);
      if (selectedOnly) return Boolean(n.selected) || store.selectedNodeId === n.id;
      return true;
    });
    if (targetNodes.length === 0) return { success: false, output: '', error: '没有可整理的节点：请取消 selected_only，或先选中/提供 node_ids。' };

    const targetIds = new Set(targetNodes.map((n) => n.id));
    const relevantEdges = edges.filter((e) => targetIds.has(e.source) && targetIds.has(e.target));
    const layoutStyle = (params.layout_style as string | undefined) ?? (relevantEdges.length > 0 ? 'flow' : 'grid');
    const hGap = Number(params.horizontal_spacing ?? 180);
    const vGap = Number(params.vertical_spacing ?? 120);
    const startX = Number(params.start_x ?? 100);
    const startY = Number(params.start_y ?? 100);
    const nodeSize = new Map(targetNodes.map((n) => [n.id, estimateNodeSize(n)]));

    if (layoutStyle === 'grid') {
      const cols = Math.max(1, Math.floor(Number(params.columns ?? Math.ceil(Math.sqrt(targetNodes.length)))));
      const maxW = Math.max(...targetNodes.map((n) => nodeSize.get(n.id)?.width ?? 280));
      const maxH = Math.max(...targetNodes.map((n) => nodeSize.get(n.id)?.height ?? 160));
      const newNodes = nodes.map((n) => {
        const idx = targetNodes.findIndex((x) => x.id === n.id);
        if (idx < 0) return n;
        return {
          ...n,
          position: {
            x: startX + (idx % cols) * (maxW + hGap),
            y: startY + Math.floor(idx / cols) * (maxH + vGap),
          },
        };
      });
      store.setNodes(newNodes);
      return { success: true, output: `已用网格布局整理 ${targetNodes.length} 个节点：${cols} 列，横向留白 ${hGap}px，纵向留白 ${vGap}px。` };
    }

    // Build adjacency for topological sort
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of targetNodes) {
      inDegree.set(n.id, 0);
      adj.set(n.id, []);
    }
    for (const e of relevantEdges) {
      adj.get(e.source)?.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }

    // Kahn's algorithm
    const queue = targetNodes.filter((n) => (inDegree.get(n.id) || 0) === 0).map((n) => n.id);
    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const next of adj.get(id) || []) {
        const deg = (inDegree.get(next) || 1) - 1;
        inDegree.set(next, deg);
        if (deg === 0) queue.push(next);
      }
    }
    // Add any remaining (cycles)
    for (const n of targetNodes) {
      if (!order.includes(n.id)) order.push(n.id);
    }

    // Assign positions: group by topological level
    const level = new Map<string, number>();
    for (const id of order) {
      const parents = relevantEdges.filter((e) => e.target === id).map((e) => e.source);
      const maxParentLevel = parents.length > 0 ? Math.max(...parents.map((p) => level.get(p) || 0)) + 1 : 0;
      level.set(id, maxParentLevel);
    }

    const levelGroups = new Map<number, string[]>();
    for (const [id, lv] of level) {
      if (!levelGroups.has(lv)) levelGroups.set(lv, []);
      levelGroups.get(lv)!.push(id);
    }

    const sortedLevels = [...levelGroups.keys()].sort((a, b) => a - b);
    const levelX = new Map<number, number>();
    let cursorX = startX;
    for (const lv of sortedLevels) {
      levelX.set(lv, cursorX);
      const ids = levelGroups.get(lv) ?? [];
      const maxW = Math.max(0, ...ids.map((id) => nodeSize.get(id)?.width ?? 280));
      cursorX += maxW + hGap;
    }

    const newNodes = nodes.map((n) => {
      const lv = level.get(n.id) || 0;
      const group = levelGroups.get(lv) || [n.id];
      const idx = group.indexOf(n.id);
      if (idx < 0) return n;
      let y = startY;
      for (let i = 0; i < idx; i++) {
        const prevId = group[i];
        y += (nodeSize.get(prevId)?.height ?? 160) + vGap;
      }
      return {
        ...n,
        position: {
          x: levelX.get(lv) ?? startX,
          y,
        },
      };
    });

    store.setNodes(newNodes);
    return { success: true, output: `已按工作流整理 ${targetNodes.length} 个节点，分成 ${levelGroups.size} 层，横向留白 ${hGap}px，纵向留白 ${vGap}px。需要更松可再次调大 spacing，或用 canvas_batch_set_positions 精修。` };
  },
};

export const canvasSetNodePosition: Tool = {
  definition: {
    name: 'canvas_set_node_position',
    description: '移动画布上的单个节点。用于精修排版、把某个节点拉开、对齐到某个位置。支持 absolute 或 relative。',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: '节点 ID' },
        x: { type: 'number', description: '目标 X，或 relative 模式下的 X 偏移' },
        y: { type: 'number', description: '目标 Y，或 relative 模式下的 Y 偏移' },
        mode: { type: 'string', enum: ['absolute', 'relative'], description: 'absolute=设置绝对坐标；relative=按偏移移动。默认 absolute。' },
      },
      required: ['node_id', 'x', 'y'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const id = String(params.node_id ?? '');
    const x = Number(params.x);
    const y = Number(params.y);
    if (!id || !Number.isFinite(x) || !Number.isFinite(y)) return { success: false, output: '', error: 'node_id、x、y 必填' };
    const mode = (params.mode as string | undefined) ?? 'absolute';
    const store = useCanvasStore.getState();
    const node = store.nodes.find((n) => n.id === id);
    if (!node) return { success: false, output: '', error: `Node ${id} not found` };
    const position = mode === 'relative'
      ? { x: node.position.x + x, y: node.position.y + y }
      : { x, y };
    store.setNodes(store.nodes.map((n) => n.id === id ? { ...n, position } : n));
    store.setSelectedNodeId(id);
    return { success: true, output: JSON.stringify({ id, position }) };
  },
};

export const canvasSetNodeSize: Tool = {
  definition: {
    name: 'canvas_set_node_size',
    description: '调整单个画布节点的显示尺寸。适用于图片、视频、文本、音频、3D 世界和分组节点。',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: '节点 ID' },
        width: { type: 'number', description: '目标宽度，至少 80' },
        height: { type: 'number', description: '目标高度，至少 60' },
      },
      required: ['node_id', 'width', 'height'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const id = String(params.node_id ?? '').trim();
    const width = Number(params.width);
    const height = Number(params.height);
    if (!id || !Number.isFinite(width) || !Number.isFinite(height)) {
      return { success: false, output: '', error: 'node_id、width、height 必填' };
    }
    if (width < 80 || height < 60) {
      return { success: false, output: '', error: '节点尺寸过小：width 至少 80，height 至少 60' };
    }
    const store = useCanvasStore.getState();
    if (!store.nodes.some((node) => node.id === id)) {
      return { success: false, output: '', error: `Node ${id} not found` };
    }
    store.setNodes(store.nodes.map((node) =>
      node.id === id
        ? {
            ...node,
            width,
            height,
            style: { ...(node.style ?? {}), width, height },
          }
        : node,
    ));
    store.setSelectedNodeId(id);
    return { success: true, output: JSON.stringify({ id, width, height }) };
  },
};

export const canvasBatchSetPositions: Tool = {
  definition: {
    name: 'canvas_batch_set_positions',
    description: `批量移动多个画布节点。用于 agent 按审美手动整理画布：先 canvas_get_state 查看节点位置和尺寸，再计算更美观的坐标，一次性提交。
positions 示例：[{"id":"node-1","x":100,"y":100},{"id":"node-2","x":620,"y":100}]`,
    parameters: {
      type: 'object',
      properties: {
        positions: { type: 'string', description: 'JSON 数组，每项包含 id,x,y。' },
      },
      required: ['positions'],
    },
  },
  risk: 'safe',
  async execute(params) {
    let positions: { id: string; x: number; y: number }[];
    try {
      positions = parsePositionList(params.positions);
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
    const posMap = new Map(positions.map((p) => [p.id, { x: p.x, y: p.y }]));
    const store = useCanvasStore.getState();
    const known = new Set(store.nodes.map((n) => n.id));
    const missing = positions.map((p) => p.id).filter((id) => !known.has(id));
    if (missing.length > 0) return { success: false, output: '', error: `节点不存在：${missing.join(', ')}` };
    store.setNodes(store.nodes.map((n) => posMap.has(n.id) ? { ...n, position: posMap.get(n.id)! } : n));
    return { success: true, output: `已移动 ${positions.length} 个节点。` };
  },
};

export const canvasDuplicateNode: Tool = {
  definition: {
    name: 'canvas_duplicate_node',
    description: '复制画布上的一个节点（包含所有数据）。返回新节点 id。',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string', description: '要复制的节点 ID' },
        offset_x: { type: 'number', description: '新节点相对原节点的 X 偏移（默认 40）' },
        offset_y: { type: 'number', description: '新节点相对原节点的 Y 偏移（默认 40）' },
      },
      required: ['node_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const id = params.node_id as string;
    const store = useCanvasStore.getState();
    const node = store.nodes.find((n) => n.id === id);
    if (!node) return { success: false, output: '', error: `Node ${id} not found` };
    const newId = `node-${nanoid(8)}`;
    const ox = Number(params.offset_x || 40);
    const oy = Number(params.offset_y || 40);
    store.addNode({
      id: newId,
      type: node.type,
      position: { x: node.position.x + ox, y: node.position.y + oy },
      data: { ...node.data },
      width: node.width ?? undefined,
      height: node.height ?? undefined,
    } as any);
    return { success: true, output: JSON.stringify({ id: newId, source: id }) };
  },
};

export const canvasBatchCreate: Tool = {
  definition: {
    name: 'canvas_batch_create',
    description: `批量创建节点和连线。一次性构建完整流水线。
参数 nodes: [{"type":"text","data":{...}}, {"type":"image","data":{...}}]
参数 connections: [[0,1]] 表示第0个节点连到第1个节点（使用数组索引）`,
    parameters: {
      type: 'object',
      properties: {
        nodes: { type: 'string', description: '节点数组 JSON 字符串' },
        connections: { type: 'string', description: '连线数组 JSON 字符串，每项 [sourceIndex, targetIndex]' },
      },
      required: ['nodes'],
    },
  },
  risk: 'safe',
  async execute(params) {
    let nodeDefs: { type: string; data: Record<string, unknown> }[];
    try {
      nodeDefs = JSON.parse(params.nodes as string);
    } catch {
      return { success: false, output: '', error: 'Invalid nodes JSON' };
    }

    let connections: number[][] = [];
    if (params.connections) {
      try {
        connections = JSON.parse(params.connections as string);
      } catch {
        return { success: false, output: '', error: 'Invalid connections JSON' };
      }
    }

    const store = useCanvasStore.getState();
    const startPos = autoPosition();
    const ids: string[] = [];
    const errors: string[] = [];
    const createdNodes: Node[] = [];

    for (let i = 0; i < nodeDefs.length; i++) {
      const def = nodeDefs[i];
      // 与 canvas_add_node 同一套校验/规范化：type 别名纠正、data 字符串
      // 解析、字段别名、URL 转换+localPath、type-data 交叉校验、默认尺寸
      const resolved = resolveNodeType(def.type);
      if (!resolved.type) { errors.push(`节点[${i}]: ${resolved.error}`); ids.push(''); continue; }
      const data = normalizeNodeData(def.data, resolved.type);
      const mismatch = checkTypeDataMismatch(resolved.type, data);
      if (mismatch) { errors.push(`节点[${i}]: ${mismatch}`); ids.push(''); continue; }
      const id = `node-${nanoid(8)}`;
      ids.push(id);
      createdNodes.push({
        id,
        type: resolved.type,
        position: { x: startPos.x + i * 350, y: startPos.y },
        style: defaultNodeStyle(resolved.type),
        data,
      });
    }

    const canvasConnections: Connection[] = [];
    for (const [si, ti] of connections) {
      if (ids[si] && ids[ti]) {
        canvasConnections.push({
          source: ids[si],
          target: ids[ti],
          sourceHandle: null,
          targetHandle: null,
        });
      }
    }
    store.addNodesAndConnect(createdNodes, canvasConnections);

    const output = JSON.stringify({ ids: ids.filter(Boolean), connections: connections.map(([s, t]) => [ids[s], ids[t]]).filter(([a, b]) => a && b) });
    if (errors.length > 0) {
      return { success: ids.some(Boolean), output, error: `部分节点创建失败：\n${errors.join('\n')}` };
    }
    return { success: true, output };
  },
};

export const canvasExecuteWorkflow: Tool = {
  definition: {
    name: 'canvas_execute_workflow',
    description: '按拓扑顺序返回画布工作流的执行计划。列出每个节点的 ID、类型、输入来源，供 Agent 逐步执行。',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  risk: 'safe',
  async execute() {
    const { nodes, edges } = useCanvasStore.getState();
    if (nodes.length === 0) return { success: true, output: 'Canvas is empty, nothing to execute.' };

    // Topological sort
    const inDegree = new Map<string, number>();
    const adj = new Map<string, string[]>();
    for (const n of nodes) { inDegree.set(n.id, 0); adj.set(n.id, []); }
    for (const e of edges) {
      adj.get(e.source)?.push(e.target);
      inDegree.set(e.target, (inDegree.get(e.target) || 0) + 1);
    }
    const queue = nodes.filter((n) => (inDegree.get(n.id) || 0) === 0).map((n) => n.id);
    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const next of adj.get(id) || []) {
        const deg = (inDegree.get(next) || 1) - 1;
        inDegree.set(next, deg);
        if (deg === 0) queue.push(next);
      }
    }
    for (const n of nodes) { if (!order.includes(n.id)) order.push(n.id); }

    const plan = order.map((id) => {
      const node = nodes.find((n) => n.id === id)!;
      const inputs = edges.filter((e) => e.target === id).map((e) => {
        const src = nodes.find((n) => n.id === e.source);
        return { from: e.source, type: src?.type || 'unknown' };
      });
      return {
        id,
        type: node.type,
        data: sanitizeCanvasToolValue(node.data),
        inputs,
      };
    });

    return { success: true, output: JSON.stringify(plan, null, 2) };
  },
};

export const canvasRecoverTask: Tool = {
  definition: {
    name: 'canvas_recover_task',
    description: `主动从远端 API 取回一个画布/工坊生成任务。用于视频或图片已经超时、UI 仍显示生成中、或用户说“远端已经生成了但鲲鹏没回填”。
优先传本地 task_id；也可传 RunningHub/筷子丽帧的 rh_task_id。工具会查询 API，若已成功则下载产物并回填对应画布节点/工坊分镜。`,
    parameters: {
      type: 'object',
      properties: {
        task_id: { type: 'string', description: '鲲鹏本地任务 ID，例如 canvas_get_state 里的 ct-...' },
        rh_task_id: { type: 'string', description: '远端任务 ID，例如 RunningHub taskId 或筷子丽帧 task_id' },
      },
      required: [],
    },
  },
  risk: 'safe',
  async execute(params) {
    try {
      const task = await recoverCanvasTaskNow({
        taskId: params.task_id as string | undefined,
        rhTaskId: params.rh_task_id as string | undefined,
      });
      return {
        success: task.status === 'succeeded' || task.status === 'running' || task.status === 'downloading',
        output: JSON.stringify({
          id: task.id,
          rhTaskId: task.rhTaskId,
          kind: task.kind,
          engineId: task.engineId,
          status: task.status,
          progress: task.progress,
          resultPaths: task.resultPaths,
          resultUrls: task.resultUrls,
          workshopShotNo: task.workshopShotNo,
          nodeId: task.nodeId,
        }, null, 2),
        error: task.status === 'failed' ? task.error : undefined,
      };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const allCanvasTools: Tool[] = [
  canvasAddNode,
  canvasUpdateNode,
  canvasDeleteNode,
  canvasConnect,
  canvasDisconnect,
  canvasGetState,
  canvasCaptureNode,
  canvasAutoLayout,
  canvasSetNodePosition,
  canvasSetNodeSize,
  canvasBatchSetPositions,
  canvasDuplicateNode,
  canvasBatchCreate,
  canvasExecuteWorkflow,
  canvasRecoverTask,
];
