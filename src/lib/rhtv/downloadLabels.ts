export type DownloadMediaKind = 'image' | 'video' | 'audio';

export function downloadProgressLabel(kind: DownloadMediaKind): string {
  if (kind === 'image') return '下载图片中…';
  if (kind === 'audio') return '下载音频中…';
  return '下载视频中…';
}

export function downloadCompletedLabel(kind: DownloadMediaKind): string {
  if (kind === 'image') return '图片下载完成';
  if (kind === 'audio') return '音频下载完成';
  return '视频下载完成';
}
