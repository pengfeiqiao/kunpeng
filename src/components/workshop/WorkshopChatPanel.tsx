/**
 * WorkshopChatPanel — 工坊鲲鹏抽屉（AgentDrawer 壳的工坊 wrapper）。
 *
 * 步骤组件通过 window CustomEvent 'kunpeng-workshop-prompt' 注入预制
 * prompt（自动展开并发送；流式中则进入真队列排队，空闲后按序补发）。
 */
import { useEffect, useRef, useState } from 'react';
import { useChatStore } from '@/stores';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { ensureProjectSession } from '@/lib/projectSessions';
import { useHelloGreeting } from '@/lib/greeting';
import AgentDrawer from '../chat/AgentDrawer';
import { SYSTEM_REPAIR_PROMPT_EVENT, type SystemRepairPromptDetail } from '@/lib/agent/systemRepair';

const STRIP_RE = /^\[工坊上下文[\s\S]*?\]\n\n/;

interface QueueItem {
  id: string;
  label: string;
  prompt: string;
  status: 'queued' | 'running';
  enqueuedAt: number;
}

interface Props {
  onSendMessage: (content: string, filePaths?: string[]) => Promise<void> | void;
  onAbort: () => void;
}

/** 步骤组件用：向抽屉注入预制 prompt 并触发发送 */
export function dispatchWorkshopPrompt(prompt: string) {
  window.dispatchEvent(new CustomEvent('kunpeng-workshop-prompt', { detail: { prompt } }));
}

/** 队列条展示名：取 prompt 第一行，去掉方括号前缀，截 30 字 */
function makeLabel(prompt: string): string {
  const first = (prompt.split('\n')[0] ?? '').replace(/^\[[^\]]*\]\s*/, '').trim();
  if (!first) return '未命名任务';
  return first.length > 30 ? `${first.slice(0, 30)}…` : first;
}

export default function WorkshopChatPanel({ onSendMessage, onAbort }: Props) {
  const hello = useHelloGreeting();
  const [open, setOpen] = useState(false);
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const isStreaming = useChatStore((s) => s.streamingPhase) !== 'idle';
  const seqRef = useRef(0);

  const sendWithContext = async (text: string, filePaths?: string[]) => {
    const s = useWorkshopStore.getState();
    // 项目对话隔离：发送前确保切到当前项目的会话
    const unifiedId = useUnifiedProjectStore.getState().activeId;
    if (unifiedId && s.project) {
      await ensureProjectSession(unifiedId, s.project.name);
    }
    const proj = s.project ? `项目「${s.project.name}」` : '尚未打开项目';
    const step = s.data?.currentStep ?? '-';
    const prefix = `[工坊上下文：${proj}，当前步骤 ${step}。按需先调用 workshop_get_state 读取必要状态；修改工坊请使用 workshop_* 工具并确保 UI 实时联动。]\n\n`;
    await onSendMessage(prefix + text, filePaths);
  };

  // 入队：队列/执行中已有完全相同 prompt 时跳过（同类去重）
  const enqueue = (prompt: string) => {
    setOpen(true);
    setQueue((prev) => {
      if (prev.some((q) => q.prompt === prompt)) return prev;
      seqRef.current += 1;
      return [...prev, {
        id: `wq-${Date.now()}-${seqRef.current}`,
        label: makeLabel(prompt),
        prompt,
        status: 'queued' as const,
        enqueuedAt: Date.now(),
      }];
    });
  };

  // 步骤组件注入预制 prompt
  useEffect(() => {
    const handler = (e: Event) => {
      const prompt = (e as CustomEvent<{ prompt: string }>).detail?.prompt;
      if (!prompt) return;
      enqueue(prompt);
    };
    window.addEventListener('kunpeng-workshop-prompt', handler);
    return () => window.removeEventListener('kunpeng-workshop-prompt', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const handler = (event: Event) => {
      const prompt = (event as CustomEvent<SystemRepairPromptDetail>).detail?.prompt;
      if (!prompt) return;
      enqueue(prompt);
    };
    window.addEventListener(SYSTEM_REPAIR_PROMPT_EVENT, handler);
    return () => window.removeEventListener(SYSTEM_REPAIR_PROMPT_EVENT, handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 空闲且无在执行项时取队首发送并标 running（保持 250ms 节奏）
  // 注意：定时器必须放进 ref——标记 running 会触发本 effect 重跑，
  // 若用 cleanup 清定时器，发送会被自己取消（队列永远卡在"执行中"）。
  const scheduledRef = useRef<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (isStreaming) return;
    if (queue.some((q) => q.status === 'running')) return;
    const head = queue.find((q) => q.status === 'queued');
    if (!head) return;
    if (scheduledRef.current === head.id) return;
    scheduledRef.current = head.id;
    setQueue((prev) => prev.map((q) => (q.id === head.id ? { ...q, status: 'running' as const } : q)));
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      scheduledRef.current = null;
      // Promise settle 是唯一的队列放行信号。不能再用 streamingPhase 回到 idle
      // 提前移除 running；流式正文结束后 coordinator 仍可能在做工具收尾。
      Promise.resolve(sendWithContext(head.prompt)).then(
        () => setQueue((prev) => prev.filter((q) => q.id !== head.id)),
        (err) => {
          console.warn('[workshop-queue] 任务发送失败，已从队列移除', err);
          setQueue((prev) => prev.filter((q) => q.id !== head.id));
        },
      );
    }, 250);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queue, isStreaming]);

  // 卸载时清掉未发的定时器，避免组件销毁后还发消息
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  const cancelQueueItem = (id: string) => {
    setQueue((prev) => prev.filter((q) => q.id !== id || q.status !== 'queued'));
  };

  return (
    <AgentDrawer
      open={open}
      onOpenChange={setOpen}
      stripPrefixRe={STRIP_RE}
      greeting={{ hello: hello, title: '这条流水线交给我吧' }}
      suggestions={[
        '读取我上传的剧本并完成拆解',
        '为所有角色和场景写资产图提示词',
        '把第 3 镜的视频提示词改得更有张力',
      ]}
      onSend={(text, files) => void sendWithContext(text, files)}
      onAbort={onAbort}
      modelScope="workshop"
      placeholder="拆剧本、写提示词、批量生成，描述即可"
      queueItems={queue.map(({ id, label, status }) => ({ id, label, status }))}
      onCancelQueueItem={cancelQueueItem}
    />
  );
}
