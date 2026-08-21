// fetch-dsh-node.mjs — download the bundled Node.js runtime for dsh-runtime/.
//
// `dsh-runtime/node` is gitignored (large binary artifact). Fresh clones must
// fetch it once before `npm run tauri:dev` / `tauri:build` can use the
// DeepSeek Harness engine. Usage: `npm run setup:dsh-node`
import { createWriteStream, existsSync, mkdirSync, rmSync } from 'node:fs';
import { get } from 'node:https';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

const NODE_VERSION = 'v24.19.0';
const root = new URL('..', import.meta.url).pathname;
const targetDir = join(root, 'dsh-runtime', 'node');

const targets = {
  'darwin-arm64': `node-${NODE_VERSION}-darwin-arm64.tar.gz`,
  'darwin-x64': `node-${NODE_VERSION}-darwin-x64.tar.gz`,
  'linux-x64': `node-${NODE_VERSION}-linux-x64.tar.xz`,
  'linux-arm64': `node-${NODE_VERSION}-linux-arm64.tar.xz`,
};

const key = `${process.platform}-${process.arch}`;
const file = targets[key];
if (!file) {
  console.error(`[setup:dsh-node] unsupported platform: ${key} — download Node ${NODE_VERSION} manually from nodejs.org and unpack into dsh-runtime/node`);
  process.exit(1);
}

if (existsSync(join(targetDir, 'bin', 'node'))) {
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
// strip it so dsh-runtime/node/bin/node is the binary path.
execFileSync('tar', ['-xf', archive, '-C', targetDir, '--strip-components', '1'], { stdio: 'inherit' });
rmSync(archive, { force: true });

if (!existsSync(join(targetDir, 'bin', 'node'))) {
  console.error('[setup:dsh-node] extraction failed: bin/node not found');
  process.exit(1);
}
console.log(`[setup:dsh-node] Node ${NODE_VERSION} ready at dsh-runtime/node`);
