import { useEffect, useMemo, useState } from 'react';
import { open as openDialog, save as saveDialog } from '@tauri-apps/api/dialog';
import { createDir, readTextFile, writeTextFile } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { open as openPath } from '@tauri-apps/api/shell';
import { ExternalLink, FileDown, FolderInput, RefreshCw } from 'lucide-react';
import { useSkillStore } from '@/stores';
import { useWorkshopStore } from '@/stores/workshopStore';
import type { SkillManifest } from '@/types/skill';
import {
  readSkillPreference,
  writeSkillPreference,
  type SkillPreference,
} from '@/lib/skills/skillPreferences';
import { SKILL_ICON_MAP } from './skillIcons';

function safeSlug(name: string): string {
  const slug = name
    .replace(/\.md$/i, '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || `skill-${Date.now()}`;
}

function skillMarkdown(skill: SkillManifest): string {
  return [
    '---',
    `name: ${skill.id}`,
    `description: ${skill.description.replace(/\n/g, ' ')}`,
    '---',
    '',
    `# ${skill.name}`,
    '',
    skill.promptTemplate,
    '',
  ].join('\n');
}

function relativeTime(value?: number): string {
  if (!value) return '尚未使用';
  const minutes = Math.max(0, Math.round((Date.now() - value) / 60_000));
  if (minutes < 1) return '刚刚使用';
  if (minutes < 60) return `${minutes} 分钟前使用`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} 小时前使用`;
  return `${Math.round(hours / 24)} 天前使用`;
}

export default function SkillLibrary() {
  const skills = useSkillStore((s) => s.skills);
  const loadAllSkills = useSkillStore((s) => s.loadAllSkills);
  const projectId = useWorkshopStore((s) => s.project?.id);
  const visibleSkills = useMemo(
    () => skills.filter((skill) => skill.visibility !== 'internal'),
    [skills],
  );
  const [notice, setNotice] = useState('');
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    const update = () => setRevision((value) => value + 1);
    window.addEventListener('kunpeng:skill-preferences', update);
    return () => window.removeEventListener('kunpeng:skill-preferences', update);
  }, []);

  const importSkill = async () => {
    const selected = await openDialog({
      multiple: false,
      filters: [{ name: 'Markdown 技能', extensions: ['md'] }],
    });
    if (!selected || Array.isArray(selected)) return;
    try {
      const markdown = await readTextFile(selected);
      const baseName = selected.split('/').pop() || 'skill.md';
      const dir = `${await homeDir()}.kunpeng/skills/${safeSlug(baseName)}`;
      await createDir(dir, { recursive: true });
      await writeTextFile(`${dir}/SKILL.md`, markdown);
      await loadAllSkills();
      setNotice('技能已导入。它会在下一轮对话中生效。');
    } catch (error) {
      setNotice(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const refresh = async () => {
    await loadAllSkills();
    setNotice('技能目录已刷新。');
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-zinc-900">技能库</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            {visibleSkills.length} 个技能。停用后，Agent 不再看到或调用该技能。
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => void refresh()} className="skill-library-button" title="刷新技能">
            <RefreshCw size={14} />刷新
          </button>
          <button onClick={() => void importSkill()} className="skill-library-button" title="导入 Markdown 技能">
            <FolderInput size={14} />导入
          </button>
        </div>
      </div>

      {notice && (
        <div className="rounded-md border border-zinc-200 bg-white px-3 py-2 text-xs text-zinc-600">
          {notice}
        </div>
      )}

      <div className="divide-y divide-zinc-100 overflow-hidden rounded-lg border border-zinc-200 bg-white">
        {visibleSkills.map((skill) => (
          <SkillCard key={`${skill.id}-${revision}`} skill={skill} projectId={projectId} onNotice={setNotice} />
        ))}
      </div>
    </div>
  );
}

function SkillCard({ skill, projectId, onNotice }: {
  skill: SkillManifest;
  projectId?: string;
  onNotice: (value: string) => void;
}) {
  const Icon = SKILL_ICON_MAP[skill.icon];
  const [preference, setPreference] = useState<SkillPreference>(() => readSkillPreference(skill.id));
  const isProjectScoped = preference.scope === 'project';
  const enabledHere = preference.enabled && (!isProjectScoped || preference.projectId === projectId);

  const updatePreference = (patch: Partial<SkillPreference>) => {
    setPreference(writeSkillPreference(skill.id, patch));
  };

  const editSkill = async () => {
    if (skill.skillPath) await openPath(`${skill.skillPath}/SKILL.md`);
  };

  const exportSkill = async () => {
    const target = await saveDialog({
      defaultPath: `${safeSlug(skill.id)}.md`,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    });
    if (!target) return;
    try {
      const markdown = skill.source === 'user' && skill.skillPath
        ? await readTextFile(`${skill.skillPath}/SKILL.md`)
        : skillMarkdown(skill);
      await writeTextFile(target, markdown);
      onNotice(`已导出 ${skill.name}。`);
    } catch (error) {
      onNotice(`导出失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  return (
    <div className={`flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-start ${enabledHere ? 'bg-white' : 'bg-zinc-50/70'}`}>
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-zinc-100 text-zinc-700">
        {Icon ? <Icon size={18} /> : <span className="text-sm">{skill.icon}</span>}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-zinc-900">{skill.name}</span>
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">
            {skill.source === 'user' ? '用户技能' : '内置技能'}
          </span>
          {isProjectScoped && (
            <span className="rounded bg-sky-50 px-1.5 py-0.5 text-[10px] text-sky-700">仅本项目</span>
          )}
        </div>
        <p className="mt-1 truncate text-xs text-zinc-500">{skill.description}</p>
        <p className="mt-1 text-[11px] text-zinc-400">{relativeTime(preference.lastUsedAt)} · v{skill.version}</p>
      </div>

      <div className="ml-12 flex flex-wrap items-center gap-1.5 sm:ml-0 sm:shrink-0 sm:justify-end">
        <select
          aria-label={`${skill.name} 作用范围`}
          value={preference.scope}
          onChange={(event) => updatePreference({
            scope: event.target.value as SkillPreference['scope'],
            projectId: event.target.value === 'project' ? projectId : undefined,
          })}
          disabled={!projectId}
          className="h-8 rounded-md border border-zinc-200 bg-white px-2 text-xs text-zinc-600 outline-none focus:border-zinc-400 disabled:opacity-50"
        >
          <option value="global">所有项目</option>
          <option value="project">仅本项目</option>
        </select>
        {skill.source === 'user' && skill.skillPath && (
          <button onClick={() => void editSkill()} className="skill-library-icon" title="编辑 SKILL.md">
            <ExternalLink size={14} />
          </button>
        )}
        <button onClick={() => void exportSkill()} className="skill-library-icon" title="导出 Markdown">
          <FileDown size={14} />
        </button>
        <button
          type="button"
          role="switch"
          aria-checked={enabledHere}
          aria-label={`${enabledHere ? '停用' : '启用'} ${skill.name}`}
          onClick={() => updatePreference({
            enabled: !enabledHere,
            ...(isProjectScoped && preference.projectId !== projectId ? { projectId } : {}),
          })}
          className={`relative h-6 w-10 rounded-full transition-colors ${enabledHere ? 'bg-zinc-900' : 'bg-zinc-300'}`}
        >
          <span className={`absolute top-1 h-4 w-4 rounded-full bg-white transition-transform ${enabledHere ? 'left-5' : 'left-1'}`} />
        </button>
      </div>
    </div>
  );
}
