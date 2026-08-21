import { useEffect, useMemo } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { buildFxClipDoc, buildTextClipDoc, renderFxTimelineLayer } from '@/lib/editor/fxRender';
import { EXPORT_RESOLUTIONS } from '@/stores/editorStore';
import { aspectOutputSize } from '@/lib/editor/aspect';

let prerenderBusy = false;

export function useEditorPrerender(): void {
  const textClips = useEditorStore((s) => s.textClips);
  const fxClips = useEditorStore((s) => s.fxClips);
  const settings = useEditorStore((s) => s.exportSettings);
  const aspect = useEditorStore((s) => s.aspect);
  const totalDuration = useEditorStore((s) => s.totalDuration());

  const signature = useMemo(() => JSON.stringify({
    text: textClips.map((t) => [t.id, t.text, t.templateId, t.startSec, t.endSec, t.position, t.styleOverrides]),
    fx: fxClips.map((f) => [f.id, f.label, f.html, f.css, f.startSec, f.duration, f.theme, f.params]),
    fps: settings.fps,
    resolution: settings.resolution,
    aspect,
    duration: Number(totalDuration.toFixed(2)),
  }), [textClips, fxClips, settings.fps, settings.resolution, aspect, totalDuration]);

  useEffect(() => {
    if (textClips.length + fxClips.length === 0 || totalDuration <= 0.05) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      if (prerenderBusy) return;
      prerenderBusy = true;
      void (async () => {
        try {
          const res = EXPORT_RESOLUTIONS[settings.resolution];
          const { width } = aspectOutputSize(aspect, res);
          const fxW = Math.min(width, 1920);
          const items = [
            ...textClips.map((t) => ({
              id: t.id,
              startSec: t.startSec,
              durationSec: Math.max(0.2, t.endSec - t.startSec),
              doc: buildTextClipDoc(t),
            })),
            ...fxClips.map((f) => ({
              id: f.id,
              startSec: f.startSec,
              durationSec: Math.max(0.2, f.duration),
              doc: buildFxClipDoc(f),
            })),
          ];
          const layer = await renderFxTimelineLayer(items, fxW, settings.fps, Math.max(0.2, totalDuration), controller.signal);
          if (!layer || controller.signal.aborted) return;
          const st = useEditorStore.getState();
          for (const t of textClips) st.updateTextClip(t.id, { renderCachePath: layer.framesDir });
          for (const f of fxClips) st.updateFxClip(f.id, { renderCachePath: layer.framesDir });
        } catch {
          // 后台预渲染是优化项，失败不打扰用户；正式导出会重试并展示错误。
        } finally {
          prerenderBusy = false;
        }
      })();
    }, 1500);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);
}
