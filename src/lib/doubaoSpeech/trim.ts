import type { GeneratedAudio } from '@/lib/workshop/types';
import { readBinaryFile, writeBinaryFile, createDir, BaseDirectory } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';

function encodeWav(pcm: Float32Array[], sampleRate: number): Uint8Array {
  const numChannels = pcm.length;
  const numFrames = pcm[0].length;
  const bytesPerSample = 2;
  const dataLen = numFrames * numChannels * bytesPerSample;
  const buf = new ArrayBuffer(44 + dataLen);
  const view = new DataView(buf);

  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };

  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataLen, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, bytesPerSample * 8, true);
  writeStr(36, 'data');
  view.setUint32(40, dataLen, true);

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
    for (let ch = 0; ch < numChannels; ch++) {
      const sample = Math.max(-1, Math.min(1, pcm[ch][i]));
      view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7FFF, true);
      offset += 2;
    }
  }

  return new Uint8Array(buf);
}

export async function trimAudiosToFit(
  audios: GeneratedAudio[],
  maxTotalSec: number,
  projectId: string,
): Promise<GeneratedAudio[]> {
  const totalDuration = audios.reduce((s, a) => s + a.duration, 0);
  if (totalDuration <= maxTotalSec) return audios;

  const ratio = maxTotalSec / totalDuration;
  const home = await homeDir();
  const relDir = `.kunpeng/aigc-memory/projects/${projectId}/dubbing`;
  await createDir(relDir, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});

  const ctx = new AudioContext();

  const results: GeneratedAudio[] = [];
  for (const audio of audios) {
    const targetDuration = audio.duration * ratio;
    const bytes = await readBinaryFile(audio.path);
    const arrayBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
    const decoded = await ctx.decodeAudioData(arrayBuf);

    const targetFrames = Math.floor(targetDuration * decoded.sampleRate);
    const channels: Float32Array[] = [];
    for (let ch = 0; ch < decoded.numberOfChannels; ch++) {
      channels.push(decoded.getChannelData(ch).slice(0, targetFrames));
    }

    const wav = encodeWav(channels, decoded.sampleRate);
    const baseName = audio.path.split('/').pop()!.replace(/\.[^.]+$/, '');
    const trimFileName = `${baseName}-trim.wav`;
    const trimRelPath = `${relDir}/${trimFileName}`;
    await writeBinaryFile(trimRelPath, wav, { dir: BaseDirectory.Home });

    results.push({
      ...audio,
      trimmedPath: `${home}/${trimRelPath}`,
      trimmedDuration: Math.round(targetDuration * 10) / 10,
    });
  }

  await ctx.close();
  return results;
}

async function decodeAudio(path: string, ctx: AudioContext): Promise<AudioBuffer> {
  const bytes = await readBinaryFile(path);
  const arrayBuf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return ctx.decodeAudioData(arrayBuf);
}

/**
 * Prepare arbitrary audio files for Seedance/Kuaizi reference upload.
 * If the combined length exceeds maxTotalSec, files are proportionally trimmed
 * and the returned paths point to the trimmed wav copies.
 */
export async function trimAudioPathsToFit(
  paths: string[],
  maxTotalSec: number,
  projectId: string,
  labels?: string[],
): Promise<{ paths: string[]; audios: GeneratedAudio[]; totalDuration: number; trimmed: boolean }> {
  const cleanPaths = paths.filter(Boolean);
  if (cleanPaths.length === 0) return { paths: [], audios: [], totalDuration: 0, trimmed: false };

  const ctx = new AudioContext();
  try {
    const decoded = await Promise.all(cleanPaths.map((path) => decodeAudio(path, ctx)));
    const audios: GeneratedAudio[] = cleanPaths.map((path, i) => ({
      characterId: `audio-${i + 1}`,
      characterName: labels?.[i] || `音频${i + 1}`,
      path,
      duration: decoded[i].duration,
    }));
    const totalDuration = audios.reduce((sum, item) => sum + item.duration, 0);
    if (totalDuration <= maxTotalSec) {
      return { paths: cleanPaths, audios, totalDuration, trimmed: false };
    }

    const ratio = maxTotalSec / totalDuration;
    const home = await homeDir();
    const relDir = `.kunpeng/aigc-memory/projects/${projectId}/dubbing`;
    await createDir(relDir, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});

    const trimmedAudios: GeneratedAudio[] = [];
    for (let i = 0; i < audios.length; i++) {
      const audio = audios[i];
      const buffer = decoded[i];
      const targetDuration = Math.max(0.1, audio.duration * ratio);
      const targetFrames = Math.max(1, Math.floor(targetDuration * buffer.sampleRate));
      const channels: Float32Array[] = [];
      for (let ch = 0; ch < buffer.numberOfChannels; ch++) {
        channels.push(buffer.getChannelData(ch).slice(0, targetFrames));
      }

      const wav = encodeWav(channels, buffer.sampleRate);
      const baseName = audio.path.split('/').pop()!.replace(/\.[^.]+$/, '');
      const trimFileName = `${baseName}-seedance-trim-${Date.now()}-${i + 1}.wav`;
      const trimRelPath = `${relDir}/${trimFileName}`;
      await writeBinaryFile(trimRelPath, wav, { dir: BaseDirectory.Home });
      trimmedAudios.push({
        ...audio,
        trimmedPath: `${home}/${trimRelPath}`,
        trimmedDuration: Math.round(targetDuration * 10) / 10,
      });
    }

    return {
      paths: trimmedAudios.map((audio) => audio.trimmedPath || audio.path),
      audios: trimmedAudios,
      totalDuration,
      trimmed: true,
    };
  } finally {
    await ctx.close();
  }
}
