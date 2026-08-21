/**
 * StepScript — ①剧本上传：本地文件复制进 sources/ + 飞书链接登记 + 开始拆解。
 */
import { useState } from 'react';
import { FileText, Link as LinkIcon, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { copyFile, BaseDirectory } from '@tauri-apps/api/fs';
import { useWorkshopStore } from '@/stores/workshopStore';
import { writeProject, type AigcProjectSource } from '@/lib/aigc/projectStore';
import { buildBreakdownPrompt } from '@/lib/workshop/workshopPrompts';
import { dispatchWorkshopPrompt } from '../WorkshopChatPanel';
import StyleSelector, { buildStyleSection } from '../StyleSelector';

const ACCEPT_EXT = ['docx', 'md', 'txt', 'pdf'];

export default function StepScript() {
  const project = useWorkshopStore((s) => s.project);
  const markStepStatus = useWorkshopStore((s) => s.markStepStatus);
  const [busy, setBusy] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [notice, setNotice] = useState<{ type: 'error' | 'info'; text: string } | null>(null);

  if (!project) return null;

  const persistSources = async (sources: AigcProjectSource[]) => {
    const next = { ...project, sources, updatedAt: Date.now() };
    await writeProject(next);
    useWorkshopStore.setState({ project: next });
  };

  const handlePick = async () => {
    setNotice(null);
    setBusy(true);
    try {
      const selected = await openDialog({
        multiple: true,
        filters: [{ name: '剧本文档', extensions: ACCEPT_EXT }],
      });
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const additions: AigcProjectSource[] = [];
      const skipped: string[] = [];
      const failed: string[] = [];
      for (const p of paths) {
        const base = p.split('/').pop()!;
        if (project.sources.some((s) => s.name === base)) {
          skipped.push(base);
          continue;
        }
        const ext = (base.split('.').pop() ?? 'md').toLowerCase();
        // 复制进项目 sources/，项目目录自包含
        try {
          await copyFile(p, `.kunpeng/aigc-memory/projects/${project.id}/sources/${base}`, { dir: BaseDirectory.Home });
        } catch {
          failed.push(base);
          continue;
        }
        additions.push({
          name: base,
          type: (['docx', 'md', 'xlsx', 'pdf'].includes(ext) ? ext : 'md') as AigcProjectSource['type'],
          size: 0,
          uploadedAt: Date.now(),
        });
      }
      if (additions.length > 0) {
        await persistSources([...project.sources, ...additions]);
        markStepStatus('script', 'done');
      }
      if (failed.length > 0) {
        setNotice({ type: 'error', text: `文件复制失败：${failed.join('、')}` });
      } else if (skipped.length > 0) {
        setNotice({ type: 'info', text: `已跳过重复文件：${skipped.join('、')}` });
      }
    } finally {
      setBusy(false);
    }
  };

  const handleAddLink = async () => {
    setNotice(null);
    const url = linkInput.trim();
    if (!url) return;
    if (!/^https?:\/\//.test(url)) {
      setNotice({ type: 'error', text: '链接格式不正确，需以 http(s) 开头' });
      return;
    }
    if (project.sources.some((s) => s.url === url)) {
      setNotice({ type: 'info', text: '该链接已在列表中' });
      return;
    }
    await persistSources([
      ...project.sources,
      { name: url, type: 'link', size: 0, uploadedAt: Date.now(), url },
    ]);
    setLinkInput('');
    markStepStatus('script', 'done');
  };

  const handleRemove = async (name: string) => {
    await persistSources(project.sources.filter((s) => s.name !== name));
  };

  return (
    <div className="max-w-[720px] mx-auto px-8 py-8 pb-16">
      <h2 className="text-[16px] font-semibold text-[var(--canvas-text-1)]">① 上传剧本</h2>
      <p className="text-[12px] text-[var(--canvas-text-3)] mt-1 mb-6">
        支持 docx / md / txt / pdf，也可以粘贴飞书云文档链接。上传后由 AI 完成拆解。
      </p>

      <button
        onClick={() => void handlePick()}
        disabled={busy}
        className="w-full py-10 rounded-2xl border border-dashed border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] hover:border-[var(--canvas-node-border-selected)] hover:text-[var(--canvas-text-1)] transition-colors disabled:opacity-50"
      >
        {busy ? <Loader2 size={18} className="mx-auto mb-2 animate-spin" /> : <Plus size={18} className="mx-auto mb-2" />}
        <span className="text-[13px]">选择剧本文件</span>
      </button>

      <div className="flex items-center gap-2 mt-3">
        <div className="flex-1 flex items-center gap-2 px-3 py-2 rounded-lg bg-[rgba(255,255,255,0.04)] border border-[var(--canvas-node-border)]">
          <LinkIcon size={13} className="text-[var(--canvas-text-3)] shrink-0" />
          <input
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddLink(); }}
            placeholder="或粘贴飞书云文档链接…"
            className="flex-1 bg-transparent text-[12px] text-[var(--canvas-text-1)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--canvas-accent)] rounded placeholder:text-[var(--canvas-text-3)]"
          />
        </div>
        <button
          onClick={() => void handleAddLink()}
          className="px-3 py-2 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
        >
          添加
        </button>
      </div>

      {notice && (
        <p
          className="mt-2 text-[12px]"
          style={{ color: notice.type === 'error' ? 'var(--canvas-danger)' : 'var(--canvas-accent)' }}
        >
          {notice.text}
        </p>
      )}

      {project.sources.length > 0 && (
        <div className="mt-5 space-y-1.5">
          {project.sources.map((s) => (
            <div
              key={s.name}
              className="flex items-center gap-2.5 px-3 py-2.5 rounded-xl border border-[var(--canvas-node-border)]"
              style={{ background: 'var(--canvas-node-bg)' }}
            >
              {s.type === 'link' ? <LinkIcon size={14} className="text-[var(--canvas-text-2)] shrink-0" /> : <FileText size={14} className="text-[var(--canvas-text-2)] shrink-0" />}
              <span className="flex-1 text-[12px] text-[var(--canvas-text-1)] truncate">{s.name}</span>
              <span className="text-[10px] text-[var(--canvas-text-3)]">{s.type}</span>
              <button onClick={() => void handleRemove(s.name)} className="p-0.5 rounded text-[var(--canvas-text-3)] hover:text-red-400 transition-colors">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
      )}

      {project.sources.length > 0 && (
        <div className="mt-5">
          <p className="text-[11px] text-[var(--canvas-text-3)] mb-2">拆解前先设定全片风格（导演参考 + 自定义关键词，将注入所有提示词）</p>
          <StyleSelector />
        </div>
      )}

      {project.sources.length > 0 && (
        <button
          onClick={() => void buildStyleSection().then((sec) => dispatchWorkshopPrompt(buildBreakdownPrompt(sec)))}
          className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--canvas-accent)' }}
        >
          <Sparkles size={14} /> 开始 AI 拆解 →
        </button>
      )}
    </div>
  );
}
