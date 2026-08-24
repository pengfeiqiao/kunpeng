# AGENTS.md — 给 AI 编码助手的项目约定

## 项目

鲲鹏（Kunpeng）：Tauri 1.x + React 18 + Rust 的桌面 AIGC 创作工作台（对话/画布/工坊/剪辑/文案），支持 macOS 与 Windows。

## 常用命令

- 开发：`npm run tauri:dev`
- 类型检查：`npx tsc --noEmit`
- 测试：`npm run test:harness`（agent/DSH/凭证/渠道）、`npm run test:dsh-runtime`、`npm run test:omni`、`npm run test:context`
- Rust：`cargo check --manifest-path src-tauri/Cargo.toml`
- 打包：`npm run tauri:build`（经 `scripts/tauri-build.mjs`，无 `private.defaults.json` 时为纯净公开构建；macOS 出 dmg，Windows 出 msi/nsis）

## 跨平台约定

- `execute_command` 的 shell 由 Rust 侧 `shell_info` 决定：macOS/Linux=zsh；Windows 优先 Git Bash（POSIX 语法），缺失时回退 PowerShell。前端命令构造、agent 提示词（os/shell）一律走 `src/lib/platform.ts`，不要写死平台。
- macOS 专属 API（cocoa/objc、ditto、open -R、videotoolbox）必须 `#[cfg(target_os)]` 门控并给 Windows 等价实现（zip crate 解压、explorer /select、libx264 回退）。
- Windows 拉起控制台子进程（node.exe 等）必须加 `CREATE_NO_WINDOW`，否则会闪终端窗口；杀进程树用 `taskkill /T /F`（无 killpg）。

## 硬性纪律

1. **DeepSeek Harness 锁定 `0.1.0-rc.6`**：不改 `dsh-runtime/node_modules` 上游源码，不升级版本；升级必须全量回归（test:harness + test:dsh-runtime + 真实 ACP 冒烟）。
2. **Harness 失败只允许降级到同一个 DeepSeek 模型的普通模式**，不得跳转到其他供应商。
3. **付费工具（生图/视频/配音等）一旦执行过，禁止整轮重放**，避免重复扣费。
4. **密钥纪律**：key 只存 `settingsStore`（凭证注册表），不进日志/错误消息/进程参数/对话历史；写盘走 `write_text_file_private`（0600）；设置导出不含凭证。
5. 仓库中 `private.defaults.json`、`AGENT.md`、个人技能与记忆目录均为 gitignored 私人内容，不要把它们的路径写进公开配置。

## 结构速查

- `src/lib/agent/` — 自研 agent loop（GLM/Kimi）与 DeepSeek Harness 桥（`dsh/`）
- `src/lib/channels/` — 渠道清单（catalog.ts）与 Ark 模型注册表（arkModels.ts），单一事实源
- `src/lib/credentials.ts` — API 凭证注册表（key 单一事实源）
- `dsh-runtime/` — DeepSeek Harness 运行时（vendored，含 ACP host 与 MCP 工具桥）
- `src-tauri/src/dsh.rs` — DSH 进程生命周期/工具桥 Rust 侧
- `src/components/wizard/` — 新手引导（唯一使用浅色设置页视觉的浮层）
