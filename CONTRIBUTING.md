# 参与共建（Contributing）

感谢你对鲲鹏的兴趣！这是一个公开仓库，**不需要任何额外权限**就可以贡献代码。

## 提交流程

1. Fork 本仓库到你自己的账号
2. 在 Fork 上新建分支（如 `fix/dock-reopen`、`feat/xxx`）
3. 提交代码并 Push 到你的 Fork
4. 在 GitHub 上向本仓库的 `main` 分支发起 Pull Request

> 常见问题：「可以给我开 PR 权限吗？」——GitHub 公开仓库的 PR 走的是 Fork 流程，任何人都可以提，无需仓库写权限。直接 Fork 后提 PR 即可。

## 本地开发

```bash
npm install
npm run tauri:dev        # 开发模式启动
npx tsc --noEmit         # 前端类型检查
npm run test:harness     # agent / 渠道 / 凭证测试
cargo check --manifest-path src-tauri/Cargo.toml
```

提交 PR 前请确保 `tsc`、`test:harness`、`cargo check` 全部通过。

## 约定

- **不要提交任何 API Key / 凭证**。密钥只允许存 `settingsStore`（凭证注册表），不进日志、错误消息、进程参数。
- **付费生成工具一旦执行过，禁止自动整轮重放**（防重复扣费）；渠道容灾只能在"确认未扣费"时切换。
- DeepSeek Harness 锁定 `0.1.0-rc.6`，不要改 `dsh-runtime/node_modules` 上游源码。
- 新渠道/新引擎请补最小单测（`node --test` 风格，参考 `src/lib/videoRouter/wan3.test.ts`）。
- 更详细的工程约定见根目录 `AGENTS.md`。

## 反馈问题

提 Issue 时请带上：鲲鹏版本号、操作系统、复现步骤、期望与实际行为。涉及生成失败时附上任务面板里的错误文本（注意抹掉 Key）。
