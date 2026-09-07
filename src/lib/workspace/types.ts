export type WorkspaceOutputType = 'image' | 'video' | 'audio';
export interface WorkspaceReference {
  id: string;
  type: WorkspaceOutputType;
  path: string;
  label: string;
  objectId?: string;
  versionId?: string;
  role?: 'director-constraint';
}
export interface WorkspaceDraft {
  id: string;
  projectId: string;
  objectId: string;
  outputType: WorkspaceOutputType;
  prompt: string;
  promptTemplate?: 'legacy' | 'universal';
  styleId?: string;
  styleName?: string;
  engineId: string;
  params: Record<string, string | number | boolean>;
  references: WorkspaceReference[];
  revision: number;
  updatedAt: number;
}
export interface WorkspaceSubmission {
  id: string;
  draft: WorkspaceDraft;
  createdAt: number;
  status: 'awaiting-confirmation' | 'submitting' | 'running' | 'succeeded' | 'failed' | 'uncertain' | 'cancelled';
  taskIds: string[];
  error?: string;
}

export interface WorkspaceTaskBinding {
  submissionId: string;
  snapshot: WorkspaceDraft;
}
