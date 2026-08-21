// tauri-build.mjs — packaging wrapper (see docs: 开源计划 06).
//
// Public clones build a clean app: the repository's tauri.conf.json carries no
// private resources. The author's own checkout contains gitignored personal
// files (AGENT.md, private.defaults.json, personal skills, aigc-memory notes);
// when `private.defaults.json` is present we merge the private resource list
// via Tauri's --config overlay so the personal build keeps every customization
// without the public repo ever referencing those paths.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import './prepare-private.mjs';

const root = new URL('..', import.meta.url).pathname;
const isPrivate = existsSync(join(root, 'private.defaults.json'));

const args = ['tauri', 'build'];
if (isPrivate) {
  const resources = [
    '../AGENT.md',
    '../skills/**/*',
    '../aigc-memory/**/*',
    '../scripts/render-worker.mjs',
    '../scripts/motion-runtime.js',
    '../dsh-runtime/**/*',
    '../.local-browsers/**/*',
  ];
  // Tauri 1.x merges --config JSON over tauri.conf.json; arrays replace.
  args.push('--config', JSON.stringify({ tauri: { bundle: { resources } } }));
  console.log('[private] packaging WITH personal resources (AGENT.md et al.)');
} else {
  console.log('[private] packaging clean public build');
}

const result = spawnSync('npx', args, { stdio: 'inherit', cwd: root, shell: false });
process.exit(result.status ?? 1);
