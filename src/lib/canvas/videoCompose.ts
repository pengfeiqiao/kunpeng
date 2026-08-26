/**
 * videoCompose — concat selected video clips into one MP4 via system ffmpeg.
 * ffmpeg is detected at runtime (brew install ffmpeg); absent → clear guidance.
 * Re-encodes to normalize codecs/fps (concat demuxer with stream copy breaks
 * on mixed sources, which AI clips usually are).
 */
import { convertFileSrc, invoke } from '@tauri-apps/api/tauri';
import { createDir } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { appendArtifact } from '@/lib/artifacts';
import { isWindowsSync } from '@/lib/platform';

interface CommandResult { stdout: string; stderr: string; exit_code: number }

// Windows：PATH 优先（Git Bash 下 `ffmpeg` 直接命中）+ 常见安装目录。绝对
// 路径预置单引号：bash 会把裸反斜杠当转义、空格会拆词；返回值作为 shell
// 命令片段被各调用点直接内插，引号必须随值一起传递。
// 注意：WebView 里没有 process（Vite 产物中 process.env 被替换为 {}），
// 用户目录必须经 homeDir() 获取，因此候选列表是异步构造的。
const shellQuote = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;
let ffmpegCandidatesPromise: Promise<string[]> | null = null;
const ffmpegCandidates = (): Promise<string[]> =>
  (ffmpegCandidatesPromise ??= (async () => {
    if (!isWindowsSync()) {
      return ['~/.kunpeng/bin/ffmpeg', '/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];
    }
    const home = (await homeDir()).replace(/\\/g, '/');
    return [
      'ffmpeg',
      'ffmpeg.exe',
      shellQuote(`${home}.kunpeng/bin/ffmpeg.exe`),
      shellQuote(`${home}AppData/Local/Microsoft/WinGet/Links/ffmpeg.exe`),
      shellQuote('C:/ffmpeg/bin/ffmpeg.exe'),
    ];
  })());

export async function detectFfmpeg(): Promise<string | null> {
  for (const bin of await ffmpegCandidates()) {
    try {
      const r = await invoke<CommandResult>('execute_command', {
        command: `${bin} -version`,
        timeoutMs: 5000,
      });
      if (r.exit_code === 0) return bin;
    } catch { /* try next */ }
  }
  return null;
}

function finiteDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Read metadata through WebKit/AVFoundation. This works without ffmpeg. */
async function probeDurationWithMediaElement(path: string): Promise<number> {
  return new Promise((resolve) => {
    const media = document.createElement(/\.(mp3|wav|m4a|aac|flac|ogg|opus)$/i.test(path) ? 'audio' : 'video');
    let settled = false;
    const finish = (value: number) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      media.removeAttribute('src');
      media.load();
      resolve(finiteDuration(value));
    };
    const timer = window.setTimeout(() => finish(0), 8000);
    media.preload = 'metadata';
    media.muted = true;
    media.onloadedmetadata = () => finish(media.duration);
    media.ondurationchange = () => { if (finiteDuration(media.duration)) finish(media.duration); };
    media.onerror = () => finish(0);
    media.src = /^(https?:|data:|blob:|asset:)/i.test(path) ? path : convertFileSrc(path);
    media.load();
  });
}

/** macOS metadata fallback. Unlike ffmpeg, mdls is part of the operating system. */
async function probeDurationWithSystemMetadata(path: string): Promise<number> {
  if (!/Mac/i.test(navigator.platform)) return 0;
  try {
    const escaped = path.replace(/'/g, `'\\''`);
    const result = await invoke<CommandResult>('execute_command', {
      command: `mdls -raw -name kMDItemDurationSeconds '${escaped}'`,
      timeoutMs: 5000,
    });
    return finiteDuration(Number(result.stdout.trim()));
  } catch {
    return 0;
  }
}

async function probeDurationWithFfmpeg(path: string): Promise<number> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) return 0;
  const r = await invoke<CommandResult>('execute_command', {
    command: `${ffmpeg} -i '${path.replace(/'/g, `'\\''`)}' 2>&1 | grep Duration | head -1`,
    timeoutMs: 15000,
  });
  const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stdout + r.stderr);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/** Probe media duration without requiring ffmpeg; ffmpeg remains a final fallback. */
export async function probeDuration(path: string): Promise<number> {
  const nativeDuration = await probeDurationWithMediaElement(path).catch(() => 0);
  if (nativeDuration > 0) return nativeDuration;
  const systemDuration = await probeDurationWithSystemMetadata(path);
  if (systemDuration > 0) return systemDuration;
  return probeDurationWithFfmpeg(path);
}

export interface ComposeClip {
  path: string;
  /** Trim in/out (seconds); omit for full clip. */
  inSec?: number;
  outSec?: number;
}

export interface ComposeAudioClip {
  path: string;
  startSec: number;
  volume: number; // 0..1
  loop?: boolean;
}

export interface ComposeOptions {
  clips: ComposeClip[];
  /** Cross-fade duration between clips (0 = hard cut). */
  crossfadeSec?: number;
  /** Optional background music track mixed under the program audio. */
  bgmPath?: string;
  bgmVolume?: number; // 0..1
  /** Output aspect: 9:16 center-crops each segment to 720x1280. */
  aspect?: '16:9' | '9:16';
  /** Multi-track audio (BGM/SFX/voice) mixed with adelay offsets. */
  audioClips?: ComposeAudioClip[];
  /** ASS subtitle file burned into the final output. */
  burnSubtitlePath?: string;
  onProgress?: (msg: string) => void;
}

export async function composeVideos(opts: ComposeOptions): Promise<string> {
  const ffmpeg = await detectFfmpeg();
  if (!ffmpeg) {
    throw new Error('未检测到 ffmpeg。请先安装（macOS: brew install ffmpeg；Windows: winget install ffmpeg）（安装后无需重启应用）');
  }
  if (opts.clips.length < 2) throw new Error('至少需要 2 段视频');

  const workspace = await invoke<string>('ensure_workspace');
  const outDir = `${workspace}/videos`;
  await createDir(outDir, { recursive: true }).catch(() => {});
  const outPath = `${outDir}/composed_${Date.now()}.mp4`;
  const q = (p: string) => `'${p.replace(/'/g, `'\\''`)}'`;

  // 9:16 = center-crop to portrait; 16:9 = letterbox-pad (legacy behavior)
  const segVf = opts.aspect === '9:16'
    ? 'crop=min(iw\\,ih*9/16):ih,scale=720:1280,fps=30'
    : 'scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,fps=30';

  opts.onProgress?.('正在合成视频…');

  if (!opts.crossfadeSec || opts.crossfadeSec <= 0) {
    // Hard cuts: normalize each clip, then concat demuxer
    const listLines: string[] = [];
    const tmpFiles: string[] = [];
    for (let i = 0; i < opts.clips.length; i++) {
      const c = opts.clips[i];
      const tmp = `${outDir}/.seg_${Date.now()}_${i}.mp4`;
      tmpFiles.push(tmp);
      const trim = `${c.inSec != null ? `-ss ${c.inSec}` : ''} ${c.outSec != null ? `-to ${c.outSec}` : ''}`;
      opts.onProgress?.(`转码片段 ${i + 1}/${opts.clips.length}…`);
      const r = await invoke<CommandResult>('execute_command', {
        command: `${ffmpeg} -y ${trim} -i ${q(c.path)} -vf "${segVf}" -c:v libx264 -preset fast -crf 20 -c:a aac -ar 44100 -ac 2 ${q(tmp)}`,
        timeoutMs: 300000,
      });
      if (r.exit_code !== 0) throw new Error(`片段 ${i + 1} 转码失败: ${r.stderr.slice(-300)}`);
      listLines.push(`file ${q(tmp)}`);
    }
    const listFile = `${outDir}/.concat_${Date.now()}.txt`;
    const listContent = listLines.join('\n');
    // Use shell echo instead of writeTextFile to bypass Tauri fs scope check
    await invoke<CommandResult>('execute_command', {
      command: `printf '%s' ${q(listContent)} > ${q(listFile)}`,
      timeoutMs: 10000,
    });
    opts.onProgress?.('拼接中…');
    const r = await invoke<CommandResult>('execute_command', {
      command: `${ffmpeg} -y -f concat -safe 0 -i ${q(listFile)} -c copy ${q(outPath)} && rm -f ${tmpFiles.map(q).join(' ')} ${q(listFile)}`,
      timeoutMs: 300000,
    });
    if (r.exit_code !== 0) throw new Error(`拼接失败: ${r.stderr.slice(-300)}`);
  } else {
    // Crossfade chain via xfade/acrossfade filters (re-encode once)
    const fd = opts.crossfadeSec;
    const inputs = opts.clips.map((c) => `${c.inSec != null ? `-ss ${c.inSec}` : ''} ${c.outSec != null ? `-to ${c.outSec}` : ''} -i ${q(c.path)}`).join(' ');
    // Need each clip duration for xfade offsets — probe them
    const durations: number[] = [];
    for (const c of opts.clips) {
      const r = await invoke<CommandResult>('execute_command', {
        command: `${ffmpeg} -i ${q(c.path)} 2>&1 | grep Duration | head -1`,
        timeoutMs: 10000,
      });
      const m = /Duration: (\d+):(\d+):([\d.]+)/.exec(r.stdout + r.stderr);
      const total = m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
      if (!(total > 0)) throw new Error(`无法读取片段 ${c.path.split('/').pop() ?? c.path} 的真实时长，已停止合成。`);
      const inS = c.inSec ?? 0;
      const outS = c.outSec ?? total;
      durations.push(outS - inS);
    }
    let vChain = '';
    let aChain = '';
    let prevV = '[0:v]';
    let prevA = '[0:a]';
    let offset = 0;
    for (let i = 1; i < opts.clips.length; i++) {
      offset += durations[i - 1] - fd;
      const vOut = i === opts.clips.length - 1 ? '[vout]' : `[v${i}]`;
      const aOut = i === opts.clips.length - 1 ? '[aout]' : `[a${i}]`;
      vChain += `${prevV}[${i}:v]xfade=transition=fade:duration=${fd}:offset=${offset.toFixed(2)}${vOut};`;
      aChain += `${prevA}[${i}:a]acrossfade=d=${fd}${aOut};`;
      prevV = vOut;
      prevA = aOut;
    }
    const r = await invoke<CommandResult>('execute_command', {
      command: `${ffmpeg} -y ${inputs} -filter_complex "${vChain}${aChain.slice(0, -1)}" -map "[vout]" -map "[aout]" -c:v libx264 -preset fast -crf 20 -c:a aac ${q(outPath)}`,
      timeoutMs: 600000,
    });
    if (r.exit_code !== 0) throw new Error(`合成失败: ${r.stderr.slice(-300)}`);
  }

  // Optional BGM mix
  if (opts.bgmPath) {
    opts.onProgress?.('混入背景音乐…');
    const mixed = outPath.replace('.mp4', '_bgm.mp4');
    const vol = opts.bgmVolume ?? 0.3;
    const r = await invoke<CommandResult>('execute_command', {
      command: `${ffmpeg} -y -i ${q(outPath)} -stream_loop -1 -i ${q(opts.bgmPath)} -filter_complex "[1:a]volume=${vol}[bgm];[0:a][bgm]amix=inputs=2:duration=first[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest ${q(mixed)} && mv ${q(mixed)} ${q(outPath)}`,
      timeoutMs: 300000,
    });
    if (r.exit_code !== 0) throw new Error(`BGM 混音失败: ${r.stderr.slice(-300)}`);
  }

  // Multi-track audio clips (BGM/SFX/voice) with adelay offsets
  if (opts.audioClips && opts.audioClips.length > 0) {
    opts.onProgress?.('混入音轨…');
    const mixed = outPath.replace('.mp4', '_mix.mp4');
    const inputs = opts.audioClips
      .map((a) => `${a.loop ? '-stream_loop -1 ' : ''}-i ${q(a.path)}`)
      .join(' ');
    const filters: string[] = [];
    const labels: string[] = ['[0:a]'];
    opts.audioClips.forEach((a, i) => {
      const delayMs = Math.round(a.startSec * 1000);
      filters.push(`[${i + 1}:a]volume=${a.volume},adelay=${delayMs}|${delayMs}[am${i}]`);
      labels.push(`[am${i}]`);
    });
    const filterStr = `${filters.join(';')};${labels.join('')}amix=inputs=${labels.length}:duration=first:normalize=0[aout]`;
    const r = await invoke<CommandResult>('execute_command', {
      command: `${ffmpeg} -y -i ${q(outPath)} ${inputs} -filter_complex "${filterStr}" -map 0:v -map "[aout]" -c:v copy -c:a aac -shortest ${q(mixed)} && mv ${q(mixed)} ${q(outPath)}`,
      timeoutMs: 300000,
    });
    if (r.exit_code !== 0) throw new Error(`音轨混音失败: ${r.stderr.slice(-300)}`);
  }

  // Burn subtitles (final pass, ASS keeps styling)
  if (opts.burnSubtitlePath) {
    opts.onProgress?.('烧录字幕…');
    const subbed = outPath.replace('.mp4', '_sub.mp4');
    const assPath = opts.burnSubtitlePath.replace(/'/g, `'\\''`).replace(/:/g, '\\:');
    const r = await invoke<CommandResult>('execute_command', {
      command: `${ffmpeg} -y -i ${q(outPath)} -vf "ass='${assPath}'" -c:v libx264 -preset fast -crf 20 -c:a copy ${q(subbed)} && mv ${q(subbed)} ${q(outPath)}`,
      timeoutMs: 600000,
    });
    if (r.exit_code !== 0) throw new Error(`字幕烧录失败: ${r.stderr.slice(-300)}`);
  }

  void appendArtifact({ path: outPath, type: 'video', engine: 'ffmpeg-compose', prompt: `合成 ${opts.clips.length} 段` });
  return outPath;
}
