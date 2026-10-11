# 自研 loop 与 DeepSeek Harness 执行边界审查

审查日期：2026-10-10。范围：工具参数、风险确认、取消、付费去重、Harness 降级与运行时升级。没有发现可证实的 P0；这不是对全产品无漏洞的保证。

## 对照来源

- Kimi CLI 官方源码（仓库已归档，不能把其安装引导器当成仍维护的 loop）：https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/soul/toolset.py
- Kimi 的确认状态机：https://github.com/MoonshotAI/kimi-cli/blob/main/src/kimi_cli/soul/approval.py
- 当前 Kimi Code 仓库：https://github.com/MoonshotAI/kimi-code
- DeepSeek 官方仓库：https://github.com/deepseek-ai/deepseek-harness

Kimi 的工具参数 JSON 解析失败直接返回 ToolParseError；确认取消返回 approved=False；同一步重复工具调用会等待原任务并复用结果。鲲鹏按自身付费任务与工作面授权语义修复，不照搬整个 loop，也不改变 Kimi/DeepSeek 的模型路由。

## 已修复

| 优先级 | 复现条件与影响 | 修改 |
| --- | --- | --- |
| P1 | 动态/静态风险要求确认，但宿主未提供 onToolConfirm：自研 loop 与 DSH 原来会继续执行 | 确认不可用时返回明确失败，保留正常确认后执行 |
| P1 | 模型为同参数付费调用添加 force:true：原实现跳过去重预占及记录，可重复扣费 | force 不再代表用户授权；同轮去重不可绕过。修改参数或用户新一轮重做仍允许 |
| P1 | 付费工具提交后发生未匹配关键字的异常，例如解析回执失败：默认被认定为未提交 | 缺少明确提交前失败证据时按 unknown 记录，阻止自动重复提交 |
| P2 | 工具参数为损坏 JSON、null、数组、字符串：自研 loop 原来用空对象执行或把非对象传下去 | 解析失败直接返回工具错误，不记录原始参数；注册表和 DSH 也验证对象边界 |
| P2 | 排队调用在真正派发前已取消，但工具自身未检查 signal | 注册表执行前统一检查取消，且在付费预占前阻断 |

回归使用真实 Coordinator、ToolRegistry、DSH 工具派发函数，以无副作用测试工具验证执行次数与去重记录，不调用真实付费生成。

## 保留的现有保障

- DSH 已派发工具后不整轮重放；启动失败只降级到同一 DeepSeek 模型。
- 并行只读工具与资源分离的写工具仍走现有调度，不改成全部串行。
- 正常用户确认、新一轮重做、显式参数修改保持可用。
- 不改上游 node_modules 源码，不新增前端按钮。

## DeepSeek Harness 升级

- 官方 npm `latest` 与 `next`：0.2.0-rc.2；另有 0.2.1-alpha.2，未采用 alpha。所有 DSH 包使用同一 0.2.0-rc.2，清除了旧版本的大量覆盖规则并重建可复现锁文件。
- 新版 `dsh-llm-deepseek` 是传输库，API-key 插件为 `dsh-llm-deepseek-api-key`。同步修改 Rust 宿主、缓存版本、文件完整性检查与全部 ACP 冒烟入口。
- 新版 Messages API 使用 `/anthropic/v1/messages`。官方旧根地址和 `/v1` 地址归一到 `/anthropic`，保留用户配置的中转站路径，增加 Rust 回归。
- 启动器显式指定运行时模块解析基准，临时配置目录可以位于运行时之外。
- 修补依赖审计涉及的 MCP SDK、MCP client 与 fflate（SDK 1.32.1、client 2.3.1、fflate 0.8.3），最终运行时 npm audit 为 0。
- ACP 工具冒烟增加实际调用和结果文本断言；原生视觉测试附带可复现的红蓝测试图片。

真实验证：DeepSeek Flash ACP 调用 probe_echo 一次并收到 ECHO:hello；直接传图正确识别左红右蓝；模型调用 inspect_test_image 一次后同样识别左右色块。测试使用现有凭证，仅通过子进程环境传递，未写入源码、命令参数或日志。测试会话与用户实际会话分离。

## 验证记录

- `npm run test:harness`：977 通过，0 失败。
- `npm run test:dsh-runtime`：5 通过，0 失败。
- `npx tsc --noEmit`、`npm run build`：通过；构建仍有已有的大分块提示。
- ACP 启动、真实工具闭环、直接图片输入、工具图片结果：通过。
- `npm audit --omit=dev`（dsh-runtime）：0 vulnerabilities。
- `git diff --check`：通过。
- Rust 宿主定向回归：`normalized_base_url_preserves_messages_route_and_gateway_paths` 通过，包含官方根地址、Messages 路径与中转站路径。
