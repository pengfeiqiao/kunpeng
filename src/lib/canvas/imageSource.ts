/**
 * imageSource — 把画布节点里的图片 URL 可靠地加载为 ImageBitmap。
 *
 * Why: 画布图片大多是 `convertFileSrc` 生成的 asset URL（macOS 是
 * `asset://localhost/...`，Windows 是 `https://asset.localhost/...`）。
 * 直接用浏览器 `fetch()` 拉会被 CSP connect-src 拦（connect-src 没放行
 * asset:），回退 `<img>` 画 canvas 又会 tainted，`toDataURL` 报
 * "The operation is insecure"。所以：
 *   - asset URL / 绝对路径 → 反解本地路径 → `readBinaryFile` 直接读盘；
 *   - http(s) 远程图 → Tauri http fetch（Rust 侧发请求，无 CORS）；
 *   - data: URL → 浏览器 fetch（同源，无问题）。
 * 得到的 ImageBitmap 画到 canvas 上是干净的，可自由导出。
 */
import { readBinaryFile } from '@tauri-apps/api/fs';
import { fetch as tauriFetch, ResponseType } from '@tauri-apps/api/http';
import { stripDriveLeadingSlash } from '@/lib/platform';

/** asset URL / 绝对路径 → 本地绝对路径；解不出来返回 null。 */
export function assetUrlToLocalPath(url: string): string | null {
  // Windows 原生绝对路径（C:\... 或 C:/...）直通
  if (/^[A-Za-z]:[\\/]/.test(url)) return url;
  if (url.startsWith('/')) return stripDriveLeadingSlash(url);
  if (url.startsWith('https://asset.localhost/')) {
    return stripDriveLeadingSlash(decodeURIComponent(url.replace('https://asset.localhost/', '/').replace(/^\/+/, '/')));
  }
  if (url.startsWith('asset://localhost/')) {
    return stripDriveLeadingSlash(decodeURIComponent(url.replace('asset://localhost/', '/').replace(/^\/+/, '/')));
  }
  return null;
}

/**
 * 加载图片为 ImageBitmap（干净、可导出）。
 * @param imageUrl 节点上的图片 URL（asset/http/data/绝对路径均可）
 * @param localPath 可选的已知本地路径（node.data.localPath），优先使用
 */
export async function loadImageBitmap(imageUrl: string, localPath?: string): Promise<ImageBitmap> {
  const path = localPath || assetUrlToLocalPath(imageUrl);
  if (path) {
    const bytes = await readBinaryFile(path);
    return createImageBitmap(new Blob([new Uint8Array(bytes)]));
  }
  if (/^https?:\/\//.test(imageUrl)) {
    const resp = await tauriFetch(imageUrl, { method: 'GET', responseType: ResponseType.Binary, timeout: 120 });
    if (!resp.ok) throw new Error(`图片下载失败 HTTP ${resp.status}`);
    return createImageBitmap(new Blob([new Uint8Array(resp.data as unknown as ArrayBuffer)]));
  }
  // data: URL 等同源资源，浏览器 fetch 即可
  const resp = await fetch(imageUrl);
  return createImageBitmap(await resp.blob());
}
