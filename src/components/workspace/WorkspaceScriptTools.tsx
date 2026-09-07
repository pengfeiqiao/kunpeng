import { useEffect, useId, useRef, useState } from 'react';
import { ArrowLeft, FileText, ListTree } from 'lucide-react';
import { useChatStore } from '@/stores';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { projectAssistantQueue } from '@/stores/projectAssistantQueueStore';
import { captureScriptOperation, enqueueScriptBreakdown, type ScriptOperation } from '@/lib/workspace/scriptTools';
import { buildBreakdownPrompt } from '@/lib/workshop/workshopPrompts';
import StepScript from '@/components/workshop/steps/StepScript';
import StepBreakdown from '@/components/workshop/steps/StepBreakdown';
import { buildStyleSection } from '@/components/workshop/StyleSelector';
import './workspaceScriptTools.css';

export interface WorkspaceScriptToolsProps {
  projectId: string;
  onClose: () => void;
}

export default function WorkspaceScriptTools(props: WorkspaceScriptToolsProps) {
  return <ScriptTools key={props.projectId} {...props} />;
}

function ScriptTools({ projectId, onClose }: WorkspaceScriptToolsProps) {
  const [tab, setTab] = useState<'script' | 'breakdown'>('script');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const operationRef = useRef<ScriptOperation | null>(null);
  const mounted = useRef(true);
  const id = useId();
  const activeId = useUnifiedProjectStore((state) => state.activeId);
  const storedProjectId = useWorkshopStore((state) => state.project?.id);
  const dataProjectId = useWorkshopStore((state) => state.data?.projectId);
  const ready = activeId === projectId && storedProjectId === projectId && dataProjectId === projectId;
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; operationRef.current?.close(); operationRef.current = null; };
  }, []);

  const requestBreakdown = async () => {
    if (operationRef.current) return;
    setError(''); setBusy(true);
    let operation: ScriptOperation | undefined;
    try {
      operation = captureScriptOperation(projectId, {
        read: () => {
          const state = useWorkshopStore.getState();
          return { project: state.project, dataProjectId: state.data?.projectId,
            activeProjectId: useUnifiedProjectStore.getState().activeId,
            sessionId: useChatStore.getState().currentSessionId, style: state.data?.style };
        },
        subscribe: (listener) => {
          const offWorkshop = useWorkshopStore.subscribe(listener);
          const offUnified = useUnifiedProjectStore.subscribe(listener);
          const offChat = useChatStore.subscribe(listener);
          return () => { offWorkshop(); offUnified(); offChat(); };
        },
      }, true);
      operationRef.current = operation;
      await enqueueScriptBreakdown(operation, {
        buildStyle: buildStyleSection,
        buildPrompt: buildBreakdownPrompt,
        enqueue: (target, prompt) => {
          operation!.assertCurrent();
          projectAssistantQueue.enqueue(target, prompt);
          // Select the dedicated project target without replacing any object-thread draft.
          projectAssistantQueue.select(target);
          useWorkshopStore.getState().updateProjectViewState({ agentDrawerState: 'expanded' });
          setTab('breakdown');
        },
      });
    } catch (cause) {
      if (mounted.current) setError(cause instanceof Error ? cause.message : '拆解任务未加入队列。');
    } finally {
      operation?.close();
      if (operationRef.current === operation) operationRef.current = null;
      if (mounted.current) setBusy(false);
    }
  };

  const tabs = [{ id: 'script' as const, label: '剧本来源', icon: FileText },
    { id: 'breakdown' as const, label: '拆解结果', icon: ListTree }];
  return <section className="workspace-script-tools canvas-dark" aria-label="剧本与拆解" aria-busy={busy}>
    <header className="workspace-script-toolbar">
      <button className="workspace-script-back" title="返回素材" onClick={onClose}><ArrowLeft size={16} />返回素材</button>
      <div role="tablist" aria-label="剧本工具">{tabs.map(({ id: key, label, icon: Icon }, index) => <button
        key={key} id={`${id}-${key}-tab`} role="tab" aria-selected={tab === key} aria-controls={`${id}-${key}-panel`}
        tabIndex={tab === key ? 0 : -1} onClick={() => setTab(key)} onKeyDown={(event) => {
          if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs[1] : tabs[1 - index];
          setTab(next.id); document.getElementById(`${id}-${next.id}-tab`)?.focus();
        }}><Icon size={15} />{label}</button>)}</div>
      {busy && <span role="status">准备拆解中</span>}
    </header>
    {error && <p className="workspace-script-error" role="alert">{error}</p>}
    {!ready ? <p className="workspace-script-error" role="status">项目尚未就绪，请重新打开项目。</p>
      : tabs.map(({ id: key }) => <div key={key} id={`${id}-${key}-panel`} role="tabpanel"
        aria-labelledby={`${id}-${key}-tab`} hidden={tab !== key} className="workspace-script-panel">
        {key === 'script' ? <StepScript embedded onRequestBreakdown={requestBreakdown} />
          : tab === 'breakdown' ? <StepBreakdown embedded onRequestBreakdown={requestBreakdown} /> : null}
      </div>)}
  </section>;
}
