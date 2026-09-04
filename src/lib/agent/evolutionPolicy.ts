export interface TrajectoryToolTraceInput {
  toolName: string;
  params?: unknown;
  status: 'running' | 'completed' | 'error';
  result?: { output?: unknown; error?: unknown };
}

export interface TrajectoryToolTrace {
  name: string;
  status: 'running' | 'completed' | 'error';
  params: string;
  error?: string;
}

export interface AutoSkillDraft {
  name: string;
  displayName: string;
  description: string;
  triggers: string[];
  promptTemplate: string;
  tools?: string[];
  models?: string[];
}

export interface ExistingSkillSummary {
  name: string;
  promptTemplate?: string;
}

export interface SkillQualityContext {
  toolNames: Iterable<string>;
  modelNames: Iterable<string>;
  existingSkills: ExistingSkillSummary[];
}

export interface SkillQualityResult {
  ok: boolean;
  reasons: string[];
  markdown?: string;
}

export interface AutoSkillLifecycleInput {
  references: number;
  createdAt: number;
  lastReferencedAt?: number;
}

export type AutoSkillLifecycleAction = 'keep' | 'promote' | 'archive';

export interface ConsolidationCandidate {
  dirName: string;
  name: string;
  promptTemplate: string;
  references: number;
  createdAt: number;
}

export interface ConsolidationPlan {
  archive: string[];
  merge: Array<{ keep: string; absorb: string }>;
}

export interface AutoSkillUsageMetadata {
  references: number;
  lastReferencedAt?: number;
  referencedRunIds: string[];
  triggers: string[];
  tools: string[];
  models: string[];
  promoted: boolean;
}

/** Merge duplicate skill evidence before archiving the absorbed candidate. */
export function mergeAutoSkillUsage(
  keep: AutoSkillUsageMetadata,
  absorb: AutoSkillUsageMetadata,
): AutoSkillUsageMetadata {
  return {
    references: keep.references + absorb.references,
    lastReferencedAt: Math.max(keep.lastReferencedAt ?? 0, absorb.lastReferencedAt ?? 0) || undefined,
    referencedRunIds: [...new Set([...keep.referencedRunIds, ...absorb.referencedRunIds])].slice(-20),
    triggers: [...new Set([...keep.triggers, ...absorb.triggers])],
    tools: [...new Set([...keep.tools, ...absorb.tools])],
    models: [...new Set([...keep.models, ...absorb.models])],
    promoted: keep.promoted || absorb.promoted,
  };
}

/** Small serial queue used for background reflections that must not be lost. */
export class SerialTaskQueue {
  private tail: Promise<void> = Promise.resolve();
  private pendingCount = 0;

  get busy(): boolean {
    return this.pendingCount > 0;
  }

  enqueue<T>(task: () => Promise<T>): Promise<T> {
    this.pendingCount += 1;
    const result = this.tail.then(task);
    this.tail = result.then(
      () => { this.pendingCount -= 1; },
      () => { this.pendingCount -= 1; },
    );
    return result;
  }
}

/** Throttle concurrent work, but start the cooldown only after success. */
export class SuccessfulRunThrottle {
  private inFlight = false;
  private lastSuccessAt = Number.NEGATIVE_INFINITY;

  tryStart(now: number, intervalMs: number): boolean {
    if (this.inFlight || now - this.lastSuccessAt < intervalMs) return false;
    this.inFlight = true;
    return true;
  }

  finish(success: boolean, now: number): void {
    if (!this.inFlight) return;
    if (success) this.lastSuccessAt = now;
    this.inFlight = false;
  }
}

const SENSITIVE_KEY = /(api[-_]?key|token|secret|password|authorization|credential|cookie|session|密钥|密码|令牌)/i;
// Strong credential signatures are safe to redact globally. Opaque hex/base64
// strings are only secrets when a nearby label says so; otherwise they may be
// hashes, asset ids, paths, or data-URL payloads needed for diagnostics.
const SECRET_VALUE = /(?:bearer\s+|sk-|key-)[A-Za-z0-9._-]{8,}|eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/gi;
const SECRET_QUERY = /([?&](?:api[-_]?key|key|token|access[-_]?token|secret|signature)=)[^&\s"'<>]+/gi;
const LABELED_OPAQUE_SECRET = /((?:api[-_ ]?key|key|token|secret|password|credential|密钥|密码|令牌)\s*(?:(?:is|为)\s*|[:=]\s*)?)([A-Fa-f0-9]{32,}|[A-Za-z0-9+/_-]{40,}={0,2})/gi;
// 「改一下」「错误」是高频中性词（"改一下颜色"是正常编辑请求），不能算否定反馈。
const NEGATIVE_FEEDBACK = /(不对|错了|弄错|不是这样|不应该|别这样|重来|重新生成|重新做|没按|没有按|还是不行|不满意|有问题|修正)/i;

function truncate(value: string, limit = 200): string {
  return value.length <= limit ? value : `${value.slice(0, limit - 1)}…`;
}

function redactString(value: string): string {
  return value
    .replace(SECRET_QUERY, '$1[REDACTED]')
    .replace(LABELED_OPAQUE_SECRET, '$1[REDACTED]')
    .replace(SECRET_VALUE, '[REDACTED]');
}

/** Upgrade only the YAML front matter of legacy auto skills. */
export function normalizeAutoSkillVisibility(markdown: string): string {
  return markdown.replace(/^---\r?\n[\s\S]*?\r?\n---/, (frontMatter) => (
    frontMatter.replace(/^visibility:\s*internal\s*$/m, 'visibility: library')
  ));
}

function sanitizeValue(value: unknown, seen = new WeakSet<object>()): unknown {
  if (typeof value === 'string') return redactString(value);
  if (value === null || typeof value !== 'object') return value;
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => sanitizeValue(item, seen));
  const result: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>).slice(0, 24)) {
    result[key] = SENSITIVE_KEY.test(key) ? '[REDACTED]' : sanitizeValue(child, seen);
  }
  return result;
}

/** Stable compact text for journals. Never returns raw credential fields. */
export function summarizeTrajectoryValue(value: unknown, limit = 200): string {
  try {
    const sanitized = sanitizeValue(value);
    const text = typeof sanitized === 'string' ? sanitized : JSON.stringify(sanitized);
    return truncate(redactString(text || ''), limit);
  } catch {
    return '[unserializable]';
  }
}

export function summarizeToolTrace(input: TrajectoryToolTraceInput): TrajectoryToolTrace {
  const errorValue = input.result?.error
    ?? (input.status === 'error' ? input.result?.output : undefined);
  const error = errorValue === undefined ? '' : summarizeTrajectoryValue(errorValue);
  return {
    name: input.toolName,
    status: input.status,
    params: summarizeTrajectoryValue(input.params ?? {}),
    ...(error ? { error } : {}),
  };
}

export function detectNegativeFeedback(text: string, status?: 'done' | 'failed' | 'aborted'): boolean {
  return status === 'aborted' || NEGATIVE_FEEDBACK.test(text);
}

function cleanScalar(value: string, limit: number): string {
  return truncate(value.replace(/[\r\n]+/g, ' ').replace(/\s+/g, ' ').trim(), limit);
}

function yamlQuoted(value: string): string {
  return JSON.stringify(value);
}

// 指令性注入模式：auto 技能内容源自轨迹与反思 LLM 的转述，进入 system
// prompt 前必须挡住这类模式（即使可见性降级后只做纵深防御）。
const INJECTION_PATTERN = /(忽略之前|忽略以上|忽略所有|ignore\s+(?:all\s+)?previous|override\s+system|越狱|jailbreak|系统提示词.{0,6}(泄露|输出|打印))/i;

export function buildAutoSkillMarkdown(draft: AutoSkillDraft): string {
  const name = cleanScalar(draft.name, 64).toLowerCase();
  const triggers = draft.triggers.map((item) => cleanScalar(item, 48)).filter(Boolean);
  return [
    '---',
    `name: ${yamlQuoted(`auto-${name}`)}`,
    `displayName: ${yamlQuoted(cleanScalar(draft.displayName || name, 60))}`,
    `description: ${yamlQuoted(`[自进化] ${cleanScalar(draft.description, 240)}`)}`,
    `triggers: ${yamlQuoted([`auto-${name}`, ...triggers].join(', '))}`,
    'category: auto',
    // 未晋升的 auto 技能用 library 可见性：只进目录一行、按需读取，
    // 不像 internal 那样把反思产物的全文自动注入每轮 system prompt。
    'visibility: library',
    '---',
    '',
    draft.promptTemplate.trim(),
    '',
  ].join('\n');
}

function ngrams(value: string): Set<string> {
  const normalized = value.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
  const result = new Set<string>();
  for (let i = 0; i < normalized.length - 1; i += 1) result.add(normalized.slice(i, i + 2));
  if (result.size === 0 && normalized) result.add(normalized);
  return result;
}

export function textSimilarity(a: string, b: string): number {
  const left = ngrams(a);
  const right = ngrams(b);
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const token of left) if (right.has(token)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

export function validateAutoSkillDraft(
  draft: AutoSkillDraft,
  context: SkillQualityContext,
): SkillQualityResult {
  const reasons: string[] = [];
  const name = cleanScalar(draft.name, 64).toLowerCase();
  const toolNames = new Set(context.toolNames);
  const modelNames = new Set(context.modelNames);
  if (!/^[a-z0-9][a-z0-9-]{1,62}$/.test(name)) reasons.push('name 必须是 2-63 位 kebab-case');
  if (!cleanScalar(draft.description, 240)) reasons.push('缺少 description');
  if (draft.promptTemplate.trim().length < 40) reasons.push('promptTemplate 过短，无法形成可复用步骤');
  if (INJECTION_PATTERN.test(draft.promptTemplate) || INJECTION_PATTERN.test(draft.description)) {
    reasons.push('内容含指令性注入模式');
  }
  for (const tool of draft.tools ?? []) {
    if (!toolNames.has(tool)) reasons.push(`引用了不存在的工具：${tool}`);
  }
  for (const model of draft.models ?? []) {
    if (!modelNames.has(model)) reasons.push(`引用了不存在的模型：${model}`);
  }
  for (const existing of context.existingSkills) {
    const sameName = existing.name === name || existing.name === `auto-${name}`;
    const similar = existing.promptTemplate
      ? textSimilarity(existing.promptTemplate, draft.promptTemplate) >= 0.82
      : false;
    if (sameName || similar) {
      reasons.push(`与既有技能重复：${existing.name}`);
      break;
    }
  }
  const markdown = reasons.length === 0 ? buildAutoSkillMarkdown({ ...draft, name }) : undefined;
  if (markdown && !/^---\n[\s\S]+\n---\n\n\S/.test(markdown)) reasons.push('front matter 结构无效');
  return { ok: reasons.length === 0, reasons, ...(reasons.length === 0 ? { markdown } : {}) };
}

export function resolveAutoSkillLifecycle(
  input: AutoSkillLifecycleInput,
  now: number,
  archiveAfterMs = 30 * 24 * 60 * 60 * 1000,
): AutoSkillLifecycleAction {
  if (input.references >= 2) return 'promote';
  // 「30 天零引用」的语义是最近 30 天无人用——引用过 1 次后闲置一年同样该归档。
  const lastUse = input.lastReferencedAt ?? input.createdAt;
  if (now - lastUse >= archiveAfterMs) return 'archive';
  return 'keep';
}

/** Pairwise duplicate plan. Running it again on the same active set is stable. */
export function planSkillConsolidation(candidates: ConsolidationCandidate[]): ConsolidationPlan {
  const sorted = [...candidates].sort((a, b) =>
    b.references - a.references || a.createdAt - b.createdAt || a.dirName.localeCompare(b.dirName));
  const absorbed = new Set<string>();
  const merge: Array<{ keep: string; absorb: string }> = [];
  for (let i = 0; i < sorted.length; i += 1) {
    const keep = sorted[i];
    if (absorbed.has(keep.dirName)) continue;
    for (let j = i + 1; j < sorted.length; j += 1) {
      const candidate = sorted[j];
      if (absorbed.has(candidate.dirName)) continue;
      const sameName = keep.name === candidate.name;
      const similar = textSimilarity(keep.promptTemplate, candidate.promptTemplate) >= 0.82;
      if (!sameName && !similar) continue;
      absorbed.add(candidate.dirName);
      merge.push({ keep: keep.dirName, absorb: candidate.dirName });
    }
  }
  return { archive: [...absorbed].sort(), merge };
}

export function replaceObsoleteModelNames(text: string, replacements: Record<string, string>): string {
  let next = text;
  for (const [from, to] of Object.entries(replacements)) {
    if (!from || from === to) continue;
    next = next.split(from).join(to);
  }
  return next;
}
