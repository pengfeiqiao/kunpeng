/**
 * Harness-level evolution loop. Persisted data is compact and redacted;
 * candidate skills pass a deterministic quality gate before becoming visible.
 */
import {
  BaseDirectory,
  copyFile,
  createDir,
  readDir,
  readTextFile,
  removeDir,
  writeTextFile,
} from '@tauri-apps/api/fs';
import { quickChat } from './quickChat';
import { cursorForTrajectories, freshTrajectories } from './evolutionCursor';
import { invalidateMemoryIndex, loadMemoryIndex } from './findRelevantMemories';
import { agentLog } from './logger';
import type { AgentSkillManifest } from './skillLoader';
import {
  detectNegativeFeedback,
  mergeAutoSkillUsage,
  normalizeAutoSkillVisibility,
  planSkillConsolidation,
  replaceObsoleteModelNames,
  resolveAutoSkillLifecycle,
  summarizeTrajectoryValue,
  SerialTaskQueue,
  SuccessfulRunThrottle,
  type AutoSkillDraft,
  type ConsolidationCandidate,
  type TrajectoryToolTrace,
  validateAutoSkillDraft,
} from './evolutionPolicy';

const EVOLUTION_DIR = '.kunpeng/evolution';
const TRAJ_FILE = `${EVOLUTION_DIR}/trajectories.jsonl`;
const STATE_FILE = `${EVOLUTION_DIR}/state.json`;
const ARCHIVE_DIR = `${EVOLUTION_DIR}/archive/skills`;
const SKILLS_DIR = '.kunpeng/skills';
const QUARANTINE_DIR = `${SKILLS_DIR}/quarantine`;
const MEMORY_DIR = '.kunpeng/memory';
const TRAJECTORY_MAX = 800;
const TRAJECTORY_KEEP = 600;
const REFLECT_MIN_NEW = 12;
const REFLECT_BATCH = 40;
const REFLECT_MIN_INTERVAL_MS = 30 * 60 * 1000;
const CONSOLIDATE_INTERVAL_MS = 24 * 60 * 60 * 1000;
const MAX_AUTO_SKILLS = 8;
const MODEL_REPLACEMENTS: Record<string, string> = {
  'kimi-k3-1m': 'k3[1m]',
  'kimi-k3': 'k3',
  'glm-4.5': 'glm-5.1',
};

let trajectoryWriteQueue: Promise<void> = Promise.resolve();
const reflectionQueue = new SerialTaskQueue();
let catalogToolNames = new Set<string>();
let catalogModelNames = new Set<string>();

export interface TrajectoryRecord {
  ts: number;
  req: string;
  tools: Record<string, number>;
  fail: Record<string, number>;
  traces?: TrajectoryToolTrace[];
  negative?: boolean;
  secs: number;
  status: 'done' | 'failed' | 'aborted';
}

interface EvolutionState {
  offset: number;
  reflections: number;
  lastRunAt: number;
  lastConsolidatedAt?: number;
  cursorTs?: number;
  cursorCountAtTs?: number;
}

interface ReflectedMemory {
  name: string;
  description: string;
  memory_type: string;
  body: string;
}

interface AutoSkillMetadata {
  name: string;
  displayName: string;
  description: string;
  triggers: string[];
  promptTemplate: string;
  tools: string[];
  models: string[];
  createdAt: number;
  references: number;
  lastReferencedAt?: number;
  referencedRunIds: string[];
  promoted: boolean;
}

interface AutoSkillRecord {
  dirName: string;
  metadata: AutoSkillMetadata;
  markdown: string;
}

const DEFAULT_STATE: EvolutionState = { offset: 0, reflections: 0, lastRunAt: 0 };

export function configureEvolutionCatalog(input: {
  toolNames: Iterable<string>;
  modelNames: Iterable<string>;
}): void {
  catalogToolNames = new Set(input.toolNames);
  catalogModelNames = new Set(input.modelNames);
}

function slugify(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60);
}

function safeJson<T>(raw: string): T | null {
  try { return JSON.parse(raw) as T; } catch { return null; }
}

function extractJson(text: string): Record<string, unknown> | null {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  return start >= 0 && end > start ? safeJson<Record<string, unknown>>(cleaned.slice(start, end + 1)) : null;
}

async function readHome(path: string): Promise<string | null> {
  try { return await readTextFile(path, { dir: BaseDirectory.Home }); } catch { return null; }
}

async function writeHome(path: string, content: string): Promise<void> {
  await writeTextFile(path, content, { dir: BaseDirectory.Home });
}

export async function recordTrajectory(rec: TrajectoryRecord): Promise<void> {
  const compact: TrajectoryRecord = {
    ...rec,
    req: summarizeTrajectoryValue(rec.req, 200),
    traces: rec.traces?.slice(-40).map((trace) => ({
      ...trace,
      params: summarizeTrajectoryValue(trace.params, 200),
      ...(trace.error ? { error: summarizeTrajectoryValue(trace.error, 200) } : {}),
    })),
  };
  const write = trajectoryWriteQueue.then(async () => {
    try {
      await createDir(EVOLUTION_DIR, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
      const existing = await readHome(TRAJ_FILE);
      const lines = existing ? existing.split('\n').filter(Boolean) : [];
      lines.push(JSON.stringify(compact));
      const trimmed = lines.length > TRAJECTORY_MAX ? lines.slice(-TRAJECTORY_KEEP) : lines;
      await writeHome(TRAJ_FILE, `${trimmed.join('\n')}\n`);
    } catch (error) {
      agentLog.debug('Evolution', `recordTrajectory skipped: ${summarizeTrajectoryValue(error instanceof Error ? error.message : error)}`);
    }
  });
  trajectoryWriteQueue = write.catch(() => {});
  await write;
}

async function loadTrajectories(): Promise<TrajectoryRecord[]> {
  const raw = await readHome(TRAJ_FILE);
  if (!raw) return [];
  return raw.split('\n').filter(Boolean).map((line) => safeJson<TrajectoryRecord>(line)).filter((item): item is TrajectoryRecord => Boolean(item));
}

async function loadState(): Promise<EvolutionState> {
  const raw = await readHome(STATE_FILE);
  return raw ? { ...DEFAULT_STATE, ...(safeJson<Partial<EvolutionState>>(raw) ?? {}) } : { ...DEFAULT_STATE };
}

async function saveState(state: EvolutionState): Promise<void> {
  await createDir(EVOLUTION_DIR, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
  await writeHome(STATE_FILE, JSON.stringify(state, null, 2));
}

async function listTopLevelSkillDirs(): Promise<string[]> {
  try {
    const entries = await readDir(SKILLS_DIR, { dir: BaseDirectory.Home });
    return entries.map((entry) => entry.name).filter((name): name is string => Boolean(name));
  } catch { return []; }
}

async function readExistingSkillSummaries(): Promise<Array<{ name: string; promptTemplate?: string }>> {
  const dirs = await listTopLevelSkillDirs();
  const rows = await Promise.all(dirs.map(async (dirName) => {
    const markdown = await readHome(`${SKILLS_DIR}/${dirName}/SKILL.md`);
    if (!markdown) return null;
    const name = markdown.match(/^name:\s*["']?([^\n"']+)/m)?.[1]?.trim() || dirName;
    const body = markdown.replace(/^---[\s\S]*?---\s*/m, '').trim();
    return { name, promptTemplate: body.slice(0, 4000) };
  }));
  return rows.filter((row): row is { name: string; promptTemplate: string } => Boolean(row));
}

async function readAutoSkillRecord(dirName: string): Promise<AutoSkillRecord | null> {
  if (!dirName.startsWith('auto-')) return null;
  const [metadataRaw, markdown] = await Promise.all([
    readHome(`${SKILLS_DIR}/${dirName}/evolution.json`),
    readHome(`${SKILLS_DIR}/${dirName}/SKILL.md`),
  ]);
  if (!metadataRaw || !markdown) return null;
  const metadata = safeJson<AutoSkillMetadata>(metadataRaw);
  return metadata ? { dirName, metadata, markdown } : null;
}

async function listAutoSkills(): Promise<AutoSkillRecord[]> {
  const dirs = await listTopLevelSkillDirs();
  const records = await Promise.all(dirs.map(readAutoSkillRecord));
  return records.filter((record): record is AutoSkillRecord => Boolean(record));
}

async function writeAutoMetadata(record: AutoSkillRecord): Promise<void> {
  await writeHome(`${SKILLS_DIR}/${record.dirName}/evolution.json`, JSON.stringify(record.metadata, null, 2));
}

async function archiveAutoSkill(record: AutoSkillRecord, reason: string): Promise<void> {
  const destination = `${ARCHIVE_DIR}/${record.dirName}-${Date.now()}`;
  await createDir(destination, { dir: BaseDirectory.Home, recursive: true });
  await copyFile(`${SKILLS_DIR}/${record.dirName}/SKILL.md`, `${destination}/SKILL.md`, { dir: BaseDirectory.Home }).catch(() => {});
  await writeHome(`${destination}/evolution.json`, JSON.stringify({ ...record.metadata, archivedAt: Date.now(), reason }, null, 2));
  const manifest = await readHome(`${SKILLS_DIR}/${record.dirName}/skill.json`);
  if (manifest) await writeHome(`${destination}/skill.json`, manifest);
  await removeDir(`${SKILLS_DIR}/${record.dirName}`, { dir: BaseDirectory.Home, recursive: true });
}

async function promoteAutoSkill(record: AutoSkillRecord): Promise<void> {
  if (record.metadata.promoted) return;
  const id = `auto-${slugify(record.metadata.name)}`;
  await writeHome(`${SKILLS_DIR}/${record.dirName}/skill.json`, JSON.stringify({
    id,
    name: record.metadata.displayName,
    description: record.metadata.description,
    version: '1.0.0',
    category: 'auto',
    visibility: 'library',
    hasPanel: false,
    promptTemplate: `[自进化技能] 请读取 ~/.kunpeng/skills/${record.dirName}/SKILL.md，并严格按其中步骤执行。\n\n{{userContent}}`,
  }, null, 2));
  record.metadata.promoted = true;
  await writeAutoMetadata(record);
}

async function quarantineDraft(draft: AutoSkillDraft, reasons: string[]): Promise<void> {
  const dirName = `${Date.now()}-${slugify(draft.name || 'invalid-skill') || 'invalid-skill'}`;
  const dir = `${QUARANTINE_DIR}/${dirName}`;
  await createDir(dir, { dir: BaseDirectory.Home, recursive: true });
  await writeHome(`${dir}/candidate.json`, JSON.stringify({
    draft: { ...draft, promptTemplate: summarizeTrajectoryValue(draft.promptTemplate, 200) },
    reasons,
    quarantinedAt: Date.now(),
  }, null, 2));
}

async function persistAutoSkillDraft(draft: AutoSkillDraft): Promise<boolean> {
  const existingSkills = await readExistingSkillSummaries();
  const result = validateAutoSkillDraft(draft, {
    toolNames: catalogToolNames,
    modelNames: catalogModelNames,
    existingSkills,
  });
  if (!result.ok || !result.markdown) {
    await quarantineDraft(draft, result.reasons);
    return false;
  }
  const now = Date.now();
  const dirName = `auto-${now}-${slugify(draft.name)}`;
  const metadata: AutoSkillMetadata = {
    name: draft.name,
    displayName: draft.displayName,
    description: draft.description,
    triggers: [...draft.triggers],
    promptTemplate: draft.promptTemplate,
    tools: [...(draft.tools ?? [])],
    models: [...(draft.models ?? [])],
    createdAt: now,
    references: 0,
    referencedRunIds: [],
    promoted: false,
  };
  await createDir(`${SKILLS_DIR}/${dirName}`, { dir: BaseDirectory.Home, recursive: true });
  await Promise.all([
    writeHome(`${SKILLS_DIR}/${dirName}/SKILL.md`, result.markdown),
    writeHome(`${SKILLS_DIR}/${dirName}/evolution.json`, JSON.stringify(metadata, null, 2)),
  ]);
  return true;
}

const REFLECT_SYSTEM = `你是鲲鹏 Agent 的自进化自省引擎。输入是压缩、脱敏后的执行轨迹。只输出严格 JSON：
{"memories":[{"name":"kebab-case","description":"一句话","memory_type":"feedback|project|user","body":"完整经验"}],"skills":[{"name":"kebab-case","displayName":"中文名","description":"一句话","triggers":["关键词"],"promptTemplate":"至少三步的完整操作指南","tools":["实际工具名"],"models":["实际模型 ID"]}]}
只提炼反复出现或造成明确失败的模式。技能必须声明用到的工具和模型；不要捏造列表外名称。最多 3 条记忆、1 个技能。没有可靠经验就返回空数组。`;

const NEGATIVE_REFLECT_SYSTEM = `用户刚刚明确否定或中止了任务。聚焦三件事：哪一步做错、以后正确做法、是否需要形成反馈记忆或可复用技能。不得推测用户未表达的偏好。`;

function normalizeMemories(value: unknown): ReflectedMemory[] {
  return (Array.isArray(value) ? value : []).slice(0, 3).map((item) => {
    const raw = item as Partial<ReflectedMemory>;
    return {
      name: slugify(String(raw.name || '')),
      description: String(raw.description || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      memory_type: ['feedback', 'project', 'user'].includes(String(raw.memory_type)) ? String(raw.memory_type) : 'feedback',
      body: String(raw.body || '').trim().slice(0, 2000),
    };
  }).filter((item) => item.name && item.description && item.body);
}

function normalizeSkills(value: unknown): AutoSkillDraft[] {
  return (Array.isArray(value) ? value : []).slice(0, 1).map((item) => {
    const raw = item as Partial<AutoSkillDraft>;
    return {
      name: slugify(String(raw.name || '')),
      displayName: String(raw.displayName || raw.name || '').trim().slice(0, 60),
      description: String(raw.description || '').replace(/\s+/g, ' ').trim().slice(0, 240),
      triggers: (Array.isArray(raw.triggers) ? raw.triggers : []).map(String).map((v) => v.trim()).filter(Boolean).slice(0, 8),
      promptTemplate: String(raw.promptTemplate || '').trim().slice(0, 4000),
      tools: (Array.isArray(raw.tools) ? raw.tools : []).map(String).map((v) => v.trim()).filter(Boolean).slice(0, 20),
      models: (Array.isArray(raw.models) ? raw.models : []).map(String).map((v) => v.trim()).filter(Boolean).slice(0, 12),
    };
  }).filter((item) => item.name && item.description && item.promptTemplate);
}

async function persistReflection(parsed: Record<string, unknown>): Promise<{ memories: number; skills: number }> {
  const existingMemoryNames = new Set((await loadMemoryIndex()).map((memory) => memory.name));
  let memoriesWritten = 0;
  for (const memory of normalizeMemories(parsed.memories)) {
    if (existingMemoryNames.has(memory.name)) continue;
    await createDir(MEMORY_DIR, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
    await writeHome(`${MEMORY_DIR}/${memory.name}.md`, `---\nname: ${memory.name}\ndescription: ${memory.description}\ntype: ${memory.memory_type}\n---\n\n${memory.body}\n`);
    existingMemoryNames.add(memory.name);
    memoriesWritten += 1;
  }
  if (memoriesWritten) invalidateMemoryIndex();
  let skillsWritten = 0;
  for (const skill of normalizeSkills(parsed.skills)) {
    if (await persistAutoSkillDraft(skill)) skillsWritten += 1;
  }
  return { memories: memoriesWritten, skills: skillsWritten };
}

function compactTrajectoryBatch(batch: TrajectoryRecord[]): string {
  return batch.map((item) => JSON.stringify({
    req: item.req,
    tools: item.tools,
    fail: item.fail,
    traces: item.traces,
    secs: item.secs,
    status: item.status,
    negative: item.negative,
  })).join('\n');
}

async function reflectBatch(batch: TrajectoryRecord[], focus: string): Promise<{ memories: number; skills: number } | null> {
  const answer = await quickChat([
    { role: 'system', content: `${REFLECT_SYSTEM}\n${focus}` },
    { role: 'user', content: `允许的工具：${[...catalogToolNames].join(', ') || '无'}\n允许的模型：${[...catalogModelNames].join(', ') || '无'}\n\n轨迹：\n${compactTrajectoryBatch(batch)}` },
  ], { maxTokens: 4000, continueOnTruncation: true });
  const parsed = extractJson(answer);
  return parsed ? persistReflection(parsed) : null;
}

const negativeReflectionThrottle = new SuccessfulRunThrottle();
const NEGATIVE_REFLECT_MIN_INTERVAL_MS = 10 * 60 * 1000;

export async function reflectNegativeTrajectory(record: TrajectoryRecord): Promise<void> {
  if (!record.negative && !detectNegativeFeedback(record.req, record.status)) return;
  // 同时只允许一个负反馈反思；只有成功写出结果后才进入冷却期。
  // 网络/解析失败会释放闸门，下一条真实反馈可以立即重试。
  const now = Date.now();
  if (!negativeReflectionThrottle.tryStart(now, NEGATIVE_REFLECT_MIN_INTERVAL_MS)) return;
  let succeeded = false;
  try {
    const result = await reflectionQueue.enqueue(async () => reflectBatch([record], NEGATIVE_REFLECT_SYSTEM));
    succeeded = Boolean(result);
  } catch (error) {
    agentLog.debug('Evolution', `negative reflection skipped: ${summarizeTrajectoryValue(error instanceof Error ? error.message : error)}`);
  } finally {
    negativeReflectionThrottle.finish(succeeded, Date.now());
  }
}

export async function runEvolutionReflect(force: boolean): Promise<string | null> {
  if (reflectionQueue.busy && !force) return null;
  return reflectionQueue.enqueue(async () => {
   try {
    const [trajectories, state] = await Promise.all([loadTrajectories(), loadState()]);
    const fresh = freshTrajectories(trajectories, state);
    if (!force && fresh.length < REFLECT_MIN_NEW) return null;
    const batch = (fresh.length ? fresh : trajectories).slice(-REFLECT_BATCH);
    if (!batch.length) return force ? '还没有可分析的执行轨迹。' : null;
    const written = await reflectBatch(batch, '从多条轨迹中提炼稳定模式。');
    if (!written) return force ? '自省结果无法解析，本次未写入。' : null;
    await saveState({
      ...state,
      offset: trajectories.length,
      reflections: state.reflections + 1,
      lastRunAt: Date.now(),
      ...cursorForTrajectories(trajectories),
    });
    const summary = `自省完成：分析 ${batch.length} 条轨迹，新增 ${written.memories} 条记忆、${written.skills} 个候选技能。`;
    agentLog.info('Evolution', summary);
    return force ? summary : null;
  } catch (error) {
    agentLog.warn('Evolution', `reflection failed: ${summarizeTrajectoryValue(error instanceof Error ? error.message : error)}`);
    if (force) throw error;
    return null;
   }
  });
}

function skillMatchesQuery(skill: AgentSkillManifest, query: string): boolean {
  const normalized = query.toLowerCase();
  const needles = [skill.name, skill.displayName, ...skill.triggers].filter(Boolean).map((value) => String(value).toLowerCase());
  return needles.some((needle) => needle.length >= 2 && normalized.includes(needle));
}

/** Count prompt-level references once per run; the second proven use promotes the skill. */
export async function recordAutoSkillReferences(skills: AgentSkillManifest[], query: string, runId: string): Promise<void> {
  if (!runId || !query.trim()) return;
  const matches = skills.filter((skill) => skill.skillPath.split('/').pop()?.startsWith('auto-') && skillMatchesQuery(skill, query));
  for (const skill of matches) {
    const dirName = skill.skillPath.split('/').pop() || '';
    const record = await readAutoSkillRecord(dirName);
    if (!record || record.metadata.referencedRunIds.includes(runId)) continue;
    record.metadata.references += 1;
    record.metadata.lastReferencedAt = Date.now();
    record.metadata.referencedRunIds = [...record.metadata.referencedRunIds.slice(-19), runId];
    await writeAutoMetadata(record);
    if (resolveAutoSkillLifecycle(record.metadata, Date.now()) === 'promote') await promoteAutoSkill(record);
  }
}

export async function consolidateAutoSkills(now = Date.now()): Promise<void> {
  let records = await listAutoSkills();
  for (const record of records) {
    const nextMarkdown = normalizeAutoSkillVisibility(
      replaceObsoleteModelNames(record.markdown, MODEL_REPLACEMENTS),
    );
    const nextPrompt = replaceObsoleteModelNames(record.metadata.promptTemplate, MODEL_REPLACEMENTS);
    const nextModels = record.metadata.models.map((model) => MODEL_REPLACEMENTS[model] ?? model);
    if (nextMarkdown !== record.markdown) await writeHome(`${SKILLS_DIR}/${record.dirName}/SKILL.md`, nextMarkdown);
    const manifestPath = `${SKILLS_DIR}/${record.dirName}/skill.json`;
    const manifestRaw = await readHome(manifestPath);
    const manifest = manifestRaw ? safeJson<Record<string, unknown>>(manifestRaw) : null;
    if (manifest?.visibility === 'internal') {
      await writeHome(manifestPath, JSON.stringify({ ...manifest, visibility: 'library' }, null, 2));
    }
    if (nextPrompt !== record.metadata.promptTemplate || nextModels.some((model, index) => model !== record.metadata.models[index])) {
      record.metadata.promptTemplate = nextPrompt;
      record.metadata.models = nextModels;
      await writeAutoMetadata(record);
    }
  }
  records = await listAutoSkills();
  const candidates: ConsolidationCandidate[] = records.map((record) => ({
    dirName: record.dirName,
    name: record.metadata.name,
    promptTemplate: record.metadata.promptTemplate,
    references: record.metadata.references,
    createdAt: record.metadata.createdAt,
  }));
  const plan = planSkillConsolidation(candidates);
  const byDir = new Map(records.map((record) => [record.dirName, record]));
  for (const { keep: keepDir, absorb: absorbDir } of plan.merge) {
    const keep = byDir.get(keepDir);
    const absorb = byDir.get(absorbDir);
    if (!keep || !absorb) continue;
    const keepWasPromoted = keep.metadata.promoted;
    const merged = mergeAutoSkillUsage(keep.metadata, absorb.metadata);
    Object.assign(keep.metadata, merged);
    if (!keepWasPromoted && merged.promoted) keep.metadata.promoted = false;
    await writeAutoMetadata(keep);
    if (merged.promoted || resolveAutoSkillLifecycle(keep.metadata, now) === 'promote') await promoteAutoSkill(keep);
    await archiveAutoSkill(absorb, 'duplicate-merged');
  }
  records = (await listAutoSkills()).sort((a, b) => b.metadata.references - a.metadata.references || b.metadata.createdAt - a.metadata.createdAt);
  for (const record of records) {
    if (resolveAutoSkillLifecycle(record.metadata, now) === 'archive') await archiveAutoSkill(record, 'unused-30-days');
  }
  // Keep the most-referenced, newest skills in the active catalog. Anything
  // beyond the cap is archived from the low-value tail.
  records = (await listAutoSkills()).sort((a, b) =>
    b.metadata.references - a.metadata.references
      || b.metadata.createdAt - a.metadata.createdAt);
  for (const record of records.slice(MAX_AUTO_SKILLS)) await archiveAutoSkill(record, 'catalog-limit');
}

export async function maybeEvolve(): Promise<void> {
  try {
    const [trajectories, initialState] = await Promise.all([loadTrajectories(), loadState()]);
    let state = initialState;
    if (Date.now() - (state.lastConsolidatedAt ?? 0) >= CONSOLIDATE_INTERVAL_MS) {
      await consolidateAutoSkills();
      state = { ...state, lastConsolidatedAt: Date.now() };
      await saveState(state);
    }
    if (freshTrajectories(trajectories, state).length < REFLECT_MIN_NEW) return;
    if (Date.now() - state.lastRunAt < REFLECT_MIN_INTERVAL_MS) return;
    await runEvolutionReflect(false);
  } catch (error) { agentLog.debug('Evolution', `background evolution skipped: ${summarizeTrajectoryValue(error instanceof Error ? error.message : error)}`); }
}
