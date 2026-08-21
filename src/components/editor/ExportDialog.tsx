/**
 * ExportDialog — 导出参数面板：分辨率/帧率/码率/响度归一/降噪，
 * 走 composeEngine 全量合成；另提供「导出剪映草稿」入口。
 */
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clapperboard, FolderOpen, Loader2, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/tauri';
import { save } from '@tauri-apps/api/dialog';
import { useEditorStore, type ExportSettings } from '@/stores/editorStore';
import { useRenderQueueStore } from '@/stores/renderQueueStore';
import { composeEditorTimeline, type ComposeProgress } from '@/lib/editor/composeEngine';
import { exportEditorToJianying } from '@/lib/export/jianying';

const ROW = 'flex items-center justify-between gap-3 py-2.5';
const LABEL = 'text-[12px] text-[var(--canvas-text-2)]';

function Seg<T extends string | number>({ value, options, onChange }: {
  value: T;
  options: { v: T; label: string }[];
  onChange: (v: T) => void;
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-[var(--canvas-node-border)]">
      {options.map((o) => (
        <button
          key={String(o.v)}
          onClick={() => onChange(o.v)}
          className={`px-2.5 py-1 text-[11px] transition-colors ${
            value === o.v ? 'bg-[rgba(255,255,255,0.14)] text-[var(--canvas-text-1)]' : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className="relative w-9 h-5 rounded-full transition-colors"
      style={{ background: on ? 'rgba(255,255,255,0.85)' : 'rgba(255,255,255,0.12)' }}
    >
      <span
        className="absolute top-0.5 w-4 h-4 rounded-full transition-transform"
        style={{ left: 2, transform: on ? 'translateX(16px)' : 'translateX(0)', background: on ? '#141414' : '#9c9c9c' }}
      />
    </button>
  );
}

export default function ExportDialog({ onClose }: { onClose: () => void }) {
  const settings = useEditorStore((s) => s.exportSettings);
  const setSettings = useEditorStore((s) => s.setExportSettings);
  const clipCount = useEditorStore((s) => s.clips.length);
  const contentCount = useEditorStore((s) => (
    s.clips.length
    + s.overlayClips.length
    + s.textClips.length
    + s.fxClips.length
    + s.audioClips.length
    + s.subtitles.length
  ));
  const totalDuration = useEditorStore((s) => s.totalDuration());
  const [running, setRunning] = useState<'video' | 'jianying' | null>(null);
  const [progress, setProgress] = useState('');
  const [progressPercent, setProgressPercent] = useState<number | null>(null);
  const [result, setResult] = useState<{ kind: 'video' | 'jianying'; path: string } | null>(null);
  const [error, setError] = useState('');
  const [defaultOutputDir, setDefaultOutputDir] = useState('');
  const [outputPath, setOutputPath] = useState('');
  const abortRef = useRef<AbortController | null>(null);
  const jobRef = useRef<string | null>(null);
  const forceStoppedRef = useRef(false);
  const latestJob = useRenderQueueStore((s) => s.latest());

  const patch = (p: Partial<ExportSettings>) => setSettings(p);
  const outputExt = settings.format === 'mov_alpha' ? 'mov' : 'mp4';
  const defaultName = `kunpeng_export_${new Date().toISOString().slice(0, 19).replace(/-|:|T/g, '')}.${outputExt}`;
  const canExport = totalDuration > 0.05 || contentCount > 0;

  useEffect(() => {
    void invoke<string>('ensure_workspace').then((workspace) => {
      const dir = `${workspace}/videos`;
      setDefaultOutputDir(dir);
      setOutputPath((prev) => prev || `${dir}/${defaultName}`);
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const chooseOutputPath = async () => {
    if (running) return;
    const selected = await save({
      defaultPath: outputPath || defaultName,
      filters: [{ name: settings.format === 'mov_alpha' ? '透明视频' : '视频', extensions: [outputExt] }],
    }).catch(() => null);
    if (selected) setOutputPath(selected);
  };

  const runVideo = async () => {
    if (running) return;
    const controller = new AbortController();
    abortRef.current = controller;
    forceStoppedRef.current = false;
    const queue = useRenderQueueStore.getState();
    const jobId = queue.createJob({ kind: 'video', title: '导出成片', outputPath: outputPath || undefined });
    jobRef.current = jobId;
    queue.startJob(jobId);
    setRunning('video'); setError(''); setResult(null); setProgressPercent(null);
    try {
      const out = await composeEditorTimeline((p: ComposeProgress) => {
        setProgress(p.detail ? `${p.stage} · ${p.detail}` : p.stage);
        setProgressPercent(p.percent ?? null);
        queue.updateJob(jobId, { stage: p.stage, detail: p.detail, percent: p.percent, outputPath: outputPath || undefined });
      }, outputPath ? { outputPath, signal: controller.signal } : { signal: controller.signal });
      queue.finishJob(jobId, 'completed', { outputPath: out });
      setResult({ kind: 'video', path: out });
    } catch (err) {
      const msg = controller.signal.aborted ? '已停止导出' : (err instanceof Error ? err.message : String(err));
      queue.finishJob(jobId, controller.signal.aborted ? 'cancelled' : 'failed', { error: msg });
      if (!forceStoppedRef.current) setError(msg);
    } finally {
      if (abortRef.current === controller) abortRef.current = null;
      if (jobRef.current === jobId) jobRef.current = null;
      setRunning(null); setProgress(''); setProgressPercent(null);
    }
  };

  const stopVideo = async () => {
    abortRef.current?.abort();
    setProgress('正在停止导出…');
    setProgressPercent(null);
    await invoke('execute_command', {
      command: [
        "pkill -TERM -f 'render-worker\\.mjs' 2>/dev/null || true",
        "pkill -TERM -f '\\.local-browsers/chromium' 2>/dev/null || true",
        "pkill -TERM -f 'puppeteer_dev_chrome_profile' 2>/dev/null || true",
        "pkill -TERM -f 'final-ffmpeg|fx-worker|editor-export|fx-frames|fx-segment|ffmpeg .*\\.kunpeng' 2>/dev/null || true",
        'sleep 0.8',
        "pgrep -f 'render-worker\\.mjs' | xargs -r kill -9 2>/dev/null || true",
        "pgrep -f '/Desktop/kunpeng/.local-browsers/chromium' | xargs -r kill -9 2>/dev/null || true",
        "pgrep -f 'puppeteer_dev_chrome_profile' | xargs -r kill -9 2>/dev/null || true",
        "pgrep -f 'ffmpeg .*\\.kunpeng' | xargs -r kill -9 2>/dev/null || true",
      ].join('; '),
      timeoutMs: 5000,
    }).catch(() => null);
    window.setTimeout(() => {
      if (!abortRef.current?.signal.aborted) return;
      forceStoppedRef.current = true;
      const jobId = jobRef.current;
      if (jobId) useRenderQueueStore.getState().finishJob(jobId, 'cancelled', { error: '已停止导出' });
      abortRef.current = null;
      jobRef.current = null;
      setRunning(null);
      setProgress('');
      setProgressPercent(null);
      setError('已停止导出');
    }, 1200);
  };

  const runJianying = async () => {
    if (running) return;
    setRunning('jianying'); setError(''); setResult(null); setProgressPercent(null);
    const queue = useRenderQueueStore.getState();
    const jobId = queue.createJob({ kind: 'jianying', title: '导出剪映草稿' });
    queue.startJob(jobId);
    try {
      setProgress('准备剪映草稿…');
      const draftDir = await exportEditorToJianying((p) => {
        setProgress(p.detail ? `${p.stage} · ${p.detail}` : p.stage);
        queue.updateJob(jobId, { stage: p.stage, detail: p.detail });
      });
      queue.finishJob(jobId, 'completed', { outputPath: draftDir });
      setResult({ kind: 'jianying', path: draftDir });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      queue.finishJob(jobId, 'failed', { error: msg });
      setError(msg);
    } finally {
      setRunning(null); setProgress(''); setProgressPercent(null);
    }
  };

  return createPortal(
    <div className="canvas-dark fixed inset-0 z-[9999] flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)' }} onClick={(e) => { if (e.target === e.currentTarget && !running) onClose(); }}>
      <div
        className="w-[420px] rounded-2xl overflow-hidden"
        style={{ background: 'var(--canvas-panel)', border: '1px solid var(--canvas-node-border)', boxShadow: '0 24px 64px rgba(0,0,0,0.5)' }}
      >
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-[var(--canvas-node-border)]">
          <span className="text-[14px] font-medium text-[var(--canvas-text-1)]">导出</span>
          <button onClick={onClose} disabled={running !== null} className="p-1.5 rounded-lg text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[var(--canvas-controls-hover)] disabled:opacity-40">
            <X size={15} />
          </button>
        </div>

        <div className="px-5 py-2 divide-y divide-[rgba(255,255,255,0.05)]">
          <div className={ROW}>
            <span className={LABEL}>格式</span>
            <Seg value={settings.format ?? 'mp4'} onChange={(v) => {
              patch({ format: v });
              setOutputPath('');
            }}
              options={[{ v: 'mp4', label: 'MP4' }, { v: 'mov_alpha', label: '透明 MOV' }]} />
          </div>
          <div className={ROW}>
            <span className={LABEL}>分辨率</span>
            <Seg value={settings.resolution} onChange={(v) => patch({ resolution: v })}
              options={[{ v: '720p', label: '720p' }, { v: '1080p', label: '1080p' }, { v: '2k', label: '2K' }, { v: '4k', label: '4K' }]} />
          </div>
          <div className={ROW}>
            <span className={LABEL}>帧率</span>
            <Seg value={settings.fps} onChange={(v) => patch({ fps: v })}
              options={[{ v: 24, label: '24' }, { v: 30, label: '30' }, { v: 60, label: '60' }]} />
          </div>
          <div className={ROW}>
            <span className={LABEL}>编码</span>
            <Seg value={settings.encoder ?? 'auto'} onChange={(v) => patch({ encoder: v })}
              options={[{ v: 'auto', label: '自动' }, { v: 'h264', label: 'H.264' }, { v: 'hevc', label: 'HEVC' }]} />
          </div>
          <div className={ROW}>
            <span className={LABEL}>码率</span>
            <Seg value={settings.bitrate} onChange={(v) => patch({ bitrate: v })}
              options={[{ v: 'low', label: '流畅' }, { v: 'medium', label: '标准' }, { v: 'high', label: '高质' }]} />
          </div>
          <div className={ROW}>
            <span className={LABEL}>无视频底片</span>
            <Seg value={settings.background ?? 'black'} onChange={(v) => patch({ background: v })}
              options={[{ v: 'black', label: '黑底' }, { v: 'transparent', label: '透明' }]} />
          </div>
          <div className={ROW}>
            <div className="min-w-0">
              <span className={LABEL}>成片保存到</span>
              <p className="text-[10px] text-[var(--canvas-text-3)] mt-0.5 truncate max-w-[270px]">
                {outputPath || (defaultOutputDir ? `${defaultOutputDir}/${defaultName}` : '正在读取默认目录…')}
              </p>
            </div>
            <button
              onClick={() => void chooseOutputPath()}
              disabled={running !== null}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-[11px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] disabled:opacity-40 shrink-0"
            >
              <FolderOpen size={12} /> 选择
            </button>
          </div>
          <div className={ROW}>
            <div>
              <span className={LABEL}>响度归一</span>
              <p className="text-[10px] text-[var(--canvas-text-3)] mt-0.5">EBU R128，多素材音量一致</p>
            </div>
            <Toggle on={settings.loudnorm} onChange={(v) => patch({ loudnorm: v })} />
          </div>
          <div className={ROW}>
            <div>
              <span className={LABEL}>人声降噪</span>
              <p className="text-[10px] text-[var(--canvas-text-3)] mt-0.5">afftdn，口播素材建议开启</p>
            </div>
            <Toggle on={settings.denoise} onChange={(v) => patch({ denoise: v })} />
          </div>
        </div>

        {/* 状态区 */}
        {(running || result || error || latestJob) && (
          <div className="px-5 py-3 border-t border-[var(--canvas-node-border)]">
            {running && (
              <div className="space-y-2">
                <p className="flex items-center gap-2 text-[11px] text-[var(--canvas-text-2)]">
                  <Loader2 size={12} className="animate-spin shrink-0" />{progress || '处理中…'}
                </p>
                {progressPercent != null && (
                  <div className="h-1.5 rounded-full overflow-hidden bg-[rgba(255,255,255,0.08)]">
                    <div
                      className="h-full rounded-full transition-[width] duration-500"
                      style={{ width: `${Math.max(0, Math.min(100, progressPercent))}%`, background: '#8ec5ff' }}
                    />
                  </div>
                )}
              </div>
            )}
            {error && <p className="text-[11px] text-red-400 leading-relaxed">{error}</p>}
            {result && (
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] text-emerald-400 truncate">
                  {result.kind === 'video' ? '成片已导出' : '剪映草稿已生成（重启剪映可见）'}
                </p>
                <button
                  onClick={() => void invoke('open_path', { path: result.path, reveal: true })}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] shrink-0"
                >
                  <FolderOpen size={10} /> 打开位置
                </button>
              </div>
            )}
            {!running && !result && !error && latestJob && (
              <p className="text-[10px] text-[var(--canvas-text-3)] truncate">
                最近任务：{latestJob.title} · {latestJob.status === 'completed' ? '已完成' : latestJob.status === 'failed' ? '失败' : latestJob.status === 'cancelled' ? '已停止' : latestJob.status}
              </p>
            )}
          </div>
        )}

        <div className="flex items-center gap-2 px-5 py-4 border-t border-[var(--canvas-node-border)]">
          <button
            onClick={() => void runJianying()}
            disabled={running !== null || (clipCount === 0 && contentCount === 0)}
            className="flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-[12px] text-[var(--canvas-text-2)] border border-[var(--canvas-node-border)] hover:text-[var(--canvas-text-1)] transition-colors disabled:opacity-40"
          >
            <Clapperboard size={13} /> 剪映草稿
          </button>
          <div className="flex-1" />
          <button
            onClick={() => {
              if (running === 'video') void stopVideo();
              else void runVideo();
            }}
            disabled={(running !== null && running !== 'video') || !canExport}
            className="px-5 py-2 rounded-xl text-[12px] font-medium transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ background: running === 'video' ? '#ef4444' : '#ffffff', color: running === 'video' ? '#ffffff' : '#000000' }}
          >
            {running === 'video' ? '停止导出' : '导出成片'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
