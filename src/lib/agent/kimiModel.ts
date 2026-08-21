/** Kimi uses account capability to grant 1M context; the wire model remains `k3`. */
export function toKimiWireModel(modelId?: string): string {
  const value = (modelId || 'k3').trim();
  return /^k3(?:\[1m\])?$/i.test(value) ? 'k3' : value;
}
