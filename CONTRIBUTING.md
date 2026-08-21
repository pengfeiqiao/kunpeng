# 贡献指南（CONTRIBUTING）

感谢你愿意为鲲鹏贡献代码！本项目为个人业余项目，Issue 和 PR 会尽力回应，但无法保证响应时效。

## 环境准备

- Node.js 20+
- Rust 工具链（rustup）
- macOS（当前主要支持平台）

```bash
npm install
npm run tauri:dev      # 开发模式（热更新）
```

## 构建

```bash
npm run tauri:build    # 打包，走 scripts/tauri-build.mjs 包装器；公共构建为纯净版
```

注意：`dsh-runtime/node`（内嵌 Node.js 运行时）是 gitignored 的本地下载件，`npm install` 后先跑一次 `npm run setup:dsh-node` 自动下载（或参考 `.github/workflows/release.yml` 手动准备）。

## 测试

提交 PR 前请至少跑通与你改动相关的测试：

```bash
npm run test:harness        # 前端 agent / harness 核心测试
npm run test:dsh-runtime    # dsh-runtime 测试
npm run test:omni           # 多模态相关测试
npm run test:context        # 上下文压缩/保留测试
npx tsc --noEmit            # 类型检查
cargo check --manifest-path src-tauri/Cargo.toml   # Rust 侧
```

完整脚本列表见 `package.json` 的 `scripts`。

## PR 流程

1. Fork 本仓库，从 `main` 切出功能分支（建议命名 `feat/xxx` 或 `fix/xxx`）。
2. 保持改动最小化：一个 PR 只做一件事，不顺手重构无关代码。
3. 提交信息用简洁中文或英文说明「做了什么、为什么」。
4. 发起 PR 时填写模板内容（改动说明、测试情况、关联 Issue）。
5. 维护者 review 通过并合并。

## 硬性纪律（务必遵守）

### DSH（DeepSeek Harness）锁版本

`dsh-runtime/` 捆绑的上游引擎 `@deepseek-ai/dsh` 锁定在 **0.1.0-rc.6**（`dsh-runtime/package.json` 中所有 `@deepseek-ai/*` 包同版本锁定）。**升级该版本必须做全量回归**，至少包括：

1. `npm run test:harness`
2. `npm run test:dsh-runtime`
3. **真实 ACP 冒烟**（真实 DeepSeek 渠道跑一条端到端任务）

未通过回归的 DSH 升级 PR 一律不予合并。

### Harness 失败降级策略

Harness 链路失败时，**只允许降级到同模型的 DeepSeek 普通模式**（自研 provider 链路），不得降级到其他模型或静默换渠道。

### 付费工具执行后禁止整轮重放

涉及计费 API 的工具（图像 / 视频生成等）一旦执行成功，**禁止整轮对话重放**（replay / retry 整轮），避免重复扣费。失败重试只允许从未执行的步骤继续。

## 行为准则

参与本项目请遵守 [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)。

## 安全问题

安全漏洞请按 [SECURITY.md](SECURITY.md) 报告，不要在公开 Issue 中披露。
