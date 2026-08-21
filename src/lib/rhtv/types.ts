/**
 * rhtv types — RunningHub Standard Model API (openapi/v2).
 *
 * Submit:  POST {BASE}/{endpoint}            body: { prompt, ...params }
 * Query:   POST {BASE}/query                 body: { taskId }
 * Upload:  POST {BASE}/media/upload/binary   multipart file → download_url
 * Auth:    Authorization: Bearer <apiKey>
 *
 * Status values (from runninghub.py, verified): SUCCESS | FAILED | otherwise
 * still running (QUEUED/RUNNING etc — treated uniformly as "in progress").
 */

export interface RhtvSubmitResponse {
  taskId?: string;
  status?: string;
  results?: RhtvResultItem[];
  errorMessage?: string;
  errorCode?: string | number;
  data?: {
    taskId?: string;
    taskStatus?: string;
    results?: RhtvResultItem[];
    [key: string]: unknown;
  };
  // Error body shapes vary; keep raw fields accessible
  code?: string | number;
  msg?: string;
}

export interface RhtvResultItem {
  url?: string;
  outputUrl?: string;
  outputType?: string;
  text?: string;
}

export interface RhtvQueryResponse {
  taskId?: string;
  status?: string; // SUCCESS | FAILED | QUEUED | RUNNING | ...
  results?: RhtvResultItem[];
  errorMessage?: string;
  errorCode?: string | number;
  failedReason?: unknown;
  data?: {
    taskId?: string;
    taskStatus?: string;
    status?: string;
    results?: RhtvResultItem[];
    errorMessage?: string;
    errorCode?: string | number;
    failedReason?: unknown;
    [key: string]: unknown;
  };
}

export interface RhtvTaskResult {
  taskId: string;
  /** Remote URLs of all outputs (MJ returns 4). */
  urls: string[];
  /** Text outputs, if the endpoint produces text. */
  texts: string[];
}

/**
 * Business error — the task itself was rejected (NSFW, insufficient balance,
 * invalid params). NOT retryable; surfaces to the user / triggers fallback.
 */
export class RhtvBusinessError extends Error {
  readonly kind: 'auth' | 'balance' | 'task_failed' | 'bad_request';
  constructor(kind: RhtvBusinessError['kind'], message: string) {
    super(message);
    this.name = 'RhtvBusinessError';
    this.kind = kind;
  }
}

/**
 * Terminal rejection: the remote task can never produce output and — crucially
 * for balance/auth failures — was never charged. Callers must treat these as
 * "provider failed", NOT as "a paid task exists", so channel/engine fallback
 * stays allowed. A 'bad_request' keeps the old conservative semantics: the
 * request may have been malformed, but a same-provider retry tells us more
 * than a blind channel switch.
 */
export function isTerminalRhtvRejection(error: unknown): boolean {
  return error instanceof RhtvBusinessError
    && (error.kind === 'task_failed' || error.kind === 'balance' || error.kind === 'auth');
}

/** The create-task response was lost; replaying could create a second paid task. */
export class RhtvSubmissionUnknownError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RhtvSubmissionUnknownError';
  }
}

/** Parameter value bag for an endpoint call. */
export type RhtvParams = Record<string, string | number | boolean | string[]>;

export interface RhtvEngineParamDef {
  key: string;
  label: string;
  type: 'string' | 'int' | 'boolean' | 'list';
  options?: string[];
  default?: string | number | boolean;
  required?: boolean;
}

/** Maps an engine parameter to an AI-application node field. */
export interface RhtvNodeMapping {
  nodeId: string;
  fieldName: string;
  source: 'prompt' | 'image' | 'video' | 'audio' | 'param';
  /** When source='param', the key in RhtvCanvasEngine.params / fixedParams. */
  paramKey?: string;
}

/** AI-application wrapper config — overseas engines use this instead of the
 *  standard model endpoint after the compliance migration. */
export interface RhtvAppConfig {
  webappId: string;
  nodes: RhtvNodeMapping[];
}

/** A curated canvas engine entry (static mapping, see canvasEngines.ts). */
export interface RhtvCanvasEngine {
  id: string;
  label: string;
  endpoint: string;
  kind: 'image' | 'video' | 'audio';
  mode: 'text-to-image' | 'image-to-image' | 'text-to-video' | 'multimodal-video' | 'start-end-video';
  /** Param key that receives reference image URL(s); false = unsupported. */
  imageParam?: { key: string; multiple: boolean };
  /** Param key that receives reference audio URL(s) (Seedance multimodal). */
  audioParam?: { key: string; multiple: boolean };
  /** Param key that receives reference video URL(s) (Seedance multimodal). */
  videoParam?: { key: string; multiple: boolean };
  /** Params always sent with fixed values (e.g. MJ's full-param requirement). */
  fixedParams?: RhtvParams;
  /** User-tunable params rendered in NodeInfoBar. */
  params: RhtvEngineParamDef[];
  /** AI-application wrapper — when set, submit goes through the AI-app API
   *  instead of the standard model endpoint (compliance migration). */
  appConfig?: RhtvAppConfig;
}
