import type { WritingExperience, StyleProfile } from './types';
import { readExperienceLog, readStyleProfile, writeStyleProfile } from './persist';

function asStringArray(value: string[] | string | undefined): string[] {
  if (!value) return [];
  if (Array.isArray(value)) return value.filter(Boolean);
  return value.split(/[；;,\n]/).map(s => s.trim()).filter(Boolean);
}

function addWeighted(map: Record<string, number>, key: string | undefined, weight: number) {
  const normalized = key?.trim();
  if (!normalized) return;
  map[normalized] = (map[normalized] || 0) + weight;
}

export function buildExperienceContext(profile: StyleProfile | null): string {
  if (!profile || profile.totalSessions === 0) return '';

  const parts: string[] = [
    `\n**用户文体画像**（基于 ${profile.totalSessions} 次写作积累，仅作偏好证据，不是必须复刻的模板）：`,
    profile.coreStyle,
  ];

  if (profile.favoritePatterns.length > 0) {
    parts.push(`用户曾认可的手法（按内容需要选择，禁止机械重复）：${profile.favoritePatterns.join('、')}`);
  }
  if (profile.avoidPatterns.length > 0) {
    parts.push(`应避免（优先级高于常用手法）：${profile.avoidPatterns.join('、')}`);
  }
  if (profile.vocabulary.length > 0) {
    const topWords = profile.vocabulary.slice(0, 10).map(v => v.word).join('、');
    parts.push(`历史高频词（仅用于理解声线，不要求复用；同一篇中避免堆叠）：${topWords}`);
  }
  const tones = Object.entries(profile.toneSpectrum)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([t, v]) => `${t}(${Math.round(v * 100)}%)`)
    .join('、');
  if (tones) {
    parts.push(`语气倾向：${tones}`);
  }

  parts.push('画像不能覆盖事实准确性、当前用户要求和文风审校规则。旧稿中的模板句、重复意象和 AI 惯用语不得因“用户常用”而继续放大。');

  return parts.join('\n');
}

export async function rebuildStyleProfile(experiences?: WritingExperience[]): Promise<StyleProfile> {
  const exps = experiences ?? await readExperienceLog();
  const existing = await readStyleProfile();

  if (exps.length === 0) {
    const empty: StyleProfile = {
      version: 2,
      lastUpdated: Date.now(),
      coreStyle: '',
      toneSpectrum: {},
      favoritePatterns: [],
      vocabulary: [],
      avoidPatterns: [],
      totalSessions: 0,
    };
    return existing ?? empty;
  }

  const sorted = [...exps].sort((a, b) => a.timestamp - b.timestamp);
  const recentFirst = [...sorted].reverse();
  const toneMap: Record<string, number> = {};
  const patternCount: Record<string, number> = {};
  const vocabCount: Record<string, number> = {};
  const noteScore: Record<string, number> = {};
  const avoidScore: Record<string, number> = {};
  const recentNotes: string[] = [];

  sorted.forEach((exp, index) => {
    const recency = sorted.length <= 1 ? 1 : index / (sorted.length - 1);
    const weight = 1 + recency * 2;

    addWeighted(toneMap, exp.tonePreference, weight);
    addWeighted(patternCount, exp.structurePattern, weight);

    for (const note of asStringArray(exp.styleNotes)) {
      addWeighted(noteScore, note, weight);
    }
    for (const v of asStringArray(exp.vocabularyHits)) {
      addWeighted(vocabCount, v, weight);
    }
    addWeighted(avoidScore, exp.whatToImprove, weight);
  });

  for (const exp of recentFirst.slice(0, 8)) {
    for (const note of asStringArray(exp.styleNotes)) {
      if (!recentNotes.includes(note)) recentNotes.push(note);
    }
  }

  const total = exps.length;
  const totalToneWeight = Object.values(toneMap).reduce((sum, v) => sum + v, 0);
  const toneSpectrum: Record<string, number> = {};
  for (const [k, v] of Object.entries(toneMap)) {
    toneSpectrum[k] = totalToneWeight > 0 ? v / totalToneWeight : 0;
  }

  const favoritePatterns = Object.entries(patternCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k]) => k);

  const vocabulary = Object.entries(vocabCount)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([word, freq]) => ({ word, freq: Math.round(freq * 10) / 10 }));

  const scoredNotes = Object.entries(noteScore)
    .sort((a, b) => b[1] - a[1])
    .map(([note]) => note);
  const uniqueNotes = [...new Set([...recentNotes, ...scoredNotes])].slice(0, 10);
  const coreStyle = uniqueNotes.join('；');

  const avoidPatterns = Object.entries(avoidScore)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6)
    .map(([item]) => item);

  const profile: StyleProfile = {
    version: 2,
    lastUpdated: Date.now(),
    coreStyle,
    toneSpectrum,
    favoritePatterns,
    vocabulary,
    avoidPatterns,
    totalSessions: total,
  };

  await writeStyleProfile(profile);
  return profile;
}
