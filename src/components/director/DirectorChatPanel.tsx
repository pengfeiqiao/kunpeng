import { useEffect, useState } from 'react';
import { useChatStore } from '@/stores';
import { useDirectorStore, activeDirectorPlan } from '@/stores/directorStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useWorkshopStore } from '@/stores/workshopStore';
import { ensureProjectSession } from '@/lib/projectSessions';
import AgentDrawer from '../chat/AgentDrawer';

const STRIP_RE = /^\[导演台上下文[\s\S]*?\]\n\n/;

export const DIRECTOR_DRAWER_OPEN_EVENT = 'kunpeng-director-drawer-open';
export const DIRECTOR_PROMPT_EVENT = 'kunpeng-director-prompt';

export function openDirectorAssistant(draft = ''): void {
  window.dispatchEvent(new CustomEvent(DIRECTOR_PROMPT_EVENT, { detail: { draft } }));
}

export default function DirectorChatPanel({ onSendMessage, onAbort }: {
  onSendMessage: (content: string, filePaths?: string[]) => void;
  onAbort: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState('');
  const isStreaming = useChatStore((state) => state.streamingPhase !== 'idle');

  useEffect(() => {
    const openDrawer = () => setOpen(true);
    const receivePrompt = (event: Event) => {
      const next = (event as CustomEvent<{ draft?: string }>).detail?.draft ?? '';
      setOpen(true);
      if (next) setDraft(next);
    };
    window.addEventListener(DIRECTOR_DRAWER_OPEN_EVENT, openDrawer);
    window.addEventListener(DIRECTOR_PROMPT_EVENT, receivePrompt);
    return () => {
      window.removeEventListener(DIRECTOR_DRAWER_OPEN_EVENT, openDrawer);
      window.removeEventListener(DIRECTOR_PROMPT_EVENT, receivePrompt);
    };
  }, []);

  const sendWithContext = async (text: string, files?: string[]) => {
    const state = useDirectorStore.getState();
    const plan = activeDirectorPlan(state);
    const unifiedId = useUnifiedProjectStore.getState().activeId;
    const workshop = useWorkshopStore.getState().project;
    if (unifiedId && workshop) await ensureProjectSession(unifiedId, workshop.name);
    const prefix = `[导演台上下文：当前来源「${state.origin.title || '空白导演台'}」，方案「${plan?.name ?? '无'}」，${plan?.shots.length ?? 0} 个镜头，${state.elements.length} 个舞台对象，当前播放头第 ${Math.round(state.currentTimeSec * 24)} 帧。请先调用 director_get_state 获取精确 ID 和当前帧状态，再调用 director_* 工具操作。所有时间修改优先使用 24fps 的整数帧；不要猜测人物、镜头、动作或关键帧 ID。人工锁定的动作和关键帧不得覆盖，除非用户明确要求解除或覆盖锁定。每次写入后重新调用 director_get_state 复核。Agent 可以调整对象、动作、摄影机 K 帧、曲线路径、播放头和导出工作区；生成正式图片、生成视频和真正开始导出仍由用户在界面最终确认。]

`;
    onSendMessage(prefix + text, files);
  };

  return (
    <AgentDrawer
      open={open}
      onOpenChange={setOpen}
      title="导演助手"
      stripPrefixRe={STRIP_RE}
      greeting={{ hello: '把调度意图告诉我', title: '我来操作白模、动作和摄影机' }}
      suggestions={[
        '读取当前镜头，检查人物为什么没有动作',
        '给当前人物设计一套有起承转合的动作关键帧',
        '把当前运镜改成电影感推进，并保留人工锁定',
        '检查所有镜头的景别、角度和人物可见性',
        '把播放头附近的直线路径改成自然弧线',
        '设置导出入点和出点，然后打开导出面板',
      ]}
      onSend={(text, files) => void sendWithContext(text, files)}
      onAbort={onAbort}
      placeholder="描述人物怎么演、镜头怎么走，或直接让我检查当前帧"
      draft={draft}
      onDraftConsumed={() => setDraft('')}
      launcherBottom={296}
      badgeCount={isStreaming ? 1 : 0}
    />
  );
}
