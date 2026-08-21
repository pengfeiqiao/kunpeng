## 改动说明

<!-- 简要说明这个 PR 做了什么、为什么做。关联 Issue 用 "Closes #123"。 -->

## 改动类型

- [ ] Bug 修复
- [ ] 新功能
- [ ] 重构 / 清理
- [ ] 文档
- [ ] CI / 构建

## 测试情况

<!-- 勾选实际跑过并通过的检查；没跑的请说明原因 -->

- [ ] `npx tsc --noEmit`
- [ ] `npm run test:harness`
- [ ] `npm run test:dsh-runtime`
- [ ] `cargo check --manifest-path src-tauri/Cargo.toml`
- [ ] 其他（请说明）：

## 硬性纪律自查

- [ ] 本 PR **未升级** `@deepseek-ai/dsh`（当前锁定 0.1.0-rc.6）；如确需升级，已完成 test:harness + test:dsh-runtime + 真实 ACP 冒烟全量回归并在上文说明
- [ ] Harness 失败时只降级到同模型 DeepSeek 普通模式，未引入静默换渠道
- [ ] 未引入「付费工具执行成功后整轮重放」的行为
- [ ] 代码中不包含 API Key 等敏感信息

## 其他说明

<!-- 截图、破坏性变更、需要 reviewer 重点关注的点等 -->
