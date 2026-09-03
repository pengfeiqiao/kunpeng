export const SEED_AUDIO_MAX_TEXT_LENGTH = 4096;
export const SEED_AUDIO_MAX_REFERENCES = 10;

export type SeedAudioFormat = 'wav' | 'mp3' | 'pcm' | 'ogg_opus';

export interface KuaiziSeedAudioPayload {
  text: string;
  references: Array<{ audio_url: string }>;
  options?: {
    format?: SeedAudioFormat;
    sample_rate?: number;
    speed?: number;
    volume?: number;
    pitch?: number;
  };
}

export interface SeedAudioPayloadInput {
  text: string;
  referenceAudioUrls: string[];
  format?: SeedAudioFormat;
  sampleRate?: number;
  speed?: number;
  volume?: number;
  pitch?: number;
}

/** Bind unlabelled text to the first reference, as required by Seed-Audio. */
export function buildSeedAudioText(text: string, referenceCount: number): string {
  if (referenceCount <= 0 || text.includes('参考录音')) return text;
  return `参考录音1：${text}`;
}

function finiteNumber(value: number | undefined): number | undefined {
  return value != null && Number.isFinite(value) ? value : undefined;
}

/** Build and validate the exact snake_case request body accepted by Kuaizi. */
export function buildSeedAudioPayload(input: SeedAudioPayloadInput): KuaiziSeedAudioPayload {
  const urls = (input.referenceAudioUrls ?? []).map((url) => url.trim()).filter(Boolean);
  if (urls.length === 0 || urls.length > SEED_AUDIO_MAX_REFERENCES) {
    throw new Error(`筷子丽帧 seed_audio 需要 1-${SEED_AUDIO_MAX_REFERENCES} 条公网参考音频 URL（当前 ${urls.length} 条）`);
  }
  for (const url of urls) {
    if (!/^https?:\/\//i.test(url)) {
      throw new Error(`筷子丽帧 seed_audio 参考音频必须是公开可访问的 HTTP(S) URL：${url}`);
    }
  }

  const text = buildSeedAudioText(input.text.trim(), urls.length);
  if (!text) throw new Error('筷子丽帧 seed_audio 的 text 不能为空');
  if (text.length > SEED_AUDIO_MAX_TEXT_LENGTH) {
    throw new Error(`筷子丽帧 seed_audio 的 text 超长（${text.length} 字，上限 ${SEED_AUDIO_MAX_TEXT_LENGTH}）`);
  }

  const sampleRate = finiteNumber(input.sampleRate);
  const speed = finiteNumber(input.speed);
  const volume = finiteNumber(input.volume);
  const pitch = finiteNumber(input.pitch);
  const options: NonNullable<KuaiziSeedAudioPayload['options']> = {};
  if (input.format) options.format = input.format;
  if (sampleRate != null) options.sample_rate = Math.min(48000, Math.max(8000, Math.trunc(sampleRate)));
  if (speed != null) options.speed = Math.min(2, Math.max(0.5, speed));
  if (volume != null) options.volume = Math.min(2, Math.max(0.5, volume));
  if (pitch != null) options.pitch = Math.min(12, Math.max(-12, Math.trunc(pitch)));

  return {
    text,
    references: urls.map((audio_url) => ({ audio_url })),
    ...(Object.keys(options).length > 0 ? { options } : {}),
  };
}
