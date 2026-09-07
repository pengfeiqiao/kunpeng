import { useState } from 'react';
import { FileArchive, FolderOutput, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { copyFile, createDir } from '@tauri-apps/api/fs';
import { useWorkshopStore } from '@/stores/workshopStore';
import { exportProject } from '@/lib/projectArchive';
import { collectProjectMaterials } from '@/lib/workspace/exportMaterials';
import './workspace.css';

/** 项目级导出：工程文件 + 全部素材。成片导出在剪辑窗口，不在此重复。 */
export default function WorkspaceExportDialog({ projectId, onClose }: { projectId: string; onClose: () => void }) {
  const [busy, setBusy] = useState<'archive' | 'materials' | null>(null);
  const [notice, setNotice] = useState('');
  const run = async (kind: 'archive' | 'materials', action: () => Promise<string>) => {
    if (busy) return;
    setBusy(kind); setNotice('');
    try { setNotice(await action()); }
    catch (error) { setNotice(error instanceof Error ? error.message : '导出未完成'); }
    finally { setBusy(null); }
  };
  const exportArchive = () => run('archive', async () => {
    const canvasProjectId = useWorkshopStore.getState().data?.canvasProjectId ?? undefined;
    const path = await exportProject(projectId, canvasProjectId);
    return `工程文件已导出：${path}`;
  });
  const exportMaterials = () => run('materials', async () => {
    const data = useWorkshopStore.getState().data;
    if (!data || data.projectId !== projectId) throw new Error('项目已切换，未导出');
    const target = await openDialog({ directory: true, title: '选择素材导出文件夹' });
    if (!target || Array.isArray(target)) return '已取消';
    const groups = collectProjectMaterials(data);
    if (!groups.length) return '项目暂无可导出素材';
    const projectName = useWorkshopStore.getState().project?.name ?? '项目';
    const root = `${target.replace(/\/$/, '')}/${projectName}-素材`;
    let count = 0;
    for (const group of groups) {
      const dir = `${root}/${group.folder}`;
      await createDir(dir, { recursive: true });
      const used = new Set<string>();
      for (const source of group.paths) {
        const base = source.split(/[\\/]/).pop() ?? `素材-${count}`;
        let name = base; let index = 1;
        while (used.has(name)) name = `${index++}-${base}`;
        used.add(name);
        await copyFile(source, `${dir}/${name}`);
        count++;
      }
    }
    return `已导出 ${count} 个素材到 ${root}`;
  });
  return <div className="workspace-dialog-backdrop" onClick={onClose}>
    <section className="workspace-classify-dialog workspace-export-dialog" role="dialog" aria-modal="true" aria-label="导出项目" onClick={(event) => event.stopPropagation()}>
      <header><h2>导出</h2><button className="workspace-icon" aria-label="关闭导出" onClick={onClose}><X size={16} /></button></header>
      <div className="workspace-export-cards">
        <button className="workspace-export-card" disabled={Boolean(busy)} onClick={exportArchive}>
          <FileArchive size={20} />
          <strong>导出工程文件</strong>
          <span>打包工坊、画布、剪辑、文档与全部素材引用为 zip，可在其他设备导入继续创作。</span>
          <em>{busy === 'archive' ? '正在打包…' : '导出 zip'}</em>
        </button>
        <button className="workspace-export-card" disabled={Boolean(busy)} onClick={exportMaterials}>
          <FolderOutput size={20} />
          <strong>导出全部素材</strong>
          <span>把项目所有资产图、镜头图片、视频、音频分类复制到一个文件夹。</span>
          <em>{busy === 'materials' ? '正在复制…' : '选择文件夹'}</em>
        </button>
      </div>
      <p className="workspace-muted" style={{ padding: '0 16px 6px' }}>导出成片请在剪辑窗口完成。</p>
      {notice && <p className="workspace-export-notice" role="status">{notice}</p>}
    </section>
  </div>;
}
