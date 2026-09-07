import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Clapperboard, EyeOff, ImagePlus, MessageSquarePlus, Mountain, Package, Pencil, Trash2, User, Video, X } from 'lucide-react';
import type { ProjectDeletionImpact } from '@/lib/projectObjects/deletion';
import './workspaceObjectActions.css';

export interface WorkspaceObjectActionsProps {
  label: string;
  impact: ProjectDeletionImpact | null;
  position?: { x: number; y: number };
  onClose: () => void;
  onAddToChat?: () => void;
  onEditInfo?: () => void;
  onHide?: () => void;
  onDelete?: () => Promise<{ status: string; reason?: string }>;
  onNewMaterial?: (kind: 'image' | 'video') => void;
  onNewShot?: () => void;
  onNewAsset?: (kind: 'character' | 'scene' | 'prop') => void;
}

export function clampObjectMenuPosition(point: { x: number; y: number }, size: { width: number; height: number },
  viewport: { width: number; height: number; x?: number; y?: number }) {
  const clamp = (value: number, length: number, available: number, offset = 0) => {
    const inset = Math.min(8, available / 2);
    const min = offset + inset;
    return Math.max(min, Math.min(Number.isFinite(value) ? value : min, offset + Math.max(inset, available - length - inset)));
  };
  return { x: clamp(point.x, size.width, viewport.width, viewport.x), y: clamp(point.y, size.height, viewport.height, viewport.y) };
}

function buttonAnchor(label: string): HTMLElement | null {
  const hovered = document.querySelector<HTMLElement>('.workspace-object-menu-button:hover');
  if (hovered) return hovered;
  const matching = Array.from(document.querySelectorAll<HTMLElement>('.workspace-object-menu-button'))
    .find((button) => button.getAttribute('aria-label') === label + '操作');
  if (matching) return matching;
  const active = document.activeElement;
  if (active instanceof HTMLElement && active !== document.body) return active;
  return null;
}

export default function WorkspaceObjectActions({ label, impact, position, onClose, onAddToChat, onEditInfo, onHide, onDelete,
  onNewMaterial, onNewShot, onNewAsset }: WorkspaceObjectActionsProps) {
  const [anchor] = useState(() => buttonAnchor(label));
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [placement, setPlacement] = useState<{ x: number; y: number } | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const mounted = useRef(true);
  const closing = useRef(false);
  const deleting = useRef(false);
  const returnToDelete = useRef(false);
  const closeCallback = useRef(onClose);
  closeCallback.current = onClose;

  const restoreFocus = () => { if (anchor?.isConnected) anchor.focus({ preventScroll: true }); };
  const close = () => {
    if (closing.current || deleting.current) return;
    closing.current = true;
    restoreFocus();
    closeCallback.current();
  };
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; if (!closing.current) restoreFocus(); };
  }, [anchor]);

  useLayoutEffect(() => {
    if (confirm) { dialogRef.current?.querySelector<HTMLButtonElement>('[data-delete-back]')?.focus(); return; }
    const menu = menuRef.current;
    if (!menu) return;
    const place = () => {
      const rect = anchor?.getBoundingClientRect();
      const viewport = window.visualViewport;
      setPlacement(clampObjectMenuPosition(position ?? { x: rect?.left ?? 8, y: rect ? rect.bottom + 4 : 8 },
        menu.getBoundingClientRect(), { width: viewport?.width ?? window.innerWidth, height: viewport?.height ?? window.innerHeight,
          x: viewport?.offsetLeft, y: viewport?.offsetTop }));
    };
    place();
    const selector = returnToDelete.current ? '[data-delete-menu]:not(:disabled)' : '[role="menuitem"]:not(:disabled)';
    (menu.querySelector<HTMLButtonElement>(selector) ?? menu.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'))?.focus();
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(place);
    observer?.observe(menu);
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    window.visualViewport?.addEventListener('resize', place);
    window.visualViewport?.addEventListener('scroll', place);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
      window.visualViewport?.removeEventListener('resize', place);
      window.visualViewport?.removeEventListener('scroll', place);
    };
  }, [anchor, confirm, position?.x, position?.y, Boolean(onNewMaterial), Boolean(onNewShot)]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      const surface = confirm ? dialogRef.current : menuRef.current;
      if (event.target instanceof Node && !surface?.contains(event.target)) close();
    };
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(); return; }
      if (!confirm && event.key === 'Tab') { close(); return; }
      const surface = confirm ? dialogRef.current : menuRef.current;
      const buttons = Array.from(surface?.querySelectorAll<HTMLButtonElement>(confirm ? 'button:not(:disabled)' : '[role="menuitem"]:not(:disabled)') ?? []);
      const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
      if (!confirm && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault(); event.stopPropagation();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : event.key === 'ArrowDown' ? (current + 1) % buttons.length : (current <= 0 ? buttons.length : current) - 1;
        buttons[index]?.focus();
      } else if (confirm && event.key === 'Tab') {
        event.preventDefault();
        buttons[(current + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      }
    };
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', keyboard, true);
    return () => { document.removeEventListener('pointerdown', outside, true); document.removeEventListener('keydown', keyboard, true); };
  }, [confirm, anchor]);

  const choose = (action: () => void) => { if (closing.current) return; close(); action(); };
  const remove = async () => {
    if (deleting.current || !impact || !onDelete) return;
    deleting.current = true;
    setBusy(true); setError('');
    try {
      const result = await onDelete();
      if (!mounted.current) return;
      if (result.status === 'deleted') { deleting.current = false; close(); }
      else setError(result.reason ?? (result.status === 'confirmation-required'
        ? '项目仍有生成任务，请先等待任务完成再删除。' : '对象已变化，未执行删除。'));
    } catch { if (mounted.current) setError('删除未完成，请检查当前项目后重试。'); }
    finally { deleting.current = false; if (mounted.current) setBusy(false); }
  };

  return createPortal(confirm ? <div className="workspace-dialog-backdrop workspace-object-delete-backdrop">
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-label="确认从项目删除" className="workspace-classify-dialog workspace-object-delete-dialog">
      <header><h2>{label}</h2><button className="workspace-icon" aria-label="关闭对象操作" disabled={busy} onClick={close}><X size={16} /></button></header>
      <p>将从项目移除“{label}”。媒体文件仍保留在磁盘，可从项目快照找回。</p>
      {impact && <dl className="workspace-delete-impact">
        <dt>媒体 / 版本</dt><dd>{impact.mediaIds.length} / {impact.versionIds.length}</dd>
        <dt>关联镜头</dt><dd>{impact.affectedShotNos.join('、') || '无'}</dd>
        <dt>时间线片段</dt><dd>{impact.timelineClipCount}</dd>
        <dt>引用关系</dt><dd>{impact.relationReferenceCount}</dd>
      </dl>}
      {error && <p role="alert" className="workspace-error">{error}</p>}
      <footer><button data-delete-back disabled={busy} onClick={() => { setError(''); setConfirm(false); }}>返回</button>
        <button disabled={busy || !impact || !onDelete} className="workspace-danger" onClick={remove}>{busy ? '处理中' : '确认从项目删除'}</button></footer>
    </section>
  </div> : <div ref={menuRef} role="menu" aria-label={label + '操作'} className="workspace-object-context-menu"
    style={{ left: placement?.x ?? 0, top: placement?.y ?? 0 }}
    onContextMenu={(event) => event.preventDefault()}>
    {onNewMaterial && <>
      <button role="menuitem" tabIndex={-1} onClick={() => choose(() => onNewMaterial('image'))}><ImagePlus size={15} />新增图片素材</button>
      <button role="menuitem" tabIndex={-1} onClick={() => choose(() => onNewMaterial('video'))}><Video size={15} />新增视频素材</button>
    </>}
    {onNewShot && <button role="menuitem" tabIndex={-1} onClick={() => choose(onNewShot)}><Clapperboard size={15} />新增镜头</button>}
    {onNewAsset && <>
      <button role="menuitem" tabIndex={-1} onClick={() => choose(() => onNewAsset('character'))}><User size={15} />新建角色</button>
      <button role="menuitem" tabIndex={-1} onClick={() => choose(() => onNewAsset('scene'))}><Mountain size={15} />新建场景</button>
      <button role="menuitem" tabIndex={-1} onClick={() => choose(() => onNewAsset('prop'))}><Package size={15} />新建道具</button>
    </>}
    {(onNewMaterial || onNewShot || onNewAsset) && (onAddToChat || onEditInfo || onHide || onDelete) && <div role="separator" />}
    {onAddToChat && <button role="menuitem" tabIndex={-1} onClick={() => choose(onAddToChat)}><MessageSquarePlus size={15} />添加到对话</button>}
    {onEditInfo && <button role="menuitem" tabIndex={-1} onClick={() => choose(onEditInfo)}><Pencil size={15} />编辑信息</button>}
    {onHide && <button role="menuitem" tabIndex={-1} onClick={() => choose(onHide)}><EyeOff size={15} />从视图移除</button>}
    {(onAddToChat || onHide) && onDelete && <div role="separator" />}
    {onDelete && <button role="menuitem" tabIndex={-1} data-delete-menu disabled={!impact} className="workspace-object-menu-danger"
      onClick={() => { returnToDelete.current = true; setConfirm(true); }}><Trash2 size={15} />从项目删除</button>}
  </div>, document.body);
}
