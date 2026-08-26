# 跨平台移植清单（macOS → Windows）

> 用途：每次把 upstream/main（mac 版本）合并进 Windows 分支后，对照本清单检查新增改动。
> 配套工具：`node scripts/port-scan.mjs <range>` 会对 diff 自动扫描下列模式（见文件尾工作流）。

## 已踩过的坑（按类别，全部有实机案例）

### 1. Shell / 命令构造
- Windows 上 `execute_command` 优先 Git Bash，缺失回退 PowerShell；**POSIX 语法在 PowerShell 下全灭**。新增命令串必须只在 POSIX shell 可用时使用，或走 `isPosixShell()` 分支。
- 命令串里内插的 Windows 路径必须**正斜杠 + 预置单引号**：裸 `C:\Users\foo` 会被 bash 吃掉反斜杠（`C:Usersfoo`）。
- `source ~/.zshrc` 只在 macOS 有意义；Windows 是 `.bashrc` 且不自动加载。
- 后台进程终止：**先读 `/proc/<pid>/winpid` 再 kill**，否则进程死后 `/proc` 条目消失，taskkill 永远轮不到，原生子进程（ffmpeg/node）孤儿化。
- `killpg`/进程组信号在 Windows 不存在 → `taskkill /PID <winpid> /T /F`，并设 `MSYS2_ARG_CONV_EXCL='*'`。

### 2. 路径
- **禁止硬编码 `/tmp`**：Git Bash 把它映射到 `%TEMP%`，Tauri fs 把它解析成 `<当前盘>:\tmp`，两边错位。用 `invoke('get_temp_dir')` 并转正斜杠。
- 前端没有 `process`（Vite 产物里 `process.env` 被替换成 `{}`）：候选路径用 `homeDir()` 等 Tauri path API，不要读 `process.env.*`。
- glob 模式串里 `\` 是转义符：Windows 上 `root.join(...)` 必须 `.replace('\\', '/')` 再交给 glob。
- Node ESM `import()` 只接受 file:/data:/node: URL：**绝对路径作为模块 specifier 时**（cordis entry `name` 等）必须转 `file:///` URL（POSIX 裸路径侥幸可用，`C:\` 被当成 scheme `c:` 直接抛错）。用 `dsh.rs` 的 `module_specifier()`。

### 3. 进程与窗口
- GUI 应用 spawn 控制台程序（node/rg/grep/python）必须 `CREATE_NO_WINDOW`（0x08000000），否则闪黑窗。Rust tokio Command 在 Windows 有同名 inherent 方法；std Command 用 `std::os::windows::process::CommandExt`。
- `env_clear()` 后 Windows 必须补回白名单：SystemRoot、SystemDrive、windir、ComSpec、USERPROFILE、TEMP/TMP、PATH（最小 System32 集）、PATHEXT、ProgramFiles*、LOCALAPPDATA、APPDATA 等。
- DSH 运行时用 `dsh-runtime/node/node.exe`（Windows 布局）vs `node/bin/node`（Unix）。

### 4. 网络 / 大请求体
- **tauriFetch（Tauri IPC → reqwest）发 >~64KB 的 JSON body 在 Windows 上会被网关判为
  "invalid JSON request body"**（实测定界：33KB 正常、300KB 即坏；同 body curl 发同端点
  返回 200）。大 body 一律走 `src/lib/agent/curlTransport.ts` 的 `postJsonViaCurl()`。
- 密钥纪律：curl 走 0600 临时配置文件，**密钥不进进程参数**；临时文件用完即删。
- 图片内联 base64 前先压缩（`mediaInput.ts`，>600KB 缩放转 JPEG ≤1600px）。

### 5. 媒体 / 编解码
- `h264_videotoolbox` 只有 macOS 有；Windows 自动回退 `libx264`（检测逻辑见 videoCompose/fxRender）。
- ffmpeg/node 候选路径要覆盖 Windows 安装位（winget Links、C:\ffmpeg、C:\Program Files\nodejs）。

### 6. 打包
- Windows 只出 NSIS（WiX light 对本项目资源集失败）；Node zip 用系统 bsdtar 解（GNU tar 把 `D:\` 当远程主机）；`npx.cmd` 需要 shell 且含空格参数要预加引号。

## 每次同步上游后的标准动作

```bash
git fetch upstream
git merge upstream/main                 # 解冲突
node scripts/port-scan.mjs HEAD@{1}..HEAD  # 扫描本次合入的 diff
npx tsc --noEmit && npm run test:harness && npm run test:dsh-runtime
cargo check --manifest-path src-tauri/Cargo.toml
npm run tauri:build                     # 实机冒烟后再装
```

重点人工复核（脚本扫不出的）：
1. 新增的 `execute_command` 命令串是否含 POSIX-only 语法；
2. 新增的 cordis/loader entry `name` 是否裸绝对路径（必须 `module_specifier()`）；
3. 新增 HTTP 调用是否可能携带 >64KB body（必须 curlTransport）；
4. 新增 spawn 是否漏 CREATE_NO_WINDOW / env 白名单。
