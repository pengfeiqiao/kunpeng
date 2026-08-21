import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Lightbulb,
  MessageSquareText,
} from 'lucide-react';
import {
  useAskUserStore,
  type AskUserAnswer,
  type AskUserOption,
  type AskUserRecord,
  type AskUserRequest,
} from '@/stores/askUserStore';

export type AskUserCardVariant = 'main' | 'drawer-dark' | 'drawer-light';

interface AskUserDecisionCardProps {
  request: AskUserRequest | AskUserRecord;
  variant?: AskUserCardVariant;
  queueLength?: number;
}

interface ActiveAskUserDecisionCardProps {
  request: AskUserRequest;
  variant: AskUserCardVariant;
  queueLength: number;
}

function optionKey(option: AskUserOption): string {
  return option.id?.trim() || option.label;
}

function isResolved(request: AskUserRequest | AskUserRecord): request is AskUserRecord {
  return 'status' in request;
}

function sceneHint(view: AskUserRequest['sourceView']): string {
  if (view === 'canvas') return '确认后继续操作当前画布';
  if (view === 'workshop') return '确认后继续当前工坊步骤';
  if (view === 'editor') return '确认后继续处理当前时间轴';
  if (view === 'copywriting') return '确认后继续修改当前文案';
  return '确认后，鲲鹏会接着完成当前任务';
}

function answerSummary(record: AskUserRecord): string {
  if (record.status === 'cancelled' || !record.answers) return '已取消这次决定';
  const values = record.answers.flatMap((answer) => [
    ...answer.selected,
    ...(answer.freeText ? [answer.freeText] : []),
  ]).filter(Boolean);
  return values.length > 0 ? values.join('、') : '已跳过';
}

function cardTheme(variant: AskUserCardVariant) {
  if (variant === 'drawer-dark') {
    return {
      background: 'rgba(255,255,255,0.035)',
      surface: 'rgba(255,255,255,0.045)',
      surfaceSelected: 'rgba(255,255,255,0.09)',
      border: 'rgba(255,255,255,0.09)',
      borderStrong: 'rgba(255,255,255,0.45)',
      text: 'var(--canvas-text-1)',
      muted: 'var(--canvas-text-3)',
      control: '#FFFFFF',
      controlText: '#111111',
    };
  }
  if (variant === 'drawer-light') {
    return {
      background: '#FFFFFF',
      surface: '#F7F7F8',
      surfaceSelected: '#F1F1F2',
      border: 'rgba(0,0,0,0.08)',
      borderStrong: 'rgba(0,0,0,0.42)',
      text: '#1A1A1A',
      muted: '#7A7A82',
      control: '#1A1A1A',
      controlText: '#FFFFFF',
    };
  }
  return {
    background: 'rgb(var(--c-card))',
    surface: 'rgb(var(--c-bg))',
    surfaceSelected: 'rgb(var(--c-bg))',
    border: 'rgb(var(--c-border))',
    borderStrong: 'rgb(var(--c-text-muted))',
    text: 'rgb(var(--c-text))',
    muted: 'rgb(var(--c-text-muted))',
    control: 'rgb(var(--c-text))',
    controlText: 'rgb(var(--c-bg))',
  };
}

function ResolvedDecisionCard({
  request,
  variant,
}: {
  request: AskUserRecord;
  variant: AskUserCardVariant;
}) {
  const compact = variant !== 'main';
  const theme = cardTheme(variant);
  return (
    <motion.div
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      className={compact ? 'py-0.5' : 'py-1'}
    >
      <div
        className={`flex items-start gap-2 rounded-lg border ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
        style={{ background: theme.background, borderColor: theme.border }}
      >
        <span
          className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full"
          style={{ background: theme.surface, color: theme.muted }}
        >
          <Check size={11} />
        </span>
        <div className="min-w-0 flex-1">
          <div className={compact ? 'text-[10px]' : 'text-[11px]'} style={{ color: theme.muted }}>
            {request.questions[0]?.header || '已完成选择'}
          </div>
          <div className={`mt-0.5 break-words font-medium ${compact ? 'text-[11px] leading-4' : 'text-[12px] leading-5'}`} style={{ color: theme.text }}>
            {answerSummary(request)}
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function ActiveAskUserDecisionCard({
  request,
  variant,
  queueLength,
}: ActiveAskUserDecisionCardProps) {
  const compact = variant !== 'main';
  const theme = cardTheme(variant);
  const snoozed = useAskUserStore((state) => state.snoozed);
  const submit = useAskUserStore((state) => state.submit);
  const snooze = useAskUserStore((state) => state.snooze);
  const resume = useAskUserStore((state) => state.resume);

  const [index, setIndex] = useState(0);
  const [selections, setSelections] = useState<string[][]>([]);
  const [freeTexts, setFreeTexts] = useState<string[]>([]);
  const [customOpen, setCustomOpen] = useState<boolean[]>([]);

  useEffect(() => {
    setIndex(0);
    setSelections(request.questions.map(() => []));
    setFreeTexts(request.questions.map(() => ''));
    setCustomOpen(request.questions.map(() => false));
  }, [request.id]);

  if (snoozed) {
    return (
      <motion.button
        type="button"
        onClick={resume}
        initial={{ opacity: 0, y: 4 }}
        animate={{ opacity: 1, y: 0 }}
        className={`flex w-full items-center gap-2.5 rounded-lg border text-left ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
        style={{ background: theme.background, borderColor: theme.border }}
      >
        <Clock3 size={compact ? 13 : 14} style={{ color: theme.muted }} />
        <span className="min-w-0 flex-1">
          <span className={`block font-medium ${compact ? 'text-[11px]' : 'text-[12px]'}`} style={{ color: theme.text }}>等待你的选择</span>
          <span className={`block truncate ${compact ? 'text-[9px]' : 'text-[10px]'}`} style={{ color: theme.muted }}>{request.questions[0]?.question}</span>
        </span>
        <span className={compact ? 'text-[10px]' : 'text-[11px]'} style={{ color: theme.text }}>继续回答</span>
      </motion.button>
    );
  }

  const current = request.questions[index];
  if (!current) return null;

  const currentSelection = selections[index] ?? [];
  const currentFreeText = freeTexts[index]?.trim() ?? '';
  const currentReady = Boolean(currentSelection.length || currentFreeText || current.required === false);

  const primaryLabel = useMemo(() => {
    if (index < request.questions.length - 1) return '下一步';
    if (current.submitLabel?.trim()) return current.submitLabel.trim();
    if (compact) return '确认并继续';
    if (currentFreeText) return '按此回答继续';
    if (!current.multiSelect && currentSelection.length === 1) {
      const selected = current.options.find((option) => optionKey(option) === currentSelection[0]);
      if (selected && selected.label.length <= 10) return `采用「${selected.label}」并继续`;
    }
    return '确认选择并继续';
  }, [compact, current, currentFreeText, currentSelection, index, request.questions.length]);

  const toggle = (key: string) => {
    setSelections((previous) => previous.map((row, questionIndex) => {
      if (questionIndex !== index) return row;
      if (!current.multiSelect) return [key];
      return row.includes(key) ? row.filter((item) => item !== key) : [...row, key];
    }));
    setFreeTexts((previous) => previous.map((text, questionIndex) => questionIndex === index ? '' : text));
    setCustomOpen((previous) => previous.map((open, questionIndex) => questionIndex === index ? false : open));
  };

  const setCustomText = (value: string) => {
    setFreeTexts((previous) => previous.map((text, questionIndex) => questionIndex === index ? value : text));
    if (value.trim()) {
      setSelections((previous) => previous.map((row, questionIndex) => questionIndex === index ? [] : row));
    }
  };

  const buildAnswers = (): AskUserAnswer[] => request.questions.map((question, questionIndex) => {
    const selectedKeys = selections[questionIndex] ?? [];
    const selectedOptions = question.options.filter((option) => selectedKeys.includes(optionKey(option)));
    return {
      questionId: question.id,
      selected: selectedOptions.map((option) => option.label),
      selectedOptionIds: selectedOptions.map(optionKey),
      freeText: freeTexts[questionIndex]?.trim() || undefined,
    };
  });

  const continueFlow = () => {
    if (!currentReady) return;
    if (index < request.questions.length - 1) {
      setIndex((value) => value + 1);
      return;
    }
    submit(buildAnswers());
  };

  const skipCurrent = () => {
    if (current.required !== false) return;
    if (index < request.questions.length - 1) setIndex((value) => value + 1);
    else submit(buildAnswers());
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA';
      if (event.key === 'Escape') {
        event.preventDefault();
        snooze();
        return;
      }
      if (!typing && /^[1-4]$/.test(event.key)) {
        const option = current.options[Number(event.key) - 1];
        if (option && !option.disabled) {
          event.preventDefault();
          toggle(optionKey(option));
        }
        return;
      }
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        continueFlow();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  });

  return (
    <motion.section
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
      className={`overflow-hidden rounded-xl border ${compact ? '' : 'max-w-[640px]'}`}
      style={{ background: theme.background, borderColor: theme.border }}
      aria-label="Agent 决策问题"
    >
      <div className={`flex items-center gap-2.5 border-b ${compact ? 'px-3 py-2.5' : 'px-4 py-3'}`} style={{ borderColor: theme.border }}>
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md" style={{ background: theme.surface, color: theme.text }}>
          <MessageSquareText size={13} />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <span className={`truncate font-semibold ${compact ? 'text-[11px]' : 'text-[12px]'}`} style={{ color: theme.text }}>
              {current.header || '需要你决定'}
            </span>
            {request.questions.length > 1 && (
              <span className="shrink-0 text-[9px]" style={{ color: theme.muted }}>{index + 1}/{request.questions.length}</span>
            )}
          </div>
          <div className={`mt-0.5 truncate ${compact ? 'text-[9px]' : 'text-[10px]'}`} style={{ color: theme.muted }}>
            {sceneHint(request.sourceView)}
            {queueLength > 0 ? ` · 还有 ${queueLength} 组待回答` : ''}
          </div>
        </div>
      </div>

      <div className={compact ? 'px-3 py-2.5' : 'px-4 py-3.5'}>
        <h3 className={`font-medium ${compact ? 'text-[12px] leading-[18px]' : 'text-[14px] leading-5'}`} style={{ color: theme.text }}>
          {current.question}
        </h3>
        {current.context && (
          <p className={`mt-1 ${compact ? 'text-[10px] leading-4' : 'text-[11px] leading-4'}`} style={{ color: theme.muted }}>{current.context}</p>
        )}

        <div className={`${compact ? 'mt-2 space-y-1' : 'mt-3 space-y-1.5'}`}>
          {current.options.map((option, optionIndex) => {
            const key = optionKey(option);
            const checked = currentSelection.includes(key);
            return (
              <button
                key={key}
                type="button"
                disabled={option.disabled}
                onClick={() => toggle(key)}
                className={`flex w-full items-start gap-2 rounded-lg border text-left transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${compact ? 'px-2.5 py-2' : 'px-3 py-2.5'}`}
                style={{
                  borderColor: checked ? theme.borderStrong : theme.border,
                  background: checked ? theme.surfaceSelected : theme.surface,
                }}
              >
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center border ${current.multiSelect ? 'rounded-[4px]' : 'rounded-full'}`}
                  style={{
                    borderColor: checked ? theme.control : theme.muted,
                    background: checked ? theme.control : 'transparent',
                  }}
                >
                  {checked && <Check size={10} style={{ color: theme.controlText }} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <span className={`min-w-0 truncate font-medium ${compact ? 'text-[11px]' : 'text-[12px]'}`} style={{ color: theme.text }}>{option.label}</span>
                    {option.recommended && (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[8px] font-medium" style={{ background: theme.background, color: theme.muted }}>
                        <Lightbulb size={8} />
                        推荐
                      </span>
                    )}
                    {option.badge && (
                      <span className="shrink-0 rounded px-1.5 py-0.5 text-[8px]" style={{ background: theme.background, color: theme.muted }}>{option.badge}</span>
                    )}
                    {!compact && <kbd className="ml-auto text-[8px]" style={{ color: theme.muted }}>{optionIndex + 1}</kbd>}
                  </span>
                  {option.description && (
                    <span className={`mt-0.5 block ${compact ? 'text-[9px] leading-[14px]' : 'text-[10px] leading-4'}`} style={{ color: theme.muted }}>{option.description}</span>
                  )}
                </span>
              </button>
            );
          })}
        </div>

        {current.allowCustom !== false && (
          <div className="mt-2">
            {!customOpen[index] ? (
              <button
                type="button"
                onClick={() => setCustomOpen((previous) => previous.map((open, questionIndex) => questionIndex === index ? true : open))}
                className={compact ? 'text-[9px]' : 'text-[10px]'}
                style={{ color: theme.muted }}
              >
                都不合适，自己填写
              </button>
            ) : (
              <textarea
                autoFocus
                value={freeTexts[index] ?? ''}
                onChange={(event) => setCustomText(event.target.value)}
                placeholder="写下你的具体要求…"
                rows={compact ? 2 : 3}
                className={`w-full resize-none rounded-lg border bg-transparent outline-none ${compact ? 'px-2.5 py-2 text-[10px] leading-4' : 'px-3 py-2 text-[11px] leading-4'}`}
                style={{ borderColor: theme.border, color: theme.text }}
              />
            )}
          </div>
        )}
      </div>

      <div className={`flex items-center gap-1.5 border-t ${compact ? 'px-3 py-2' : 'px-4 py-3'}`} style={{ borderColor: theme.border }}>
        {index > 0 && (
          <button type="button" onClick={() => setIndex((value) => Math.max(0, value - 1))} className="flex h-7 items-center gap-1 rounded-md px-1.5 text-[9px]" style={{ color: theme.muted }}>
            <ChevronLeft size={11} />
            上一步
          </button>
        )}
        {current.required === false && (
          <button type="button" onClick={skipCurrent} className="h-7 rounded-md px-1.5 text-[9px]" style={{ color: theme.muted }}>跳过</button>
        )}
        <button type="button" onClick={snooze} className="h-7 rounded-md px-1.5 text-[9px]" style={{ color: theme.muted }}>稍后</button>
        <button type="button" onClick={() => submit(null)} className="h-7 rounded-md px-1.5 text-[9px]" style={{ color: theme.muted }}>结束</button>
        <button
          type="button"
          disabled={!currentReady}
          onClick={continueFlow}
          className={`ml-auto flex h-8 min-w-0 items-center justify-center gap-1 rounded-md px-3 font-semibold transition-opacity disabled:cursor-not-allowed disabled:opacity-30 ${compact ? 'max-w-[150px] text-[10px]' : 'text-[11px]'}`}
          style={{ background: theme.control, color: theme.controlText }}
        >
          <span className="truncate">{primaryLabel}</span>
          {index < request.questions.length - 1 && <ChevronRight size={11} className="shrink-0" />}
        </button>
      </div>
    </motion.section>
  );
}

/**
 * A decision is a real chat event, not an overlay. The same component has a
 * roomy main-chat treatment and compact drawer treatments for workspace agents.
 */
export function AskUserDecisionCard({
  request,
  variant = 'main',
  queueLength = 0,
}: AskUserDecisionCardProps) {
  if (isResolved(request)) {
    return <ResolvedDecisionCard request={request} variant={variant} />;
  }
  return <ActiveAskUserDecisionCard request={request} variant={variant} queueLength={queueLength} />;
}
