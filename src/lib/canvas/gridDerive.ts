/**
 * gridDerive — one-click story-derivation grids (LibTV "/" 功能逆向).
 * Pattern: spawn target node → connect → generateForNode (gpt-image-2,
 * grid prompt, source as @图片1) → on success splitAll() explodes the grid
 * into labeled child nodes.
 */
import { nanoid } from 'nanoid';
import { useCanvasStore } from '@/stores/canvasStore';
import { captureSnapshot } from '@/lib/canvas/history';
import { generateForNode } from '@/lib/canvasGen';
import { splitAll, type GridSize } from './imageSplit';
import { defaultNodeStyle } from '@/lib/canvas/layout';

const GRID_QUALITY_SUFFIX =
  '宫格之间格线干净、严格等分、无边框留白、无文字标注、无序号，所有格子保持同一画风、同一色调、同一光线方向。';

function sourceImageOf(nodeId: string): string | undefined {
  const n = useCanvasStore.getState().nodes.find((x) => x.id === nodeId);
  const d = n?.data as Record<string, unknown> | undefined;
  return (d?.generatedImageUrl || d?.referenceImage) as string | undefined;
}

/** Spawn the grid container node next to the source and connect it. */
function spawnGridNode(sourceNodeId: string, description: string): string | null {
  const store = useCanvasStore.getState();
  const src = store.nodes.find((n) => n.id === sourceNodeId);
  if (!src) return null;
  captureSnapshot();
  const id = `node-${nanoid(8)}`;
  store.addNode({
    id,
    type: 'image',
    position: { x: src.position.x + (src.width ?? 200) + 60, y: src.position.y },
    style: defaultNodeStyle('image'),
    data: { description, generationMode: 'image-to-image' },
  });
  store.onConnect({ source: sourceNodeId, target: id, sourceHandle: null, targetHandle: null });
  store.setSelectedNodeId(id);
  return id;
}

async function runGridDerive(
  sourceNodeId: string,
  prompt: string,
  grid: GridSize,
  labels: string[] | undefined,
  connectChildrenTo?: string,
): Promise<void> {
  const srcUrl = sourceImageOf(sourceNodeId);
  if (!srcUrl) {
    alert('该节点还没有图片，请先生成或上传图片');
    return;
  }
  const gridNodeId = spawnGridNode(sourceNodeId, prompt);
  if (!gridNodeId) return;

  const result = await generateForNode({
    nodeId: gridNodeId,
    engineId: 'gpt-image-2', // MJ 返回 4 张变体，不适合宫格 —— 锁定 GPT
    prompt,
    referenceUrls: [srcUrl],
    params: { aspectRatio: '1:1', resolution: '2k' },
    overwrite: true,
  });
  if (!result.success) {
    alert('宫格生成失败: ' + (result.error || '未知错误'));
    return;
  }
  const gridUrl = result.primaryUrl;
  if (!gridUrl) return;
  await splitAll(gridNodeId, gridUrl, grid, {
    labels,
    connectTo: connectChildrenTo ?? gridNodeId,
    namePrefix: 'derive',
  });
}

/** 剧情推演四宫格（时间线）：前5s / 前3s / 后3s / 后5s。 */
export async function deriveStoryGrid4(sourceNodeId: string): Promise<void> {
  const prompt =
    `基于 @图片1 生成一张 2x2 四宫格图，四个格子按顺序分别是该画面时刻的剧情推演：`
    + `左上=前5秒的画面，右上=前3秒的画面，左下=后3秒的画面，右下=后5秒的画面。`
    + `场景、人物、服装、光线与 @图片1 完全一致，仅剧情动作随时间自然推进。${GRID_QUALITY_SUFFIX}`;
  await runGridDerive(sourceNodeId, prompt, 2, ['前5秒', '前3秒', '后3秒', '后5秒']);
}

/** 剧情分支四宫格（分支树）：4 种不同剧情走向，子节点连回源节点。 */
export async function deriveBranchGrid4(sourceNodeId: string): Promise<void> {
  const prompt =
    `基于 @图片1 推演 4 种截然不同的剧情走向，生成一张 2x2 四宫格图：`
    + `左上=冲突升级的走向，右上=和解温情的走向，左下=意外转折的走向，右下=悬念留白的走向。`
    + `每格是一条独立故事线的下一个关键画面，场景人物画风与 @图片1 保持一致。${GRID_QUALITY_SUFFIX}`;
  // 分支语义：子节点直接连回"源"节点，形成从原图发散的分支树
  await runGridDerive(
    sourceNodeId, prompt, 2,
    ['分支A·冲突升级', '分支B·和解', '分支C·意外转折', '分支D·留白'],
    sourceNodeId,
  );
}

/** 多机位九宫格：9 个固定机位调度。 */
export async function multiCam9(sourceNodeId: string): Promise<void> {
  const prompt =
    `基于 @图片1 的场景生成一张 3x3 九宫格图，9 个格子是同一场景同一时刻的 9 个不同机位与景别：`
    + `大远景、远景、全景、中全景、中景、中近景、近景、特写、大特写（按行排列）。`
    + `场景、人物、光线与 @图片1 完全一致，仅机位与景别变化。${GRID_QUALITY_SUFFIX}`;
  await runGridDerive(
    sourceNodeId, prompt, 3,
    ['大远景', '远景', '全景', '中全景', '中景', '中近景', '近景', '特写', '大特写'],
  );
}

/** 25 宫格连贯分镜：自动拆解完整剧情段落。 */
export async function storyboard25(sourceNodeId: string): Promise<void> {
  const prompt =
    `基于 @图片1 生成一张 5x5 二十五宫格连贯分镜图：以该画面为故事中心，按时间顺序展开一个完整剧情段落，`
    + `从建立镜头开始到收尾镜头结束，景别有节奏变化（远景→中景→特写交替），剧情连贯一气呵成。`
    + `所有格子画风、色调、人物完全一致。${GRID_QUALITY_SUFFIX}`;
  await runGridDerive(sourceNodeId, prompt, 5, undefined);
}

/** 单图推演：生成"N 秒前/后"的单张画面（衍生新节点）。 */
export async function deriveSingle(sourceNodeId: string, direction: 'before' | 'after', seconds: 3 | 5): Promise<void> {
  const srcUrl = sourceImageOf(sourceNodeId);
  if (!srcUrl) {
    alert('该节点还没有图片，请先生成或上传图片');
    return;
  }
  const dirText = direction === 'before' ? `${seconds} 秒之前` : `${seconds} 秒之后`;
  const verb = direction === 'before' ? '回溯剧情' : '推进剧情动作';
  const prompt = `基于 @图片1 推演 ${dirText}的画面：保持场景、人物、光线完全一致，${verb}。`;
  const nodeId = spawnGridNode(sourceNodeId, prompt);
  if (!nodeId) return;
  await generateForNode({
    nodeId,
    engineId: 'gpt-image-2',
    prompt,
    referenceUrls: [srcUrl],
    overwrite: true,
  });
}
