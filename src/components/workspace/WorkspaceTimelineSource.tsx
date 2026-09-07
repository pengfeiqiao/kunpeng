import { ArrowUpRight, Link2 } from 'lucide-react';
import type { WorkshopData } from '../../lib/workshop/types';
import { dispatchTimelineInspectorRequest, resolveTimelineSource, timelineInspectorRequest,
  type TimelineSourceClip, type TimelineSourceClipKind, type WorkspaceInspectorRequest } from '../../lib/workspace/timelineSource';
import './workspaceDocuments.css';

export interface WorkspaceTimelineSourceProps {
  data: WorkshopData;
  /** Must be the hydrated editor project, not merely the workspace's requested project. */
  editorProjectId: string | null;
  clip: TimelineSourceClip;
  clipKind?: TimelineSourceClipKind;
  onRequestInspector?: (request: WorkspaceInspectorRequest) => void;
}

export default function WorkspaceTimelineSource({ data, editorProjectId, clip, clipKind = 'main', onRequestInspector }: WorkspaceTimelineSourceProps) {
  const source = resolveTimelineSource(data, editorProjectId, clip);
  return <section className="workspace-timeline-source" aria-label="剪辑来源">
    <div className="workspace-timeline-source-heading"><Link2 size={15} /><strong>素材来源</strong></div>
    {source.status !== 'resolved' ? <p role="status">{source.reason}</p> : <>
      <div className="workspace-timeline-source-row"><span>{source.label}</span><span>{source.ordinal == null ? '版本未记录' : `v${source.ordinal}`}</span>
        <span>{source.adopted ? '当前采用' : '片段保留所用素材'}</span></div>
      <p className="workspace-document-location">{source.path}</p>
      <button type="button" onClick={() => {
        const latest = resolveTimelineSource(data, editorProjectId, clip);
        if (latest.status !== 'resolved') return;
        const request = timelineInspectorRequest(latest, clip, clipKind);
        if (onRequestInspector) onRequestInspector(request); else dispatchTimelineInspectorRequest(request);
      }}><ArrowUpRight size={15} />{source.locked ? '查看来源素材' : '去修改素材'}</button>
    </>}
  </section>;
}
