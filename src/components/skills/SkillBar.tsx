import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Check, ChevronDown, Shapes } from 'lucide-react';
import type { SkillManifest } from '@/types/skill';
import { SKILL_ICON_MAP } from './skillIcons';

interface SkillBarProps {
  skills: SkillManifest[];
  activeSkillId: string | null;
  onSkillClick: (skill: SkillManifest) => void;
  disabled?: boolean;
}

const HIDDEN_TOOLBAR_IDS = new Set([
  'digital-human-skill',
  'dreamina-video',
  'rhtv',
  'video-copy-analyzer',
  'car-model-skill',
  'ocean-engine-ad',
  'canvas-project-manager',
  'scene-image-anchor',
]);

const GROUPS: Array<{ label: string; categories: SkillManifest['category'][]; ids?: string[] }> = [
  { label: '文案与分析', categories: ['writing'], ids: ['video-script-writer', 'kimi-video-analysis'] },
  { label: '分镜与视觉', categories: ['storyboard', 'visual'], ids: ['film-master-skill', 'car-visual-production', 'car-commercial-storyboard', 'geography-video-effects', 'sketch-to-image'] },
  { label: '视频与动效', categories: ['video'], ids: ['video-style-replication', 'omni-mg-animation'] },
];

export default function SkillBar({ skills, activeSkillId, onSkillClick, disabled }: SkillBarProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const visibleSkills = useMemo(
    () => skills.filter((skill) => skill.visibility !== 'internal' && skill.visibility !== 'library' && skill.category !== 'integration' && !HIDDEN_TOOLBAR_IDS.has(skill.id)),
    [skills],
  );
  const activeSkill = visibleSkills.find((skill) => skill.id === activeSkillId);

  useEffect(() => {
    if (!open) return;
    const close = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const grouped = GROUPS.map((group) => ({
    ...group,
    skills: visibleSkills.filter((skill) => group.ids?.includes(skill.id) || group.categories.includes(skill.category)),
  })).filter((group) => group.skills.length > 0);
  const groupedIds = new Set(grouped.flatMap((group) => group.skills.map((skill) => skill.id)));
  const remaining = visibleSkills.filter((skill) => !groupedIds.has(skill.id));
  if (remaining.length > 0) grouped.push({ label: '更多创作', categories: [], skills: remaining });

  return (
    <div ref={rootRef} className="relative flex-shrink-0">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        disabled={disabled}
        className={`flex h-8 items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors disabled:opacity-40 ${activeSkill ? 'border border-[rgb(var(--c-border))] bg-white text-[rgb(var(--c-text))] dark:bg-[rgb(var(--c-card))]' : 'bg-white text-[rgb(var(--c-text-muted))] hover:bg-[rgb(var(--c-card))] hover:text-[rgb(var(--c-text))] dark:bg-transparent'}`}
      >
        <Shapes size={14} />
        <span>{activeSkill?.name ?? '创作'}</span>
        <ChevronDown size={12} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 5, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 5, scale: 0.98 }}
            transition={{ duration: 0.12 }}
            className="absolute bottom-full left-0 z-40 mb-2 max-h-[420px] w-[360px] overflow-y-auto rounded-xl border border-[rgb(var(--c-border))] bg-white p-2 shadow-2xl dark:bg-[rgb(var(--c-bg))]"
          >
            {grouped.map((group) => (
              <div key={group.label} className="mb-2 last:mb-0">
                <div className="px-2 py-1.5 text-[11px] font-medium text-[rgb(var(--c-text-muted))]">{group.label}</div>
                <div className="space-y-0.5">
                  {group.skills.map((skill) => {
                    const Icon = SKILL_ICON_MAP[skill.icon];
                    const active = activeSkillId === skill.id;
                    return (
                      <button
                        key={skill.id}
                        type="button"
                        onClick={() => { onSkillClick(skill); setOpen(false); }}
                        className={`flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${active ? 'bg-[rgb(var(--c-card))] text-[rgb(var(--c-text))]' : 'text-[rgb(var(--c-text))] hover:bg-[rgb(var(--c-card))]'}`}
                      >
                        <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md border border-[rgb(var(--c-border))] bg-white text-[rgb(var(--c-text-muted))] dark:bg-[rgb(var(--c-card))]">
                          {Icon ? <Icon size={14} /> : <Shapes size={14} />}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12px] font-medium">{skill.name}</span>
                          <span className="mt-0.5 block truncate text-[10px] text-[rgb(var(--c-text-muted))]">{skill.description}</span>
                        </span>
                        {active && <Check size={13} className="flex-shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
