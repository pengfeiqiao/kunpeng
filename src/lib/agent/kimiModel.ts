/** Kimi uses account capability to grant 1M context; the wire model remains `k3`. */
export function toKimiWireModel(modelId?: string): string {
  const value = (modelId || 'k3').trim();
  if (/^k3(?:\[1m\])?$/i.test(value)) return 'k3';
  // Kimi Code exposes the new models without the `kimi-` prefix. Accept the
  // Moonshot Open Platform IDs too so migrated settings keep working.
  const k31 = value.match(/^kimi-(k3\.1-pro(?:-highspeed)?)$/i);
  return k31 ? k31[1].toLowerCase() : value;
}
