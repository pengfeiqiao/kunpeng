/**
 * videoThumbs — disk-cached video thumbnails.
 *
 * Every <video preload> element spins up a decoder; dozens of them froze the
 * artifact library. Instead we extract ONE jpeg per video via ffmpeg into
 * ~/.kunpeng/thumbs/ (keyed by path hash), then render plain <img>.
 * In-flight de-dup + concurrency cap keep first-time generation cheap.
 */
import { useEffect, useState } from 'react';
import { invoke, convertFileSrc } from '@tauri-apps/api/tauri';
import { exists, createDir } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { detectFfmpeg } from './videoCompose';

interface CommandResult { stdout: string; stderr: string; exit_code: number }
export interface VideoThumbResult { path: string; url: string }

const memCache = new Map<string, VideoThumbResult>(); // videoPath → thumb file path + asset url
const inflight = new Map<string, Promise<VideoThumbResult | null>>();
let queue: Promise<void> = Promise.resolve();

function hashPath(p: string): string {
  let h = 5381;
  for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

async function thumbsDir(): Promise<string> {
  const dir = `${await homeDir()}.kunpeng/thumbs`;
  await createDir(dir, { recursive: true }).catch(() => {});
  return dir;
}

/** Get (or lazily create) the thumbnail for a local video. Returns file path + asset URL. */
export async function ensureVideoThumb(videoPath: string): Promise<VideoThumbResult | null> {
  const cached = memCache.get(videoPath);
  if (cached) return cached;
  const existing = inflight.get(videoPath);
  if (existing) return existing;

  const task = (async (): Promise<VideoThumbResult | null> => {
    try {
      const dir = await thumbsDir();
      const thumbPath = `${dir}/${hashPath(videoPath)}.jpg`;
      if (await exists(thumbPath)) {
        const url = convertFileSrc(thumbPath);
        const result = { path: thumbPath, url };
        memCache.set(videoPath, result);
        return result;
      }
      const ffmpeg = await detectFfmpeg();
      if (!ffmpeg) return null;
      const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;
      // Serialize extraction (one ffmpeg at a time keeps the UI snappy)
      await (queue = queue.then(async () => {
        const r = await invoke<CommandResult>('execute_command', {
          command: `${ffmpeg} -ss 0.5 -i ${q(videoPath)} -frames:v 1 -vf "scale=320:-2" -q:v 4 ${q(thumbPath)} -y`,
          timeoutMs: 30000,
        });
        if (r.exit_code !== 0) throw new Error('thumb extraction failed');
      }));
      const url = convertFileSrc(thumbPath);
      const result = { path: thumbPath, url };
      memCache.set(videoPath, result);
      return result;
    } catch {
      return null;
    } finally {
      inflight.delete(videoPath);
    }
  })();

  inflight.set(videoPath, task);
  return task;
}

/** Get (or lazily create) the thumbnail for a local video. Returns asset URL. */
export async function getVideoThumb(videoPath: string): Promise<string | null> {
  return (await ensureVideoThumb(videoPath))?.url ?? null;
}

/** React hook: thumbnail asset URL for a local video path (null while loading/unavailable). */
export function useVideoThumb(videoPath: string | undefined): string | null {
  const [url, setUrl] = useState<string | null>(videoPath ? memCache.get(videoPath)?.url ?? null : null);
  useEffect(() => {
    if (!videoPath) { setUrl(null); return; }
    const hit = memCache.get(videoPath)?.url;
    if (hit) { setUrl(hit); return; }
    let alive = true;
    void getVideoThumb(videoPath).then((u) => { if (alive) setUrl(u); });
    return () => { alive = false; };
  }, [videoPath]);
  return url;
}

// ── Filmstrip: N frames per video for timeline clip backgrounds ──────────────
const stripCache = new Map<string, string[]>(); // `${path}#${count}` → urls
const stripInflight = new Map<string, Promise<string[] | null>>();

/** Extract N evenly spaced frames; returns asset URLs (cached on disk). */
export async function getVideoFilmstrip(videoPath: string, count = 6): Promise<string[] | null> {
  const key = `${videoPath}#${count}`;
  const hit = stripCache.get(key);
  if (hit) return hit;
  const existing = stripInflight.get(key);
  if (existing) return existing;

  const task = (async (): Promise<string[] | null> => {
    try {
      const dir = await thumbsDir();
      const base = `${dir}/${hashPath(videoPath)}-s${count}`;
      const first = `${base}-1.jpg`;
      const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;
      if (!(await exists(first))) {
        const ffmpeg = await detectFfmpeg();
        if (!ffmpeg) return null;
        const { probeDuration } = await import('./videoCompose');
        const duration = (await probeDuration(videoPath)) || 5;
        // fps = count/duration spreads N picks evenly across the file
        const fps = Math.max(0.05, count / duration);
        await (queue = queue.then(async () => {
          const r = await invoke<CommandResult>('execute_command', {
            command: `${ffmpeg} -i ${q(videoPath)} -vf "fps=${fps.toFixed(4)},scale=160:-2" -frames:v ${count} -q:v 5 ${q(`${base}-%d.jpg`)} -y`,
            timeoutMs: 60000,
          });
          if (r.exit_code !== 0) throw new Error('filmstrip failed');
        }));
      }
      const urls: string[] = [];
      for (let i = 1; i <= count; i++) {
        const p = `${base}-${i}.jpg`;
        if (await exists(p)) urls.push(convertFileSrc(p));
      }
      if (urls.length === 0) return null;
      stripCache.set(key, urls);
      return urls;
    } catch {
      return null;
    } finally {
      stripInflight.delete(key);
    }
  })();

  stripInflight.set(key, task);
  return task;
}

/** React hook: filmstrip frame URLs (null while loading/unavailable). */
export function useVideoFilmstrip(videoPath: string | undefined, count = 6): string[] | null {
  const [urls, setUrls] = useState<string[] | null>(
    videoPath ? stripCache.get(`${videoPath}#${count}`) ?? null : null,
  );
  useEffect(() => {
    if (!videoPath) { setUrls(null); return; }
    const hit = stripCache.get(`${videoPath}#${count}`);
    if (hit) { setUrls(hit); return; }
    let alive = true;
    void getVideoFilmstrip(videoPath, count).then((u) => { if (alive) setUrls(u); });
    return () => { alive = false; };
  }, [videoPath, count]);
  return urls;
}
