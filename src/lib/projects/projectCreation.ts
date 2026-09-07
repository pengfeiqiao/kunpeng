import type { ProjectIntakeRecord } from './projectIntake.ts';

export interface PendingProjectCreation {
  projectId: string;
  name: string;
  intake?: ProjectIntakeRecord;
}

export const PENDING_PROJECT_CREATION_KEY = 'kunpeng-pending-project-creation-v1';

export class InvalidPendingProjectCreation extends Error {
  constructor() { super('未发送创意记录无法读取；未新建项目，也未提交请求。'); }
}

export function readPendingProjectCreation(storage: Pick<Storage, 'getItem'>): PendingProjectCreation | undefined {
  const raw = storage.getItem(PENDING_PROJECT_CREATION_KEY);
  if (!raw) return;
  let value: PendingProjectCreation;
  try { value = JSON.parse(raw) as PendingProjectCreation; }
  catch { throw new InvalidPendingProjectCreation(); }
  const intake = value?.intake;
  if (!value || typeof value.projectId !== 'string' || !value.projectId || typeof value.name !== 'string'
    || (intake && (typeof intake.brief !== 'string' || typeof intake.createdAt !== 'number'
      || !['idea', 'script', 'materials', 'reference-video'].includes(intake.mode)
      || !['stage-confirm', 'continuous'].includes(intake.automation)
      || !Array.isArray(intake.attachments) || intake.attachments.some((item) => !item || typeof item.path !== 'string'
        || !['image', 'video', 'audio', 'document', 'unknown'].includes(item.kind))))) {
    throw new InvalidPendingProjectCreation();
  }
  return value;
}

export class ProjectCreationInterrupted extends Error {
  readonly projectId: string;
  constructor(projectId: string, message = '项目已创建，但当前项目已变化。创意尚未发送。') {
    super(message);
    this.projectId = projectId;
  }
}

export interface CreationIdentity {
  projectId: string | undefined;
  dataProjectId: string | undefined;
  intake?: ProjectIntakeRecord;
}

export async function openPendingProjectCreation(projectId: string, port: {
  read: () => CreationIdentity;
  subscribe: (listener: () => void) => () => void;
  open: () => Promise<void>;
}) {
  const initial = port.read();
  let arrived = false;
  let valid = true;
  const check = () => {
    const state = port.read();
    if (state.projectId === projectId && state.dataProjectId === projectId) arrived = true;
    else if (arrived || state.projectId !== initial.projectId || state.dataProjectId !== initial.dataProjectId) valid = false;
  };
  const dispose = port.subscribe(check);
  try {
    await port.open();
    check();
    if (!valid || !arrived) throw new ProjectCreationInterrupted(projectId);
  } finally { dispose(); }
}

/** A switch away invalidates this operation even when the user switches back. */
export function captureProjectCreationLease(projectId: string, port: {
  read: () => CreationIdentity;
  subscribe: (listener: () => void) => () => void;
}) {
  let valid = true;
  let expectedIntake: string | undefined;
  const check = () => {
    const state = port.read();
    if (state.projectId !== projectId || state.dataProjectId !== projectId
      || (expectedIntake !== undefined && JSON.stringify(state.intake) !== expectedIntake)) valid = false;
  };
  const dispose = port.subscribe(check);
  check();
  return {
    assert() { check(); if (!valid) throw new ProjectCreationInterrupted(projectId); },
    freezeIntake(intake: ProjectIntakeRecord) { expectedIntake = JSON.stringify(intake); check(); },
    dispose,
  };
}

export async function finishProjectCreation(pending: PendingProjectCreation, port: {
  read: () => CreationIdentity;
  subscribe: (listener: () => void) => () => void;
  writeIntake: (intake: ProjectIntakeRecord, assertCurrent: () => void) => void;
  commit: () => Promise<void>;
  prepareAndOpen: (assertCurrent: () => void) => Promise<string>;
  enqueue: (sessionId: string, intake: ProjectIntakeRecord) => void;
  show: () => void;
}) {
  const lease = captureProjectCreationLease(pending.projectId, port);
  try {
    lease.assert();
    if (pending.intake) {
      const existing = port.read().intake;
      if (existing && JSON.stringify(existing) !== JSON.stringify(pending.intake)) {
        throw new Error('项目创意已被修改，未覆盖，也未发送原请求。');
      }
      if (!existing) port.writeIntake(structuredClone(pending.intake), () => lease.assert());
      lease.freezeIntake(pending.intake);
      lease.assert();
      await port.commit();
      lease.assert();
    }
    const sessionId = await port.prepareAndOpen(() => lease.assert());
    lease.assert();
    if (pending.intake) port.enqueue(sessionId, pending.intake);
    port.show();
  } finally {
    lease.dispose();
  }
}
