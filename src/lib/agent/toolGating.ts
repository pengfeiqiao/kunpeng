/**
 * toolGating — 运行期工具门控。
 *
 * 某些工具受用户设置控制是否对模型可见。目前：
 *   - web_search：仅当输入框「联网」开关开启（settings.webSearchEnabled）时可见。
 *
 * ToolRegistry 在 getDefinitions() / getDescriptionText() 里调用本函数过滤，
 * 因工具定义每轮都重新下发给模型，切换开关下一条消息即生效。
 */

import { useSettingsStore } from '@/stores/settingsStore';
import { useChatStore } from '@/stores/chatStore';
import { useDirectorStore } from '@/stores/directorStore';

/** 受设置门控的工具名集合（其余工具默认始终启用） */
const GATED: Record<string, () => boolean> = {
  web_search: () => useSettingsStore.getState().webSearchEnabled === true,
};

const GLOBAL_TIMELINE_TOOLS = new Set([
  'timeline_get_state',
  'timeline_add_scene',
  'timeline_add_free_page',
  'timeline_update_fx',
  'timeline_render_frame',
  'timeline_remove_fx',
  'timeline_add_clip',
  'timeline_add_clips',
  'timeline_add_overlay',
  'timeline_add_audio',
  'timeline_set_export',
  'timeline_export_analyze',
  'timeline_export_prepare',
  'timeline_export_video',
  'timeline_export_status',
  'timeline_export_stop',
  'timeline_export_retry',
  'timeline_motion_guide',
  'timeline_analyze_reference_video',
  'timeline_kimi_edit_plan',
  'timeline_kimi_review',
]);

export function isToolEnabled(name: string): boolean {
  if (GLOBAL_TIMELINE_TOOLS.has(name)) {
    return true;
  }
  // timeline_* 工具仅在剪辑视图可见（省 token，避免画布场景误用）
  if (name.startsWith('timeline_')) {
    return useChatStore.getState().activeView === 'editor';
  }
  // workshop_* 工具仅在创作工坊视图可见
  if (name.startsWith('workshop_')) {
    return useChatStore.getState().activeView === 'workshop';
  }
  // copywriting_* 工具仅在文案工作室可见，避免其它模块误写文案编辑器
  if (name.startsWith('copywriting_')) {
    return useChatStore.getState().activeView === 'copywriting';
  }
  if (name.startsWith('director_')) {
    return useDirectorStore.getState().isOpen;
  }
  // touliu_* 投流工具始终可见（toolbar 级别，不受视图限制）
  if (name.startsWith('touliu_')) {
    return true;
  }
  const gate = GATED[name];
  return gate ? gate() : true;
}
