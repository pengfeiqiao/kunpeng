import { useWorkshopStore } from '../../stores/workshopStore';
import { useEditorStore } from '../../stores/editorStore';
import { getEditorHydrationState } from '../editor/editorPersist';
import type { WorkspaceTimelineSourceProps } from '../../components/workspace/WorkspaceTimelineSource';
import type { TimelineSourceClipKind } from './timelineSource';

/** Live read port for Inspector event handlers. Does not load files, hydrate, mutate or copy clips. */
export function readWorkspaceTimelineSourceContext(projectId: string, clipKind: TimelineSourceClipKind,
  clipId: string): WorkspaceTimelineSourceProps | null {
  const { data, project } = useWorkshopStore.getState();
  const hydration = getEditorHydrationState();
  if (!data || project?.id !== projectId || data.projectId !== projectId || hydration.status !== 'ready'
    || hydration.projectId !== projectId || hydration.activeProjectId !== projectId) return null;
  const state = useEditorStore.getState();
  const collection = clipKind === 'main' ? state.clips : clipKind === 'overlay' ? state.overlayClips : clipKind === 'audio' ? state.audioClips : [];
  const clip = collection.find((item) => item.id === clipId);
  return clip ? { data, editorProjectId: projectId, clip, clipKind } : null;
}

/** React projection of the selected original clip; only relevant arrays/selection trigger updates. */
export function useWorkspaceTimelineSource(projectId: string): WorkspaceTimelineSourceProps | null {
  useWorkshopStore((state) => state.data);
  useWorkshopStore((state) => state.project?.id);
  useEditorStore((state) => state.clips);
  useEditorStore((state) => state.overlayClips);
  useEditorStore((state) => state.audioClips);
  const main = useEditorStore((state) => state.selectedClipId);
  const overlay = useEditorStore((state) => state.selectedOverlayId);
  const audio = useEditorStore((state) => state.selectedAudioClipId);
  const kind = main ? 'main' : overlay ? 'overlay' : 'audio';
  const id = main ?? overlay ?? audio;
  return id ? readWorkspaceTimelineSourceContext(projectId, kind, id) : null;
}
