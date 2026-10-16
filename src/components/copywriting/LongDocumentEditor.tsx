import { forwardRef, memo, useEffect, useImperativeHandle, useRef } from 'react';
import { EditorSelection, EditorState, Transaction } from '@codemirror/state';
import {
  drawSelection,
  EditorView,
  highlightActiveLine,
  keymap,
  placeholder as editorPlaceholder,
} from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, redo, undo } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';

export interface LongDocumentSelection {
  text: string;
  start: number;
  end: number;
  rect: DOMRect;
}

export interface LongDocumentEditorHandle {
  snapshot(): { value: string; selectionStart: number; selectionEnd: number };
  replaceDocument(value: string, selectionStart: number, selectionEnd: number): void;
  focusRange(start: number, end: number): void;
  undo(): void;
  redo(): void;
  flush(): void;
}

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSelectionChange: (selection: LongDocumentSelection | null) => void;
  placeholder?: string;
}

const WRITEBACK_DELAY_MS = 120;
const LARGE_DOCUMENT_WRITEBACK_DELAY_MS = 400;
const LARGE_DOCUMENT_THRESHOLD = 100_000;

function wrapSelection(view: EditorView, before: string, after = before) {
  const range = view.state.selection.main;
  const selected = view.state.sliceDoc(range.from, range.to);
  view.dispatch({
    changes: { from: range.from, to: range.to, insert: before + selected + after },
    selection: EditorSelection.range(range.from + before.length, range.to + before.length),
    scrollIntoView: true,
  });
  return true;
}

const editorTheme = EditorView.theme({
  '&': {
    height: '100%',
    backgroundColor: 'transparent',
    color: 'var(--cw-text)',
    fontSize: '16px',
  },
  '.cm-scroller': {
    overflow: 'auto',
    fontFamily: "'Inter', 'PingFang SC', '-apple-system', 'Segoe UI', sans-serif",
    lineHeight: '1.85',
  },
  '.cm-content': {
    maxWidth: '720px',
    width: '100%',
    minHeight: '100%',
    margin: '0 auto',
    padding: '40px 32px 55vh',
    caretColor: '#111827',
  },
  '.cm-line': { padding: '0' },
  '.cm-focused': { outline: 'none' },
  '.cm-activeLine': { backgroundColor: 'rgba(0,0,0,0.018)' },
  '.cm-selectionBackground, &.cm-focused .cm-selectionBackground': {
    backgroundColor: 'rgba(59, 130, 246, 0.16) !important',
  },
  '.cm-search': {
    backgroundColor: '#fff',
    border: '1px solid var(--cw-border)',
    borderRadius: '10px',
    boxShadow: '0 8px 24px rgba(0,0,0,0.1)',
    margin: '8px',
    padding: '6px',
  },
  '.cm-search input': {
    border: '1px solid var(--cw-border)',
    borderRadius: '6px',
    padding: '3px 7px',
    outline: 'none',
  },
  '.cm-placeholder': { color: 'var(--cw-text-muted)' },
});

const LongDocumentEditor = memo(forwardRef<LongDocumentEditorHandle, Props>(function LongDocumentEditor({
  value,
  onChange,
  onSelectionChange,
  placeholder = '开始写作…',
}, ref) {
  const mountRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectionRef = useRef(onSelectionChange);
  const externalValueRef = useRef(value);
  const emittedValueRef = useRef<string | null>(null);
  const pendingValueRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suppressWritebackRef = useRef(false);

  onChangeRef.current = onChange;
  onSelectionRef.current = onSelectionChange;

  const flush = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    const pending = pendingValueRef.current;
    pendingValueRef.current = null;
    if (pending == null || pending === externalValueRef.current) return;
    emittedValueRef.current = pending;
    onChangeRef.current(pending);
  };

  useImperativeHandle(ref, () => ({
    snapshot: () => {
      const view = viewRef.current;
      if (!view) return { value: externalValueRef.current, selectionStart: 0, selectionEnd: 0 };
      const range = view.state.selection.main;
      return { value: view.state.doc.toString(), selectionStart: range.from, selectionEnd: range.to };
    },
    replaceDocument: (next, selectionStart, selectionEnd) => {
      const view = viewRef.current;
      if (!view) return;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
      pendingValueRef.current = null;
      emittedValueRef.current = next;
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: next },
        selection: EditorSelection.range(selectionStart, selectionEnd),
        scrollIntoView: true,
      });
      flush();
    },
    focusRange: (start, end) => {
      const view = viewRef.current;
      if (!view) return;
      const safeStart = Math.max(0, Math.min(start, view.state.doc.length));
      const safeEnd = Math.max(safeStart, Math.min(end, view.state.doc.length));
      view.focus();
      view.dispatch({ selection: EditorSelection.range(safeStart, safeEnd), scrollIntoView: true });
    },
    undo: () => { const view = viewRef.current; if (view) undo(view); },
    redo: () => { const view = viewRef.current; if (view) redo(view); },
    flush,
  }));

  useEffect(() => {
    const parent = mountRef.current;
    if (!parent) return;
    const view = new EditorView({
      parent,
      state: EditorState.create({
        doc: value,
        extensions: [
          history(),
          markdown(),
          drawSelection(),
          highlightActiveLine(),
          highlightSelectionMatches(),
          editorPlaceholder(placeholder),
          EditorView.lineWrapping,
          EditorView.contentAttributes.of({
            'aria-label': '文稿正文',
            'data-placeholder': placeholder,
          }),
          keymap.of([
            { key: 'Mod-b', run: current => wrapSelection(current, '**') },
            { key: 'Mod-i', run: current => wrapSelection(current, '*') },
            { key: 'Mod-u', run: current => wrapSelection(current, '<u>', '</u>') },
            { key: 'Mod-Shift-s', run: current => wrapSelection(current, '~~') },
            ...searchKeymap,
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          EditorView.updateListener.of(update => {
            if (update.docChanged && !suppressWritebackRef.current) {
              pendingValueRef.current = update.state.doc.toString();
              if (timerRef.current) clearTimeout(timerRef.current);
              timerRef.current = setTimeout(
                flush,
                update.state.doc.length >= LARGE_DOCUMENT_THRESHOLD
                  ? LARGE_DOCUMENT_WRITEBACK_DELAY_MS
                  : WRITEBACK_DELAY_MS,
              );
            }
            if (update.selectionSet || update.docChanged) {
              const range = update.state.selection.main;
              if (range.empty) {
                onSelectionRef.current(null);
              } else {
                const coords = update.view.coordsAtPos(range.head) ?? update.view.dom.getBoundingClientRect();
                onSelectionRef.current({
                  text: update.state.sliceDoc(range.from, range.to),
                  start: range.from,
                  end: range.to,
                  rect: new DOMRect(coords.left, coords.top, Math.max(1, coords.right - coords.left), Math.max(20, coords.bottom - coords.top)),
                });
              }
            }
          }),
          EditorView.domEventHandlers({ blur: () => { flush(); return false; } }),
          editorTheme,
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      flush();
      view.destroy();
      viewRef.current = null;
    };
  // The editor owns its document. Prop synchronization is handled below so
  // unrelated React renders never recreate the viewport or undo history.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || value === externalValueRef.current) return;
    if (value === emittedValueRef.current) {
      externalValueRef.current = value;
      emittedValueRef.current = null;
      return;
    }
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
    pendingValueRef.current = null;
    externalValueRef.current = value;
    emittedValueRef.current = null;
    suppressWritebackRef.current = true;
    try {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: value },
        annotations: Transaction.addToHistory.of(false),
      });
    } finally {
      suppressWritebackRef.current = false;
    }
  }, [value]);

  return <div ref={mountRef} className="h-full min-h-0 w-full" />;
}));

export default LongDocumentEditor;
