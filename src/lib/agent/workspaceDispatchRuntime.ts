import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { useChatStore } from '@/stores/chatStore';
import { projectAssistantQueue } from '@/stores/projectAssistantQueueStore';
import { bindWorkspaceDispatchSession } from './workspaceDispatchSession';

export function bindWorkspaceRunDispatch(runId: string, content: string): () => void {
  return bindWorkspaceDispatchSession(runId, content, {
    read: () => {
      const workshop = useWorkshopStore.getState();
      return { data: workshop.project?.id === workshop.data?.projectId ? workshop.data : null,
        activeProjectId: useUnifiedProjectStore.getState().activeId,
        sessionId: useChatStore.getState().currentSessionId, items: projectAssistantQueue.getSnapshot().items };
    },
    subscribe: (listener) => {
      const off = [useWorkshopStore.subscribe(listener), useUnifiedProjectStore.subscribe(listener), useChatStore.subscribe(listener)];
      return () => off.forEach((close) => close());
    },
  });
}
