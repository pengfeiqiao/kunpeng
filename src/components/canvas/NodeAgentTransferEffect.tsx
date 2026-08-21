import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { Bot, FileText, Film, Globe2, Image as ImageIcon, Layers, Music } from 'lucide-react';
import {
  CANVAS_NODE_AGENT_TRANSFER_EVENT,
  type CanvasNodeAgentTransferDetail,
} from '@/lib/canvas/nodeAgent';

interface Flight {
  key: number;
  nodeIds: string[];
  fromX: number;
  fromY: number;
  toX: number;
  toY: number;
  toWidth: number;
  type: string;
  typeLabel: string;
  label: string;
  previewUrls: string[];
  statusLabel: string;
}

const FALLBACK_WIDTH = 340;

export default function NodeAgentTransferEffect() {
  const [flight, setFlight] = useState<Flight | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const targetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (event: Event) => {
      const detail = (event as CustomEvent<CanvasNodeAgentTransferDetail>).detail;
      if (!detail?.items?.length) return;
      const rects = detail.items
        .map((item) => {
          const escaped = typeof CSS !== 'undefined' && CSS.escape
            ? CSS.escape(item.nodeId)
            : item.nodeId.replace(/["\\]/g, '\\$&');
          const element = document.querySelector(`.react-flow__node[data-id="${escaped}"]`) as HTMLElement | null;
          return element?.getBoundingClientRect();
        })
        .filter((rect): rect is DOMRect => Boolean(rect));
      const bounds = rects.length > 0 ? {
        left: Math.min(...rects.map((rect) => rect.left)),
        top: Math.min(...rects.map((rect) => rect.top)),
        right: Math.max(...rects.map((rect) => rect.right)),
        bottom: Math.max(...rects.map((rect) => rect.bottom)),
      } : null;
      const primary = detail.items[0];
      const fallbackX = Math.max(24, window.innerWidth - 356);
      setFlight({
        key: Date.now(),
        nodeIds: detail.items.map((item) => item.nodeId),
        fromX: bounds ? bounds.left + Math.min((bounds.right - bounds.left) / 2, 180) : window.innerWidth / 2,
        fromY: bounds ? bounds.top + Math.min((bounds.bottom - bounds.top) / 2, 120) : window.innerHeight / 2,
        toX: fallbackX,
        toY: 58,
        toWidth: FALLBACK_WIDTH,
        type: primary.nodeType,
        typeLabel: detail.items.length === 1 ? primary.typeLabel : '节点工作集',
        label: detail.items.length === 1 ? primary.label : `已选择 ${detail.items.length} 个节点`,
        previewUrls: detail.items.map((item) => item.previewUrl).filter((url): url is string => Boolean(url)).slice(0, 3),
        statusLabel: detail.items.length === 1 ? primary.statusLabel : '准备交给 Agent',
      });

      if (targetTimerRef.current) clearTimeout(targetTimerRef.current);
      targetTimerRef.current = setTimeout(() => {
        const target = document.querySelector(
          '[data-agent-context-target="canvas-node-agent"]',
        ) as HTMLElement | null;
        const targetRect = target?.getBoundingClientRect();
        if (!targetRect) return;
        const nodeIds = detail.items.map((item) => item.nodeId);
        setFlight((current) => current && current.nodeIds.join('|') === nodeIds.join('|') ? {
          ...current,
          toX: targetRect.left,
          toY: targetRect.top,
          toWidth: targetRect.width,
        } : current);
      }, 260);

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => setFlight(null), 880);
    };
    window.addEventListener(CANVAS_NODE_AGENT_TRANSFER_EVENT, handler);
    return () => {
      window.removeEventListener(CANVAS_NODE_AGENT_TRANSFER_EVENT, handler);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (targetTimerRef.current) clearTimeout(targetTimerRef.current);
    };
  }, []);

  if (typeof document === 'undefined') return null;

  const FlightIcon = flight?.type === 'text' ? FileText
    : flight?.type === 'image' ? ImageIcon
    : flight?.type === 'video' ? Film
    : flight?.type === 'audio' ? Music
    : flight?.type === 'panorama' ? Globe2
    : flight?.type === 'group' ? Layers
    : Bot;

  return createPortal(
    <AnimatePresence>
      {flight && (
        <motion.div
          key={flight.key}
          initial={{
            left: flight.fromX,
            top: flight.fromY,
            width: 210,
            opacity: 0,
            scale: 0.82,
            filter: 'blur(1px)',
          }}
          animate={{
            left: flight.toX,
            top: flight.toY,
            width: flight.toWidth,
            opacity: [0, 1, 1, 1, 0],
            scale: [0.82, 1, 1, 1, 0.985],
            filter: ['blur(1px)', 'blur(0px)', 'blur(0px)', 'blur(0px)', 'blur(0px)'],
          }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.82, ease: [0.32, 0.72, 0, 1], times: [0, 0.12, 0.3, 0.78, 1] }}
          className="canvas-dark pointer-events-none fixed z-[70] flex h-[58px] items-center gap-2.5 overflow-hidden rounded-xl border border-white/12 bg-neutral-900/95 px-2.5 py-2 text-white shadow-2xl"
          style={{ backdropFilter: 'blur(14px)' }}
        >
          <span className="flex h-10 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white/10">
            {flight.previewUrls.length > 0 ? (
              <span className="flex h-full w-full items-center justify-center">
                {flight.previewUrls.map((url, index) => (
                  <img
                    key={url}
                    src={url}
                    alt=""
                    className="h-8 w-8 rounded-md border border-neutral-900 object-cover shadow"
                    style={{ marginLeft: index === 0 ? 0 : -12, zIndex: flight.previewUrls.length - index }}
                  />
                ))}
              </span>
            ) : (
              <FlightIcon size={16} />
            )}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[9px] text-white/50">
              {flight.typeLabel} · {flight.statusLabel}
            </span>
            <span className="mt-0.5 block truncate text-[11px] font-medium">{flight.label}</span>
            <span className="mt-0.5 flex items-center gap-1 text-[9px] text-white/45">
              <Bot size={9} /> 正在交给 Agent
            </span>
          </span>
        </motion.div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
