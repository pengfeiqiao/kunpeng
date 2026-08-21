import { useSkillStore } from '@/stores';
import type { SkillManifest } from '@/types/skill';
import { SKILL_ICON_MAP } from './skillIcons';

export default function SkillLibrary() {
  const skills = useSkillStore((s) => s.skills);
  const visibleSkills = skills.filter((skill) => skill.visibility !== 'internal');
  const loadAllSkills = useSkillStore((s) => s.loadAllSkills);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          已安装 {visibleSkills.length} 个技能
        </p>
        <button
          onClick={loadAllSkills}
          className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-xs font-medium text-zinc-700 transition-colors hover:bg-zinc-50"
        >
          刷新技能
        </button>
      </div>

      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {visibleSkills.map((skill) => (
          <SkillCard key={skill.id} skill={skill} />
        ))}
      </div>

      <div className="rounded-lg border border-dashed border-zinc-200 bg-zinc-50/50 p-3 text-center">
        <button
          disabled
          className="cursor-not-allowed rounded-md bg-zinc-100 px-4 py-2 text-xs text-zinc-500 opacity-70"
        >
          从 GitHub 下载 — 即将推出
        </button>
      </div>
    </div>
  );
}

function SkillCard({ skill }: { skill: SkillManifest }) {
  const Icon = SKILL_ICON_MAP[skill.icon];
  return (
    <div className="flex items-center gap-3 bg-white px-4 py-3">
      <div className="flex h-9 w-9 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
        {Icon ? <Icon size={18} /> : <span className="text-lg">{skill.icon}</span>}
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{skill.name}</span>
          <span className="text-[10px] text-zinc-500 bg-zinc-100 px-1.5 py-0.5 rounded">
            v{skill.version}
          </span>
        </div>
        <p className="text-xs text-zinc-500 truncate">{skill.description}</p>
      </div>
      <span className="rounded bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-700">
        已安装
      </span>
    </div>
  );
}
