import { useState, useEffect, useRef, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/tauri';
import { listen } from '@tauri-apps/api/event';
import { appWindow, PhysicalPosition } from '@tauri-apps/api/window';

type AgentStatus = 'idle' | 'working' | 'error';

export default function FloatBall() {
  const [status, setStatus] = useState<AgentStatus>('idle');
  const [visualPressed, setVisualPressed] = useState(false);
  const pressedRef = useRef(false);
  const draggingRef = useRef(false);
  const startMouse = useRef({ x: 0, y: 0 });
  const startWinPos = useRef({ x: 0, y: 0 });

  useEffect(() => {
    const unlisten = listen<AgentStatus>('agent-status-change', (e) => {
      setStatus(e.payload);
    });
    return () => { unlisten.then((fn) => fn()); };
  }, []);

  const onPointerDown = useCallback(async (e: React.PointerEvent) => {
    pressedRef.current = true;
    draggingRef.current = false;
    setVisualPressed(true);
    startMouse.current = { x: e.screenX, y: e.screenY };
    try {
      const pos = await appWindow.outerPosition();
      startWinPos.current = { x: pos.x, y: pos.y };
    } catch {}
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!pressedRef.current) return;
    const dx = e.screenX - startMouse.current.x;
    const dy = e.screenY - startMouse.current.y;
    if (!draggingRef.current && (Math.abs(dx) > 3 || Math.abs(dy) > 3)) {
      draggingRef.current = true;
    }
    if (draggingRef.current) {
      const scale = window.devicePixelRatio || 1;
      appWindow.setPosition(new PhysicalPosition(
        startWinPos.current.x + Math.round(dx * scale),
        startWinPos.current.y + Math.round(dy * scale),
      ));
    }
  }, []);

  const onPointerUp = useCallback(() => {
    if (!draggingRef.current && pressedRef.current) {
      invoke('toggle_main_window');
    }
    pressedRef.current = false;
    draggingRef.current = false;
    setVisualPressed(false);
  }, []);

  return (
    <div
      className="kp-float-shell"
      style={{ width: 64, height: 64, borderRadius: '50%', overflow: 'hidden' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className={`kp-float-ball is-${status} ${visualPressed ? 'is-pressed' : ''}`}
        style={{ width: 46, height: 46, borderRadius: '50%', overflow: 'hidden' }}
      >
        <img
          src="/logo.png"
          alt="鲲鹏"
          draggable={false}
          className="kp-float-logo"
          style={{ borderRadius: '38%', pointerEvents: 'none' }}
        />
      </div>
    </div>
  );
}
