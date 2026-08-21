/**
 * StepNav — 工坊左侧 ①~⑥ 垂直步骤条。
 */
import { Check, AlertTriangle, Loader2 } from 'lucide-react';
import { useWorkshopStore } from '@/stores/workshopStore';
import { WORKSHOP_STEPS, type WorkshopStepId } from '@/lib/workshop/types';

const CIRCLED = ['①', '②', '③', '④', '⑤', '⑥'];

export default function StepNav() {
  // 标量/稳定引用选择器：data 里无关字段（shots/changelog 等）变化不会重渲染步骤条
  const steps = useWorkshopStore((s) => s.data?.steps);
  const currentStep = useWorkshopStore((s) => s.data?.currentStep);
  const setCurrentStep = useWorkshopStore((s) => s.setCurrentStep);
  if (!steps || !currentStep) return null;

  return (
    <div className="w-[200px] shrink-0 border-r border-[var(--canvas-node-border)] py-4 px-3 flex flex-col gap-1" style={{ background: 'var(--canvas-panel)' }}>
      {WORKSHOP_STEPS.map((step, i) => {
        const st = steps[step.id];
        const active = currentStep === step.id;
        return (
          <button
            key={step.id}
            onClick={() => setCurrentStep(step.id as WorkshopStepId)}
            className="w-full text-left px-3 py-2.5 rounded-xl transition-colors group"
            style={{
              background: active ? 'rgba(31,162,220,0.12)' : 'transparent',
              border: `1px solid ${active ? 'rgba(31,162,220,0.35)' : 'transparent'}`,
            }}
          >
            <div className="flex items-center gap-2">
              <span
                className="w-5 h-5 rounded-full flex items-center justify-center text-[11px] shrink-0"
                style={{
                  background: st.status === 'done' ? 'rgba(34,197,94,0.18)' : 'rgba(255,255,255,0.06)',
                  color: st.status === 'done' ? '#4ade80' : active ? 'var(--canvas-accent)' : 'var(--canvas-text-2)',
                }}
              >
                {st.status === 'done' ? <Check size={11} /> : CIRCLED[i]}
              </span>
              <span className="text-[13px]" style={{ color: active ? 'var(--canvas-text-1)' : 'var(--canvas-text-2)', fontWeight: active ? 600 : 400 }}>
                {step.label}
              </span>
              {st.status === 'stale' && <span title="上游已修改，建议重做"><AlertTriangle size={11} className="text-amber-400 shrink-0" /></span>}
              {st.status === 'in-progress' && <Loader2 size={11} className="animate-spin text-[var(--canvas-accent)] shrink-0" />}
            </div>
            <p className="text-[10px] mt-0.5 ml-7 text-[var(--canvas-text-3)] leading-tight">{step.hint}</p>
            {st.larkDocUrl && (
              <a
                href={st.larkDocUrl}
                target="_blank"
                rel="noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="block ml-7 mt-0.5 text-[10px] text-[var(--canvas-accent)] hover:underline truncate"
              >
                飞书文档 ↗
              </a>
            )}
          </button>
        );
      })}
    </div>
  );
}
