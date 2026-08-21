import { fetch, ResponseType } from '@tauri-apps/api/http';
import { appCacheDir } from '@tauri-apps/api/path';
import { writeBinaryFile } from '@tauri-apps/api/fs';
import { useSettingsStore } from '@/stores/settingsStore';
import { resolveApiKey, resolveCosSecrets } from '@/lib/credentials';
import { generateSeedAudioViaKuaizi } from '@/lib/kuaizi/seedAudio';
import { resolveKuaiziMediaRef } from '@/lib/kuaizi/seedance';
import { uploadToCos } from '@/lib/cos';
import { nanoid } from 'nanoid';
import {
  PaidSubmissionUnknownError,
  mustNotAutoResubmit,
} from '@/lib/billingSafety';

const ENDPOINT = 'https://openspeech.bytedance.com/api/v3/tts/create';

export interface DoubaoSpeechReference {
  audio_data?: string;
  audio_url?: string;
  speaker?: string;
  image_data?: string;
  image_url?: string;
}

export interface DoubaoAudioConfig {
  format?: 'mp3' | 'wav' | 'pcm' | 'ogg_opus';
  sample_rate?: number;
  speech_rate?: number;
  loudness_rate?: number;
  pitch_rate?: number;
  enable_subtitle?: boolean;
}

export interface DoubaoSpeechRequest {
  text_prompt: string;
  references?: DoubaoSpeechReference[];
  audio_config?: DoubaoAudioConfig;
}

export interface DoubaoSpeechResponse {
  code?: number;
  message?: string;
  audio?: string;
  duration: number;
  original_duration: number;
  url?: string;
  subtitle?: {
    text?: string;
    sentences?: Array<{
      start_time: number;
      end_time: number;
      text: string;
      words?: Array<{ start_time: number; end_time: number; text: string }>;
    }>;
  };
}

/**
 * 配音统一入口。默认走筷子丽帧 seed_audio 通道（settingsStore.speechKuaiziFirst，
 * 可在「设置 → 豆包语音」切换为豆包官方）；筷子通道失败且已配置豆包语音
 * API Key 时自动降级回豆包官方通道，两者都失败则把两个错误一起抛出。
 */
export async function generateSpeech(req: DoubaoSpeechRequest): Promise<DoubaoSpeechResponse> {
  if (useSettingsStore.getState().speechKuaiziFirst) {
    try {
      return await generateSpeechViaKuaizi(req);
    } catch (initialKuaiziErr) {
      let kuaiziErr = initialKuaiziErr;
      if (mustNotAutoResubmit(initialKuaiziErr)) {
        console.warn('[doubaoSpeech] 筷子丽帧配音提交结果不确定，自动重提一次:', initialKuaiziErr);
        try {
          return await generateSpeechViaKuaizi(req);
        } catch (retryErr) {
          kuaiziErr = new Error(
            `筷子丽帧配音首次提交结果不确定，自动重试后仍失败：${errText(retryErr)}`,
          );
        }
      }
      const hasDoubaoKey = Boolean(resolveApiKey(useSettingsStore.getState(), 'doubaoSpeech', useSettingsStore.getState().doubaoSpeechApiKey).trim());
      if (!hasDoubaoKey) {
        throw new Error(`${errText(kuaiziErr)}\n（未配置豆包语音 API Key，无法回退豆包官方通道）`);
      }
      console.warn('[doubaoSpeech] 筷子丽帧配音通道失败，回退豆包官方通道:', kuaiziErr);
      try {
        return await generateSpeechViaDoubao(req);
      } catch (doubaoErr) {
        throw new Error(`筷子丽帧配音失败：${errText(kuaiziErr)}\n豆包官方配音也失败：${errText(doubaoErr)}`);
      }
    }
  }
  return generateSpeechViaDoubao(req);
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * 豆包 speech_rate/loudness_rate ∈ [-50, 100]（相对正常值的百分比，0=默认）
 * → 筷子 speed/volume ∈ [0.5, 2.0]（倍率，1=默认）：factor = 1 + rate/100 再 clamp。
 * 未传时返回 undefined，让筷子用服务端默认值。
 */
function doubaoRateToKuaiziFactor(rate?: number): number | undefined {
  if (rate == null || !Number.isFinite(rate)) return undefined;
  return Math.min(2, Math.max(0.5, 1 + rate / 100));
}

/** 豆包 pitch_rate ∈ [-12, 12]（半音）与筷子 pitch 同域，clamp 后直传。 */
function doubaoPitchToKuaizi(pitch?: number): number | undefined {
  if (pitch == null || !Number.isFinite(pitch)) return undefined;
  return Math.min(12, Math.max(-12, Math.round(pitch)));
}

function base64ToBytes(base64: string): Uint8Array {
  const raw = atob(base64);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}

/** 按文件头嗅探参考音频格式（影响 COS Content-Type），未知按 mp3 处理。 */
function sniffAudioExt(bytes: Uint8Array): string {
  const ascii = (off: number, len: number) => String.fromCharCode(...bytes.subarray(off, off + len));
  if (bytes.length >= 12 && ascii(0, 4) === 'RIFF' && ascii(8, 4) === 'WAVE') return 'wav';
  if (bytes.length >= 4 && ascii(0, 4) === 'OggS') return 'ogg';
  return 'mp3';
}

/**
 * 本地参考音色（base64）→ 落临时文件 → 传 COS 换公网 URL。
 * 筷子 seed_audio 只接受公网 HTTP(S) 参考，本地文件必须走 COS 中转。
 */
async function uploadSpeechReferenceToCos(base64: string): Promise<string> {
  const st = useSettingsStore.getState();
  const cosSecrets = resolveCosSecrets(st, st.cosSecretId, st.cosSecretKey);
  if (!st.cosBucket || !cosSecrets.secretId.trim() || !cosSecrets.secretKey.trim()) {
    throw new Error('筷子丽帧配音通道使用本地参考音色，需要先在「设置 → 存储与集成 → 腾讯云 COS」完成配置（用于换取公网 URL），或改用豆包官方通道');
  }
  const bytes = base64ToBytes(base64);
  const ext = sniffAudioExt(bytes);
  const fileName = `kunpeng-voice-ref-${Date.now()}-${nanoid(6)}.${ext}`;
  const tmpPath = `${await appCacheDir()}${fileName}`;
  await writeBinaryFile(tmpPath, bytes);
  return uploadToCos(tmpPath, fileName);
}

/**
 * 筷子丽帧 seed_audio 配音通道。返回形状与豆包官方一致（url + duration），
 * 调用方统一走 fetchSpeechAudioBytes 下载音频 bytes，无需改动。
 */
async function generateSpeechViaKuaizi(req: DoubaoSpeechRequest): Promise<DoubaoSpeechResponse> {
  const referenceUrls: string[] = [];
  for (const ref of req.references ?? []) {
    if (ref.speaker) {
      throw new Error('筷子丽帧配音通道不支持 speaker 音色 ID，请提供参考音频或改用豆包官方通道');
    }
    if (ref.audio_url) {
      // 公网 URL 直传；asset.localhost 素材由 resolveKuaiziMediaRef 传 COS 换公网 URL
      referenceUrls.push(await resolveKuaiziMediaRef(ref.audio_url));
    } else if (ref.audio_data) {
      referenceUrls.push(await uploadSpeechReferenceToCos(ref.audio_data));
    }
  }
  if (referenceUrls.length === 0) {
    throw new Error('筷子丽帧配音通道需要 1-10 条参考音色（reference_audio_path / reference_audio_url）；不带参考音色的配音请改用豆包官方通道');
  }
  const cfg = req.audio_config ?? {};
  const result = await generateSeedAudioViaKuaizi({
    text: req.text_prompt,
    referenceAudioUrls: referenceUrls,
    format: cfg.format ?? 'mp3',
    sampleRate: cfg.sample_rate,
    speed: doubaoRateToKuaiziFactor(cfg.speech_rate),
    volume: doubaoRateToKuaiziFactor(cfg.loudness_rate),
    pitch: doubaoPitchToKuaizi(cfg.pitch_rate),
  });
  return {
    url: result.audioUrl,
    duration: result.duration,
    original_duration: result.duration,
  };
}

async function generateSpeechViaDoubao(req: DoubaoSpeechRequest): Promise<DoubaoSpeechResponse> {
  const st = useSettingsStore.getState();
  const apiKey = resolveApiKey(st, 'doubaoSpeech', st.doubaoSpeechApiKey).trim();
  if (!apiKey) throw new Error('请先在设置中配置豆包语音 API Key');

  const body = {
    model: 'seed-audio-1.0',
    ...req,
    audio_config: { format: 'mp3', ...req.audio_config },
  };

  let resp;
  try {
    resp = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': apiKey,
        'X-Api-Request-Id': nanoid(24),
      },
      body: { type: 'Json', payload: body },
      responseType: ResponseType.JSON,
      timeout: 120,
    });
  } catch (err) {
    throw new PaidSubmissionUnknownError('豆包配音', err instanceof Error ? err.message : String(err));
  }

  if (!resp.ok) {
    throw new Error(`Doubao Speech API error: ${resp.status} ${JSON.stringify(resp.data)}`);
  }

  const data = resp.data as DoubaoSpeechResponse;
  // Volcengine's newer Seed-Audio response may omit code/message entirely on
  // success and return { audio, url, duration, ... }. Keep the old error-shape
  // handling, but do not reject a valid success payload just because code is absent.
  if (typeof data.code === 'number' && data.code !== 0) {
    throw new Error(`Doubao Speech 错误 [${data.code}]: ${data.message}`);
  }
  if (!data.audio && !data.url) {
    const suffix = data.message ? `：${data.message}` : '';
    throw new PaidSubmissionUnknownError('豆包配音', `成功响应没有 audio 或 url${suffix}`);
  }

  return data;
}

export async function fetchSpeechAudioBytes(resp: DoubaoSpeechResponse): Promise<Uint8Array> {
  if (resp.audio) {
    const raw = atob(resp.audio);
    const arr = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
    return arr;
  }
  if (!resp.url) throw new Error('Doubao Speech 没有返回可下载音频');
  let lastError: unknown;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const audioResp = await fetch<ArrayBuffer>(resp.url, {
        method: 'GET',
        responseType: ResponseType.Binary,
        timeout: 120,
      });
      if (audioResp.ok) return new Uint8Array(audioResp.data);
      lastError = new Error(`HTTP ${audioResp.status}`);
    } catch (err) {
      lastError = err;
    }
    if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 800));
  }
  throw new Error(`下载配音音频失败（已安全重试 GET 3 次，未重新提交生成任务）: ${errText(lastError)}`);
}
