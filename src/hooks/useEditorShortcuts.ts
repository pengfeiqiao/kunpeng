/**
 * useEditorShortcuts — 剪辑器全套键位（剪映/LibTV 惯例）。
 * Space 播放暂停 · J/K/L 退5s/停/播 · ←/→ ±1s（Shift=±5s）· ↑/↓ ±0.1s（Shift=±0.01s）
 * Home/End 跳首尾 · Delete 删除选中（六类轨道统一 deleteSelected）
 * E/B/⌘B 播放头分割 · Q/W 裁左/裁右到播放头 · I/O 入点/出点 · M 标记 · [/] 左右全选
 * ⌘Z/⇧⌘Z 撤销重做（编辑器独立历史栈）· +/- 时间轴缩放 · ? 速查面板
 */
import { useEffect } from 'react';
import { useEditorStore } from '@/stores/editorStore';
import { captureEditorSnapshot, undoEditor, redoEditor } from '@/lib/editor/editorHistory';
import { TIMELINE_SELECT_RANGE_EVENT } from '@/components/editor/timelineEvents';

export const SHORTCUT_PANEL_EVENT = 'kunpeng-editor-shortcuts-toggle';

function isEditable(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement;
  return Boolean(t.closest?.('input, textarea, [contenteditable="true"], [data-kunpeng-ai-input="true"]'))
    || t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable;
}

/** 播放头落在主轨哪个片段 + 片段内时间轴偏移（秒，未乘速） */
function clipAtPlayhead(): { id: string; offset: number; speed: number; inSec: number } | null {
  const s = useEditorStore.getState();
  let acc = 0;
  for (const c of s.clips) {
    const len = s.clipLength(c);
    if (s.playheadSec >= acc && s.playheadSec <= acc + len) {
      return { id: c.id, offset: s.playheadSec - acc, speed: c.speed ?? 1, inSec: c.inSec };
    }
    acc += len;
  }
  return null;
}

export function useEditorShortcuts() {
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (isEditable(e)) return;
      const s = useEditorStore.getState();
      const meta = e.metaKey || e.ctrlKey;

      // ── 撤销重做（编辑器独立栈） ──
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redoEditor(); else undoEditor();
        return;
      }

      switch (e.key) {
        case ' ':
          e.preventDefault();
          s.setPlaying(!s.isPlaying);
          return;
        case 'ArrowLeft':
          e.preventDefault();
          s.setPlayhead(s.playheadSec - (e.shiftKey ? 5 : 1));
          return;
        case 'ArrowRight':
          e.preventDefault();
          s.setPlayhead(s.playheadSec + (e.shiftKey ? 5 : 1));
          return;
        case 'ArrowUp':
          e.preventDefault();
          s.setPlayhead(s.playheadSec + (e.shiftKey ? 0.01 : 0.1));
          return;
        case 'ArrowDown':
          e.preventDefault();
          s.setPlayhead(Math.max(0, s.playheadSec - (e.shiftKey ? 0.01 : 0.1)));
          return;
        case 'Home':
          e.preventDefault();
          s.setPlayhead(0);
          return;
        case 'End':
          e.preventDefault();
          s.setPlayhead(s.totalDuration());
          return;
        case 'Delete':
        case 'Backspace':
          e.preventDefault();
          captureEditorSnapshot();
          if (s.rippleEnabled) s.rippleDeleteSelected();
          else s.deleteSelected();
          return;
        case '=':
        case '+':
          e.preventDefault();
          s.setZoom(s.zoom * 1.25);
          return;
        case '-':
        case '_':
          e.preventDefault();
          s.setZoom(s.zoom / 1.25);
          return;
        case '?':
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(SHORTCUT_PANEL_EVENT));
          return;
        case '[':
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(TIMELINE_SELECT_RANGE_EVENT, { detail: { direction: 'left' } }));
          return;
        case ']':
          e.preventDefault();
          window.dispatchEvent(new CustomEvent(TIMELINE_SELECT_RANGE_EVENT, { detail: { direction: 'right' } }));
          return;
      }

      const k = e.key.toLowerCase();

      // J/K/L：退 5s / 停 / 播（倒放预览不可靠，J 退秒代替）
      if (k === 'j') { e.preventDefault(); s.setPlayhead(Math.max(0, s.playheadSec - 5)); return; }
      if (k === 'k') { e.preventDefault(); s.setPlaying(false); return; }
      if (k === 'l') { e.preventDefault(); s.setPlaying(true); return; }

      // E/B/⌘B：播放头处分割（无需先选中，剪映同款按播放头所在片段）
      if (k === 'b' || k === 'e') {
        e.preventDefault();
        captureEditorSnapshot();
        s.splitAtPlayhead();
        return;
      }

      // Q/W：裁左/裁右到播放头（作用于播放头所在片段）
      if (k === 'q' || k === 'w') {
        e.preventDefault();
        const hit = clipAtPlayhead();
        if (!hit) return;
        captureEditorSnapshot();
        const srcAt = hit.inSec + hit.offset * hit.speed;
        if (k === 'q') s.trimClip(hit.id, srcAt, undefined);
        else s.trimClip(hit.id, undefined, srcAt);
        return;
      }

      // M：播放头处加标记（store 内已去重）
      if (k === 'm') { e.preventDefault(); s.addMarker(s.playheadSec); return; }

      // I/O：选中片段设入点/出点（保留 LibTV 键位，需先选中）
      if ((k === 'i' || k === 'o') && s.selectedClipId) {
        e.preventDefault();
        const hit = clipAtPlayhead();
        if (!hit || hit.id !== s.selectedClipId) return;
        captureEditorSnapshot();
        const srcAt = hit.inSec + hit.offset * hit.speed;
        if (k === 'i') s.trimClip(hit.id, srcAt, undefined);
        else s.trimClip(hit.id, undefined, srcAt);
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);
}

/** 速查面板数据（ShortcutPanel 消费） */
export const SHORTCUT_GROUPS: { title: string; items: [string, string][] }[] = [
  {
    title: '播放',
    items: [
      ['Space', '播放 / 暂停'], ['J / K / L', '退 5 秒 / 暂停 / 播放'],
      ['← / →', '±1 秒（Shift = ±5 秒）'], ['↑ / ↓', '±0.1 秒（Shift = ±0.01 秒）'],
      ['Home / End', '跳到开头 / 结尾'],
    ],
  },
  {
    title: '剪辑',
    items: [
      ['E / B', '播放头处分割'], ['Q / W', '裁左 / 裁右到播放头'],
      ['I / O', '选中片段设入点 / 出点'], ['Delete', '删除选中（任意轨道）'],
      ['⌘Z / ⇧⌘Z', '撤销 / 重做'],
    ],
  },
  {
    title: '时间轴',
    items: [
      ['M', '播放头处加 / 去标记'], ['[ / ]', '向左 / 向右全选'],
      ['+ / -', '时间轴缩放'], ['?', '打开本面板'],
    ],
  },
];
