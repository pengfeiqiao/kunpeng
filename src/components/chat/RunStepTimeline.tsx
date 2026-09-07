import { Fragment, useEffect, useMemo, useState, type CSSProperties, type ReactNode } from 'react';
import { BookOpen, Check, ChevronDown, Circle, FilePenLine, Globe2, Loader2, Search, Sparkles, Terminal, Video, Wrench, X } from 'lucide-react';
import { useChatStore } from '@/stores/chatStore';
import { useRunStepStore, type RunProgressUpdate, type RunSession, type RunStep, type RunSubAgent, type RunToolCall } from '@/stores/runStepStore';
import {
  buildTimelinePresentationItems,
  compactToolError,
  createLegacyToolPresentation,
  labelToolPresentation,
  type ToolIconKind,
} from '@/lib/agent/runStepPresentation';

function statusIcon(status: 'running' | 'done' | 'failed' | 'pending', size = 14) {
  if (status === 'running') return <Loader2 size={size} className="animate-spin" />;
  if (status === 'failed') return <X size={size} />;
  if (status === 'pending') return <Circle size={Math.max(8, size - 5)} />;
  return <Check size={size} />;
}

function actionIcon(kind: ToolIconKind, size = 14) {
  const icons = {
    terminal: Terminal,
    read: BookOpen,
    write: FilePenLine,
    search: Search,
    browser: Globe2,
    generate: Sparkles,
    timeline: Video,
    default: Wrench,
  } satisfies Record<ToolIconKind, typeof Wrench>;
  const Icon = icons[kind];
  return <Icon size={size} />;
}

function ToolEvent({ tool, compact = false }: { tool: RunToolCall; compact?: boolean }) {
  const display = tool.display ?? createLegacyToolPresentation(tool.name, tool.summary);
  const label = labelToolPresentation(display, tool.status);
  const error = tool.status === 'failed' ? compactToolError(tool.resultSummary) : '';
  const icon = tool.status === 'running'
    ? statusIcon('running')
    : tool.status === 'failed'
      ? statusIcon('failed')
      : actionIcon(display.icon);

  return (
    <div className={`${compact ? 'py-1 text-[12px] leading-[18px]' : 'py-1.5 text-[13px] leading-5'} min-w-0`}>
      <div className="flex min-w-0 items-start gap-2.5">
        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center ${tool.status === 'failed' ? 'text-red-500' : 'text-[var(--run-text-muted)]'}`}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className={`${tool.status === 'running' ? 'text-[var(--run-text)]' : 'text-[var(--run-text-secondary)]'} font-medium`}>{label}</div>
          {display.detail && (display.detailStyle === 'code' ? (
            <code className={`${compact ? 'mt-0.5 text-[11px] leading-4' : 'mt-1 text-[12px] leading-[18px]'} block max-w-full whitespace-pre-wrap break-words rounded-[5px] bg-[var(--run-code-bg)] px-2 py-1 font-mono text-[var(--run-text-muted)] [overflow-wrap:anywhere]`}>
              {display.detail}
            </code>
          ) : (
            <div className={`${compact ? 'mt-0.5 text-[11px]' : 'mt-0.5 text-[12px]'} break-words text-[var(--run-text-muted)] [overflow-wrap:anywhere]`}>{display.detail}</div>
          ))}
          {error && <div className={`${compact ? 'mt-0.5 text-[11px]' : 'mt-1 text-[12px]'} break-words text-red-500 [overflow-wrap:anywhere]`}>{error}</div>}
        </div>
      </div>
    </div>
  );
}

function SubAgentEvent({ sub, compact = false }: { sub: RunSubAgent; compact?: boolean }) {
  const kindLabel = sub.kind === 'context' ? '整理上下文' : sub.kind === 'review' ? '检查修正' : '生成草案';
  const label = sub.status === 'running'
    ? `正在${kindLabel}`
    : sub.status === 'failed'
      ? `${kindLabel}失败`
      : sub.status === 'timeout'
        ? `${kindLabel}超时`
        : sub.status === 'aborted'
          ? `${kindLabel}已中止`
          : `已${kindLabel}`;
  const failed = sub.status === 'failed' || sub.status === 'timeout';
  return (
    <div className={`${compact ? 'gap-2 py-1 text-[12px] leading-[18px]' : 'gap-2.5 py-1.5 text-[13px] leading-5'} flex min-w-0 items-start`}>
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center ${failed ? 'text-red-500' : 'text-[var(--run-text-muted)]'}`}>
        {statusIcon(sub.status === 'completed' ? 'done' : failed ? 'failed' : sub.status === 'aborted' ? 'pending' : 'running')}
      </span>
      <span className="min-w-0 flex-1">
        <span className="font-medium text-[var(--run-text-secondary)]">{label}</span>
        <span className="ml-2 break-words text-[var(--run-text-muted)] [overflow-wrap:anywhere]">{sub.title}</span>
        {sub.progress?.slice(-3).map((item, index) => (
          <span key={`${sub.id}-progress-${index}`} className="mt-0.5 block break-words text-[var(--run-text-muted)] [overflow-wrap:anywhere]">{item}</span>
        ))}
        {sub.status === 'completed' && sub.outputSummary && <span className="mt-0.5 block break-words text-[var(--run-text-secondary)] [overflow-wrap:anywhere]">{sub.outputSummary}</span>}
        {failed && sub.error && <span className="mt-0.5 block break-words text-red-500 [overflow-wrap:anywhere]">{compactToolError(sub.error)}</span>}
      </span>
    </div>
  );
}

function groupTitle(step: RunStep, count: number): string {
  if (step.source !== 'tool') return step.title;
  if (step.status === 'active') return `正在执行 ${count} 项操作`;
  if (step.status === 'failed') return `${count} 项操作未完成`;
  return `已完成 ${count} 项操作`;
}

function StepEvent({ step, compact = false, defaultExpanded }: { step: RunStep; compact?: boolean; defaultExpanded: boolean }) {
  const [open, setOpen] = useState(defaultExpanded);
  useEffect(() => setOpen(step.status === 'active' || step.status === 'failed'), [step.status]);

  const children = step.toolCalls.length + step.subAgents.length;
  if (step.source === 'tool' && children === 1 && step.toolCalls.length === 1) return <ToolEvent tool={step.toolCalls[0]} compact={compact} />;
  if (step.source === 'subagent' && children === 1 && step.subAgents.length === 1) return <SubAgentEvent sub={step.subAgents[0]} compact={compact} />;

  const normalizedStatus = step.status === 'active' ? 'running' : step.status === 'failed' ? 'failed' : step.status === 'pending' ? 'pending' : 'done';
  const canExpand = children > 0;
  return (
    <div className={compact ? 'py-1' : 'py-1.5'}>
      <button type="button" onClick={() => canExpand && setOpen((value) => !value)} className={`${compact ? 'gap-2 text-[12px] leading-[18px]' : 'gap-2.5 text-[13px] leading-5'} flex w-full min-w-0 items-start text-left ${canExpand ? 'cursor-pointer' : 'cursor-default'}`}>
        <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center ${step.status === 'failed' ? 'text-red-500' : 'text-[var(--run-text-muted)]'}`}>{statusIcon(normalizedStatus)}</span>
        <span className={`${step.status === 'active' ? 'text-[var(--run-text)]' : 'text-[var(--run-text-secondary)]'} min-w-0 flex-1 break-words font-medium [overflow-wrap:anywhere]`}>{groupTitle(step, Math.max(1, children))}</span>
        {canExpand && <ChevronDown size={13} className={`mt-0.5 shrink-0 text-[var(--run-text-muted)] transition-transform ${open ? 'rotate-180' : ''}`} />}
      </button>
      {open && canExpand && (
        <div className={`${compact ? 'ml-6 mt-0.5' : 'ml-[26px] mt-1'} min-w-0`}>
          {step.toolCalls.map((tool) => <ToolEvent key={tool.id} tool={tool} compact={compact} />)}
          {step.subAgents.map((sub) => <SubAgentEvent key={sub.id} sub={sub} compact={compact} />)}
        </div>
      )}
    </div>
  );
}

function ProgressEvent({ update, compact = false }: { update: RunProgressUpdate; compact?: boolean }) {
  const status = update.status ?? 'info';
  const icon = update.kind === 'context'
    ? status === 'running' ? <Loader2 size={14} className="animate-spin" /> : status === 'failed' ? <X size={14} /> : <BookOpen size={14} />
    : update.kind === 'guidance' ? <Sparkles size={14} /> : <X size={14} />;
  return (
    <div className={`${compact ? 'gap-2 py-1 text-[12px] leading-[18px]' : 'gap-2.5 py-1.5 text-[13px] leading-5'} flex min-w-0 items-start text-[var(--run-text-muted)]`}>
      <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center ${update.kind === 'error' || status === 'failed' ? 'text-red-500' : ''}`}>{icon}</span>
      <span className="min-w-0 break-words [overflow-wrap:anywhere]">{update.text}</span>
    </div>
  );
}

interface RunStepTimelineProps {
  embedded?: boolean;
  preview?: ReactNode;
  compact?: boolean;
  showHeader?: boolean;
  className?: string;
  runId?: string;
  tone?: 'default' | 'dark' | 'light';
}

type EmbeddedStatus = 'running' | 'done' | 'failed' | 'waiting' | 'skipped' | 'stopped';
const embeddedStatusLabels: Record<EmbeddedStatus, string> = {
  running: '执行中', done: '已完成', failed: '未完成', waiting: '等待执行', skipped: '已跳过', stopped: '已停止',
};

export function embeddedStepStatus(step: RunStep): EmbeddedStatus {
  if (step.status === 'failed' || step.toolCalls.some((tool) => tool.status === 'failed')
    || step.subAgents.some((sub) => sub.status === 'failed' || sub.status === 'timeout')) return 'failed';
  if (step.status === 'skipped') return 'skipped';
  if (step.subAgents.some((sub) => sub.status === 'aborted')) return 'stopped';
  if (step.status === 'active' || step.toolCalls.some((tool) => tool.status === 'running')
    || step.subAgents.some((sub) => sub.status === 'running')) return 'running';
  return step.status === 'done' ? 'done' : 'waiting';
}

export function embeddedRunStatus(run: RunSession): EmbeddedStatus {
  const states = run.steps.map(embeddedStepStatus);
  if (run.status === 'aborted') return 'stopped';
  if (run.status === 'failed') return 'failed';
  const hasFailure = states.includes('failed') || run.progressUpdates.some((update) => update.kind === 'error' || update.status === 'failed');
  if (run.status === 'running') return states.includes('running') || hasFailure ? 'running' : 'waiting';
  if (hasFailure || states.some((state) => state === 'waiting' || state === 'running' || state === 'stopped')) return 'failed';
  return 'done';
}

function EmbeddedStatusIcon({ status }: { status: EmbeddedStatus }) {
  return statusIcon(status === 'running' ? 'running' : status === 'done' ? 'done' : status === 'failed' ? 'failed' : 'pending', 13);
}

function EmbeddedToolEvent({ tool }: { tool: RunToolCall }) {
  const display = tool.display ?? createLegacyToolPresentation(tool.name, tool.summary);
  if (tool.name === 'skill_invoke' && (!tool.display?.detail || tool.display.detail === '查看技能目录')) return null;
  return <li className="workspace-assistant-step-record" data-status={tool.status}>
    <EmbeddedStatusIcon status={tool.status} />
    <div><span>{labelToolPresentation(display, tool.status)}</span>
      {display.detail && <details><summary>{tool.name === 'skill_invoke' ? '技能详情' : '操作详情'}</summary><pre>{display.detail}</pre></details>}
      {tool.status === 'failed' && tool.resultSummary && <p role="status">{compactToolError(tool.resultSummary)}</p>}
    </div>
  </li>;
}

function EmbeddedStepEvent({ step }: { step: RunStep }) {
  const status = embeddedStepStatus(step);
  const title = step.source === 'tool' && step.toolCalls.length === 1 && step.toolCalls[0].name === 'skill_invoke'
    && !step.toolCalls[0].display?.detail ? '工具记录' : step.title;
  return <li className="workspace-assistant-step" data-status={status}>
    <EmbeddedStatusIcon status={status} />
    <details><summary><span>{title}</span><small>{embeddedStatusLabels[status]}</small><ChevronDown size={12} /></summary>
      {step.detail && <p>{step.detail}</p>}
      <ol className="workspace-assistant-step-records">
        {step.toolCalls.map((tool) => <EmbeddedToolEvent key={tool.id} tool={tool} />)}
        {step.subAgents.map((sub) => <li key={sub.id}><SubAgentEvent sub={sub} compact /></li>)}
      </ol>
    </details>
  </li>;
}

export default function RunStepTimeline({ compact = false, showHeader = true, className = '', runId, tone = 'default', embedded = false, preview }: RunStepTimelineProps) {
  const sessionId = useChatStore((state) => state.currentSessionId);
  const run = useRunStepStore((state) => {
    if (runId) return state.runsById[runId] ?? null;
    if (!sessionId) return null;
    const ids = state.runIdsBySession[sessionId] ?? [];
    const preferred = state.currentRunId && state.runsById[state.currentRunId]?.sessionId === sessionId ? state.currentRunId : ids[0];
    return preferred ? state.runsById[preferred] : null;
  });
  const events = useMemo(() => run ? buildTimelinePresentationItems(run) : [], [run]);
  if (!run || (!embedded && events.length === 0)) return null;

  const done = run.steps.filter((step) => step.status === 'done').length;
  const toneStyle = {
    '--run-text': tone === 'dark' ? '#d2d2d2' : tone === 'light' ? '#1A1A1A' : 'rgb(var(--c-text))',
    '--run-text-secondary': tone === 'dark' ? '#b5b5b5' : tone === 'light' ? '#4B5563' : 'rgb(var(--c-text) / 0.76)',
    '--run-text-muted': tone === 'dark' ? '#888888' : tone === 'light' ? '#7A8290' : 'rgb(var(--c-text-muted))',
    '--run-code-bg': tone === 'dark' ? 'rgba(255,255,255,0.055)' : tone === 'light' ? 'rgba(15,23,42,0.045)' : 'rgb(var(--c-card) / 0.6)',
  } as CSSProperties;

  if (embedded) {
    const status = embeddedRunStatus(run);
    const hasFailure = run.steps.some((step) => embeddedStepStatus(step) === 'failed')
      || run.progressUpdates.some((update) => update.kind === 'error' || update.status === 'failed');
    const label = status === 'done' ? '执行结束' : status === 'waiting' ? '等待执行回执'
      : status === 'running' && hasFailure ? '执行中 · 有失败记录' : embeddedStatusLabels[status];
    return <div style={toneStyle} className={`workspace-assistant-run ${className}`}>
      <details className="workspace-assistant-stage" data-status={status}><summary>
        <span className="workspace-assistant-stage-heading"><EmbeddedStatusIcon status={status} />
          <span>执行记录</span><strong role="status">{label}</strong><ChevronDown size={13} />
        </span>
        {preview}
      </summary>
        <ol className="workspace-assistant-step-line">{events.map((event) => event.kind === 'step'
          ? <EmbeddedStepEvent key={event.id} step={event.value} />
          : <li key={event.id} className="workspace-assistant-step-note" data-status={event.value.status}>
            <span>{event.value.text}</span>
          </li>)}</ol>
        {events.length === 0 && <p className="workspace-assistant-no-events">暂无步骤回执</p>}
      </details>
    </div>;
  }

  return (
    <div className={`${compact ? 'min-w-0' : 'mx-auto max-w-3xl'} ${className}`} style={toneStyle}>
      {showHeader && (
        <div className="flex items-center gap-2 pb-2 text-[12px] text-[var(--run-text-muted)]">
          {run.status === 'running' ? <Loader2 size={13} className="animate-spin" /> : run.status === 'failed' ? <X size={13} /> : <Check size={13} />}
          <span className="font-medium text-[var(--run-text-secondary)]">{run.status === 'running' ? '执行中' : run.status === 'failed' ? '执行未完成' : '执行完成'}</span>
          <span>{done}/{run.steps.length}</span>
          {run.modelProvider && <span className="ml-auto max-w-[45%] truncate text-[11px]">{run.modelProvider}</span>}
        </div>
      )}
      <div className="min-w-0 space-y-0">
        {events.map((event) => (
          <Fragment key={`${event.kind}-${event.id}`}>
            {event.kind === 'progress' ? <ProgressEvent update={event.value} compact={compact} /> : <StepEvent step={event.value} compact={compact} defaultExpanded={event.defaultExpanded} />}
          </Fragment>
        ))}
      </div>
    </div>
  );
}
