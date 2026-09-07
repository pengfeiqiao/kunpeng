import { useState } from 'react';
import { MoreHorizontal, ImageIcon, Video, Music, ExternalLink, ChevronDown } from 'lucide-react';
import { convertFileSrc } from '@tauri-apps/api/tauri';
import { useWorkshopStore } from '@/stores/workshopStore';
import { useUnifiedProjectStore } from '@/stores/unifiedProjectStore';
import { MarkdownRenderer } from '@/lib/markdown';
import type { Message } from '@/types';
import RunStepTimeline from '../chat/RunStepTimeline';
import { assistantResultMedia, assistantPromptChanges, assistantFieldLabel, WORKSPACE_ASSISTANT_INSPECT_EVENT, type WorkspaceAssistantInspectDetail } from './assistantPresentation';

export default function WorkspaceAssistantMessage({ message, tone }: { message: Message; tone: 'light' | 'dark' }) {
  const data = useWorkshopStore((state) => state.data);
  const changes = useUnifiedProjectStore((state) => state.recentChangeSets);
  const [notice, setNotice] = useState('');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [thinkingOpen, setThinkingOpen] = useState(false);
  const media = assistantResultMedia(message, data?.projectObjects);
  const promptChanges = assistantPromptChanges(message, data?.projectId);
  const snapshot = data?.projectSnapshots?.find((entry) => entry.id === message.metadata?.projectSnapshotId && entry.messageId === message.id);
  const changeIds = Array.isArray(message.metadata?.projectChangeSetIds) ? message.metadata.projectChangeSetIds : [];
  const boundChanges = changes.filter((entry) => changeIds.includes(entry.id));
  const runId = typeof message.metadata?.runId === 'string' ? message.metadata.runId : undefined;
  const mediaPreview = media.length > 0 ? <span className="workspace-assistant-stage-previews" aria-label={`${media.length} 个已返回媒体`}>
    {media.slice(0, 3).map((item) => {
      const src = /^(https?:|data:|blob:|asset:)/i.test(item.path) ? item.path : convertFileSrc(item.path);
      return <span key={item.id}>{item.mediaType === 'image' ? <img src={src} alt="返回的图片" loading="lazy" />
        : item.mediaType === 'video' ? <video src={src} aria-label="返回的视频" preload="metadata" muted playsInline />
        : <span className="workspace-assistant-audio-preview"><Music size={16} aria-hidden="true" /><small>音频</small></span>}</span>;
    })}
    {media.length > 3 && <small>+{media.length - 3}</small>}
  </span> : undefined;
  const restore = async () => {
    if (!snapshot || !data || useUnifiedProjectStore.getState().activeId !== data.projectId) return;
    if (!window.confirm('回到这条消息的项目快照？后续项目改动将回退。')) return;
    try {
      let result = await useUnifiedProjectStore.getState().restoreProjectSnapshot(snapshot.id);
      if (result.status === 'confirmation-required' && window.confirm(result.reason ?? '仍有生成任务。回退不会撤销供应商任务，继续？')) {
        if (useUnifiedProjectStore.getState().activeId !== data.projectId) return;
        result = await useUnifiedProjectStore.getState().restoreProjectSnapshot(snapshot.id, true);
      }
      setNotice(result.status === 'restored' ? '项目已恢复到此快照' : result.reason ?? '未恢复');
    } catch { setNotice('快照恢复未完成，请核对项目状态'); }
  };
  const openMedia = (mediaId: string) => {
    const current = useWorkshopStore.getState().data;
    if (!current || current.projectId !== data?.projectId || useUnifiedProjectStore.getState().activeId !== current.projectId) return;
    const item = current.projectObjects?.media.find((entry) => entry.id === mediaId && !entry.archived);
    if (!item || !['image', 'video', 'audio'].includes(item.mediaType)) { setNotice('此媒体已不可用'); return; }
    const version = current.projectObjects?.versions.find((entry) => entry.mediaObjectId === item.id && !entry.archived);
    const detail: WorkspaceAssistantInspectDetail = { version: 1, source: 'assistant', projectId: current.projectId,
      messageId: message.id, objectId: item.ownerObjectId ?? item.id, mediaId: item.id, versionId: version?.id,
      outputType: item.mediaType as WorkspaceAssistantInspectDetail['outputType'] };
    // Parent owns the single Inspector. This event does not create another preview or mutate selection.
    const handled = !window.dispatchEvent(new CustomEvent(WORKSPACE_ASSISTANT_INSPECT_EVENT, { detail, cancelable: true }));
    if (!handled) setNotice('预览入口尚未接入，请从项目媒体列表打开');
  };
  return <article className="workspace-assistant-message" data-tone={tone}>
    {message.content && <div className="workspace-assistant-prose"><MarkdownRenderer content={message.content} tone={tone} /></div>}
    {runId && <RunStepTimeline runId={runId} compact embedded tone={tone} preview={mediaPreview} />}
    {media.length > 0 && <details className="workspace-assistant-results" aria-label="本次返回的媒体">
      <summary><span>产物</span><small>{media.length}</small><ChevronDown size={13} />{mediaPreview}</summary>
      <div className="workspace-assistant-result-grid">{media.map((item) => {
        const version = data?.projectObjects?.versions.find((entry) => entry.mediaObjectId === item.id);
        const owner = data?.projectObjects?.objects.find((entry) => entry.id === item.ownerObjectId);
        const label = owner?.label ?? item.label ?? '项目素材';
        const Icon = item.mediaType === 'video' ? Video : item.mediaType === 'audio' ? Music : ImageIcon;
        const src = /^(https?:|data:|blob:|asset:)/i.test(item.path) ? item.path : convertFileSrc(item.path);
        return <button type="button" className="workspace-assistant-result" key={item.id} onClick={() => openMedia(item.id)} title={`打开${label}`}>
          <div className="workspace-assistant-result-preview">{item.mediaType === 'image' ? <img src={src} alt={label} loading="lazy" />
            : item.mediaType === 'video' ? <video src={src} preload="metadata" muted playsInline onLoadedMetadata={(event) => {
              const el = event.currentTarget.parentElement?.querySelector('[data-duration]');
              if (el && Number.isFinite(event.currentTarget.duration)) el.textContent = `${Math.round(event.currentTarget.duration)}秒`;
            }} /> : <Icon size={24} />}<span data-duration="true" />
            <ExternalLink size={12} className="workspace-assistant-open-icon" /></div>
          <strong>{label}</strong><span><Icon size={12} />{version ? `v${version.ordinal}` : '版本未记录'} · {item.purpose === 'candidate-version' ? '候选' : item.purpose === 'unclassified' ? '未归类' : '项目媒体'}</span>
        </button>;
      })}</div>
    </details>}
    {boundChanges.length > 0 && <p className="workspace-assistant-change-summary">本次调整：{new Set(boundChanges.map((entry) => entry.objectId)).size} 个对象，{boundChanges.reduce((sum, entry) => sum + entry.changes.length, 0)} 个字段</p>}
    {promptChanges.length > 0 && <p className="workspace-assistant-change-summary">已更新 {new Set(promptChanges.map((entry) => entry.objectId)).size} 个对象的提示词</p>}
    {(snapshot || boundChanges.length > 0 || promptChanges.length > 0 || message.thinkingContent || message.workingContent) && <details className="workspace-assistant-message-menu">
      <summary title="消息菜单" aria-label="消息菜单"><MoreHorizontal size={16} /></summary>
      {snapshot && <button type="button" onClick={() => void restore()}>回到此项目快照</button>}
      {boundChanges.length > 0 && <button type="button" onClick={() => setDetailsOpen(!detailsOpen)}>查看本次字段改动</button>}
      {promptChanges.length > 0 && <details><summary>提示词改动回执</summary>{promptChanges.map((change) => <p key={`${change.objectId}:${change.outputType}`}>
        {data?.projectObjects?.objects.find((entry) => entry.id === change.objectId)?.label ?? '项目对象'} · {change.outputType === 'video' ? '视频' : '图片'}提示词 · 修订 {change.revision}
      </p>)}</details>}
      {(message.thinkingContent || message.workingContent) && <details onToggle={(event) => setThinkingOpen(event.currentTarget.open)}><summary>执行记录</summary>{thinkingOpen && <pre>{message.thinkingContent ?? message.workingContent}</pre>}</details>}
    </details>}
    {detailsOpen && boundChanges.map((change) => <details key={change.id}><summary>{data?.projectObjects?.objects.find((entry) => entry.id === change.objectId)?.label ?? '项目对象'}</summary>
      {change.changes.map((field, index) => <div key={index}><strong>{assistantFieldLabel(field.field)}</strong><pre>{JSON.stringify(field.before)} → {JSON.stringify(field.after)}</pre></div>)}
      <button type="button" onClick={() => { if (useUnifiedProjectStore.getState().activeId === data?.projectId) useUnifiedProjectStore.getState().undoProjectChange(change.id); }}>撤销此改动</button>
    </details>)}
    {notice && <p role="status">{notice}</p>}
  </article>;
}
