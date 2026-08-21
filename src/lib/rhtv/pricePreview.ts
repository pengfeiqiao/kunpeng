/**
 * pricePreview — RunningHub 官方估价 API。
 * POST /openapi/v2/price-preview/{endpoint}，body 与正式提交一致。
 * 实测返回 { estimatedPrice, currency: "CNY", isFreeThisCall, freeLimit… }。
 */
import { getRhtvApiKey, RHTV_BASE } from './client';
import type { RhtvParams } from './types';

export interface PricePreview {
  estimatedPrice: number;
  currency: string;
  isFreeThisCall: boolean;
  freeLimit: boolean;
  remainingFreeLimitCount: number | null;
}

const cache = new Map<string, { at: number; result: PricePreview }>();
const CACHE_MS = 60_000;

export async function previewPrice(endpoint: string, params: RhtvParams): Promise<PricePreview | null> {
  const key = `${endpoint}:${JSON.stringify(params)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.result;

  const apiKey = getRhtvApiKey();
  if (!apiKey) return null;

  try {
    const resp = await fetch(`${RHTV_BASE}/price-preview/${endpoint}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!resp.ok) return null;
    const data = (await resp.json()) as PricePreview & { errorCode?: string };
    if (data.errorCode) return null;
    const result: PricePreview = {
      estimatedPrice: data.estimatedPrice ?? 0,
      currency: data.currency ?? 'CNY',
      isFreeThisCall: data.isFreeThisCall ?? false,
      freeLimit: data.freeLimit ?? false,
      remainingFreeLimitCount: data.remainingFreeLimitCount ?? null,
    };
    cache.set(key, { at: Date.now(), result });
    return result;
  } catch {
    return null;
  }
}

/** 估价显示文案：免费 / ¥x.x / 空（失败静默） */
export function priceLabel(p: PricePreview | null): string {
  if (!p) return '';
  if (p.isFreeThisCall) return '免费';
  return `¥ ${p.estimatedPrice}`;
}
