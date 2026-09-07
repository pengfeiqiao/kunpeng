import { useEffect, useMemo, useState } from 'react';
import { useWorkshopStore } from '../../stores/workshopStore';
import { listProjectFiles } from '../../lib/aigc/projectStore';
import type { WorkspaceDocumentsProps } from '../../components/workspace/WorkspaceDocuments';
import { createWorkshopDocumentsPort } from './documentsStoreAdapter';

/** Ready-to-spread props. Returns null while project identity is mismatched or not hydrated. */
export function useWorkspaceDocuments(projectId: string): WorkspaceDocumentsProps | null {
  const project = useWorkshopStore((state) => state.project);
  const dataProjectId = useWorkshopStore((state) => state.data?.projectId);
  const specRevision = useWorkshopStore((state) => state.data?.projectSpec?.revision);
  const port = useMemo(() => createWorkshopDocumentsPort(), []);
  const [revision, setRevision] = useState(0);
  const [documents, setDocuments] = useState<string[]>([]);
  const ready = project?.id === projectId && dataProjectId === projectId;

  useEffect(() => { setRevision((value) => value + 1); }, [projectId, project?.sources, specRevision]);
  useEffect(() => {
    let cancelled = false;
    if (ready) void listProjectFiles(projectId, 'docs').then((files) => {
      if (!cancelled) setDocuments(files.filter((name) => /\.(md|txt)$/i.test(name)).sort());
    });
    return () => { cancelled = true; };
  }, [ready, projectId, revision]);

  if (!ready || !project) return null;
  return { projectId, sources: project.sources, documents, port, revision };
}
