/**
 * evolution — Hermes 式自进化闭环（不训练模型，纯 harness 层）：
 *
 *   执行轨迹（情景记忆）→ 周期自省（Nudge）→ 记忆/技能产出 → 后续召回增强
 *
 * 三层产出对应 Hermes 的三层记忆：
 * - 语义/用户记忆：feedback/project/user 记忆写入 ~/.kunpeng/memory/，
 *   由 findRelevantMemories 在后续 run 自动召回（memory_write 同款格式）。
 * - 程序性记忆（技能）：反复成功的多工具流程被提炼为 ~/.kunpeng/skills/auto-*
 *   草稿技能，skillLoader 下次启动加载；前缀 auto- + [自进化] 标记可辨识。
 * - 情景记忆：trajectories.jsonl 本身就是最近执行的压缩台账。
 *
 * 成本控制：每攒 REFLECT_MIN_NEW 条轨迹、且距上次 ≥30 分钟才自省一次；
 * 单次自省 = 一次 quickChat 非流式调用（走 settings 的 fallback 链）。
 * 所有后台路径失败静默；只有 /evolve 手动触发才向用户报错。
 */

import {
  readTextFile,
  writeTextFile,
  createDir,
  readDir,
  removeDir,
  BaseDirectory,
} from '@tauri-apps/api/fs';
import { quickChat } from './quickChat';
import { invalidateMemoryIndex, loadMemoryIndex } from './findRelevantMemories';
import { agentLog } from './logger';
import { cursorForTrajectories, freshTrajectories } from './evolutionCursor';

const EVOLUTION_DIR = '.kunpeng/evolution';
const TRAJ_FILE = `${EVOLUTION_DIR}/trajectories.jsonl`;
const STATE_FILE = `${EVOLUTION_DIR}/state.json`;
const SKILLS_DIR = '.kunpeng/skills';
const MEMORY_DIR = '.kunpeng/memory';

const TRAJECTORY_MAX = 800;
const TRAJECTORY_KEEP = 600;
const REFLECT_MIN_NEW = 12;
const REFLECT_BATCH = 40;
const REFLECT_MIN_INTERVAL_MS = 30 * 60 * 1000;
const MAX_AUTO_SKILLS = 8;
let trajectoryWriteQueue: Promise<void> = Promise.resolve();

export interface TrajectoryRecord {
  ts: number;
  /** 用户请求（截断） */
  req: string;
  /** 工具调用次数 by name */
  tools: Record<string, number>;
  /** 工具失败次数 by name */
  fail: Record<string, number>;
  secs: number;
  status: 'done' | 'failed' | 'aborted';
}

interface EvolutionState {
  /** 已处理到的轨迹行号 */
  offset: number;
  reflections: number;
  lastRunAt: number;
  /** Stable cursor added in 2.8.x; offset remains for old state compatibility. */
  cursorTs?: number;
  cursorCountAtTs?: number;
}

const DEFAULT_STATE: EvolutionState = { offset: 0, reflections: 0, lastRunAt: 0 };

function slugify(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// ── 轨迹记录 ──────────────────────────────────────────────────────────────

/** 追加一条执行轨迹（读改写，文件很小；超长时裁掉最旧的）。失败静默。 */
export async function recordTrajectory(rec: TrajectoryRecord): Promise<void> {
  const write = trajectoryWriteQueue.then(async () => {
    try {
      await createDir(EVOLUTION_DIR, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
      let existing = '';
      try {
        existing = await readTextFile(TRAJ_FILE, { dir: BaseDirectory.Home });
      } catch { /* first run */ }
      const lines = existing ? existing.split('\n').filter(Boolean) : [];
      lines.push(JSON.stringify(rec));
      const trimmed = lines.length > TRAJECTORY_MAX ? lines.slice(-TRAJECTORY_KEEP) : lines;
      await writeTextFile(TRAJ_FILE, trimmed.join('\n') + '\n', { dir: BaseDirectory.Home });
    } catch (err) {
      agentLog.debug('Evolution', 'recordTrajectory skipped', err);
    }
  });
  trajectoryWriteQueue = write.catch(() => {});
  await write;
}

async function loadTrajectories(): Promise<TrajectoryRecord[]> {
  try {
    const raw = await readTextFile(TRAJ_FILE, { dir: BaseDirectory.Home });
    return raw
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try { return JSON.parse(line) as TrajectoryRecord; } catch { return null; }
      })
      .filter((r): r is TrajectoryRecord => r !== null);
  } catch {
    return [];
  }
}

async function loadState(): Promise<EvolutionState> {
  try {
    const raw = await readTextFile(STATE_FILE, { dir: BaseDirectory.Home });
    const parsed = JSON.parse(raw) as Partial<EvolutionState>;
    return { ...DEFAULT_STATE, ...parsed };
  } catch {
    return { ...DEFAULT_STATE };
  }
}

async function saveState(state: EvolutionState): Promise<void> {
  await createDir(EVOLUTION_DIR, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
  await writeTextFile(STATE_FILE, JSON.stringify(state, null, 2), { dir: BaseDirectory.Home });
}

// ── 自省引擎 ──────────────────────────────────────────────────────────────

let reflectRunning = false;

interface ReflectedMemory {
  name: string;
  description: string;
  memory_type: string;
  body: string;
}

interface ReflectedSkill {
  name: string;
  displayName: string;
  description: string;
  triggers: string[];
  promptTemplate: string;
}

const REFLECT_SYSTEM = `你是鲲鹏 agent 的自进化自省引擎。输入是该 agent 最近的执行轨迹（JSONL，每行：req=用户请求, tools=各工具调用次数, fail=各工具失败次数, secs=耗时秒, status=done/failed/aborted）。
任务：从轨迹中提炼可复用经验，让 agent 以后做得更好。只输出严格 JSON（不要 markdown 围栏、不要任何其他文字）：
{"memories":[{"name":"kebab-case","description":"一句话（召回匹配用，写具体）","memory_type":"feedback|project|user","body":"完整自足的经验正文，写明以后应该怎么做"}],"skills":[{"name":"kebab-case","displayName":"中文名","description":"一句话","triggers":["关键词"],"promptTemplate":"可照做的操作步骤指南"}]}
规则：
- 只提炼反复出现（≥2 次）或造成明确失败的 pattern；单次偶发不要提炼
- fail 集中的工具/参数组合 → feedback 记忆：以后如何避免、正确的替代做法
- status=aborted 集中的模式 → feedback：用户可能对什么不满
- 反复成功的多工具组合流程 → skill：写出编号步骤、关键参数、注意事项
- 没有值得提炼的内容就返回 {"memories":[],"skills":[]}
- memories 最多 3 条、skills 最多 1 个；不得与「已有记忆/技能」列表重名
- body 和 promptTemplate 要完整自足，禁止"如上所述"式指代`;

function extractJson(text: string): { memories?: unknown; skills?: unknown } | null {
  let cleaned = text.trim();
  const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) cleaned = fence[1].trim();
  const start = cleaned.indexOf('{');
  const end = cleaned.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(cleaned.slice(start, end + 1));
  } catch {
    return null;
  }
}

async function listAutoSkillDirs(): Promise<string[]> {
  try {
    const entries = await readDir(SKILLS_DIR, { dir: BaseDirectory.Home });
    return entries.map((e) => e.name).filter((n): n is string => Boolean(n));
  } catch {
    return [];
  }
}

/**
 * 跑一次自省。返回给用户可读的总结；force=false 且样本不足时返回 null。
 * 抛错仅发生在 quickChat 全面失败（由 /evolve 呈现）；写盘错误静默跳过单项。
 */
export async function runEvolutionReflect(force: boolean): Promise<string | null> {
  if (reflectRunning) return force ? '上一次自省还在进行中，稍后再试。' : null;
  reflectRunning = true;
  try {
    const [trajectories, state] = await Promise.all([loadTrajectories(), loadState()]);
    const fresh = freshTrajectories(trajectories, state);
    if (!force && fresh.length < REFLECT_MIN_NEW) return null;
    if (force && fresh.length === 0 && trajectories.length === 0) {
      return '还没有可分析的执行轨迹，先用 agent 做几件事再来。';
    }
    const batchSource = fresh.length > 0 ? fresh : trajectories;
    const batch = batchSource.slice(-REFLECT_BATCH);
    if (batch.length === 0) return null;

    const [memoryIndex, skillDirs] = await Promise.all([loadMemoryIndex(), listAutoSkillDirs()]);
    const existingNames = [
      ...memoryIndex.map((m) => m.name),
      ...skillDirs,
    ].join(', ');

    const trajectoryText = batch
      .map((t) => JSON.stringify({ req: t.req, tools: t.tools, fail: t.fail, secs: t.secs, status: t.status }))
      .join('\n');
    const answer = await quickChat(
      [
        { role: 'system', content: REFLECT_SYSTEM },
        {
          role: 'user',
          content: `已有记忆/技能名（禁止重复）：${existingNames || '（空）'}\n\n最近 ${batch.length} 条执行轨迹：\n${trajectoryText}`,
        },
      ],
      { maxTokens: 4000, continueOnTruncation: true },
    );

    const parsed = extractJson(answer);
    if (!parsed) {
      agentLog.warn('Evolution', 'reflection returned unparseable output');
      if (force) return '自省结果无法解析（模型没按 JSON 返回），本次未写入任何内容。';
      return null;
    }

    // ── 校验 + 落盘记忆 ──
    const existingMemoryNames = new Set(memoryIndex.map((m) => m.name));
    const memories = (Array.isArray(parsed.memories) ? parsed.memories : [])
      .slice(0, 3)
      .map((m): ReflectedMemory | null => {
        const r = m as Partial<ReflectedMemory>;
        const name = slugify(String(r.name || ''));
        const description = String(r.description || '').replace(/\s+/g, ' ').trim();
        const body = String(r.body || '').trim().slice(0, 2000);
        const type = ['user', 'project', 'feedback', 'reference'].includes(String(r.memory_type))
          ? String(r.memory_type)
          : 'project';
        if (!name || !description || !body || existingMemoryNames.has(name)) return null;
        return { name, description, memory_type: type, body };
      })
      .filter((m): m is ReflectedMemory => m !== null);

    let memoriesWritten = 0;
    for (const m of memories) {
      try {
        const content = `---\nname: ${m.name}\ndescription: ${m.description}\ntype: ${m.memory_type}\n---\n\n${m.body}\n`;
        await createDir(MEMORY_DIR, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
        await writeTextFile(`${MEMORY_DIR}/${m.name}.md`, content, { dir: BaseDirectory.Home });
        existingMemoryNames.add(m.name);
        memoriesWritten += 1;
      } catch (err) {
        agentLog.debug('Evolution', `memory write skipped: ${m.name}`, err);
      }
    }
    if (memoriesWritten > 0) invalidateMemoryIndex();

    // ── 校验 + 落盘技能 ──
    const existingSkillDirs = new Set(skillDirs);
    const skills = (Array.isArray(parsed.skills) ? parsed.skills : [])
      .slice(0, 1)
      .map((s): ReflectedSkill | null => {
        const r = s as Partial<ReflectedSkill>;
        const name = slugify(String(r.name || ''));
        const displayName = String(r.displayName || name).trim().slice(0, 30);
        const description = String(r.description || '').replace(/\s+/g, ' ').trim().slice(0, 200);
        const promptTemplate = String(r.promptTemplate || '').trim().slice(0, 4000);
        const triggers = (Array.isArray(r.triggers) ? r.triggers : [])
          .map((t) => String(t).trim()).filter(Boolean).slice(0, 6);
        if (!name || !description || !promptTemplate) return null;
        if (existingSkillDirs.has(`auto-${name}`) || existingSkillDirs.has(name)) return null;
        return { name, displayName, description, triggers, promptTemplate };
      })
      .filter((s): s is ReflectedSkill => s !== null);

    let skillsWritten = 0;
    for (const s of skills) {
      try {
        const dirName = `auto-${Date.now()}-${s.name}`;
        const skillMd = `---\nname: auto-${s.name}\ndisplayName: ${s.displayName}\ndescription: [自进化] ${s.description}\ntriggers: ${['auto-' + s.name, ...s.triggers].join(', ')}\ncategory: auto\n---\n\n${s.promptTemplate}\n`;
        await createDir(`${SKILLS_DIR}/${dirName}`, { dir: BaseDirectory.Home, recursive: true });
        await writeTextFile(`${SKILLS_DIR}/${dirName}/SKILL.md`, skillMd, { dir: BaseDirectory.Home });
        existingSkillDirs.add(dirName);
        skillsWritten += 1;
      } catch (err) {
        agentLog.debug('Evolution', `skill write skipped: ${s.name}`, err);
      }
    }

    // ── 修剪：auto 技能总量封顶，最旧的归档删除 ──
    const autoDirs = (await listAutoSkillDirs()).filter((d) => d.startsWith('auto-')).sort();
    for (const doomed of autoDirs.slice(0, Math.max(0, autoDirs.length - MAX_AUTO_SKILLS))) {
      await removeDir(`${SKILLS_DIR}/${doomed}`, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
    }

    await saveState({
      offset: trajectories.length,
      reflections: state.reflections + 1,
      lastRunAt: Date.now(),
      ...cursorForTrajectories(trajectories),
    });

    const summary = `自省完成（第 ${state.reflections + 1} 次）：分析了 ${batch.length} 条轨迹，提炼 ${memoriesWritten} 条记忆、${skillsWritten} 个技能草稿${skillsWritten > 0 ? '（auto- 前缀，重启后生效）' : ''}。`;
    agentLog.info('Evolution', summary);
    return force ? summary : null;
  } catch (err) {
    agentLog.warn('Evolution', 'reflection failed', err);
    if (force) throw err;
    return null;
  } finally {
    reflectRunning = false;
  }
}

/** 后台触发：样本量够 + 间隔够才跑，任何失败静默。 */
export async function maybeEvolve(): Promise<void> {
  try {
    const [trajectories, state] = await Promise.all([loadTrajectories(), loadState()]);
    if (freshTrajectories(trajectories, state).length < REFLECT_MIN_NEW) return;
    if (Date.now() - state.lastRunAt < REFLECT_MIN_INTERVAL_MS) return;
    await runEvolutionReflect(false);
  } catch { /* background evolution is best-effort */ }
}
