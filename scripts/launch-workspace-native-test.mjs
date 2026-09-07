// Native UI inspection uses an isolated home, a real project file, and OS-level network denial.
import { mkdtemp, mkdir, readFile, writeFile, copyFile, chmod, rename, access } from 'node:fs/promises';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { emptyWorkshopData } from '../src/lib/workshop/types.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const app = path.join(root, 'src-tauri/target/debug/bundle/macos/鲲鹏测试版.app');
const executableName = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleExecutable', path.join(app, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
const executable = path.join(app, 'Contents/MacOS', executableName);
await access(executable);
const home = await mkdtemp(path.join(tmpdir(), 'kunpeng-native-workspace-'));
const projectId = 'workspace-native-review';
const base = path.join(home, '.kunpeng/aigc-memory/projects');
const directory = path.join(base, projectId);
await mkdir(path.join(directory, 'sources'), { recursive: true });
const now = Date.now();
const project = { id: projectId, name: '雨夜归途 · 本地测试', slug: 'workspace-native-review',
  createdAt: now, updatedAt: now, status: 'parsed', videoEngine: 'rhtv',
  sources: [{ name: 'script.md', type: 'md', size: 0, uploadedAt: now }],
  stats: { shots: 3, scenes: 1, assets: 2, videosCompleted: 0 } };
await mkdir(path.join(directory, 'assets'), { recursive: true });
const portrait = path.join(directory, 'assets/portrait.jpg');
const scene = path.join(directory, 'assets/scene.jpg');
await copyFile(path.join(root, 'public/midjourney-styles/director/raw-flash-intimacy.jpg'), portrait);
await copyFile(path.join(root, 'public/omni-style-cards/architecture-exploded.jpg'), scene);
const data = { ...emptyWorkshopData(projectId), synopsis: '司机在雨夜行车，听到车外异响后停下观察。没有新增对白。',
  characters: [{ id: 'driver', name: '司机', appearance: '穿深色外套', personality: '谨慎', assetImagePath: portrait }],
  scenes: [{ id: 'road', name: '雨夜公路', description: '夜晚，降雨，郊外公路', assetImagePath: scene }],
  shots: [
    { id: 'shot-1', shotNo: '01', sceneId: 'road', characterIds: ['driver'], description: '司机沿公路行驶', durationSec: 6, imagePrompt: '司机握住方向盘，车窗上有雨滴。', imagePath: portrait },
    { id: 'shot-2', shotNo: '02', sceneId: 'road', characterIds: ['driver'], description: '司机听到右侧异响，转头观察', durationSec: 8, imagePrompt: '司机转头看向车窗外，不新增对白。', imagePath: portrait },
    { id: 'shot-3', shotNo: '03', sceneId: 'road', characterIds: ['driver'], description: '司机减速停车', durationSec: 5, imagePrompt: '司机踩下刹车，保持既定人物关系。' },
  ], projectViewState: { workspaceObjectId: 'shot:shot-2', workspaceOutputType: 'image', workspaceSurface: 'media', workspaceComposerOpen: true } };
await writeFile(path.join(base, 'projects-index.json'), JSON.stringify([project]));
await writeFile(path.join(directory, 'project.json'), JSON.stringify(project));
await writeFile(path.join(directory, 'workshop.json'), JSON.stringify(data));
await writeFile(path.join(directory, 'sources/script.md'), '# 雨夜归途\n司机在雨夜沿公路行驶。右侧传来异响，他转头看向车窗，随后减速停车。全程无对白。\n');
const quote = value => JSON.stringify(value);
const profile = `(version 1) (allow default) (deny network-outbound) (deny file-read* file-write* (subpath ${quote(path.join(homedir(), '.kunpeng'))}))`;
const logPath = path.join(home, 'native.log');
const nativeExecutable = `${executable}.native`;
if ((await readFile(executable)).subarray(0, 2).toString() !== '#!') await rename(executable, nativeExecutable);
else await access(nativeExecutable);
const shellQuote = value => `'${value.replaceAll("'", "'\\''")}'`;
// Launch Services must own the process for the native UI inspector to identify the bundle.
// The test-only wrapper keeps the same network/data isolation when opened from Finder.
await writeFile(executable, `#!/bin/sh\nexport HOME=${shellQuote(home)}\nexport CFFIXED_USER_HOME=${shellQuote(home)}\nexec /usr/bin/sandbox-exec -p ${shellQuote(profile)} ${shellQuote(nativeExecutable)} >>${shellQuote(logPath)} 2>&1\n`);
await chmod(executable, 0o755);
console.log(JSON.stringify({ app, home, logPath, network: 'denied', userData: 'isolated', readyToOpen: true }));
