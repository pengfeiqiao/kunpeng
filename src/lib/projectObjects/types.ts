/**
 * Stable project-object vocabulary shared by workshop, canvas, editor and chat.
 *
 * The legacy workshop arrays remain the persisted editing surface during the
 * migration. This registry supplies identity, provenance, relations and media
 * version semantics without duplicating binary media or deleting old fields.
 */

export const PROJECT_OBJECT_SCHEMA_VERSION = 1;

export type ProjectObjectKind =
  | 'project-spec'
  | 'script'
  | 'scene'
  | 'shot'
  | 'character'
  | 'scene-asset'
  | 'prop'
  | 'director-constraint'
  | 'media-file'
  | 'asset-version'
  | 'generation-task'
  | 'timeline-clip'
  | 'project-skill';

export type ProjectObjectSource =
  | 'workshop'
  | 'canvas'
  | 'editor'
  | 'chat'
  | 'generated'
  | 'uploaded'
  | 'imported'
  | 'legacy-storyboard'
  | 'system';

export type MediaPurpose =
  | 'current-version'
  | 'candidate-version'
  | 'ordinary-material'
  | 'generation-reference'
  | 'final-output'
  | 'unclassified'
  | 'historical';

export type GenerationConfirmationPreference =
  | 'always-confirm'
  | 'paid-only-confirm'
  | 'direct-execute';

export interface ProjectSpec {
  aspectRatio?: string;
  language?: string;
  targetDurationSec?: number;
  styleTone?: string;
  worldAndCharacters?: string;
  continuityFacts?: string[];
  forbidden?: string[];
  defaultImageModel?: string;
  defaultVideoModel?: string;
  delivery?: string;
  generationConfirmation: GenerationConfirmationPreference;
  updatedAt: number;
  revision: number;
}

export interface ProjectObjectRecord {
  id: string;
  projectId: string;
  kind: ProjectObjectKind;
  source: ProjectObjectSource;
  sourceId?: string;
  label?: string;
  relationIds: string[];
  version: number;
  updatedAt: number;
  locked?: boolean;
  archived?: boolean;
}

export interface MediaFileRecord extends ProjectObjectRecord {
  kind: 'media-file';
  path: string;
  mediaType: 'image' | 'video' | 'audio' | 'document' | 'unknown';
  purpose: MediaPurpose;
  ownerObjectId?: string;
  versionObjectId?: string;
  /** Canvas provenance without making the canvas node the source of truth. */
  canvasNodeId?: string;
  /** Generation task that produced this immutable media file. */
  generationTaskId?: string;
  /** @deprecated Legacy read compatibility only. References belong to a target draft/edge. */
  includeAsReference?: boolean;
}

export interface AssetVersionRecord extends ProjectObjectRecord {
  kind: 'asset-version';
  ownerObjectId: string;
  mediaObjectId: string;
  ordinal: number;
  selected: boolean;
  prompt?: string;
  engineId?: string;
  /** Immutable submitted settings, never replaced with the current editor draft. */
  generationSnapshot?: import('../workspace/types.ts').WorkspaceDraft;
}

export interface UnifiedProjectRegistry {
  schemaVersion: typeof PROJECT_OBJECT_SCHEMA_VERSION;
  projectId: string;
  objects: ProjectObjectRecord[];
  media: MediaFileRecord[];
  versions: AssetVersionRecord[];
  migratedLegacyStoryboardAt?: number;
  updatedAt: number;
}

export interface WorkspaceLayoutWidths {
  content: number;
  assistant: number;
}

export interface ProjectViewState {
  workspaceLayoutWidths?: WorkspaceLayoutWidths;
  workspaceSurface?: 'media' | 'editor' | 'documents';
  workspaceHiddenObjectIds?: string[];
  workspaceMediaId?: string;
  workspaceObjectId?: string;
  workspaceOutputType?: 'image' | 'video' | 'audio';
  workspaceComposerOpen?: boolean;
  workspaceMediaView?: 'list' | 'canvas';
  workspaceCanvasInspectorOpen?: boolean;
  /** 新建项目一次性标记：工作台首次打开时进入"创作与拆解剧本"，消费后清除。 */
  workspaceScriptToolsOpen?: boolean;
  selectedShotId?: string;
  selectedObjectIds?: string[];
  conversationReferences?: ProjectConversationReference[];
  activeConversationId?: string;
  agentDrawerState?: 'expanded' | 'collapsed' | 'hidden';
  activeView?: 'chat' | 'workshop' | 'canvas' | 'editor';
  /** Preferred shot overview density. Editing continues to use the table view. */
  shotDisplayMode?: 'table' | 'cards';
}

export interface ProjectCanvasSnapshot {
  nodes: unknown[];
  edges: unknown[];
}

/** Lightweight message-bound checkpoint; media stays referenced by path. */
export interface ProjectSnapshotRecord {
  id: string;
  label: string;
  createdAt: number;
  messageId?: string;
  workshopPayload: string;
  canvasPayload: string;
  mediaPaths: string[];
  pendingTaskIds: string[];
  changedObjectIds?: string[];
}

/** Named line of work created from a checkpoint without copying media. */
export interface ProjectBranchRecord {
  id: string;
  name: string;
  createdAt: number;
  sourceSnapshotId: string;
  workshopPayload: string;
  canvasPayload: string;
  mediaPaths: string[];
}

export type ProjectConversationReferenceScope = 'read' | 'edit' | 'generate';

/** Lightweight project-object pointer handed to the Agent. */
export interface ProjectConversationReference {
  id: string;
  objectId: string;
  kind: ProjectObjectKind | 'canvas-node' | 'editor-clip' | 'text-selection';
  sourceView: NonNullable<ProjectViewState['activeView']>;
  sourceId?: string;
  label: string;
  ownerLabel?: string;
  version?: number;
  operationScope: ProjectConversationReferenceScope;
  thumbnailPath?: string;
  quotedText?: string;
  addedAt: number;
}

export function defaultProjectSpec(now = Date.now()): ProjectSpec {
  return {
    generationConfirmation: 'paid-only-confirm',
    continuityFacts: [],
    forbidden: [],
    updatedAt: now,
    revision: 1,
  };
}
