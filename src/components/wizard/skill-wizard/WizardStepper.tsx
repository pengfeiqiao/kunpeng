import { useWizardStore } from '@/stores/wizardStore';

const STEPS = [
  { id: 'init', label: '项目初始化' },
  { id: 'characters', label: '角色建立' },
  { id: 'scenes', label: '场景建立' },
  { id: 'storyboard', label: '分镜生成' },
  { id: 'review', label: '审查优化' },
  { id: 'prompts', label: '视频提示词' },
];

export default function WizardStepper() {
  const { project, goToPhase } = useWizardStore();

  if (!project) return null;

  const currentPhase = project.currentPhase;

  return (
    <div className="flex-shrink-0 px-4 py-3 border-b border-[rgb(var(--c-border))]">
      {/* Step indicator dots */}
      <div className="flex items-center justify-center gap-1 mb-2">
        {STEPS.map((step, i) => (
          <div key={step.id} className="flex items-center gap-1">
            <button
              onClick={() => goToPhase(i)}
              disabled={i > currentPhase}
              className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-all ${
                i < currentPhase
                  ? 'bg-indigo-600 text-white cursor-pointer'
                  : i === currentPhase
                  ? 'bg-indigo-600 text-white ring-2 ring-indigo-400/30'
                  : 'bg-[rgb(var(--c-border))] text-[rgb(var(--c-text-muted))] cursor-not-allowed'
              }`}
            >
              {i < currentPhase ? '✓' : i + 1}
            </button>
            {i < STEPS.length - 1 && (
              <div
                className={`w-4 h-0.5 ${
                  i < currentPhase ? 'bg-indigo-600' : 'bg-[rgb(var(--c-border))]'
                }`}
              />
            )}
          </div>
        ))}
      </div>

      {/* Current step label */}
      <div className="text-center">
        <span className="text-sm text-[rgb(var(--c-text-muted))]">
          Phase {currentPhase + 1}/{STEPS.length}: {STEPS[currentPhase]?.label}
        </span>
      </div>
    </div>
  );
}
