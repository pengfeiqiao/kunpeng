import type { ToolDefinition } from './types';
// Cache by definition identity: schemas are stable between registry changes.
const schemaCosts = new WeakMap<object, number>();
export function toolSchemaTokens(tools: ToolDefinition[], estimate: (text: string) => number): number {
  return tools.reduce((sum, tool) => {
    let cost = schemaCosts.get(tool);
    if (cost === undefined) { cost = estimate(JSON.stringify(tool)); schemaCosts.set(tool, cost); }
    return sum + cost;
  }, 0);
}
export function messageBudget(window: number, toolTokens: number, maxOutput = 32_000): number {
  const legacyReserve = Math.floor(window * (window >= 900_000 ? 0.94 : 0.72));
  return Math.max(0, Math.min(legacyReserve, window - toolTokens - maxOutput - 1024));
}
