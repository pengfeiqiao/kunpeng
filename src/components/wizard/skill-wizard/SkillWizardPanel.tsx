import { motion } from 'framer-motion';
import { X } from 'lucide-react';
import { useWizardStore } from '@/stores/wizardStore';
import WizardStepper from './WizardStepper';
import WizardStepContent from './WizardStepContent';
import WizardFooter from './WizardFooter';

interface SkillWizardPanelProps {
  width?: number;
}

export default function SkillWizardPanel({ width = 400 }: SkillWizardPanelProps) {
  const { project, isGenerating, generatingMessage, setPanelOpen, clearProject } = useWizardStore();

  if (!project) return null;

  const handleClose = () => {
    setPanelOpen(false);
  };

  const handleClear = () => {
    clearProject();
  };

  return (
    <motion.div
      initial={{ width: 0, opacity: 0 }}
      animate={{ width, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="flex-shrink-0 h-full border-l border-[rgb(var(--c-border))] bg-[rgb(var(--c-surface))] flex flex-col overflow-hidden"
    >
      {/* Header */}
      <div className="flex-shrink-0 px-4 py-3 border-b border-[rgb(var(--c-border))] flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎬</span>
          <h2 className="font-medium text-[rgb(var(--c-text))]">视频风格复刻</h2>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleClear}
            className="p-1.5 rounded-lg text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-border))] transition-colors text-xs"
            title="关闭并清除项目"
          >
            清除
          </button>
          <button
            onClick={handleClose}
            className="p-1.5 rounded-lg text-[rgb(var(--c-text-muted))] hover:text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-border))] transition-colors"
          >
            <X size={18} />
          </button>
        </div>
      </div>

      {/* Stepper */}
      <WizardStepper />

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        <WizardStepContent />
      </div>

      {/* Footer */}
      <WizardFooter />

      {/* Generating Overlay */}
      {isGenerating && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center z-10">
          <div className="bg-[rgb(var(--c-surface))] rounded-xl p-6 shadow-xl flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
            <p className="text-sm text-[rgb(var(--c-text-muted))]">{generatingMessage || '生成中...'}</p>
          </div>
        </div>
      )}
    </motion.div>
  );
}
