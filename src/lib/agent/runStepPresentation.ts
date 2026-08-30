export type RunEngineKind = 'harness' | 'builtin';
export type RunProgressKind = 'context' | 'guidance' | 'error';
export type RunProgressStatus = 'running' | 'done' | 'failed' | 'info';
export type ToolDetailStyle = 'code' | 'text';
export type ToolIconKind = 'terminal' | 'read' | 'write' | 'search' | 'browser' | 'generate' | 'timeline' | 'default';

export interface NormalizedProgressUpdate {
  kind: RunProgressKind;
  status: RunProgressStatus;
  text: string;
}

export interface ToolActionPresentation {
  runningLabel: string;
  doneLabel: string;
  failedLabel: string;
  detail?: string;
  detailStyle: ToolDetailStyle;
  icon: ToolIconKind;
}

export type RawRunPresentationEvent =
  | {
      engine: RunEngineKind;
      type: 'progress';
      text: string;
    }
  | {
      engine: RunEngineKind;
      type: 'tool-start';
      name: string;
      params: Record<string, unknown>;
    };

export type NormalizedRunPresentationEvent =
  | { kind: 'progress'; value: NormalizedProgressUpdate }
  | { kind: 'tool'; value: ToolActionPresentation };

interface ProgressLike {
  id: string;
  text: string;
  createdAt: number;
  kind?: RunProgressKind;
  status?: RunProgressStatus;
}

interface StepLike {
  id: string;
  source: string;
  status: string;
  startedAt?: number;
  endedAt?: number;
}

export type TimelinePresentationItem<P extends ProgressLike, S extends StepLike> =
  | { id: string; at: number; kind: 'progress'; value: P & NormalizedProgressUpdate; defaultExpanded: false }
  | { id: string; at: number; kind: 'step'; value: S; defaultExpanded: boolean };

function flattenText(value: unknown): string {
  return String(value ?? '')
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

function compactText(value: unknown, max = 180): string {
  const text = flattenText(value);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(1, max - 1)).trimEnd()}…`;
}

function basename(value: unknown): string {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const index = Math.max(text.lastIndexOf('/'), text.lastIndexOf('\\'));
  return index >= 0 ? text.slice(index + 1) : text;
}

function redactSensitive(value: unknown): string {
  return String(value ?? '')
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[A-Za-z0-9_-]{8,}\b/g, 'sk-[已隐藏]')
    .replace(/\b((?:api[_-]?key|token|secret|authorization)\s*[=:]\s*)([^\s'";]+)/gi, '$1[已隐藏]');
}

function objectEntriesAtDepth(value: unknown, depth = 0): Array<[string, unknown]> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || depth > 2) return [];
  const entries = Object.entries(value as Record<string, unknown>);
  return [
    ...entries,
    ...entries.flatMap(([, nested]) => objectEntriesAtDepth(nested, depth + 1)),
  ];
}

function findParam(params: Record<string, unknown>, keys: string[]): unknown {
  const wanted = new Set(keys.map((key) => key.toLowerCase().replace(/[_-]/g, '')));
  const match = objectEntriesAtDepth(params).find(([key]) => wanted.has(key.toLowerCase().replace(/[_-]/g, '')));
  return match?.[1];
}

function stringParam(params: Record<string, unknown>, keys: string[]): string {
  const value = findParam(params, keys);
  if (value === undefined || value === null) return '';
  if (typeof value === 'object') return '';
  return redactSensitive(value).trim();
}

function numberParam(params: Record<string, unknown>, keys: string[]): string {
  const value = findParam(params, keys);
  return typeof value === 'number' || typeof value === 'string' ? String(value).trim() : '';
}

function actionLabels(action: string): Pick<ToolActionPresentation, 'runningLabel' | 'doneLabel' | 'failedLabel'> {
  return {
    runningLabel: `正在${action}`,
    doneLabel: `已${action}`,
    failedLabel: `${action}失败`,
  };
}

function generationDetail(params: Record<string, unknown>): string {
  const model = stringParam(params, ['model', 'modelId', 'modelName', 'engine']);
  const size = stringParam(params, ['size', 'resolution']);
  const width = numberParam(params, ['width']);
  const height = numberParam(params, ['height']);
  const ratio = stringParam(params, ['aspectRatio', 'ratio']);
  const duration = numberParam(params, ['duration', 'durationSeconds', 'seconds']);
  const dimensions = size || (width && height ? `${width}×${height}` : '') || ratio;
  return [model, dimensions, duration ? `${duration}s` : ''].filter(Boolean).join(' · ');
}

function genericDetail(params: Record<string, unknown>): string {
  const target = stringParam(params, [
    'nodeId',
    'shotId',
    'shotNo',
    'taskId',
    'projectId',
    'sessionId',
  ]);
  return target;
}

function classifyTool(name: string): { action: string; icon: ToolIconKind; detailStyle: ToolDetailStyle } {
  const exact: Record<string, { action: string; icon: ToolIconKind; detailStyle: ToolDetailStyle }> = {
    bash: { action: '运行命令', icon: 'terminal', detailStyle: 'code' },
    read_file: { action: '读取文件', icon: 'read', detailStyle: 'code' },
    write_file: { action: '写入文件', icon: 'write', detailStyle: 'code' },
    edit_file: { action: '编辑文件', icon: 'write', detailStyle: 'code' },
    grep_search: { action: '搜索内容', icon: 'search', detailStyle: 'code' },
    glob_search: { action: '查找文件', icon: 'search', detailStyle: 'code' },
    web_search: { action: '搜索网页', icon: 'search', detailStyle: 'text' },
    web_fetch: { action: '读取网页', icon: 'browser', detailStyle: 'code' },
    browser_control: { action: '操作浏览器', icon: 'browser', detailStyle: 'text' },
    image_recognition: { action: '分析图片', icon: 'generate', detailStyle: 'text' },
    ask_user_question: { action: '询问用户', icon: 'default', detailStyle: 'text' },
    skill_invoke: { action: '调用技能', icon: 'default', detailStyle: 'code' },
  };
  if (exact[name]) return exact[name];
  if (/image.*generate|generate.*image|canvas_generate|workshop_generate/.test(name)) {
    return { action: '生成图片', icon: 'generate', detailStyle: 'text' };
  }
  if (/video.*generate|generate.*video/.test(name)) {
    return { action: '生成视频', icon: 'generate', detailStyle: 'text' };
  }
  if (/audio.*generate|speech.*generate|generate.*audio/.test(name)) {
    return { action: '生成音频', icon: 'generate', detailStyle: 'text' };
  }
  if (name.startsWith('timeline_export_')) return { action: '导出视频', icon: 'timeline', detailStyle: 'code' };
  if (name.startsWith('timeline_')) return { action: '操作时间线', icon: 'timeline', detailStyle: 'text' };
  if (name.startsWith('canvas_')) return { action: '更新画布', icon: 'generate', detailStyle: 'text' };
  if (name.startsWith('workshop_')) return { action: '更新工坊', icon: 'generate', detailStyle: 'text' };
  if (name.startsWith('director_')) return { action: '调整导演台', icon: 'timeline', detailStyle: 'text' };
  if (name.startsWith('copywriting_')) return { action: '修改文案', icon: 'write', detailStyle: 'text' };
  return { action: '运行工具', icon: 'default', detailStyle: 'text' };
}

export function createToolPresentation(name: string, params: Record<string, unknown>): ToolActionPresentation {
  const classified = classifyTool(name);
  let detail = '';
  if (name === 'bash') {
    detail = redactSensitive(findParam(params, ['command', 'cmd']));
  } else if (/^(?:read_file|write_file|edit_file|list_directory)$/.test(name)) {
    detail = basename(findParam(params, ['path', 'filePath', 'file']));
  } else if (name === 'grep_search') {
    detail = stringParam(params, ['pattern', 'query']);
  } else if (name === 'glob_search') {
    detail = stringParam(params, ['globPattern', 'pattern']);
  } else if (name === 'web_search') {
    detail = stringParam(params, ['query', 'searchQuery']);
  } else if (name === 'web_fetch') {
    detail = stringParam(params, ['url']);
  } else if (name === 'browser_control') {
    detail = [stringParam(params, ['action']), stringParam(params, ['url'])].filter(Boolean).join(' · ');
  } else if (/generate/.test(name)) {
    detail = generationDetail(params);
  } else if (name.startsWith('timeline_export_')) {
    detail = basename(findParam(params, ['outputPath', 'path']));
  } else {
    detail = genericDetail(params);
  }
  return {
    ...actionLabels(classified.action),
    detail: detail || undefined,
    detailStyle: classified.detailStyle,
    icon: classified.icon,
  };
}

export function createLegacyToolPresentation(name: string, summary: string): ToolActionPresentation {
  const classified = classifyTool(name);
  const cleaned = compactText(summary
    .replace(/^(?:搜索|获取|执行|读取|写入|编辑)[:：]?\s*/, ''), 240);
  return {
    ...actionLabels(classified.action),
    detail: cleaned || undefined,
    detailStyle: classified.detailStyle,
    icon: classified.icon,
  };
}

export function labelToolPresentation(display: ToolActionPresentation, status: 'running' | 'done' | 'failed'): string {
  if (status === 'running') return display.runningLabel;
  if (status === 'failed') return display.failedLabel;
  return display.doneLabel;
}

export function compactToolError(value: unknown): string {
  return compactText(value, 220);
}

export function normalizeRunProgress(text: string): NormalizedProgressUpdate | null {
  const flat = flattenText(text);
  if (!flat) return null;

  if (/收到你的补充/.test(flat)) {
    const quoted = flat.match(/[“"]([^”"]+)[”"]/)?.[1];
    return {
      kind: 'guidance',
      status: 'info',
      text: quoted ? `已收到补充：${compactText(quoted, 96)}` : '已收到补充，继续当前任务',
    };
  }

  if (/(?:上下文|较早(?:的)?(?:任务)?记录|历史消息).*(?:整理|压缩)|(?:整理|压缩).*(?:上下文|历史消息|较早(?:的)?记录)/.test(flat)) {
    if (/(?:失败|未能|暂时不能|错误)/.test(flat)) {
      return { kind: 'context', status: 'failed', text: '上下文整理未完成，继续当前任务' };
    }
    if (/(?:完成|已整理|已压缩)/.test(flat) && !/(?:正在|接近容量)/.test(flat)) {
      return { kind: 'context', status: 'done', text: '已整理上下文' };
    }
    return { kind: 'context', status: 'running', text: '正在整理上下文' };
  }

  if (/(?:工具结果未能送回|工具桥|Harness|ACP).*(?:失败|断开|未能|错误|失效)/i.test(flat)) {
    return { kind: 'error', status: 'failed', text: compactText(flat, 180) };
  }

  // Ordinary model narration belongs in the answer/thinking surface. Tool
  // rows already communicate concrete work, so duplicating prose here makes
  // the timeline noisy and exposes engine-specific writing habits.
  return null;
}

export function normalizeRunPresentationEvent(event: RawRunPresentationEvent): NormalizedRunPresentationEvent | null {
  if (event.type === 'progress') {
    const value = normalizeRunProgress(event.text);
    return value ? { kind: 'progress', value } : null;
  }
  return { kind: 'tool', value: createToolPresentation(event.name, event.params) };
}

export function buildTimelinePresentationItems<
  P extends ProgressLike,
  S extends StepLike,
>(run: { progressUpdates?: P[]; steps: S[] }): Array<TimelinePresentationItem<P, S>> {
  const items: Array<TimelinePresentationItem<P, S>> = [];
  for (const update of run.progressUpdates ?? []) {
    const normalized = update.kind && update.status
      ? { kind: update.kind, status: update.status, text: update.text }
      : normalizeRunProgress(update.text);
    if (!normalized) continue;
    items.push({
      id: update.id,
      at: update.createdAt,
      kind: 'progress',
      value: { ...update, ...normalized },
      defaultExpanded: false,
    });
  }
  for (const step of run.steps) {
    items.push({
      id: step.id,
      at: step.startedAt ?? step.endedAt ?? 0,
      kind: 'step',
      value: step,
      defaultExpanded: step.status === 'active' || step.status === 'failed',
    });
  }
  return items.sort((left, right) => left.at - right.at);
}
