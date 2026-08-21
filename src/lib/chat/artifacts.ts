import { homeDir } from '@tauri-apps/api/path';
import type { Message } from '@/types';

export type ChatArtifactKind =
  | 'image'
  | 'video'
  | 'audio'
  | 'code'
  | 'document'
  | 'archive'
  | 'folder'
  | 'link'
  | 'other';

export type ChatArtifactOrigin = 'output' | 'input' | 'source';

export interface ChatArtifact {
  id: string;
  uri: string;
  name: string;
  kind: ChatArtifactKind;
  origin: ChatArtifactOrigin;
  messageId?: string;
  embedded?: boolean;
  toolName?: string;
  addedLines?: number;
  deletedLines?: number;
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'heif', 'svg']);
const VIDEO_EXTENSIONS = new Set(['mp4', 'mov', 'm4v', 'webm', 'avi', 'mkv']);
const AUDIO_EXTENSIONS = new Set(['mp3', 'wav', 'm4a', 'aac', 'flac', 'ogg', 'opus']);
const CODE_EXTENSIONS = new Set([
  'ts', 'tsx', 'js', 'jsx', 'mjs', 'cjs', 'py', 'rs', 'go', 'java', 'kt', 'swift',
  'c', 'cc', 'cpp', 'h', 'hpp', 'cs', 'php', 'rb', 'vue', 'svelte', 'html', 'css',
  'scss', 'less', 'sql', 'sh', 'zsh', 'fish', 'yaml', 'yml', 'toml', 'json', 'xml',
]);
const DOCUMENT_EXTENSIONS = new Set(['md', 'txt', 'pdf', 'doc', 'docx', 'ppt', 'pptx', 'xls', 'xlsx', 'csv', 'rtf']);
const ARCHIVE_EXTENSIONS = new Set(['zip', 'rar', '7z', 'tar', 'gz', 'dmg']);
const FILE_EXTENSIONS = new Set([
  ...IMAGE_EXTENSIONS,
  ...VIDEO_EXTENSIONS,
  ...AUDIO_EXTENSIONS,
  ...CODE_EXTENSIONS,
  ...DOCUMENT_EXTENSIONS,
  ...ARCHIVE_EXTENSIONS,
]);

let cachedHomeDir = '';
let homeDirPromise: Promise<string> | null = null;

export async function ensureChatHomeDir(): Promise<string> {
  if (cachedHomeDir) return cachedHomeDir;
  if (!homeDirPromise) {
    homeDirPromise = homeDir()
      .then((value) => {
        cachedHomeDir = value.replace(/\/$/, '');
        return cachedHomeDir;
      })
      .catch(() => '');
  }
  return homeDirPromise;
}

export function expandChatPath(value: string): string {
  if (!cachedHomeDir) return value;
  if (value.startsWith('~/')) return `${cachedHomeDir}${value.slice(1)}`;
  if (value.startsWith('～/')) return `${cachedHomeDir}/${value.slice(2)}`;
  return value;
}

export function isRemoteUri(uri: string): boolean {
  return /^(?:https?:|data:|blob:)/i.test(uri);
}

function cleanUri(raw: string): string {
  let value = raw.trim();
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1);
  return value.replace(/[，。；、,;。!！?？）)】\]}>]+$/, '');
}

function extensionOf(uri: string): string {
  const clean = uri.split(/[?#]/, 1)[0];
  const name = clean.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function artifactKindFromUri(uri: string, directory = false): ChatArtifactKind {
  if (directory) return 'folder';
  const ext = extensionOf(uri);
  if (IMAGE_EXTENSIONS.has(ext)) return 'image';
  if (VIDEO_EXTENSIONS.has(ext)) return 'video';
  if (AUDIO_EXTENSIONS.has(ext)) return 'audio';
  if (CODE_EXTENSIONS.has(ext)) return 'code';
  if (DOCUMENT_EXTENSIONS.has(ext)) return 'document';
  if (ARCHIVE_EXTENSIONS.has(ext)) return 'archive';
  if (isRemoteUri(uri)) return 'link';
  return 'other';
}

export function artifactName(uri: string): string {
  const clean = uri.split(/[?#]/, 1)[0].replace(/\/$/, '');
  try {
    return decodeURIComponent(clean.split('/').pop() || clean);
  } catch {
    return clean.split('/').pop() || clean;
  }
}

function makeArtifact(
  uri: string,
  origin: ChatArtifactOrigin,
  messageId?: string,
  options?: { embedded?: boolean; directory?: boolean; toolName?: string; name?: string; addedLines?: number; deletedLines?: number },
): ChatArtifact | null {
  const cleaned = cleanUri(uri);
  if (!cleaned || cleaned === '/') return null;
  const kind = artifactKindFromUri(
    cleaned.startsWith('data:') && options?.name ? options.name : cleaned,
    options?.directory,
  );
  const artifactId = cleaned.startsWith('data:')
    ? `${origin}:${messageId ?? 'unknown'}:${options?.name ?? kind}:${cleaned.length}`
    : `${origin}:${messageId ?? 'unknown'}:${cleaned}`;
  return {
    id: artifactId,
    uri: cleaned,
    name: options?.name || artifactName(cleaned),
    kind,
    origin,
    messageId,
    embedded: options?.embedded,
    toolName: options?.toolName,
    addedLines: options?.addedLines,
    deletedLines: options?.deletedLines,
  };
}

function lineChangeStats(before: string, after: string): { addedLines: number; deletedLines: number } {
  const oldLines = before.replace(/\n$/, '').split('\n');
  const newLines = after.replace(/\n$/, '').split('\n');
  if (before === after) return { addedLines: 0, deletedLines: 0 };
  if (oldLines.length > 500 || newLines.length > 500) {
    return { addedLines: newLines.length, deletedLines: oldLines.length };
  }
  const previous = new Uint16Array(newLines.length + 1);
  const current = new Uint16Array(newLines.length + 1);
  for (let i = 1; i <= oldLines.length; i += 1) {
    for (let j = 1; j <= newLines.length; j += 1) {
      current[j] = oldLines[i - 1] === newLines[j - 1]
        ? previous[j - 1] + 1
        : Math.max(previous[j], current[j - 1]);
    }
    previous.set(current);
    current.fill(0);
  }
  const common = previous[newLines.length];
  return {
    addedLines: newLines.length - common,
    deletedLines: oldLines.length - common,
  };
}

function parseMarkdownTargets(content: string): Array<{ uri: string; name?: string; image: boolean }> {
  const targets: Array<{ uri: string; name?: string; image: boolean }> = [];
  const re = /(!?)\[([^\]]*)\]\((<[^>]+>|[^)\s]+(?:\s+['"][^'"]*['"])?)[)]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) {
    const target = match[3].replace(/\s+['"][^'"]*['"]$/, '');
    targets.push({ uri: cleanUri(target), name: match[2] || undefined, image: match[1] === '!' });
  }
  return targets;
}

function parseRawUris(content: string): string[] {
  const results: string[] = [];
  const seen = new Set<string>();
  const push = (value: string) => {
    const cleaned = cleanUri(value);
    if (!cleaned || seen.has(cleaned)) return;
    seen.add(cleaned);
    results.push(cleaned);
  };

  const localPattern = /((?:~|～)\/|\/(?:Users|tmp|private\/tmp)\/)[^\n\r`"'<>]*?\.([a-zA-Z0-9+_-]{1,10})(?=$|[\s\n\r`"'<>，。；、,;!！?？）)】\]])/g;
  let localMatch: RegExpExecArray | null;
  while ((localMatch = localPattern.exec(content)) !== null) {
    if (FILE_EXTENSIONS.has(localMatch[2].toLowerCase())) push(localMatch[0]);
  }

  const urlPattern = /https?:\/\/[^\s\n\r`"'<>）)】\]]+/g;
  let urlMatch: RegExpExecArray | null;
  while ((urlMatch = urlPattern.exec(content)) !== null) push(urlMatch[0]);
  return results;
}

function parseOutputFolders(content: string): string[] {
  const results: string[] = [];
  const re = /(?:输出目录|保存目录|output[\s_-]*(?:dir|directory))[：:\s]+((?:~|～)\/[^\n\r`"']+|\/(?:Users|tmp|private\/tmp)\/[^\n\r`"']+)/gi;
  let match: RegExpExecArray | null;
  while ((match = re.exec(content)) !== null) results.push(cleanUri(match[1]));
  return results;
}

export function artifactsFromContent(
  content: string,
  origin: ChatArtifactOrigin,
  messageId?: string,
): ChatArtifact[] {
  const artifacts: ChatArtifact[] = [];
  const markdownTargets = parseMarkdownTargets(content);
  const markdownUris = new Set(markdownTargets.map((item) => item.uri));

  for (const target of markdownTargets) {
    let artifact = makeArtifact(target.uri, origin, messageId, {
      embedded: target.image && artifactKindFromUri(target.uri) === 'image',
      name: target.name,
    });
    if (artifact && isRemoteUri(artifact.uri) && !['image', 'video', 'audio'].includes(artifact.kind) && origin === 'output') {
      artifact = { ...artifact, origin: 'source' };
    }
    if (artifact) artifacts.push(artifact);
  }
  for (const uri of parseRawUris(content)) {
    if (markdownUris.has(uri)) continue;
    let artifact = makeArtifact(uri, origin, messageId);
    if (artifact && isRemoteUri(artifact.uri) && !['image', 'video', 'audio'].includes(artifact.kind) && origin === 'output') {
      artifact = { ...artifact, origin: 'source' };
    }
    if (artifact) artifacts.push(artifact);
  }
  for (const uri of parseOutputFolders(content)) {
    const artifact = makeArtifact(uri, origin, messageId, { directory: true });
    if (artifact) artifacts.push(artifact);
  }
  return dedupeArtifacts(artifacts);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function collectArtifactCandidates(
  value: unknown,
  depth = 0,
  key = '',
): Array<{ key: string; value: string }> {
  if (depth > 3 || value == null) return [];
  if (typeof value === 'string') {
    if (!/(?:path|url|image|video|audio|file|folder|dir|output|result)/i.test(key)) return [];
    return [{ key, value }];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectArtifactCandidates(item, depth + 1, key));
  }
  const record = asRecord(value);
  if (!record) return [];
  return Object.entries(record).flatMap(([childKey, childValue]) => (
    collectArtifactCandidates(childValue, depth + 1, childKey)
  ));
}

function artifactsFromToolExecutions(message: Message): ChatArtifact[] {
  const executions = Array.isArray(message.metadata?.toolExecutions)
    ? message.metadata?.toolExecutions
    : [];
  const artifacts: ChatArtifact[] = [];

  for (const raw of executions) {
    const execution = asRecord(raw);
    if (!execution) continue;
    const toolName = typeof execution.toolName === 'string' ? execution.toolName : '';
    const params = asRecord(execution.params);
    const result = asRecord(execution.result);
    const readOnly = /^(?:read|grep|glob|web_fetch|web_search)/.test(toolName);
    const producesOutput = /(?:^write_file$|^edit_file$|generate|export|render|download|doubao_speech)/i.test(toolName);
    const editStats = toolName === 'edit_file'
      && typeof params?.old_string === 'string'
      && typeof params?.new_string === 'string'
      ? lineChangeStats(params.old_string, params.new_string)
      : undefined;

    for (const candidate of collectArtifactCandidates(params)) {
      const explicitOutput = /output|result|destination|target/i.test(candidate.key);
      const fileMutation = /^(?:write_file|edit_file)$/.test(toolName) && /path|file/i.test(candidate.key);
      const artifact = makeArtifact(
        candidate.value,
        explicitOutput || fileMutation ? 'output' : 'source',
        message.id,
        { toolName, ...editStats },
      );
      if (artifact) artifacts.push(artifact);
    }
    for (const candidate of collectArtifactCandidates(result)) {
      if (candidate.key === 'output') continue;
      const artifact = makeArtifact(candidate.value, producesOutput && !readOnly ? 'output' : 'source', message.id, { toolName });
      if (artifact) artifacts.push(artifact);
    }
    const output = typeof result?.output === 'string' ? result.output : '';
    if (output) {
      artifacts.push(...artifactsFromContent(output, producesOutput && !readOnly ? 'output' : 'source', message.id).map((item) => ({
        ...item,
        origin: producesOutput && !readOnly ? 'output' : item.origin,
        toolName,
      })));
    }
  }
  return artifacts;
}

export function artifactsFromMessage(message: Message): ChatArtifact[] {
  const origin: ChatArtifactOrigin = message.role === 'user' ? 'input' : 'output';
  const direct = (message.filePaths ?? [])
    .map((uri) => makeArtifact(uri, origin, message.id))
    .filter((item): item is ChatArtifact => Boolean(item));
  const inlineAttachments = (message.attachments ?? [])
    .map((attachment) => {
      const mime = attachment.type.includes('/') ? attachment.type : 'application/octet-stream';
      const uri = attachment.content.startsWith('data:')
        ? attachment.content
        : `data:${mime};base64,${attachment.content}`;
      return makeArtifact(uri, origin, message.id, { name: attachment.fileName });
    })
    .filter((item): item is ChatArtifact => Boolean(item));
  const content = message.role === 'assistant'
    ? artifactsFromContent(message.content, origin, message.id)
    : [];
  const tools = message.role === 'assistant' ? artifactsFromToolExecutions(message) : [];
  return dedupeArtifacts([...direct, ...inlineAttachments, ...content, ...tools]);
}

export function collectChatArtifacts(messages: Message[]): ChatArtifact[] {
  return dedupeArtifacts(messages.flatMap(artifactsFromMessage));
}

export function isPresentableOutputArtifact(artifact: ChatArtifact): boolean {
  return artifact.origin === 'output'
    && ['image', 'video', 'audio', 'code', 'document', 'archive'].includes(artifact.kind);
}

export function dedupeArtifacts(artifacts: ChatArtifact[]): ChatArtifact[] {
  const byUri = new Map<string, ChatArtifact>();
  for (const artifact of artifacts) {
    const key = artifact.uri.startsWith('data:') ? artifact.id : expandChatPath(artifact.uri);
    const previous = byUri.get(key);
    if (!previous || previous.origin === 'source' || previous.origin === 'input') {
      byUri.set(key, artifact);
    }
  }
  return [...byUri.values()];
}
