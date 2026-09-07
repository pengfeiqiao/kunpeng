import type { GeneratedAudio, WorkshopData, WsCharacter, WsShot } from '../workshop/types.ts';
import type { AssistantTarget } from './projectAssistantQueue.ts';
import type { GenerationConfirmationPreference } from '../projectObjects/types.ts';
import type { ToolRisk } from '../agent/types.ts';
import { isPaidGeneration, shouldConfirmGeneration } from '../projectObjects/generationDraft.ts';

interface ProductionAssistantBinding {
  version: 1;
  kind: 'character' | 'shot';
  sourceId: string;
  shotNo?: string;
  revision: string;
}

type ProductionAssistantTarget = AssistantTarget & { productionTarget: ProductionAssistantBinding };

function productionAssistantBinding(data: WorkshopData, objectId: string): ProductionAssistantBinding {
  const registry = data.projectObjects;
  const owners = registry?.objects.filter((item) => item.id === objectId) ?? [];
  const owner = owners[0];
  if (registry?.projectId !== data.projectId || owners.length !== 1 || !owner || owner.projectId !== data.projectId
    || owner.locked || owner.archived || !owner.sourceId) throw new Error('声音助手原对象已删除、锁定或改归属。');
  if (owner.kind === 'character') {
    const matches = data.characters.filter((item) => item.id === owner.sourceId);
    if (matches.length !== 1) throw new Error('声音助手原角色已失效。');
    return { version: 1, kind: 'character', sourceId: owner.sourceId,
      revision: JSON.stringify({ owner, character: matches[0], bibles: data.bibles }) };
  }
  if (owner.kind !== 'shot') throw new Error('声音助手目标不是角色或镜头。');
  const matches = data.shots.filter((item) => (item.id ?? item.shotNo) === owner.sourceId);
  const shot = matches[0];
  if (matches.length !== 1 || !shot || data.shots.filter((item) => item.shotNo === shot.shotNo).length !== 1) {
    throw new Error('声音助手原镜头身份或镜号已失效。');
  }
  return { version: 1, kind: 'shot', sourceId: owner.sourceId, shotNo: shot.shotNo,
    revision: JSON.stringify({ owner, shot, characters: data.characters, model: data.videoModel, bibles: data.bibles }) };
}

export function captureProductionAssistantTarget(data: WorkshopData, objectId: string, sessionId: string | null,
  contextBase: string, label: string): ProductionAssistantTarget {
  return { projectId: data.projectId, objectId, sessionId, surface: 'media', label, contextBase,
    context: `${contextBase}\n\n`, references: [], productionTarget: productionAssistantBinding(data, objectId) };
}

/** Serialized identity/revision survives queue persistence; never recover it from prompt prose. */
export function validateProductionAssistantTarget(target: AssistantTarget, data: WorkshopData | null | undefined): string | null {
  const frozen = (target as Partial<ProductionAssistantTarget>).productionTarget;
  if (!frozen) {
    return target.context.includes('只为指定对象完善音色描述或配音提示词，不执行音色、配音或其他付费生成。')
      ? '旧声音助手消息缺少对象快照，请重新提交。' : null;
  }
  if (!data || data.projectId !== target.projectId || !target.objectId) return '声音助手原项目或对象已变化，消息尚未发送。';
  try {
    const current = productionAssistantBinding(data, target.objectId);
    if (frozen.version !== 1 || current.kind !== frozen.kind || current.sourceId !== frozen.sourceId
      || current.shotNo !== frozen.shotNo || current.revision !== frozen.revision) {
      return '声音助手原对象、镜号或内容修订已变化，请重新提交。';
    }
  } catch { return '声音助手原对象已删除、锁定、归档或改归属，请重新提交。'; }
  return null;
}

export interface ProductionJob {
  characterId: string;
  characterName: string;
  prompt: string;
  referencePath?: string;
  referenceData?: string;
  referenceDigest?: string;
}

export function shotSpeechJobs(shot: WsShot, characters: WsCharacter[]): ProductionJob[] {
  const seen = new Set<string>();
  return (shot.audioPrompts ?? []).filter((item) => item.prompt.trim()).map((item) => {
    if (seen.has(item.characterId)) throw new Error('同一角色有重复配音条目，请先合并台词。');
    seen.add(item.characterId);
    const character = characters.find((candidate) => candidate.id === item.characterId);
    if (!character) throw new Error('配音角色已删除，请先调整台词。');
    const useVoice = shot.voiceCharacterIds === undefined || shot.voiceCharacterIds.includes(character.id);
    return { characterId: character.id, characterName: character.name, prompt: item.prompt,
      ...(useVoice && character.voicePath ? { referencePath: character.voicePath } : {}) };
  });
}

export function productionJobKey(job: ProductionJob): string {
  return JSON.stringify([job.characterId, job.prompt, job.referencePath ?? '', job.referenceDigest ?? '']);
}

export function productionFileName(label: string, operationId: string, extension = 'mp3'): string {
  return `${label.replace(/[^\w\u4e00-\u9fff-]+/g, '_').slice(0, 80)}-${operationId.replace(/[^\w-]/g, '_')}.${extension.replace(/[^a-z0-9]/gi, '')}`;
}

/** Subscription invalidation is permanent: switching A -> B -> A cannot revive a request. */
export function captureProductionLease(port: {
  read: () => string | null;
  subscribe: (listener: () => void) => () => void;
}) {
  const expected = port.read();
  if (!expected) throw new Error('项目或对象不可编辑。');
  const controller = new AbortController();
  let valid = true;
  const current = () => valid && port.read() === expected;
  const off = port.subscribe(() => {
    if (!current()) { valid = false; controller.abort(); }
  });
  return {
    signal: controller.signal,
    current,
    assertCurrent() { if (!current()) throw new Error('项目或内容已变化，未覆盖新编辑。'); },
    close() { valid = false; controller.abort(); off(); },
  };
}

const busy = new Set<string>();
export function claimProduction(key: string): (() => void) | null {
  if (busy.has(key)) return null;
  busy.add(key);
  return () => { busy.delete(key); };
}

export interface ProductionReceipt {
  id: string;
  projectId: string;
  objectId: string;
  kind: 'voice' | 'dubbing' | 'trim' | 'upload' | 'image-upload';
  job: Omit<ProductionJob, 'referenceData'>;
  status: 'started' | 'completed' | 'uncertain' | 'cancelled';
  audio?: GeneratedAudio;
  outputPath?: string;
}

export function pendingProductionJobs(jobs: ProductionJob[], receipts: ProductionReceipt[], projectId: string, objectId: string, repeatCharacterId?: string): ProductionJob[] {
  return jobs.filter((job) => {
    const submitted = receipts.filter((item) => item.projectId === projectId && item.objectId === objectId
      && item.status !== 'cancelled' && (item.kind === 'voice' || item.kind === 'dubbing')
      && productionJobKey(item.job) === productionJobKey(job));
    if (repeatCharacterId) return job.characterId === repeatCharacterId
      && submitted.some((item) => item.status === 'completed')
      && !submitted.some((item) => item.status === 'started' || item.status === 'uncertain');
    return submitted.length === 0;
  });
}

const receiptStatusRank: Record<ProductionReceipt['status'], number> = { started: 0, cancelled: 1, uncertain: 2, completed: 3 };
export function mergeProductionReceipt(receipts: ProductionReceipt[], incoming: ProductionReceipt): ProductionReceipt[] {
  const previous = receipts.find((item) => item.id === incoming.id && item.projectId === incoming.projectId && item.objectId === incoming.objectId);
  if (previous && receiptStatusRank[previous.status] >= receiptStatusRank[incoming.status]) return receipts;
  return [...receipts.filter((item) => item !== previous), incoming];
}

export function parseProductionReceipts(rows: string[], projectId: string, objectId: string): { receipts: ProductionReceipt[]; invalidCount: number } {
  let receipts: ProductionReceipt[] = [];
  let invalidCount = 0;
  for (const row of rows) {
    try {
      const item = JSON.parse(row) as ProductionReceipt;
      if (!item || item.projectId !== projectId || item.objectId !== objectId || typeof item.id !== 'string'
        || !Object.prototype.hasOwnProperty.call(receiptStatusRank, item.status) || !item.job || typeof item.job.characterId !== 'string'
        || typeof item.job.characterName !== 'string' || typeof item.job.prompt !== 'string'
        || !['voice', 'dubbing', 'trim', 'upload', 'image-upload'].includes(item.kind)) throw new Error('invalid receipt');
      if (item.audio && (typeof item.audio.path !== 'string' || typeof item.audio.characterId !== 'string'
        || typeof item.audio.characterName !== 'string' || !Number.isFinite(item.audio.duration))) throw new Error('invalid artifact');
      if (item.status === 'completed' && (item.kind === 'image-upload' ? typeof item.outputPath !== 'string' : !item.audio)) throw new Error('missing artifact');
      receipts = mergeProductionReceipt(receipts, item);
    } catch { invalidCount++; }
  }
  return { receipts, invalidCount };
}

/** Generation only retains candidates. Target adoption belongs to a separate explicit UI action. */
export async function runConfirmedProduction(input: {
  jobs: ProductionJob[];
  lease: ReturnType<typeof captureProductionLease>;
  executionPreference?: GenerationConfirmationPreference;
  /** Trusted speech tool metadata, never a job/prompt supplied paid flag. */
  risk?: ToolRisk;
  confirm: (jobs: ProductionJob[]) => Promise<boolean>;
  submit: (job: ProductionJob, index: number) => Promise<GeneratedAudio>;
  retain: (audio: GeneratedAudio, job: ProductionJob, index: number) => Promise<void>;
}): Promise<{ audios: GeneratedAudio[]; failedIndex?: number; cancelled?: boolean }> {
  const jobs = structuredClone(input.jobs);
  const executionPreference = input.executionPreference ?? 'paid-only-confirm';
  const risk = input.risk;
  input.lease.assertCurrent();
  if (risk === 'deny') throw new Error('当前声音工具禁止执行。');
  if (shouldConfirmGeneration(executionPreference, isPaidGeneration(risk))
    && !await input.confirm(structuredClone(jobs))) return { audios: [], cancelled: true };
  input.lease.assertCurrent();
  const audios: GeneratedAudio[] = [];
  let failedIndex: number | undefined;
  for (let index = 0; index < jobs.length; index++) {
    if (!input.lease.current()) break;
    try {
      const audio = await input.submit(jobs[index], index);
      // Late results remain discoverable, but never write the current voice/shot or its references.
      await input.retain(audio, jobs[index], index);
      audios.push(audio);
    } catch {
      failedIndex = index;
      break;
    }
  }
  return { audios, failedIndex };
}
