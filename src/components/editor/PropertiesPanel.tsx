/**
 * PropertiesPanel — 右侧属性面板（v3）：按选中对象类型切换上下文——
 * 主轨片段（变速/转场/调色）/ 视频多轨（变换+关键帧）/ 花字 / 特效 /
 * 音频（音量/淡化）/ 字幕。无选中时显示提示 + 快速添加字幕。
 */
import {
  DEFAULT_FX_TRANSFORM, EXPORT_RESOLUTIONS, useEditorStore,
  type AudioClip, type EditorClip, type ExportSettings, type FxClip, type MaskSettings, type OverlayClip, type SubtitleCue, type TextClip,
} from '@/stores/editorStore';
import { captureEditorSnapshot } from '@/lib/editor/editorHistory';
import { TRANSITION_PRESETS } from '@/lib/editor/presets/transitionPresets';
import { FILTER_PRESETS } from '@/lib/editor/presets/filterPresets';
import { TEXT_TEMPLATES } from '@/lib/editor/presets/textTemplates';
import {
  AlignHorizontalJustifyCenter,
  AlignHorizontalJustifyEnd,
  AlignHorizontalJustifyStart,
  AlignVerticalJustifyCenter,
  AlignVerticalJustifyEnd,
  AlignVerticalJustifyStart,
  Diamond,
  Maximize2,
  Sparkles,
  Trash2,
  Type,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { dispatchEditorPrompt } from './EditorChatPanel';
import { FX_THEMES, type ThemeGroup } from '@/lib/editor/fxDesignSystem';
import { EDITOR_ASPECT_OPTIONS, type EditorAspect } from '@/lib/editor/aspect';

/** ✦ 对 AI 说 — 选中花字/特效时的自然语言改装条 */
function AskAiBar({ buildPrompt, placeholder }: { buildPrompt: (wish: string) => string; placeholder: string }) {
  const [wish, setWish] = useState('');
  const send = () => {
    const w = wish.trim();
    if (!w) return;
    dispatchEditorPrompt(buildPrompt(w));
    setWish('');
  };
  return (
    <div className="mt-4 pt-3 border-t border-[rgba(255,255,255,0.06)]">
      <p className="text-[10px] text-[var(--canvas-text-2)] mb-1.5 flex items-center gap-1">
        <Sparkles size={10} className="text-[var(--canvas-accent)]" /> 对 AI 说
      </p>
      <div className="flex gap-1.5">
        <input
          value={wish}
          onChange={(e) => setWish(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') send(); }}
          placeholder={placeholder}
          className="flex-1 px-2.5 py-1.5 rounded-lg bg-[rgba(255,255,255,0.05)] border border-[rgba(255,255,255,0.08)] text-[11px] text-[var(--canvas-text-1)] placeholder:text-[var(--canvas-text-3)] focus:outline-none focus:border-[rgba(255,255,255,0.25)]"
        />
        <button
          onClick={send}
          disabled={!wish.trim()}
          className="px-2.5 rounded-lg text-[11px] text-white transition-opacity hover:opacity-90 disabled:opacity-35"
          style={{ background: 'var(--canvas-accent)' }}
        >
          改
        </button>
      </div>
    </div>
  );
}

const SEC = 'mb-5';
const LABEL = 'text-[10px] text-[var(--canvas-text-3)] mb-1.5 block';
const INPUT = 'w-full px-2 py-1.5 rounded-lg bg-[rgba(255,255,255,0.05)] border border-[var(--canvas-node-border)] text-[11px] text-[var(--canvas-text-1)] focus:outline-none focus:border-[rgba(255,255,255,0.35)]';
type PropTab = '画面' | '音频' | '变速' | '动画' | '调整' | 'AI效果';
type PictureSubTab = '基础' | '蒙版';

function PropTabs({ tabs, active, onChange }: { tabs: PropTab[]; active: PropTab; onChange: (tab: PropTab) => void }) {
  return (
    <div className="mt-3 flex gap-1 overflow-x-auto rounded-lg bg-black/15 p-0.5">
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`shrink-0 rounded-md px-2.5 py-1.5 text-[11px] font-medium transition-colors ${
            active === tab
              ? 'bg-[rgba(255,255,255,0.10)] text-[var(--canvas-text-1)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
              : 'text-[var(--canvas-text-3)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--canvas-text-2)]'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <span className={LABEL}>{label}</span>
      {children}
    </div>
  );
}

function MiniTabs<T extends string>({ tabs, active, onChange }: { tabs: T[]; active: T; onChange: (tab: T) => void }) {
  return (
    <div className="mb-3 grid rounded-lg bg-black/15 p-0.5" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
      {tabs.map((tab) => (
        <button
          key={tab}
          type="button"
          onClick={() => onChange(tab)}
          className={`rounded-md px-2 py-1.5 text-[10px] font-medium transition-colors ${
            active === tab
              ? 'bg-[rgba(255,255,255,0.10)] text-[var(--canvas-text-1)]'
              : 'text-[var(--canvas-text-3)] hover:bg-[rgba(255,255,255,0.04)] hover:text-[var(--canvas-text-2)]'
          }`}
        >
          {tab}
        </button>
      ))}
    </div>
  );
}

const DEFAULT_MASK: MaskSettings = {
  enabled: false,
  type: 'rect',
  x: 0,
  y: 0,
  width: 0.72,
  height: 0.72,
  rotation: 0,
  feather: 0,
  invert: false,
};

function Slider({ value, min, max, step, onChange, fmt }: {
  value: number; min: number; max: number; step: number;
  onChange: (v: number) => void; fmt?: (v: number) => string;
}) {
  const pct = Math.max(0, Math.min(100, ((value - min) / Math.max(0.0001, max - min)) * 100));
  return (
    <div className="flex items-center gap-3">
      <input
        type="range" min={min} max={max} step={step} value={value}
        onPointerDown={() => captureEditorSnapshot()}
        onChange={(e) => onChange(Number(e.target.value))}
        className="kunpeng-prop-slider flex-1"
        style={{ background: `linear-gradient(90deg, rgba(255,255,255,0.92) ${pct}%, rgba(255,255,255,0.16) ${pct}%)` }}
      />
      <span className="w-[54px] rounded-md bg-black/20 px-1.5 py-1 text-right font-mono text-[10px] text-[var(--canvas-text-2)] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
        {fmt ? fmt(value) : value}
      </span>
    </div>
  );
}

type BasicTransform = { x: number; y: number; scale: number; opacity: number; rotation: number };

function edgeOffset(scale: number, side: 'start' | 'end') {
  const v = Math.max(0.02, scale);
  return side === 'start' ? (v - 1) / 2 : (1 - v) / 2;
}

function TransformQuickActions({
  transform,
  onPatch,
}: {
  transform: BasicTransform;
  onPatch: (patch: Partial<BasicTransform>) => void;
}) {
  const actions: Array<{ title: string; icon: React.ReactNode; patch: Partial<BasicTransform> }> = [
    { title: '左对齐', icon: <AlignHorizontalJustifyStart size={13} />, patch: { x: edgeOffset(transform.scale, 'start') } },
    { title: '水平居中', icon: <AlignHorizontalJustifyCenter size={13} />, patch: { x: 0 } },
    { title: '右对齐', icon: <AlignHorizontalJustifyEnd size={13} />, patch: { x: edgeOffset(transform.scale, 'end') } },
    { title: '顶对齐', icon: <AlignVerticalJustifyStart size={13} />, patch: { y: edgeOffset(transform.scale, 'start') } },
    { title: '垂直居中', icon: <AlignVerticalJustifyCenter size={13} />, patch: { y: 0 } },
    { title: '底对齐', icon: <AlignVerticalJustifyEnd size={13} />, patch: { y: edgeOffset(transform.scale, 'end') } },
    { title: '铺满画面', icon: <Maximize2 size={13} />, patch: { x: 0, y: 0, scale: 1, rotation: 0 } },
  ];
  return (
    <div className="mt-3 grid grid-cols-7 overflow-hidden rounded-lg bg-black/15 p-0.5 shadow-[inset_0_0_0_1px_rgba(255,255,255,0.04)]">
      {actions.map((a) => (
        <button
          key={a.title}
          type="button"
          title={a.title}
          onClick={() => {
            captureEditorSnapshot();
            onPatch(a.patch);
          }}
          className="flex h-7 items-center justify-center text-[var(--canvas-text-3)] transition-colors hover:bg-[rgba(255,255,255,0.08)] hover:text-[var(--canvas-text-1)]"
          aria-label={a.title}
        >
          {a.icon}
        </button>
      ))}
    </div>
  );
}

function NumInput({ value, onCommit, step = 0.1, min = 0 }: { value: number; onCommit: (v: number) => void; step?: number; min?: number }) {
  return (
    <input
      type="number" step={step} min={min} value={Number(value.toFixed(2))}
      onChange={(e) => { captureEditorSnapshot(); onCommit(Math.max(min, Number(e.target.value))); }}
      className={INPUT}
    />
  );
}

// ── 主轨片段 ──────────────────────────────────────────────────────────────────

function ClipProps({ clip, activeTab }: { clip: EditorClip; activeTab: PropTab }) {
  const updateClip = useEditorStore((s) => s.updateClip);
  const setTransition = useEditorStore((s) => s.setTransition);
  const trimClip = useEditorStore((s) => s.trimClip);
  const f = clip.filter ?? { brightness: 0, contrast: 0, saturation: 0, temperature: 0 };
  const patch = (p: Partial<EditorClip>) => updateClip(clip.id, p);
  const patchFilter = (p: Partial<typeof f>) => patch({ filter: { ...f, ...p, preset: undefined } });

  return (
    <>
      <p className="text-[12px] text-[var(--canvas-text-1)] font-medium truncate mb-1" title={clip.label}>{clip.label}</p>
      <p className="text-[10px] text-[var(--canvas-text-3)] font-mono mb-4">原始 {clip.duration.toFixed(2)}s</p>

      {activeTab === '画面' && (
        <div className={SEC}>
          <span className={LABEL}>裁剪（源素材秒 · I/O 同效）</span>
          <div className="grid grid-cols-2 gap-2">
            <NumInput value={clip.inSec} onCommit={(v) => trimClip(clip.id, v, undefined)} />
            <NumInput value={clip.outSec} onCommit={(v) => trimClip(clip.id, undefined, v)} />
          </div>
          <p className="mt-2 text-[9px] text-[var(--canvas-text-3)]">
            右键「替换片段」可保留当前位置和属性更换素材。
          </p>
        </div>
      )}

      {activeTab === '音频' && (
        <div className={SEC}>
          <span className={LABEL}>原声音量 {Math.round((clip.volume ?? 1) * 100)}%</span>
          <Slider value={clip.volume ?? 1} min={0} max={2} step={0.05} onChange={(v) => patch({ volume: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <div className="mt-2 flex gap-1.5">
            {[0, 0.5, 1, 1.5].map((v) => (
              <button
                key={v}
                onClick={() => { captureEditorSnapshot(); patch({ volume: v }); }}
                className={`flex-1 rounded-md py-1 text-[10px] transition-colors ${
                  (clip.volume ?? 1) === v ? 'bg-[rgba(255,255,255,0.12)] text-[var(--canvas-text-1)]' : 'bg-[rgba(255,255,255,0.04)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                }`}
              >
                {v === 0 ? '静音' : `${Math.round(v * 100)}%`}
              </button>
            ))}
          </div>
        </div>
      )}

      {activeTab === '变速' && (
        <div className={SEC}>
          <span className={LABEL}>变速 ×{(clip.speed ?? 1).toFixed(2)}</span>
          <Slider value={clip.speed ?? 1} min={0.1} max={4} step={0.05} onChange={(v) => patch({ speed: v })} fmt={(v) => `${v.toFixed(2)}x`} />
          <div className="flex gap-1 mt-1.5">
            {[0.5, 1, 1.5, 2].map((v) => (
              <button
                key={v}
                onClick={() => { captureEditorSnapshot(); patch({ speed: v }); }}
                className={`flex-1 py-1 rounded-md text-[10px] transition-colors ${
                  (clip.speed ?? 1) === v ? 'bg-[rgba(255,255,255,0.12)] text-[var(--canvas-text-1)]' : 'bg-[rgba(255,255,255,0.04)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                }`}
              >{v}x</button>
            ))}
          </div>
        </div>
      )}

      {activeTab === '动画' && (
        <>
          <div className={SEC}>
            <span className={LABEL}>转场（本段之后 · 导出保真）</span>
            <div className="grid grid-cols-2 gap-2">
              <select
                value={clip.transitionAfter.type}
                onChange={(e) => { captureEditorSnapshot(); setTransition(clip.id, e.target.value, clip.transitionAfter.duration || 0.5); }}
                className={INPUT}
              >
                <option value="cut">硬切</option>
                {TRANSITION_PRESETS.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              </select>
              <NumInput
                value={clip.transitionAfter.duration}
                step={0.1}
                onCommit={(v) => setTransition(clip.id, clip.transitionAfter.type, Math.max(0.2, Math.min(2, v)))}
              />
            </div>
          </div>
          <div className={SEC}>
            <span className={LABEL}>基础变换</span>
            <div className="grid grid-cols-3 gap-1.5">
              <button
                onClick={() => { captureEditorSnapshot(); patch({ reversed: !clip.reversed }); }}
                className={`rounded-md py-1.5 text-[10px] ${clip.reversed ? 'bg-[rgba(255,255,255,0.14)] text-[var(--canvas-text-1)]' : 'bg-[rgba(255,255,255,0.04)] text-[var(--canvas-text-3)]'}`}
              >倒放</button>
              <button
                onClick={() => { captureEditorSnapshot(); patch({ flipH: !clip.flipH }); }}
                className={`rounded-md py-1.5 text-[10px] ${clip.flipH ? 'bg-[rgba(255,255,255,0.14)] text-[var(--canvas-text-1)]' : 'bg-[rgba(255,255,255,0.04)] text-[var(--canvas-text-3)]'}`}
              >镜像</button>
              <button
                onClick={() => { captureEditorSnapshot(); patch({ rotate: (((clip.rotate ?? 0) + 90) % 360) as EditorClip['rotate'] }); }}
                className="rounded-md bg-[rgba(255,255,255,0.04)] py-1.5 text-[10px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]"
              >旋转{clip.rotate ? ` ${clip.rotate}°` : ''}</button>
            </div>
          </div>
        </>
      )}

      {activeTab === '调整' && (
        <div className={SEC}>
          <span className={LABEL}>调色</span>
          <div className="grid grid-cols-4 gap-1 mb-2.5">
            {FILTER_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => { captureEditorSnapshot(); patch({ filter: { ...p.values, preset: p.id } }); }}
                className={`py-1 rounded-md text-[9px] transition-colors ${
                  clip.filter?.preset === p.id ? 'bg-[rgba(255,255,255,0.14)] text-[var(--canvas-text-1)]' : 'bg-[rgba(255,255,255,0.04)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                }`}
              >{p.label}</button>
            ))}
          </div>
          {([['亮度', 'brightness'], ['对比', 'contrast'], ['饱和', 'saturation'], ['色温', 'temperature']] as const).map(([label, key]) => (
            <div key={key} className="mb-1">
              <span className="text-[9px] text-[var(--canvas-text-3)]">{label}</span>
              <Slider value={f[key]} min={-100} max={100} step={1} onChange={(v) => patchFilter({ [key]: v })} />
            </div>
          ))}
        </div>
      )}

      {activeTab === 'AI效果' && (
        <AskAiBar
          placeholder="如：给这段加重点花字、补一个转场、调成冷色"
          buildPrompt={(wish) =>
            `请围绕选中的主视频片段（id=${clip.id}，素材 ${clip.path}，源入出点 ${clip.inSec.toFixed(1)}-${clip.outSec.toFixed(1)}s）做剪映式增强。我的要求：${wish}。请先 timeline_get_state 核对时间轴，再提出或执行合适的花字、特效、转场、调色、音效方案。复杂改动先给计划，不要直接大改。`}
        />
      )}
    </>
  );
}

// ── 视频多轨 ──────────────────────────────────────────────────────────────────

function OverlayProps({ clip, activeTab }: { clip: OverlayClip; activeTab: PropTab }) {
  const update = useEditorStore((s) => s.updateOverlayClip);
  const setKf = useEditorStore((s) => s.setOverlayKeyframe);
  const removeKf = useEditorStore((s) => s.removeOverlayKeyframe);
  const playheadSec = useEditorStore((s) => s.playheadSec);
  const [pictureTab, setPictureTab] = useState<PictureSubTab>('基础');
  const t = clip.transform;
  const mask = clip.mask ?? DEFAULT_MASK;
  const patchT = (p: Partial<typeof t>) => update(clip.id, { transform: { ...t, ...p } });
  const patchMask = (p: Partial<MaskSettings>) => update(clip.id, { mask: { ...mask, ...p } });
  const localT = playheadSec - clip.startSec;
  const inRange = localT >= 0 && localT <= clip.outSec - clip.inSec;

  return (
    <>
      <p className="text-[12px] text-[var(--canvas-text-1)] font-medium truncate mb-1" title={clip.label}>{clip.label}</p>
      <p className="text-[10px] text-[var(--canvas-text-3)] mb-4">视频轨 {clip.trackIndex + 2} · {clip.kind === 'video' ? '视频' : '图片'}</p>

      {activeTab === '画面' && (
        <>
          <MiniTabs tabs={['基础', '蒙版']} active={pictureTab} onChange={setPictureTab} />
          {pictureTab === '基础' && (
            <>
              <Row label="起始时间（秒）">
                <NumInput value={clip.startSec} onCommit={(v) => update(clip.id, { startSec: v })} />
              </Row>

              <div className={SEC}>
                <span className={LABEL}>位置大小</span>
                {([
                  ['横向 X', 'x', -0.5, 0.5, 0.01],
                  ['纵向 Y', 'y', -0.5, 0.5, 0.01],
                  ['缩放', 'scale', 0.05, 1.5, 0.01],
                  ['不透明', 'opacity', 0, 1, 0.01],
                  ['旋转°', 'rotation', -180, 180, 1],
                ] as const).map(([label, key, min, max, step]) => (
                  <div key={key} className="mb-1">
                    <span className="text-[9px] text-[var(--canvas-text-3)]">{label}</span>
                    <Slider value={t[key]} min={min} max={max} step={step} onChange={(v) => patchT({ [key]: v })} />
                  </div>
                ))}
                <TransformQuickActions transform={t} onPatch={patchT} />
              </div>
            </>
          )}
          {pictureTab === '蒙版' && (
            <div className="rounded-xl border border-[var(--canvas-node-border)] bg-[rgba(255,255,255,0.035)] p-3">
              <label className="mb-3 flex items-center justify-between gap-3 text-[11px] text-[var(--canvas-text-2)]">
                <span>启用蒙版</span>
                <input
                  type="checkbox"
                  checked={mask.enabled}
                  onChange={(e) => { captureEditorSnapshot(); patchMask({ enabled: e.target.checked }); }}
                  className="accent-[#18d8df]"
                />
              </label>
              <Row label="类型">
                <select
                  value={mask.type}
                  onChange={(e) => { captureEditorSnapshot(); patchMask({ type: e.target.value as MaskSettings['type'] }); }}
                  className={INPUT}
                >
                  <option value="rect">矩形蒙版</option>
                  <option value="circle">圆形蒙版</option>
                  <option value="linear">线性蒙版</option>
                  <option value="mirror">镜面蒙版</option>
                </select>
              </Row>
              {([
                ['横向 X', 'x', -0.5, 0.5, 0.01],
                ['纵向 Y', 'y', -0.5, 0.5, 0.01],
                ['宽度', 'width', 0.05, 1, 0.01],
                ['高度', 'height', 0.05, 1, 0.01],
              ] as const).map(([label, key, min, max, step]) => (
                <Row key={key} label={label}>
                  <Slider value={mask[key]} min={min} max={max} step={step} onChange={(v) => patchMask({ [key]: v })} fmt={(v) => v.toFixed(2)} />
                </Row>
              ))}
              <label className="flex items-center gap-2 text-[11px] text-[var(--canvas-text-2)]">
                <input
                  type="checkbox"
                  checked={mask.invert}
                  onChange={(e) => { captureEditorSnapshot(); patchMask({ invert: e.target.checked }); }}
                  className="accent-[#18d8df]"
                />
                反向蒙版
              </label>
            </div>
          )}
        </>
      )}

      {activeTab === '音频' && clip.kind === 'video' && (
        <Row label={`音量 ${Math.round((clip.volume ?? 1) * 100)}%`}>
          <Slider value={clip.volume ?? 1} min={0} max={1} step={0.05} onChange={(v) => update(clip.id, { volume: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
        </Row>
      )}
      {activeTab === '音频' && clip.kind !== 'video' && (
        <p className="rounded-lg border border-[var(--canvas-node-border)] bg-black/20 px-3 py-3 text-[11px] text-[var(--canvas-text-3)]">图片层没有音频。</p>
      )}

      {activeTab === '动画' && (
        <div className={SEC}>
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[10px] text-[var(--canvas-text-3)]">关键帧（{clip.keyframes?.length ?? 0}）</span>
            <button
              onClick={() => {
                if (!inRange) return;
                captureEditorSnapshot();
                setKf(clip.id, { t: localT, x: t.x, y: t.y, scale: t.scale, opacity: t.opacity });
              }}
              disabled={!inRange}
              className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] bg-[rgba(255,255,255,0.06)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] disabled:opacity-35 transition-colors"
              title={inRange ? '在播放头位置记录当前变换' : '播放头不在本片段范围内'}
            >
              <Diamond size={9} /> 在播放头打关键帧
            </button>
          </div>
          {(clip.keyframes ?? []).map((kf) => (
            <div key={kf.t} className="flex items-center gap-2 py-1 text-[10px] text-[var(--canvas-text-2)] font-mono">
              <Diamond size={8} className="text-[var(--canvas-text-3)] shrink-0" />
              <span className="flex-1">{kf.t.toFixed(2)}s · s{kf.scale.toFixed(2)} · α{kf.opacity.toFixed(1)}</span>
              <button onClick={() => { captureEditorSnapshot(); removeKf(clip.id, kf.t); }} className="text-[var(--canvas-text-3)] hover:text-red-400"><Trash2 size={10} /></button>
            </div>
          ))}
          {(clip.keyframes?.length ?? 0) >= 2 && (
            <p className="text-[9px] text-[var(--canvas-text-3)] mt-1">≥2 个关键帧时位置/缩放/透明度按时间插值</p>
          )}
        </div>
      )}

      {activeTab === 'AI效果' && (
        <AskAiBar
          placeholder="如：让这层从右侧滑入、缩小到角落"
          buildPrompt={(wish) =>
            `请修改视频轨 ${clip.trackIndex + 2} 的片段（id=${clip.id}，素材 ${clip.path}，时间轴 ${clip.startSec.toFixed(1)}s 起）。我的要求：${wish}。先 timeline_get_state 确认，再用 timeline_update_overlay 或添加必要特效完成，不要改错轨道。`}
        />
      )}

    </>
  );
}

// ── 花字 ──────────────────────────────────────────────────────────────────────

function TextProps({ clip, activeTab }: { clip: TextClip; activeTab: PropTab }) {
  const update = useEditorStore((s) => s.updateTextClip);
  const ov = clip.styleOverrides ?? {};

  return (
    <>
      <p className="text-[12px] text-[var(--canvas-text-1)] font-medium mb-4">花字</p>

      {activeTab === '画面' && (
        <>
          <Row label="文案">
            <textarea
              value={clip.text}
              onChange={(e) => { captureEditorSnapshot(); update(clip.id, { text: e.target.value }); }}
              rows={2}
              className={`${INPUT} resize-none`}
            />
          </Row>

          <Row label="样式模板">
            <select value={clip.templateId} onChange={(e) => { captureEditorSnapshot(); update(clip.id, { templateId: e.target.value }); }} className={INPUT}>
              {TEXT_TEMPLATES.map((t) => <option key={t.id} value={t.id}>{t.category} · {t.label}</option>)}
            </select>
          </Row>

          <Row label="位置">
            <div className="flex gap-1">
              {([['top', '上'], ['center', '中'], ['bottom', '下']] as const).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => { captureEditorSnapshot(); update(clip.id, { position: v }); }}
                  className={`flex-1 py-1.5 rounded-md text-[10px] transition-colors ${
                    clip.position === v ? 'bg-[rgba(255,255,255,0.12)] text-[var(--canvas-text-1)]' : 'bg-[rgba(255,255,255,0.04)] text-[var(--canvas-text-3)]'
                  }`}
                >{label}</button>
              ))}
            </div>
          </Row>

          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <span className={LABEL}>主色</span>
              <input type="color" value={ov.color ?? '#ffffff'} onChange={(e) => { captureEditorSnapshot(); update(clip.id, { styleOverrides: { ...ov, color: e.target.value } }); }} className="w-full h-8 rounded-lg bg-transparent cursor-pointer" />
            </div>
            <div>
              <span className={LABEL}>强调色</span>
              <input type="color" value={ov.accent ?? '#e8c060'} onChange={(e) => { captureEditorSnapshot(); update(clip.id, { styleOverrides: { ...ov, accent: e.target.value } }); }} className="w-full h-8 rounded-lg bg-transparent cursor-pointer" />
            </div>
          </div>

          <Row label={`字号 ×${(ov.fontScale ?? 1).toFixed(2)}`}>
            <Slider value={ov.fontScale ?? 1} min={0.5} max={2} step={0.05} onChange={(v) => update(clip.id, { styleOverrides: { ...ov, fontScale: v } })} fmt={(v) => `${v.toFixed(2)}x`} />
          </Row>
        </>
      )}

      {activeTab === '动画' && (
        <>
          <div className="grid grid-cols-2 gap-2 mb-3">
            <div>
              <span className={LABEL}>开始（秒）</span>
              <NumInput value={clip.startSec} onCommit={(v) => update(clip.id, { startSec: v })} />
            </div>
            <div>
              <span className={LABEL}>结束（秒）</span>
              <NumInput value={clip.endSec} onCommit={(v) => update(clip.id, { endSec: Math.max(clip.startSec + 0.2, v) })} />
            </div>
          </div>
          <p className="rounded-lg border border-[var(--canvas-node-border)] bg-black/20 px-3 py-3 text-[11px] leading-5 text-[var(--canvas-text-3)]">
            花字动画由当前模板决定。需要换入场方式、逐字节奏、描边或弹跳感，可以在 AI 效果里直接说。
          </p>
        </>
      )}

      {activeTab === 'AI效果' && (
        <AskAiBar
          placeholder="如：换成更醒目的颜色、文案改短一点"
          buildPrompt={(wish) =>
            `请修改时间轴上选中的花字（id=${clip.id}，模板 ${clip.templateId}，当前文案「${clip.text}」，${clip.startSec.toFixed(1)}s-${clip.endSec.toFixed(1)}s）。我的要求：${wish}。先 timeline_get_state 确认，再用 timeline_update_text 按要求更新（可改 text/template_id/position/颜色/时间），不要新建。`}
        />
      )}
    </>
  );
}

// ── 特效 ──────────────────────────────────────────────────────────────────────

function FxProps({ clip, activeTab }: { clip: FxClip; activeTab: PropTab }) {
  const update = useEditorStore((s) => s.updateFxClip);
  const t = clip.transform ?? DEFAULT_FX_TRANSFORM;
  const patchT = (p: Partial<typeof t>) => update(clip.id, { transform: { ...t, ...p } });
  return (
    <>
      <p className="text-[12px] text-[var(--canvas-text-1)] font-medium truncate mb-1">{clip.label}</p>
      <p className="text-[10px] text-[var(--canvas-text-3)] mb-4">
        {clip.componentId ? `组件 ${clip.componentId}` : '自由特效（AI / 自定义）'}
      </p>

      {activeTab === '画面' && (
        <>
          <div className={SEC}>
            <div className="flex items-center justify-between mb-1.5">
              <span className={LABEL}>位置大小</span>
              <button
                onClick={() => { captureEditorSnapshot(); update(clip.id, { transform: DEFAULT_FX_TRANSFORM }); }}
                className="text-[10px] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-1)]"
              >
                重置
              </button>
            </div>
            {([
              ['横向 X', 'x', -1, 1, 0.01],
              ['纵向 Y', 'y', -1, 1, 0.01],
              ['缩放', 'scale', 0.05, 2, 0.01],
              ['不透明', 'opacity', 0, 1, 0.01],
              ['旋转°', 'rotation', -180, 180, 1],
            ] as const).map(([label, key, min, max, step]) => (
              <div key={key} className="mb-1">
                <span className="text-[9px] text-[var(--canvas-text-3)]">{label}</span>
                <Slider
                  value={t[key]}
                  min={min}
                  max={max}
                  step={step}
                  onChange={(v) => patchT({ [key]: v })}
                  fmt={key === 'scale' ? (v) => `${Math.round(v * 100)}%` : key === 'opacity' ? (v) => `${Math.round(v * 100)}%` : undefined}
                />
              </div>
            ))}
            <TransformQuickActions transform={t} onPatch={patchT} />
          </div>
          <ThemeSelector
            currentTheme={clip.theme}
            onSelect={(themeId) => update(clip.id, { theme: themeId })}
          />
        </>
      )}

      {activeTab === '动画' && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <span className={LABEL}>开始（秒）</span>
            <NumInput value={clip.startSec} onCommit={(v) => update(clip.id, { startSec: v })} />
          </div>
          <div>
            <span className={LABEL}>时长（秒）</span>
            <NumInput value={clip.duration} onCommit={(v) => update(clip.id, { duration: Math.max(0.5, v) })} />
          </div>
        </div>
      )}

      {activeTab === 'AI效果' && (
        <AskAiBar
          placeholder="如：数字改成 980、配色换冷色调"
          buildPrompt={(wish) =>
            `请修改时间轴上选中的特效（id=${clip.id}${clip.componentId ? `，组件 ${clip.componentId}，参数 ${JSON.stringify(clip.params ?? {})}` : '，自由特效'}，${clip.startSec.toFixed(1)}s 起 ${clip.duration.toFixed(1)}s）。我的要求：${wish}。先 timeline_get_state 确认，再用 timeline_update_fx 按要求更新该特效的参数/主题/时间，不要新建。`}
        />
      )}
    </>
  );
}

const THEME_GROUPS: ThemeGroup[] = ['经典', '自然', '时尚', '商务', '节日'];

function ThemeSelector({ currentTheme, onSelect }: { currentTheme?: string; onSelect: (id: string) => void }) {
  return (
    <div className="mb-3">
      <span className={LABEL}>主题配色</span>
      {THEME_GROUPS.map((group) => {
        const themes = FX_THEMES.filter((t) => t.group === group);
        if (themes.length === 0) return null;
        return (
          <div key={group} className="mb-2">
            <p className="text-[9px] text-[var(--canvas-text-3)] mb-1">{group}</p>
            <div className="flex gap-1 flex-wrap">
              {themes.map((t) => (
                <button
                  key={t.id}
                  onClick={() => { captureEditorSnapshot(); onSelect(t.id); }}
                  className={`flex items-center gap-1.5 px-2 py-1 rounded-md text-[9px] transition-colors ${
                    currentTheme === t.id
                      ? 'bg-[rgba(255,255,255,0.14)] text-[var(--canvas-text-1)]'
                      : 'bg-[rgba(255,255,255,0.04)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
                  }`}
                  title={t.label}
                >
                  <span
                    className="w-3 h-3 rounded-full shrink-0 border border-[rgba(255,255,255,0.1)]"
                    style={{ background: `linear-gradient(135deg, ${t.accent}, ${t.accent2 ?? t.accent})` }}
                  />
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 音频 ──────────────────────────────────────────────────────────────────────

function AudioProps({ clip }: { clip: AudioClip }) {
  const update = useEditorStore((s) => s.updateAudioClip);
  const kind = useEditorStore((s) => s.audioTracks.find((t) => t.id === clip.trackId)?.kind);
  return (
    <>
      <p className="text-[12px] text-[var(--canvas-text-1)] font-medium truncate mb-1" title={clip.label}>{clip.label}</p>
      <p className="text-[10px] text-[var(--canvas-text-3)] mb-4">{kind === 'bgm' ? '背景音乐' : kind === 'sfx' ? '音效' : '旁白'}{clip.source === 'record' ? ' · 录音' : clip.source === 'tts' ? ' · 配音' : ''}</p>

      <Row label="起始时间（秒）">
        <NumInput value={clip.startSec} onCommit={(v) => update(clip.id, { startSec: v })} />
      </Row>

      <Row label={`音量 ${Math.round(clip.volume * 100)}%`}>
        <Slider value={clip.volume} min={0} max={1} step={0.05} onChange={(v) => update(clip.id, { volume: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
      </Row>

      <div className="grid grid-cols-2 gap-2 mb-3">
        <div>
          <span className={LABEL}>淡入（秒）</span>
          <NumInput value={clip.fadeInSec ?? 0} onCommit={(v) => update(clip.id, { fadeInSec: v })} />
        </div>
        <div>
          <span className={LABEL}>淡出（秒）</span>
          <NumInput value={clip.fadeOutSec ?? 0} onCommit={(v) => update(clip.id, { fadeOutSec: v })} />
        </div>
      </div>

      <label className="flex items-center gap-2 text-[11px] text-[var(--canvas-text-2)] cursor-pointer">
        <input type="checkbox" checked={clip.loop ?? false} onChange={(e) => { captureEditorSnapshot(); update(clip.id, { loop: e.target.checked }); }} className="accent-white" />
        循环至成片结束
      </label>
    </>
  );
}

// ── 字幕 ──────────────────────────────────────────────────────────────────────

function SubtitleProps({ cue, activeTab }: { cue: SubtitleCue; activeTab: PropTab }) {
  const update = useEditorStore((s) => s.updateSubtitle);
  const style = cue.style ?? {};
  return (
    <>
      <p className="text-[12px] text-[var(--canvas-text-1)] font-medium mb-4">字幕</p>

      {activeTab === '画面' && (
        <>
          <Row label="文本">
            <textarea
              value={cue.text}
              onChange={(e) => { captureEditorSnapshot(); update(cue.id, { text: e.target.value }); }}
              rows={2}
              className={`${INPUT} resize-none`}
            />
          </Row>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className={LABEL}>字号</span>
              <NumInput value={style.fontSize ?? 22} step={1} min={10} onCommit={(v) => update(cue.id, { style: { ...style, fontSize: v } })} />
            </div>
            <div>
              <span className={LABEL}>颜色</span>
              <input type="color" value={style.color ?? '#ffffff'} onChange={(e) => { captureEditorSnapshot(); update(cue.id, { style: { ...style, color: e.target.value } }); }} className="w-full h-8 rounded-lg bg-transparent cursor-pointer" />
            </div>
          </div>
        </>
      )}

      {activeTab === '动画' && (
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div>
            <span className={LABEL}>开始（秒）</span>
            <NumInput value={cue.startSec} onCommit={(v) => update(cue.id, { startSec: v })} />
          </div>
          <div>
            <span className={LABEL}>结束（秒）</span>
            <NumInput value={cue.endSec} onCommit={(v) => update(cue.id, { endSec: Math.max(cue.startSec + 0.2, v) })} />
          </div>
        </div>
      )}
    </>
  );
}

function DraftProps({
  aspect,
  exportSettings,
  clipsCount,
  textCount,
  fxCount,
  proxyCount,
}: {
  aspect: EditorAspect;
  exportSettings: ExportSettings;
  clipsCount: number;
  textCount: number;
  fxCount: number;
  proxyCount: number;
}) {
  const setAspect = useEditorStore((s) => s.setAspect);
  const setExportSettings = useEditorStore((s) => s.setExportSettings);
  const setDraftAspect = (next: EditorAspect) => {
    if (next === aspect) return;
    captureEditorSnapshot();
    setAspect(next);
  };
  const patchExport = (patch: Partial<ExportSettings>) => {
    captureEditorSnapshot();
    setExportSettings(patch);
  };
  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3">
        <div className="grid grid-cols-[86px_1fr] gap-2 text-[11px] leading-5">
          <span className="text-[var(--canvas-text-3)]">草稿名称</span>
          <span className="text-[var(--canvas-text-2)]">时间线 01</span>
          <span className="text-[var(--canvas-text-3)]">视频片段</span>
          <span className="text-[var(--canvas-text-2)]">{clipsCount} 段</span>
          <span className="text-[var(--canvas-text-3)]">花字 / 特效</span>
          <span className="text-[var(--canvas-text-2)]">{textCount} / {fxCount}</span>
          <span className="text-[var(--canvas-text-3)]">代理模式</span>
          <span className="text-[var(--canvas-text-2)]">{proxyCount > 0 ? `已生成 ${proxyCount} 个` : '未开启'}</span>
        </div>
      </div>

      <div className="rounded-xl border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.03)] p-3">
        <p className="mb-3 text-[11px] font-medium text-[var(--canvas-text-1)]">工程设置</p>
        <Row label="画幅">
          <select
            value={aspect}
            onChange={(e) => setDraftAspect(e.target.value as EditorAspect)}
            className={INPUT}
          >
            {EDITOR_ASPECT_OPTIONS.map((opt) => (
              <option key={opt.id} value={opt.id}>{opt.label}</option>
            ))}
          </select>
        </Row>
        <div className="grid grid-cols-2 gap-2">
          <Row label="分辨率">
            <select
              value={exportSettings.resolution}
              onChange={(e) => patchExport({ resolution: e.target.value as ExportSettings['resolution'] })}
              className={INPUT}
            >
              {Object.keys(EXPORT_RESOLUTIONS).map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </Row>
          <Row label="帧率">
            <select
              value={exportSettings.fps}
              onChange={(e) => patchExport({ fps: Number(e.target.value) as ExportSettings['fps'] })}
              className={INPUT}
            >
              {[24, 30, 60].map((fps) => <option key={fps} value={fps}>{fps}fps</option>)}
            </select>
          </Row>
        </div>
      </div>
    </div>
  );
}

// ── 主组件 ────────────────────────────────────────────────────────────────────

export default function PropertiesPanel({ width = 340 }: { width?: number }) {
  const [activeTab, setActiveTab] = useState<PropTab>('画面');
  const clips = useEditorStore((s) => s.clips);
  const overlayClips = useEditorStore((s) => s.overlayClips);
  const textClips = useEditorStore((s) => s.textClips);
  const fxClips = useEditorStore((s) => s.fxClips);
  const audioClips = useEditorStore((s) => s.audioClips);
  const subtitles = useEditorStore((s) => s.subtitles);
  const selectedClipId = useEditorStore((s) => s.selectedClipId);
  const selectedOverlayId = useEditorStore((s) => s.selectedOverlayId);
  const selectedTextId = useEditorStore((s) => s.selectedTextId);
  const selectedFxId = useEditorStore((s) => s.selectedFxId);
  const selectedAudioClipId = useEditorStore((s) => s.selectedAudioClipId);
  const selectedSubtitleId = useEditorStore((s) => s.selectedSubtitleId);
  const playheadSec = useEditorStore((s) => s.playheadSec);
  const addSubtitle = useEditorStore((s) => s.addSubtitle);
  const selectSubtitle = useEditorStore((s) => s.selectSubtitle);
  const aspect = useEditorStore((s) => s.aspect);
  const exportSettings = useEditorStore((s) => s.exportSettings);
  const proxyPaths = useEditorStore((s) => s.proxyPaths);

  const clip = clips.find((c) => c.id === selectedClipId);
  const overlay = overlayClips.find((o) => o.id === selectedOverlayId);
  const text = textClips.find((t) => t.id === selectedTextId);
  const fx = fxClips.find((f) => f.id === selectedFxId);
  const audio = audioClips.find((a) => a.id === selectedAudioClipId);
  const subtitle = subtitles.find((s) => s.id === selectedSubtitleId);
  const title = clip ? '视频参数'
    : overlay ? '视频轨参数'
    : text ? '花字参数'
    : fx ? '特效参数'
    : audio ? '音频参数'
    : subtitle ? '字幕参数'
    : '草稿参数';
  const tabs: PropTab[] = clip
    ? ['画面', '音频', '变速', '动画', '调整', 'AI效果']
    : overlay
      ? ['画面', '音频', '动画', 'AI效果']
      : text
        ? ['画面', '动画', 'AI效果']
        : fx
          ? ['画面', '动画', 'AI效果']
          : audio
            ? ['音频']
            : subtitle
              ? ['画面', '动画']
              : ['画面'];
  const currentTab = tabs.includes(activeTab) ? activeTab : tabs[0];

  useEffect(() => {
    if (!tabs.includes(activeTab)) setActiveTab(tabs[0]);
  }, [activeTab, tabs]);

  return (
    <div className="shrink-0 overflow-y-auto rounded-xl border border-[var(--canvas-node-border)]" style={{ width, background: 'var(--canvas-panel)' }}>
      <div className="sticky top-0 z-10 px-4 py-3 border-b border-[rgba(255,255,255,0.06)]" style={{ background: 'var(--canvas-panel)' }}>
        <p className="text-[13px] font-semibold text-[var(--canvas-text-1)]">{title}</p>
        <p className="mt-0.5 text-[9px] text-[var(--canvas-text-3)]">
          {clip?.label ?? overlay?.label ?? text?.text ?? fx?.label ?? audio?.label ?? subtitle?.text ?? '时间线 01'}
        </p>
        <PropTabs tabs={tabs} active={currentTab} onChange={setActiveTab} />
      </div>
      <div className="px-4 py-4">
        {clip ? <ClipProps clip={clip} activeTab={currentTab} />
          : overlay ? <OverlayProps clip={overlay} activeTab={currentTab} />
          : text ? <TextProps clip={text} activeTab={currentTab} />
          : fx ? <FxProps clip={fx} activeTab={currentTab} />
          : audio ? <AudioProps clip={audio} />
          : subtitle ? <SubtitleProps cue={subtitle} activeTab={currentTab} />
          : (
            <div className="space-y-4">
              <DraftProps
                aspect={aspect}
                exportSettings={exportSettings}
                clipsCount={clips.length}
                textCount={textClips.length}
                fxCount={fxClips.length}
                proxyCount={Object.keys(proxyPaths).length}
              />
              <button
                onClick={() => {
                  captureEditorSnapshot();
                  const id = addSubtitle({ startSec: playheadSec, endSec: playheadSec + 2, text: '新字幕' });
                  selectSubtitle(id);
                }}
                className="flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-lg text-[11px] border border-[var(--canvas-node-border)] text-[var(--canvas-text-2)] hover:text-[var(--canvas-text-1)] hover:bg-[rgba(255,255,255,0.05)] transition-colors"
              >
                <Type size={12} /> 在播放头加字幕
              </button>
            </div>
          )}
      </div>
    </div>
  );
}
