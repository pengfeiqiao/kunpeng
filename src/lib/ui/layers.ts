/**
 * UI 层级与弹窗行为基元。
 * Z：全应用统一的 z-index 档位，语义命名，禁止再手写魔法数字。
 * useEscapeClose：Escape 关闭弹窗，模块级栈保证嵌套弹窗一次只关最上层。
 */
import { useEffect, useRef } from 'react';

export const Z = {
  popover: 40,
  drawer: 50,
  overlay: 60,
  modal: 90,
  modalStack: 100,
  picker: 110,
  fullscreen: 120,
  toast: 130,
} as const;

// 后入栈者视为最上层。全局只挂一个监听，按 Esc 时只弹出栈顶那一层。
const escapeStack: Array<() => void> = [];
let escapeListenerMounted = false;

function ensureEscapeListener() {
  if (escapeListenerMounted || typeof window === 'undefined') return;
  escapeListenerMounted = true;
  window.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const top = escapeStack[escapeStack.length - 1];
    if (!top) return;
    e.stopPropagation();
    top();
  });
}

/**
 * active 为真时把 onClose 推入 Esc 栈；弹窗卸载/关闭时自动出栈。
 * onClose 用 ref 跟踪最新值，栈内条目在 active 期间保持稳定，
 * 避免父组件重渲染导致层级顺序被打乱。
 */
export function useEscapeClose(active: boolean, onClose: () => void) {
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  });
  useEffect(() => {
    if (!active) return;
    ensureEscapeListener();
    const entry = () => onCloseRef.current();
    escapeStack.push(entry);
    return () => {
      const idx = escapeStack.indexOf(entry);
      if (idx >= 0) escapeStack.splice(idx, 1);
    };
  }, [active]);
}
