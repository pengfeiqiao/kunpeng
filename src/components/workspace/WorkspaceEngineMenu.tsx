import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronRight } from 'lucide-react';
import type { WorkspaceEngineChoice } from './GenerationComposer';

/** 展示层归并：文/图生、文/视频等模式变体合并为单个条目，按当前参考数量决定具体引擎 id。 */
const MERGE_GROUPS: Array<{ label: string; ids: string[] }> = [
  { label: 'Seedream 5.0 Pro', ids: ['seedream-v5-pro', 'seedream-v5-pro-i2i'] },
  { label: 'Seedance 2.0', ids: ['seedance-2.0', 'seedance-2.0-t2v', 'startend-v3.1-pro'] },
  { label: 'Seedance 2.0 Mini', ids: ['seedance-2.0-mini-i2v', 'seedance-2.0-mini-t2v'] },
];

const IMAGE_ORDER = ['gpt-image-2', 'seedream-v5-pro', 'midjourney-v8.2', 'midjourney-v8.1'];
const IMAGE_MORE = ['midjourney-v7', 'midjourney-v6.1', 'midjourney-v5.2', 'midjourney-v5.1', 'midjourney-niji7', 'midjourney-niji6'];
const VIDEO_ORDER = ['dreamina-seedance-2.5', 'seedance-2.0', 'seedance-2.0-fast', 'seedance-2.0-mini-i2v', 'wan-3.0', 'minimax-hailuo-h3'];

interface Entry { label: string; ids: string[]; choices: WorkspaceEngineChoice[] }

function buildEntries(engines: WorkspaceEngineChoice[], kind: 'image' | 'video' | 'audio'): { main: Entry[]; more: Entry[] } {
  const sameKind = engines.filter((item) => item.engine.kind === kind);
  const entries: Entry[] = [];
  const consumed = new Set<string>();
  for (const group of MERGE_GROUPS) {
    const choices = group.ids.map((id) => sameKind.find((item) => item.engine.id === id)).filter(Boolean) as WorkspaceEngineChoice[];
    if (!choices.length) continue;
    group.ids.forEach((id) => consumed.add(id));
    entries.push({ label: group.label, ids: group.ids.filter((id) => choices.some((item) => item.engine.id === id)), choices });
  }
  for (const item of sameKind) {
    if (consumed.has(item.engine.id)) continue;
    entries.push({ label: item.engine.label, ids: [item.engine.id], choices: [item] });
  }
  if (kind === 'image') {
    const rank = (entry: Entry) => {
      const index = IMAGE_ORDER.findIndex((id) => entry.ids.includes(id));
      return index === -1 ? IMAGE_ORDER.length : index;
    };
    const main = entries.filter((entry) => rank(entry) < IMAGE_ORDER.length).sort((a, b) => rank(a) - rank(b));
    const more = entries.filter((entry) => IMAGE_MORE.some((id) => entry.ids.includes(id)))
      .sort((a, b) => IMAGE_MORE.findIndex((id) => a.ids.includes(id)) - IMAGE_MORE.findIndex((id) => b.ids.includes(id)));
    return { main: [...main, ...entries.filter((entry) => !main.includes(entry) && !more.includes(entry))], more };
  }
  const rank = (entry: Entry) => {
    const index = VIDEO_ORDER.findIndex((id) => entry.ids.includes(id));
    return index === -1 ? VIDEO_ORDER.length : index;
  };
  return { main: entries.sort((a, b) => rank(a) - rank(b)), more: [] };
}

/** 选中归并条目时按参考数量落到具体引擎：有参考走 i2i/多模态，无参考走文生。 */
function resolveEngineId(entry: Entry, hasReferences: boolean, currentId: string): string {
  if (entry.ids.includes(currentId)) return currentId;
  if (entry.ids.length === 1) return entry.ids[0];
  const selectable = entry.ids.filter((id) => id !== 'startend-v3.1-pro');
  const preferred = selectable.find((id) => hasReferences ? /i2i|mini-i2v|^seedance-2\.0$/.test(id) : /t2v|mini-t2v|seedream-v5-pro$/.test(id));
  return preferred ?? selectable[0];
}

export default function WorkspaceEngineMenu({ draft, engines, disabled, onPick, adjustmentsNote }: {
  draft: { engineId: string; outputType: string; references: readonly unknown[] };
  engines: WorkspaceEngineChoice[];
  disabled?: boolean;
  onPick: (engineId: string) => void;
  adjustmentsNote?: string;
}) {
  const [open, setOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', key); };
  }, [open]);
  const kind = draft.outputType === 'video' ? 'video' : draft.outputType === 'audio' ? 'audio' : 'image';
  const { main, more } = buildEntries(engines, kind);
  const current = [...main, ...more].find((entry) => entry.ids.includes(draft.engineId));
  const currentChoice = engines.find((item) => item.engine.id === draft.engineId);
  const row = (entry: Entry) => {
    const unavailable = entry.choices.every((item) => item.unavailableReason);
    const reason = entry.choices[0]?.unavailableReason;
    const active = current === entry;
    return <button key={entry.label} role="option" aria-selected={active} disabled={disabled || unavailable}
      title={unavailable ? reason : undefined} className="workspace-engine-option"
      onClick={() => { onPick(resolveEngineId(entry, draft.references.length > 0, draft.engineId)); setOpen(false); }}>
      <span className="workspace-engine-check">{active && <Check size={13} />}</span>
      <span className="workspace-engine-name">{entry.label}</span>
      {unavailable && <span className="workspace-engine-reason">{reason}</span>}
    </button>;
  };
  return <div className="workspace-engine-menu" ref={root}>
    <button type="button" className="workspace-engine-trigger" disabled={disabled} aria-haspopup="listbox" aria-expanded={open}
      title={adjustmentsNote} onClick={() => setOpen(!open)}>
      <span>{current?.label ?? currentChoice?.engine.label ?? draft.engineId}</span>
      {currentChoice?.unavailableReason && <span className="workspace-engine-reason">不可用</span>}
      <ChevronDown size={14} />
    </button>
    {open && <div className="workspace-engine-popover" role="listbox" aria-label="生成模型">
      {main.map(row)}
      {more.length > 0 && <>
        <button type="button" className="workspace-engine-more" aria-expanded={moreOpen} onClick={() => setMoreOpen(!moreOpen)}>
          {moreOpen ? <ChevronDown size={13} /> : <ChevronRight size={13} />}Midjourney 更多版本
        </button>
        {moreOpen && more.map(row)}
      </>}
    </div>}
  </div>;
}
