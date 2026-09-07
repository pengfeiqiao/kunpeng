import type { WorkshopData } from '../workshop/types.ts';
import { workspaceSelection } from './contentModel.ts';
import { buildProjectConversationReferenceContext } from '../projectObjects/conversationRefs.ts';

export function buildWorkspaceAgentContext(data: WorkshopData): string {
  const selection = workspaceSelection(data);
  const target = selection.selected ? { project_id: data.projectId, object_id: selection.selected.id, output_type: selection.outputType,
    media_id: selection.media?.media.id, version_id: selection.media?.version?.id } : { project_id: data.projectId };
  return `[媒体工作台上下文：${JSON.stringify(target)}]\n`
    + '以上是用户发送时的目标身份，执行时不跟随界面后来选中的其他对象。修改提示词先调用 project_get_generation_draft，再用返回的 revision 调用 project_update_generation_prompt。'
    + '该工具只写生成草稿；不要以 workshop_update_shot、canvas_update_node 或直接写文件替代草稿更新。'
    + '“改这条”默认仅修改目标媒体对应的生成草稿，不改剧情、对白、人物关系、镜头描述、历史版本，也不自动开始付费生成。需要扩大范围时先澄清。'
    + '如当前没有目标，先读取项目对象并让用户明确对象。'
    + '如果用户要求修改已添加到对话的导演约束卡提示词，目标是该 director-constraint 对象，output_type 必须为 image；不要改当前镜头的视频草稿。约束卡只接场景图，人物和道具仅文字说明。'
    + buildProjectConversationReferenceContext(data.projectViewState?.conversationReferences) + '\n\n';
}
