export interface CopyDoc {
  id: string;
  title: string;
  content: string;
  comments?: CopyComment[];
  contentRevision?: number;
  createdAt: number;
  updatedAt: number;
  larkUrl?: string;
}

export type CopyCommentStatus = 'open' | 'resolved';

export interface CopyComment {
  id: string;
  body: string;
  quote: string;
  start: number;
  end: number;
  prefix: string;
  suffix: string;
  status: CopyCommentStatus;
  orphaned?: boolean;
  createdAt: number;
  updatedAt: number;
  resolvedAt?: number;
  resolutionNote?: string;
  sourceRevision?: number;
}

export interface WritingExperience {
  schemaVersion?: number;
  sourceSessionId?: string;
  sourceRunId?: string;
  sourceRevision?: number;
  genres?: string[];
  styles?: string[];
  lessons?: WritingLesson[];
  disabled?: boolean;
  id: string;
  timestamp: number;
  docId: string;
  docTitle: string;
  styleNotes: string[];
  vocabularyHits: string[];
  tonePreference: string;
  structurePattern: string;
  whatWorked: string;
  whatToImprove: string;
}

export interface StyleProfile {
  version: number;
  lastUpdated: number;
  coreStyle: string;
  toneSpectrum: Record<string, number>;
  favoritePatterns: string[];
  vocabulary: { word: string; freq: number }[];
  avoidPatterns: string[];
  totalSessions: number;
}

export interface WritingLesson {
  dimension: string;
  situation: string;
  guidance: string;
  avoid: string;
  evidence: string;
  basis: 'user_feedback' | 'revision' | 'reflection';
  before: string;
  after: string;
}
