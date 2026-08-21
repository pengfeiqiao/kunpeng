/**
 * useSlashMenu — "/" quick-template menu for prompt inputs (LibTV pattern).
 * Triggers when "/" is typed at line start or after whitespace; navigates
 * with arrows, inserts with Enter. Independent from @ mention (different
 * trigger chars, both can coexist on the same textarea).
 */
import { useEffect, useState } from 'react';
import { getPromptTemplates, type PromptTemplate } from '@/lib/canvas/promptTemplates';

export function useSlashMenu(kind: 'image' | 'video') {
  const [templates, setTemplates] = useState<PromptTemplate[]>([]);
  const [show, setShow] = useState(false);
  const [idx, setIdx] = useState(0);
  const [slashPos, setSlashPos] = useState(0);

  useEffect(() => {
    void getPromptTemplates(kind).then(setTemplates);
  }, [kind]);

  /** Call from onChange with the new text + caret position. */
  const handleInputChange = (text: string, caret: number) => {
    const before = text.slice(0, caret);
    const m = /(?:^|\s)\/$/.exec(before);
    if (m) {
      setSlashPos(caret - 1);
      setIdx(0);
      setShow(true);
    } else if (show) {
      setShow(false);
    }
  };

  /** Returns the new text with the template body replacing the "/". */
  const select = (tpl: PromptTemplate, currentText: string): string => {
    const before = currentText.slice(0, slashPos);
    const after = currentText.slice(slashPos + 1);
    setShow(false);
    return before + tpl.body + after;
  };

  /** Returns true when the event was consumed by the menu. */
  const handleKeyDown = (e: React.KeyboardEvent): boolean => {
    if (!show || templates.length === 0) return false;
    if (e.key === 'ArrowDown') { e.preventDefault(); setIdx((i) => (i + 1) % templates.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setIdx((i) => (i - 1 + templates.length) % templates.length); return true; }
    if (e.key === 'Enter') { e.preventDefault(); return true; } // caller invokes select()
    if (e.key === 'Escape') { e.preventDefault(); setShow(false); return true; }
    return false;
  };

  return { templates, show, idx, handleInputChange, handleKeyDown, select, close: () => setShow(false) };
}
