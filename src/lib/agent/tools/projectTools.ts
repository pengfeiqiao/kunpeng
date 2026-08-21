import type { Tool } from '../types';
import { homeDir } from '@tauri-apps/api/path';
import { invoke } from '@tauri-apps/api/tauri';
import { useProjectStore } from '@/stores/projectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { getActiveEditorProjectId } from '@/lib/editor/editorPersist';

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/');
}

export const projectGetPathsTool: Tool = {
  definition: {
    name: 'project_get_paths',
    description: '读取当前鲲鹏项目的真实本地路径：工坊目录、画布 json、剪辑 json、资产目录、配音目录、工作区目录。agent 需要用 bash/read/write 调试项目前应先调用。',
    parameters: { type: 'object', properties: {}, required: [] },
  },
  risk: 'safe',
  async execute() {
    const home = (await homeDir()).replace(/\/$/, '');
    const canvasState = useProjectStore.getState();
    const workshopState = useWorkshopStore.getState();
    const canvasProjectId = canvasState.activeProjectId;
    const canvasProject = canvasProjectId ? canvasState.projects.find((p) => p.id === canvasProjectId) : null;
    const aigcProjectId = workshopState.project?.id ?? canvasProject?.aigcProjectId ?? null;
    const editorProjectId = getActiveEditorProjectId();
    const workspaceDir = await invoke<string>('ensure_workspace').catch(() => null);
    const aigcRoot = aigcProjectId ? joinPath(home, '.kunpeng/aigc-memory/projects', aigcProjectId) : null;
    const canvasRoot = canvasProjectId ? joinPath(home, '.kunpeng/projects', canvasProjectId) : null;
    const editorRoot = editorProjectId ? joinPath(home, '.kunpeng/aigc-memory/projects', editorProjectId) : null;
    return {
      success: true,
      output: JSON.stringify({
        current: {
          canvas_project_id: canvasProjectId,
          canvas_project_name: canvasProject?.name ?? null,
          aigc_project_id: aigcProjectId,
          aigc_project_name: workshopState.project?.name ?? null,
          editor_project_id: editorProjectId,
        },
        paths: {
          home,
          workspace_dir: workspaceDir,
          canvas_root: canvasRoot,
          canvas_json: canvasRoot ? joinPath(canvasRoot, 'canvas.json') : null,
          workshop_root: aigcRoot,
          workshop_json: aigcRoot ? joinPath(aigcRoot, 'workshop.json') : null,
          workshop_assets_dir: aigcRoot ? joinPath(aigcRoot, 'assets') : null,
          workshop_shots_dir: aigcRoot ? joinPath(aigcRoot, 'shots') : null,
          workshop_dubbing_dir: aigcRoot ? joinPath(aigcRoot, 'dubbing') : null,
          editor_root: editorRoot,
          editor_json: editorRoot ? joinPath(editorRoot, 'editor.json') : null,
          global_assets_dir: joinPath(home, '.kunpeng/assets'),
          imported_assets_dir: joinPath(home, '.kunpeng/imported-assets'),
        },
        verify: '读写项目前，先用这些路径确认真实文件；修改后用对应 get_state 或 UI refresh 工具验证。',
      }, null, 2),
    };
  },
};

export const allProjectTools: Tool[] = [projectGetPathsTool];
