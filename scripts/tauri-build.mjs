// tauri-build.mjs — packaging wrapper (see docs: 开源计划 06).
//
// Public clones build a clean app: the repository's tauri.conf.json carries no
// private resources. The author's own checkout contains gitignored personal
// files (AGENT.md, private.defaults.json, personal skills, aigc-memory notes);
// when `private.defaults.json` is present we merge the private resource list
// via Tauri's --config overlay so the personal build keeps every customization
// without the public repo ever referencing those paths.
import { spawnSync } from 'node:child_process';
import { existsSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import './prepare-private.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const isPrivate = existsSync(join(root, 'private.defaults.json'));

const overlay = { tauri: { bundle: {} } };

// tauri.conf.json pins "dmg" (the macOS artifact build-dmg.sh expects); other
// platforms get their native installers merged in via the same overlay.
// Windows uses NSIS only: WiX's light.exe fails on this project's resource
// set, while NSIS handles the Unicode product name and large payload fine.
if (process.platform === 'win32') {
  overlay.tauri.bundle.targets = ['nsis'];
} else if (process.platform === 'linux') {
  overlay.tauri.bundle.targets = ['deb', 'appimage'];
}

if (isPrivate) {
  overlay.tauri.bundle.resources = [
    '../AGENT.md',
    '../skills/**/*',
    '../aigc-memory/**/*',
    '../scripts/render-worker.mjs',
    '../scripts/motion-runtime.js',
    '../dsh-runtime/**/*',
    '../.local-browsers/**/*',
  ];
  console.log('[private] packaging WITH personal resources (AGENT.md et al.)');
} else {
  console.log('[private] packaging clean public build');
}

// Pass the overlay as a temp JSON file: Tauri's --config accepts a file path,
// and inline JSON would be mangled by cmd.exe argument re-quoting on Windows.
const overlayPath = join(tmpdir(), `kunpeng-tauri-overlay-${Date.now()}.json`);
writeFileSync(overlayPath, JSON.stringify(overlay));

const args = ['tauri', 'build', '--config', overlayPath];
const isWindows = process.platform === 'win32';
// npx is a .cmd shim on Windows — Node refuses to spawn those without a shell.
// With shell:true Node joins args with spaces into a single cmd line, so an
// overlay path containing spaces (e.g. "C:\Users\John Doe\...") would word-
// split; quote args up front (cmd.exe honors double quotes).
const quotedArgs = isWindows ? args.map((a) => (/\s/.test(a) ? `"${a}"` : a)) : args;
const result = spawnSync(isWindows ? 'npx.cmd' : 'npx', quotedArgs, {
  stdio: 'inherit',
  cwd: root,
  shell: isWindows,
});
rmSync(overlayPath, { force: true });
process.exit(result.status ?? 1);
