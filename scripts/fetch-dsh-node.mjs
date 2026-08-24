// fetch-dsh-node.mjs — download the bundled Node.js runtime for dsh-runtime/.
//
// `dsh-runtime/node` is gitignored (large binary artifact). Fresh clones must
// fetch it once before `npm run tauri:dev` / `tauri:build` can use the
// DeepSeek Harness engine. Usage: `npm run setup:dsh-node`
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { get } from 'node:https';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const NODE_VERSION = 'v24.19.0';
const root = fileURLToPath(new URL('..', import.meta.url));
const isWindows = process.platform === 'win32';
const targetDir = join(root, 'dsh-runtime', 'node');

const targets = {
  'darwin-arm64': `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
  'darwin-x64': `node-${NODE_VERSION}-darwin-x64.tar.gz`,
  'linux-x64': `node-${NODE_VERSION}-linux-x64.tar.xz`,
  'linux-arm64': `node-${NODE_VERSION}-linux-arm64.tar.xz`,
  'win32-x64': `node-${NODE_VERSION}-win-x64.zip`,
  'win32-arm64': `node-${NODE_VERSION}-win-arm64.zip`,
};

const key = `${process.platform}-${process.arch}`;
const file = targets[key];
if (!file) {
  console.error(`[setup:dsh-node] unsupported platform: ${key} — download Node ${NODE_VERSION} manually from nodejs.org and unpack into dsh-runtime/node`);
  process.exit(1);
}

// Unix dists put the binary at bin/node; the Windows zip puts node.exe at the
// archive root. Keep the probes in sync with node_binary() in src-tauri dsh.rs.
const nodeBinary = isWindows
  ? join(targetDir, 'node.exe')
  : join(targetDir, 'bin', 'node');

if (existsSync(nodeBinary)) {
  console.log('[setup:dsh-node] dsh-runtime/node already present, nothing to do');
  process.exit(0);
}

const url = `https://nodejs.org/dist/${NODE_VERSION}/${file}`;
const archive = join(root, 'dsh-runtime', file);
console.log(`[setup:dsh-node] downloading ${url}`);

await new Promise((resolve, reject) => {
  const follow = (u, redirects = 0) => {
    get(u, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects < 5) {
        res.resume();
        follow(res.headers.location, redirects + 1);
        return;
      }
      if (res.statusCode !== 200) {
        reject(new Error(`HTTP ${res.statusCode} for ${u}`));
        res.resume();
        return;
      }
      const out = createWriteStream(archive);
      res.pipe(out);
      out.on('finish', () => out.close(resolve));
      out.on('error', reject);
    }).on('error', reject);
  };
  follow(url);
});

mkdirSync(targetDir, { recursive: true });
// Node dist archives contain a top-level node-<ver>-<platform>/ directory;
// strip it so dsh-runtime/node/bin/node (unix) or dsh-runtime/node/node.exe
// (windows) is the binary path. Windows uses the bundled bsdtar explicitly:
// GNU tar (e.g. Git for Windows') misreads "D:\..." drive letters as
// host:path remote specs.
const tarBin = isWindows
  ? join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe')
  : 'tar';
execFileSync(tarBin, ['-xf', archive, '-C', targetDir, '--strip-components', '1'], { stdio: 'inherit' });
rmSync(archive, { force: true });

if (!existsSync(nodeBinary)) {
  console.error(`[setup:dsh-node] extraction failed: ${nodeBinary} not found`);
  process.exit(1);
}
console.log(`[setup:dsh-node] Node ${NODE_VERSION} ready at dsh-runtime/node`);
