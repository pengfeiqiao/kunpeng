/**
 * canvas_generate — agent-facing entry to the SAME generation pipeline the
 * NodeInfoBar uses (lib/canvasGen). The agent no longer shells out to
 * runninghub.py for canvas work: queue, GPT image route switching, in-place
 * node progress and the task panel all come for free.
 *
 * The chat-view rhtv skill (bash + runninghub.py) stays untouched for the
 * 294-endpoint long tail (TTS/music/3D...).
 */
import type { Tool } from '../types';
import { generateForNode } from '@/lib/canvasGen';
import { PERFORMANCE_BRIEF } from '@/lib/videoPrompt/performance';
import { ALL_CANVAS_ENGINES, findCanvasEngine } from '@/lib/rhtv/canvasEngines';
import { useCanvasStore } from '@/stores/canvasStore';
import { useAssetLibraryStore } from '@/stores/assetLibraryStore';
import { collectNodeReferences, selfImageFallback, selfVideoFallback } from '@/lib/canvas/collectRefs';
import {
  OMNI_MG_ENGINE_ID,
  runMgTextFallbackForCanvasNode,
  runMgTextFallbackStandalone,
  runMgWithReferenceBoardsStandalone,
  runMinimaxH3MgForCanvasNode,
  runOmniForCanvasNode,
  runSeedanceMiniMgForCanvasNode,
} from '@/lib/omni/workflow';
import { loadMediaInput } from '@/lib/agent/mediaInput';
import type { MgMotionRecipe } from '@/lib/omni/styles';
import { mergeCanvasNodeGenerationParams } from '@/lib/canvas/generationParams';
import { DREAMINA_SEEDANCE_25_ENGINE_ID } from '@/lib/dreamina/video';

// UI short names are accepted as aliases and normalized before generation.
const ENGINE_IDS = [
  ...ALL_CANVAS_ENGINES.map((e) => e.id),
  OMNI_MG_ENGINE_ID,
  'minimax-h3',
  'seedance-2.5',
  DREAMINA_SEEDANCE_25_ENGINE_ID,
];

export const canvasGenerateTool: Tool = {
  definition: {
    name: 'canvas_generate',
    description:
      '在画布节点上执行 AI 生成。'
      + '图片引擎: gpt-image-2（自动区分文生图/图生图，由「设置 → 图片模型」中的 API 槽位路由）、seedream-v5-pro（必须是 Seedream 5.0 Pro，支持文生/图生、多参考图，走 DMX/即梦 CLI/RunningHub 智能路由；即梦未登录时会自动唤起 Agent 登录恢复）、midjourney-v81（统一走 APIMart，返回4张；可在 params.version 传 v8.2/v8.1/v7/v6.1/v5.2/v5.1/niji7/niji6）。'
      + '视频引擎: seedance-2.0（多模态，必须传参考图，提示词须遵守 ~/.kunpeng/aigc-memory/prompt-templates/seedance/README.md）、'
      + 'seedance-2.0-t2v（无参考图时用）、seedance-2.0-fast、'
      + 'seedance-2.5（多模态，别名 dreamina-seedance-2.5；默认走筷子丽帧通道，失败才降级即梦 CLI；支持图片≤30、视频≤10、音频≤10，总素材≤50，480p/720p，时长 4-30 秒；提交前应按官方 2.5 结构改写提示词，并严格按实际素材顺序使用 @图片N/@视频N/@音频N）、'
      + 'minimax-hailuo-h3（MiniMax H3 多模态，别名 minimax-h3；有无参考图均可，图≤9/视频≤3/音频≤3，固定 2K，时长 5-15 秒）。'
      + 'wan-3.0（万相 3.0 全能参考视频：图≤10/视频≤5/音频≤5，另支持 file_url 文档与 link_url 网页参考，两者互斥；480P/720P/1080P，时长 2-30 秒；默认筷子丽帧主渠道，失败自动容灾 RunningHub/APIMart）。'
      + 'Omni版MG动画: omni-mg-animation，适合用户明确要 MG 动画、图形类动效、App 展示动效；正常路线固定 10 秒 720p，参考视频最多 1 个。系统会先生成母版概念图和 2-4 张同风格关键帧并显示在画布，再连同用户原始图片/视频提交；@图片N/@视频一必须与节点显示顺序一致，原始人物/物品主体不得改变。'
      + 'Seedance 视频默认通过筷子丽帧（Kuaizi）API 通道生成，无需你额外处理——只要传 seedance 引擎 ID，后端自动路由到丽帧；用户在设置中开启 RHTV Seedance 开关后才走 RunningHub 通道。'
      + '生成是异步长任务（图 ~30s，视频可能 1-20min）。若工具返回超时但已有 taskId，后台仍会继续轮询；也可用 canvas_recover_task 主动从 API 取回迟到结果。',
    parameters: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: '目标画布节点 ID（image 或 video 节点）',
        },
        engine: {
          type: 'string',
          description: `引擎 ID。内置：${ENGINE_IDS.join('、')}；自定义模型插件用 custom-media:{插件id}（先 media_api_plugin list 查看）`,
        },
        prompt: {
          type: 'string',
          description: `生成提示词。prompt_template=universal 时按通用导演结构组织素材身份、空间站位、时间戳动作、单段机位和物理反馈，禁止补写剧本中不存在的人物、关系、事件或对白；legacy 时保留原有写法。@图片按 reference_urls 顺序用中文数字引用。Omni MG 仍使用其专属 MG 提示词规则，只做适度兼容。带参考视频时区分视频编辑（改动/续写源视频，params 传 videoEdit:true，输出比例/时长跟随源视频）与多模态参考（源视频只作参考）两种模式；提示词含编辑意图时先向用户确认模式再提交。${PERFORMANCE_BRIEF}`,
        },
        prompt_template: {
          type: 'string',
          enum: ['legacy', 'universal'],
          description: '视频提示词模板。省略时沿用节点设置或全局默认；legacy=原有模板，universal=通用导演模板。此字段只决定提示词组织方式，不改变模型、分镜板或导演约束卡资产。',
        },
        reference_urls: {
          type: 'array',
          items: { type: 'string' },
          description: '参考素材（本地路径 / asset:// URL / http URL），顺序即 @图片1~N 的编号顺序',
        },
        audio_urls: {
          type: 'array',
          items: { type: 'string' },
          description: '音频参考（本地路径或 URL，仅 Seedance 多模态支持，提示词中用 @音频一 的音色 引用，音频不占 @图片N 编号）',
        },
        video_urls: {
          type: 'array',
          items: { type: 'string' },
          description: '视频参考（本地路径或 URL，仅视频编辑/多模态视频支持，已有视频节点修改时可留空，系统会自动使用该节点当前视频）',
        },
        file_url: {
          type: 'string',
          description: '仅 wan-3.0：参考文档 URL（docx/pdf/md 等公网地址），与 link_url 互斥',
        },
        link_url: {
          type: 'string',
          description: '仅 wan-3.0：公开网页 URL（免登录），与 file_url 互斥',
        },
        params: {
          type: 'object',
          description: '引擎参数覆盖，如 {"aspectRatio":"16:9","resolution":"720p","duration":"8","ratio":"adaptive"}',
        },
        asset_ids: {
          type: 'array',
          items: { type: 'string' },
          description: '资产库资产 ID（主体图自动并入参考图首位，音色并入音频）。用 canvas_get_state 之外可让用户在资产库面板查看 ID',
        },
        style_id: {
          type: 'string',
          description: 'Omni MG 动画风格 ID，可留空使用默认应用展示风格',
        },
        accent_style_id: {
          type: 'string',
          description: 'Omni MG 点缀风格 ID，可留空。最多一个，只借用一种材质或转场特征',
        },
        mg_recipe: {
          type: 'object',
          description: 'Omni 效果配方，可选：density=balanced/rich/maximal，spatial=2d/2.5d/3d，rhythm=steady/narrative/punchy，relationship=around-subject/full-stage/replace-background，material=follow-style/glass/paper/soft-3d/graphic',
        },
        mg_reference_workflow: {
          type: 'boolean',
          description: 'Seedance Mini 是否按 MG 母版+派生参考帧工作流生成。MG 节点默认 true；普通视频默认 false',
        },
      },
      required: ['node_id', 'engine', 'prompt'],
    },
  },
  // Generation costs money — same confirm gate as other spend operations.
  risk: 'ask',
  concurrencyKey(params) {
    const nodeId = String(params.node_id ?? '').trim();
    return nodeId ? `canvas-node:${nodeId}` : undefined;
  },

  async execute(params) {
    const nodeId = params.node_id as string;
    const requestedEngine = params.engine as string;
    const engineId = requestedEngine === 'minimax-h3'
      ? 'minimax-hailuo-h3'
      : requestedEngine === 'seedance-2.5'
        ? DREAMINA_SEEDANCE_25_ENGINE_ID
        : requestedEngine;
    const prompt = params.prompt as string;
    const promptTemplate = params.prompt_template === 'universal' || params.prompt_template === 'legacy'
      ? params.prompt_template
      : undefined;
    const styleId = params.style_id as string | undefined;
    const accentStyleId = params.accent_style_id as string | undefined;
    const mgRecipe = params.mg_recipe as Record<string, unknown> | undefined;
    let referenceUrls = (params.reference_urls as string[] | undefined) ?? [];
    let audioUrls = (params.audio_urls as string[] | undefined) ?? [];
    let videoUrls = (params.video_urls as string[] | undefined) ?? [];
    // Resolve library assets: subject images prepend referenceUrls, voice prepends audio
    const assetIds = (params.asset_ids as string[] | undefined) ?? [];
    if (assetIds.length > 0) {
      const lib = useAssetLibraryStore.getState().assets;
      const picked = assetIds.map((id) => lib.find((a) => a.id === id)).filter(Boolean);
      const imgs = picked.flatMap((a) => a!.images);
      const auds = picked.map((a) => a!.audioPath).filter((x): x is string => Boolean(x));
      referenceUrls = [...imgs, ...referenceUrls];
      audioUrls = [...auds, ...audioUrls];
    }
    let overrides = (params.params as Record<string, string | number | boolean> | undefined) ?? {};

    const node = useCanvasStore.getState().nodes.find((n) => n.id === nodeId);
    if (!node) {
      return { success: false, output: '', error: `画布上不存在节点 "${nodeId}"，先用 canvas_get_state 查看或 canvas_add_node 创建` };
    }

    if (promptTemplate && node.type === 'video') {
      useCanvasStore.getState().updateNode(nodeId, {
        videoPromptTemplate: promptTemplate,
        description: prompt,
        ...(promptTemplate === 'universal'
          ? { universalVideoPrompt: prompt }
          : { legacyVideoPrompt: prompt }),
      });
    }

    if (engineId === OMNI_MG_ENGINE_ID) {
      if (node.type !== 'video') {
        return { success: false, output: '', error: 'Omni版MG动画必须生成到 video 节点。请先创建视频/MG动画节点。' };
      }
      const currentData = node.data as Record<string, unknown>;
      useCanvasStore.getState().updateNode(nodeId, {
        description: prompt,
        modelVersion: OMNI_MG_ENGINE_ID,
        mgStyleId: styleId || currentData.mgStyleId || 'app-premium-3d',
        mgAccentStyleId: accentStyleId ?? currentData.mgAccentStyleId,
        mgRecipe: mgRecipe ?? currentData.mgRecipe,
        duration: 10,
        resolution: '720p',
        isMgAnimationNode: true,
      });
      const result = await runOmniForCanvasNode(nodeId, styleId);
      if (!result.success) {
        return { success: false, output: '', error: result.error || 'Omni MG 动画生成失败' };
      }
      return {
        success: true,
        terminal: true,
        terminalMessage: `Omni版 MG 动画已生成并回填到画布节点 ${nodeId}。`,
        output: [
          'Omni版MG动画生成成功',
          `节点 ${nodeId} 已更新，主产物: ${result.resultPaths[0]}`,
          result.creditsCost ? `消耗积分: ${result.creditsCost}` : '',
        ].filter(Boolean).join('\n'),
      };
    }

    const currentData = node.data as Record<string, unknown>;
    const isSeedanceMini = engineId.includes('seedance-2.0-mini');
    const useMgReferenceWorkflow = isSeedanceMini && (
      params.mg_reference_workflow === true
      || currentData.isMgAnimationNode === true
      || currentData.mgGenerationEngine === 'seedance-mini'
    );
    const isMinimaxH3 = engineId === 'minimax-hailuo-h3';
    const useH3MgWorkflow = isMinimaxH3 && (
      params.mg_reference_workflow === true
      || currentData.isMgAnimationNode === true
      || currentData.mgGenerationEngine === 'minimax-h3'
    );
    if (useH3MgWorkflow) {
      if (node.type !== 'video') {
        return { success: false, output: '', error: 'MiniMax H3 MG 工作流必须使用 video / MG 动画节点' };
      }
      const duration = Math.min(15, Math.max(5, Number(overrides.duration ?? currentData.duration ?? 6)));
      useCanvasStore.getState().updateNode(nodeId, {
        description: prompt,
        modelVersion: 'minimax-hailuo-h3',
        mgStyleId: styleId || currentData.mgStyleId || 'app-premium-3d',
        mgAccentStyleId: accentStyleId ?? currentData.mgAccentStyleId,
        mgRecipe: mgRecipe ?? currentData.mgRecipe,
        mgGenerationEngine: 'minimax-h3',
        duration,
        resolution: '2K',
        isMgAnimationNode: true,
      });
      const result = await runMinimaxH3MgForCanvasNode(nodeId, {
        styleId: styleId || String(currentData.mgStyleId ?? ''),
        duration,
        aspectRatio: overrides.aspectRatio === '9:16' || overrides.ratio === '9:16' ? '9:16' : '16:9',
      });
      if (!result.success) {
        return { success: false, output: '', error: result.error || 'MiniMax H3 MG 动画生成失败' };
      }
      return {
        success: true,
        terminal: true,
        terminalMessage: `MiniMax H3 MG 动画已生成并回填到画布节点 ${nodeId}。`,
        output: [
          'MiniMax H3 MG 动画生成成功。',
          '系统已先生成母版概念图和同风格派生参考帧，并作为图片节点连入目标视频节点。',
          `节点 ${nodeId} 已更新，主产物: ${result.resultPaths[0]}`,
        ].join('\n'),
      };
    }
    if (useMgReferenceWorkflow) {
      if (node.type !== 'video') {
        return { success: false, output: '', error: 'Seedance Mini MG 工作流必须使用 video / MG 动画节点' };
      }
      const duration = Math.min(15, Math.max(4, Number(overrides.duration ?? currentData.duration ?? 6)));
      useCanvasStore.getState().updateNode(nodeId, {
        description: prompt,
        modelVersion: 'seedance-2.0-mini-i2v',
        mgStyleId: styleId || currentData.mgStyleId || 'app-premium-3d',
        mgAccentStyleId: accentStyleId ?? currentData.mgAccentStyleId,
        mgRecipe: mgRecipe ?? currentData.mgRecipe,
        mgGenerationEngine: 'seedance-mini',
        duration,
        resolution: '720p',
        isMgAnimationNode: true,
      });
      const result = await runSeedanceMiniMgForCanvasNode(nodeId, {
        styleId: styleId || String(currentData.mgStyleId ?? ''),
        duration,
        aspectRatio: overrides.aspectRatio === '9:16' || overrides.ratio === '9:16' ? '9:16' : '16:9',
      });
      if (!result.success) {
        const error = result.error || 'Seedance Mini MG 动画生成失败';
        return {
          success: false,
          output: '',
          error,
          ...(result.preventFallback ? { terminal: true, terminalMessage: error } : {}),
        };
      }
      return {
        success: true,
        terminal: true,
        terminalMessage: `Seedance Mini MG 动画已生成并回填到画布节点 ${nodeId}。`,
        output: [
          'Seedance Mini MG 动画生成成功。',
          '系统已先生成母版概念图和同风格派生参考帧，并作为图片节点连入目标视频节点。',
          `节点 ${nodeId} 已更新，主产物: ${result.resultPaths[0]}`,
        ].join('\n'),
      };
    }

    // 节点类型与引擎产物类型必须匹配——生图写进 text/video 节点不渲染，
    // 钱花了产物"消失"。
    const engineKind = findCanvasEngine(engineId)?.kind
      ?? (engineId.includes('seedance') || engineId.includes('startend') ? 'video' : 'image');
    if (node.type !== engineKind) {
      return {
        success: false, output: '',
        error: `节点 "${nodeId}" 是 ${node.type} 类型，但引擎 ${engineId} 产出 ${engineKind}。请先用 canvas_add_node 创建 ${engineKind} 节点（可与本节点连线），再对新节点生成。`,
      };
    }
    overrides = mergeCanvasNodeGenerationParams(
      engineKind,
      node.data as Record<string, unknown>,
      overrides,
    );
    // MiniMax H3：分辨率只有 2K、时长枚举 5-15；Seedance 专有参数不下发
    if (engineId === 'minimax-hailuo-h3') {
      const h3Duration = Math.min(15, Math.max(5, Math.round(Number(overrides.duration) || 5)));
      overrides = { resolution: '2K', ratio: String(overrides.ratio ?? overrides.aspectRatio ?? 'adaptive'), duration: String(h3Duration) };
    } else if (engineId === DREAMINA_SEEDANCE_25_ENGINE_ID) {
      const duration = Math.min(30, Math.max(4, Math.round(Number(overrides.duration) || 5)));
      const resolution = String(overrides.resolution).toLowerCase() === '480p' ? '480p' : '720p';
      overrides = {
        resolution,
        ratio: String(overrides.ratio ?? overrides.aspectRatio ?? 'adaptive'),
        duration: String(duration),
      };
    }

    // agent 未显式传参考时，自动收集节点上已有的参考（用户连线/挂载的
    // referenceImages）——否则用户连好参考图后让 agent 生成，会静默退化
    // 成文生图，出与参考无关的图并覆盖节点。
    let collectedNote = '';
    if (referenceUrls.length === 0 || audioUrls.length === 0 || videoUrls.length === 0) {
      const collected = collectNodeReferences(nodeId);
      if (engineKind === 'image' && referenceUrls.length === 0) {
        referenceUrls = selfImageFallback(nodeId, collected);
        if (referenceUrls.length > 0) {
          collectedNote = collected.images.length > 0
            ? `（自动并入节点已挂载的 ${referenceUrls.length} 张参考图）`
            : '（自动以节点当前图片作为第一参考图进行修改）';
        }
      } else if (collected.images.length > 0 && referenceUrls.length === 0) {
        referenceUrls = collected.images.map((r) => r.submitUrl);
        collectedNote = `（自动并入节点已挂载的 ${referenceUrls.length} 张参考图）`;
      }
      if (audioUrls.length === 0 && collected.audios.length > 0 && engineKind === 'video') {
        audioUrls = collected.audios.map((r) => r.submitUrl);
      }
      if (videoUrls.length === 0 && engineKind === 'video') {
        const videoLimit = engineId === DREAMINA_SEEDANCE_25_ENGINE_ID
          ? 10
          : engineId === 'minimax-hailuo-h3' ? 3 : 1;
        videoUrls = selfVideoFallback(nodeId, collected).slice(0, videoLimit);
        if (videoUrls.length > 0) {
          collectedNote = collectedNote || '（自动并入节点当前视频作为参考视频）';
        }
      }
    }

    const result = await generateForNode({
      nodeId,
      engineId,
      prompt,
      referenceUrls,
      audioUrls,
      videoUrls,
      documentUrl: String(params.file_url ?? '').trim() || undefined,
      linkUrl: String(params.link_url ?? '').trim() || undefined,
      params: overrides,
      overwrite: true,
    });

    if (!result.success) {
      const error = result.error || '生成失败';
      return {
        success: false,
        output: '',
        error,
        ...(result.automaticRetryBlocked ? { terminal: true, terminalMessage: error } : {}),
      };
    }

    const lines = [
      `生成成功${result.fallbackUsed ? '（已切换生图通道）' : ''}${collectedNote}`,
      `节点 ${nodeId} 已更新，主产物: ${result.resultPaths[0]}`,
    ];
    if (result.resultPaths.length > 1) {
      lines.push(`共 ${result.resultPaths.length} 个产物（其余: ${result.resultPaths.slice(1).join(', ')}）`);
    }
    if (engineKind === 'image' && result.resultPaths[0]) {
      const native = await loadMediaInput(result.resultPaths[0]);
      return {
        success: true,
        output: `${lines.join('\n')}\n主产物已作为原生图片附加，可直接验收。`,
        media: [{
          type: 'image',
          source: native.dataUrl.startsWith('data:')
            ? { type: 'base64', media_type: native.mediaType || 'image/png', data: native.dataUrl.slice(native.dataUrl.indexOf(',') + 1) }
            : { type: 'url', url: native.dataUrl },
        }],
      };
    }
    return {
      success: true,
      output: lines.join('\n'),
      ...(engineKind === 'video'
        ? {
          terminal: true,
          terminalMessage: `视频已生成并回填到画布节点 ${nodeId}。`,
        }
        : {}),
    };
  },
};

export const canvasGenerateBatchTool: Tool = {
  definition: {
    name: 'canvas_generate_batch',
    description:
      '并行生成多个互不依赖的画布节点。一次提交全部 jobs，由共享生成队列并发执行（当前全局上限 6）；同一节点禁止在一批中重复。'
      + '用户要求批量生成、同时生成、多镜并行或工作集中有两个及以上待生成节点时，优先使用本工具，不要循环调用 canvas_generate。每个 job 的字段与 canvas_generate 相同。',
    parameters: {
      type: 'object',
      properties: {
        jobs: {
          type: 'array',
          description: '要并行执行的生成任务，按用户期望顺序排列',
          items: {
            type: 'object',
            properties: {
              node_id: { type: 'string', description: '目标画布节点 ID' },
              engine: { type: 'string', description: '与 canvas_generate 相同的引擎 ID' },
              prompt: { type: 'string', description: '该节点独立提示词' },
              prompt_template: { type: 'string', enum: ['legacy', 'universal'] },
              reference_urls: { type: 'array', items: { type: 'string' } },
              audio_urls: { type: 'array', items: { type: 'string' } },
              video_urls: { type: 'array', items: { type: 'string' } },
              asset_ids: { type: 'array', items: { type: 'string' } },
              params: { type: 'object' },
              style_id: { type: 'string' },
              accent_style_id: { type: 'string' },
              mg_recipe: { type: 'object' },
              mg_reference_workflow: { type: 'boolean' },
            },
            required: ['node_id', 'engine', 'prompt'],
          },
        },
      },
      required: ['jobs'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const jobs = Array.isArray(params.jobs)
      ? params.jobs.filter((job): job is Record<string, unknown> => Boolean(job) && typeof job === 'object')
      : [];
    if (jobs.length === 0) return { success: false, output: '', error: 'jobs 不能为空' };
    if (jobs.length > 24) return { success: false, output: '', error: '单批最多 24 个节点，请拆成两批' };

    const nodeIds = jobs.map((job) => String(job.node_id ?? '').trim());
    const duplicate = nodeIds.find((nodeId, index) => nodeId && nodeIds.indexOf(nodeId) !== index);
    if (duplicate) {
      return { success: false, output: '', error: `同一批不能重复生成节点 ${duplicate}，避免并发覆盖同一节点` };
    }

    const settled = await Promise.all(jobs.map((job) => canvasGenerateTool.execute(job)));
    const lines = settled.map((result, index) => {
      const nodeId = nodeIds[index] || `任务 ${index + 1}`;
      return result.success
        ? `✓ ${nodeId}：${result.terminalMessage || result.output.split('\n')[0] || '生成完成'}`
        : `✗ ${nodeId}：${result.error || '生成失败'}`;
    });
    const failed = settled.filter((result) => !result.success);
    if (failed.length > 0) {
      const hasTerminalFailure = failed.some((result) => result.terminal === true);
      const error = `并行生成完成 ${settled.length - failed.length}/${settled.length}，${failed.length} 项失败。\n${lines.join('\n')}`;
      return {
        success: false,
        output: lines.join('\n'),
        error,
        ...(hasTerminalFailure ? { terminal: true, terminalMessage: error } : {}),
      };
    }
    const allTerminal = settled.every((result) => result.terminal === true);
    return {
      success: true,
      ...(allTerminal
        ? {
            terminal: true,
            terminalMessage: `已并行完成 ${settled.length} 个画布视频节点的生成。`,
          }
        : {}),
      output: lines.join('\n'),
    };
  },
};

export const mgReferenceVideoGenerateTool: Tool = {
  definition: {
    name: 'mg_generate_with_reference_boards',
    description:
      '普通对话/画布通用 MG 动画生成工具（花钱）。默认 MiniMax H3，也可明确选择 Omni 或 Seedance Mini。标准流程会先生成一张包含全部核心元素的母版概念图，再并行生成 2-4 张同风格关键帧，最后把这些参考图与用户原始图片/视频一起提交给所选引擎。'
      + '画布已有 MG/video 节点时传 node_id，系统会把母版和关键帧创建为可见图片节点、连入目标节点，并保持界面编号与提示词 @图片一/@视频一 完全一致。'
      + '没有画布节点时可直接在普通对话生成，返回母版、参考帧和视频路径。用户原始人物、文物、产品或口播视频始终是身份权威，生成参考图只能设计包装，不能改变主体。',
    parameters: {
      type: 'object',
      properties: {
        prompt: {
          type: 'string',
          description: 'MG 内容和动作要求。以图形、图标、物体、界面和空间关系为主，文字只保留必要短词',
        },
        engine: {
          type: 'string',
          enum: ['omni', 'minimax-h3', 'seedance-mini'],
          description: '默认 minimax-h3（固定 2K、5-15 秒）；omni 固定 10 秒 720p；seedance-mini 支持 4-15 秒',
        },
        node_id: {
          type: 'string',
          description: '可选。画布上的 video/MG 节点 ID；节点已连接的图片、视频和音频会自动作为参考',
        },
        style_id: {
          type: 'string',
          description: 'Omni MG 风格库 ID，可留空使用默认风格',
        },
        aspect_ratio: {
          type: 'string',
          enum: ['16:9', '9:16'],
          description: '画幅，默认 16:9',
        },
        duration: {
          type: 'number',
          description: 'Seedance Mini 时长 4-15 秒；MiniMax H3 时长 5-15 秒；Omni 始终为 10 秒',
        },
        reference_urls: {
          type: 'array',
          items: { type: 'string' },
          description: '普通对话模式的原始图片参考，最终提示词中排在母版/关键帧之后按 @图片N 标注',
        },
        video_urls: {
          type: 'array',
          items: { type: 'string' },
          description: '普通对话模式的原始参考视频，提示词中标注为 @视频一，并强制保护人物/物品/声音',
        },
        mg_recipe: {
          type: 'object',
          description: '可选效果叙事配方，与画布 Omni MG 的效果叙事参数一致',
        },
      },
      required: ['prompt'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const prompt = String(params.prompt ?? '').trim();
    const nodeId = String(params.node_id ?? '').trim();
    const engine = params.engine === 'omni'
      ? 'omni' as const
      : params.engine === 'seedance-mini'
        ? 'seedance-mini' as const
        : 'minimax-h3' as const;
    const styleId = String(params.style_id ?? '').trim() || undefined;
    const aspectRatio = params.aspect_ratio === '9:16' ? '9:16' : '16:9';
    const rawDuration = Number(params.duration ?? 6);
    const duration = Number.isFinite(rawDuration)
      ? Math.min(15, Math.max(4, Math.round(rawDuration)))
      : 6;

    if (nodeId) {
      const node = useCanvasStore.getState().nodes.find((item) => item.id === nodeId);
      if (!node || node.type !== 'video') {
        return { success: false, output: '', error: 'node_id 必须指向画布上的 video / MG 动画节点' };
      }
      if ((params.reference_urls as unknown[] | undefined)?.length || (params.video_urls as unknown[] | undefined)?.length) {
        return {
          success: false,
          output: '',
          error: '画布节点模式请先把原始图片/视频节点连入 MG 节点，确保素材在界面中可见；不要只传隐藏 URL',
        };
      }
      const current = node.data as Record<string, unknown>;
      useCanvasStore.getState().updateNode(nodeId, {
        description: prompt,
        isMgAnimationNode: true,
        mgStyleId: styleId || current.mgStyleId || 'app-premium-3d',
        mgGenerationEngine: engine,
        modelVersion: engine === 'omni' ? OMNI_MG_ENGINE_ID : engine === 'minimax-h3' ? 'minimax-hailuo-h3' : 'seedance-2.0-mini',
        aspectRatio,
        duration: engine === 'omni' ? 10 : engine === 'minimax-h3' ? Math.min(15, Math.max(5, duration)) : duration,
        mgRecipe: params.mg_recipe ?? current.mgRecipe,
      });
      const result = engine === 'omni'
        ? await runOmniForCanvasNode(nodeId, styleId)
        : engine === 'minimax-h3'
          ? await runMinimaxH3MgForCanvasNode(nodeId, { styleId, aspectRatio, duration })
          : await runSeedanceMiniMgForCanvasNode(nodeId, { styleId, aspectRatio, duration });
      if (!result.success) {
        const error = result.error || 'MG 动画生成失败';
        return {
          success: false,
          output: '',
          error,
          ...(result.preventFallback ? { terminal: true, terminalMessage: error } : {}),
        };
      }
      return {
        success: true,
        output: [
          `${engine === 'omni' ? 'Omni' : engine === 'minimax-h3' ? 'MiniMax H3' : 'Seedance Mini'} MG 动画生成完成。`,
          '母版概念图和同风格关键帧已经作为图片节点显示并连入目标节点。',
          '节点上方参考素材顺序与最终提示词中的 @图片N / @视频一 一致。',
          `视频：${result.resultPaths[0]}`,
        ].join('\n'),
      };
    }

    const result = await runMgWithReferenceBoardsStandalone({
      prompt,
      engine,
      styleId,
      aspectRatio,
      duration,
      sourceReferenceUrls: (params.reference_urls as string[] | undefined) ?? [],
      videoUrls: (params.video_urls as string[] | undefined) ?? [],
      recipe: params.mg_recipe as Partial<MgMotionRecipe> | undefined,
    });
    if (!result.success) {
      const error = result.error || 'MG 动画生成失败';
      return {
        success: false,
        output: '',
        error,
        ...(result.preventFallback ? { terminal: true, terminalMessage: error } : {}),
      };
    }
    const masterPath = result.masterBoardPath;
    const output = [
      `${engine === 'omni' ? 'Omni' : engine === 'minimax-h3' ? 'MiniMax H3' : 'Seedance Mini'} MG 动画生成完成。`,
      masterPath ? `母版概念图：${masterPath}` : '',
      result.referenceBoardPaths?.length
        ? `同一视觉系统参考图：${result.referenceBoardPaths.join('、')}`
        : '',
      `视频：${result.resultPaths[0]}`,
    ].filter(Boolean).join('\n');
    if (!masterPath) return { success: true, output };
    const native = await loadMediaInput(masterPath);
    return {
      success: true,
      output: `${output}\n母版概念图已作为原生图片附加，可直接检查风格和主体一致性。`,
      media: [{
        type: 'image',
        source: native.dataUrl.startsWith('data:')
          ? {
              type: 'base64',
              media_type: native.mediaType || 'image/png',
              data: native.dataUrl.slice(native.dataUrl.indexOf(',') + 1),
            }
          : { type: 'url', url: native.dataUrl },
      }],
    };
  },
};

export const mgTextFallbackGenerateTool: Tool = {
  definition: {
    name: 'mg_text_fallback_generate',
    description:
      'MG/视频文字错误二次兜底生成工具（花钱）。当用户说“不满意、文字还是错、有错字、乱码、字幕不对、字不对”等返工关键词时使用。'
      + '流程固定为 GPT-Image-2 先生成文字定版图，再调用筷子丽帧 Seedance 2.0 Mini 图生视频。'
      + '在剪辑视图优先使用 timeline_mg_text_fallback；在画布或普通聊天中使用本工具。有 node_id 时会回填该视频/MG节点；无 node_id 时只生成并返回视频路径。',
    parameters: {
      type: 'object',
      properties: {
        prompt: { type: 'string', description: '最终文案/画面要求，必须包含需要准确显示的文字' },
        node_id: { type: 'string', description: '可选。画布 video/MG 节点 ID；传入后会直接更新该节点' },
        aspect_ratio: { type: 'string', enum: ['16:9', '9:16'], description: '画幅，默认 16:9' },
        duration: { type: 'number', description: '时长，只支持 4/6/10，默认 6' },
        style_name: { type: 'string', description: '视觉风格描述，可选' },
      },
      required: ['prompt'],
    },
  },
  risk: 'ask',
  async execute(params) {
    const nodeId = String(params.node_id || '').trim();
    const aspectRatio = params.aspect_ratio === '9:16' ? '9:16' : '16:9';
    const durationRaw = Number(params.duration ?? 6);
    const duration = durationRaw === 4 || durationRaw === 10 ? durationRaw : 6;
    const prompt = String(params.prompt ?? '');
    const styleName = params.style_name as string | undefined;
    const result = nodeId
      ? await runMgTextFallbackForCanvasNode(nodeId, { prompt, aspectRatio, duration, styleId: styleName })
      : await runMgTextFallbackStandalone({ prompt, aspectRatio, duration, styleName });
    if (!result.success) {
      const error = result.error || 'MG文字兜底生成失败';
      return {
        success: false,
        output: '',
        error,
        ...(result.preventFallback ? { terminal: true, terminalMessage: error } : {}),
      };
    }
    return {
      success: true,
      output: [
        'MG文字兜底生成完成。',
        nodeId ? `已更新节点 ${nodeId}。` : '',
        `视频: ${result.resultPaths[0]}`,
        'textPlatePath' in result && result.textPlatePath ? `文字定版图: ${result.textPlatePath}` : '',
      ].filter(Boolean).join('\n'),
    };
  },
};
