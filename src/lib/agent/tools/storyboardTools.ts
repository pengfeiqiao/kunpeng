import type { Tool } from '../types';
import { useCanvasStore } from '@/stores/canvasStore';
import {
  composeCanvasSelectionToStoryboardBoard,
  listStoryboardFrameTargets,
  listStoryboardShotTargets,
  sendStoryboardFrameToCanvas,
  writeCanvasImageToStoryboardFrame,
} from '@/lib/workshop/storyboardBridge';
import type { WorkshopRef } from '@/lib/workshop/canvasSync';

function json(value: unknown) {
  return JSON.stringify(value, null, 2);
}

const listTargetsTool: Tool = {
  definition: {
    name: 'storyboard_list_targets',
    description: '列出当前工坊项目中可回传的稳定镜头和故事板格子。跨画布回传前先调用；不要只凭可变镜号猜目标。',
    parameters: {
      type: 'object',
      properties: {
        shot_id: { type: 'string', description: '可选。只返回指定稳定 shotId（也兼容镜号）。' },
        include_prompts: { type: 'boolean', description: '是否返回完整格子提示词，默认 false。' },
      },
    },
  },
  risk: 'safe',
  async execute(params) {
    const shotFilter = String(params.shot_id ?? '').trim();
    const shots = listStoryboardShotTargets().filter((shot) =>
      !shotFilter || shot.shotId === shotFilter || shot.shotNo === shotFilter,
    );
    const shotIds = new Set(shots.map((shot) => shot.shotId));
    const frames = listStoryboardFrameTargets()
      .filter((frame) => shotIds.has(frame.shotId))
      .map((frame) => params.include_prompts === true ? frame : { ...frame, prompt: frame.prompt.slice(0, 80) });
    return {
      success: true,
      output: json({
        projectOpen: shots.length > 0 || listStoryboardShotTargets().length > 0,
        shots,
        frames,
        identityRule: '已有故事板时写回使用 shotId + frameId；零格故事板可只用 shotId 新建第1格。shotNo/frameIndex 仅供人阅读。',
      }),
    };
  },
};

const getFrameTool: Tool = {
  definition: {
    name: 'storyboard_get_frame',
    description: '读取一个故事板格子的当前图片、提示词和 revision。修改或回传前用它做冲突检查。',
    parameters: {
      type: 'object',
      properties: {
        frame_id: { type: 'string', description: '稳定 frameId。' },
      },
      required: ['frame_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const frameId = String(params.frame_id ?? '');
    const target = listStoryboardFrameTargets().find((frame) => frame.frameId === frameId);
    return target
      ? { success: true, output: json(target) }
      : { success: false, output: '', error: `故事板格子 ${frameId} 不存在` };
  },
};

const sendFrameTool: Tool = {
  definition: {
    name: 'storyboard_send_to_canvas',
    description: '把单张故事板格子的图片和提示词送到画布，并写入可精确回传的来源元数据。重复调用会更新原节点，不会堆副本。',
    parameters: {
      type: 'object',
      properties: {
        shot_id: { type: 'string', description: '稳定 shotId；兼容镜号。' },
        frame_id: { type: 'string', description: '稳定 frameId。' },
        validate_only: { type: 'boolean', description: '只检查目标，不修改画布。' },
      },
      required: ['shot_id', 'frame_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const shotId = String(params.shot_id ?? '');
    const frameId = String(params.frame_id ?? '');
    const target = listStoryboardFrameTargets().find((frame) =>
      frame.frameId === frameId && (frame.shotId === shotId || frame.shotNo === shotId),
    );
    if (!target) return { success: false, output: '', error: '目标 shotId + frameId 不匹配，请重新调用 storyboard_list_targets' };
    if (params.validate_only === true) return { success: true, output: json({ valid: true, target }) };
    try {
      return { success: true, output: json(await sendStoryboardFrameToCanvas(shotId, frameId)) };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const selectionTool: Tool = {
  definition: {
    name: 'canvas_get_selection',
    description: '读取画布当前选中节点，返回节点类型、本地文件和故事板来源。拼板或回传前先确认选择。',
    parameters: { type: 'object', properties: {} },
  },
  risk: 'safe',
  async execute() {
    const selected = useCanvasStore.getState().nodes.filter((node) => node.selected).map((node) => {
      const data = node.data as Record<string, unknown>;
      return {
        id: node.id,
        type: node.type,
        localPath: data.localPath,
        description: data.description,
        workshopRef: data.workshopRef as WorkshopRef | undefined,
      };
    });
    return { success: true, output: json({ count: selected.length, nodes: selected }) };
  },
};

const previewWritebackTool: Tool = {
  definition: {
    name: 'storyboard_preview_writeback',
    description: '预检画布图片回传，不写数据。目标镜头没有故事板时可不传 frame_id，预览会明确标记将新建第 1 格；已有格子时仍必须精确指定 frame_id。',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string' },
        shot_id: { type: 'string' },
        frame_id: { type: 'string', description: '目标已有故事板时必填；目标为零格故事板时省略表示新建第 1 格。' },
        expected_revision: { type: 'number' },
        set_current: { type: 'boolean', description: '默认 true；false 只加入候选版本。' },
        sync_prompt: { type: 'boolean', description: '默认 false，避免覆盖工坊原提示词。' },
      },
      required: ['node_id', 'shot_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const node = useCanvasStore.getState().nodes.find((item) => item.id === params.node_id);
    const shot = listStoryboardShotTargets().find((item) =>
      item.shotId === params.shot_id || item.shotNo === params.shot_id,
    );
    const frameId = String(params.frame_id ?? '').trim();
    const target = frameId
      ? listStoryboardFrameTargets().find((frame) =>
          frame.frameId === frameId && (frame.shotId === params.shot_id || frame.shotNo === params.shot_id))
      : undefined;
    if (!node || node.type !== 'image') return { success: false, output: '', error: 'node_id 不是可回传的图片节点' };
    if (!shot) return { success: false, output: '', error: '目标镜头不存在' };
    if (frameId && !target) return { success: false, output: '', error: '目标 frame_id 不存在或不属于该镜头' };
    if (!frameId && shot.frameCount > 0) return { success: false, output: '', error: '该镜已有故事板，必须精确指定 frame_id' };
    const expected = params.expected_revision === undefined ? target?.revision : Number(params.expected_revision);
    return {
      success: true,
      output: json({
        valid: !target || expected === target.revision,
        conflict: Boolean(target && expected !== target.revision),
        source: { nodeId: node.id, localPath: (node.data as Record<string, unknown>).localPath },
        target: target ?? { shotId: shot.shotId, shotNo: shot.shotNo, createFrameIndex: 0 },
        action: {
          appendVersion: true,
          createFrame: !target,
          setCurrent: !target || params.set_current !== false,
          syncPrompt: params.sync_prompt === true,
          destructiveOverwrite: false,
        },
      }),
    };
  },
};

const writebackTool: Tool = {
  definition: {
    name: 'storyboard_writeback_frame',
    description: '确认后把画布图片回传到指定故事板格。目标镜头为零格故事板时可省略 frame_id，自动新建第 1 格；已有格子时必须指定 frame_id。使用稳定 client_token 防止重复写入。',
    parameters: {
      type: 'object',
      properties: {
        node_id: { type: 'string' },
        shot_id: { type: 'string' },
        frame_id: { type: 'string', description: '已有故事板时必填；零格故事板时省略。' },
        expected_revision: { type: 'number', description: '已有格子时必填；新建首格时省略。' },
        client_token: { type: 'string', description: '调用方稳定幂等键；重试必须复用同一个值。' },
        set_current: { type: 'boolean' },
        sync_prompt: { type: 'boolean' },
      },
      required: ['node_id', 'shot_id', 'client_token'],
    },
  },
  risk: 'ask',
  async execute(params) {
    try {
      const result = await writeCanvasImageToStoryboardFrame({
        nodeId: String(params.node_id),
        shotId: String(params.shot_id),
        frameId: params.frame_id === undefined ? undefined : String(params.frame_id),
        expectedRevision: params.expected_revision === undefined ? undefined : Number(params.expected_revision),
        clientToken: String(params.client_token),
        setCurrent: params.set_current !== false,
        syncPrompt: params.sync_prompt === true,
      });
      return { success: true, output: json(result) };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

const previewBoardTool: Tool = {
  definition: {
    name: 'canvas_preview_storyboard_board',
    description: '预检画布多选拼板。检查 2-9 张本地图片、顺序、自动布局和目标镜头，不生成文件。',
    parameters: {
      type: 'object',
      properties: {
        node_ids: { type: 'array', items: { type: 'string' } },
        shot_id: { type: 'string' },
        fit: { type: 'string', enum: ['contain', 'cover'] },
      },
      required: ['node_ids', 'shot_id'],
    },
  },
  risk: 'safe',
  async execute(params) {
    const ids = Array.isArray(params.node_ids) ? params.node_ids.map(String) : [];
    const nodes = ids.map((id) => useCanvasStore.getState().nodes.find((node) => node.id === id));
    const target = listStoryboardShotTargets().find((shot) => shot.shotId === params.shot_id || shot.shotNo === params.shot_id);
    const errors: string[] = [];
    if (ids.length < 2 || ids.length > 9) errors.push('一次需选择 2-9 张图片');
    if (nodes.some((node) => !node || node.type !== 'image')) errors.push('选择中包含不存在或非图片节点');
    if (nodes.some((node) => !(node!.data as Record<string, unknown>).localPath)) errors.push('有图片尚未落成本地文件');
    if (!target) errors.push('目标镜头不存在');
    return {
      success: errors.length === 0,
      output: json({
        valid: errors.length === 0,
        errors,
        order: ids,
        target,
        fit: params.fit === 'cover' ? 'cover' : 'contain',
        effect: '生成一块分镜板、连接来源节点、回传目标镜头、设为视频参考、自动重排 @图片N',
      }),
      ...(errors.length ? { error: errors.join('；') } : {}),
    };
  },
};

const composeBoardTool: Tool = {
  definition: {
    name: 'canvas_compose_storyboard_board',
    description: '经用户确认后，将 2-9 个画布图片节点按给定顺序拼成完整分镜板并回传目标镜头。默认完整显示不裁切，自动加入视频参考并重排 @图片N。',
    parameters: {
      type: 'object',
      properties: {
        node_ids: { type: 'array', items: { type: 'string' } },
        shot_id: { type: 'string' },
        fit: { type: 'string', enum: ['contain', 'cover'] },
        client_token: { type: 'string', description: '稳定幂等键，重试复用。' },
      },
      required: ['node_ids', 'shot_id', 'client_token'],
    },
  },
  risk: 'ask',
  async execute(params) {
    try {
      const nodeIds = Array.isArray(params.node_ids) ? params.node_ids.map(String) : [];
      const result = await composeCanvasSelectionToStoryboardBoard({
        nodeIds,
        shotId: String(params.shot_id),
        fit: params.fit === 'cover' ? 'cover' : 'contain',
        clientToken: String(params.client_token),
        useInVideo: true,
      });
      return { success: true, output: json(result) };
    } catch (err) {
      return { success: false, output: '', error: err instanceof Error ? err.message : String(err) };
    }
  },
};

export const allStoryboardTools: Tool[] = [
  listTargetsTool,
  getFrameTool,
  sendFrameTool,
  selectionTool,
  previewWritebackTool,
  writebackTool,
  previewBoardTool,
  composeBoardTool,
];
