# Kimi 自研 loop 对照审查（2026-10-10）

## 范围与依据

检查 KimiProvider → GLMClient → AgentCoordinator 的流式解析、重试、工具执行，以及 contextManager 的压缩路径。保留现有会话隔离、原生多模态和 DeepSeek Harness 路由。

官方 kimi-cli 已归档，当前主要参照 MoonshotAI/kimi-code。以下是当日读取的 main 分支，链接会随上游变化；未复制上游代码：

- https://github.com/MoonshotAI/kimi-cli ：归档和迁移说明。
- https://github.com/MoonshotAI/kimi-code/blob/main/packages/agent-core-v2/src/agent/loop/machine/requester.ts ：区分请求完成、失败、取消，传递信号与结束原因。
- https://github.com/MoonshotAI/kimi-code/blob/main/packages/agent-core-v2/src/agent/loop/machine/tools.ts ：按调用 ID 结算结果，清理取消监听器，补齐未产生结果的调用。
- https://github.com/MoonshotAI/kimi-code/blob/main/packages/agent-core-v2/src/agent/fullCompaction/contextRecovery.ts ：摘要附带日志位置与范围，支持回查。
- https://github.com/openai/codex/blob/main/codex-rs/core/src/client.rs ：区分响应完成事件和连接关闭，记录取消、失败、完成。
- https://github.com/openai/codex/blob/main/codex-rs/core/src/tools/parallel.rs ：取消与工具执行生命周期、排队和执行耗时测试。

## 已修复

### P1：连接结束不等于模型完成

原先 Rust 发出传输 done 后，GLMClient 消费完缓冲便正常返回；没有模型终止事件也能让 coordinator 进入工具执行或最终答复。

现在必须出现 message_delta 的 finish reason 或 message_stop。缺失终止事件则报错，不执行当前不完整批次。兼容只发送其中一个终止事件的 Anthropic 网关。已经输出片段后不自动重放请求，避免重复文本、损坏工具参数；此前已完成的工具不回滚、不重放。

### P1：损坏的 SSE 事件被静默丢弃

原先 JSON 解析失败仅记日志并跳过，遗漏的参数片段有可能仍组成合法但错误的 JSON。现在立即终止本次响应，错误不包含原始事件内容。

### P1：输出截断后仍执行工具

原先 max_tokens 仅在没有工具调用时进入续写，有工具时照常执行。现在 max_tokens/length 且存在工具调用时拦截整个本批次，尚未进入确认、幂等预留或执行。不能仅以 JSON 能解析作为模型完整表达了操作意图的证据。无工具的 length 也按既有 max_tokens 逻辑续写。

### P2：重试等待的取消监听器残留

GLMClient.sleep 正常结束时没有移除监听器，预先取消的信号也无法立即终止等待。现在正常完成清理监听器，预取消立即拒绝；取消中的计时器被清理。

## 仍值得继续优化的方向（未在本轮实现）

1. 上下文回查索引：现有 contextManager 已保留工具配对边界和累计摘要；可进一步给摘要附带按会话隔离的原始消息范围和检索入口，减少压缩后事实难以追溯。需要同步设计持久化、附件寿命和权限边界，不宜只加一段提示词。
2. 分阶段耗时：统一记录入队、首包、模型输出、工具等待、软件租约等待、执行和落盘耗时；界面沿用已有状态，不增加按钮。Codex 的区分方式适合定位用户感知卡顿。
3. 非流式请求取消：KimiProvider 的 chat/chatDetailed 当前忽略 ChatOptions.signal；loop 摘要已有 SummaryCircuit 的外层取消保护，但底层 HTTP 仍可能继续消耗资源。后续应与 Tauri 非流式传输一起支持请求级取消，单纯 Promise.race 无法停止服务器工作。

## 验证

新增回归覆盖文本/工具提前 EOF、损坏事件后仍有正常结束标记、仅 message_stop 的网关、重试监听器清理、两类输出上限下合法 JSON 工具请求不执行。

这轮没有升级依赖或更改 DSH 运行时；修改的是 Kimi/GLM 共享 Anthropic 客户端和自研 coordinator。DeepSeek/GPT 使用共享 loop 的截断保护，DSH 内部执行不变。

验证：test:harness 989/989 通过；test:conversation 54 通过、1 项可选截图测试跳过、0 失败；npm run build（含 TypeScript）通过；git diff --check 通过。构建仍有既有大 chunk 提示。未进行真实 Kimi API 压力测试或安装包测试，不宣称所有渠道/网络条件下无缺陷。
