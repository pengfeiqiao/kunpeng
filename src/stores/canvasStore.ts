import { create } from 'zustand';
import { persist, type PersistStorage, type StorageValue } from 'zustand/middleware';
import { applyNodeChanges, applyEdgeChanges, addEdge } from 'reactflow';
import type { Node, Edge, Connection, NodeChange, EdgeChange } from 'reactflow';
import { nanoid } from 'nanoid';
import { migrateNodeImages } from '@/lib/canvas/assetPersist';
import {
  isNonReferenceEdgeData,
  migrateLegacyVideoNodeReferences,
} from '@/lib/canvas/referencePolicy';
import { safeLocalStorage } from '@/lib/safeStorage';
import { CoalescedIdleWork } from '@/lib/performance/coalescedIdleWork';

// This adapter sits above JSON serialization: Zustand passes the structured
// value here, and only a coalesced idle snapshot is stringified. The project
// canvas file remains the source of truth; this localStorage copy is a fallback.
const CANVAS_CACHE_KEY = 'canvas-cache';
const WRITE_DEBOUNCE_MS = 1_500;
const WRITE_MIN_INTERVAL_MS = 15_000;

function createDebouncedStorage<S>(): PersistStorage<S> {
  let pending: { name: string; value: StorageValue<S> } | null = null;
  let lastWritten: { name: string; value: StorageValue<S> } | null = null;

  const sameCanvasContent = (left: StorageValue<S>, right: StorageValue<S>) => {
    const leftState = left.state as Record<string, unknown>;
    const rightState = right.state as Record<string, unknown>;
    return left.version === right.version
      && leftState.nodes === rightState.nodes
      && leftState.edges === rightState.edges;
  };

  const writer = new CoalescedIdleWork<{ name: string; value: StorageValue<S> }>((snapshot) => {
    try {
      // safeLocalStorage：quota 满自清缓存重试；kunpeng-canvas 是可再生
      // 二级缓存（canvas.json 为源），超大时跳过写入不占配额。
      safeLocalStorage.setItem(snapshot.name, JSON.stringify(snapshot.value));
      lastWritten = snapshot;
    } catch (err) {
      console.error('[canvasStore] persist failed (quota?)', err);
    }
    if (pending === snapshot) pending = null;
  }, {
    debounceMs: WRITE_DEBOUNCE_MS,
    minIntervalMs: WRITE_MIN_INTERVAL_MS,
  });

  const flush = () => {
    const snapshot = pending;
    pending = null;
    if (snapshot) void writer.flush(CANVAS_CACHE_KEY, snapshot);
  };

  // Don't lose the trailing write on refresh/quit.
  window.addEventListener('beforeunload', flush);

  return {
    getItem: (name) => {
      const raw = safeLocalStorage.getItem(name);
      if (!raw) return null;
      try {
        return JSON.parse(raw) as StorageValue<S>;
      } catch (err) {
        console.warn('[canvasStore] ignored invalid persisted canvas', err);
        return null;
      }
    },
    setItem: (name, value) => {
      if (pending?.name === name && sameCanvasContent(pending.value, value)) return;
      if (!pending && lastWritten?.name === name && sameCanvasContent(lastWritten.value, value)) return;
      pending = { name, value };
      writer.schedule(CANVAS_CACHE_KEY, pending);
    },
    removeItem: (name) => {
      if (pending?.name === name) pending = null;
      if (lastWritten?.name === name) lastWritten = null;
      writer.cancel(CANVAS_CACHE_KEY);
      localStorage.removeItem(name);
    },
  };
}

// Node-data fields that are runtime-only and must never be persisted —
// a persisted `isGenerating: true` leaves the node spinning forever after
// an app restart.
const TRANSIENT_NODE_FIELDS = ['isGenerating', 'justCompletedAt'] as const;

/**
 * Repair structural corruption in a node array before handing it to
 * reactflow: drop orphan parentNode references and ensure group nodes
 * precede their children. Both conditions hard-crash reactflow otherwise.
 */
export function repairNodeIntegrity(nodes: Node[]): Node[] {
  const ids = new Set(nodes.map((n) => n.id));
  let out = nodes;
  if (out.some((n) => n.parentNode && !ids.has(n.parentNode))) {
    out = out.map((n) => (n.parentNode && !ids.has(n.parentNode) ? { ...n, parentNode: undefined } : n));
  }
  const groups = out.filter((n) => n.type === 'group');
  if (groups.length > 0) {
    out = [...groups, ...out.filter((n) => n.type !== 'group')];
  }
  out = migrateLegacyVideoNodeReferences(out).nodes;
  return out;
}

function stripTransientNodeFields(nodes: Node[]): Node[] {
  const needsCleanup = nodes.some((n) => {
    const data = n.data as Record<string, unknown> | undefined;
    return Boolean(data && TRANSIENT_NODE_FIELDS.some((field) => field in data));
  });
  if (!needsCleanup) return nodes;
  return nodes.map((n) => {
    const data = n.data as Record<string, unknown> | undefined;
    if (!data || !TRANSIENT_NODE_FIELDS.some((f) => f in data)) return n;
    const cleaned = { ...data };
    for (const f of TRANSIENT_NODE_FIELDS) delete cleaned[f];
    return { ...n, data: cleaned };
  });
}

interface CanvasState {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  pendingAgentAction: { action: string; nodeId: string; prompt?: string; nodeIds?: string[] } | null;

  setNodes: (nodes: Node[]) => void;
  setEdges: (edges: Edge[]) => void;
  addNode: (node: Node) => void;
  addNodesAndConnect: (nodes: Node[], connections: Connection[]) => void;
  updateNode: (id: string, data: Record<string, unknown>) => void;
  updateNodeStyle: (id: string, style: Record<string, unknown>) => void;
  deleteNode: (id: string) => void;
  deleteEdge: (edgeId: string) => void;
  onNodesChange: (changes: NodeChange[]) => void;
  onEdgesChange: (changes: EdgeChange[]) => void;
  onConnect: (connection: Connection & { data?: Record<string, unknown> }) => void;
  setSelectedNodeId: (id: string | null) => void;
  triggerAgentAction: (action: string, nodeId: string, prompt?: string, nodeIds?: string[]) => void;
  clearPendingAction: () => void;
  getSnapshot: () => { nodes: { id: string; type: string; position: { x: number; y: number }; width?: number; height?: number; parentNode?: string; data: Record<string, unknown> }[]; edges: { id: string; source: string; target: string }[] };
}

function applyCanvasConnection(
  nodes: Node[],
  edges: Edge[],
  connection: Connection & { data?: Record<string, unknown> },
): { nodes: Node[]; edges: Edge[] } {
  const nextEdges = addEdge(
    { ...connection, id: `e-${nanoid(8)}`, type: 'custom' },
    edges,
  );

  if (!connection.source || !connection.target) {
    return { nodes, edges: nextEdges };
  }
  if (isNonReferenceEdgeData(connection.data)) {
    return { nodes, edges: nextEdges };
  }

  let updatedNodes = nodes;
  const srcNode = updatedNodes.find((node) => node.id === connection.source);
  const tgtNode = updatedNodes.find((node) => node.id === connection.target);
  if (!srcNode || !tgtNode) return { nodes, edges: nextEdges };

  if (tgtNode.type === 'image') {
    const srcData = srcNode.data as Record<string, unknown>;
    const tgtData = tgtNode.data as Record<string, unknown>;
    // Only image sources belong in referenceImages. A video must be sampled
    // first, otherwise image generation receives an invalid media type.
    const srcUrl = (srcData.generatedImageUrl || srcData.referenceImage) as string | undefined;
    if (srcUrl) {
      const existingRefs = (tgtData.referenceImages as { url: string; name?: string }[]) || [];
      if (!existingRefs.some((ref) => ref.url === srcUrl)) {
        const desc = (srcData.description as string) || '';
        updatedNodes = updatedNodes.map((node) =>
          node.id === connection.target
            ? {
              ...node,
              data: {
                ...node.data,
                referenceImages: [...existingRefs, { url: srcUrl, name: desc.slice(0, 20) || '参考图' }],
                generationMode: 'image-to-image',
              },
            }
            : node,
        );
      }
    }
  }

  if (tgtNode.type === 'video') {
    const srcData = srcNode.data as Record<string, unknown>;
    const currentTarget = updatedNodes.find((node) => node.id === connection.target) ?? tgtNode;
    const tgtData = currentTarget.data as Record<string, unknown>;
    const srcUrl = (srcData.generatedImageUrl || srcData.referenceImage) as string | undefined;
    const srcRef = srcData.workshopRef as { kind?: string } | undefined;
    const isColorPalette = srcRef?.kind === 'colorPalette';

    if (srcUrl) {
      const existingRefs = (tgtData.referenceImages as { url: string; name?: string }[]) || [];
      if (!existingRefs.some((ref) => ref.url === srcUrl)) {
        const desc = (srcData.description as string) || '';
        updatedNodes = updatedNodes.map((node) =>
          node.id === connection.target
            ? {
              ...node,
              data: {
                ...node.data,
                referenceImages: [...existingRefs, { url: srcUrl, name: desc.slice(0, 20) || '参考图' }],
              },
            }
            : node,
        );
      }
    }

    if (srcUrl && !isColorPalette) {
      updatedNodes = updatedNodes.map((node) =>
        node.id === connection.target
          ? { ...node, data: { ...node.data, imageUrl: srcUrl } }
          : node,
      );
    }

    if (srcNode.type === 'video') {
      const srcVideo = (srcData.localPath || srcData.generatedVideoUrl) as string | undefined;
      if (srcVideo) {
        const latestTarget = updatedNodes.find((node) => node.id === connection.target) ?? tgtNode;
        const latestData = latestTarget.data as Record<string, unknown>;
        const existing = (latestData.referenceVideos as { url: string; name?: string }[]) || [];
        if (!existing.some((ref) => ref.url === srcVideo)) {
          updatedNodes = updatedNodes.map((node) =>
            node.id === connection.target
              ? {
                ...node,
                data: {
                  ...node.data,
                  referenceVideos: [
                    ...existing,
                    {
                      url: srcVideo,
                      name: (srcData.description as string)?.slice(0, 20) || '参考视频',
                    },
                  ],
                },
              }
              : node,
          );
        }
      }
    }
  }

  return { nodes: updatedNodes, edges: nextEdges };
}

export const useCanvasStore = create<CanvasState>()(
  persist(
    (set, get) => ({
      nodes: [],
      edges: [],
      selectedNodeId: null,
      pendingAgentAction: null,

      setNodes: (nodes) => set({ nodes }),
      setEdges: (edges) => set({ edges }),

      addNode: (node) => set((s) => ({ nodes: [...s.nodes, node] })),
      addNodesAndConnect: (nodes, connections) =>
        set((state) => {
          let nextNodes = [...state.nodes, ...nodes];
          let nextEdges = state.edges;
          for (const connection of connections) {
            const next = applyCanvasConnection(nextNodes, nextEdges, connection);
            nextNodes = next.nodes;
            nextEdges = next.edges;
          }
          return { nodes: nextNodes, edges: nextEdges };
        }),

      updateNode: (id, data) =>
        set((s) => {
          let changed = false;
          const nodes = s.nodes.map((n) => {
            if (n.id !== id) return n;
            const oldData = n.data as Record<string, unknown>;
            const patchKeys = Object.keys(data);
            if (patchKeys.length === 0 || patchKeys.every((key) => Object.is(oldData[key], data[key]))) {
              return n;
            }
            changed = true;
            const merged = { ...oldData, ...data };
            // Auto-maintain generationHistory for image/video nodes
            if (data.generatedImageUrl && data.generatedImageUrl !== oldData.generatedImageUrl && oldData.generatedImageUrl) {
              const history = (Array.isArray(oldData.generationHistory) ? [...oldData.generationHistory] : []) as { url: string; timestamp: number }[];
              // 把当前显示的图存入历史（如果还没在里面）
              if (!history.some(h => h.url === oldData.generatedImageUrl)) {
                history.push({ url: oldData.generatedImageUrl as string, timestamp: Date.now() });
              }
              if (history.length > 10) history.shift();
              merged.generationHistory = history;
            }
            if (data.generatedVideoUrl && data.generatedVideoUrl !== oldData.generatedVideoUrl && oldData.generatedVideoUrl) {
              const history = (Array.isArray(oldData.generationHistory) ? [...oldData.generationHistory] : []) as { url: string; timestamp: number }[];
              if (!history.some(h => h.url === oldData.generatedVideoUrl)) {
                history.push({ url: oldData.generatedVideoUrl as string, timestamp: Date.now() });
              }
              if (history.length > 10) history.shift();
              merged.generationHistory = history;
            }
            return { ...n, data: merged };
          });
          return changed ? { nodes } : s;
        }),

      updateNodeStyle: (id, style) =>
        set((s) => {
          let changed = false;
          const nodes = s.nodes.map((n) => {
            if (n.id !== id) return n;
            const current = n.style ?? {};
            if (Object.keys(style).every((key) => Object.is(
              (current as Record<string, unknown>)[key],
              (style as Record<string, unknown>)[key],
            ))) return n;
            changed = true;
            return { ...n, style: { ...current, ...style } };
          });
          return changed ? { nodes } : s;
        }),

      deleteNode: (id) =>
        set((s) => {
          const deletedNode = s.nodes.find((n) => n.id === id);
          const localRefIds = new Set(
            s.nodes
              .filter((n) => {
                const d = n.data as Record<string, unknown> | undefined;
                return d?.workshopPromptRefTarget === id;
              })
              .map((n) => n.id),
          );
          const deletedIds = new Set([id, ...localRefIds]);
          const relatedEdges = s.edges.filter((e) => deletedIds.has(e.source) || deletedIds.has(e.target));
          // Clean referenceImages on target nodes when source is deleted
          let updatedNodes = s.nodes;
          if (deletedNode) {
            const srcData = deletedNode.data as Record<string, unknown>;
            const srcUrl = (srcData.generatedImageUrl || srcData.referenceImage) as string | undefined;
            if (srcUrl) {
              for (const edge of relatedEdges) {
                if (edge.source !== id) continue;
                updatedNodes = updatedNodes.map((n) => {
                  if (n.id !== edge.target) return n;
                  const d = n.data as Record<string, unknown>;
                  const refs = d.referenceImages as { url: string; name?: string }[] | undefined;
                  if (!refs || refs.length === 0) return n;
                  return { ...n, data: { ...d, referenceImages: refs.filter((r) => r.url !== srcUrl) } };
                });
              }
            }
          }
          // video source deleted → clean referenceVideos on video targets
          if (deletedNode?.type === 'video') {
            const srcData2 = deletedNode.data as Record<string, unknown>;
            const srcVideo = (srcData2.localPath || srcData2.generatedVideoUrl) as string | undefined;
            if (srcVideo) {
              for (const edge of relatedEdges) {
                if (edge.source !== id) continue;
                updatedNodes = updatedNodes.map((n) => {
                  if (n.id !== edge.target) return n;
                  const dd = n.data as Record<string, unknown>;
                  const refs = dd.referenceVideos as { url: string }[] | undefined;
                  if (!refs?.length) return n;
                  return { ...n, data: { ...dd, referenceVideos: refs.filter((r) => r.url !== srcVideo) } };
                });
              }
            }
          }
          // Deleting a group node: re-anchor children to absolute coords and
          // detach parentNode — a dangling parentNode reference crashes
          // reactflow's parent resolution (white-screen).
          if (deletedNode?.type === 'group') {
            const gp = deletedNode.position;
            updatedNodes = updatedNodes.map((n) =>
              n.parentNode === id
                ? { ...n, parentNode: undefined, position: { x: n.position.x + gp.x, y: n.position.y + gp.y } }
                : n,
            );
          }
          return {
            nodes: updatedNodes.filter((n) => !deletedIds.has(n.id)),
            edges: s.edges.filter((e) => !deletedIds.has(e.source) && !deletedIds.has(e.target)),
          };
        }),

      deleteEdge: (edgeId) => {
        const { edges, nodes } = get();
        const edge = edges.find(e => e.id === edgeId);
        if (!edge) return;
        // Remove reference images from target node that came from source node
        const sourceNode = nodes.find(n => n.id === edge.source);
        const targetNode = nodes.find(n => n.id === edge.target);
        // video → video: drop the referenceVideos entry symmetric to onConnect
        if (sourceNode?.type === 'video' && targetNode?.type === 'video') {
          const srcData = sourceNode.data as Record<string, unknown>;
          const srcVideo = (srcData.localPath || srcData.generatedVideoUrl) as string | undefined;
          const tgtData = targetNode.data as Record<string, unknown>;
          const refs = tgtData.referenceVideos as { url: string }[] | undefined;
          if (srcVideo && refs?.some((r) => r.url === srcVideo)) {
            set((s) => ({
              edges: s.edges.filter(e => e.id !== edgeId),
              nodes: s.nodes.map(n => n.id === edge.target
                ? { ...n, data: { ...n.data, referenceVideos: refs.filter((r) => r.url !== srcVideo) } }
                : n),
            }));
            return;
          }
        }
        if (sourceNode && targetNode) {
          const srcData = sourceNode.data as Record<string, unknown>;
          const srcUrl = (srcData.generatedImageUrl || srcData.referenceImage) as string | undefined;
          if (srcUrl) {
            const tgtData = targetNode.data as Record<string, unknown>;
            const refs = tgtData.referenceImages as { url: string; name?: string }[] | undefined;
            if (refs && refs.length > 0) {
              const filtered = refs.filter(r => r.url !== srcUrl);
              set((s) => ({
                edges: s.edges.filter(e => e.id !== edgeId),
                nodes: s.nodes.map(n => n.id === edge.target ? { ...n, data: { ...n.data, referenceImages: filtered } } : n),
              }));
              return;
            }
          }
        }
        set((s) => ({ edges: s.edges.filter(e => e.id !== edgeId) }));
      },

      onNodesChange: (changes) =>
        set({ nodes: applyNodeChanges(changes, get().nodes) }),

      onEdgesChange: (changes) => {
        // When edges are removed, clean up referenceImages and referenceVideos on target nodes
        const removedEdgeIds = changes.filter(c => c.type === 'remove').map(c => c.id);
        if (removedEdgeIds.length > 0) {
          const { edges, nodes } = get();
          let updatedNodes = nodes;
          for (const eid of removedEdgeIds) {
            const edge = edges.find(e => e.id === eid);
            if (!edge) continue;
            const sourceNode = nodes.find(n => n.id === edge.source);
            if (!sourceNode) continue;
            const srcData = sourceNode.data as Record<string, unknown>;
            // video → video: clean referenceVideos
            if (sourceNode.type === 'video') {
              const srcVideo = (srcData.localPath || srcData.generatedVideoUrl) as string | undefined;
              if (srcVideo) {
                updatedNodes = updatedNodes.map(n => {
                  if (n.id !== edge.target) return n;
                  const d = n.data as Record<string, unknown>;
                  const refs = d.referenceVideos as { url: string }[] | undefined;
                  if (!refs?.length) return n;
                  return { ...n, data: { ...d, referenceVideos: refs.filter(r => r.url !== srcVideo) } };
                });
              }
            }
            // image source: clean referenceImages on target
            const srcUrl = (srcData.generatedImageUrl || srcData.referenceImage) as string | undefined;
            if (!srcUrl) continue;
            updatedNodes = updatedNodes.map(n => {
              if (n.id !== edge.target) return n;
              const d = n.data as Record<string, unknown>;
              const refs = d.referenceImages as { url: string; name?: string }[] | undefined;
              if (!refs || refs.length === 0) return n;
              return { ...n, data: { ...d, referenceImages: refs.filter(r => r.url !== srcUrl) } };
            });
          }
          set({ edges: applyEdgeChanges(changes, edges), nodes: updatedNodes });
        } else {
          set({ edges: applyEdgeChanges(changes, get().edges) });
        }
      },

      onConnect: (connection) =>
        set((state) => applyCanvasConnection(state.nodes, state.edges, connection)),

      setSelectedNodeId: (id) => set({ selectedNodeId: id }),

      triggerAgentAction: (action, nodeId, prompt, nodeIds) => set({
        pendingAgentAction: { action, nodeId, prompt, nodeIds },
      }),
      clearPendingAction: () => set({ pendingAgentAction: null }),

      getSnapshot: () => {
        const { nodes, edges } = get();
        return {
          nodes: nodes.map((n) => ({
            id: n.id,
            type: n.type || 'text',
            position: n.position,
            width: n.width ?? (typeof (n.style as Record<string, unknown> | undefined)?.width === 'number' ? (n.style as Record<string, unknown>).width as number : undefined),
            height: n.height ?? (typeof (n.style as Record<string, unknown> | undefined)?.height === 'number' ? (n.style as Record<string, unknown>).height as number : undefined),
            parentNode: n.parentNode,
            data: n.data as Record<string, unknown>,
          })),
          edges: edges.map((e) => ({
            id: e.id,
            source: e.source,
            target: e.target,
          })),
        };
      },
    }),
    {
      name: 'kunpeng-canvas',
      storage: createDebouncedStorage<Pick<CanvasState, 'nodes' | 'edges'>>(),
      partialize: (state) => ({
        nodes: stripTransientNodeFields(state.nodes),
        edges: state.edges,
      }),
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        // Repair persisted corruption synchronously BEFORE first render —
        // orphan parentNode refs / group ordering hard-crash reactflow.
        state.nodes = repairNodeIntegrity(state.nodes);
        // Async migration sweep: persist residual data-URL images (from
        // older builds) to disk and reset stale isGenerating flags.
        migrateNodeImages(state.nodes)
          .then(({ nodes, changed }) => {
            if (changed) useCanvasStore.setState({ nodes });
          })
          .catch((err) => console.warn('[canvasStore] image migration skipped', err));
      },
    },
  ),
);
