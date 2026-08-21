/**
 * assetLibraryStore — reusable subject/voice/style assets for consistent
 * generation (TapNow "个人资产" / LibTV "创建主体" pattern).
 *
 * Metadata persists to localStorage; asset files are copied into
 * ~/.kunpeng/assets/<id>/ so they survive workspace cleanups.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { safeLocalStorage } from '@/lib/safeStorage';
import { createDir, copyFile, removeDir } from '@tauri-apps/api/fs';
import { homeDir } from '@tauri-apps/api/path';
import { nanoid } from 'nanoid';

export type AssetType = 'character' | 'product' | 'scene' | 'voice' | 'style';

export interface LibraryAsset {
  id: string;
  name: string;
  type: AssetType;
  tags: string[];
  /** Absolute paths of reference images (characters/products/scenes). */
  images: string[];
  /** Absolute path of the voice sample (voice assets). */
  audioPath?: string;
  /** Style assets: prompt fragment injected at generation time. */
  stylePrompt?: string;
  createdAt: number;
}

interface AssetLibraryState {
  assets: LibraryAsset[];
  addAsset: (a: Omit<LibraryAsset, 'id' | 'createdAt'>) => Promise<string>;
  removeAsset: (id: string, deleteFiles?: boolean) => Promise<void>;
  renameAsset: (id: string, name: string) => void;
}

async function assetsDir(): Promise<string> {
  return `${await homeDir()}.kunpeng/assets`;
}

/** Copy source files into the asset's own folder; returns new paths. */
async function importFiles(assetId: string, paths: string[]): Promise<string[]> {
  if (paths.length === 0) return [];
  const dir = `${await assetsDir()}/${assetId}`;
  await createDir(dir, { recursive: true }).catch(() => {});
  const out: string[] = [];
  for (const p of paths) {
    const name = p.split('/').pop()!;
    const dest = `${dir}/${name}`;
    try {
      await copyFile(p, dest);
      out.push(dest);
    } catch {
      out.push(p); // fall back to original path if copy fails
    }
  }
  return out;
}

export const useAssetLibraryStore = create<AssetLibraryState>()(
  persist(
    (set) => ({
      assets: [],

      addAsset: async (a) => {
        const id = `asset-${nanoid(8)}`;
        const images = await importFiles(id, a.images);
        const audioPath = a.audioPath ? (await importFiles(id, [a.audioPath]))[0] : undefined;
        set((s) => ({
          assets: [...s.assets, { ...a, id, images, audioPath, createdAt: Date.now() }],
        }));
        return id;
      },

      removeAsset: async (id, deleteFiles = true) => {
        set((s) => ({ assets: s.assets.filter((x) => x.id !== id) }));
        if (deleteFiles) {
          try {
            await removeDir(`${await assetsDir()}/${id}`, { recursive: true });
          } catch { /* asset dir may not exist */ }
        }
      },

      renameAsset: (id, name) =>
        set((s) => ({ assets: s.assets.map((x) => (x.id === id ? { ...x, name } : x)) })),
    }),
    {
      name: 'kunpeng-asset-library',
      storage: createJSONStorage(() => safeLocalStorage),
      version: 1,
    },
  ),
);
