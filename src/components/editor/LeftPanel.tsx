/**
 * LeftPanel — 剪辑左侧竖 tab 面板：
 * 素材(MediaBin) / 音频(导入+录音) / 文本(花字模板) / 特效(口播组件) /
 * 转场 / 滤镜 / 模板(成片结构) / 文稿(转写剪辑)。
 * 资源库 tab 点击即作用于时间轴（花字/特效落播放头，转场/滤镜作用选中片段）。
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeftRight, FileText, Film, LayoutGrid, LayoutTemplate, Mic, Music, Palette,
  ScrollText, Sparkles, Square, Upload, Loader2,
} from 'lucide-react';
import { open as openDialog } from '@tauri-apps/api/dialog';
import { invoke } from '@tauri-apps/api/tauri';
import { useEditorStore, type AudioTrackKind } from '@/stores/editorStore';
import { captureEditorSnapshot } from '@/lib/editor/editorHistory';
import { TEXT_TEMPLATES } from '@/lib/editor/presets/textTemplates';
import { FX_COMPONENTS, FX_CATEGORIES } from '@/lib/editor/fxComponents';
import { TRANSITION_PRESETS } from '@/lib/editor/presets/transitionPresets';
import { FILTER_PRESETS } from '@/lib/editor/presets/filterPresets';
import { PROJECT_TEMPLATES, applyProjectTemplate } from '@/lib/editor/presets/projectTemplates';
import { activateFxStage, buildTextClipDoc, createFxStage, destroyFxStage, seekStage } from '@/lib/editor/fxRender';
import {
  CUSTOM_PRESETS_UPDATED_EVENT,
  deleteCustomPreset,
  readCustomPresets,
  type CustomEditorPreset,
  type CustomFxPreset,
  type CustomTextPreset,
} from '@/lib/editor/customPresets';
import { PAGE_TEMPLATES } from '@/lib/editor/pageTemplates';
import type { PageCategory, StyleId } from '@/lib/editor/pageLayoutEngine';
import { PAGE_CATEGORIES, STYLES } from '@/lib/editor/pageLayoutEngine';
import MediaBin from './MediaBin';

export type LeftTab = 'media' | 'audio' | 'text' | 'fx' | 'page' | 'transition' | 'filter' | 'template' | 'transcript';

// 三核心前置：文稿（口播剪辑）/ 花字 / 特效 / 模板在前，素材音频次之，转场滤镜靠后
const TABS: { id: LeftTab; icon: typeof Film; label: string }[] = [
  { id: 'media', icon: Film, label: '素材' },
  { id: 'audio', icon: Music, label: '音频' },
  { id: 'text', icon: FileText, label: '花字' },
  { id: 'fx', icon: Sparkles, label: '特效' },
  { id: 'transition', icon: ArrowLeftRight, label: '转场' },
  { id: 'filter', icon: Palette, label: '滤镜' },
  { id: 'page', icon: LayoutGrid, label: '页面' },
  { id: 'template', icon: LayoutTemplate, label: '模板' },
  { id: 'transcript', icon: ScrollText, label: '剪口播' },
];

const GRID_BTN = 'rounded-xl border border-[var(--canvas-node-border)] hover:border-[rgba(255,255,255,0.35)] transition-colors text-left overflow-hidden';
const PAGE_BATCH_SIZE = 24;

function setTimelineDragPayload(e: React.DragEvent<HTMLElement>, payload: Record<string, unknown>) {
  const raw = JSON.stringify(payload);
  (window as unknown as { __kunpengMediaDragPayload?: string }).__kunpengMediaDragPayload = raw;
  e.dataTransfer.effectAllowed = 'copy';
  e.dataTransfer.setData('application/x-kunpeng-media', raw);
  e.dataTransfer.setData('application/json', raw);
  if (typeof payload.path === 'string') e.dataTransfer.setData('text/plain', payload.path);
}

function useThumbInView(rootMargin = '360px'): [React.RefObject<HTMLDivElement>, boolean] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (!('IntersectionObserver' in window)) {
      setInView(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => setInView(entry.isIntersecting),
      { root: null, rootMargin, threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);

  return [ref, inView];
}

/** 迷你实时预览：花字/特效组件缩放渲染（1920 舞台 → 缩到卡片宽） */
function FxThumb({ html, css }: { html: string; css: string }) {
  const ref = useRef<HTMLDivElement | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const [viewRef, inView] = useThumbInView();

  useEffect(() => {
    const el = ref.current;
    const frame = frameRef.current;
    if (!el || !frame || !inView) return;
    el.replaceChildren();

    try {
      const stage = createFxStage({ html, css });
      stage.style.position = 'absolute';
      stage.style.left = '0';
      stage.style.top = '0';
      stage.style.transformOrigin = 'top left';
      stage.classList.add('fx-thumb-live');
      const applyScale = () => {
        const w = frame.clientWidth || 130;
        const scale = w / 1920;
        // Give WebKit a real scaled layout box to clip against. Pure visual
        // transform on a 1920px child can leave thumbnails showing only a dark
        // corner in packaged builds; CSS zoom can make text sizing inconsistent.
        el.style.width = `${w}px`;
        el.style.height = `${w * 9 / 16}px`;
        stage.style.transform = `scale(${scale})`;
      };
      applyScale();
      el.appendChild(stage);
      activateFxStage(stage);
      let cancelled = false;
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          if (!cancelled) seekStage(stage, 1400);
        });
      });
      const ro = new ResizeObserver(applyScale);
      ro.observe(frame);
      return () => {
        cancelled = true;
        ro.disconnect();
        destroyFxStage(stage);
        el.replaceChildren();
      };
    } catch (err) {
      console.error('[LeftPanel] fx thumb render failed', err);
      const fallback = document.createElement('div');
      fallback.className = 'absolute inset-0 flex items-center justify-center text-[10px] text-[var(--canvas-text-3)]';
      fallback.textContent = '预览不可用';
      el.appendChild(fallback);
      return () => el.replaceChildren();
    }
  }, [html, css, inView]);

  return (
    <div
      ref={viewRef}
      className="relative w-full overflow-hidden pointer-events-none"
      style={{ aspectRatio: '16/9' }}
    >
      {!inView && <ThumbSkeleton />}
      {inView && (
        <div
      ref={frameRef}
      className="relative w-full overflow-hidden pointer-events-none"
      style={{
        aspectRatio: '16/9',
        background:
          'radial-gradient(circle at 18% 12%, rgba(96,165,250,0.22), transparent 30%), linear-gradient(135deg, #283044 0%, #161a24 55%, #30333c 100%)',
      }}
    >
      <div ref={ref} className="absolute left-0 top-0" style={{ width: 1920, height: 1080 }} />
        </div>
      )}
    </div>
  );
}

function ThumbSkeleton() {
  return (
    <div
      className="absolute inset-0"
      style={{
        background:
          'radial-gradient(circle at 18% 12%, rgba(96,165,250,0.16), transparent 30%), linear-gradient(135deg, #283044 0%, #161a24 55%, #30333c 100%)',
      }}
    >
      <div className="absolute left-[12%] top-[28%] h-2 w-[54%] rounded-full bg-white/12" />
      <div className="absolute left-[12%] top-[44%] h-1.5 w-[72%] rounded-full bg-white/8" />
      <div className="absolute left-[12%] top-[58%] h-1.5 w-[42%] rounded-full bg-white/8" />
    </div>
  );
}

/** 文本模板的演示文案与默认落位（按类目） */
function textDemoOf(category: string): { text: string; position: 'top' | 'center' | 'bottom' } {
  switch (category) {
    case '标题': return { text: '今天聊个大的', position: 'center' };
    case '综艺': return { text: '啊？？？', position: 'center' };
    case '强调': return { text: '重点来了', position: 'center' };
    case '字幕风': return { text: '这里是一句字幕', position: 'bottom' };
    default: return { text: '示例文字', position: 'center' };
  }
}

function useCustomEditorPresets() {
  const [presets, setPresets] = useState<CustomEditorPreset[]>(() => readCustomPresets());

  useEffect(() => {
    const refresh = () => setPresets(readCustomPresets());
    window.addEventListener(CUSTOM_PRESETS_UPDATED_EVENT, refresh);
    window.addEventListener('storage', refresh);
    return () => {
      window.removeEventListener(CUSTOM_PRESETS_UPDATED_EVENT, refresh);
      window.removeEventListener('storage', refresh);
    };
  }, []);

  return presets;
}

function PresetDeleteButton({ id }: { id: string }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        deleteCustomPreset(id);
      }}
      className="absolute right-1.5 top-1.5 z-10 rounded-md bg-black/55 px-1.5 py-0.5 text-[9px] text-white/80 opacity-0 transition-opacity group-hover:opacity-100 hover:bg-black/80 hover:text-white"
      title="删除这个预设"
    >
      删除
    </button>
  );
}

// ── 音频 tab ──────────────────────────────────────────────────────────────────

function AudioTab() {
  const audioClips = useEditorStore((s) => s.audioClips);
  const audioTracks = useEditorStore((s) => s.audioTracks);
  const [recording, setRecording] = useState(false);
  const [recSec, setRecSec] = useState(0);
  const recRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; timer: ReturnType<typeof setInterval> } | null>(null);

  const importAudio = async (kind: AudioTrackKind) => {
    const sel = await openDialog({ filters: [{ name: '音频', extensions: ['mp3', 'wav', 'm4a', 'aac', 'flac'] }], multiple: true });
    if (!sel) return;
    const files = Array.isArray(sel) ? sel : [sel];
    captureEditorSnapshot();
    const startSec = useEditorStore.getState().playheadSec;
    for (const f of files) {
      await useEditorStore.getState().addAudioClip(kind, { path: f, startSec });
    }
  };

  const startRec = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      const chunks: Blob[] = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const buf = new Uint8Array(await blob.arrayBuffer());
        // 落盘 webm → ffmpeg 转 m4a → 旁白轨（落播放头位置）
        try {
          const tmpDir = await invoke<string>('get_temp_dir').catch(() => '/tmp');
          const webm = `${tmpDir}/kunpeng-rec-${Date.now()}.webm`;
          const { writeBinaryFile } = await import('@tauri-apps/api/fs');
          await writeBinaryFile(webm, buf);
          const { detectFfmpeg } = await import('@/lib/canvas/videoCompose');
          const ffmpeg = await detectFfmpeg();
          let outPath = webm;
          if (ffmpeg) {
            const m4a = webm.replace(/\.webm$/, '.m4a');
            const q = (p: string) => JSON.stringify(p);
            const r = await invoke<{ exit_code: number }>('execute_command', {
              command: `${ffmpeg} -y -i ${q(webm)} -c:a aac -b:a 128k ${q(m4a)}`,
              timeoutMs: 60000,
            });
            if (r.exit_code === 0) outPath = m4a;
          }
          captureEditorSnapshot();
          const startSec = useEditorStore.getState().playheadSec;
          const id = await useEditorStore.getState().addAudioClip('voice', { path: outPath, label: `录音 ${new Date().toLocaleTimeString('zh-CN')}`, startSec });
          useEditorStore.getState().updateAudioClip(id, { source: 'record' });
        } catch (err) {
          console.error('[rec] 保存失败:', err);
        }
      };
      rec.start();
      const timer = setInterval(() => setRecSec((s) => s + 1), 1000);
      recRef.current = { rec, chunks, timer };
      setRecSec(0);
      setRecording(true);
    } catch (err) {
      console.error('[rec] 无法访问麦克风:', err);
    }
  };

  const stopRec = () => {
    const r = recRef.current;
    if (!r) return;
    clearInterval(r.timer);
    r.rec.stop();
    recRef.current = null;
    setRecording(false);
  };

  const KINDS: { kind: AudioTrackKind; label: string; desc: string }[] = [
    { kind: 'bgm', label: 'BGM', desc: '背景音乐（自动循环可选）' },
    { kind: 'sfx', label: '音效', desc: '转场音/强调音' },
    { kind: 'voice', label: '旁白', desc: '口播/解说' },
  ];

  return (
    <div className="p-3 space-y-2.5 overflow-y-auto">
      {KINDS.map((k) => (
        <button key={k.kind} onClick={() => void importAudio(k.kind)} className={`${GRID_BTN} w-full flex items-center gap-3 px-3 py-2.5`}>
          <Upload size={14} className="text-[var(--canvas-text-3)] shrink-0" />
          <div>
            <p className="text-[12px] text-[var(--canvas-text-1)]">导入{k.label}</p>
            <p className="text-[10px] text-[var(--canvas-text-3)] mt-0.5">{k.desc}</p>
          </div>
        </button>
      ))}

      <button
        onClick={() => (recording ? stopRec() : void startRec())}
        className={`${GRID_BTN} w-full flex items-center gap-3 px-3 py-2.5 ${recording ? '!border-red-500/60' : ''}`}
      >
        {recording
          ? <Square size={14} className="text-red-400 shrink-0" />
          : <Mic size={14} className="text-[var(--canvas-text-3)] shrink-0" />}
        <div>
          <p className="text-[12px] text-[var(--canvas-text-1)]">{recording ? `录音中 ${recSec}s · 点击停止` : '录制旁白'}</p>
          <p className="text-[10px] text-[var(--canvas-text-3)] mt-0.5">{recording ? '完成后自动落到旁白轨播放头处' : '麦克风录音 → 旁白轨'}</p>
        </div>
        {recording && <span className="ml-auto w-2 h-2 rounded-full bg-red-500 animate-pulse shrink-0" />}
      </button>

      {audioClips.length > 0 && (
        <div className="pt-1">
          <p className="text-[10px] text-[var(--canvas-text-3)] px-1 mb-1.5">已添加 {audioClips.length} 段</p>
          {audioClips.map((a) => {
            const kind = audioTracks.find((t) => t.id === a.trackId)?.kind ?? 'bgm';
            return (
              <div key={a.id} className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-[var(--canvas-text-2)]">
                <Music size={11} className="shrink-0 text-[var(--canvas-text-3)]" />
                <span className="truncate flex-1">{a.label}</span>
                <span className="text-[9px] text-[var(--canvas-text-3)] shrink-0">{kind === 'bgm' ? 'BGM' : kind === 'sfx' ? '音效' : '旁白'}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── 资源库 tabs ────────────────────────────────────────────────────────────────

function TextTab() {
  const addTextClip = useEditorStore((s) => s.addTextClip);
  const customTextPresets = useCustomEditorPresets().filter((p): p is CustomTextPreset => p.kind === 'text');
  return (
    <div className="h-full min-h-0 overflow-y-auto p-3">
      {customTextPresets.length > 0 && (
        <>
          <p className="text-[10px] text-[var(--canvas-text-3)] px-1 mb-2">我的预设</p>
          <div className="grid grid-cols-2 gap-2 content-start auto-rows-max mb-4">
            {customTextPresets.map((preset) => {
              const doc = buildTextClipDoc({
                id: preset.id,
                text: preset.text,
                templateId: preset.templateId,
                startSec: 0,
                endSec: preset.duration,
                position: preset.position,
                customPos: preset.customPos,
                styleOverrides: preset.styleOverrides,
              });
              const payload = {
                kind: 'text-template',
                text: preset.text,
                templateId: preset.templateId,
                position: preset.position,
                customPos: preset.customPos,
                styleOverrides: preset.styleOverrides,
                duration: preset.duration,
                label: preset.label,
              };
              return (
                <div
                  key={preset.id}
                  draggable
                  onDragStart={(e) => setTimelineDragPayload(e, payload)}
                  className={`${GRID_BTN} group relative bg-[rgba(255,255,255,0.025)] cursor-pointer`}
                  onClick={() => {
                    captureEditorSnapshot();
                    const ph = useEditorStore.getState().playheadSec;
                    const id = addTextClip({
                      text: preset.text,
                      templateId: preset.templateId,
                      startSec: ph,
                      endSec: ph + preset.duration,
                      position: preset.position,
                      customPos: preset.customPos,
                      styleOverrides: preset.styleOverrides,
                    });
                    useEditorStore.getState().selectText(id);
                  }}
                  title={`点击添加到播放头（${preset.label}）`}
                >
                  <PresetDeleteButton id={preset.id} />
                  <FxThumb html={doc.html} css={doc.css} />
                  <p className="px-2 py-1.5 text-[10px] text-[var(--canvas-text-2)] truncate">{preset.label}</p>
                </div>
              );
            })}
          </div>
        </>
      )}
      <p className="text-[10px] text-[var(--canvas-text-3)] px-1 mb-2">{TEXT_TEMPLATES.length} 款花字</p>
      <div className="grid grid-cols-2 gap-2 content-start auto-rows-max">
      {TEXT_TEMPLATES.map((t) => {
        const demo = textDemoOf(t.category);
        const doc = buildTextClipDoc({ id: '', text: demo.text, templateId: t.id, startSec: 0, endSec: 3, position: demo.position });
        return (
          <button
            key={t.id}
            draggable
            onDragStart={(e) => {
              setTimelineDragPayload(e, {
                kind: 'text-template',
                text: demo.text,
                templateId: t.id,
                position: demo.position,
                label: t.label,
              });
            }}
            className={GRID_BTN}
            onClick={() => {
              captureEditorSnapshot();
              const ph = useEditorStore.getState().playheadSec;
              const id = addTextClip({ text: demo.text, templateId: t.id, startSec: ph, endSec: ph + 3, position: demo.position });
              useEditorStore.getState().selectText(id);
            }}
            title={`点击添加到播放头（${t.label} · ${t.category}）`}
          >
            <FxThumb html={doc.html} css={doc.css} />
            <p className="px-2 py-1.5 text-[10px] text-[var(--canvas-text-2)] truncate">{t.label}</p>
          </button>
        );
      })}
      </div>
    </div>
  );
}

function FxTab() {
  const addFxClip = useEditorStore((s) => s.addFxClip);
  const customFxPresets = useCustomEditorPresets().filter((p): p is CustomFxPreset => p.kind === 'fx');
  const [cat, setCat] = useState<string>('全部');
  // hover 重播：remount 缩略图让 CSS 动画从头放
  const [replay, setReplay] = useState<Record<string, number>>({});
  const list = useMemo(
    () => (cat === '全部' ? FX_COMPONENTS : FX_COMPONENTS.filter((c) => c.category === cat)),
    [cat],
  );

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* 分类筛选 chips */}
      <div className="flex gap-1 px-3 pt-2.5 pb-1.5 flex-wrap shrink-0">
        {['全部', ...FX_CATEGORIES].map((c) => (
          <button
            key={c}
            onClick={() => setCat(c)}
            className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
              cat === c
                ? 'bg-[rgba(255,255,255,0.14)] text-[var(--canvas-text-1)]'
                : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)] bg-[rgba(255,255,255,0.04)]'
            }`}
          >
            {c}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto p-3 pt-1.5">
        {customFxPresets.length > 0 && (
          <>
            <p className="text-[10px] text-[var(--canvas-text-3)] px-1 mb-2">我的预设</p>
            <div className="grid grid-cols-2 gap-2 mb-4">
              {customFxPresets.map((preset) => {
                const payload = {
                  kind: 'fx-template',
                  label: preset.label,
                  html: preset.html,
                  css: preset.css,
                  componentId: preset.componentId,
                  params: preset.params,
                  theme: preset.theme,
                  transform: preset.transform,
                  duration: preset.duration,
                };
                return (
                  <div
                    key={preset.id}
                    draggable
                    onDragStart={(e) => setTimelineDragPayload(e, payload)}
                    className={`${GRID_BTN} group relative bg-[rgba(255,255,255,0.025)] cursor-pointer`}
                    onClick={() => {
                      captureEditorSnapshot();
                      const ph = useEditorStore.getState().playheadSec;
                      const id = addFxClip({
                        label: preset.label,
                        html: preset.html,
                        css: preset.css,
                        componentId: preset.componentId,
                        params: preset.params,
                        theme: preset.theme,
                        transform: preset.transform,
                        startSec: ph,
                        duration: preset.duration,
                      });
                      useEditorStore.getState().selectFx(id);
                    }}
                    title={`点击添加到播放头（${preset.label}）`}
                  >
                    <PresetDeleteButton id={preset.id} />
                    <FxThumb html={preset.html} css={preset.css} />
                    <p className="px-2 py-1.5 text-[10px] text-[var(--canvas-text-2)] truncate">{preset.label}</p>
                  </div>
                );
              })}
            </div>
          </>
        )}
        <div className="grid grid-cols-2 gap-2">
          {list.map((c) => {
            let demo: { html: string; css: string } | null = null;
            try {
              demo = c.render(demoParamsOf(c.id), undefined);
            } catch (err) {
              console.error('[LeftPanel] fx component render failed', c.id, err);
            }
            return (
              <button
                key={c.id}
                draggable={Boolean(demo)}
                onDragStart={(e) => {
                  if (!demo) return;
                  const params = demoParamsOf(c.id);
                  const built = c.render(params, undefined);
                  setTimelineDragPayload(e, {
                    kind: 'fx-template',
                    label: c.label,
                    html: built.html,
                    css: built.css,
                    componentId: c.id,
                    params,
                    duration: 4,
                  });
                }}
                className={GRID_BTN}
                disabled={!demo}
                onMouseEnter={() => setReplay((r) => ({ ...r, [c.id]: (r[c.id] ?? 0) + 1 }))}
                onClick={() => {
                  try {
                    captureEditorSnapshot();
                    const ph = useEditorStore.getState().playheadSec;
                    const params = demoParamsOf(c.id);
                    const built = c.render(params, undefined);
                    const id = addFxClip({ label: c.label, html: built.html, css: built.css, componentId: c.id, params, startSec: ph, duration: 4 });
                    useEditorStore.getState().selectFx(id);
                  } catch (err) {
                    console.error('[LeftPanel] add fx component failed', c.id, err);
                  }
                }}
                title={`点击添加到播放头（${c.label}）· 悬停重播动画`}
              >
                {demo ? (
                  <FxThumb key={replay[c.id] ?? 0} html={demo.html} css={demo.css} />
                ) : (
                  <BrokenThumb />
                )}
                <div className="flex items-center justify-between px-2 py-1.5">
                  <p className="text-[10px] text-[var(--canvas-text-2)] truncate">{c.label}</p>
                  <span className="text-[8px] text-[var(--canvas-text-3)] shrink-0 ml-1">{c.category}</span>
                </div>
              </button>
            );
          })}
        </div>
        {list.length === 0 && <EmptyTemplateState text="没有匹配的特效" />}
      </div>
    </div>
  );
}

function PageTab() {
  const addFxClip = useEditorStore((s) => s.addFxClip);
  const [styleFilt, setStyleFilt] = useState<StyleId | '全部'>('全部');
  const [catFilt, setCatFilt] = useState<PageCategory | '全部'>('全部');
  const [visibleCount, setVisibleCount] = useState(PAGE_BATCH_SIZE);

  useEffect(() => setVisibleCount(PAGE_BATCH_SIZE), [styleFilt, catFilt]);

  const list = useMemo(() => PAGE_TEMPLATES.filter((t) => {
    if (styleFilt !== '全部' && t.styleId !== styleFilt) return false;
    if (catFilt !== '全部' && t.category !== catFilt) return false;
    return true;
  }), [styleFilt, catFilt]);
  const visibleList = list.slice(0, visibleCount);

  return (
    <div className="flex flex-col min-h-0 h-full">
      {/* Style filter chips */}
      <div className="px-3 pt-2.5 pb-1 shrink-0">
        <div className="flex gap-1 flex-wrap">
          {(['全部', ...STYLES.map((s) => s.id)] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStyleFilt(s as StyleId | '全部')}
              className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                styleFilt === s
                  ? 'bg-[rgba(255,255,255,0.14)] text-[var(--canvas-text-1)]'
                  : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)] bg-[rgba(255,255,255,0.04)]'
              }`}
            >
              {s === '全部' ? '全部风格' : STYLES.find((st) => st.id === s)?.label ?? s}
            </button>
          ))}
        </div>
      </div>
      {/* Category filter chips */}
      <div className="px-3 pb-1.5 shrink-0">
        <div className="flex gap-1 flex-wrap">
          {(['全部', ...PAGE_CATEGORIES] as const).map((c) => (
            <button
              key={c}
              onClick={() => setCatFilt(c as PageCategory | '全部')}
              className={`px-2 py-0.5 rounded-full text-[10px] transition-colors ${
                catFilt === c
                  ? 'bg-[rgba(255,255,255,0.14)] text-[var(--canvas-text-1)]'
                  : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)] bg-[rgba(255,255,255,0.04)]'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      {/* Count */}
      <p className="px-3 pb-1 text-[10px] text-[var(--canvas-text-3)]">{list.length} 套模板</p>
      {/* Grid */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 pt-1">
        <div className="grid grid-cols-2 gap-2">
          {visibleList.map((t) => {
            let demo: { html: string; css: string } | null = null;
            try {
              demo = t.render(t.demoParams);
            } catch (err) {
              console.error('[LeftPanel] page template render failed', t.id, err);
            }
            return (
              <button
                key={t.id}
                draggable={Boolean(demo)}
                onDragStart={(e) => {
                  if (!demo) return;
                  const built = t.render(t.demoParams);
                  setTimelineDragPayload(e, {
                    kind: 'page-template',
                    label: t.label,
                    html: built.html,
                    css: built.css,
                    componentId: `page:${t.id}`,
                    params: t.demoParams,
                    duration: 5,
                  });
                }}
                className={GRID_BTN}
                disabled={!demo}
                onClick={() => {
                  try {
                    captureEditorSnapshot();
                    const ph = useEditorStore.getState().playheadSec;
                    const built = t.render(t.demoParams);
                    const id = addFxClip({
                      label: t.label,
                      html: built.html,
                      css: built.css,
                      componentId: `page:${t.id}`,
                      params: t.demoParams,
                      startSec: ph,
                      duration: 5,
                    });
                    useEditorStore.getState().selectFx(id);
                  } catch (err) {
                    console.error('[LeftPanel] add page template failed', t.id, err);
                  }
                }}
                title={`${t.label} (${t.category})`}
              >
                {demo ? <FxThumb html={demo.html} css={demo.css} /> : <BrokenThumb />}
                <div className="px-2 py-1.5">
                  <p className="text-[10px] text-[var(--canvas-text-2)] truncate">{t.label}</p>
                  <p className="text-[8px] text-[var(--canvas-text-3)]">{t.category}</p>
                </div>
              </button>
            );
          })}
        </div>
        {visibleCount < list.length && (
          <button
            type="button"
            onClick={() => setVisibleCount((n) => Math.min(n + PAGE_BATCH_SIZE, list.length))}
            className="mt-3 w-full rounded-xl border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.04)] px-3 py-2 text-[11px] text-[var(--canvas-text-2)] hover:border-[rgba(255,255,255,0.28)] hover:bg-[rgba(255,255,255,0.07)]"
          >
            再显示 {Math.min(PAGE_BATCH_SIZE, list.length - visibleCount)} 个
          </button>
        )}
        {list.length === 0 && <EmptyTemplateState text="没有匹配的页面模板" />}
      </div>
    </div>
  );
}

function BrokenThumb() {
  return (
    <div
      className="relative w-full overflow-hidden pointer-events-none flex items-center justify-center text-[10px] text-[var(--canvas-text-3)]"
      style={{
        aspectRatio: '16/9',
        background:
          'radial-gradient(circle at 18% 12%, rgba(96,165,250,0.22), transparent 30%), linear-gradient(135deg, #283044 0%, #161a24 55%, #30333c 100%)',
      }}
    >
      预览不可用
    </div>
  );
}

function EmptyTemplateState({ text }: { text: string }) {
  return (
    <div className="mt-6 rounded-xl border border-dashed border-[var(--canvas-node-border)] px-3 py-4 text-center text-[11px] text-[var(--canvas-text-3)]">
      {text}
    </div>
  );
}

/** 组件演示参数（资源库缩略图和默认实例共用） */
function demoParamsOf(id: string): Record<string, unknown> {
  switch (id) {
    case 'number-roll': return { value: '1280', unit: '万', label: '播放量' };
    case 'percent-ring': return { percent: 72, label: '完成度' };
    case 'bullet-list': return { title: '三个要点', items: ['第一点', '第二点', '第三点'] };
    case 'step-flow': return { steps: ['选题', '拍摄', '剪辑'] };
    case 'quote-card': return { quote: '把每一帧都当作品', author: '鲲鹏' };
    case 'keyword-pop': return { keyword: '关键词' };
    case 'countdown': return { from: 3 };
    // ── 扩充包（fxComponentsExt）──
    case 'counter-vs': return { left: { label: '上月', value: '320' }, right: { label: '本月', value: '980' } };
    case 'timeline-list': return { title: '本期流程', items: [{ time: '00:30', text: '开箱' }, { time: '02:10', text: '实测' }, { time: '05:00', text: '总结' }] };
    case 'tag-cloud': return { title: '关键词', tags: ['性价比', '轻薄', '续航', '颜值'] };
    case 'underline-sweep': return { text: '这一点最关键' };
    case 'circle-mark': return { text: '重点', note: '记住这里' };
    case 'arrow-point': return { text: '看这里', direction: 'down' };
    case 'marker-highlight': return { text: '今天只讲一个核心方法', highlight: '核心方法' };
    case 'opening-title': return { title: '三分钟讲透', subtitle: '新手也能学会' };
    case 'lower-third': return { name: '', title: '' };
    case 'corner-badge': return { text: '干货预警', corner: 'tr' };
    case 'end-card': return { title: '关注我', lines: ['每周更新', '不迷路'] };
    case 'question-card': return { question: '你遇到过这种情况吗？' };
    case 'summary-card': return { title: '本期要点', points: ['先定结构', '再填细节', '最后润色'] };
    case 'comment-pop': return { comments: ['太实用了！', '学到了', '已三连'] };
    case 'price-tag': return { price: '199', original: '399', note: '限时' };
    case 'spec-table': return { title: '参数一览', rows: [{ key: '重量', value: '1.2kg' }, { key: '续航', value: '18h' }] };
    case 'discount-badge': return { text: '5折', sub: '今晚8点' };
    case 'vs-split': return { left: '手动剪', right: 'AI 剪', leftSub: '3小时', rightSub: '10分钟' };
    case 'before-after': return { before: '杂乱素材', after: '成片输出', label: '效果对比' };
    case 'particles-fall': return { density: 'low' };
    case 'bokeh-glow': return { tone: 'warm' };
    case 'light-sweep': return { interval: 3 };
    case 'color-wipe': return { text: '下一节', direction: 'lr' };
    case 'mask-wipe': return { shape: 'circle' };
    // ── 扩充包 2（fxComponentsExt2）──
    case 'gauge-meter': return { value: 72, label: '完成率' };
    case 'funnel-chart': return { stages: [{ label: '曝光', value: 10000 }, { label: '点击', value: 3200 }, { label: '转化', value: 860 }] };
    case 'pie-chart': return { title: '流量来源', segments: [{ label: '搜索', value: 45 }, { label: '推荐', value: 30 }, { label: '直达', value: 25 }] };
    case 'stat-grid': return { stats: [{ value: '128', label: '视频' }, { value: '3.2w', label: '粉丝' }, { value: '86%', label: '好评' }, { value: '1.5w', label: '点赞' }] };
    case 'topic-intro': return { topic: '今天聊什么？', description: '三分钟带你入门' };
    case 'reaction-meter': return { reactions: [{ emoji: '👍', label: '赞同', value: 82 }, { emoji: '😐', label: '一般', value: 45 }, { emoji: '👎', label: '反对', value: 12 }] };
    case 'subscribe-card': return { name: '', title: '', cta: '关注' };
    case 'chapter-nav': return { chapters: ['开场', '原理', '实操', '总结'], current: 1 };
    case 'star-rating': return { rating: 4, total: 2680, label: '好评如潮' };
    case 'coupon-card': return { discount: '50元', code: 'NEW2024', note: '新人专享' };
    case 'shipping-info': return { items: [{ icon: '📦', text: '顺丰包邮' }, { icon: '🔄', text: '7天退换' }, { icon: '✅', text: '正品保障' }] };
    case 'social-proof': return { count: '12,680', label: '人已购买' };
    case 'logo-reveal': return { text: '鲲鹏视频', tagline: 'AI 驱动创作' };
    case 'team-card': return { members: [{ name: '张三', role: '设计' }, { name: '李四', role: '开发' }, { name: '王五', role: '运营' }] };
    case 'milestone-timeline': return { milestones: [{ year: '2022', event: '立项' }, { year: '2023', event: '公测' }, { year: '2024', event: '商业化' }] };
    case 'mission-statement': return { text: '让每个人都能轻松创作' };
    case 'gradient-mesh': return { intensity: 'low' };
    case 'noise-grain': return { opacity: 0.06 };
    case 'grid-lines': return { spacing: 120 };
    case 'corner-frames': return { size: 60, thickness: 2 };
    default: return {};
  }
}

function TransitionTab() {
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const clips = useEditorStore((s) => s.clips);
  const sel = clips.find((c) => c.id === selectedClipId);
  return (
    <div className="p-3 overflow-y-auto">
      {!sel && <p className="text-[10px] text-[var(--canvas-text-3)] px-1 mb-2">先选中主轨片段，转场加在它和下一段之间</p>}
      <div className="grid grid-cols-2 gap-2">
        {TRANSITION_PRESETS.map((t) => {
          const active = sel?.transitionAfter.type === t.id;
          return (
            <button
              key={t.id}
              disabled={!sel}
              onClick={() => {
                if (!sel) return;
                captureEditorSnapshot();
                useEditorStore.getState().setTransition(sel.id, t.id, t.defaultDuration);
              }}
              className={`${GRID_BTN} px-3 py-2.5 disabled:opacity-40 ${active ? '!border-[rgba(255,255,255,0.6)]' : ''}`}
            >
              <p className="text-[11px] text-[var(--canvas-text-1)]">{t.label}</p>
              <p className="text-[9px] text-[var(--canvas-text-3)] mt-0.5 font-mono">{t.defaultDuration}s</p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterTab() {
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const clips = useEditorStore((s) => s.clips);
  const sel = clips.find((c) => c.id === selectedClipId);
  return (
    <div className="p-3 overflow-y-auto">
      {!sel && <p className="text-[10px] text-[var(--canvas-text-3)] px-1 mb-2">先选中主轨片段再套滤镜</p>}
      <div className="grid grid-cols-2 gap-2">
        {FILTER_PRESETS.map((f) => {
          const active = sel?.filter?.preset === f.id;
          return (
            <button
              key={f.id}
              disabled={!sel}
              onClick={() => {
                if (!sel) return;
                captureEditorSnapshot();
                useEditorStore.getState().updateClip(sel.id, { filter: { ...f.values, preset: f.id } });
              }}
              className={`${GRID_BTN} px-3 py-2.5 disabled:opacity-40 ${active ? '!border-[rgba(255,255,255,0.6)]' : ''}`}
            >
              <p className="text-[11px] text-[var(--canvas-text-1)]">{f.label}</p>
              <p className="text-[9px] text-[var(--canvas-text-3)] mt-0.5 font-mono">
                {f.id === 'none' ? '还原' : `对比${f.values.contrast >= 0 ? '+' : ''}${f.values.contrast} 饱和${f.values.saturation >= 0 ? '+' : ''}${f.values.saturation}`}
              </p>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function TemplateTab() {
  const [applying, setApplying] = useState<string | null>(null);
  return (
    <div className="p-3 space-y-2 overflow-y-auto">
      <p className="text-[10px] text-[var(--canvas-text-3)] px-1">套用后时间轴生成占位结构，把素材拖进对应空位即可</p>
      {PROJECT_TEMPLATES.map((t) => (
        <button
          key={t.id}
          className={`${GRID_BTN} w-full px-3 py-3`}
          disabled={applying !== null}
          onClick={() => {
            setApplying(t.id);
            try {
              captureEditorSnapshot();
              applyProjectTemplate(t);
            } finally {
              setApplying(null);
            }
          }}
        >
          <div className="flex items-center justify-between">
            <p className="text-[12px] font-medium text-[var(--canvas-text-1)]">{t.label}</p>
            {applying === t.id && <Loader2 size={11} className="animate-spin text-[var(--canvas-text-3)]" />}
          </div>
          <p className="text-[10px] text-[var(--canvas-text-3)] mt-1 leading-relaxed">{t.desc}</p>
          <div className="flex gap-1 mt-2">
            {t.slots.map((s, i) => (
              <span key={i} className="px-1.5 py-0.5 rounded bg-[rgba(255,255,255,0.06)] text-[9px] text-[var(--canvas-text-2)]">{s.label}</span>
            ))}
          </div>
        </button>
      ))}
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function LeftPanel({ tab, onTabChange, width = 392, onOpenSpeechDrawer }: {
  tab: LeftTab;
  onTabChange: (t: LeftTab) => void;
  width?: number;
  /** 「剪口播」tab 不切内容区，改为弹出左侧抽屉 */
  onOpenSpeechDrawer?: () => void;
}) {
  return (
    <div className="flex flex-col shrink-0 overflow-hidden rounded-xl border border-[var(--canvas-node-border)]" style={{ width, background: 'var(--canvas-panel)' }}>
      {/* 剪辑软件式资源 tab 条 */}
      <div className="shrink-0 border-b border-[rgba(255,255,255,0.06)] px-1.5 py-1 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
        <div className="flex items-center gap-0.5 min-w-max">
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => (t.id === 'transcript' ? (onOpenSpeechDrawer ?? (() => onTabChange(t.id)))() : onTabChange(t.id))}
              className={`flex flex-col items-center justify-center gap-0.5 w-[46px] h-[44px] rounded-lg transition-colors ${
              tab === t.id ? 'text-[#20d6df] bg-[rgba(32,214,223,0.10)]' : 'text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)] hover:bg-[rgba(255,255,255,0.04)]'
            }`}
          >
              <t.icon size={16} />
              <span className="text-[9px] font-medium leading-none">{t.label}</span>
          </button>
        ))}
        </div>
      </div>

      {/* 内容区 */}
      <div className="flex-1 min-w-0 flex flex-col min-h-0">
        {tab === 'media' && <MediaBin embedded />}
        {tab === 'audio' && <AudioTab />}
        {tab === 'text' && <TextTab />}
        {tab === 'fx' && <FxTab />}
        {tab === 'page' && <PageTab />}
        {tab === 'transition' && <TransitionTab />}
        {tab === 'filter' && <FilterTab />}
        {tab === 'template' && <TemplateTab />}
        {tab === 'transcript' && <MediaBin embedded />}
      </div>
    </div>
  );
}
