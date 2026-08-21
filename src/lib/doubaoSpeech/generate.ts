import { fetchSpeechAudioBytes, generateSpeech } from './client';
import type { WsShot, WsCharacter, GeneratedAudio } from '@/lib/workshop/types';
import { homeDir } from '@tauri-apps/api/path';
import { createDir, readBinaryFile, writeBinaryFile, BaseDirectory } from '@tauri-apps/api/fs';

function safeName(s: string): string {
  return s.replace(/[^\w一-龥-]+/g, '_');
}

function uint8ToBase64(bytes: Uint8Array): string {
  const len = bytes.length;
  let binary = '';
  for (let i = 0; i < len; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export async function generateShotAudio(
  shot: WsShot,
  characters: WsCharacter[],
  projectId: string,
  onProgress?: (done: number, total: number) => void,
): Promise<GeneratedAudio[]> {
  const prompts = shot.audioPrompts ?? [];
  if (prompts.length === 0) return [];

  const home = await homeDir();
  const relDir = `.kunpeng/aigc-memory/projects/${projectId}/dubbing`;
  await createDir(relDir, { dir: BaseDirectory.Home, recursive: true }).catch(() => {});

  const results: GeneratedAudio[] = [];
  const failures: string[] = [];
  let done = 0;

  for (const ap of prompts) {
    const char = characters.find((c) => c.id === ap.characterId);
    if (!char || !ap.prompt.trim()) continue;

    try {
      const references: { audio_data?: string }[] = [];
      if (char.voicePath) {
        try {
          const bytes = await readBinaryFile(char.voicePath);
          references.push({ audio_data: uint8ToBase64(new Uint8Array(bytes)) });
        } catch {
          console.warn('[doubaoSpeech] 读取音色文件失败，回退纯文本模式:', char.voicePath);
        }
      }

      console.log('[doubaoSpeech] 开始生成配音:', char.name, '提示词长度:', ap.prompt.length, '有参考音色:', references.length > 0);

      const resp = await generateSpeech({
        text_prompt: ap.prompt,
        references: references.length > 0 ? references : undefined,
      });

      console.log('[doubaoSpeech] API 返回:', char.name, 'duration:', resp.duration, 'audio长度:', resp.audio?.length);

      const arr = await fetchSpeechAudioBytes(resp);

      const fileName = `${safeName(shot.shotNo)}-${safeName(char.name)}.mp3`;
      const relPath = `${relDir}/${fileName}`;
      await writeBinaryFile(relPath, arr, { dir: BaseDirectory.Home });

      done++;
      onProgress?.(done, prompts.length);

      results.push({
        characterId: char.id,
        characterName: char.name,
        path: `${home}/${relPath}`,
        duration: resp.duration,
      });
    } catch (err) {
      console.error('[doubaoSpeech] 角色配音失败:', char.name, err);
      failures.push(`${char.name}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (results.length === 0 && failures.length > 0) {
    throw new Error(failures.join('\n'));
  }
  if (failures.length > 0) {
    console.warn('[doubaoSpeech] 部分角色配音失败:', failures.join('\n'));
  }

  return results;
}
