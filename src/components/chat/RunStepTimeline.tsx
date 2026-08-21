import { Fragment, useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  Circle,
  FilePenLine,
  Loader2,
  Search,
  Sparkles,
  Terminal,
  X,
} from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import {
  useRunStepStore,
  type RunProgressUpdate,
  type RunStep,
  type RunSubAgent,
  type RunToolCall,
} from '@/stores/runStepStore';
import { isTechnicalProgressText } from '@/lib/agent/toolSummary';

function friendlyToolName(name: string): string {
  const labels: Record<string, string> = {
    bash: '运行命令',
    read_file: '读取文件',
    write_file: '写入文件',
    edit_file: '编辑文件',
    grep_search: '搜索内容',
    glob_search: '查找文件',
    web_search: '联网搜索',
    web_fetch: '读取网页',
    browser_control: '查看网页',
    sleep: '等待页面加载',
    image_generate: '生成图片',
    video_generate: '生成视频',
    canvas_generate: '生成画布资产',
    workshop_generate: '生成工坊产物',
    timeline_export_video: '导出视频',
    image_recognition: '分析图片',
    ask_user_question: '询问用户',
    skill_invoke: '调用技能',
    project_get_paths: '读取项目位置',
  };
  if (labels[name]) return labels[name];
  if (name.startsWith('workshop_')) return '操作工坊';
  if (name.startsWith('canvas_')) return '操作画布';
  if (name.startsWith('timeline_')) return '操作剪辑';
  if (name.startsWith('director_')) return '操作导演台';
  if (name.startsWith('copywriting_')) return '修改文案';
  if (name.startsWith('touliu_')) return '操作投流';
  return '处理当前任务';
}

function taskText(tool: RunToolCall): string {
  const summary = tool.summary
    .replace(/^搜索:\s*/, '')
    .replace(/^获取:\s*/, '')
    .replace(/^执行:\s*/, '')
    .trim();
  const verb = tool.status === 'running' ? '正在' : tool.status === 'failed' ? '未能完成' : '已完成';

  if (tool.name === 'web_search') return `${verb === '已完成' ? '已搜索' : verb === '正在' ? '正在搜索' : '未能搜索'}${summary ? ` ${summary}` : ''}`;
  if (tool.name === 'web_fetch') return `${verb === '已完成' ? '已读取' : verb === '正在' ? '正在读取' : '未能读取'}${summary ? ` ${summary}` : '网页'}`;
  if (tool.name === 'browser_control') return tool.status === 'running'
    ? `正在${summary || '检查页面'}`
    : tool.status === 'failed'
      ? `${summary || '页面检查'}未完成`
      : `已${summary || '检查页面'}`;
  if (tool.name === 'sleep') return tool.status === 'running' ? '正在等待页面加载' : tool.status === 'failed' ? '页面等待未完成' : '页面已加载';
  if (tool.name === 'read_file') return `${verb === '已完成' ? '已读取' : verb === '正在' ? '正在读取' : '未能读取'}${summary.replace(/^读取\s*/, ' ')}`;
  if (tool.name === 'write_file') return `${verb === '已完成' ? '已写入' : verb === '正在' ? '正在写入' : '未能写入'}${summary.replace(/^写入\s*/, ' ')}`;
  if (tool.name === 'edit_file') return `${verb === '已完成' ? '已编辑' : verb === '正在' ? '正在编辑' : '未能编辑'}${summary.replace(/^编辑\s*/, ' ')}`;
  if (tool.name === 'bash') {
    const action = summary || '运行系统命令';
    return tool.status === 'running' ? `正在${action}` : tool.status === 'failed' ? `${action}未完成` : `${action}完成`;
  }

  const label = friendlyToolName(tool.name);
  return `${verb}${label}`;
}

function ToolIcon({ tool }: { tool: RunToolCall }) {
  if (tool.status === 'running') return <Loader2 size={14} className="animate-spin" />;
  if (tool.status === 'failed') return <X size={14} />;
  const Icon = /read|fetch/.test(tool.name)
    ? BookOpen
    : /grep|glob|search/.test(tool.name)
      ? Search
      : /write|edit|update|set/.test(tool.name)
        ? FilePenLine
        : /generate|render|export/.test(tool.name)
          ? Sparkles
          : Terminal;
  return <Icon size={14} />;
}

function ToolEvent({ tool, compact = false }: { tool: RunToolCall; compact?: boolean }) {
  return (
    <div className={`flex min-w-0 items-start text-[var(--run-text-muted)] ${compact ? 'gap-2 py-1 text-[12px] leading-[18px]' : 'gap-2.5 py-1.5 text-[13px] leading-5'}`}>
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center"><ToolIcon tool={tool} /></span>
      <span className={`${tool.status === 'running' ? 'text-[var(--run-text)]' : ''} min-w-0 break-words [overflow-wrap:anywhere]`}>{taskText(tool)}</span>
    </div>
  );
}

function StepEvent({ step, compact = false }: { step: RunStep; compact?: boolean }) {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (step.status === 'done') setOpen(false);
  }, [step.status]);
  const icon = step.status === 'active'
    ? <Loader2 size={14} className="animate-spin" />
    : step.status === 'failed'
      ? <X size={14} />
      : step.status === 'pending'
        ? <Circle size={9} />
        : <Check size={14} />;
  const childCount = step.toolCalls.length + step.subAgents.length;
  const detailLines = step.detail?.split('\n').filter(Boolean) ?? [];
  const latestDetail = detailLines[detailLines.length - 1];
  const visibleTitle = step.source === 'tool'
    ? step.status === 'active'
      ? '正在执行相关操作'
      : step.status === 'failed'
        ? '部分操作未完成'
        : '已完成相关操作'
    : step.title;
  return (
    <div className={compact ? 'py-1' : 'py-1.5'}>
      <button
        type="button"
        onClick={() => childCount > 0 && setOpen((value) => !value)}
        className={`flex w-full min-w-0 items-start text-left ${compact ? 'gap-2 text-[12px] leading-[18px]' : 'gap-2.5 text-[13px] leading-5'} ${childCount > 0 ? 'cursor-pointer' : 'cursor-default'}`}
      >
        <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center text-[var(--run-text-muted)]">{icon}</span>
        <span className="min-w-0 flex-1">
          <span className={`${step.status === 'active' ? 'text-[var(--run-text)]' : 'text-[var(--run-text-secondary)]'} break-words font-medium [overflow-wrap:anywhere]`}>{visibleTitle}</span>
          {latestDetail && <span className={`${compact ? 'ml-1.5 text-[11px]' : 'ml-2 text-[12px]'} break-words text-[var(--run-text-muted)] [overflow-wrap:anywhere]`}>{latestDetail.trim()}</span>}
        </span>
        {childCount > 0 && (
          <span className="flex shrink-0 items-center text-[var(--run-text-muted)]">
            <ChevronDown size={13} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        )}
      </button>
      {open && childCount > 0 && (
        <div className={`${compact ? 'ml-6 mt-0.5' : 'ml-[26px] mt-1 pl-1'} min-w-0`}>
          {step.toolCalls.map((tool) => <ToolEvent key={tool.id} tool={tool} compact={compact} />)}
          {step.subAgents.map((sub) => <SubAgentEvent key={sub.id} sub={sub} compact={compact} />)}
        </div>
      )}
    </div>
  );
}

function normalizeProgressText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]*\n(?:[ \t]*\n)+/g, '\n\n')
    .trim();
}

function ProgressEvent({ update, compact = false }: { update: RunProgressUpdate; compact?: boolean }) {
  const text = normalizeProgressText(update.text);
  if (!text) return null;
  return (
    <div className={`max-w-full whitespace-pre-wrap break-words text-[var(--run-text)] [overflow-wrap:anywhere] ${compact ? 'py-1.5 text-[12px] leading-5' : 'py-2.5 text-[14px] leading-7'}`}>
      {text}
    </div>
  );
}

function SubAgentEvent({ sub, compact = false }: { sub: RunSubAgent; compact?: boolean }) {
  const icon = sub.status === 'running'
    ? <Loader2 size={14} className="animate-spin" />
    : sub.status === 'failed'
      ? <X size={14} />
      : <Check size={14} />;
  const kindLabel = sub.kind === 'context' ? '整理上下文' : sub.kind === 'review' ? '检查修正' : '生成草案';
  return (
    <div className={`flex min-w-0 items-start text-[var(--run-text-muted)] ${compact ? 'gap-2 py-1 text-[12px] leading-[18px]' : 'gap-2.5 py-1.5 text-[13px] leading-5'}`}>
      <span className="mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center">{icon}</span>
      <span className="shrink-0">{sub.status === 'running' ? `正在${kindLabel}` : `已${kindLabel}`}</span>
      <span className="min-w-0 break-words opacity-80 [overflow-wrap:anywhere]">{sub.title}</span>
    </div>
  );
}

interface RunStepTimelineProps {
  compact?: boolean;
  showHeader?: boolean;
  className?: string;
  runId?: string;
  tone?: 'default' | 'dark' | 'light';
}

type TimelineEvent =
  | { id: string; at: number; kind: 'progress'; value: RunProgressUpdate }
  | { id: string; at: number; kind: 'step'; value: RunStep };

export default function RunStepTimeline({ compact = false, showHeader = true, className = '', runId, tone = 'default' }: RunStepTimelineProps) {
  const sessionId = useChatStore((s) => s.currentSessionId);
  const run = useRunStepStore((state) => {
    if (runId) return state.runsById[runId] ?? null;
    if (!sessionId) return null;
    const ids = state.runIdsBySession[sessionId] ?? [];
    const preferred = state.currentRunId && state.runsById[state.currentRunId]?.sessionId === sessionId
      ? state.currentRunId
      : ids[0];
    return preferred ? state.runsById[preferred] : null;
  });

  const events = useMemo<TimelineEvent[]>(() => {
    if (!run) return [];
    const next: TimelineEvent[] = [];
    for (const update of run.progressUpdates ?? []) {
      if (isTechnicalProgressText(update.text)) continue;
      next.push({ id: update.id, at: update.createdAt, kind: 'progress', value: update });
    }
    const completedToolSteps = run.steps.filter((step) => step.source === 'tool' && step.status === 'done');
    const completedTools = completedToolSteps.flatMap((step) => step.toolCalls);
    if (completedToolSteps.length > 0) {
      const latestAt = Math.max(...completedToolSteps.map((step) => step.endedAt ?? step.startedAt ?? 0));
      next.push({
        id: 'completed-tools-summary',
        at: latestAt,
        kind: 'step',
        value: {
          id: 'completed-tools-summary',
          title: `已完成 ${completedTools.length || completedToolSteps.length} 项操作`,
          status: 'done',
          source: 'system',
          startedAt: latestAt,
          endedAt: latestAt,
          toolCalls: completedTools,
          subAgents: [],
        },
      });
    }
    for (const step of run.steps) {
      if (step.source === 'tool' && step.status === 'done') continue;
      next.push({ id: step.id, at: step.startedAt ?? 0, kind: 'step', value: step });
    }
    return next.sort((a, b) => a.at - b.at);
  }, [run]);

  if (!run || events.length === 0) return null;
  const done = run.steps.filter((step) => step.status === 'done').length;
  const toneStyle = {
    '--run-text': tone === 'dark' ? '#b8b8b8' : tone === 'light' ? '#1A1A1A' : 'rgb(var(--c-text))',
    '--run-text-secondary': tone === 'dark' ? '#969696' : tone === 'light' ? '#4B5563' : 'rgb(var(--c-text-secondary))',
    '--run-text-muted': tone === 'dark' ? '#737373' : tone === 'light' ? '#7A8290' : 'rgb(var(--c-text-muted))',
  } as CSSProperties;

  return (
    <div className={`${compact ? '' : 'mx-auto max-w-3xl'} ${className}`} style={toneStyle}>
      {showHeader && (
        <div className="flex items-center gap-2 pb-2 text-[12px] text-[var(--run-text-muted)]">
          {run.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : run.status === 'failed' ? <X size={13} /> : <Check size={13} />}
          <span className="font-medium">执行步骤</span>
          <span>{done}/{run.steps.length}</span>
          {run.modelProvider && <span className="ml-auto text-[11px]">{run.modelProvider}</span>}
        </div>
      )}
      <div className={compact ? 'min-w-0 space-y-0' : 'space-y-0.5'}>
        {events.map((event) => (
          <Fragment key={`${event.kind}-${event.id}`}>
            {event.kind === 'progress' && <ProgressEvent update={event.value} compact={compact} />}
            {event.kind === 'step' && <StepEvent step={event.value} compact={compact} />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
