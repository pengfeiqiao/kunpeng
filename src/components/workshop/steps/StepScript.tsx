/**
 * StepScript — ①剧本上传：本地文件复制进 sources/ + 飞书链接登记 + 开始拆解。
 */
import { useEffect, useRef, useState } from 'react';
import { FileText, Link as LinkIcon, Loader2, Plus, Sparkles, X } from 'lucide-react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { copyFile, BaseDirectory } from '@tauri-apps/api/fs';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { readProject, writeProject, type AigcProjectSource } from '@/lib/aigc/projectStore';
import { captureScriptOperation, commitScriptSources, scriptProjectMatches, type ScriptOperation } from '@/lib/workspace/scriptTools';
import { buildBreakdownPrompt } from '@/lib/workshop/workshopPrompts';
import { dispatchWorkshopPrompt } from '../WorkshopChatPanel';
import StyleSelector, { buildStyleSection } from '../StyleSelector';

const ACCEPT_EXT = ['docx', 'md', 'txt', 'pdf'];

export interface StepScriptProps {
  embedded?: boolean;
  onRequestBreakdown?: () => void | Promise<void>;
}

export default function StepScript({ embedded = false, onRequestBreakdown }: StepScriptProps = {}) {
  const project = useWorkshopStore((s) => s.project);
  const markStepStatus = useWorkshopStore((s) => s.markStepStatus);
  const [busy, setBusy] = useState(false);
  const [linkInput, setLinkInput] = useState('');
  const [notice, setNotice] = useState<{ type: 'error' | 'info'; text: string } | null>(null);
  const busyRef = useRef(false);
  const mounted = useRef(true);
  const operations = useRef(new Set<ScriptOperation>());
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operations.current.forEach((operation) => operation.close()); operations.current.clear(); };
  }, []);

  if (!project) return null;

  const runSourceAction = async (action: (operation: ScriptOperation) => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setNotice(null);
    let operation: ScriptOperation | undefined;
    try {
      operation = captureScriptOperation(project.id, {
        read: () => { const state = useWorkshopStore.getState(); return { project: state.project,
          dataProjectId: state.data?.projectId, activeProjectId: useUnifiedProjectStore.getState().activeId }; },
        subscribe: (listener) => {
          const offWorkshop = useWorkshopStore.subscribe(listener);
          const offUnified = useUnifiedProjectStore.subscribe(listener);
          return () => { offWorkshop(); offUnified(); };
        },
      });
      operations.current.add(operation);
      await action(operation);
    } catch (error) {
      if (mounted.current && useWorkshopStore.getState().project?.id === project.id) {
        setNotice({ type: 'error', text: error instanceof Error ? error.message : '剧本来源操作失败。' });
      }
    } finally {
      if (operation) { operation.close(); operations.current.delete(operation); }
      busyRef.current = false;
      if (mounted.current) setBusy(false);
    }
  };

  const persistSources = async (operation: ScriptOperation, sources: AigcProjectSource[]) => {
    return commitScriptSources(operation, sources, { readProject, writeProject,
      publish: (expected, next) => {
        operation.assertCurrent();
        const current = useWorkshopStore.getState();
        if (!scriptProjectMatches(expected, current.project)) return false;
        useWorkshopStore.setState({ project: next });
        return true;
      },
    });
  };

  const handlePick = () => runSourceAction(async (operation) => {
      const captured = operation.snapshot.project;
      const selected = await openDialog({
        multiple: true,
        filters: [{ name: '剧本文档', extensions: ACCEPT_EXT }],
      });
      operation.assertCurrent();
      if (!selected) return;
      const paths = Array.isArray(selected) ? selected : [selected];
      const additions: AigcProjectSource[] = [];
      const skipped: string[] = [];
      const failed: string[] = [];
      for (const p of paths) {
        operation.assertCurrent();
        const base = p.split(/[\\/]/).pop()!;
        if (captured.sources.some((s) => s.name === base) || additions.some((s) => s.name === base)) {
          skipped.push(base);
          continue;
        }
        const ext = (base.split('.').pop() ?? 'md').toLowerCase();
        // 复制进项目 sources/，项目目录自包含
        const destination = `.kunpeng/aigc-memory/projects/${captured.id}/sources/${base}`;
        try {
          await copyFile(p, destination, { dir: BaseDirectory.Home });
        } catch {
          operation.assertCurrent();
          failed.push(base);
          continue;
        }
        operation.assertCurrent();
        additions.push({
          name: base,
          type: (['docx', 'md', 'xlsx', 'pdf'].includes(ext) ? ext : 'md') as AigcProjectSource['type'],
          size: 0,
          uploadedAt: Date.now(),
        });
      }
      if (additions.length > 0) {
        const receipt = await persistSources(operation, [...captured.sources, ...additions]);
        operation.assertPublished(receipt);
        markStepStatus('script', 'done');
      }
      if (failed.length > 0) {
        setNotice({ type: 'error', text: `文件复制失败：${failed.join('、')}` });
      } else if (skipped.length > 0) {
        setNotice({ type: 'info', text: `已跳过重复文件：${skipped.join('、')}` });
      }
  });

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
    await runSourceAction(async (operation) => {
      if (operation.snapshot.project.sources.some((source) => source.url === url)) {
        setNotice({ type: 'info', text: '该链接已在列表中' });
        return;
      }
      const receipt = await persistSources(operation, [
        ...operation.snapshot.project.sources,
        { name: url, type: 'link', size: 0, uploadedAt: Date.now(), url },
      ]);
      operation.assertPublished(receipt);
      setLinkInput('');
      markStepStatus('script', 'done');
    });
  };

  const handleRemove = async (name: string) => {
    await runSourceAction(async (operation) => {
      await persistSources(operation, operation.snapshot.project.sources.filter((s) => s.name !== name));
    });
  };

  return (
    <div className={embedded ? 'workspace-script-step workspace-script-sources' : 'max-w-[720px] mx-auto px-8 py-8 pb-16'}>
      <h2 className="text-[16px] font-semibold text-[var(--canvas-text-1)]">{embedded ? '剧本来源' : '① 上传剧本'}</h2>
      {!embedded && <p className="text-[12px] text-[var(--canvas-text-3)] mt-1 mb-6">
        支持 docx / md / txt / pdf，也可以粘贴飞书云文档链接。上传后由 AI 完成拆解。
      </p>}

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
            aria-label="剧本链接"
            disabled={busy}
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void handleAddLink(); }}
            placeholder="或粘贴飞书云文档链接…"
            className="flex-1 bg-transparent text-[12px] text-[var(--canvas-text-1)] focus:outline-none focus-visible:ring-1 focus-visible:ring-[var(--canvas-accent)] rounded placeholder:text-[var(--canvas-text-3)]"
          />
        </div>
        <button
          disabled={busy}
          onClick={() => void handleAddLink()}
          className="px-3 py-2 rounded-lg text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors"
        >
          添加
        </button>
      </div>

      {notice && (
        <p
          role={notice.type === 'error' ? 'alert' : 'status'}
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
              <button disabled={busy} title={`移除来源 ${s.name}`} aria-label={`移除来源 ${s.name}`} onClick={() => void handleRemove(s.name)} className="p-0.5 rounded text-[var(--canvas-text-3)] hover:text-red-400 transition-colors">
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
          disabled={busy}
          onClick={() => { if (onRequestBreakdown) void onRequestBreakdown();
            else void buildStyleSection().then((sec) => dispatchWorkshopPrompt(buildBreakdownPrompt(sec))); }}
          className="mt-6 w-full flex items-center justify-center gap-2 py-3 rounded-xl text-[13px] text-white transition-opacity hover:opacity-90"
          style={{ background: 'var(--canvas-accent)' }}
        >
          <Sparkles size={14} /> 开始 AI 拆解 →
        </button>
      )}
    </div>
  );
}
