/**
 * Provider router — given user preferences and a request, pick a provider
 * (and model) and provide a fallback chain when the primary fails.
 *
 * Strategies:
 *   - 'primary'        — single provider, no fallback (fail fast)
 *   - 'fallback_chain' — try each in order; on retryable failure
 *                        (configurable per-link triggerCodes) advance to next
 *   - 'parallel_race'  — fire all candidates, take the first usable stream
 *                        (useful when latency matters more than cost)
 *   - 'task_routing'   — match request shape (e.g. has image, tool count,
 *                        message length) to a sub-strategy
 *
 * For Tier 1.5 we ship 'primary' and 'fallback_chain'. The other two are
 * scaffolded for forward compatibility but throw `not implemented` so we
 * notice if something tries to use them prematurely.
 *
 * Fallback emits a UI event `provider-fallback` (`{from, to, reason}`) so
 * the sidebar can show "已切换到 DeepSeek V4". Listeners are wired in
 * `src/components/StatusBar.tsx` (TODO Tier 4.x).
 */

import { emit } from '@tauri-apps/api/event';
import type { CompletionResult, Provider, ChatRequest, ChatOptions, SimpleCompletionRequest } from './types';
import type { StreamDelta } from '../types';
import { getProvider } from './registry';
import { agentLog } from '../logger';
import { isRetryableFallbackStatus } from './networkPolicy';
import {
  ProviderRouteError,
  type ProviderRouteAttempt,
} from '../routeError';

function latestUserTurnHasNativeImage(req: ChatRequest): boolean {
  for (let index = req.messages.length - 1; index >= 0; index -= 1) {
    const message = req.messages[index];
    if (message.role === 'tool' && message.media?.some((block) => block.type === 'image')) return true;
    if (message.role !== 'user') continue;
    return Array.isArray(message.content) && message.content.some((block) => block.type === 'image');
  }
  return false;
}

function requestForProvider(req: ChatRequest, providerId: string): ChatRequest {
  if (providerId !== 'kimi' || !latestUserTurnHasNativeImage(req) || !req.tools?.length) return req;
  return {
    ...req,
    // The image is already an Anthropic multimodal content block. Keeping a
    // second vision function visible makes Kimi unnecessarily re-read it via
    // the fallback vision service instead of using K3's native perception.
    tools: req.tools.filter((tool) => tool.name !== 'image_recognition'),
  };
}

export interface FallbackLink {
  providerId: string;
  modelId?: string;
  /** HTTP status codes that should trigger advancing to the next link. */
  triggerCodes?: number[];
}

export type RouteStrategy =
  | { kind: 'primary'; providerId: string; modelId?: string }
  | { kind: 'fallback_chain'; chain: FallbackLink[] }
  | { kind: 'parallel_race'; candidates: FallbackLink[]; pickBy: 'first' | 'best' }
  | {
      kind: 'task_routing';
      rules: { matcher: (req: ChatRequest) => boolean; route: RouteStrategy }[];
      fallback: RouteStrategy;
    };

const DEFAULT_TRIGGERS = [408, 429, 500, 502, 503, 504, 529];

export interface ResolvedProvider {
  provider: Provider;
  modelId?: string;
}

function routeAttempt(link: FallbackLink, provider: Provider | undefined, err: unknown): ProviderRouteAttempt {
  const status = extractStatus(err);
  return {
    providerId: link.providerId,
    providerName: provider?.displayName || link.providerId,
    modelId: link.modelId,
    status,
    message: err instanceof Error ? err.message : String(err),
  };
}

function routeFailure(attempts: ProviderRouteAttempt[], fallback: unknown): unknown {
  return attempts.length > 1 ? new ProviderRouteError(attempts) : fallback;
}

/** Resolve a single concrete provider from a strategy (no fallback applied yet). */
export function resolveStrategy(strategy: RouteStrategy, req: ChatRequest): ResolvedProvider {
  switch (strategy.kind) {
    case 'primary': {
      const p = getProvider(strategy.providerId);
      if (!p) throw new Error(`router: provider "${strategy.providerId}" not registered`);
      return { provider: p, modelId: strategy.modelId };
    }
    case 'fallback_chain': {
      const head = strategy.chain[0];
      if (!head) throw new Error('router: fallback_chain is empty');
      const p = getProvider(head.providerId);
      if (!p) throw new Error(`router: provider "${head.providerId}" not registered`);
      return { provider: p, modelId: head.modelId };
    }
    case 'task_routing': {
      for (const rule of strategy.rules) {
        if (rule.matcher(req)) return resolveStrategy(rule.route, req);
      }
      return resolveStrategy(strategy.fallback, req);
    }
    case 'parallel_race':
      throw new Error('router: parallel_race not implemented yet');
  }
}

/**
 * Stream a chat request following the strategy. Handles fallback transparently:
 * if the current link errors with a code in its triggerCodes (or a network
 * error), it switches to the next link and re-streams.
 *
 * Note on semantics: if the first link has *already yielded chunks* before
 * failing mid-stream, we DO NOT silently restart — the partial output would
 * confuse the coordinator. Instead we surface the error. Fallback only kicks
 * in when the failure happens before any deltas were emitted.
 */
export async function* streamWithFallback(
  strategy: RouteStrategy,
  req: ChatRequest,
  opts: ChatOptions,
  signal?: AbortSignal,
): AsyncGenerator<StreamDelta> {
  const chain = flattenToChain(strategy);

  let lastErr: unknown;
  const attempts: ProviderRouteAttempt[] = [];
  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    const provider = getProvider(link.providerId);
    if (!provider) {
      lastErr = new Error(`router: provider "${link.providerId}" not registered`);
      attempts.push(routeAttempt(link, provider, lastErr));
      continue;
    }

    const triggers = link.triggerCodes ?? DEFAULT_TRIGGERS;
    let yieldedAny = false;
    try {
      const providerReq = requestForProvider(req, link.providerId);
      const stream = provider.streamChat(
        { ...providerReq, modelId: link.modelId ?? req.modelId },
        opts,
      );
      for await (const delta of stream) {
        yieldedAny = true;
        yield delta;
      }
      return;
    } catch (err) {
      lastErr = err;
      attempts.push(routeAttempt(link, provider, err));

      // If the user aborted, never fallback — re-throw immediately.
      if (signal?.aborted) throw err;

      const status = extractStatus(err);
      const shouldFallback =
        !yieldedAny &&
        i < chain.length - 1 &&
        isRetryableFallbackStatus(status, triggers);

      if (!shouldFallback) {
        throw routeFailure(attempts, err);
      }

      const next = chain[i + 1];
      const reason = status !== undefined && status > 0 ? `HTTP ${status}` : 'network';
      const detail = err instanceof Error ? err.message : String(err);
      agentLog.warn(
        'router',
        `provider "${link.providerId}" failed (${reason}); falling back to "${next.providerId}". detail: ${detail}`,
      );
      opts.onProviderFallback?.({
        from: provider.displayName || link.providerId,
        to: getProvider(next.providerId)?.displayName || next.providerId,
        reason,
      });
      try {
        await emit('provider-fallback', {
          from: link.providerId,
          to: next.providerId,
          reason,
        });
      } catch {
        /* event bus optional during tests */
      }
    }
  }

  const fallbackError = lastErr ?? new Error('router: all providers failed');
  throw routeFailure(attempts, fallbackError);
}

/** Non-streaming sibling of streamWithFallback, used by compaction and short classifiers. */
export async function chatWithFallback(
  strategy: RouteStrategy,
  req: SimpleCompletionRequest,
  opts: ChatOptions,
  signal?: AbortSignal,
): Promise<string> {
  return (await chatWithFallbackDetailed(strategy, req, opts, signal)).text;
}

/** Non-streaming completion with stop metadata for truncation-safe callers. */
export async function chatWithFallbackDetailed(
  strategy: RouteStrategy,
  req: SimpleCompletionRequest,
  opts: ChatOptions,
  signal?: AbortSignal,
): Promise<CompletionResult> {
  const chain = flattenToChain(strategy);

  let lastErr: unknown;
  const attempts: ProviderRouteAttempt[] = [];
  for (let i = 0; i < chain.length; i++) {
    const link = chain[i];
    const provider = getProvider(link.providerId);
    if (!provider) {
      lastErr = new Error(`router: provider "${link.providerId}" not registered`);
      attempts.push(routeAttempt(link, provider, lastErr));
      continue;
    }

    const triggers = link.triggerCodes ?? DEFAULT_TRIGGERS;
    try {
      const providerReq = { ...req, modelId: link.modelId ?? req.modelId };
      return provider.chatDetailed
        ? await provider.chatDetailed(providerReq, opts)
        : { text: await provider.chat(providerReq, opts), finishReason: null };
    } catch (err) {
      lastErr = err;
      attempts.push(routeAttempt(link, provider, err));
      if (signal?.aborted) throw err;

      const status = extractStatus(err);
      const shouldFallback =
        i < chain.length - 1 &&
        isRetryableFallbackStatus(status, triggers);

      if (!shouldFallback) throw routeFailure(attempts, err);

      const next = chain[i + 1];
      const reason = status !== undefined && status > 0 ? `HTTP ${status}` : 'network';
      const detail = err instanceof Error ? err.message : String(err);
      agentLog.warn(
        'router',
        `provider "${link.providerId}" chat failed (${reason}); falling back to "${next.providerId}". detail: ${detail}`,
      );
      opts.onProviderFallback?.({
        from: provider.displayName || link.providerId,
        to: getProvider(next.providerId)?.displayName || next.providerId,
        reason,
      });
      try {
        await emit('provider-fallback', {
          from: link.providerId,
          to: next.providerId,
          reason,
        });
      } catch {
        /* event bus optional during tests */
      }
    }
  }

  const fallbackError = lastErr ?? new Error('router: all providers failed');
  throw routeFailure(attempts, fallbackError);
}

/** Convert any strategy into a flat list of {providerId, modelId, triggerCodes} links. */
function flattenToChain(strategy: RouteStrategy): FallbackLink[] {
  switch (strategy.kind) {
    case 'primary':
      return [{ providerId: strategy.providerId, modelId: strategy.modelId, triggerCodes: [] }];
    case 'fallback_chain':
      return strategy.chain;
    case 'task_routing':
      // For routing, we resolve the matching sub-strategy synchronously.
      // The ChatRequest isn't visible here, so callers should call resolveStrategy
      // first if they need task_routing — streamWithFallback assumes a flat chain.
      throw new Error('router: streamWithFallback received task_routing; resolve it first');
    case 'parallel_race':
      throw new Error('router: parallel_race not implemented yet');
  }
}

function extractStatus(err: unknown): number | undefined {
  if (!err || typeof err !== 'object') return undefined;
  const e = err as { status?: number; response?: { status?: number } };
  return e.status ?? e.response?.status;
}
