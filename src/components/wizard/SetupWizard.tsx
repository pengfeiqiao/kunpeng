import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X } from 'lucide-react';
import { useSettingsStore } from '@/stores';
import WizardStepWelcome from './WizardStepWelcome';
import WizardStepChat from './WizardStepChat';
import WizardStepChannels from './WizardStepChannels';
import WizardStepCos from './WizardStepCos';
import WizardStepDone from './WizardStepDone';
import { primaryBtnCls, secondaryBtnCls } from './wizardUi';

/**
 * 新手引导：6 步，每步可跳过，全部配置可留空。
 * 以 modal 浮层呈现（App.tsx 控制显隐）；关闭 = 跳过（setupSkipped）。
 * 视觉规范见《03-视觉策略》：显式浅色（bg-white / bg-[#f4f4f5]），不跟随全局 .dark。
 */
const STEPS = [
  { label: '欢迎' },
  { label: '主聊天模型' },
  { label: '图片生成' },
  { label: '视频生成' },
  { label: '存储中转' },
  { label: '完成' },
];

export default function SetupWizard() {
  const setWizardOpen = useSettingsStore((s) => s.setWizardOpen);
  const setSetupSkipped = useSettingsStore((s) => s.setSetupSkipped);
  const setSetupComplete = useSettingsStore((s) => s.setSetupComplete);
  const [step, setStep] = useState(0);

  const closeAsSkipped = () => {
    // 未完成配置就关闭 = 跳过：之后不再自动弹，设置页出现补配横幅
    if (!useSettingsStore.getState().setupComplete) setSetupSkipped(true);
    setWizardOpen(false);
  };

  const finish = () => {
    setSetupComplete(true);
    setSetupSkipped(false);
    setWizardOpen(false);
  };

  const next = () => setStep((s) => Math.min(s + 1, STEPS.length - 1));
  const back = () => setStep((s) => Math.max(s - 1, 0));

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.14, ease: 'easeOut' }}
      role="dialog"
      aria-label="初始配置向导"
      className="fixed inset-0 z-[70] flex overflow-hidden bg-white text-zinc-900"
    >
      {/* 步骤侧栏（对齐设置页侧栏样式） */}
      <aside className="flex w-[232px] shrink-0 flex-col border-r border-zinc-200 bg-[#f4f4f5] px-3 pb-3 pt-4">
        <div className="px-2 pb-5">
          <div className="text-[13px] font-medium text-zinc-900">初始配置</div>
          <div className="mt-0.5 text-[11px] text-zinc-500">每一步都可以跳过</div>
        </div>
        <nav className="min-h-0 flex-1 overflow-y-auto" aria-label="配置步骤">
          <div className="space-y-0.5">
            {STEPS.map((s, i) => (
              <div
                key={s.label}
                className={`flex items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] ${
                  i === step
                    ? 'bg-zinc-200/80 font-medium text-zinc-950'
                    : i < step
                      ? 'text-zinc-500'
                      : 'text-zinc-400'
                }`}
              >
                <span
                  className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] ${
                    i <= step
                      ? 'bg-primary-500 text-white'
                      : 'bg-zinc-200 text-zinc-500'
                  }`}
                >
                  {i < step ? '✓' : i + 1}
                </span>
                <span className="truncate">{s.label}</span>
              </div>
            ))}
          </div>
        </nav>
        <div className="mt-auto border-t border-zinc-200 px-2 pt-3 text-[11px] leading-relaxed text-zinc-400">
          配置会自动保存在本机
        </div>
      </aside>

      {/* 内容区 */}
      <section className="flex min-w-0 flex-1 flex-col bg-white">
        <header className="flex h-[64px] shrink-0 items-center justify-between border-b border-zinc-100 px-8">
          <h2 className="text-[15px] font-medium text-zinc-900">{STEPS[step].label}</h2>
          <div className="flex items-center gap-3">
            {step >= 1 && step <= 4 && (
              <button
                type="button"
                onClick={next}
                className="text-[13px] text-zinc-500 transition-colors hover:text-zinc-900"
              >
                跳过
              </button>
            )}
            <button
              type="button"
              onClick={closeAsSkipped}
              className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-950"
              title="关闭（可在设置中重新打开）"
            >
              <X size={17} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-6">
          <AnimatePresence mode="wait">
            <motion.div
              key={step}
              initial={{ opacity: 0, x: 16 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -16 }}
              transition={{ duration: 0.18 }}
              className="mx-auto w-full max-w-[720px] min-w-0 pb-6"
            >
              {step === 0 && <WizardStepWelcome onNext={next} onSkipAll={closeAsSkipped} />}
              {step === 1 && <WizardStepChat />}
              {step === 2 && <WizardStepChannels kind="image" />}
              {step === 3 && <WizardStepChannels kind="video" />}
              {step === 4 && <WizardStepCos />}
              {step === 5 && <WizardStepDone onBack={back} onFinish={finish} />}
            </motion.div>
          </AnimatePresence>
        </div>

        {/* 底部导航：中间步骤（1-4）恒有 上一步/下一步，无必填禁用 */}
        {step >= 1 && step <= 4 && (
          <footer className="flex shrink-0 items-center justify-between border-t border-zinc-100 bg-[#f4f4f5] px-8 py-3">
            <button type="button" onClick={back} className={secondaryBtnCls}>
              上一步
            </button>
            <button type="button" onClick={next} className={primaryBtnCls}>
              下一步
            </button>
          </footer>
        )}
      </section>
    </motion.div>
  );
}
