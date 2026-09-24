# Codex 对标：后续运行时优化调研

本次仅调研，没有修改产品代码。鲲鹏基线为 4ec9cda 加上一轮尚未提交的共享适配改动；已完成的 MCP 隔离、原生截图回传、Blender 技能不重复计为新增建议。

Codex 源码对照快照：f5f08c54cb7a774594d3579c5731ea3e87f01c48。通过 GitHub blob API 读取源码；公共仓库机制不等于桌面客户端全部实现，也不代表 DMX 透传所有原生协议。

## 优先结论

最值得继续做的是：保存失败可恢复、Bash 输出有界化、压缩状态按会话隔离、按需暴露工具，以及完整请求预算。这些适合共享基础设施优化。不能把静态发现直接当作用户所有卡顿的根因，性能收益需要工作负载测量。

### 1. 会话持久化：失败必须反馈给保存队列

已确认：`src/lib/historyPersistence.ts:253` 在写临时文件及 rename 外层 catch 后只 console.warn，Promise 正常结束。调用方无法区分写盘成功与失败。已有 tmp+rename、会话串行写入和本地缓存，这些保护应保留；问题不是完全没有可靠保存，而是失败确认和恢复不足。

同文件 `:278` 仍对整个会话 JSON.stringify；`src/hooks/useAgent.ts:365` 先构造 localStorage 缓存，再写完整磁盘历史。已有 1500ms debounce / 15000ms 最小间隔，不能再笼统建议“加防抖”。长历史序列化仍发生在前端主线程，是需要测量的性能风险。

[Codex rollout recorder](https://github.com/openai/codex/blob/f5f08c54cb7a774594d3579c5731ea3e87f01c48/codex-rs/rollout/src/recorder.rs)保留未写成功的 pending items，成功后才移除，后续 flush 可以重新打开文件并继续写。

建议分两步：先让保存队列收到失败并保留待写快照，采用有上限的退避和原有状态提示；再评估增量事件日志加定期快照，避免每次重写整段历史。不要同时迁移全部历史存储格式。验收包括磁盘写失败、重启恢复、同一会话并发保存和 500/2000 条历史下的主线程耗时。

### 2. Bash 输出：返回分页不等于内存有上限

已确认：`src-tauri/src/tools/bash.rs:364` 使用 wait_with_output，完整收集 stdout/stderr 后才截断预览；`:256` 保留最多 24 次输出、最长一小时，但没有总字节上限。大日志在运行中进入内存，完成后还会构造字符串并保存副本。模型收到的短输出不能防止后端内存增长。

[Codex process manager](https://github.com/openai/codex/blob/f5f08c54cb7a774594d3579c5731ea3e87f01c48/codex-rs/core/src/unified_exec/process_manager.rs)使用 HeadTailBuffer、可继续读取的进程会话及进程淘汰策略。

建议先改为异步逐块读取，内存只留有界头尾，完整日志写临时文件，现有 output_id 分页从文件读取，并限制磁盘总额与生命周期。之后再做 jobId/yield/poll 的长任务能力。验收用大量日志、输出不停的进程、取消、超时和并行渲染；记录峰值内存而不只看返回文本长度。

### 3. 自动压缩：全局失败计数和内部降级之间存在语义断层

已确认：`src/lib/agent/autoCompact.ts:33` 的 consecutiveFailures 是模块级变量，所有会话共享；源码中未找到产品调用 resetAutoCompactCircuit 的入口。连续三次向外抛错后，其他模型/会话也会关闭自动压缩。

只读内存复现实验使用真实 autoCompact 模块和 contextWindow，屏蔽日志副作用：GPT 请求原本需要压缩；注入三次失败后，Kimi 的超预算请求返回 `compact:false, circuit breaker open (3 failures)`。这证明状态串扰，未证明用户已经遇到这条异常路径。

另一方面，`src/lib/agent/contextManager.ts:525` 在摘要模型失败时捕获异常并返回本地摘要，外层 recordAutoCompactAttempt 会当作成功清零。因此“摘要服务持续失败”与“真正向外抛错”行为不一致。

[Codex auto compact window](https://github.com/openai/codex/blob/f5f08c54cb7a774594d3579c5731ea3e87f01c48/codex-rs/core/src/state/auto_compact_window.rs)显式保存当前上下文窗口状态、基线及降级提示状态；这可借鉴为会话内状态管理，不是说它使用同款熔断器。

建议失败/恢复状态归属于 coordinator 或 session+provider；摘要返回明确的模型成功/本地降级/取消结果。保留本地摘要兜底，但连续降级时暂停重复请求摘要服务，避免每轮额外等待。取消不计服务故障。验证双会话隔离、模型切换、连续摘要失败、冷却恢复及中途取消。

### 4. 工具按需加载，并计算完整请求预算

已确认：`src/lib/agent/toolRegistry.ts:101` 返回全部启用工具；`coordinator.ts:1124` 每次请求全部携带。虽已有工具开关和工作区执行限制，但没有在这里按当前任务缩小 schema 集合。

预算方面：`coordinator.ts:1107` 检查消息估算，然后附加工具。`:304` 已按窗口比例预留余量，因此不是完全没预留；缺口是没有按本轮实际 schema、输出上限和协议开销扣除预算。工具数量增长后固定比例可能过松或过紧。

[Codex tool search](https://github.com/openai/codex/blob/f5f08c54cb7a774594d3579c5731ea3e87f01c48/codex-rs/core/src/tools/handlers/tool_search.rs)区分 deferred 工具并缓存发现索引。鲲鹏可常驻少量核心工具，其余按文案/工坊/画布/Blender 等任务加载，并提供找回工具的路径；不能只关键词筛选后把必要工具永久藏掉。

通用路由和索引可以共享，但各 Provider/DSH 的协议暴露需各自适配，不能直接向 DMX 请求添加未验证支持的 defer_loading 字段。先记录完整请求字节、schema 估算、真实 usage、首字时间和工具选择成功率，证明有收益再扩大范围。

### 5. 图片保留：把图片、来源和对象版本作为一个单元

延续上次预算问题，但新增的是压缩的语义完整性。鲲鹏当前图片预算仍固定每块 1800；需要避免历史缩减后只剩“参考图三”文字而没有对应图，或对象已变更却仍根据旧观察操作。

[Codex image-aware compaction](https://github.com/openai/codex/blob/f5f08c54cb7a774594d3579c5731ea3e87f01c48/codex-rs/core/src/compact_remote_v2_images.rs)将图片和相邻 harness 标签原子保留/删除，并按图像预算处理。

建议媒体记录稳定 mediaId、来源对象/版本、尺寸、必要的最近观察；压缩时一起保留或明确移除引用。此处是进一步设计建议，尚未用本次实验复现鲲鹏的错图问题，不应作为已确认事故结论。共享媒体身份体系，GPT/Kimi/DeepSeek 各自转换媒体协议。

## 不应重复做或直接照搬

- 主对话已 80ms 合并更新、流式正文用纯文本展示、历史初始窗口 60 条、FIFO 及时释放消费项、流事件按工作预算让出主线程。不能再说“逐 token 全量 Markdown 渲染”是当前主聊天的已确认问题。
- 已有执行中补充指令队列、付费工具去重和生成完成后的收尾优化，不应重新造整套 loop。
- Codex 的服务端压缩和原生工具协议不能假定 DMX 都支持。应借鉴生命周期和预算机制，而非直接替换供应商请求协议。
- 不建议为了提速全局开启工具并行；桌面操作、同一 Blender 场景修改、付费生成仍需执行顺序与幂等约束。
- 本次不新增按钮、不改产品代码、不安装依赖、不调用付费模型。只新增调研记录，保留上一轮未提交改动。

## 实施顺序与观测

先修保存确认及压缩状态隔离，再限制 Bash 输出内存；随后推进工具按需加载和完整请求预算。长任务会话化、图片原子压缩另列后续阶段。

统一记录 runId/sessionId 下的首字等待、schema 大小、压缩耗时/结果、工具排队/执行、历史序列化/落盘耗时、流式刷新长任务。已有日志和耗时应复用，避免为了观测再增加高频全量序列化。用同一历史与任务在三模型路径比较，才能区分模型慢、工具慢和界面卡顿。
