import { AnimatePresence, motion } from 'framer-motion';
import { useWizardStore } from '@/stores/wizardStore';
import Phase0Init from './phases/Phase0Init';
import Phase1Characters from './phases/Phase1Characters';
import Phase2Scenes from './phases/Phase2Scenes';
import Phase3Storyboard from './phases/Phase3Storyboard';
import Phase4Review from './phases/Phase4Review';
import Phase5Prompts from './phases/Phase5Prompts';

const PHASE_COMPONENTS = [
  Phase0Init,
  Phase1Characters,
  Phase2Scenes,
  Phase3Storyboard,
  Phase4Review,
  Phase5Prompts,
];

export default function WizardStepContent() {
  const { project } = useWizardStore();

  if (!project) return null;

  const currentPhase = project.currentPhase;
  const PhaseComponent = PHASE_COMPONENTS[currentPhase];

  if (!PhaseComponent) {
    return (
      <div className="flex items-center justify-center h-full text-[rgb(var(--c-text-muted))]">
        未知的阶段
      </div>
    );
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={currentPhase}
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: -20 }}
        transition={{ duration: 0.2 }}
        className="p-4"
      >
        <PhaseComponent />
      </motion.div>
    </AnimatePresence>
  );
}
