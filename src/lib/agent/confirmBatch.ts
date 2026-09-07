interface ConfirmationItem {
  toolName: string;
  params: Record<string, unknown>;
}

/** Batch tools keep their executor and concurrency policy; only approved items enter it. */
export async function confirmToolItems(
  toolName: string,
  params: Record<string, unknown>,
  request: (item: ConfirmationItem) => Promise<boolean>,
  signal?: AbortSignal,
): Promise<boolean> {
  const batch = toolName === 'canvas_generate_batch'
    ? { key: 'jobs', tool: 'canvas_generate' }
    : toolName === 'timeline_omni_mg_generate_batch'
      ? { key: 'segments', tool: 'timeline_omni_mg_generate' }
      : undefined;
  const items = batch ? params[batch.key] : undefined;
  if (!batch || !Array.isArray(items) || !items.length) {
    return request({ toolName, params });
  }
  // Leave invalid batches to their existing validator; do not silently drop malformed jobs.
  if (items.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
    return request({ toolName, params });
  }
  const { [batch.key]: _items, ...defaults } = params;
  const frozen = structuredClone(items) as Record<string, unknown>[];
  const decisions = await Promise.all(frozen.map((item) => request({
    toolName: batch.tool,
    params: { ...defaults, ...item },
  })));
  if (signal?.aborted) return false;
  const approved = frozen.filter((_, index) => decisions[index]);
  // The coordinator executes this exact object after the confirmation callback.
  // Mutating only the batch collection makes the execution/history reflect the approved subset.
  params[batch.key] = approved;
  return approved.length > 0;
}
