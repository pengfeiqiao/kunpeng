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

export async function writeStyleProfile(profile: StyleProfile): Promise<void> {
  try {
    await ensureDirs();
    const tmp = `${PROFILE_PATH}.tmp`;
    await writeTextFile({ path: tmp, contents: JSON.stringify(profile, null, 2) }, opts);
    await renameFile(tmp, PROFILE_PATH, opts);
  } catch (err) {
    console.warn('[copywriting] writeStyleProfile failed:', err);
  }
}

export async function readExperienceLog(): Promise<WritingExperience[]> {
  try {
    if (!(await exists(LOG_PATH, opts))) return [];
    const raw = await readTextFile(LOG_PATH, opts);
    return raw.trim().split('\n').map(line => safeParse<WritingExperience>(line)).filter(Boolean) as WritingExperience[];
  } catch (err) {
    console.warn('[copywriting] readExperienceLog failed:', err);
    return [];
  }
}

export async function appendExperienceLog(exp: WritingExperience): Promise<void> {
  try {
    await ensureDirs();
    const path = LOG_PATH;
    let existing = '';
    if (await exists(path, opts)) {
      existing = await readTextFile(path, opts);
    }
    const newContent = existing ? `${existing}\n${JSON.stringify(exp)}` : JSON.stringify(exp);
    await writeTextFile({ path, contents: newContent }, opts);
  } catch (err) {
    console.warn('[copywriting] appendExperienceLog failed:', err);
  }
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
