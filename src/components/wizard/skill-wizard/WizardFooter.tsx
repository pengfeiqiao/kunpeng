import { ChevronLeft, ChevronRight, Check } from 'lucide-react';
import { useWizardStore } from '@/stores/wizardStore';

export default function WizardFooter() {
  const { project, nextPhase, prevPhase, getTotalSteps } = useWizardStore();

  if (!project) return null;

  const currentPhase = project.currentPhase;
  const totalSteps = getTotalSteps();
  const isFirstPhase = currentPhase === 0;
  const isLastPhase = currentPhase === totalSteps - 1;

  return (
    <div className="flex-shrink-0 px-4 py-3 border-t border-[rgb(var(--c-border))] flex items-center justify-between gap-2">
      <button
        onClick={prevPhase}
        disabled={isFirstPhase}
        className={`flex items-center gap-1 px-3 py-2 rounded-lg text-sm transition-colors ${
          isFirstPhase
            ? 'text-[rgb(var(--c-text-muted))] cursor-not-allowed'
            : 'text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-border))]'
        }`}
      >
        <ChevronLeft size={16} />
        上一步
      </button>

      {isLastPhase ? (
        <button
          onClick={() => {
            // TODO: Handle completion
            alert('项目已完成！');
          }}
          className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm bg-green-600 text-white hover:bg-green-700 transition-colors"
        >
          <Check size={16} />
          完成
        </button>
      ) : (
        <button
          onClick={nextPhase}
          className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm bg-indigo-600 text-white hover:bg-indigo-700 transition-colors"
        >
          下一步
          <ChevronRight size={16} />
        </button>
      )}
    </div>
  );
}
