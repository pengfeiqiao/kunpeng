import { copyFile, createDir } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { nanoid } from 'nanoid';
import { localMediaPath } from './mediaPath';

/** Imported media must survive moving/cleaning the user's Downloads/Desktop. */
export async function retainImportedMedia(source: string): Promise<string> {
  const path = localMediaPath(source);
  if (!path) throw new Error('请选择本地媒体文件');
  const dir = `${await homeDir()}.kunpeng/imported-media`;
  const normalized = path.replace(/\\/g, '/');
  if (normalized.startsWith(dir.replace(/\\/g, '/') + '/')) return path;
  await createDir(dir, { recursive: true });
  const name = path.split(/[\\/]/).pop() || 'media';
  const destination = `${dir}/${nanoid(12)}-${name}`;
  await copyFile(path, destination);
  return destination;
}
