/**
 * StyleSelector — 工坊风格设定：风格库图片选择 + 自定义风格文本。
 * 写入 workshopStore.data.style；拆解/提示词 prompt 经 buildStyleSection 注入。
 */
import { useState } from 'react';
import { Palette, X } from 'lucide-react';
import { useWorkshopStore } from '@/stores/workshopStore';
import { loadStyleLibrary } from '@/lib/styleLibrary';
import { loadMidjourneyStyleLibrary, type MidjourneyStylePreset } from '@/lib/midjourney/styles';
import { MIDJOURNEY_DEFAULT_VERSION } from '@/lib/midjourney/prompt';
import StyleLibraryPicker from '@/components/canvas/StyleLibraryPicker';
import type { StylePreset } from '@/lib/styleLibrary';

/** 拼当前项目的风格 prompt 段（结构化 DNA），供发 prompt 前调用。 */
export async function buildStyleSection(options: { includeMidjourney?: boolean } = {}): Promise<string> {
  const style = useWorkshopStore.getState().data?.style;
  if (!style) return '';
  if (style.library === 'midjourney' && options.includeMidjourney === false) return '';

  const parts: string[] = [];

  if (style.styleLibraryRef) {
    const lib = style.library === 'midjourney'
      ? await loadMidjourneyStyleLibrary()
      : await loadStyleLibrary();
    const preset = lib.styles.find(s => s.name === style.styleLibraryRef);
    if (preset?.visualDNA) {
      parts.push(`\n## 风格参考：${preset.name}（贯穿所有产出）`);
      parts.push(`\n### 视觉基因\n${preset.visualDNA}`);
      if (preset.cameraLanguage) parts.push(`\n### 镜头语言\n${preset.cameraLanguage}`);
      if (preset.promptSuffix) parts.push(`\n### 英文提示词后缀\n${preset.promptSuffix}`);
    } else if (style.styleLibraryPrompt) {
      parts.push(`\n## 风格参考：${preset?.name || style.styleLibraryRef}\n${style.styleLibraryPrompt}`);
    }
  }

  const kw = [...(style.keywords ?? []), style.customText ?? ''].filter(Boolean).join('，');
  if (kw) parts.push(`\n## 风格关键词\n${kw}`);
  return parts.join('\n');
}

export default function StyleSelector() {
  const data = useWorkshopStore((s) => s.data);
  const style = useWorkshopStore((s) => s.data?.style);
  const setStyle = useWorkshopStore((s) => s.setStyle);
  const [showStyleLib, setShowStyleLib] = useState(false);
  const hasMidjourneyAssets = [
    ...(data?.characters ?? []),
    ...(data?.scenes ?? []),
    ...(data?.props ?? []),
    ...(data?.colorPalettes ?? []),
  ].some((item) => item.assetEngine?.startsWith('midjourney'));
  const library: 'general' | 'midjourney' = style?.library
    ?? (hasMidjourneyAssets ? 'midjourney' : 'general');

  return (
    <div className="relative">
      <div
        className="flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl border border-[var(--canvas-node-border)]"
        style={{ background: 'rgba(255,255,255,0.02)' }}
      >
        <Palette size={13} className="text-[var(--canvas-text-3)] shrink-0" />
        <span className="text-[11px] text-[var(--canvas-text-2)] shrink-0">风格</span>
        <div className="flex rounded-lg border border-[var(--canvas-node-border)] p-0.5">
          {(['general', 'midjourney'] as const).map((value) => (
            <button
              key={value}
              onClick={() => setStyle({ ...style, keywords: style?.keywords ?? [], library: value, styleLibraryRef: undefined, styleLibraryPrompt: undefined, midjourneyStyleId: undefined })}
              className={`px-2 py-0.5 rounded-md text-[9px] transition-colors ${library === value ? 'bg-[rgba(255,255,255,0.1)] text-[var(--canvas-text-1)]' : 'text-[var(--canvas-text-3)]'}`}
            >
              {value === 'midjourney' ? 'MJ 专属' : '通用'}
            </button>
          ))}
        </div>
        <button
          onClick={() => setShowStyleLib((v) => !v)}
          className={`px-2.5 py-1 rounded-lg text-[10px] border transition-colors ${
            showStyleLib || style?.styleLibraryRef
              ? 'bg-[rgba(31,162,220,0.1)] border-[rgba(31,162,220,0.4)] text-[var(--canvas-accent)]'
              : 'border-[var(--canvas-node-border)] text-[var(--canvas-text-3)] hover:text-[var(--canvas-text-2)]'
          }`}
        >
          风格库
        </button>
        {style?.styleLibraryRef && (
          <div className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-[rgba(31,162,220,0.1)] text-[10px] text-[var(--canvas-accent)] shrink-0">
            <Palette size={10} />
            <span className="max-w-[80px] truncate">{style.styleLibraryRef}</span>
            <button onClick={() => setStyle({ ...style, keywords: style?.keywords ?? [], styleLibraryRef: undefined, styleLibraryPrompt: undefined })} className="hover:text-white"><X size={8} /></button>
          </div>
        )}
        <input
          value={style?.customText ?? ''}
          onChange={(e) => setStyle({ ...style, keywords: style?.keywords ?? [], customText: e.target.value })}
          placeholder="自定义风格关键词（如：电影感写实、柔和布光、胶片质感）"
          className="flex-1 px-2.5 py-1 rounded-lg bg-[rgba(255,255,255,0.05)] border border-[var(--canvas-node-border)] text-[11px] text-[var(--canvas-text-1)] focus:outline-none placeholder:text-[var(--canvas-text-3)]"
        />
      </div>
      <StyleLibraryPicker
        open={showStyleLib}
        library={library}
        onClose={() => setShowStyleLib(false)}
        onApply={(preset: StylePreset) => {
          const mjPreset = preset.library === 'midjourney' ? preset as MidjourneyStylePreset : undefined;
          setStyle({
            ...style,
            keywords: style?.keywords ?? [],
            directorRef: undefined,
            styleLibraryRef: preset.name,
            styleLibraryPrompt: preset.promptTemplate,
            library: preset.library === 'midjourney' ? 'midjourney' : 'general',
            midjourneyStyleId: mjPreset?.id,
            midjourneyVersion: mjPreset?.recommendedVersion ?? (mjPreset ? MIDJOURNEY_DEFAULT_VERSION : undefined),
            midjourneyStylize: mjPreset?.stylize,
            midjourneyChaos: mjPreset?.chaos,
            midjourneyRaw: mjPreset?.raw,
            midjourneyStyleWeight: mjPreset?.styleWeight,
            midjourneyImageWeight: mjPreset?.imageWeight,
            midjourneyWeird: mjPreset?.weird,
          });
          setShowStyleLib(false);
        }}
        onClear={() => {
          setStyle({ ...style, keywords: style?.keywords ?? [], styleLibraryRef: undefined, styleLibraryPrompt: undefined });
        }}
      />
    </div>
  );
}
