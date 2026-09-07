import { open as pickFile, save as saveFile } from '@tauri-apps/api/dialog';
import { BaseDirectory, createDir, readTextFile, writeTextFile } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { open as openPath } from '@tauri-apps/api/shell';
import type { AigcProject } from '../aigc/projectStore';
import type { ProjectSpec } from '../projectObjects/types';
import type { SkillManifest } from '../../types/skill';
import {
  builtinSkillMarkdown, createDocumentCommands, docRelativePath, documentKey, isEditableScript, parseSpecProjection,
  projectSkillState, projectSpecProjection, setProjectSkillEnabled, sourceRelativePath, specFields,
  type DocumentTarget, type SpecProjection, type WorkspaceDocument, type WorkspaceDocumentPort,
} from './documents';

export interface WorkspaceDocumentsContext {
  project: Pick<AigcProject, 'id' | 'sources'>;
  spec?: ProjectSpec;
  skills: SkillManifest[];
}

export interface WorkspaceDocumentsLocalOptions {
  /** Read live identity, not a React-render closure. */
  getContext(): WorkspaceDocumentsContext | null;
  /** Check projectId + revision synchronously, call existing updateProjectSpec, then strict commitNow. */
  commitSpec(projectId: string, expectedRevision: number, patch: Partial<SpecProjection>): Promise<ProjectSpec>;
  reloadSkills(): Promise<void>;
}

/** No reads, scans, dialogs or writes until an explicit component action calls a port method. */
export function createLocalWorkspaceDocumentPort(options: WorkspaceDocumentsLocalOptions): WorkspaceDocumentPort {
  const context = (projectId: string) => {
    const value = options.getContext();
    if (!value || value.project.id !== projectId) throw new Error('项目已经切换，草稿已保留');
    return value;
  };
  const skillFor = (projectId: string, skillId: string) => {
    const skill = context(projectId).skills.find((item) => item.id === skillId);
    if (!skill || skill.visibility === 'internal') throw new Error('Skill 已不存在或不可见');
    return skill;
  };
  const read = async (projectId: string, target: DocumentTarget): Promise<WorkspaceDocument> => {
    const current = context(projectId);
    if (target.kind === 'spec') {
      if (!current.spec) throw new Error('项目规格尚未初始化');
      const body = projectSpecProjection(current.spec);
      return { projectId, target, title: '项目规格与创作规则', body,
        version: JSON.stringify([current.spec.revision, body]), editable: true };
    }
    if (target.kind === 'script') {
      const source = current.project.sources.find((item) => item.name === target.sourceName);
      if (!source) throw new Error('原剧本登记已移除');
      const location = source.type === 'link' ? source.url : sourceRelativePath(projectId, source);
      const editable = isEditableScript(source);
      const body = editable ? await readTextFile(location!, { dir: BaseDirectory.Home }) : '';
      const latest = context(projectId).project.sources.find((item) => item.name === target.sourceName);
      if (JSON.stringify(latest) !== JSON.stringify(source)) throw new Error('原剧本登记已改变');
      return { projectId, target, title: source.name, location, body, editable,
        version: JSON.stringify([source, body]),
        unavailable: editable ? undefined : source.type === 'link' ? '在线原稿，未联网读取' : '原格式文档，请打开原件查看' };
    }
    if (target.kind === 'doc') {
      const location = docRelativePath(projectId, target.name);
      const body = await readTextFile(location, { dir: BaseDirectory.Home });
      return { projectId, target, title: target.name, location, body, editable: true,
        version: JSON.stringify([target.name, body]) };
    }
    const skill = skillFor(projectId, target.skillId);
    const location = skill.source === 'user' && skill.skillPath ? `${skill.skillPath}/SKILL.md` : undefined;
    const body = location ? await readTextFile(location) : builtinSkillMarkdown(skill);
    if (skillFor(projectId, target.skillId).skillPath !== skill.skillPath) throw new Error('Skill 原文位置已改变');
    return { projectId, target, title: skill.name, location, body,
      version: JSON.stringify([location ?? skill.id, body]), editable: Boolean(location) && !projectSkillState(skill.id, projectId).belongsElsewhere };
  };
  const commands = createDocumentCommands({
    activeProjectId: () => options.getContext()?.project.id ?? null,
    lockKey: (projectId, target) => target.kind === 'skill'
      ? `skill:${skillFor(projectId, target.skillId).skillPath ?? target.skillId}` : documentKey(projectId, target),
    read,
    write: async (request, current) => {
      if (request.target.kind === 'spec') {
        const live = context(request.projectId).spec!;
        const values = parseSpecProjection(request.body);
        const patch = Object.fromEntries(specFields.map(([key]) => [key, values[key]])) as Partial<SpecProjection>;
        const saved = await options.commitSpec(request.projectId, live.revision, patch);
        const body = projectSpecProjection(saved);
        return { ...current, body, version: JSON.stringify([saved.revision, body]) };
      }
      // All async work below uses the captured original location, never current-project state.
      if (!current.location) throw new Error('没有可写原文路径');
      if (request.target.kind === 'script' || request.target.kind === 'doc') {
        await writeTextFile(current.location, request.body, { dir: BaseDirectory.Home });
        const metadata = request.target.kind === 'script' ? JSON.parse(current.version)[0] as unknown : request.target.name;
        return { ...current, body: request.body, version: JSON.stringify([metadata, request.body]) };
      }
      await writeTextFile(current.location, request.body);
      // Refresh failure must not misreport a successfully written file as unsaved.
      await options.reloadSkills().catch(() => undefined);
      return { ...current, body: request.body, version: JSON.stringify([current.location, request.body]) };
    },
  });
  return {
    ...commands,
    openOriginal: async (projectId, target) => {
      if (target.kind !== 'script') return;
      const source = context(projectId).project.sources.find((source) => source.name === target.sourceName);
      if (!source) throw new Error('原剧本登记已移除');
      // No browser/network opening: linked sources remain visible references in this module.
      if (source.type === 'link') throw new Error('在线原稿需在浏览器手动打开；本模块不发起网络访问');
      const relative = sourceRelativePath(projectId, source);
      const home = await homeDir();
      context(projectId);
      await openPath(`${home}${relative}`);
    },
    exportSkill: async (projectId, skillId) => {
      const original = await read(projectId, { kind: 'skill', skillId });
      const path = await saveFile({ defaultPath: `${skillId.replace(/[^a-zA-Z0-9_-]/g, '-')}.md`, filters: [{ name: 'Markdown', extensions: ['md'] }] });
      if (!path) return;
      context(projectId);
      await writeTextFile(path, original.body);
    },
    importSkill: async (projectId) => {
      context(projectId);
      const path = await pickFile({ multiple: false, filters: [{ name: 'Markdown Skill', extensions: ['md'] }] });
      if (!path || Array.isArray(path)) return null;
      context(projectId);
      const markdown = await readTextFile(path);
      if (!markdown.trim()) throw new Error('Markdown 内容为空');
      const home = await homeDir();
      context(projectId);
      // Unique directory + manifest id avoids overwriting an existing Skill or relying on frontmatter names.
      const id = `project-skill-${crypto.randomUUID()}`;
      const name = path.split(/[\\/]/).pop()!.replace(/\.md$/i, '');
      const skillPath = `${home}.kunpeng/skills/${id}`;
      const skill: SkillManifest = { id, name, description: '项目 Markdown Skill', version: '1.0.0', icon: 'file-text',
        hasPanel: false, promptTemplate: markdown, visibility: 'library', source: 'user', skillPath, invokable: true };
      // Scope is recorded before the loader can discover the new manifest, including during project switches.
      setProjectSkillEnabled(id, projectId, true);
      await createDir(skillPath, { recursive: true });
      await writeTextFile(`${skillPath}/SKILL.md`, markdown);
      await writeTextFile(`${skillPath}/skill.json`, JSON.stringify({ id, name, description: skill.description,
        version: skill.version, icon: skill.icon, hasPanel: false, visibility: 'library' }, null, 2));
      await options.reloadSkills();
      return skill;
    },
  };
}
