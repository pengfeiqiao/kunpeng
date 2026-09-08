/**
 * audioPrompts — 分镜配音提示词（按 characterId 合并）的写入纪律。
 *
 * 空配音槽（prompt 为空串/纯空白）没有可合成内容，落盘后只会以"占位角色"形式
 * 污染 audioPrompts；所有写入路径（增量合并、整组替换）都必须剔除，
 * 既有的空槽也在合并时一并清洗。
 */
import type { WsShot } from './types.ts';

export function mergeAudioPrompts(
  existing: WsShot['audioPrompts'],
  incoming: WsShot['audioPrompts'],
): NonNullable<WsShot['audioPrompts']> {
  const merged = (existing ?? [])
    .filter((item) => typeof item?.prompt === 'string' && item.prompt.trim().length > 0)
    .map((item) => ({ ...item }));
  for (const item of incoming ?? []) {
    const characterId = typeof item?.characterId === 'string' ? item.characterId.trim() : '';
    if (!characterId || typeof item?.prompt !== 'string' || !item.prompt.trim()) continue;
    const next = { characterId, prompt: item.prompt };
    const index = merged.findIndex((current) => current.characterId === characterId);
    if (index >= 0) merged[index] = next;
    else merged.push(next);
  }
  return merged;
}
