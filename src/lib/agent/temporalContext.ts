export const AGENT_TIME_ZONE = 'Asia/Shanghai';

export interface AgentTemporalContext {
  isoDate: string;
  displayDate: string;
  localTime: string;
  weekday: string;
  year: number;
  month: number;
  day: number;
  timeZone: string;
}

export interface SearchTemporalPreparation {
  query: string;
  prompt: string;
  isTimeSensitive: boolean;
  correctedFrom?: string;
  context: AgentTemporalContext;
}

function partsMap(
  date: Date,
  timeZone: string,
  options: Intl.DateTimeFormatOptions,
): Record<string, string> {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone, ...options }).formatToParts(date);
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function getAgentTemporalContext(
  now = new Date(),
  timeZone = AGENT_TIME_ZONE,
): AgentTemporalContext {
  const dateParts = partsMap(now, timeZone, {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
  });
  const timeParts = partsMap(now, timeZone, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const year = Number(dateParts.year);
  const month = Number(dateParts.month);
  const day = Number(dateParts.day);
  const isoDate = `${dateParts.year}-${dateParts.month}-${dateParts.day}`;

  return {
    isoDate,
    displayDate: `${dateParts.year}年${dateParts.month}月${dateParts.day}日`,
    localTime: `${timeParts.hour}:${timeParts.minute}`,
    weekday: dateParts.weekday,
    year,
    month,
    day,
    timeZone,
  };
}

const FRESHNESS_RE = /今天|今日|本日|现在|当前|目前|最新|近期|刚刚|本周|本月|今年|\btoday\b|\bnow\b|\bcurrent\b|\blatest\b|\brecent\b|\bthis (?:week|month|year)\b/i;
const STRICT_TODAY_RE = /今天|今日|本日|当前日期|现在几号|\btoday\b|\bright now\b/i;
const HISTORICAL_RE = /回顾|对比|比较|相比|历史|当时|过去|去年|前年|截至|往年|\bhistorical\b|\bhistory\b|\bcompare\b|\bversus\b|\bvs\.?\b|\bas of\b/i;
const LIVE_CLOCK_RE = /现在几点|当前时间|本地时间|几点了|现在的时间|\bwhat time is it\b|\bcurrent time\b|\blocal time\b/i;
const CHINESE_DATE_RE = /(?:19|20)\d{2}年\d{1,2}月\d{1,2}日/g;
const ISO_DATE_RE = /(?:19|20)\d{2}[-/.]\d{1,2}[-/.]\d{1,2}/g;
const YEAR_RE = /(?:19|20)\d{2}年?/g;

function hasExplicitDate(query: string): boolean {
  return CHINESE_DATE_RE.test(query) || ISO_DATE_RE.test(query);
}

function resetDateRegexes(): void {
  CHINESE_DATE_RE.lastIndex = 0;
  ISO_DATE_RE.lastIndex = 0;
}

/** Only exact clock questions need a same-day system-prompt refresh. */
export function needsLiveClockRefresh(rawQuery: string): boolean {
  return LIVE_CLOCK_RE.test(rawQuery);
}

export function isTimeSensitiveQuery(rawQuery: string): boolean {
  return FRESHNESS_RE.test(rawQuery) || LIVE_CLOCK_RE.test(rawQuery);
}

export function buildTemporalTurnContext(
  now = new Date(),
  timeZone = AGENT_TIME_ZONE,
): string {
  const context = getAgentTemporalContext(now, timeZone);
  return `[本轮可信时间锚点]
当前日期：${context.displayDate}（${context.isoDate}，${context.weekday}）
当前本地时间：${context.localTime}
时区：${context.timeZone}
仅在处理本轮“今天、现在、最新、近期、今年”等相对时间时使用。不得用训练数据截止时间、模型记忆、工作区路径或文件名替代。`;
}

/**
 * Give search engines an explicit clock and repair the narrow contradiction
 * where a query says "today" but contains an invented stale date. Historical
 * comparisons are deliberately left untouched.
 */
export function prepareTemporalSearchQuery(
  rawQuery: string,
  now = new Date(),
  timeZone = AGENT_TIME_ZONE,
): SearchTemporalPreparation {
  const context = getAgentTemporalContext(now, timeZone);
  const original = rawQuery.trim();
  const isTimeSensitive = isTimeSensitiveQuery(original);
  const strictToday = STRICT_TODAY_RE.test(original);
  const historical = HISTORICAL_RE.test(original);
  let query = original;

  resetDateRegexes();
  const explicitDate = hasExplicitDate(original);
  resetDateRegexes();

  if (strictToday && !historical) {
    query = query
      .replace(CHINESE_DATE_RE, context.displayDate)
      .replace(ISO_DATE_RE, context.isoDate);

    if (!explicitDate) {
      query = query.replace(YEAR_RE, String(context.year));
    }
  }

  resetDateRegexes();
  const correctedFrom = query !== original ? original : undefined;
  const searchQuery = isTimeSensitive && !hasExplicitDate(query)
    ? `${query}（截至 ${context.isoDate}）`
    : query;
  resetDateRegexes();

  const prompt = isTimeSensitive
    ? `当前日期是 ${context.displayDate} ${context.weekday}，时区 ${context.timeZone}。` +
      '请严格按这个日期理解“今天、现在、最新、目前、近期”等相对时间；不要使用训练数据截止时间推测当前日期。' +
      `\n搜索问题：${searchQuery}`
    : searchQuery;

  return {
    query: searchQuery,
    prompt,
    isTimeSensitive,
    correctedFrom,
    context,
  };
}
