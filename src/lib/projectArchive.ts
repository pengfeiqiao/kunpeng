/**
 * projectArchive — 工程打包/导入（zip），跨机器可移植。
 *
 * Rust 侧（project_archive.rs）做实际的 zip 打包/解压/路径重映射；
 * 这里做前端编排：导出前 flush 画布、收集画布 meta；导入后注册索引、
 * 重写 asset URL、关联工坊+画布、打开新工程。
 *
 * 路径重映射核心：所有资产路径是绝对路径（含 home + 项目 id），
 * Rust 侧把 zip 内相对路径落地后替换 sourceHome→newHome、oldId→newId。
 * asset:// 显示 URL 由 localPath 派生，导入后这里重新 convertFileSrc。
 */
import { invoke } from '@tauri-apps/api/tauri';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { readTextFile, writeTextFile, exists, BaseDirectory } from '@tauri-apps/api/fs';
import { stripDriveLeadingSlash } from '@/lib/platform';
import { useProjectStore, type Project } from '@/stores/projectStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { readProject, writeProject } from '@/lib/aigc/projectStore';
import { flushEditorProjectNow } from '@/lib/editor/editorPersist';

export interface ImportResult {
  aigcProjectId?: string;
  canvasProjectId?: string;
  name: string;
}

interface RawImportResult extends ImportResult {
  aigc_project_id?: string;
  canvas_project_id?: string;
}

/**
 * 导出工程为 zip 存桌面。
 * @param aigcProjectId 工坊项目 id（自由画布传 undefined）
 * @param canvasProjectId 画布项目 id
 * @returns 桌面 zip 绝对路径
 */
export async function exportProject(
  aigcProjectId: string | undefined,
  canvasProjectId?: string,
): Promise<string> {
  // 1. flush 工坊、剪辑、画布到文件（确保 debounce 窗口内的最新状态落盘）
  try {
    await useWorkshopStore.getState().commitNow();
  } catch (err) {
    console.warn('[projectArchive] workshop commitNow failed:', err);
  }
  try {
    await flushEditorProjectNow();
  } catch (err) {
    console.warn('[projectArchive] flushEditorProjectNow failed:', err);
  }
  if (canvasProjectId) {
    try {
      await useProjectStore.getState().flushActiveCanvas();
    } catch (err) {
      console.warn('[projectArchive] flushActiveCanvas failed:', err);
    }
  }

  // 2. 收集画布 meta（localStorage 里的 Project 记录）
  let canvasMetaJson: string | undefined;
  if (canvasProjectId) {
    const ps = useProjectStore.getState();
    const meta = ps.projects.find((p) => p.id === canvasProjectId);
    if (meta) canvasMetaJson = JSON.stringify(meta, null, 2);
  }

  // 3. 调 Rust 打包
  const zipPath = await invoke<string>('export_project_zip', {
    aigcProjectId: aigcProjectId ?? null,
    canvasProjectId: canvasProjectId ?? null,
    canvasMetaJson: canvasMetaJson ?? null,
  });
  return zipPath;
}

/** asset:// URL 的两种形态 → 反解出本地绝对路径 */
function assetUrlToLocalPath(url: string): string {
  if (url.startsWith('file://')) {
    // file:///C:/... 反解后是 '/C:/...'，Windows 需去前导斜杠
    return stripDriveLeadingSlash(decodeURIComponent(url.replace('file://', '')));
  }
  if (url.startsWith('https://asset.localhost/')) {
    return stripDriveLeadingSlash(decodeURIComponent(url.replace('https://asset.localhost/', '/').replace(/^\/+/, '/')));
  }
  if (url.startsWith('asset://localhost/')) {
    return stripDriveLeadingSlash(decodeURIComponent(url.replace('asset://localhost/', '/').replace(/^\/+/, '/')));
  }
  return url;
}

function isLocalFilePath(value: unknown): value is string {
  return typeof value === 'string' && (value.startsWith('/') || value.startsWith('file://') || value.startsWith('asset://localhost/') || value.startsWith('https://asset.localhost/'));
}

/**
 * 遍历画布 nodes，对每个 localPath 重新生成 asset:// 显示 URL，
 * 写回 generatedImageUrl/referenceImage/imageUrl/audioUrl 等字段。
 * Rust 已重映射 localPath，这里只需派生显示 URL。
 */
async function rewriteCanvasAssetUrls(canvasProjectId: string): Promise<void> {
  const canvasRel = `.kunpeng/projects/${canvasProjectId}/canvas.json`;
  if (!(await exists(canvasRel, { dir: BaseDirectory.Home }))) return;
  const raw = await readTextFile(canvasRel, { dir: BaseDirectory.Home });
  let data: { nodes?: any[]; edges?: any[] };
  try {
    data = JSON.parse(raw);
  } catch {
    return;
  }
  if (!data.nodes) return;

  const DISPLAY_FIELDS = ['generatedImageUrl', 'referenceImage', 'imageUrl', 'audioUrl', 'generatedVideoUrl'];
  let changed = false;
  for (const node of data.nodes) {
    const d = node.data;
    if (!d || typeof d !== 'object') continue;
    // localPath 是真相源；用它重新生成显示 URL
    const localPath = d.localPath;
    if (typeof localPath === 'string' && localPath) {
      const resolvedLocalPath = assetUrlToLocalPath(localPath);
      const newUrl = convertFileSrc(resolvedLocalPath);
      for (const f of DISPLAY_FIELDS) {
        if (typeof d[f] === 'string' && d[f] && d[f].includes('asset.localhost')) {
          if (d[f] !== newUrl) { d[f] = newUrl; changed = true; }
        }
      }
    }
    for (const f of DISPLAY_FIELDS) {
      if (isLocalFilePath(d[f])) {
        const lp = assetUrlToLocalPath(d[f] as string);
        // POSIX 绝对路径与 Windows 盘符路径都要转 asset URL
        if (lp.startsWith('/') || /^[A-Za-z]:[\\/]/.test(lp)) {
          const newUrl = convertFileSrc(lp);
          if (d[f] !== newUrl) { d[f] = newUrl; changed = true; }
        }
      }
    }
    // referenceImages[] / referenceVideos[]: { url, name }
    for (const arrField of ['referenceImages', 'referenceVideos']) {
      if (Array.isArray(d[arrField])) {
        for (const ref of d[arrField]) {
          if (ref && isLocalFilePath(ref.url)) {
            const lp = assetUrlToLocalPath(ref.url);
            // 如果对应有 localPath 或路径存在，重新生成
            const lpResolved = ref.localPath || lp;
            if (lpResolved) {
              const newUrl = convertFileSrc(lpResolved);
              if (ref.url !== newUrl) { ref.url = newUrl; changed = true; }
            }
          }
        }
      }
    }
  }

  if (changed) {
    await writeTextFile(
      { path: canvasRel, contents: JSON.stringify(data, null, 2) },
      { dir: BaseDirectory.Home },
    );
    console.log('[projectArchive] canvas asset URLs rewritten');
  }
}

/**
 * 导入 zip 工程：解压、重映射、注册索引、打开。
 * @param zipPath 用户选的 zip 文件路径
 */
export async function importProject(zipPath: string): Promise<ImportResult> {
  const raw = await invoke<RawImportResult>('import_project_zip', { zipPath });
  const result: ImportResult = {
    aigcProjectId: raw.aigcProjectId ?? raw.aigc_project_id,
    canvasProjectId: raw.canvasProjectId ?? raw.canvas_project_id,
    name: raw.name || '导入工程',
  };
  const { aigcProjectId, canvasProjectId, name } = result;

  // 1. 注册工坊项目索引（仅当有工坊项目）
  if (aigcProjectId) {
    const proj = await readProject(aigcProjectId);
    if (proj) {
      await writeProject(proj);
    }
  }

  // 2. 重写画布 asset URL（Rust 已重映射 localPath，这里派生显示 URL）
  if (canvasProjectId) {
    await rewriteCanvasAssetUrls(canvasProjectId);
    // 3. 注册画布项目 meta（不调 createProject，避免覆盖已落地的 canvas.json）
    const now = Date.now();
    const meta: Project = {
      id: canvasProjectId,
      name,
      createdAt: now,
      updatedAt: now,
      ...(aigcProjectId ? { aigcProjectId } : {}),
    };
    useProjectStore.setState((s) => ({
      projects: [...s.projects.filter((p) => p.id !== canvasProjectId), meta],
    }));
    // 4. 工坊 workshop.json 的 canvasProjectId 关联（仅当有工坊项目）
    if (aigcProjectId) {
      try {
        const wsRel = `.kunpeng/aigc-memory/projects/${aigcProjectId}/workshop.json`;
        if (await exists(wsRel, { dir: BaseDirectory.Home })) {
          const wsRaw = await readTextFile(wsRel, { dir: BaseDirectory.Home });
          const ws = JSON.parse(wsRaw);
          ws.canvasProjectId = canvasProjectId;
          if (ws.data && typeof ws.data === 'object') ws.data.canvasProjectId = canvasProjectId;
          await writeTextFile(
            { path: wsRel, contents: JSON.stringify(ws, null, 2) },
            { dir: BaseDirectory.Home },
          );
        }
      } catch (err) {
        console.warn('[projectArchive] 关联 workshop canvasProjectId 失败:', err);
      }
    }
  }

  // 5. 打开新工程：有工坊走 openUnified；自由画布走 switchProject
  if (aigcProjectId) {
    await useUnifiedProjectStore.getState().openUnified(aigcProjectId);
  } else if (canvasProjectId) {
    await useUnifiedProjectStore.getState().closeUnified();
    await useProjectStore.getState().switchProject(canvasProjectId);
  }

  return result;
}
