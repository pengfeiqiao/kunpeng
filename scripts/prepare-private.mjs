// prepare-private.mjs — private overlay wiring (see docs: 开源计划 06).
//
// `private.defaults.json` (repo root, gitignored) only ever exists in the
// author's own checkout. When present it is copied into `public/` so the app
// can fetch it at startup (dev and packaged builds alike); public clones never
// have the file, and any stale copy is removed so official builds stay clean.
import { copyFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const source = join(root, 'private.defaults.json');
const target = join(root, 'public', 'private.defaults.json');

if (existsSync(source)) {
  copyFileSync(source, target);
  console.log('[private] private.defaults.json detected — private build mode');
} else if (existsSync(target)) {
  rmSync(target);
  console.log('[private] no private.defaults.json — removed stale public copy');
}
