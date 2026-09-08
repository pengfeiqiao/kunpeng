/**
 * MentionPromptInput — @ 引用提示词编辑器（contenteditable 单面编辑）。
 *
 * 旧方案（透明 textarea + 背景层高亮）的双层渲染会随滚动/选区/IME 出现光标跳动、
 * 无法编辑的问题。现改为单面 contenteditable：提及是真实内联芯片
 * （span[contenteditable=false]，整块原子删除），光标、选区、滚动、IME 全部走浏览器原生，
 * 没有任何同步层。@ 触发选择器，点选插入芯片；悬停芯片出缩略图。
 */
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { createPortal } from 'react-dom';
import type { WorkspaceDraft, WorkspaceReference } from '@/lib/workspace/types';
import { changeWorkspaceReferences, referenceMention } from '@/lib/workspace/drafts';
import './workspace.css';
import './promptExperience.css';

export interface MentionCandidate { id: string; path: string; label: string }

/** 命令式句柄：供外部（参考缩略图条）把 @图片N 插入光标处 */
export interface MentionPromptInputHandle { insertMention: (ref: WorkspaceReference) => void }

interface Props {
  draft: WorkspaceDraft;
  onChange: (draft: WorkspaceDraft) => void;
  candidates: MentionCandidate[];
  mediaSrc: (path: string) => string;
  ariaLabel: string;
}

const MENTION_RE = /@图片[一二三四五六七八九十百零]+/g;

function buildChipElement(ref: WorkspaceReference, mention: string, mediaSrc: (path: string) => string): HTMLSpanElement {
  const chip = document.createElement('span');
  chip.className = 'workspace-mention-chip';
  chip.contentEditable = 'false';
  chip.dataset.mention = mention;
  chip.dataset.path = ref.path;
  const img = document.createElement('img');
  img.src = mediaSrc(ref.path);
  img.alt = '';
  img.draggable = false;
  const label = document.createElement('span');
  label.textContent = mention;
  chip.append(img, label);
  return chip;
}

function promptToFragment(prompt: string, references: WorkspaceReference[], mediaSrc: (path: string) => string): DocumentFragment {
  const fragment = document.createDocumentFragment();
  let cursor = 0;
  for (const match of prompt.matchAll(MENTION_RE)) {
    if (match.index! > cursor) fragment.append(document.createTextNode(prompt.slice(cursor, match.index)));
    const ref = references.find((item) => referenceMention(item, references) === match[0]);
    if (ref) fragment.append(buildChipElement(ref, match[0], mediaSrc));
    else fragment.append(document.createTextNode(match[0]));
    cursor = match.index! + match[0].length;
  }
  if (cursor < prompt.length) fragment.append(document.createTextNode(prompt.slice(cursor)));
  return fragment;
}

/** DOM → 提示词文本：芯片还原为 @图片N，块级/换行还原为 \n */
function domToPrompt(root: HTMLElement): string {
  let out = '';
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) { out += node.textContent ?? ''; return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as HTMLElement;
    if (el.dataset.mention) { out += el.dataset.mention; return; }
    if (el.tagName === 'BR') { out += '\n'; return; }
    const block = el.tagName === 'DIV' || el.tagName === 'P';
    if (block && out && !out.endsWith('\n')) out += '\n';
    el.childNodes.forEach(walk);
  };
  root.childNodes.forEach(walk);
  return out;
}

/** 光标当前的纯文本偏移（芯片按 @图片N 长度计；Range 截取到光标处量长度，兼容根元素容器） */
function caretOffset(root: HTMLElement): number | null {
  const selection = window.getSelection();
  if (!selection || !selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.startContainer)) return null;
  const pre = document.createRange();
  pre.selectNodeContents(root);
  pre.setEnd(range.startContainer, range.startOffset);
  const holder = document.createElement('div');
  holder.append(pre.cloneContents());
  return domToPrompt(holder).length;
}

function setCaretByOffset(root: HTMLElement, target: number) {
  const selection = window.getSelection();
  if (!selection) return;
  let total = 0;
  const walk = (node: Node): boolean => {
    if (node.nodeType === Node.ELEMENT_NODE && (node as HTMLElement).dataset.mention) {
      const len = ((node as HTMLElement).dataset.mention ?? '').length;
      if (total + len >= target) {
        const range = document.createRange();
        range.setStartAfter(node); range.collapse(true);
        selection.removeAllRanges(); selection.addRange(range);
        return true;
      }
      total += len;
      return false;
    }
    if (node.nodeType === Node.TEXT_NODE) {
      const len = node.textContent?.length ?? 0;
      if (total + len >= target) {
        const range = document.createRange();
        range.setStart(node, Math.max(0, target - total)); range.collapse(true);
        selection.removeAllRanges(); selection.addRange(range);
        return true;
      }
      total += len;
      return false;
    }
    for (const child of Array.from(node.childNodes)) { if (walk(child)) return true; }
    return false;
  };
  if (!walk(root)) {
    const range = document.createRange();
    range.selectNodeContents(root); range.collapse(false);
    selection.removeAllRanges(); selection.addRange(range);
  }
}

function MentionPromptInput(props: Props, ref: Ref<MentionPromptInputHandle>) {
  const { draft, candidates } = props;
  const editorRef = useRef<HTMLDivElement>(null);
  const composing = useRef(false);
  const lastEmitted = useRef<string | null>(null);
  const lastCaret = useRef<number | null>(null);
  const [picker, setPicker] = useState<{ at: number; query: string; rect: { left: number; top: number; bottom: number } } | null>(null);
  const pickerDomRef = useRef<HTMLDivElement>(null);
  const [tip, setTip] = useState<{ ref: WorkspaceReference; x: number; y: number; below: boolean } | null>(null);

  // 外部变更（agent 优化/切换对象/撤销）才重建 DOM；自己输入产生的内容不重建
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = domToPrompt(editor);
    if (draft.prompt === current) { lastEmitted.current = draft.prompt; return; }
    if (lastEmitted.current !== null && draft.prompt === lastEmitted.current) return;
    const offset = caretOffset(editor);
    editor.replaceChildren(promptToFragment(draft.prompt, draft.references, props.mediaSrc));
    lastEmitted.current = draft.prompt;
    if (offset !== null) setCaretByOffset(editor, offset);
  }, [draft.prompt, draft.references, props.mediaSrc]);

  // 菜单打开期间：编辑器/祖先滚动或窗口变化会让 fixed 定位失锚，直接关闭（菜单自身滚动除外）
  useEffect(() => {
    if (!picker) return;
    const onScroll = (event: Event) => {
      if (pickerDomRef.current?.contains(event.target as Node)) return;
      setPicker(null);
    };
    const onResize = () => setPicker(null);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onResize);
    return () => { window.removeEventListener('scroll', onScroll, true); window.removeEventListener('resize', onResize); };
  }, [picker !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  const emitChange = () => {
    const editor = editorRef.current;
    if (!editor) return;
    const prompt = domToPrompt(editor);
    lastEmitted.current = prompt;
    props.onChange({ ...draft, prompt });
  };

  // 参考缩略图点击 → 在光标处插入 @图片N（编辑器未聚焦时追加到末尾）
  useImperativeHandle(ref, () => ({
    insertMention(target: WorkspaceReference) {
      const editor = editorRef.current;
      if (!editor) return;
      const prompt = domToPrompt(editor);
      const hadFocus = document.activeElement === editor || editor.contains(document.activeElement);
      const at = hadFocus ? (caretOffset(editor) ?? prompt.length) : (lastCaret.current ?? prompt.length);
      const mention = referenceMention(target, draft.references);
      const needsSpace = at > 0 && !/[\s\n]/.test(prompt[at - 1]);
      const inserted = `${needsSpace ? ' ' : ''}${mention} `;
      editor.replaceChildren(promptToFragment(`${prompt.slice(0, at)}${inserted}${prompt.slice(at)}`, draft.references, props.mediaSrc));
      setCaretByOffset(editor, at + inserted.length);
      const nextPrompt = domToPrompt(editor);
      lastEmitted.current = nextPrompt;
      props.onChange({ ...draft, prompt: nextPrompt });
      editor.focus({ preventScroll: true });
    },
  }));

  const syncMentionChips = () => {
    // 直接编辑（删除/移动芯片）后，references 以草稿为准只增不减；提及合法性由 workspaceDraftErrors 把关
    emitChange();
  };

  const applyMention = (candidate: MentionCandidate) => {
    const editor = editorRef.current;
    if (!editor) return;
    const at = picker?.at ?? caretOffset(editor) ?? domToPrompt(editor).length;
    // 纯文本层面删 @ 再插入芯片，避免在芯片中间落点
    const prompt = domToPrompt(editor);
    const trimmed = prompt.slice(0, at).replace(/@[^@\s]*$/, '');
    const tail = prompt.slice(at + (prompt[at] === '@' ? 1 : 0));
    const existing = draft.references.find((item) => item.path === candidate.path || item.id === candidate.id);
    const nextRefs = existing ? draft.references : [...draft.references,
      { id: candidate.id, type: 'image' as const, path: candidate.path, label: candidate.label }];
    const ref = existing ?? nextRefs[nextRefs.length - 1];
    const mention = referenceMention(ref, nextRefs);
    editor.replaceChildren(promptToFragment(`${trimmed}${mention} ${tail}`, nextRefs, props.mediaSrc));
    setCaretByOffset(editor, trimmed.length + mention.length + 1);
    const nextPrompt = domToPrompt(editor);
    lastEmitted.current = nextPrompt;
    props.onChange({ ...changeWorkspaceReferences({ ...draft, references: nextRefs }, nextRefs), prompt: nextPrompt });
    setPicker(null);
    editor.focus();
  };

  // 菜单内容：本次参考（@图片N 真实编号）+ 项目图片（尚未入参考的候选，点选即入列并插入引用）
  const imageRefs = draft.references.filter((ref) => ref.type === 'image' && ref.path);
  const extraCandidates: MentionCandidate[] = [];
  for (const candidate of candidates) {
    if (imageRefs.some((ref) => ref.id === candidate.id || ref.path === candidate.path)) continue;
    if (extraCandidates.some((item) => item.path === candidate.path)) continue;
    extraCandidates.push(candidate);
    if (extraCandidates.length >= 12) break;
  }
  const query = (picker?.query ?? '').trim().toLowerCase();
  const hit = (name: string, label: string) => !query || name.toLowerCase().includes(query) || label.toLowerCase().includes(query);
  const menuRefs = picker ? imageRefs.filter((ref) => hit(referenceMention(ref, draft.references), ref.label ?? '')) : [];
  const menuExtras = picker ? extraCandidates.filter((candidate) => hit('', candidate.label)) : [];

  return <div className="workspace-mention-root">
    <div
      ref={editorRef}
      className="workspace-prompt workspace-mention-editor"
      role="textbox"
      aria-multiline="true"
      aria-label={props.ariaLabel}
      contentEditable
      suppressContentEditableWarning
      spellCheck={false}
      onCompositionStart={() => { composing.current = true; }}
      onCompositionEnd={() => { composing.current = false; emitChange(); }}
      onInput={() => {
        if (composing.current) return;
        syncMentionChips();
        const editor = editorRef.current;
        if (!editor) return;
        const offset = caretOffset(editor);
        const prompt = domToPrompt(editor);
        if (offset !== null && prompt[offset - 1] === '@') {
          const rect = editor.getBoundingClientRect();
          setPicker({ at: offset - 1, query: '', rect: { left: rect.left, top: rect.top, bottom: rect.bottom } });
        }
        else if (picker) {
          const query = offset !== null ? prompt.slice(picker.at + 1, offset) : '';
          if (offset === null || offset <= picker.at || /[\s@]/.test(query)) setPicker(null);
          else if (query !== picker.query) setPicker({ ...picker, query });
        }
      }}
      onKeyDown={(event) => {
        if (event.key === 'Escape' && picker) { event.stopPropagation(); setPicker(null); }
      }}
      onPaste={(event) => {
        event.preventDefault();
        const text = event.clipboardData.getData('text/plain');
        document.execCommand('insertText', false, text);
      }}
      onBlur={() => { lastCaret.current = editorRef.current ? caretOffset(editorRef.current) : null; setTimeout(() => setPicker(null), 150); }}
      onScroll={() => { if (tip) setTip(null); }}
      onMouseOver={(event) => {
        const chip = (event.target as HTMLElement).closest?.('.workspace-mention-chip') as HTMLElement | null;
        if (!chip?.dataset.mention) return;
        // 芯片内部（缩略图 ↔ 文字）移动不重置浮层，避免闪烁乱飘
        if (chip.contains(event.relatedTarget as Node | null)) return;
        const ref = draft.references.find((item) => referenceMention(item, draft.references) === chip.dataset.mention)
          ?? ({ id: chip.dataset.mention!, type: 'image' as const, path: chip.dataset.path ?? '', label: chip.dataset.mention! });
        const rect = chip.getBoundingClientRect();
        // 默认出现在芯片文字正上方；贴近视口顶部时翻到下方，避免被裁掉
        const below = rect.top < 120;
        setTip({ ref, x: rect.left + rect.width / 2, y: below ? rect.bottom : rect.top, below });
      }}
      onMouseOut={(event) => {
        const chip = (event.target as HTMLElement).closest?.('.workspace-mention-chip') as HTMLElement | null;
        if (!chip) return;
        // 只在真正离开芯片（且不是进入另一个芯片）时关闭浮层
        if (chip.contains(event.relatedTarget as Node | null)) return;
        if ((event.relatedTarget as HTMLElement | null)?.closest?.('.workspace-mention-chip')) return;
        setTip(null);
      }}
    />
    {picker && (imageRefs.length > 0 || extraCandidates.length > 0) && createPortal(<div ref={pickerDomRef} className="workspace-mention-picker" role="listbox" aria-label="引用图片"
      style={(() => {
        const width = 268;
        const left = Math.max(8, Math.min(picker.rect.left + 8, window.innerWidth - width - 8));
        const above = picker.rect.top > 320 || picker.rect.top > window.innerHeight - picker.rect.bottom;
        return above
          ? { left, top: picker.rect.top - 6, transform: 'translateY(-100%)', maxHeight: Math.max(120, Math.min(288, picker.rect.top - 12)) }
          : { left, top: picker.rect.bottom + 6, maxHeight: Math.max(120, Math.min(288, window.innerHeight - picker.rect.bottom - 12)) };
      })()}>
      {menuRefs.length === 0 && menuExtras.length === 0 && <div className="workspace-mention-menu-empty">没有匹配的图片</div>}
      {menuRefs.length > 0 && <div className="workspace-mention-menu-section">本次参考</div>}
      {menuRefs.map((ref) => { const mention = referenceMention(ref, draft.references);
        return <button key={ref.id} type="button" className="workspace-mention-menu-item" role="option" aria-selected={false}
          title={`${mention} · ${ref.label}`}
          onMouseDown={(event) => { event.preventDefault(); applyMention({ id: ref.id, path: ref.path, label: ref.label }); }}>
          <img src={props.mediaSrc(ref.path)} alt="" loading="lazy" />
          <span className="workspace-mention-menu-name">{mention}</span>
          <span className="workspace-mention-menu-label">{ref.label}</span>
        </button>; })}
      {menuExtras.length > 0 && <div className="workspace-mention-menu-section">项目图片</div>}
      {menuExtras.map((candidate) => <button key={candidate.id} type="button" className="workspace-mention-menu-item" role="option" aria-selected={false}
        title={candidate.label}
        onMouseDown={(event) => { event.preventDefault(); applyMention(candidate); }}>
        <img src={props.mediaSrc(candidate.path)} alt="" loading="lazy" />
        <span className="workspace-mention-menu-label">{candidate.label}</span>
      </button>)}
    </div>, document.body)}
    {tip && createPortal(<div className={`workspace-mention-tip${tip.below ? ' workspace-mention-tip-below' : ''}`} style={{ left: tip.x, top: tip.y }}>
      <img src={props.mediaSrc(tip.ref.path)} alt="" />
      <span>{tip.ref.label}</span>
    </div>, document.body)}
  </div>;
}

export default forwardRef(MentionPromptInput);
