/**
 * waveform — 音频波形峰值提取（剪映同款音频块波形视觉）。
 *
 * ffmpeg 解码为 8kHz 单声道 s16le 原始 PCM → JS 聚合峰值（每秒 PER_SEC 桶）
 * → 缓存 ~/.kunpeng/waveforms/{hash}.json。视频/音频文件通吃（取音轨）。
 */
import { invoke } from '@tauri-apps/api/tauri';
import { readBinaryFile, readTextFile, writeTextFile, createDir, exists, removeFile, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { detectFfmpeg } from '@/lib/canvas/videoCompose';

interface CommandResult { stdout: string; stderr: string; exit_code: number }

const SAMPLE_RATE = 8000;
/** 每秒峰值桶数（时间轴 1 桶 ≈ 20ms，缩放绘制再聚合） */
export const PEAKS_PER_SEC = 50;

function hashPath(p: string): string {
  let h = 5381;
  for (let i = 0; i < p.length; i++) h = ((h << 5) + h + p.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

const memCache = new Map<string, number[]>();
const inflight = new Map<string, Promise<number[] | null>>();

/** 解码媒体音轨为 s16le PCM（8kHz mono），返回临时文件绝对路径；无音轨返回 null */
export async function extractPcm(mediaPath: string): Promise<string | null> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) return null;
  const home = await homeDir();
  const rel = `.kunpeng/waveforms/.pcm-${hashPath(mediaPath)}.raw`;
  await createDir('.kunpeng/waveforms', { dir: BaseDirectory.Home, recursive: true }).catch(() => {});
  const abs = `${home}${rel}`;
  const r = await invoke<CommandResult>('execute_command', {
    command: `${ffmpeg} -y -i "${mediaPath}" -vn -ac 1 -ar ${SAMPLE_RATE} -f s16le "${abs}"`,
    timeoutMs: 120000,
  }).catch(() => ({ stdout: '', stderr: '', exit_code: 1 } as CommandResult));
  if (r.exit_code !== 0) return null;
  return abs;
}

/** PCM 文件 → 峰值数组（0..1，PEAKS_PER_SEC 桶/秒） */
export async function pcmToPeaks(pcmAbsPath: string): Promise<number[]> {
  const home = await homeDir();
  const rel = pcmAbsPath.startsWith(home) ? pcmAbsPath.slice(home.length) : pcmAbsPath;
  const bytes = await readBinaryFile(rel, { dir: BaseDirectory.Home });
  const samples = new Int16Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 2));
  const perBucket = Math.floor(SAMPLE_RATE / PEAKS_PER_SEC);
  const peaks: number[] = [];
  for (let i = 0; i < samples.length; i += perBucket) {
    let max = 0;
    const end = Math.min(i + perBucket, samples.length);
    for (let j = i; j < end; j++) {
      const v = Math.abs(samples[j]);
      if (v > max) max = v;
    }
    peaks.push(Number((max / 32768).toFixed(3)));
  }
  return peaks;
}

/** 获取媒体波形峰值（内存 + 磁盘缓存） */
export async function getWaveform(mediaPath: string): Promise<number[] | null> {
  const hit = memCache.get(mediaPath);
  if (hit) return hit;
  const existing = inflight.get(mediaPath);
  if (existing) return existing;

  const task = (async (): Promise<number[] | null> => {
    try {
      const cacheRel = `.kunpeng/waveforms/${hashPath(mediaPath)}.json`;
      if (await exists(cacheRel, { dir: BaseDirectory.Home })) {
        const peaks = JSON.parse(await readTextFile(cacheRel, { dir: BaseDirectory.Home })) as number[];
        memCache.set(mediaPath, peaks);
        return peaks;
      }
      const pcm = await extractPcm(mediaPath);
      if (!pcm) return null;
      const peaks = await pcmToPeaks(pcm);
      const home = await homeDir();
      await removeFile(pcm.slice(home.length), { dir: BaseDirectory.Home }).catch(() => {});
      await writeTextFile(cacheRel, JSON.stringify(peaks), { dir: BaseDirectory.Home });
      memCache.set(mediaPath, peaks);
      return peaks;
    } catch {
      return null;
    } finally {
      inflight.delete(mediaPath);
    }
  })();

  inflight.set(mediaPath, task);
  return task;
}

/** canvas 绘制波形（音频块背景用） */
export function drawWaveform(
  canvas: HTMLCanvasElement, peaks: number[],
  fromSec: number, toSec: number, color = 'rgba(255,255,255,0.45)',
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const { width, height } = canvas;
  ctx.clearRect(0, 0, width, height);
  ctx.fillStyle = color;
  const i0 = Math.floor(fromSec * PEAKS_PER_SEC);
  const i1 = Math.max(i0 + 1, Math.ceil(toSec * PEAKS_PER_SEC));
  const n = i1 - i0;
  const mid = height / 2;
  for (let x = 0; x < width; x++) {
    const idx = i0 + Math.floor((x / width) * n);
    const v = peaks[idx] ?? 0;
    const h = Math.max(1, v * height * 0.92);
    ctx.fillRect(x, mid - h / 2, 1, h);
  }
}
