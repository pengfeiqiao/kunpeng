/**
 * imageTools — one-click AI image operations for canvas nodes.
 * 扩图/重绘/擦除/抠图 = instruction-based editing via gpt-image-2 i2i
 * (生图 API 槽位通道；RunningHub 海外节点 2026-08 下线后 Topaz 放大已移除)。
 * Every tool derives a NEW node (version-tree semantics, never overwrites).
 */
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { captureSnapshot } from '@/lib/canvas/history';
import { generateForNode } from '@/lib/canvasGen';
import { defaultNodeStyle } from '@/lib/canvas/layout';

export interface ImageToolDef {
  id: string;
  label: string;
  /** Editable instruction prefilled into the derived node. */
  instruction?: string;
  engineId: 'gpt-image-2';
  autoRun: boolean;
}

export const IMAGE_TOOLS: ImageToolDef[] = [
  {
    id: 'expand', label: '智能扩图', engineId: 'gpt-image-2', autoRun: false,
    instruction: '将画面向四周智能扩展约 50%，新区域与原图风格、光线、纹理无缝衔接，原图内容保持完全不变。',
  },
  {
    id: 'inpaint', label: '局部重绘', engineId: 'gpt-image-2', autoRun: false,
    instruction: '将画面中的【描述要改的部分】替换为【描述新内容】，其余区域保持与原图完全一致。',
  },
  {
    id: 'erase', label: '擦除物体', engineId: 'gpt-image-2', autoRun: false,
    instruction: '移除画面中的【描述要移除的物体】，用与周围环境一致的背景自然填补，其余内容保持完全不变。',
  },
  {
    id: 'matting', label: '抠图去底', engineId: 'gpt-image-2', autoRun: true,
    instruction: '精确抠出画面主体，背景替换为纯白色，主体边缘干净自然，保留毛发等细节。',
  },
];

/**
 * Apply a tool to a source image node: spawn a derived node to the right
 * (connected), and either auto-run or leave the instruction for editing.
 */
export async function applyImageTool(sourceNodeId: string, tool: ImageToolDef): Promise<void> {
  const store = useCanvasStore.getState();
  const src = store.nodes.find((n) => n.id === sourceNodeId);
  if (!src) return;
  const d = src.data as Record<string, unknown>;
  const srcUrl = (d.generatedImageUrl || d.referenceImage) as string | undefined;
  if (!srcUrl) return;

  captureSnapshot();
  const newId = `node-${nanoid(8)}`;
  store.addNode({
    id: newId,
    type: 'image',
    position: { x: src.position.x + (src.width ?? 200) + 60, y: src.position.y },
    style: defaultNodeStyle('image'),
    data: {
      description: tool.instruction ?? `${tool.label}`,
      generationMode: 'image-to-image',
      referenceImages: [{ url: srcUrl, name: tool.label }],
      imageModel: 'gpt-image-2',
    },
  });
  store.onConnect({ source: sourceNodeId, target: newId, sourceHandle: null, targetHandle: null });
  store.setSelectedNodeId(newId);

  if (tool.autoRun) {
    await generateForNode({
      nodeId: newId,
      engineId: tool.engineId,
      prompt: tool.instruction ?? 'upscale',
      referenceUrls: [srcUrl],
    });
  }
  // !autoRun: 用户在底部 Composer 里补完【】占位再点生成
}
