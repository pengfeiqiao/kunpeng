import {
  exists,
  createDir,
  readTextFile,
  writeTextFile,
  renameFile,
  BaseDirectory,
} from '@tauri-apps/api/fs';
import type { CopyDoc, WritingExperience, StyleProfile } from './types';

const BASE = '.kunpeng/copywriting';
const DOCS_DIR = `${BASE}/docs`;
const BACKUPS_DIR = `${BASE}/backups`;
const EXP_DIR = `${BASE}/experience`;
const INDEX_PATH = `${BASE}/docs-index.json`;
const INDEX_TMP = `${BASE}/docs-index.json.tmp`;
const PROFILE_PATH = `${EXP_DIR}/style-profile.json`;
const LOG_PATH = `${EXP_DIR}/writing-log.jsonl`;

const opts = { dir: BaseDirectory.Home };

function safeParse<T>(raw: string): T | null {
  try { return JSON.parse(raw); } catch { return null; }
}

async function ensureDirs() {
  await createDir(DOCS_DIR, { ...opts, recursive: true });
  await createDir(BACKUPS_DIR, { ...opts, recursive: true });
  await createDir(EXP_DIR, { ...opts, recursive: true });
}

// ─── Doc persistence ──────────────────────────────────────

export async function readDocsIndex(): Promise<CopyDoc[]> {
  try {
    if (!(await exists(INDEX_PATH, opts))) return [];
    const raw = await readTextFile(INDEX_PATH, opts);
    const parsed = safeParse<CopyDoc[]>(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.warn('[copywriting] readDocsIndex failed:', err);
    return [];
  }
}

export async function writeDocsIndex(docs: CopyDoc[]): Promise<void> {
  try {
    await ensureDirs();
    await writeTextFile({ path: INDEX_TMP, contents: JSON.stringify(docs, null, 2) }, opts);
    await renameFile(INDEX_TMP, INDEX_PATH, opts);
  } catch (err) {
    console.warn('[copywriting] writeDocsIndex failed:', err);
  }
}

export async function readDoc(id: string): Promise<CopyDoc | null> {
  try {
    const path = `${DOCS_DIR}/${id}.json`;
    if (!(await exists(path, opts))) return null;
    const raw = await readTextFile(path, opts);
    return safeParse<CopyDoc>(raw);
  } catch (err) {
    console.warn('[copywriting] readDoc failed:', err);
    return null;
  }
}

export async function writeDoc(doc: CopyDoc): Promise<void> {
  try {
    await ensureDirs();
    const path = `${DOCS_DIR}/${doc.id}.json`;
    const tmp = `${path}.tmp`;
    await writeTextFile({ path: tmp, contents: JSON.stringify(doc, null, 2) }, opts);
    await renameFile(tmp, path, opts);
  } catch (err) {
    console.warn('[copywriting] writeDoc failed:', err);
  }
}

// ─── Experience persistence ───────────────────────────────

export async function readStyleProfile(): Promise<StyleProfile | null> {
  try {
    if (!(await exists(PROFILE_PATH, opts))) return null;
    const raw = await readTextFile(PROFILE_PATH, opts);
    return safeParse<StyleProfile>(raw);
  } catch (err) {
    console.warn('[copywriting] readStyleProfile failed:', err);
    return null;
  }
}

// One ordered queue protects read-modify-write and profile publication from lost updates.
let experienceWrites: Promise<unknown> = Promise.resolve();
function serializeExperience<T>(operation: () => Promise<T>): Promise<T> {
  const next = experienceWrites.catch(() => {}).then(operation);
  experienceWrites = next;
  return next;
}
async function atomicExperienceWrite(path: string, contents: string) {
  await ensureDirs();
  const tmp = `${path}.tmp`;
  await writeTextFile({ path: tmp, contents }, opts);
  await renameFile(tmp, path, opts);
}
export function writeStyleProfile(profile: StyleProfile): Promise<void> {
  return serializeExperience(() => atomicExperienceWrite(PROFILE_PATH, JSON.stringify(profile, null, 2)));
}
export async function readExperienceLog(): Promise<WritingExperience[]> {
  if (!(await exists(LOG_PATH, opts))) return [];
  const raw = await readTextFile(LOG_PATH, opts);
  const str = (v: unknown) => typeof v === 'string' ? v : '';
  const strings = (v: unknown) => Array.isArray(v) ? v.filter(x => typeof x === 'string') : typeof v === 'string' ? [v] : [];
  return raw.split('\n').map(line => safeParse<WritingExperience>(line))
    .filter((e): e is WritingExperience => Boolean(e && typeof e.id === 'string' && typeof e.docId === 'string'))
    .map(e => ({ ...e, timestamp: Number.isFinite(e.timestamp) ? e.timestamp : 0,
      docTitle: str(e.docTitle), styleNotes: strings(e.styleNotes), vocabularyHits: strings(e.vocabularyHits),
      tonePreference: str(e.tonePreference), structurePattern: str(e.structurePattern),
      whatWorked: str(e.whatWorked), whatToImprove: str(e.whatToImprove), genres: strings(e.genres), styles: strings(e.styles),
      lessons: Array.isArray(e.lessons) ? e.lessons.filter(l => l && typeof l.guidance === 'string' && typeof l.situation === 'string')
        .slice(0, 6).map(l => ({ dimension: str(l.dimension), situation: l.situation, guidance: l.guidance,
          avoid: str(l.avoid), evidence: str(l.evidence), before: str(l.before), after: str(l.after),
          basis: l.basis === 'user_feedback' || l.basis === 'revision' ? l.basis : 'reflection' as const })) : [],
    }));
}
export function appendExperienceLog(exp: WritingExperience): Promise<void> {
  return serializeExperience(async () => {
    const entries = await readExperienceLog();
    if (entries.some(e => e.id === exp.id || (exp.sourceRunId && e.sourceRunId === exp.sourceRunId))) return;
    // Keep malformed legacy lines intact; do not rewrite history from parsed rows.
    const original = await exists(LOG_PATH, opts) ? await readTextFile(LOG_PATH, opts) : '';
    await atomicExperienceWrite(LOG_PATH, original.trimEnd() + (original.trim() ? '\n' : '') + JSON.stringify(exp) + '\n');
  });
}
export function replaceExperienceLog(entries: WritingExperience[]): Promise<void> {
  return serializeExperience(async () => {
    if (await exists(LOG_PATH, opts)) {
      const previous = await readTextFile(LOG_PATH, opts);
      await atomicExperienceWrite(`${EXP_DIR}/writing-log.backup-${Date.now()}.jsonl`, previous);
    }
    await atomicExperienceWrite(LOG_PATH, entries.map(e => JSON.stringify(e)).join('\n'));
  });
}

// ─── Backup ──────────────────────────────────────────────

export async function backupDoc(doc: CopyDoc): Promise<void> {
  try {
    await ensureDirs();
    const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    const safeName = (doc.title || '未命名').replace(/[/\\?%*:|"<>]/g, '_').slice(0, 50);
    const filename = `${safeName}_${ts}.md`;
    const header = `<!-- 备份自文档「${doc.title}」(id: ${doc.id}) -->\n<!-- 时间: ${new Date().toLocaleString('zh-CN')} -->\n\n`;
    await writeTextFile({ path: `${BACKUPS_DIR}/${filename}`, contents: header + doc.content }, opts);
  } catch (err) {
    console.warn('[copywriting] backupDoc failed:', err);
  }
}
