import { useState, useCallback, useEffect, useRef } from 'react';
import { useCanvasStore } from '@/stores/canvasStore';
import { assetUrlToLocalPath } from '@/lib/rhtv/upload';
import type { ImageNodeData, VideoNodeData, AudioNodeData } from '@/types/canvas';

export interface MentionItem {
  nodeId: string;
  label: string;
  insertText: string;
  type: 'image' | 'video' | 'audio';
  url: string;
  /** 本地文件路径（音频/视频提交时需要，asset:// 已反解） */
  localPath?: string;
  thumbnailUrl?: string;
}

type CanvasNode = ReturnType<typeof useCanvasStore.getState>['nodes'][number];
type CanvasEdge = ReturnType<typeof useCanvasStore.getState>['edges'][number];

export function buildCanvasMentionItems(
  nodes: CanvasNode[],
  edges: CanvasEdge[],
  scopeNodeId?: string,
): MentionItem[] {
  const items: MentionItem[] = [];
  const seenUrls = new Set<string>();
  let imgN = 0;
  let vidN = 0;
  let audN = 0;

  const orderedNodes = scopeNodeId
    ? edges
        .filter((edge) => edge.target === scopeNodeId)
        .map((edge) => nodes.find((node) => node.id === edge.source))
        .filter((node): node is CanvasNode => Boolean(node))
    : nodes;

  for (const node of orderedNodes) {
    if (node.type === 'image') {
      const data = node.data as ImageNodeData;
      const url = data.generatedImageUrl || data.referenceImage;
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      imgN += 1;
      const desc = data.description ? ` (${data.description.slice(0, 20)})` : '';
      items.push({ nodeId: node.id, label: `图片${imgN}${desc}`, insertText: `@图片${imgN}`, type: 'image', url, thumbnailUrl: url });
    } else if (node.type === 'video') {
      const data = node.data as VideoNodeData;
      const url = data.generatedVideoUrl;
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      vidN += 1;
      const desc = data.description ? ` (${data.description.slice(0, 20)})` : '';
      items.push({ nodeId: node.id, label: `视频${vidN}${desc}`, insertText: `@视频${vidN}`, type: 'video', url });
    } else if (node.type === 'audio') {
      const data = node.data as AudioNodeData;
      const url = data.audioUrl;
      if (!url || seenUrls.has(url)) continue;
      seenUrls.add(url);
      audN += 1;
      const desc = data.description || data.fileName ? ` (${(data.description || data.fileName || '').slice(0, 20)})` : '';
      const localPath = data.localPath ? assetUrlToLocalPath(data.localPath) : assetUrlToLocalPath(url);
      items.push({ nodeId: node.id, label: `音频${audN}${desc}`, insertText: `@音频${audN}`, type: 'audio', url, localPath });
    }
  }

  return items;
}

/**
 * @param scopeNodeId  If provided, only show nodes connected to this node via edges (for InfoBar).
 *                     If undefined, show all canvas nodes with media (for chat bubble).
 */
export function useCanvasMention(scopeNodeId?: string) {
  const [mentionItems, setMentionItems] = useState<MentionItem[]>([]);
  const [showMention, setShowMention] = useState(false);
  const [mentionIdx, setMentionIdx] = useState(0);
  const [mentionPos, setMentionPos] = useState(0);
  const prevLenRef = useRef(0);

  const readMentionItems = useCallback(() => {
    const state = useCanvasStore.getState();
    return buildCanvasMentionItems(state.nodes, state.edges, scopeNodeId);
  }, [scopeNodeId]);

  useEffect(() => {
    setMentionItems([]);
    setShowMention(false);
  }, [scopeNodeId]);

  const handleInputChange = useCallback((value: string, cursorPos: number) => {
    const prevLen = prevLenRef.current;
    prevLenRef.current = value.length;
    const justTyped = value.length === prevLen + 1;
    if (justTyped && value[cursorPos - 1] === '@') {
      const nextItems = readMentionItems();
      setMentionItems(nextItems);
      if (nextItems.length > 0) {
        setMentionPos(cursorPos - 1);
        setMentionIdx(0);
        setShowMention(true);
      }
    } else if (showMention) {
      if (cursorPos <= mentionPos || value[mentionPos] !== '@') {
        setShowMention(false);
      }
    }
  }, [mentionPos, readMentionItems, showMention]);

  const handleSelect = useCallback((item: MentionItem, currentText: string): string => {
    const before = currentText.slice(0, mentionPos);
    const after = currentText.slice(mentionPos + 1); // remove the '@'
    const newText = before + item.insertText + ' ' + after;
    setShowMention(false);
    return newText;
  }, [mentionPos]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent): boolean => {
    if (!showMention || mentionItems.length === 0) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setMentionIdx((i) => (i + 1) % mentionItems.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setMentionIdx((i) => (i - 1 + mentionItems.length) % mentionItems.length); return true; }
    if (e.key === 'Enter') { e.preventDefault(); return true; } // caller should call handleSelect
    if (e.key === 'Escape') { e.preventDefault(); setShowMention(false); return true; }
    return false;
  }, [showMention, mentionItems.length]);

  /** Extract all mentioned node URLs from text */
  const extractMentionedUrls = useCallback((text: string): { imageUrls: string[]; videoUrls: string[]; audioUrls: string[] } => {
    const imageUrls: string[] = [];
    const videoUrls: string[] = [];
    const audioUrls: string[] = [];
    for (const item of readMentionItems()) {
      // Boundary-aware match: a plain includes('@图片1') also fires on
      // '@图片10' and pulls in the wrong image. Require the char after the
      // mention to be a non-digit (or end of string).
      const escaped = item.insertText.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(`${escaped}(?!\\d)`);
      if (re.test(text)) {
        if (item.type === 'image') imageUrls.push(item.url);
        else if (item.type === 'video') videoUrls.push(item.url);
        else audioUrls.push(item.localPath || item.url);
      }
    }
    return { imageUrls, videoUrls, audioUrls };
  }, [readMentionItems]);

  return {
    mentionItems,
    showMention,
    mentionIdx,
    handleInputChange,
    handleSelect,
    handleKeyDown,
    extractMentionedUrls,
    closeMention: () => setShowMention(false),
  };
}
