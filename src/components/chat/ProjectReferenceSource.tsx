import { useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MessageSquarePlus } from 'lucide-react';
import type { ProjectConversationReference } from '@/lib/projectObjects/types';
import { dispatchProjectAgentContext } from '@/lib/projectObjects/conversationRefs';
import { quoteProjectReference } from '@/lib/projectObjects/referenceTransfer';
import { useWorkshopStore } from '@/stores/workshopStore';

/** Only selections inside this explicit project field can become a quote. */
export default function ProjectReferenceSource({ children, reference, projectId }: {
  children: ReactNode; reference: ProjectConversationReference; projectId: string;
}) {
  const [selection, setSelection] = useState<{ text: string; x: number; y: number } | null>(null);
  const capture = (root: HTMLDivElement, target: EventTarget, x: number, y: number) => {
    let text = '';
    if (target instanceof HTMLTextAreaElement || target instanceof HTMLInputElement) {
      if (target.type !== 'password') text = target.value.slice(target.selectionStart ?? 0, target.selectionEnd ?? 0);
    } else {
      const selected = window.getSelection();
      if (selected?.anchorNode && selected.focusNode && root.contains(selected.anchorNode) && root.contains(selected.focusNode)) text = selected.toString();
    }
    setSelection(text.trim() ? { text, x: Math.max(8, Math.min(x, window.innerWidth - 144)), y: Math.max(8, Math.min(y + 8, window.innerHeight - 44)) } : null);
  };
  return <div
    onMouseUp={(event) => capture(event.currentTarget, event.target, event.clientX, event.clientY)}
    onKeyUp={(event) => {
      if (!event.shiftKey) return;
      const rect = event.currentTarget.getBoundingClientRect();
      capture(event.currentTarget, event.target, rect.left, rect.bottom);
    }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setSelection(null); }}
  >
    {children}
    {selection && createPortal(<button type="button"
      className="fixed z-[160] flex items-center gap-1 rounded-md border border-zinc-600 bg-zinc-900 px-3 py-2 text-xs text-white shadow-lg"
      style={{ left: selection.x, top: selection.y }}
      onMouseDown={(event) => event.preventDefault()}
      onClick={() => {
        if (useWorkshopStore.getState().data?.projectId === projectId) {
          const quote = quoteProjectReference(reference, selection.text);
          if (quote) dispatchProjectAgentContext(quote);
        }
        setSelection(null);
      }}
    ><MessageSquarePlus size={14} />添加到对话</button>, document.body)}
  </div>;
}
