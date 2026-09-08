/**
 * ConfirmModeSelect — 工具执行确认模式切换（手动确认 / 自动执行）。
 * 全局设置（settingsStore.toolConfirmMode），所有助手框共享同一开关：
 * 普通对话（MessageInput）、画布/剪辑/文案（AgentDrawer 悬浮）、工坊（AgentDrawer 嵌入）。
 * 注意：只影响非生成类工具确认；付费生成的确认仍由项目规格 generationConfirmation 控制。
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronDown, ShieldCheck, Zap } from 'lucide-react';
import { useSettingsStore } from '@/stores';

const DARK = {
  text1: 'var(--canvas-text-1)', text2: 'var(--canvas-text-2)', text3: 'var(--canvas-text-3)',
  controlHoverBg: 'rgba(255,255,255,0.08)',
  confirmBg: 'rgba(24,25,28,0.97)', confirmBorder: 'rgba(255,255,255,0.09)',
  confirmShadow: '0 12px 36px rgba(0,0,0,0.5)',
  confirmHoverBg: 'rgba(255,255,255,0.04)', confirmActiveBg: 'rgba(255,255,255,0.06)',
} as const;

const LIGHT = {
  text1: '#1A1A1A', text2: '#4B5563', text3: '#9CA3AF',
  controlHoverBg: 'rgba(0,0,0,0.04)',
  confirmBg: '#FFFFFF', confirmBorder: 'rgba(0,0,0,0.08)',
  confirmShadow: '0 8px 24px rgba(0,0,0,0.1)',
  confirmHoverBg: 'rgba(0,0,0,0.03)', confirmActiveBg: '#F3F4F6',
} as const;

export default function ConfirmModeSelect({ variant = 'dark', compact = false }: { variant?: 'dark' | 'light'; compact?: boolean }) {
  const t = variant === 'light' ? LIGHT : DARK;
  const mode = useSettingsStore((s) => s.toolConfirmMode);
  const setMode = useSettingsStore((s) => s.setToolConfirmMode);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const Icon = mode === 'manual' ? ShieldCheck : Zap;

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        onClick={() => setOpen(!open)}
        className={`flex h-7 items-center justify-center rounded-full text-[10.5px] transition-colors ${compact ? 'w-7 px-0' : 'gap-1 px-2'}`}
        style={{ color: t.text2 }}
        onMouseEnter={e => { e.currentTarget.style.color = t.text1; e.currentTarget.style.background = t.controlHoverBg; }}
        onMouseLeave={e => { e.currentTarget.style.color = t.text2; e.currentTarget.style.background = 'transparent'; }}
        title="工具执行确认模式"
        aria-label={`工具执行确认模式：${mode === 'manual' ? '手动确认' : '自动执行'}`}
      >
        <Icon size={11} />
        {!compact && <>{mode === 'manual' ? '手动确认' : '自动执行'}<ChevronDown size={9} className={`transition-transform ${open ? 'rotate-180' : ''}`} /></>}
      </button>
      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full mb-1.5 left-0 w-[210px] rounded-xl py-1 z-50"
            style={{ background: t.confirmBg, border: `1px solid ${t.confirmBorder}`, boxShadow: t.confirmShadow }}
          >
            {([
              ['manual', ShieldCheck, '手动确认', '危险操作（生成花钱/写文件等）先弹窗'],
              ['auto', Zap, '自动执行', '跳过确认直接执行，危险命令仍会被拦截'],
            ] as const).map(([v, MIcon, label, desc]) => (
              <button
                key={v}
                onClick={() => { setMode(v); setOpen(false); }}
                className="w-full flex items-start gap-2.5 px-3 py-2 text-left transition-colors"
                style={{ background: mode === v ? t.confirmActiveBg : 'transparent' }}
                onMouseEnter={e => { if (mode !== v) e.currentTarget.style.background = t.confirmHoverBg; }}
                onMouseLeave={e => { if (mode !== v) e.currentTarget.style.background = 'transparent'; }}
              >
                <MIcon size={13} className="mt-0.5 shrink-0" style={{ color: mode === v ? t.text1 : t.text3 }} />
                <span>
                  <span className="block text-[11.5px] font-medium" style={{ color: mode === v ? t.text1 : t.text2 }}>{label}</span>
                  <span className="block text-[9.5px] mt-0.5 leading-tight" style={{ color: t.text3 }}>{desc}</span>
                </span>
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
