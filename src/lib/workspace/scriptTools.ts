import type { AigcProject, AigcProjectSource } from '../aigc/projectStore.ts';
import type { AssistantTarget } from './projectAssistantQueue.ts';
import { ProjectWriteQueue } from '../aigc/projectWriteQueue.ts';

const sourceWrites = new ProjectWriteQueue();

export interface ScriptContext {
  project: AigcProject | null;
  dataProjectId?: string;
  activeProjectId: string | null;
  sessionId?: string | null;
  style?: unknown;
}

export interface ScriptContextPort {
  read: () => ScriptContext;
  subscribe: (listener: () => void) => () => void;
}

function projectRevision(project: AigcProject): string {
  const { updatedAt: _updatedAt, ...fields } = project;
  return JSON.stringify(fields);
}

/** A switch away and back invalidates the operation even when the IDs match again. */
export function captureScriptOperation(projectId: string, port: ScriptContextPort, requireActive = false) {
  const initial = port.read();
  if (!initial.project || initial.project.id !== projectId || initial.dataProjectId !== projectId
    || (requireActive ? initial.activeProjectId !== projectId : initial.activeProjectId !== null && initial.activeProjectId !== projectId)) {
    throw new Error('项目已切换，未执行本次操作。');
  }
  const snapshot = structuredClone({ ...initial, project: initial.project });
  const revision = projectRevision(snapshot.project);
  const style = JSON.stringify(snapshot.style);
  let valid = true;
  let identityValid = true;
  const identityMatches = () => {
    const current = port.read();
    return current.project?.id === projectId && current.dataProjectId === projectId
      && current.activeProjectId === snapshot.activeProjectId && current.sessionId === snapshot.sessionId;
  };
  const matches = () => {
    const current = port.read();
    return current.project?.id === projectId && current.dataProjectId === projectId
      && current.activeProjectId === snapshot.activeProjectId && current.sessionId === snapshot.sessionId
      && projectRevision(current.project) === revision && JSON.stringify(current.style) === style;
  };
  const unsubscribe = port.subscribe(() => {
    if (!identityMatches()) identityValid = false;
    if (!matches()) valid = false;
  });
  return {
    snapshot,
    assertCurrent() {
      if (!valid || !matches()) throw new Error('项目或剧本来源已变化，本次操作未覆盖新内容。');
    },
    assertPublished(receipt: AigcProject) {
      if (!identityValid || !identityMatches() || !scriptProjectMatches(receipt, port.read().project)) {
        throw new Error('项目已切换或更新，未应用迟到的操作状态。');
      }
    },
    close() { valid = false; identityValid = false; unsubscribe(); },
  };
}

export type ScriptOperation = ReturnType<typeof captureScriptOperation>;

interface ScriptSourcePort {
  readProject: (id: string) => Promise<AigcProject | null>;
  writeProject: (project: AigcProject) => Promise<void>;
  publish: (expected: AigcProject, next: AigcProject) => boolean;
}

export async function commitScriptSources(operation: ScriptOperation, sources: AigcProjectSource[], port: ScriptSourcePort): Promise<AigcProject> {
  const capturedSources = structuredClone(sources);
  let receipt!: AigcProject;
  await sourceWrites.write(operation.snapshot.project.id, async () => {
    receipt = await persistScriptSources(operation, capturedSources, port);
  });
  return receipt;
}

async function persistScriptSources(operation: ScriptOperation, sources: AigcProjectSource[], port: ScriptSourcePort): Promise<AigcProject> {
  operation.assertCurrent();
  const expected = operation.snapshot.project;
  const disk = await port.readProject(expected.id);
  operation.assertCurrent();
  if (!disk || projectRevision(disk) !== projectRevision(expected)) {
    throw new Error('项目文件已有更新，请重新打开项目后再管理剧本来源。');
  }
  const next = { ...disk, sources: structuredClone(sources), updatedAt: Date.now() };
  await port.writeProject(next);
  operation.assertCurrent();
  const receipt = await port.readProject(expected.id);
  operation.assertCurrent();
  if (!receipt || projectRevision(receipt) !== projectRevision(next)) {
    throw new Error('剧本来源保存未确认，未更新界面，请核对项目文件。');
  }
  if (!port.publish(expected, receipt)) throw new Error('剧本来源已被修改，本次结果未覆盖新内容。');
  return receipt;
}

export function scriptProjectMatches(expected: AigcProject, current: AigcProject | null): boolean {
  return Boolean(current && projectRevision(expected) === projectRevision(current));
}

export function scriptBreakdownTarget(operation: ScriptOperation): AssistantTarget {
  operation.assertCurrent();
  const { project, sessionId } = operation.snapshot;
  const contextBase = `[媒体工作台上下文：${JSON.stringify({ project_id: project.id, operation: 'script-breakdown' })}]\n`
    + '当前为用户明确发起的项目级剧本拆解，不是当前媒体的局部改词，也不是仅编辑文档。'
    + '只读取本项目已登记剧本，允许按原文完善本项目梗概、分集分场、角色、场景、事实账本、创作规则和分镜。'
    + '不创作性改写原剧本、对白与人物关系；已有媒体、采用版本及时间线不自动替换。'
    + '本次只拆解，不执行生图、视频、音色或配音生成；遵守锁定和修订冲突，后续付费操作仍须单独确认。';
  return { projectId: project.id, sessionId: sessionId ?? null, surface: 'media', label: '剧本拆解',
    contextBase, context: `${contextBase}\n\n`, references: [] };
}

export async function enqueueScriptBreakdown(operation: ScriptOperation, port: {
  buildStyle: () => Promise<string>;
  buildPrompt: (style: string) => string;
  enqueue: (target: AssistantTarget, prompt: string) => unknown;
}): Promise<void> {
  const target = scriptBreakdownTarget(operation);
  if (!operation.snapshot.project.sources.length) throw new Error('请先添加剧本来源。');
  const style = await port.buildStyle();
  operation.assertCurrent();
  const prompt = port.buildPrompt(style);
  operation.assertCurrent();
  port.enqueue(target, prompt);
}
