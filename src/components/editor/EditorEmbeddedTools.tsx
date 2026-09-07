import { useState } from 'react';
import { Download, MoreHorizontal, SlidersHorizontal, Sparkles, Subtitles } from 'lucide-react';
import { useEditorStore } from '@/stores/editorStore';
import { EDITOR_ASPECT_OPTIONS } from '@/lib/editor/aspect';
import { motionRouterPrompt } from '@/lib/motion/motionPrompt';
import { dispatchEditorPrompt } from './EditorChatPanel';
import ExportDialog from './ExportDialog';

/** Top-bar-only commands remain available next to the timeline in a shared project shell. */
export default function EditorEmbeddedTools({ onAutoSubtitle, onSmartCut, onAiSmooth, transcribing }: {
  onAutoSubtitle: () => void;
  onSmartCut: () => void;
  onAiSmooth: () => void;
  transcribing: boolean;
}) {
  const hasVideo = useEditorStore((state) => state.clips.length > 0);
  const hasContent = useEditorStore((state) => state.clips.length + state.overlayClips.length + state.textClips.length
    + state.fxClips.length + state.audioClips.length + state.subtitles.length > 0);
  const aspect = useEditorStore((state) => state.aspect);
  const mode = useEditorStore((state) => state.workflowMode);
  const [open, setOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  return <div className="shrink-0 relative" style={{ fontSize: 13, background: '#202224', color: '#dedfe1' }}>
    <button type="button" title="剪辑工具" aria-label="剪辑工具" aria-expanded={open} onClick={() => setOpen(!open)}
      style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 10px', fontSize: 13 }}><MoreHorizontal size={16} />剪辑工具</button>
    {open && <div role="group" aria-label="剪辑工具选项" className="flex flex-wrap items-center gap-2 p-2 border-t border-white/10" style={{ fontSize: 13 }}>
      <select aria-label="剪辑模式" value={mode} onChange={(event) => useEditorStore.getState().setWorkflowMode(event.target.value as typeof mode)} style={{ background: '#292d30', padding: 6, borderRadius: 4, fontSize: 13 }}>
        <option value="edit">剪辑</option><option value="speech">口播</option><option value="ai">AI 成片</option>
      </select>
      <select aria-label="剪辑画幅" value={aspect} onChange={(event) => useEditorStore.getState().setAspect(event.target.value as typeof aspect)} style={{ background: '#292d30', padding: 6, borderRadius: 4, fontSize: 13 }}>
        {EDITOR_ASPECT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      {[
        { icon: Subtitles, label: '自动字幕', run: onAutoSubtitle, disabled: !hasVideo || transcribing },
        { icon: SlidersHorizontal, label: '智能剪口播', run: onSmartCut, disabled: !hasVideo || transcribing },
        { icon: Sparkles, label: 'AI 剪流畅', run: onAiSmooth, disabled: !hasVideo },
        { icon: Sparkles, label: 'AI 配特效', run: () => dispatchEditorPrompt(motionRouterPrompt()), disabled: !hasContent },
        { icon: Download, label: '导出', run: () => setExportOpen(true), disabled: !hasContent },
      ].map(({ icon: Icon, label, run, disabled }) => <button key={label} type="button" title={label} aria-label={label} disabled={disabled}
        onClick={run} className="disabled:opacity-40 hover:bg-white/10" style={{ display: 'inline-flex', justifyContent: 'center', alignItems: 'center', width: 32, height: 32, borderRadius: 4, color: '#91dbc9' }}><Icon size={16} /></button>)}
    </div>}
    {exportOpen && <ExportDialog onClose={() => setExportOpen(false)} />}
  </div>;
}
