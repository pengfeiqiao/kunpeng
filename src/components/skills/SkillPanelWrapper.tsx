import { motion, AnimatePresence } from 'framer-motion';
import type { SkillManifest } from '@/types/skill';
import SkillPanel from './SkillPanel';

interface SkillPanelWrapperProps {
  skill: SkillManifest | null;
  fieldValues: Record<string, unknown>;
  onFieldChange: (key: string, value: unknown) => void;
}

export default function SkillPanelWrapper({ skill, fieldValues, onFieldChange }: SkillPanelWrapperProps) {
  return (
    <AnimatePresence>
      {skill && skill.hasPanel && (
        <motion.div
          key={skill.id}
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.18, ease: 'easeInOut' }}
          style={{ overflow: 'hidden' }}
        >
          <div className="mx-3 mb-2 rounded-lg bg-[rgb(var(--c-bg))] border border-[rgb(var(--c-border))] overflow-hidden">
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1.5">
              <span className="text-sm">{skill.icon}</span>
              <span className="text-[11px] font-semibold text-[rgb(var(--c-text-muted))] tracking-wide uppercase">
                {skill.name}参数
              </span>
            </div>
            <SkillPanel
              skill={skill}
              fieldValues={fieldValues}
              onFieldChange={onFieldChange}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
