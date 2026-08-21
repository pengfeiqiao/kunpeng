/**
 * speechAudit/prompt — LLM 信息增量判定。
 *
 * 核心问题不是"文字像不像"，是"删掉这段会不会丢信息 + 这是不是一次重来"。
 * 输入：全局干净文稿（上下文）+ 每窗（干净文本 vs 原始重转写 + 停顿/能量证据）。
 * 输出：严格 JSON，schema 校验失败自动重试。
 */
import { quickChat } from '@/lib/agent/quickChat';
import type { FindingCategory, SuspectWindow } from './types';

export interface WindowInput {
  window: SuspectWindow;
  /** 干净文稿里这段的文本（整段 ASR 结果） */
  cleanText: string;
  /** 短窗原始重转写文本（含词间停顿标注，如「我们团队[0.4s]我们团队已经」） */
  rawText: string;
}

export interface LlmWindowFinding {
  category: Exclude<FindingCategory, 'pause'>;
  /** 源媒体相对秒（LLM 基于我们提供的词时间参考给出） */
  sourceStart: number;
  sourceEnd: number;
  /** 被删内容原文 */
  text: string;
  /** repeat：保留的那一遍的文本 */
  keptText?: string;
  keptStart?: number;
  keptEnd?: number;
  confidence: number;
  reason: string;
}

const VALID_CATEGORIES = new Set(['filler', 'repeat', 'stutter', 'rambling']);

function buildSystemPrompt(): string {
  return `你是专业口播剪辑师的审片助手。任务：判断口播文稿中哪些片段应该剪掉。

判定标准（按信息增量，不是文字相似度）：
- repeat（重复）：同一信息点讲了两遍（含换说法的同义反复、说一半重来）。保留**讲得更顺的一遍**——停顿少、语速均匀、句子完整的那遍，通常是后录的；把另一遍标记删除。
- stutter（口误）：说错、结巴、卡壳后的自我纠正。删说错的部分，保留纠正后的。
- filler（语气词）：嗯/啊/呃/那个/就是 等不承载信息的填充。注意"就是/然后"承载信息时不算。
- rambling（废话）：没有信息增量的过渡表达、绕圈子。谨慎标记，宁缺勿滥。

证据解读：
- 「原始转写」是关闭语义规范化的 ASR 结果，保留了真实语流——如果原始转写里出现干净文稿中没有的重复/口误，那就是 ASR 清洗掉的重录，是最强证据。
- 停顿标注 [N.Ns] 表示词间停顿；重来前通常有 0.3-1s 换气口。
- 能量相似度 ≥0.62 表示两段声学上高度相似（同一句话录了两遍）。

输出要求：只输出 JSON 数组（可为空 []），不要任何其他文字。每项：
{"category":"repeat|stutter|filler|rambling","sourceStart":秒,"sourceEnd":秒,"text":"被删原文","keptText":"保留遍原文(仅repeat)","keptStart":秒,"keptEnd":秒,"confidence":0到1,"reason":"一句话依据"}

sourceStart/sourceEnd 必须落在给出的窗口范围内，用窗口里标注的词时间做参考。没有把握的不要输出——用户会人工复核，误报比漏报更伤信任。`;
}

function buildUserPrompt(globalTranscript: string, inputs: WindowInput[]): string {
  const parts: string[] = [];
  parts.push(`# 全片文稿（干净版，仅供理解上下文）\n${globalTranscript.slice(0, 12000)}\n`);
  parts.push(`# 待审窗口（共 ${inputs.length} 个）\n`);
  inputs.forEach((inp, i) => {
    const w = inp.window;
    parts.push(`## 窗口 ${i + 1}：源时间 ${w.sourceStart.toFixed(2)}s - ${w.sourceEnd.toFixed(2)}s`);
    parts.push(`触发信号：${w.reasons.join('；')}${w.energyScore != null ? `（能量相似度 ${w.energyScore.toFixed(2)}）` : ''}`);
    parts.push(`干净文稿：${inp.cleanText || '（无）'}`);
    parts.push(`原始转写（含词时间与停顿）：${inp.rawText || '（无）'}`);
    parts.push('');
  });
  parts.push('输出所有窗口的 findings 合并为一个 JSON 数组。');
  return parts.join('\n');
}

/** 宽松抽取 JSON 数组（LLM 偶尔包 markdown 围栏） */
function extractJsonArray(text: string): unknown[] | null {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  const candidate = (fenced ? fenced[1] : text).trim();
  const start = candidate.indexOf('[');
  const end = candidate.lastIndexOf(']');
  if (start < 0 || end <= start) return null;
  try {
    const parsed = JSON.parse(candidate.slice(start, end + 1));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** schema 校验 + 数值清洗；无效项丢弃 */
function validateFindings(raw: unknown[], inputs: WindowInput[]): LlmWindowFinding[] {
  const out: LlmWindowFinding[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const f = item as Record<string, unknown>;
    const category = String(f.category ?? '');
    if (!VALID_CATEGORIES.has(category)) continue;
    const sourceStart = Number(f.sourceStart);
    const sourceEnd = Number(f.sourceEnd);
    if (!Number.isFinite(sourceStart) || !Number.isFinite(sourceEnd) || sourceEnd - sourceStart < 0.05) continue;
    // 必须落在某个窗口内（±1s 容差）
    const inWindow = inputs.some((inp) =>
      sourceStart >= inp.window.sourceStart - 1 && sourceEnd <= inp.window.sourceEnd + 1);
    if (!inWindow) continue;
    const confidence = Math.max(0, Math.min(1, Number(f.confidence) || 0.5));
    out.push({
      category: category as LlmWindowFinding['category'],
      sourceStart,
      sourceEnd,
      text: String(f.text ?? '').slice(0, 200),
      ...(f.keptText ? { keptText: String(f.keptText).slice(0, 200) } : {}),
      ...(Number.isFinite(Number(f.keptStart)) ? { keptStart: Number(f.keptStart) } : {}),
      ...(Number.isFinite(Number(f.keptEnd)) ? { keptEnd: Number(f.keptEnd) } : {}),
      confidence,
      reason: String(f.reason ?? '').slice(0, 300),
    });
  }
  return out;
}

/**
 * 一批窗口 → LLM 判定（JSON 校验，解析失败自动重试 2 次）。
 * 走 quickChat directDeepseek（OpenAI 端点，长结构化输出不被 reasoning 挤占）。
 */
export async function judgeWindows(
  globalTranscript: string,
  inputs: WindowInput[],
): Promise<LlmWindowFinding[]> {
  if (inputs.length === 0) return [];
  const messages = [
    { role: 'system', content: buildSystemPrompt() },
    { role: 'user', content: buildUserPrompt(globalTranscript, inputs) },
  ];
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const text = await quickChat(messages, { directDeepseek: true, maxTokens: 4000 });
      const arr = extractJsonArray(text);
      if (arr) return validateFindings(arr, inputs);
      lastErr = new Error(`LLM 输出不是 JSON 数组: ${text.slice(0, 120)}`);
    } catch (err) {
      lastErr = err;
    }
  }
  console.warn('[speechAudit] LLM 判定失败（3 次）:', lastErr);
  return [];
}
