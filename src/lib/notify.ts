/**
 * notify — thin wrapper around Tauri's notification API.
 *
 * Lazily requests permission on first call, then no-ops on rejection so
 * callers don't need to guard. We fire notifications only when the window is
 * NOT focused — no point lighting up the OS tray while the user is already
 * looking at the chat.
 *
 * Silent failures by design: a missing notification is never worth a thrown
 * error mid-stream.
 */

import {
  sendNotification,
  isPermissionGranted,
  requestPermission,
} from '@tauri-apps/api/notification';
import { appWindow } from '@tauri-apps/api/window';

let permissionPromise: Promise<boolean> | null = null;

async function ensurePermission(): Promise<boolean> {
  if (permissionPromise) return permissionPromise;
  permissionPromise = (async () => {
    try {
      if (await isPermissionGranted()) return true;
      const p = await requestPermission();
      return p === 'granted';
    } catch {
      return false;
    }
  })();
  return permissionPromise;
}

async function isFocused(): Promise<boolean> {
  try {
    return await appWindow.isFocused();
  } catch {
    return true; // fail safe: assume focused → skip noise
  }
}

export interface NotifyOptions {
  title: string;
  body?: string;
  /** If true, fire even when window is focused. Default: false. */
  whileFocused?: boolean;
}

export async function notify({ title, body, whileFocused }: NotifyOptions): Promise<void> {
  try {
    if (!whileFocused && (await isFocused())) return;
    const ok = await ensurePermission();
    if (!ok) return;
    sendNotification({ title, body: body ?? '' });
  } catch {
    /* non-fatal */
  }
}
