/** Decode only known local URL schemes; ordinary paths keep literal %, # and ?. */
export function localMediaPath(value: string): string | null {
  if (/^[A-Za-z]:[\\/]/.test(value)) return value;
  if (value.startsWith('/')) return /^\/[A-Za-z]:[\\/]/.test(value) ? value.slice(1) : value;
  const prefix = /^(?:https?:\/\/asset\.localhost\/|asset:\/\/localhost\/|file:\/\/(?:localhost)?\/)/i.exec(value);
  if (!prefix) return null;
  const encoded = value.slice(prefix[0].length).split(/[?#]/)[0];
  let path: string;
  try { path = decodeURIComponent(encoded); } catch { return null; }
  path = '/' + path.replace(/^\/+/, '');
  return /^\/[A-Za-z]:[\\/]/.test(path) ? path.slice(1) : path;
}
