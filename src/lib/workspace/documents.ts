import type { AigcProjectSource } from '../aigc/projectStore.ts';
import type { ProjectSpec } from '../projectObjects/types.ts';
import type { SkillManifest } from '../../types/skill.ts';
import { isSkillPreferenceActive, readSkillPreference, writeSkillPreference } from '../skills/skillPreferences.ts';

export type DocumentTarget =
  | { kind: 'script'; sourceName: string }
  | { kind: 'spec' }
  | { kind: 'doc'; name: string }
  | { kind: 'skill'; skillId: string };

export interface WorkspaceDocument {
  projectId: string;
  target: DocumentTarget;
  title: string;
  /** Opaque source revision, never a display label. */
  version: string;
  body: string;
  editable: boolean;
  location?: string;
  unavailable?: string;
}

export type SpecProjection = Omit<ProjectSpec, 'revision' | 'updatedAt'>;
export const specFields = [
  ['aspectRatio', '画幅', 'text'], ['targetDurationSec', '目标时长（秒）', 'number'],
  ['language', '语言', 'text'], ['styleTone', '视觉与语气', 'multiline'],
  ['worldAndCharacters', '世界观与人物', 'multiline'], ['continuityFacts', '连续性事实', 'lines'],
  ['forbidden', '禁止项', 'lines'],
  ['defaultImageModel', '默认生图模型', 'imageModel'], ['defaultVideoModel', '默认视频模型', 'videoModel'],
  ['generationConfirmation', '生成确认', 'confirmation'],
] as const;

export function projectSpecProjection(spec: ProjectSpec): string {
  return JSON.stringify(Object.fromEntries(specFields.map(([key, , kind]) => [key, kind === 'lines' ? spec[key] ?? [] : spec[key]])), null, 2);
}

export function parseSpecProjection(body: string): SpecProjection {
  const value: unknown = JSON.parse(body);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('规格必须是结构化字段');
  const record = value as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    const field = specFields.find(([name]) => name === key);
    if (!field) throw new Error(`未知规格字段：${key}`);
    const val = record[key];
    if (field[2] === 'number') {
      if (typeof val !== 'number' || !Number.isFinite(val) || val <= 0) throw new Error('目标时长必须大于零');
    } else if (field[2] === 'lines') {
      if (!Array.isArray(val) || val.some((item) => typeof item !== 'string')) throw new Error(`${field[1]}必须是文本列表`);
    } else if (typeof val !== 'string') throw new Error(`${field[1]}必须是文本`);
  }
  if (!['always-confirm', 'paid-only-confirm', 'direct-execute'].includes(String(record.generationConfirmation))) {
    throw new Error('请选择有效的生成确认偏好');
  }
  return record as unknown as SpecProjection;
}

export function sourceRelativePath(projectId: string, source: AigcProjectSource): string {
  if (![projectId, source.name].every((part) => part && !/[\\/\u0000-\u001f]/.test(part) && part !== '.' && part !== '..')) {
    throw new Error('原剧本登记路径无效');
  }
  if (source.type === 'link') throw new Error('链接原稿不是本地文件');
  return `.kunpeng/aigc-memory/projects/${projectId}/sources/${source.name}`;
}

export function isEditableScript(source: AigcProjectSource): boolean {
  return source.type === 'md' && /\.(md|txt)$/i.test(source.name);
}

/** Project working documents (讨论记录、分镜说明等) live in the project docs/ directory. */
export function docRelativePath(projectId: string, name: string): string {
  if (![projectId, name].every((part) => part && !/[\\/\u0000-\u001f]/.test(part) && part !== '.' && part !== '..')) {
    throw new Error('项目文档路径无效');
  }
  if (!/\.(md|txt)$/i.test(name)) throw new Error('项目文档仅支持 Markdown 或纯文本');
  return `.kunpeng/aigc-memory/projects/${projectId}/docs/${name}`;
}

export function builtinSkillMarkdown(skill: SkillManifest): string {
  return `---\nname: ${JSON.stringify(skill.id)}\ndescription: ${JSON.stringify(skill.description)}\n---\n\n# ${skill.name}\n\n${skill.promptTemplate}\n`;
}

export function projectSkillState(skillId: string, projectId: string) {
  const preference = readSkillPreference(skillId);
  return { preference, active: isSkillPreferenceActive(preference, projectId),
    belongsElsewhere: preference.scope === 'project' && preference.projectId !== projectId };
}

export function setProjectSkillEnabled(skillId: string, projectId: string, enabled: boolean) {
  if (!projectId) throw new Error('没有当前项目');
  if (projectSkillState(skillId, projectId).belongsElsewhere) throw new Error('此 Skill 已限定到其他项目，未转移归属');
  return writeSkillPreference(skillId, { enabled, scope: 'project', projectId });
}

export interface DocumentSaveRequest {
  projectId: string;
  target: DocumentTarget;
  expectedVersion: string;
  body: string;
}

export interface WorkspaceDocumentPort {
  read(projectId: string, target: DocumentTarget): Promise<WorkspaceDocument>;
  /** Must compare source version at the write boundary, not merely when read started. */
  save(request: DocumentSaveRequest): Promise<WorkspaceDocument>;
  openOriginal?(projectId: string, target: DocumentTarget): Promise<void>;
  importSkill?(projectId: string): Promise<SkillManifest | null>;
  exportSkill?(projectId: string, skillId: string): Promise<void>;
}

export interface DocumentDraft {
  source: WorkspaceDocument;
  body: string;
  editRevision: number;
  editing: boolean;
  saving: boolean;
  error?: string;
  incoming?: WorkspaceDocument;
}

export function documentKey(projectId: string, target: DocumentTarget): string {
  return JSON.stringify([projectId, target.kind, target.kind === 'script' ? target.sourceName : target.kind === 'skill' ? target.skillId : target.kind === 'doc' ? target.name : '']);
}

/** Only unsaved UI drafts live here; project files/spec/Skill files remain authoritative. */
export class WorkspaceDocumentDrafts {
  private entries = new Map<string, DocumentDraft>();
  private listeners = new Set<() => void>();
  private revision = 0;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getRevision = () => this.revision;
  get(projectId: string, target: DocumentTarget) { return this.entries.get(documentKey(projectId, target)); }
  private put(key: string, draft: DocumentDraft) {
    this.entries.set(key, draft);
    this.revision += 1;
    this.listeners.forEach((listener) => listener());
  }
  accept(source: WorkspaceDocument) {
    const key = documentKey(source.projectId, source.target);
    const old = this.entries.get(key);
    if (old && (old.saving || old.body !== old.source.body)) {
      if (!old.saving && old.source.version !== source.version) this.put(key, { ...old, incoming: source, error: '原文已更新，未保存稿仍保留。请核对后再保存。' });
      return;
    }
    this.put(key, { source, body: source.body, editRevision: old?.editRevision ?? 0, editing: old?.editing ?? false, saving: false });
  }
  edit(projectId: string, target: DocumentTarget, body: string) {
    const old = this.get(projectId, target);
    if (!old?.source.editable) return;
    this.put(documentKey(projectId, target), { ...old, body, editing: true, editRevision: old.editRevision + 1 });
  }
  setEditing(projectId: string, target: DocumentTarget, editing: boolean) {
    const old = this.get(projectId, target);
    if (old) this.put(documentKey(projectId, target), { ...old, editing });
  }
  discard(source: WorkspaceDocument) {
    const key = documentKey(source.projectId, source.target);
    if (this.entries.get(key)?.saving) throw new Error('正在保存，暂不能丢弃');
    this.put(key, { source, body: source.body, editRevision: 0, editing: false, saving: false });
  }
  rebase(projectId: string, target: DocumentTarget) {
    const old = this.get(projectId, target);
    if (!old?.incoming || old.saving) return;
    this.put(documentKey(projectId, target), { ...old, source: old.incoming, incoming: undefined, error: undefined, editing: true });
  }
  async save(projectId: string, target: DocumentTarget, port: WorkspaceDocumentPort) {
    const key = documentKey(projectId, target);
    const captured = this.entries.get(key);
    if (!captured?.source.editable || captured.saving || captured.body === captured.source.body) return;
    this.put(key, { ...captured, saving: true, error: undefined });
    try {
      const source = await port.save({ projectId, target: { ...target }, expectedVersion: captured.source.version, body: captured.body });
      if (documentKey(source.projectId, source.target) !== key || source.body !== captured.body) throw new Error('保存回执与原目标不一致');
      const latest = this.entries.get(key)!;
      const changedDuringSave = latest.editRevision !== captured.editRevision;
      this.put(key, { ...latest, source, body: changedDuringSave ? latest.body : source.body,
        editing: changedDuringSave, saving: false, error: undefined, incoming: undefined });
    } catch (error) {
      const latest = this.entries.get(key)!;
      this.put(key, { ...latest, saving: false, error: error instanceof Error ? error.message : '保存失败，草稿已保留' });
    }
  }
}

// Survives work-surface unmounts; never writes a parallel script or localStorage copy.
export const workspaceDocumentDrafts = new WorkspaceDocumentDrafts();

const writeQueues = new Map<string, Promise<unknown>>();
export async function serializeDocumentWrite<T>(key: string, run: () => Promise<T>): Promise<T> {
  const previous = writeQueues.get(key);
  const pending = (previous ? previous.catch(() => undefined) : Promise.resolve()).then(run);
  writeQueues.set(key, pending);
  try { return await pending; }
  finally { if (writeQueues.get(key) === pending) writeQueues.delete(key); }
}

export interface DocumentRepository {
  activeProjectId(): string | null;
  lockKey(projectId: string, target: DocumentTarget): string;
  read(projectId: string, target: DocumentTarget): Promise<WorkspaceDocument>;
  /** Called immediately after the final identity/version guard. Writes only captured paths. */
  write(request: DocumentSaveRequest, current: WorkspaceDocument): Promise<WorkspaceDocument>;
}

export function createDocumentCommands(repository: DocumentRepository): Pick<WorkspaceDocumentPort, 'read' | 'save'> {
  return {
    read: (projectId, target) => repository.read(projectId, target),
    save: (request) => {
      const captured = { ...request, target: { ...request.target } };
      const checkProject = () => {
        if (repository.activeProjectId() !== captured.projectId) throw new Error('项目已经切换，草稿已保留');
      };
      checkProject();
      return serializeDocumentWrite(repository.lockKey(captured.projectId, captured.target), async () => {
        checkProject();
        const current = await repository.read(captured.projectId, captured.target);
        checkProject();
        if (documentKey(current.projectId, current.target) !== documentKey(captured.projectId, captured.target)) throw new Error('原文身份不一致');
        if (!current.editable) throw new Error('此原文只读');
        if (current.version !== captured.expectedVersion) throw new Error('原文版本已改变，未覆盖；草稿已保留');
        if (captured.target.kind === 'spec') parseSpecProjection(captured.body);
        return repository.write(captured, current);
      });
    },
  };
}
