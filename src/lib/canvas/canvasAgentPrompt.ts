import type { Node, Edge } from 'reactflow';
import type { ProjectConversationReference } from '../projectObjects/types.ts';
import { buildProjectConversationReferenceContext } from '../projectObjects/conversationRefs.ts';
import { normalizeMidjourneyVersion } from '../midjourney/prompt.ts';

export interface CanvasAgentAction { action: string; nodeId: string; nodeIds?: string[]; prompt?: string }

/** Shared with the legacy bubble. Keep prompt semantics in one place. */
export function buildCanvasContext(snapshot: { nodes: Node[]; edges: Edge[] }, targetNodes: string | string[] = [],
  references: ProjectConversationReference[] = []): string {
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
    const sharedContext = buildProjectConversationReferenceContext(
      references,
    );
    const prefix = `[用户正在画布视图中操作。生成图片/视频优先使用 canvas_generate 工具（按模型走对应渠道并自动更新节点）；GPT Image 2.5（gpt-image-2.5，图像模型）使用「设置 → 图片模型」中的 API 槽位。「GPT 生图」一律指 gpt-image-2.5 图像模型，与视频模型 Seedance 2.5 名称相似但完全不同，不要混淆。如果用户看过 MG/视频结果后说“不满意/文字还是错/有错字/乱码/字幕不对/字不对/文案不对/还是不行”，优先调用 mg_text_fallback_generate 做二次兜底：GPT-Image-2.5 生成文字定版图，再用筷子 Seedance 2.0 Mini 图生视频；不要继续反复调 Omni。其他画布操作用 canvas_add_node / canvas_update_node / canvas_connect。语音转写/字幕/口播剪辑用 canvas_transcribe（豆包 ASR，长素材免分段）。画布识图纪律：调用 image_recognition 前先用 bash 的 ls/file 确认图片存在且为常见格式（png/jpg）；识图失败不盲目重试，超过 2 次立即换策略——用 canvas_get_state 读节点状态、canvas_capture_node 重新截取，或把图片绝对路径给用户目检、用 ask_user_question 让用户确认画面（用户目检最准）。生成成功但用户看不到画布结果时：先 bash 确认文件有效（尺寸/大小/格式正常）→ canvas_get_state 确认节点是否已回填 → 未回填用 canvas_update_node 重新绑定图片地址 → canvas_capture_node 刷新核验 → 仍不行就把图片绝对路径直接给用户。${canvasCtx}${focusCtx}${sharedContext}]\n\n`;
    return prefix;
}

export async function buildCanvasActionPrompt(node: Node, pending: CanvasAgentAction,
  assetToCosUrl: (url: string) => Promise<string> = async (url) => url): Promise<string> {
    const { action, nodeId, prompt: actionPrompt } = pending;
    const data = node.data as Record<string, unknown>;
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
        const engine = (imgData.imageModel as string) || 'gpt-image-2.5';
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
              : 'gpt-image-2.5';
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
直接调用 canvas_generate 工具：engine="gpt-image-2.5"，reference_urls=["${imgUrl}"]（本地 asset URL 可直接传，工具会自动上传）。`;
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
    // Some tools (lip-sync) already supply their complete original instruction.
    return prompt || actionPrompt || '';
}

export function appendCanvasMentionUrls(raw: string, urls: { imageUrls: string[]; videoUrls: string[]; audioUrls: string[] }): string {
  const refs: string[] = [];
  if (urls.imageUrls.length) refs.push(`参考图片: ${urls.imageUrls.join(', ')}`);
  if (urls.videoUrls.length) refs.push(`参考视频: ${urls.videoUrls.join(', ')}`);
  if (urls.audioUrls.length) refs.push(`参考音频: ${urls.audioUrls.join(', ')}`);
  return refs.length ? raw + '\n\n' + refs.join('\n') : raw;
}

